-- ============================================================
-- GreenBridge — Migration 010: 給与計算 (Payroll)
-- wage_settings / payslips / attendance lock
-- 設計方針:
--  ・全テーブル company_id 前提（マルチテナント）
--  ・payslips は確定時に賃金スナップショット + breakdown JSON を保存
--  ・status で draft/confirmed/published を管理
--  ・confirmed 以降は immutable（トリガで UPDATE/DELETE をブロック）
--  ・attendance_records に locked カラムを追加（給与確定で締め）
--  ・手当/控除は JSONB で将来追加に対応
-- ============================================================

-- ── 1. wage_settings: ワーカーごとの賃金設定（履歴対応）──────────
CREATE TABLE IF NOT EXISTS wage_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id      UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,

  wage_type      TEXT NOT NULL DEFAULT 'hourly' CHECK (wage_type IN ('hourly','monthly')),
  base_amount    NUMERIC NOT NULL DEFAULT 0,        -- 時給 or 月給（円）

  -- 法定割増率（労基法準拠の既定値。会社/ワーカー単位で上書き可能）
  overtime_rate  NUMERIC NOT NULL DEFAULT 1.25,     -- 時間外（8h/日超）
  night_rate     NUMERIC NOT NULL DEFAULT 1.25,     -- 深夜（22:00-5:00）加算
  holiday_rate   NUMERIC NOT NULL DEFAULT 1.35,     -- 法定休日

  -- 月給制の場合の所定労働時間（時間単価換算用）
  monthly_standard_hours NUMERIC DEFAULT 160,

  -- 休憩控除（分/日）と丸めルール
  break_minutes  INT NOT NULL DEFAULT 60,
  rounding_unit  INT NOT NULL DEFAULT 15,           -- 丸め単位（分）。0=丸めなし
  rounding_mode  TEXT NOT NULL DEFAULT 'floor'      -- floor/round/ceil
                 CHECK (rounding_mode IN ('floor','round','ceil')),

  -- 固定手当・控除（将来追加に対応する汎用構造）
  allowances     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{key,name,amount,taxable}]
  deductions     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{key,name,amount}]

  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wage_settings_worker_idx
  ON wage_settings (worker_id, is_active);
CREATE INDEX IF NOT EXISTS wage_settings_company_idx
  ON wage_settings (company_id);

-- ── 2. payslips: 月次給与明細（確定時スナップショット保存）─────────
CREATE TABLE IF NOT EXISTS payslips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id        UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  period           TEXT NOT NULL,                   -- 'YYYY-MM'

  -- 集計（時間）
  work_days        INT     NOT NULL DEFAULT 0,
  regular_hours    NUMERIC NOT NULL DEFAULT 0,
  overtime_hours   NUMERIC NOT NULL DEFAULT 0,
  night_hours      NUMERIC NOT NULL DEFAULT 0,
  holiday_hours    NUMERIC NOT NULL DEFAULT 0,

  -- 金額（円）
  base_pay         NUMERIC NOT NULL DEFAULT 0,
  overtime_pay     NUMERIC NOT NULL DEFAULT 0,
  night_pay        NUMERIC NOT NULL DEFAULT 0,
  holiday_pay      NUMERIC NOT NULL DEFAULT 0,
  allowance_total  NUMERIC NOT NULL DEFAULT 0,
  deduction_total  NUMERIC NOT NULL DEFAULT 0,
  gross_pay        NUMERIC NOT NULL DEFAULT 0,      -- 総支給
  net_pay          NUMERIC NOT NULL DEFAULT 0,      -- 差引支給

  -- ★ 確定時スナップショット（後から賃金設定を変えても明細は不変）
  wage_snapshot    JSONB,                           -- wage_settings のコピー
  -- ★ 計算明細（日別内訳・適用レート等）
  breakdown        JSONB,

  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','confirmed','published')),
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     UUID,
  published_at     TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(worker_id, period)
);

CREATE INDEX IF NOT EXISTS payslips_company_period_idx
  ON payslips (company_id, period);
CREATE INDEX IF NOT EXISTS payslips_worker_idx
  ON payslips (worker_id, period);

-- ── 3. attendance_records: ロックカラム（給与確定で締め）────────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- ── 4. immutable トリガ: confirmed/published の payslip は変更不可 ──
-- 許可するのは status 遷移 (confirmed→published) と published_at 設定のみ。
CREATE OR REPLACE FUNCTION payslips_guard_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- DELETE はブロック
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status IN ('confirmed','published') THEN
      RAISE EXCEPTION 'confirmed/published の給与明細は削除できません (payslip %)', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: 旧 status が confirmed/published の場合は publish 遷移のみ許可
  IF (OLD.status IN ('confirmed','published')) THEN
    -- 金額・時間・スナップショットの変更は禁止
    IF ( NEW.gross_pay        IS DISTINCT FROM OLD.gross_pay
      OR NEW.net_pay          IS DISTINCT FROM OLD.net_pay
      OR NEW.base_pay         IS DISTINCT FROM OLD.base_pay
      OR NEW.overtime_pay     IS DISTINCT FROM OLD.overtime_pay
      OR NEW.regular_hours    IS DISTINCT FROM OLD.regular_hours
      OR NEW.overtime_hours   IS DISTINCT FROM OLD.overtime_hours
      OR NEW.wage_snapshot    IS DISTINCT FROM OLD.wage_snapshot
      OR NEW.breakdown        IS DISTINCT FROM OLD.breakdown ) THEN
      RAISE EXCEPTION '確定済み給与明細の内容は変更できません (payslip %)', OLD.id;
    END IF;
    -- status は confirmed→published のみ許可（戻し不可）
    IF (NEW.status = 'draft') THEN
      RAISE EXCEPTION '確定済み給与明細を draft に戻すことはできません';
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payslips_immutable_guard ON payslips;
CREATE TRIGGER payslips_immutable_guard
  BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_guard_immutable();

-- updated_at 自動更新（wage_settings）
CREATE OR REPLACE FUNCTION wage_settings_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS wage_settings_touch_trg ON wage_settings;
CREATE TRIGGER wage_settings_touch_trg
  BEFORE UPDATE ON wage_settings
  FOR EACH ROW EXECUTE FUNCTION wage_settings_touch();

-- ── 5. RLS ────────────────────────────────────────────────────────
ALTER TABLE wage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips      ENABLE ROW LEVEL SECURITY;

-- wage_settings: admin/staff は自社全件。worker は閲覧のみ自分。
DROP POLICY IF EXISTS "wage_admin_all"   ON wage_settings;
DROP POLICY IF EXISTS "wage_worker_read" ON wage_settings;
CREATE POLICY "wage_admin_all" ON wage_settings
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "wage_worker_read" ON wage_settings
  FOR SELECT USING (worker_id = my_worker_id());

-- payslips: admin/staff は自社全件。worker は published のみ自分。
DROP POLICY IF EXISTS "payslip_admin_all"   ON payslips;
DROP POLICY IF EXISTS "payslip_worker_read" ON payslips;
CREATE POLICY "payslip_admin_all" ON payslips
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "payslip_worker_read" ON payslips
  FOR SELECT USING (worker_id = my_worker_id() AND status = 'published');

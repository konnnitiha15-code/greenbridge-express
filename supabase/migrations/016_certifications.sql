-- ============================================================
-- GreenBridge — Migration 016: 健康診断・資格管理（Phase6）
-- worker_certifications: 健康診断・技能講習・各種資格を1テーブルで管理。
--   cert_type: 'health_check'(健康診断) / 'full_harness'(フルハーネス) /
--              'sling'(玉掛け) / 'forklift'(フォークリフト) /
--              'skill_training'(技能講習) / 'other'(その他)
--   有効期限のあるものは expire_date で期限管理（在留管理と同じ仕組みで通知）。
-- ============================================================

CREATE TABLE IF NOT EXISTS worker_certifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id   UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  cert_type   TEXT NOT NULL DEFAULT 'other',
  name        TEXT NOT NULL,                   -- 資格・講習の名称（自由記述）
  issued_date DATE,                            -- 取得日 / 受診日
  expire_date DATE,                            -- 有効期限（無期限なら NULL）
  issuer      TEXT,                            -- 発行機関 / 受診機関
  cert_no     TEXT,                            -- 修了証番号等
  result      TEXT,                            -- 健康診断の所見など（任意）
  note        TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_cert_worker_idx  ON worker_certifications (worker_id, expire_date);
CREATE INDEX IF NOT EXISTS worker_cert_company_idx ON worker_certifications (company_id, cert_type);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION worker_cert_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS worker_cert_touch_trg ON worker_certifications;
CREATE TRIGGER worker_cert_touch_trg BEFORE UPDATE ON worker_certifications
  FOR EACH ROW EXECUTE FUNCTION worker_cert_touch();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE worker_certifications ENABLE ROW LEVEL SECURITY;

-- admin/staff は自社全件。worker は自分の資格を閲覧。
DROP POLICY IF EXISTS "cert_admin_all"   ON worker_certifications;
DROP POLICY IF EXISTS "cert_worker_read" ON worker_certifications;
CREATE POLICY "cert_admin_all" ON worker_certifications
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "cert_worker_read" ON worker_certifications
  FOR SELECT USING (company_id = my_company_id() AND worker_id = my_worker_id());

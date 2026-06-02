-- ============================================================
-- GreenBridge — Migration 019: 外国人雇用書類管理（Phase9）
-- employment_filings: 在留資格に応じて入管・行政へ提出義務のある定型届出を管理。
--   visa_category: technical_intern(技能実習) / specified_skilled(特定技能) /
--                  engineer(技人国) / common(共通) / other(その他)
--   提出期限(due_date)・提出履歴(submitted_*)・繰り返し(recurrence)を管理。
--   実ファイルは既存「書類管理(documents)」へ。本テーブルは整理番号+メモのみ。
--   管理者(admin/staff)のみ利用。
-- ============================================================

CREATE TABLE IF NOT EXISTS employment_filings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id     UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  visa_category TEXT NOT NULL DEFAULT 'other',   -- technical_intern/specified_skilled/engineer/common/other
  filing_type   TEXT NOT NULL,                   -- 届出名
  title         TEXT NOT NULL,                   -- 表示名（既定=filing_type）
  status        TEXT NOT NULL DEFAULT 'pending', -- pending(未提出)/submitted(提出済)/not_required(対象外)
  due_date      DATE,                            -- 提出期限
  submitted_date DATE,                           -- 提出日
  submitted_to  TEXT,                            -- 提出先（出入国在留管理庁/OTIT/ハローワーク 等）
  reference_no  TEXT,                            -- 整理番号・受付番号
  recurrence    TEXT NOT NULL DEFAULT 'none',    -- none/quarterly/yearly
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emp_filing_company_idx ON employment_filings (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS emp_filing_worker_idx  ON employment_filings (worker_id);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION employment_filing_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS emp_filing_touch_trg ON employment_filings;
CREATE TRIGGER emp_filing_touch_trg BEFORE UPDATE ON employment_filings
  FOR EACH ROW EXECUTE FUNCTION employment_filing_touch();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE employment_filings ENABLE ROW LEVEL SECURITY;

-- admin/staff は自社分のみ全操作可。ワーカーはアクセス不可。
DROP POLICY IF EXISTS "emp_filing_admin_all" ON employment_filings;
CREATE POLICY "emp_filing_admin_all" ON employment_filings
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));

-- ============================================================
-- GreenBridge — Migration 015: 年次有給休暇 管理（Phase5）
-- ・leave_ledger     付与・消化・調整・失効の台帳（残数はこの集計で算出）
-- ・leave_requests   ワーカーの有給申請（pending/approved/rejected/cancelled）
-- 残数 = SUM(grant + adjust - use - expire)。台帳に履歴を残す方式（給与payslip同様）。
-- ============================================================

-- ── 1. 有給台帳 ───────────────────────────────────────────────
--   entry_type: 'grant'(付与) / 'use'(消化) / 'adjust'(手動調整) / 'expire'(失効)
--   days は付与・調整は正、消化・失効は正の数（符号は entry_type で解釈）
CREATE TABLE IF NOT EXISTS leave_ledger (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id   UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  entry_type  TEXT NOT NULL CHECK (entry_type IN ('grant','use','adjust','expire')),
  days        NUMERIC NOT NULL,                 -- 0.5単位対応（半休）
  effective_date DATE NOT NULL,                 -- 付与日 / 取得日
  expire_date    DATE,                          -- 付与分の失効期限（付与から2年）
  note        TEXT,
  request_id  UUID,                             -- 消化が申請由来の場合に紐付け（leave_requests.id）
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_ledger_worker_idx ON leave_ledger (worker_id, effective_date);
CREATE INDEX IF NOT EXISTS leave_ledger_company_idx ON leave_ledger (company_id);

-- ── 2. 有給申請 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  worker_id   UUID NOT NULL REFERENCES workers(id)   ON DELETE CASCADE,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  days        NUMERIC NOT NULL DEFAULT 1,        -- 申請日数（半休=0.5）
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_requests_worker_idx  ON leave_requests (worker_id, created_at);
CREATE INDEX IF NOT EXISTS leave_requests_company_idx ON leave_requests (company_id, status);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE leave_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- 台帳: admin/staff は自社全件。worker は自分の分を閲覧。
DROP POLICY IF EXISTS "ledger_admin_all"   ON leave_ledger;
DROP POLICY IF EXISTS "ledger_worker_read" ON leave_ledger;
CREATE POLICY "ledger_admin_all" ON leave_ledger
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "ledger_worker_read" ON leave_ledger
  FOR SELECT USING (company_id = my_company_id() AND worker_id = my_worker_id());

-- 申請: admin/staff は自社全件。worker は自分の申請を CRUD（閲覧・作成・取消）。
DROP POLICY IF EXISTS "lreq_admin_all"    ON leave_requests;
DROP POLICY IF EXISTS "lreq_worker_read"  ON leave_requests;
DROP POLICY IF EXISTS "lreq_worker_write" ON leave_requests;
CREATE POLICY "lreq_admin_all" ON leave_requests
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "lreq_worker_read" ON leave_requests
  FOR SELECT USING (company_id = my_company_id() AND worker_id = my_worker_id());
CREATE POLICY "lreq_worker_write" ON leave_requests
  FOR INSERT WITH CHECK (company_id = my_company_id() AND worker_id = my_worker_id());

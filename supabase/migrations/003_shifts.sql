-- ============================================================
-- GreenBridge — Migration 003: shifts + shift_requests RLS
-- ============================================================

-- ── 1. shifts テーブル ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  worker_id   UUID        NOT NULL REFERENCES workers(id)    ON DELETE CASCADE,
  date        DATE        NOT NULL,
  shift_type  TEXT        NOT NULL,   -- 'niku' | 'hayaban' | 'osoi' | 'rest'
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (worker_id, date)
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_shifts"       ON shifts;
DROP POLICY IF EXISTS "worker_read_own_shifts" ON shifts;

-- admin/staff: 会社全員を管理可能
CREATE POLICY "admin_all_shifts" ON shifts
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分のシフトのみ閲覧
CREATE POLICY "worker_read_own_shifts" ON shifts
  FOR SELECT USING (worker_id = my_worker_id());

-- ── 2. shift_requests テーブル ────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_requests (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  worker_id   UUID        NOT NULL REFERENCES workers(id)    ON DELETE CASCADE,
  date        DATE        NOT NULL,
  shift_type  TEXT        NOT NULL,
  note        TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shift_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_shift_requests"       ON shift_requests;
DROP POLICY IF EXISTS "worker_own_shift_requests"      ON shift_requests;

CREATE POLICY "admin_all_shift_requests" ON shift_requests
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分の申請を閲覧・作成
CREATE POLICY "worker_own_shift_requests" ON shift_requests
  FOR SELECT USING (worker_id = my_worker_id());

CREATE POLICY "worker_insert_shift_request" ON shift_requests
  FOR INSERT WITH CHECK (
    worker_id  = my_worker_id()
    AND company_id = my_company_id()
  );

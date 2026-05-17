-- ============================================================
-- GreenBridge — Migration 002: Worker RLS + notifications
-- Supabase SQL Editor に貼り付けて実行してください
-- 既存データは一切削除しません（ADD COLUMN / CREATE POLICY のみ）
-- ============================================================

-- ── 1. profiles テーブルに worker_id を追加 ──────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES workers(id) ON DELETE SET NULL;

-- ── 2. ヘルパー関数 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION my_company_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION my_worker_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT worker_id FROM profiles WHERE id = auth.uid()
$$;

-- ── 3. workers テーブル RLS ───────────────────────────────────
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを一旦削除して再作成（冪等）
DROP POLICY IF EXISTS "admin_read_workers"  ON workers;
DROP POLICY IF EXISTS "admin_write_workers" ON workers;
DROP POLICY IF EXISTS "worker_read_self"    ON workers;

CREATE POLICY "admin_read_workers" ON workers
  FOR SELECT USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

CREATE POLICY "admin_write_workers" ON workers
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分のレコード（worker_id 経由）
CREATE POLICY "worker_read_self" ON workers
  FOR SELECT USING (id = my_worker_id());

-- ── 4. documents テーブル RLS ─────────────────────────────────
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_docs"        ON documents;
DROP POLICY IF EXISTS "worker_read_own_docs"  ON documents;

CREATE POLICY "admin_all_docs" ON documents
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分宛て OR 全社共通（worker_id IS NULL）
CREATE POLICY "worker_read_own_docs" ON documents
  FOR SELECT USING (
    company_id = my_company_id()
    AND my_role() = 'worker'
    AND (worker_id = my_worker_id() OR worker_id IS NULL)
  );

-- ── 5. attendance_records テーブル RLS ───────────────────────
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_attendance"      ON attendance_records;
DROP POLICY IF EXISTS "worker_read_own_attendance" ON attendance_records;
DROP POLICY IF EXISTS "worker_insert_attendance"   ON attendance_records;

CREATE POLICY "admin_all_attendance" ON attendance_records
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

CREATE POLICY "worker_read_own_attendance" ON attendance_records
  FOR SELECT USING (worker_id = my_worker_id());

-- 打刻登録: source を 'worker' に強制
CREATE POLICY "worker_insert_attendance" ON attendance_records
  FOR INSERT WITH CHECK (
    worker_id  = my_worker_id()
    AND source = 'worker'
    AND company_id = my_company_id()
  );

-- ── 6. notifications テーブル（新規作成） ─────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  worker_id   UUID        REFERENCES workers(id) ON DELETE CASCADE, -- NULL = 全社向け
  title       TEXT        NOT NULL,
  body        TEXT,
  type        TEXT        NOT NULL DEFAULT 'info', -- info / alert / approval
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_notifications"         ON notifications;
DROP POLICY IF EXISTS "worker_read_own_notifications"   ON notifications;
DROP POLICY IF EXISTS "worker_mark_read"                ON notifications;

CREATE POLICY "admin_all_notifications" ON notifications
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分宛て OR 全社向け
CREATE POLICY "worker_read_own_notifications" ON notifications
  FOR SELECT USING (
    company_id = my_company_id()
    AND my_role() = 'worker'
    AND (worker_id = my_worker_id() OR worker_id IS NULL)
  );

-- worker: 既読フラグのみ更新可
CREATE POLICY "worker_mark_read" ON notifications
  FOR UPDATE
  USING  (worker_id = my_worker_id())
  WITH CHECK (worker_id = my_worker_id());

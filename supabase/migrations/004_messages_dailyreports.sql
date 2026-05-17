-- ============================================================
-- GreenBridge — Migration 004: messages + daily_reports
-- ============================================================

-- ── 1. messages テーブル（チャット） ──────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID        REFERENCES auth.users(id),          -- NULL = グループ/全体
  worker_id   UUID        REFERENCES workers(id),             -- worker 側ユーザーが関連する場合
  body        TEXT        NOT NULL,
  translated  TEXT,                                           -- AI翻訳後テキスト
  is_read     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_messages"        ON messages;
DROP POLICY IF EXISTS "worker_own_messages_read"  ON messages;
DROP POLICY IF EXISTS "worker_send_message"       ON messages;

-- admin/staff: 会社内全メッセージを閲覧・送信
CREATE POLICY "admin_all_messages" ON messages
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分が送受信したメッセージのみ
CREATE POLICY "worker_own_messages_read" ON messages
  FOR SELECT USING (
    my_role() = 'worker'
    AND company_id = my_company_id()
    AND (sender_id = auth.uid() OR receiver_id = auth.uid())
  );

CREATE POLICY "worker_send_message" ON messages
  FOR INSERT WITH CHECK (
    my_role() = 'worker'
    AND sender_id = auth.uid()
    AND company_id = my_company_id()
  );

-- ── 2. daily_reports テーブル（日報） ─────────────────────────
CREATE TABLE IF NOT EXISTS daily_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  worker_id   UUID        NOT NULL REFERENCES workers(id)    ON DELETE CASCADE,
  report_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  type        TEXT        NOT NULL DEFAULT 'daily',  -- daily / hayari
  content     TEXT        NOT NULL,                  -- 原文（母国語）
  translated  TEXT,                                  -- AI翻訳（日本語）
  status      TEXT        NOT NULL DEFAULT 'pending', -- pending / reviewed / approved
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_daily_reports"  ON daily_reports;
DROP POLICY IF EXISTS "worker_own_daily_reports" ON daily_reports;
DROP POLICY IF EXISTS "worker_insert_daily_report" ON daily_reports;

-- admin/staff: 会社内全日報
CREATE POLICY "admin_all_daily_reports" ON daily_reports
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

-- worker: 自分の日報のみ閲覧・作成
CREATE POLICY "worker_own_daily_reports" ON daily_reports
  FOR SELECT USING (
    worker_id = my_worker_id()
    AND company_id = my_company_id()
  );

CREATE POLICY "worker_insert_daily_report" ON daily_reports
  FOR INSERT WITH CHECK (
    worker_id  = my_worker_id()
    AND company_id = my_company_id()
  );

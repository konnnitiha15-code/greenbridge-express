-- ============================================================
-- GreenBridge — Migration 012: 日報・報告の強化
-- ・daily_reports に 現場名/作業内容/添付/レビュー情報 を追加
-- ・report_comments      管理者コメント（履歴保存）
-- ・report_status_history 承認ステータス変更履歴
-- status の値: 'pending'(確認待ち) / 'reviewed'(確認済み) / 'returned'(差戻し)
-- ============================================================

-- ── daily_reports 拡張 ────────────────────────────────────────
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS site_name    TEXT,
  ADD COLUMN IF NOT EXISTS work_content TEXT,
  ADD COLUMN IF NOT EXISTS attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{url,path,type,name,size}]
  ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by  UUID;

-- ── report_comments: 管理者コメント ──────────────────────────
CREATE TABLE IF NOT EXISTS report_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id   UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  author_id   UUID,                       -- auth.users.id（管理者/スタッフ）
  author_name TEXT,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_comments_report_idx
  ON report_comments (report_id, created_at);

-- ── report_status_history: 承認履歴 ──────────────────────────
CREATE TABLE IF NOT EXISTS report_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_id   UUID NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  actor_id    UUID,
  actor_name  TEXT,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_status_history_report_idx
  ON report_status_history (report_id, created_at);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE report_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_status_history ENABLE ROW LEVEL SECURITY;

-- admin/staff は自社全件。worker は自分の日報に紐づくものを閲覧可。
DROP POLICY IF EXISTS "rc_admin_all"   ON report_comments;
DROP POLICY IF EXISTS "rc_worker_read" ON report_comments;
CREATE POLICY "rc_admin_all" ON report_comments
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "rc_worker_read" ON report_comments
  FOR SELECT USING (
    company_id = my_company_id()
    AND report_id IN (SELECT id FROM daily_reports WHERE worker_id = my_worker_id())
  );

DROP POLICY IF EXISTS "rsh_admin_all"   ON report_status_history;
DROP POLICY IF EXISTS "rsh_worker_read" ON report_status_history;
CREATE POLICY "rsh_admin_all" ON report_status_history
  FOR ALL USING (company_id = my_company_id() AND my_role() IN ('admin','staff'));
CREATE POLICY "rsh_worker_read" ON report_status_history
  FOR SELECT USING (
    company_id = my_company_id()
    AND report_id IN (SELECT id FROM daily_reports WHERE worker_id = my_worker_id())
  );

-- 既存 'reviewed' を保持しつつ、今後は pending/reviewed/returned を使う（status は TEXT 制約なし）

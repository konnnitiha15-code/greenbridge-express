-- ============================================================
-- GreenBridge — Migration 005: groups + group_members + group_messages
-- グループチャット機能のDB化
-- ============================================================

-- ── 1. groups テーブル ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  icon        TEXT,                                          -- 絵文字（例: 👥, 🇻🇳）
  bg_color    TEXT,                                          -- 背景色（例: #e0e7ff）
  description TEXT,
  created_by  UUID        REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_company ON groups(company_id);

-- ── 2. group_members テーブル ─────────────────────────────────
CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

-- ── 3. group_messages テーブル ────────────────────────────────
CREATE TABLE IF NOT EXISTS group_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES auth.users(id),
  body        TEXT        NOT NULL,
  translated  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at);

-- ── 4. RLS ────────────────────────────────────────────────────
ALTER TABLE groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages  ENABLE ROW LEVEL SECURITY;

-- groups
DROP POLICY IF EXISTS "admin_all_groups"         ON groups;
DROP POLICY IF EXISTS "worker_read_groups"       ON groups;

CREATE POLICY "admin_all_groups" ON groups
  FOR ALL USING (
    company_id = my_company_id()
    AND my_role() IN ('admin', 'staff')
  );

CREATE POLICY "worker_read_groups" ON groups
  FOR SELECT USING (
    my_role() = 'worker'
    AND company_id = my_company_id()
    AND id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

-- group_members
DROP POLICY IF EXISTS "admin_all_members"   ON group_members;
DROP POLICY IF EXISTS "worker_read_members" ON group_members;

CREATE POLICY "admin_all_members" ON group_members
  FOR ALL USING (
    my_role() IN ('admin', 'staff')
    AND group_id IN (SELECT id FROM groups WHERE company_id = my_company_id())
  );

CREATE POLICY "worker_read_members" ON group_members
  FOR SELECT USING (
    my_role() = 'worker'
    AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

-- group_messages
DROP POLICY IF EXISTS "admin_all_group_messages"     ON group_messages;
DROP POLICY IF EXISTS "member_read_group_messages"   ON group_messages;
DROP POLICY IF EXISTS "member_send_group_messages"   ON group_messages;

CREATE POLICY "admin_all_group_messages" ON group_messages
  FOR ALL USING (
    my_role() IN ('admin', 'staff')
    AND group_id IN (SELECT id FROM groups WHERE company_id = my_company_id())
  );

CREATE POLICY "member_read_group_messages" ON group_messages
  FOR SELECT USING (
    group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

CREATE POLICY "member_send_group_messages" ON group_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND group_id IN (SELECT group_id FROM group_members WHERE user_id = auth.uid())
  );

-- ── 5. updated_at trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_groups()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups;
CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_groups();

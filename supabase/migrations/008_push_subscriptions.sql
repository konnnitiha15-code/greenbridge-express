-- ============================================================
-- GreenBridge — Migration 008: Web Push Subscriptions
-- ブラウザの PushSubscription をユーザーごとに保存
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  worker_id   UUID REFERENCES workers(id) ON DELETE SET NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'worker')),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
  ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_company_role_idx
  ON push_subscriptions (company_id, role);
CREATE INDEX IF NOT EXISTS push_subscriptions_worker_idx
  ON push_subscriptions (worker_id);

-- updated_at 自動更新トリガ
CREATE OR REPLACE FUNCTION push_subscriptions_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS push_subscriptions_touch ON push_subscriptions;
CREATE TRIGGER push_subscriptions_touch
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION push_subscriptions_touch_updated_at();

-- RLS（基本的にはサービスロールから操作するが念のため）
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_self_read"   ON push_subscriptions;
DROP POLICY IF EXISTS "push_self_write"  ON push_subscriptions;
DROP POLICY IF EXISTS "push_self_delete" ON push_subscriptions;

-- 本人のサブスクリプションのみ読み書き可
CREATE POLICY "push_self_read" ON push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "push_self_write" ON push_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "push_self_delete" ON push_subscriptions
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- GreenBridge — Migration 007: Realtime 有効化
-- Supabase Realtime でテーブル変更を即時配信
-- ============================================================

-- supabase_realtime publication に対象テーブルを追加
-- すでに追加済みの場合はエラーが出るので IF NOT EXISTS のような構文を使う

DO $$
BEGIN
  -- messages（個別チャット）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- group_messages（グループチャット）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE group_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- shifts（シフト）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE shifts;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- notifications（通知）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- attendance_records（勤怠）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance_records;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- daily_reports（日報）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE daily_reports;
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  -- shift_requests（シフト希望申請）
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE shift_requests;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- REPLICA IDENTITY FULL を設定（UPDATE/DELETE時の旧値も配信に含める）
-- これにより既読状態の変更なども検知可能
ALTER TABLE messages          REPLICA IDENTITY FULL;
ALTER TABLE group_messages    REPLICA IDENTITY FULL;
ALTER TABLE shifts            REPLICA IDENTITY FULL;
ALTER TABLE notifications     REPLICA IDENTITY FULL;
ALTER TABLE attendance_records REPLICA IDENTITY FULL;
ALTER TABLE daily_reports     REPLICA IDENTITY FULL;
ALTER TABLE shift_requests    REPLICA IDENTITY FULL;

-- ============================================================
-- GreenBridge — Migration 009: チャットメッセージ添付ファイル対応
-- 既存 messages / group_messages に attachment_* カラムを追加
-- ============================================================

-- ── messages (個別チャット) ───────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_url   TEXT,
  ADD COLUMN IF NOT EXISTS attachment_path  TEXT,   -- Storage 内部パス（署名URL再発行用）
  ADD COLUMN IF NOT EXISTS attachment_type  TEXT,   -- 'image' | 'file' 等
  ADD COLUMN IF NOT EXISTS attachment_mime  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size  BIGINT;

-- body を NULLable に変更（画像のみの送信を許可）
ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;

-- ── group_messages (グループチャット) ─────────────────────────
ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS attachment_url   TEXT,
  ADD COLUMN IF NOT EXISTS attachment_path  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size  BIGINT;

ALTER TABLE group_messages ALTER COLUMN body DROP NOT NULL;

-- ── Storage バケット: チャット添付（既存 documents バケットでも良いが、
-- 業務書類と分離して権限管理を簡潔化）
-- バケット作成は SQL ではなく Dashboard / API で行う:
-- ・bucket name: chat-attachments
-- ・public: false（署名URL方式）
-- ・file size limit: 10MB
-- ・allowed mime types: image/*, application/pdf
--
-- 既存 storage.objects への RLS:
--   SELECT/INSERT: 認証ユーザーは自分のフォルダ {user_id}/* にのみ書き込み可
--   DELETE: 同上

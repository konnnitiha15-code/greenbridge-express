-- ============================================================
-- GreenBridge — Migration 006: Supabase Storage Bucket
-- 書類ファイル用バケットを作成
-- ============================================================

-- documents バケット作成（プライベート）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,                                                    -- public: false（署名URL使用）
  52428800,                                                 -- 50MB上限
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── RLS（storage.objects） ───────────────────────────────────
-- 注: 通常 service_role でアクセスするためRLSはスキップされるが、
--     ユーザーJWTで直接アクセスする場合に備えて最低限のポリシーを設定

DROP POLICY IF EXISTS "company_read_documents"  ON storage.objects;
DROP POLICY IF EXISTS "admin_write_documents"   ON storage.objects;

-- 自社のファイルのみ読み取り可能（フォルダ名 = company_id でscope）
CREATE POLICY "company_read_documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (
      -- フォルダ第1階層が my_company_id() と一致
      (string_to_array(name, '/'))[1] = my_company_id()::text
    )
  );

-- admin/staff のみアップロード・削除可能
CREATE POLICY "admin_write_documents" ON storage.objects
  FOR ALL USING (
    bucket_id = 'documents'
    AND my_role() IN ('admin', 'staff')
    AND (string_to_array(name, '/'))[1] = my_company_id()::text
  );

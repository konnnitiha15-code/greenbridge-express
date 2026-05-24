/**
 * GreenBridge — Supabase Storage バケット セットアップ
 * 実行: node scripts/setup-storage.js
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const BUCKET_NAME = 'documents'
const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]

async function main() {
  console.log('\n📦 Supabase Storage バケット セットアップ\n')

  // 既存バケット確認
  const { data: buckets, error: listErr } = await sb.storage.listBuckets()
  if (listErr) {
    console.error('❌ バケット一覧取得失敗:', listErr.message)
    process.exit(1)
  }

  const existing = buckets.find(b => b.id === BUCKET_NAME)
  if (existing) {
    console.log(`⏭  バケット "${BUCKET_NAME}" は既に存在します`)
    // 更新のみ
    const { error: updErr } = await sb.storage.updateBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800,
      allowedMimeTypes: ALLOWED_MIME,
    })
    if (updErr) console.warn('⚠ 設定更新失敗:', updErr.message)
    else console.log('✅ 設定を更新しました')
  } else {
    // 新規作成
    const { data, error } = await sb.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800,
      allowedMimeTypes: ALLOWED_MIME,
    })
    if (error) {
      console.error('❌ バケット作成失敗:', error.message)
      process.exit(1)
    }
    console.log(`✅ バケット "${BUCKET_NAME}" を作成しました`)
  }

  // 動作確認 — ダミーファイル upload → delete
  console.log('\n🧪 動作確認...')
  const testPath = `__test/${Date.now()}.txt`
  const testContent = Buffer.from('hello GreenBridge')

  const { error: upErr } = await sb.storage
    .from(BUCKET_NAME)
    .upload(testPath, testContent, { contentType: 'text/plain' })

  if (upErr) {
    console.error('❌ テストアップロード失敗:', upErr.message)
    process.exit(1)
  }
  console.log('  ✓ アップロード OK')

  const { data: signed } = await sb.storage
    .from(BUCKET_NAME)
    .createSignedUrl(testPath, 60)
  if (signed?.signedUrl) console.log('  ✓ 署名付きURL生成 OK')

  await sb.storage.from(BUCKET_NAME).remove([testPath])
  console.log('  ✓ 削除 OK')

  console.log('\n🎉 Storage セットアップ完了！\n')
}

main().catch(e => {
  console.error('❌', e.message)
  process.exit(1)
})

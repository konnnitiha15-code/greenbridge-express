const { createClient } = require('@supabase/supabase-js')

// 認証済みセッション付きクライアントを生成
function createSupabaseClient(accessToken, refreshToken) {
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  if (accessToken) {
    client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' })
  }
  return client
}

// RLS を無視するサービスクライアント（管理操作用）
function createServiceClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

module.exports = { createSupabaseClient, createServiceClient }

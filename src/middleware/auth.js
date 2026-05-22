const { createClient } = require('@supabase/supabase-js')
const SECURE     = !!(process.env.VERCEL || process.env.NODE_ENV === 'production')
const COOKIE_OPT = { httpOnly: true, sameSite: 'lax', secure: SECURE }

async function requireAuth(req, res, next) {
  const accessToken  = req.cookies['sb-access-token']
  const refreshToken = req.cookies['sb-refresh-token']

  if (!accessToken) return res.redirect('/login')

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const { data: { session }, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || '',
    })

    if (error || !session) {
      res.clearCookie('sb-access-token')
      res.clearCookie('sb-refresh-token')
      return res.redirect('/login')
    }

    // トークンが更新された場合はクッキーを更新
    if (session.access_token !== accessToken) {
      res.cookie('sb-access-token', session.access_token, { httpOnly: true, sameSite: 'lax' })
      res.cookie('sb-refresh-token', session.refresh_token, { httpOnly: true, sameSite: 'lax' })
    }

    req.user     = session.user
    req.supabase = supabase

    // プロフィール取得
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, role, company_id, worker_id')
      .eq('id', session.user.id)
      .single()

    req.profile = profile
    res.locals.user    = session.user
    res.locals.profile = profile

    next()
  } catch (e) {
    res.clearCookie('sb-access-token')
    res.clearCookie('sb-refresh-token')
    return res.redirect('/login')
  }
}

// ── ワーカー専用認証ミドルウェア ─────────────────────────────────────────────
// 管理者の sb-access-token とは別の Cookie（gb-worker-token）を使用
// → 同一ブラウザで管理者とワーカーを同時ログイン可能
async function requireWorkerAuth(req, res, next) {
  const accessToken  = req.cookies['gb-worker-token']
  const refreshToken = req.cookies['gb-worker-refresh']

  if (!accessToken) return res.redirect('/worker/login')

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const { data: { session }, error } = await supabase.auth.setSession({
      access_token:  accessToken,
      refresh_token: refreshToken || '',
    })

    if (error || !session) {
      res.clearCookie('gb-worker-token')
      res.clearCookie('gb-worker-refresh')
      return res.redirect('/worker/login')
    }

    // トークンが更新された場合はCookieを更新
    if (session.access_token !== accessToken) {
      res.cookie('gb-worker-token',   session.access_token,  COOKIE_OPT)
      res.cookie('gb-worker-refresh', session.refresh_token, COOKIE_OPT)
    }

    req.user     = session.user
    req.supabase = supabase

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, role, company_id, worker_id')
      .eq('id', session.user.id)
      .single()

    req.profile = profile
    res.locals.user    = session.user
    res.locals.profile = profile

    next()
  } catch {
    res.clearCookie('gb-worker-token')
    res.clearCookie('gb-worker-refresh')
    return res.redirect('/worker/login')
  }
}

module.exports = { requireAuth, requireWorkerAuth }

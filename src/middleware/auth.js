const { createClient } = require('@supabase/supabase-js')
const SECURE     = !!(process.env.VERCEL || process.env.NODE_ENV === 'production')
const COOKIE_OPT = { httpOnly: true, sameSite: 'lax', secure: SECURE }

// API/AJAX リクエスト判定: 失敗時は 302 redirect ではなく 401 JSON を返す
// （HTML を JSON.parse して "Unexpected token" になるのを防ぐ）
function isApiRequest(req) {
  if (req.path.startsWith('/api/') || req.path.includes('/api/')) return true
  const accept = req.headers.accept || ''
  if (accept.includes('application/json')) return true
  const xrw = req.headers['x-requested-with']
  if (xrw && xrw.toLowerCase() === 'xmlhttprequest') return true
  // fetch() による JSON body 送信
  const ct = req.headers['content-type'] || ''
  if (req.method !== 'GET' && ct.includes('application/json')) return true
  return false
}

function unauthorized(req, res, loginUrl, reason = 'no_session') {
  // 診断ログ: なぜ認証失敗したかを把握する
  // origin URL / method / path / Cookie の有無 を出力
  const cookieNames = Object.keys(req.cookies || {})
  console.warn('[auth] unauthorized', {
    method: req.method,
    path: req.originalUrl || req.path,
    reason,
    cookies: cookieNames,
    ua: (req.headers['user-agent'] || '').slice(0, 80),
    referer: req.headers.referer || null,
    origin:  req.headers.origin  || null,
  })
  if (isApiRequest(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized', code: 'AUTH_REQUIRED', reason })
  }
  return res.redirect(loginUrl)
}

async function requireAuth(req, res, next) {
  const accessToken  = req.cookies['sb-access-token']
  const refreshToken = req.cookies['sb-refresh-token']

  if (!accessToken) return unauthorized(req, res, '/login', 'no_cookie')

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
      return unauthorized(req, res, '/login', 'session_invalid:' + (error?.message || 'no_session'))
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
    return unauthorized(req, res, '/login', 'exception:' + (e?.message || 'unknown'))
  }
}

// ── ワーカー専用認証ミドルウェア ─────────────────────────────────────────────
// 管理者の sb-access-token とは別の Cookie（gb-worker-token）を使用
// → 同一ブラウザで管理者とワーカーを同時ログイン可能
async function requireWorkerAuth(req, res, next) {
  const accessToken  = req.cookies['gb-worker-token']
  const refreshToken = req.cookies['gb-worker-refresh']

  if (!accessToken) return unauthorized(req, res, '/worker/login', 'no_cookie')

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
      return unauthorized(req, res, '/worker/login', 'session_invalid:' + (error?.message || 'no_session'))
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
  } catch (e) {
    res.clearCookie('gb-worker-token')
    res.clearCookie('gb-worker-refresh')
    return unauthorized(req, res, '/worker/login', 'exception:' + (e?.message || 'unknown'))
  }
}

module.exports = { requireAuth, requireWorkerAuth }

const { createClient } = require('@supabase/supabase-js')

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

module.exports = { requireAuth }

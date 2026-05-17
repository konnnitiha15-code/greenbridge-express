const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const router = express.Router()

router.get('/login', async (req, res) => {
  const accessToken = req.cookies['sb-access-token']
  if (!accessToken) return res.render('auth/login', { title: 'ログイン' })

  // 既存トークンがある場合は role を確認してから振り分け
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    const { data: { user }, error } = await supabase.auth.getUser(accessToken)
    if (error || !user) return res.render('auth/login', { title: 'ログイン' })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    // admin/staff は /app へ
    if (profile?.role === 'admin' || profile?.role === 'staff') return res.redirect('/app')
    // worker セッションが残っている場合はクッキーをクリアしてログインフォームを表示
    res.clearCookie('sb-access-token')
    res.clearCookie('sb-refresh-token')
    return res.render('auth/login', { title: 'ログイン' })
  } catch {
    return res.render('auth/login', { title: 'ログイン' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    req.flash('error', 'メールアドレスまたはパスワードが正しくありません')
    return res.redirect('/login')
  }

  const { access_token, refresh_token } = data.session
  res.cookie('sb-access-token', access_token, { httpOnly: true, sameSite: 'lax' })
  res.cookie('sb-refresh-token', refresh_token, { httpOnly: true, sameSite: 'lax' })

  // role 確認は service_role キーで確実に取得
  const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: profile } = await sbAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.session.user.id)
    .single()

  // worker が admin ログインフォームから送信しても /worker に飛ばす
  const dest = profile?.role === 'worker' ? '/worker' : '/app'
  res.redirect(dest)
})

function logout(req, res) {
  res.clearCookie('sb-access-token')
  res.clearCookie('sb-refresh-token')
  res.redirect('/login')
}

router.get('/logout', logout)
router.post('/logout', logout)

module.exports = router

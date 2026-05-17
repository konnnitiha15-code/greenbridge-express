const express         = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireWorkerAuth } = require('../middleware/auth')
const { requireWorker } = require('../middleware/requireRole')
const router          = express.Router()

// ── Worker 専用ログイン ────────────────────────────────────────
// GET /worker/login
// worker session のみ許可。admin session があっても /app にはリダイレクトしない。
router.get('/login', async (req, res) => {
  const accessToken = req.cookies['gb-worker-token']
  if (!accessToken) return res.render('worker-login', { title: 'ログイン' })

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error } = await sb.auth.getUser(accessToken)

    // トークン無効 → Cookieを消してフォーム表示
    if (error || !user) {
      res.clearCookie('gb-worker-token')
      res.clearCookie('gb-worker-refresh')
      return res.render('worker-login', { title: 'ログイン' })
    }

    const { data: profile } = await sb
      .from('profiles').select('role').eq('id', user.id).single()

    // worker セッション有効 → /worker へ
    if (profile?.role === 'worker') return res.redirect('/worker')

    // worker 以外（admin等）の gb-worker-token は無効 → Cookieを消してフォーム表示
    res.clearCookie('gb-worker-token')
    res.clearCookie('gb-worker-refresh')
    return res.render('worker-login', { title: 'ログイン' })
  } catch {
    res.clearCookie('gb-worker-token')
    res.clearCookie('gb-worker-refresh')
    return res.render('worker-login', { title: 'ログイン' })
  }
})

// POST /worker/login — worker ロールのみ受け付ける
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)

  const { data, error } = await sb.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    req.flash('error', 'メールアドレスまたはパスワードが正しくありません')
    return res.redirect('/worker/login')
  }

  // role 確認
  const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: profile } = await sbAdmin
    .from('profiles').select('role').eq('id', data.session.user.id).single()

  // admin / staff は /worker/login から入れない → /login に誘導
  if (profile?.role !== 'worker') {
    req.flash('error', '管理者アカウントは /login からログインしてください')
    return res.redirect('/worker/login')
  }

  // worker のみ gb-worker-token を発行して /worker へ
  const { access_token, refresh_token } = data.session
  res.cookie('gb-worker-token',   access_token,  { httpOnly: true, sameSite: 'lax' })
  res.cookie('gb-worker-refresh', refresh_token, { httpOnly: true, sameSite: 'lax' })
  res.redirect('/worker')
})

// GET /worker/logout
router.get('/logout', (req, res) => {
  res.clearCookie('gb-worker-token')
  res.clearCookie('gb-worker-refresh')
  res.redirect('/worker/login')
})

const CAT_ICO = {
  contract:'📋', visa:'🪪', passport:'📘', insurance:'🏥',
  salary:'💴', safety:'📒', technical_intern:'🏭',
  specified_skilled:'⭐', tax:'🧾', other:'📄',
}
const CAT_BG = {
  contract:'#e6f9f0', visa:'#fefce8', passport:'#eff6ff', insurance:'#f0fdf4',
  salary:'#dbeafe', safety:'#f5f3ff', technical_intern:'#fce7f3',
  specified_skilled:'#fef3c7', tax:'#ecfdf5', other:'#f1f5f9',
}

function fmtDate(d) {
  if (!d) return null
  return String(d).replace(/-/g, '/').slice(0, 10)
}

// GET /worker  （requireWorkerAuth → requireWorker の二重ガード）
router.get('/', requireWorkerAuth, requireWorker, async (req, res) => {
  const companyId = req.profile?.company_id
  const workerId  = req.profile?.worker_id

  let workerInfo = {
    name:       req.profile?.full_name || '',
    jobTitle:   '',
    department: '',
    supervisor: '',
    entryDate:  null,
    language:   'vi',
  }
  let docs        = []
  let contacts    = []
  let companyName = 'GreenBridge'

  if (companyId) {
    try {
      const [docsRes, compRes, workerRes, contactsRes] = await Promise.all([
        // 自分宛て OR 全社共通書類
        req.supabase
          .from('documents')
          .select('id, name, category, created_at, expire_date, file_name, notes')
          .eq('company_id', companyId)
          .or(`worker_id.eq.${workerId},worker_id.is.null`)
          .order('created_at', { ascending: false }),

        req.supabase
          .from('companies')
          .select('name')
          .eq('id', companyId)
          .single(),

        // 自分の workers レコード
        workerId
          ? req.supabase
              .from('workers')
              .select('name, job_title, department, supervisor, entry_date, language')
              .eq('id', workerId)
              .single()
          : Promise.resolve({ data: null }),

        // 同じ会社の admin/staff（チャット相手候補）
        req.supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('company_id', companyId)
          .in('role', ['admin', 'staff'])
          .limit(20),
      ])

      companyName = compRes.data?.name || companyName

      // チャット相手候補（admin/staff）をマッピング
      const LANG_BG = { vi:['#d1fae5','#065f46'], id:['#dbeafe','#1e40af'], tl:['#fee2e2','#991b1b'], my:['#fef3c7','#92400e'], zh:['#fce7f3','#9d174d'], km:['#e0e7ff','#3730a3'], ja:['#f0fdf4','#14532d'] }
      contacts = (contactsRes.data || []).map(p => {
        const nm    = p.full_name || ''
        const parts = nm.trim().split(/\s+/)
        const init  = parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : nm.slice(0, 2).toUpperCase() || '?'
        const colors = LANG_BG['ja']
        return { id: p.id, name: nm, role: p.role === 'admin' ? '管理者' : 'スタッフ', dept: '', avBg: colors[0], avTc: colors[1], init, online: false }
      })

      if (workerRes.data) {
        const w = workerRes.data
        workerInfo.name       = w.name        || workerInfo.name
        workerInfo.jobTitle   = w.job_title   || ''
        workerInfo.department = w.department  || ''
        workerInfo.supervisor = w.supervisor  || ''
        workerInfo.entryDate  = w.entry_date  || null
        workerInfo.language   = w.language    || 'vi'
      }

      docs = (docsRes.data || []).map(d => ({
        id:         d.id,
        ico:        CAT_ICO[d.category] || '📄',
        icoBg:      CAT_BG[d.category]  || '#f1f5f9',
        category:   d.category || 'other',
        name:       d.name     || '',
        sub:        d.notes    || '',
        updated:    fmtDate((d.created_at || '').slice(0, 10)),
        expireDate: fmtDate(d.expire_date),
        fileName:   d.file_name || null,
        langs:      ['vi', 'id', 'tl', 'my'],
      }))

    } catch (e) {
      console.error('[worker-app] Supabase error:', e.message)
    }
  }

  // 管理者のauth user IDを取得（チャット送受信の宛先特定用）
  let adminUserId = null
  if (companyId) {
    try {
      const adminClient = createClient(
        process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { data: adminProfile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('company_id', companyId)
        .eq('role', 'admin')
        .maybeSingle()
      adminUserId = adminProfile?.id || null
    } catch {}
  }

  res.render('worker', {
    serverData: {
      worker:      workerInfo,
      workerId:    workerId  || null,
      docs,
      contacts,
      companyName,
      email:       req.user?.email || '',
      adminUserId,               // 管理者のauth user ID（チャット用）
      myUserId:    req.user?.id || null,  // 自分のauth user ID
    },
  })
})

// ── 打刻 API ────────────────────────────────────────────────────
// サーバーサイドで role 検証済みのため service_role で操作
const { createClient: _createAdmin } = require('@supabase/supabase-js')

function adminClient() {
  return _createAdmin(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// 日本時間の YYYY-MM-DD を返す
function todayJST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
}

// GET /worker/api/clock/today — 今日の打刻状況
router.get('/api/clock/today', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId = req.profile?.worker_id
  if (!workerId) return res.json({ ok: true, data: null, warn: 'worker_id未設定' })

  const { data, error } = await adminClient()
    .from('attendance_records')
    .select('id, clock_in, clock_out, status')
    .eq('worker_id', workerId)
    .eq('work_date', todayJST())
    .maybeSingle()

  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, data })
})

// POST /worker/api/clock — 出勤 or 退勤打刻
router.post('/api/clock', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id

  if (!workerId) {
    return res.json({ ok: false, error: '打刻にはアカウントと実習生情報の紐付けが必要です。管理者にお問い合わせください。' })
  }

  const { type } = req.body   // 'in' | 'out'
  if (type !== 'in' && type !== 'out') {
    return res.json({ ok: false, error: '不正なリクエストです' })
  }

  const sb    = adminClient()
  const today = todayJST()
  const now   = new Date().toISOString()

  // 今日のレコードを取得
  const { data: existing } = await sb
    .from('attendance_records')
    .select('id, clock_in, clock_out')
    .eq('worker_id', workerId)
    .eq('work_date', today)
    .maybeSingle()

  if (type === 'in') {
    if (existing?.clock_in) {
      return res.json({ ok: false, error: '既に出勤打刻済みです' })
    }
    const { error } = await sb.from('attendance_records').upsert({
      worker_id:  workerId,
      company_id: companyId,
      work_date:  today,
      clock_in:   now,
      status:     'present',
      source:     'worker',
      created_by: req.user.id,
      updated_at: now,
    }, { onConflict: 'worker_id,work_date' })

    if (error) return res.json({ ok: false, error: error.message })
    return res.json({ ok: true, time: now })
  }

  // type === 'out'
  if (!existing?.clock_in) {
    return res.json({ ok: false, error: '出勤打刻がありません' })
  }
  if (existing?.clock_out) {
    return res.json({ ok: false, error: '既に退勤打刻済みです' })
  }

  const { error } = await sb.from('attendance_records')
    .update({ clock_out: now, updated_at: now })
    .eq('id', existing.id)

  if (error) return res.json({ ok: false, error: error.message })
  res.json({ ok: true, time: now })
})

// ── シフト取得 API ──────────────────────────────────────────────
// GET /worker/api/shifts?year=2026&month=5
router.get('/api/shifts', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: true, shifts: [] })

  const year  = parseInt(req.query.year)  || new Date().getFullYear()
  const month = parseInt(req.query.month) || new Date().getMonth() + 1

  // 月の初日〜末日
  const from = `${year}-${String(month).padStart(2,'0')}-01`
  const to   = new Date(year, month, 0).toISOString().slice(0,10) // 末日

  const { data, error } = await adminClient()
    .from('shifts')
    .select('id, date, shift_type, note')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .gte('date', from)
    .lte('date', to)
    .order('date')

  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, shifts: data || [] })
})

// ── 日報 API ────────────────────────────────────────────────────
// GET /worker/api/daily-reports
router.get('/api/daily-reports', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: true, reports: [] })

  const { data, error } = await adminClient()
    .from('daily_reports')
    .select('id, report_date, type, content, translated, status, created_at')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, reports: data || [] })
})

// POST /worker/api/daily-reports
router.post('/api/daily-reports', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: false, error: 'worker_id未設定です' })

  const { type, content, translated } = req.body
  if (!content?.trim()) return res.json({ ok: false, error: '内容を入力してください' })

  const { data, error } = await adminClient()
    .from('daily_reports')
    .insert({
      company_id:  companyId,
      worker_id:   workerId,
      type:        type || 'daily',
      content:     content.trim(),
      translated:  translated || null,
      report_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
    })
    .select('id, report_date, type, status')
    .single()

  if (error) return res.json({ ok: false, error: error.message })
  res.json({ ok: true, report: data })
})

// ── メッセージ API ───────────────────────────────────────────────
// GET /worker/api/messages?after=<ISO>
router.get('/api/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  const companyId = req.profile?.company_id
  const userId    = req.user?.id
  const after     = req.query.after  // 未読チェック用タイムスタンプ

  let query = adminClient()
    .from('messages')
    .select('id, sender_id, receiver_id, body, translated, is_read, created_at')
    .eq('company_id', companyId)
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: true })
    .limit(100)

  if (after) query = query.gt('created_at', after)

  const { data, error } = await query
  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, messages: data || [] })
})

// POST /worker/api/messages
router.post('/api/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  const companyId = req.profile?.company_id
  const workerId  = req.profile?.worker_id
  const userId    = req.user?.id
  const { body, translated, receiver_id } = req.body

  if (!body?.trim()) return res.json({ ok: false, error: 'メッセージを入力してください' })

  const { data, error } = await adminClient()
    .from('messages')
    .insert({
      company_id:  companyId,
      sender_id:   userId,
      receiver_id: receiver_id || null,
      worker_id:   workerId || null,
      body:        body.trim(),
      translated:  translated || null,
    })
    .select('id, created_at')
    .single()

  if (error) return res.json({ ok: false, error: error.message })
  res.json({ ok: true, message: data })
})

// ── シフト申請 API ──────────────────────────────────────────────
// POST /worker/api/shift-requests
router.post('/api/shift-requests', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: false, error: 'worker_id未設定です' })

  const { date, shift_type, note } = req.body
  if (!date || !shift_type) return res.json({ ok: false, error: 'date と shift_type は必須です' })

  const { data, error } = await adminClient()
    .from('shift_requests')
    .insert({
      company_id: companyId,
      worker_id:  workerId,
      date,
      shift_type,
      note: note || null,
    })
    .select('id, status')
    .single()

  if (error) return res.json({ ok: false, error: error.message })
  res.json({ ok: true, request: data })
})

// GET /worker/api/shift-requests
router.get('/api/shift-requests', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: true, requests: [] })

  const { data, error } = await adminClient()
    .from('shift_requests')
    .select('id, date, shift_type, note, status, created_at')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true, requests: data || [] })
})

// ── SOS API ─────────────────────────────────────────────────────
// POST /worker/api/sos
router.post('/api/sos', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id

  const { error } = await adminClient()
    .from('notifications')
    .insert({
      company_id: companyId,
      worker_id:  workerId || null,
      title:      '【SOS緊急】実習生から緊急連絡',
      body:       `${req.profile?.full_name || '実習生'} から緊急連絡が届きました`,
      type:       'alert',
    })

  if (error) console.error('[SOS] notification error:', error.message)
  res.json({ ok: true })
})

// ── パスワード変更 API ──────────────────────────────────────────
router.post('/api/change-password', requireWorkerAuth, requireWorker, async (req, res) => {
  const { password, confirm } = req.body

  if (!password || password.length < 8) {
    return res.json({ ok: false, error: 'パスワードは8文字以上で入力してください' })
  }
  if (password !== confirm) {
    return res.json({ ok: false, error: 'パスワードが一致しません' })
  }

  const { error } = await req.supabase.auth.updateUser({ password })
  if (error) return res.json({ ok: false, error: error.message })

  res.json({ ok: true })
})

module.exports = router

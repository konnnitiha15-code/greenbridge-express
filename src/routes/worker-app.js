const express         = require('express')
const multer          = require('multer')
const path            = require('path')
const { createClient } = require('@supabase/supabase-js')
const SECURE     = !!(process.env.VERCEL || process.env.NODE_ENV === 'production')
const COOKIE_OPT = { httpOnly: true, sameSite: 'lax', secure: SECURE }
const { requireWorkerAuth } = require('../middleware/auth')
const { requireWorker } = require('../middleware/requireRole')
const push             = require('../lib/push')
const { translate }    = require('../lib/translation')
const router          = express.Router()

// チャット添付ファイル用 multer (メモリ保持で Supabase Storage に直接 upload)
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
})

// ── Worker 専用ログイン ────────────────────────────────────────
// GET /worker/login
// worker session のみ許可。admin session があっても /app にはリダイレクトしない。
router.get('/login', async (req, res) => {
  const accessToken = req.cookies['gb-worker-token']
  const errorMsg    = req.query.e ? decodeURIComponent(req.query.e) : null
  if (!accessToken) return res.render('worker-login', { title: 'ログイン', errorMsg })

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
    res.clearCookie('gb-worker-token', COOKIE_OPT)
    res.clearCookie('gb-worker-refresh', COOKIE_OPT)
    return res.render('worker-login', { title: 'ログイン', errorMsg })
  } catch {
    res.clearCookie('gb-worker-token', COOKIE_OPT)
    res.clearCookie('gb-worker-refresh', COOKIE_OPT)
    return res.render('worker-login', { title: 'ログイン', errorMsg })
  }
})

// POST /worker/login — worker ロールのみ受け付ける
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)

  const { data, error } = await sb.auth.signInWithPassword({ email, password })

  if (error || !data.session) {
    const msg = encodeURIComponent('メールアドレスまたはパスワードが正しくありません')
    return res.redirect(`/worker/login?e=${msg}`)
  }

  // role 確認
  const sbAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: profile } = await sbAdmin
    .from('profiles').select('role').eq('id', data.session.user.id).single()

  // admin / staff は /worker/login から入れない → /login に誘導
  if (profile?.role !== 'worker') {
    const msg = encodeURIComponent('管理者アカウントは /login からログインしてください')
    return res.redirect(`/worker/login?e=${msg}`)
  }

  // worker のみ gb-worker-token を発行して /worker へ
  const { access_token, refresh_token } = data.session
  res.cookie('gb-worker-token',   access_token,  COOKIE_OPT)
  res.cookie('gb-worker-refresh', refresh_token, COOKIE_OPT)
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
      // contacts は profiles テーブルから取得するが、RLS で worker は他人の profiles を見られない。
      // そのため service role の admin client を使う（同じ company_id 内のみ取得するので安全）。
      const sbAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const [docsRes, compRes, workerRes, contactsRes] = await Promise.all([
        // 自分宛て OR 全社共通書類
        req.supabase
          .from('documents')
          .select('id, name, category, created_at, expire_date, file_name, file_url, mime_type, file_size, notes')
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

        // 同じ会社の admin/staff（チャット相手候補）— service role で取得
        sbAdmin
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
        fileUrl:    d.file_url  || null,       // 添付ファイルURL（Storage署名URLまたはローカル）
        mimeType:   d.mime_type || null,
        fileSize:   d.file_size || null,
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
      // Realtime用（クライアント側Supabase初期化）
      supabaseUrl:     process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      accessToken:     req.cookies['gb-worker-token']   || null,
      refreshToken:    req.cookies['gb-worker-refresh'] || null,
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

  // 月の初日〜末日（toISOString() は UTC に変換されて1日ズレるため getDate() を使う）
  const lastDay = new Date(year, month, 0).getDate()
  const from = `${year}-${String(month).padStart(2,'0')}-01`
  const to   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`

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
// GET /worker/api/daily-reports?from=YYYY-MM-DD&to=YYYY-MM-DD&type=&limit=
//   期間で絞り込み可能。省略時は最新200件。
router.get('/api/daily-reports', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: true, reports: [] })

  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500)
  let q = adminClient()
    .from('daily_reports')
    .select('id, report_date, type, content, translated, status, created_at')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (req.query.from) q = q.gte('report_date', req.query.from)
  if (req.query.to)   q = q.lte('report_date', req.query.to)
  if (req.query.type) q = q.eq('type', req.query.type)

  const { data, error } = await q
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

  const sb = adminClient()
  const { data, error } = await sb
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

  // 管理者向け通知（worker_id=NULL で全admin宛て）
  try {
    const { data: w } = await sb.from('workers').select('name').eq('id', workerId).maybeSingle()
    const notif = {
      company_id: companyId,
      worker_id:  null,
      title:      type === 'hayari' ? '🚨 ヒヤリ・ハット報告' : '📝 日報が届きました',
      body:       `${w?.name || 'ワーカー'}：${(translated || content).slice(0, 60)}${(translated || content).length > 60 ? '…' : ''}`,
      type:       type === 'hayari' ? 'alert' : 'info',
    }
    await sb.from('notifications').insert(notif)
    push.sendFromNotification({ ...notif, url: '/app#daily' }).catch(()=>{})
  } catch {}

  res.json({ ok: true, report: data })
})

// ── 通知 API（ワーカー側） ───────────────────────────────────
// GET /worker/api/notifications — 自分宛て通知（ワーカー言語に翻訳して返す）
router.get('/api/notifications', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  const sb = adminClient()

  // worker_id が自分または NULL（全社向け）
  const { data, error } = await sb
    .from('notifications')
    .select('id, title, body, type, is_read, created_at, worker_id')
    .eq('company_id', companyId)
    .or(workerId ? `worker_id.eq.${workerId},worker_id.is.null` : 'worker_id.is.null')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ ok: false, error: error.message })

  let notifications = data || []

  // ── ワーカー言語へ翻訳（通知は管理者が日本語で作成する前提）──────────────
  //   会社辞書→業界辞書→cache→API の優先順位で翻訳。失敗時は原文のまま。
  //   絵文字や記号だけの語は translationService 側で原文返しになる。
  // 言語は ?lang= を最優先（アプリ上で切替中の言語）、無ければ workers.language
  const LANG_WHITELIST = ['ja', 'vi', 'id', 'tl', 'zh', 'my', 'en', 'km']
  let lang = LANG_WHITELIST.includes(req.query.lang) ? req.query.lang : null
  if (!lang && workerId) {
    try {
      const { data: w } = await sb.from('workers').select('language').eq('id', workerId).maybeSingle()
      if (w?.language) lang = w.language
    } catch {}
  }
  if (!lang) lang = 'vi'
  if (lang && lang !== 'ja' && notifications.length) {
    notifications = await Promise.all(notifications.map(async n => {
      const out = { ...n }
      try {
        if (n.title) {
          const r = await translate(n.title, 'ja', lang, { companyId })
          out.title_tl = r?.translated || n.title
        }
        if (n.body) {
          const r = await translate(n.body, 'ja', lang, { companyId })
          out.body_tl = r?.translated || n.body
        }
      } catch { /* 失敗時は原文（title_tl/body_tl 無し）*/ }
      return out
    }))
  }

  res.json({ ok: true, notifications, lang })
})

// PUT /worker/api/notifications/:id/read
router.put('/api/notifications/:id/read', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId = req.profile?.worker_id
  const sb = adminClient()
  const { error } = await sb.from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .or(workerId ? `worker_id.eq.${workerId},worker_id.is.null` : 'worker_id.is.null')
  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true })
})

// ── メッセージ API ───────────────────────────────────────────────
// POST /worker/api/messages/read — 自分宛てのメッセージを既読にマーク
router.post('/api/messages/read', requireWorkerAuth, requireWorker, async (req, res) => {
  const userId = req.user?.id
  const { sender_id } = req.body  // 特定相手からのものだけ既読 (任意)

  const sb = adminClient()
  let q = sb.from('messages').update({ is_read: true }).eq('receiver_id', userId).eq('is_read', false)
  if (sender_id) q = q.eq('sender_id', sender_id)

  const { error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true })
})

// GET /worker/api/messages?after=<ISO>
router.get('/api/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const userId    = req.user?.id
    const after     = req.query.after

    const sb = adminClient()
    const fullCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at, attachment_url, attachment_path, attachment_type, attachment_mime, attachment_name, attachment_size'
    const baseCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at'

    const baseQ = (cols) => {
      let q = sb.from('messages').select(cols)
        .eq('company_id', companyId)
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: true })
        .limit(100)
      if (after) q = q.gt('created_at', after)
      return q
    }

    let { data, error } = await baseQ(fullCols)
    if (error && /column .* does not exist|attachment_/i.test(error.message || '')) {
      ;({ data, error } = await baseQ(baseCols))
    }
    if (error) return res.status(500).json({ ok: false, error: error.message })

    res.json({ ok: true, messages: data || [] })
  } catch (e) {
    console.error('[/worker/api/messages] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /worker/api/messages
router.post('/api/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId  = req.profile?.worker_id
    const userId    = req.user?.id
    const {
      body, translated, receiver_id,
      attachment_url, attachment_path, attachment_type, attachment_mime, attachment_name, attachment_size,
    } = req.body

    const hasBody       = body && body.trim().length > 0
    const hasAttachment = !!attachment_path
    if (!hasBody && !hasAttachment) {
      return res.json({ ok: false, error: 'メッセージまたは添付ファイルが必要です' })
    }

    // 基本フィールド
    const row = {
      company_id:  companyId,
      sender_id:   userId,
      receiver_id: receiver_id || null,
      worker_id:   workerId || null,
      body:        hasBody ? body.trim() : '',  // body NOT NULL の旧スキーマ互換のため空文字
      translated:  translated || null,
    }
    // ★ 添付付きの場合のみ attachment_* カラムを含める
    //   (migration 009 未実行時に「カラム存在しない」エラーを避けるため)
    if (hasAttachment) {
      row.attachment_url   = attachment_url   || null
      row.attachment_path  = attachment_path  || null
      row.attachment_type  = attachment_type  || null
      row.attachment_mime  = attachment_mime  || null
      row.attachment_name  = attachment_name  || null
      row.attachment_size  = attachment_size  || null
    }

    let { data, error } = await adminClient()
      .from('messages')
      .insert(row)
      .select('id, created_at')
      .single()

    // 添付カラム存在しない（migration 009 未実行）→ 添付を除いて再試行
    if (error && hasAttachment && /column .* does not exist|attachment_/i.test(error.message || '')) {
      const fallback = {
        company_id: row.company_id, sender_id: row.sender_id, receiver_id: row.receiver_id,
        worker_id: row.worker_id, body: row.body || '[画像]', translated: row.translated,
      }
      ;({ data, error } = await adminClient().from('messages').insert(fallback).select('id, created_at').single())
    }

    if (error) return res.json({ ok: false, error: error.message })
    res.json({ ok: true, message: data })
  } catch (e) {
    console.error('[POST /worker/api/messages] exception:', e.message)
    res.json({ ok: false, error: e.message })
  }
})

// POST /worker/api/chat/upload — チャット用画像/ファイルアップロード
// 戻り値: { ok, attachment: { url, path, type, mime, name, size } }
router.post('/api/chat/upload', requireWorkerAuth, requireWorker, chatUpload.single('file'), async (req, res) => {
  const companyId = req.profile?.company_id
  const userId    = req.user?.id
  if (!req.file) return res.status(400).json({ ok: false, error: 'file is required' })

  const mime = req.file.mimetype || 'application/octet-stream'
  const isImage = mime.startsWith('image/')
  const ext     = path.extname(req.file.originalname || '').toLowerCase() || (isImage ? '.jpg' : '.bin')
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`
  const storagePath = `chat/${companyId}/${userId}/${safeName}`

  try {
    const sb = adminClient()
    const { error: upErr } = await sb.storage
      .from('documents')
      .upload(storagePath, req.file.buffer, { contentType: mime, upsert: false })
    if (upErr) {
      console.error('[chat upload]', upErr.message)
      return res.status(500).json({ ok: false, error: upErr.message })
    }
    const { data: signed } = await sb.storage
      .from('documents').createSignedUrl(storagePath, 60 * 60 * 24)

    res.json({
      ok: true,
      attachment: {
        url:  signed?.signedUrl || null,
        path: storagePath,
        type: isImage ? 'image' : 'file',
        mime,
        name: req.file.originalname,
        size: req.file.size,
      }
    })
  } catch (e) {
    console.error('[chat upload] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── シフト申請 API ──────────────────────────────────────────────
// POST /worker/api/shift-requests
router.post('/api/shift-requests', requireWorkerAuth, requireWorker, async (req, res) => {
  const workerId  = req.profile?.worker_id
  const companyId = req.profile?.company_id
  if (!workerId) return res.json({ ok: false, error: 'worker_id未設定です' })

  const { date, shift_type, note } = req.body
  if (!date || !shift_type) return res.json({ ok: false, error: 'date と shift_type は必須です' })

  const sb = adminClient()
  const { data, error } = await sb
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

  // 管理者向け通知（worker_id=NULL で全admin宛て）
  try {
    const { data: w } = await sb.from('workers').select('name').eq('id', workerId).maybeSingle()
    const notif = {
      company_id: companyId,
      worker_id:  null,
      title:      '🗓 シフト変更申請',
      body:       `${w?.name || 'ワーカー'} が ${date} の ${shift_type} を申請${note?'：'+note:''}`,
      type:       'info',
    }
    await sb.from('notifications').insert(notif)
    push.sendFromNotification({ ...notif, url: '/app#shift' }).catch(()=>{})
  } catch {}

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

  const notif = {
    company_id: companyId,
    worker_id:  null, // SOS は全admin/staffに通知
    title:      '【SOS緊急】実習生から緊急連絡',
    body:       `${req.profile?.full_name || '実習生'} から緊急連絡が届きました`,
    type:       'alert',
  }
  const { error } = await adminClient().from('notifications').insert(notif)

  // 高優先度 push（requireInteraction + 強バイブ）
  push.sendFromNotification({ ...notif, url: '/app#notifications', tag: `gb-sos-${workerId}` })
    .catch(()=>{})

  if (error) console.error('[SOS] notification error:', error.message)
  res.json({ ok: true })
})

// ── 書類API ────────────────────────────────────────────────────
// GET /worker/api/documents/:id/url — 署名付きURLを再生成
router.get('/api/documents/:id/url', requireWorkerAuth, requireWorker, async (req, res) => {
  const docId    = req.params.id
  const workerId = req.profile?.worker_id
  const companyId = req.profile?.company_id
  const sb = adminClient()

  // ワーカーが閲覧可能な書類か確認（自分宛て or 全社共通）
  const { data: doc, error } = await sb
    .from('documents')
    .select('id, file_url, worker_id, company_id')
    .eq('id', docId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error || !doc) return res.status(404).json({ ok: false, error: '書類が見つかりません' })
  if (doc.worker_id && doc.worker_id !== workerId) return res.status(403).json({ ok: false, error: 'アクセス権限がありません' })

  // ローカルファイルの場合はそのまま返す
  if (!doc.file_url) return res.json({ ok: false, error: 'ファイルが添付されていません' })
  if (doc.file_url.startsWith('/uploads/')) return res.json({ ok: true, url: doc.file_url })

  // Storageの署名URLを生成（10分有効）
  const m = doc.file_url.split('/documents/')[1]
  if (!m) return res.json({ ok: true, url: doc.file_url })
  const storagePath = m.split('?')[0]
  const { data: signed, error: sigErr } = await sb.storage.from('documents').createSignedUrl(storagePath, 600)
  if (sigErr) return res.status(500).json({ ok: false, error: sigErr.message })
  res.json({ ok: true, url: signed.signedUrl })
})

// ── グループチャット API ────────────────────────────────────────
// GET /worker/api/groups — 自分が所属するグループ一覧
router.get('/api/groups', requireWorkerAuth, requireWorker, async (req, res) => {
  const userId = req.user?.id
  const sb = adminClient()

  // 自分が参加しているグループ
  const { data: memberships } = await sb
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
  const groupIds = (memberships || []).map(m => m.group_id)
  if (!groupIds.length) return res.json({ ok: true, groups: [] })

  const { data: groups, error } = await sb
    .from('groups')
    .select('id, name, icon, bg_color, description')
    .in('id', groupIds)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, groups: groups || [] })
})

// GET /worker/api/groups/:id/messages?after=ISO
router.get('/api/groups/:id/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  const groupId = req.params.id
  const userId  = req.user?.id
  const { after } = req.query
  const sb = adminClient()

  // メンバー確認
  const { data: m } = await sb.from('group_members').select('user_id').eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  if (!m) return res.status(403).json({ error: 'このグループのメンバーではありません' })

  let q = sb.from('group_messages')
    .select('id, sender_id, body, translated, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(200)
  if (after) q = q.gt('created_at', after)

  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, messages: data || [] })
})

// POST /worker/api/groups/:id/messages
router.post('/api/groups/:id/messages', requireWorkerAuth, requireWorker, async (req, res) => {
  const groupId = req.params.id
  const userId  = req.user?.id
  const { body, translated } = req.body

  if (!body?.trim()) return res.status(400).json({ error: 'メッセージ本文は必須です' })

  const sb = adminClient()

  // メンバー確認
  const { data: m } = await sb.from('group_members').select('user_id').eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  if (!m) return res.status(403).json({ error: 'このグループのメンバーではありません' })

  const { data, error } = await sb.from('group_messages').insert({
    group_id:   groupId,
    sender_id:  userId,
    body:       body.trim(),
    translated: translated || null,
  }).select('id, created_at').single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, message: data })
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

// ── 給与明細 API（ワーカー側）─────────────────────────────────
// GET /worker/api/payslips — 自分の published 明細のみ
router.get('/api/payslips', requireWorkerAuth, requireWorker, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId  = req.profile?.worker_id
    if (!workerId) return res.json({ ok: true, payslips: [] })

    const { data, error } = await adminClient()
      .from('payslips')
      .select('id, period, work_days, regular_hours, overtime_hours, night_hours, holiday_hours, base_pay, overtime_pay, night_pay, holiday_pay, allowance_total, deduction_total, gross_pay, net_pay, breakdown, published_at, status')
      .eq('company_id', companyId)
      .eq('worker_id', workerId)
      .eq('status', 'published')   // 公開済みのみ
      .order('period', { ascending: false })
      .limit(36)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true, payslips: data || [] })
  } catch (e) {
    console.error('[worker payslips]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router

const express = require('express')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const { createClient: _createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const push             = require('../lib/push')
const { isUuid }       = require('../lib/validate')
const { calcPayroll, defaultWage } = require('../lib/payroll')
const router  = express.Router()

// ── /app 配下の全ルートに admin 認証を適用 ──────────────────────────────────
// 個別ルートの requireAuth / requireAdmin は重複するが安全のため残す
router.use(requireAuth, requireAdmin)

// service_role クライアント（サーバー専用・クライアントへ露出禁止）
function createAdminClient() {
  return _createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// アップロード先: Vercel では /tmp を使用（ローカルは public/uploads/documents/）
const IS_VERCEL  = !!process.env.VERCEL
const UPLOAD_ROOT = IS_VERCEL
  ? '/tmp/uploads/documents'
  : path.join(__dirname, '..', '..', 'public', 'uploads', 'documents')
try { fs.mkdirSync(UPLOAD_ROOT, { recursive: true }) } catch {}

// ── ローカルJSONストレージ（DBなしでも永続化） ──────────────────────────────
// Vercel では /tmp を使用（再起動時にリセットされるためキャッシュ用途のみ）
const DATA_DIR   = IS_VERCEL ? '/tmp/data' : path.join(__dirname, '..', '..', 'data')
const DOCS_JSON  = path.join(DATA_DIR, 'docs_local.json')
try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}

function loadLocalDocs() {
  try { return JSON.parse(fs.readFileSync(DOCS_JSON, 'utf8') || '[]') } catch { return [] }
}
function saveLocalDoc(doc) {
  const all = loadLocalDocs()
  const idx = all.findIndex(d => d.id === doc.id)
  if (idx >= 0) all[idx] = doc; else all.push(doc)
  try { fs.writeFileSync(DOCS_JSON, JSON.stringify(all, null, 2)) } catch (e) { console.warn('JSON save error:', e.message) }
}
function deleteLocalDoc(id) {
  const all = loadLocalDocs().filter(d => d.id !== id)
  try { fs.writeFileSync(DOCS_JSON, JSON.stringify(all, null, 2)) } catch {}
}
function updateLocalDoc(id, patch) {
  const all = loadLocalDocs()
  const idx = all.findIndex(d => d.id === id)
  if (idx >= 0) { Object.assign(all[idx], patch); try { fs.writeFileSync(DOCS_JSON, JSON.stringify(all, null, 2)) } catch {} }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// テーブル不在エラー判定
const isTableMissing = err =>
  err && (err.code === '42P01' || (err.message||'').includes('schema cache') || (err.message||'').includes('does not exist'))

// ── 言語マッピング ───────────────────────────────────────
const LANG_LABEL = { vi:'ベトナム語', id:'インドネシア語', tl:'フィリピン語', my:'ミャンマー語', zh:'中国語', km:'クメール語', ja:'日本語' }
const LANG_FLAG  = { vi:'🇻🇳', id:'🇮🇩', tl:'🇵🇭', my:'🇲🇲', zh:'🇨🇳', km:'🇰🇭', ja:'🇯🇵' }
const LANG_BG    = { vi:['#d1fae5','#065f46'], id:['#dbeafe','#1e40af'], tl:['#fee2e2','#991b1b'], my:['#fef3c7','#92400e'], zh:['#fce7f3','#9d174d'], km:['#e0e7ff','#3730a3'], ja:['#f0fdf4','#14532d'] }

// YYYY-MM-DD → YYYY/MM/DD
function fmtDate(d) {
  if (!d) return ''
  return String(d).replace(/-/g, '/').slice(0, 10)
}

// Supabase workers行 → SPA形式
function mapWorker(w) {
  const lang   = w.language || 'vi'
  const colors = LANG_BG[lang] || ['#e5e7eb', '#374151']
  const name   = w.name || ''
  const parts  = name.trim().split(/\s+/)
  const init   = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()

  return {
    id:               w.id,
    name:             w.name || '',
    lang,
    lLabel:           LANG_LABEL[lang] || lang,
    flag:             LANG_FLAG[lang]  || '🌏',
    job:              w.job_title       || '',
    year:             '',
    docs:             '0/0',
    status:           w.status         || 'active',
    bg:               colors[0],
    tc:               colors[1],
    init,
    unread:           0,
    age:              null,
    arrive:           '',
    salary:           w.salary         ? String(w.salary) : '',
    dept:             w.department     || '',
    supervisor:       w.supervisor     || '',
    nationality:      w.nationality    || '',
    passport:         w.passport_number || '',
    passportExpire:   fmtDate(w.passport_expire),
    visaType:         w.visa_type      || '',
    visaStatus:       w.visa_status === 'active' ? '在留中' : (w.visa_status || ''),
    residenceCard:    w.residence_card || '',
    residenceExpire:  fmtDate(w.residence_expire),
    entryDate:        fmtDate(w.entry_date),
    contractEnd:      fmtDate(w.contract_end),
    insurance:        w.insurance      || '',
    emergencyContact: w.emergency_contact || '',
    address:          w.address        || '',
    workerDocs:       [],
    hist:             [],
  }
}

// Supabase documents行 → SPA形式
function mapDoc(d) {
  const CAT_ICO = { contract:'📋', visa:'🪪', passport:'📘', insurance:'🏥', salary:'💴', safety:'📒', technical_intern:'🏭', specified_skilled:'⭐', tax:'🧾', other:'📄' }
  const CAT_BG  = { contract:'#e6f9f0', visa:'#fefce8', passport:'#eff6ff', insurance:'#f0fdf4', salary:'#dbeafe', safety:'#f5f3ff', technical_intern:'#fce7f3', specified_skilled:'#fef3c7', tax:'#ecfdf5', other:'#f1f5f9' }
  const cat = d.category || 'other'
  return {
    id:           d.id,
    name:         d.name        || '',
    category:     cat,
    ico:          CAT_ICO[cat]  || '📄',
    icoBg:        CAT_BG[cat]   || '#f1f5f9',
    updated:      fmtDate((d.created_at || '').slice(0, 10)),
    status:       'done',
    content:      d.notes       || '',
    langs:        [],
    confs:        [],
    fileName:     d.file_name   || null,
    fileUrl:      d.file_url    || null,
    mimeType:     d.mime_type   || null,   // ← 追加
    fileSize:     d.file_size   || null,   // ← 追加
    workerId:     d.worker_id   || null,   // ← 追加
    expireDate:   fmtDate(d.expire_date),
    visibleRoles: d.visible_roles || [],   // ← 追加（将来のRLS拡張用）
  }
}

// ── メインルート ─────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId   = req.profile?.company_id
    let workers       = []
    let docs          = []
    let companyName   = 'GreenBridge'

    if (companyId) {
      const [wRes, dRes, cRes, pRes] = await Promise.all([
        req.supabase.from('workers').select('*').eq('company_id', companyId).order('name'),
        req.supabase.from('documents').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
        req.supabase.from('companies').select('name').eq('id', companyId).single(),
        // ワーカーのauth user IDを取得（チャット用）
        createAdminClient().from('profiles').select('id, worker_id').eq('company_id', companyId).eq('role', 'worker'),
      ])

      // worker_id → auth user id のマップ
      const profileMap = {}
      ;(pRes.data || []).forEach(p => { if (p.worker_id) profileMap[p.worker_id] = p.id })

      workers     = (wRes.data || []).map(w => ({ ...mapWorker(w), authUserId: profileMap[w.id] || null }))
      companyName = cRes.data?.name || 'GreenBridge'

      // Supabase の docs（テーブルが存在する場合）
      const supabaseDocs = (dRes.data || []).map(mapDoc)
      const supabaseIds  = new Set(supabaseDocs.map(d => d.id))

      // ローカルJSONの docs（Supabase にないものだけ追加）
      const localDocs = loadLocalDocs()
        .filter(d => d.company_id === companyId && !supabaseIds.has(d.id))
        .map(mapDoc)

      docs = [...supabaseDocs, ...localDocs]
    }

    const gbUser = {
      id:         req.user.id,
      email:      req.user.email,
      full_name:  req.profile?.full_name || req.user.email,
      role:       req.profile?.role      || 'staff',
      company_id: companyId,
    }

    // Realtime クライアント用の設定
    const realtimeConfig = {
      supabaseUrl:     process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
      accessToken:     req.cookies['sb-access-token']  || null,
      refreshToken:    req.cookies['sb-refresh-token'] || null,
    }

    res.render('spa', { workers, docs, gbUser, companyName, profile: req.profile, user: req.user, realtimeConfig })
  } catch (e) {
    console.error('SPA route error:', e)
    res.status(500).send('サーバーエラーが発生しました')
  }
})

// ── Workers API (AJAX用) ─────────────────────────────────
router.post('/api/workers', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).json({ error: '会社が未設定です' })
  const fields = ['name','nationality','language','job_title','department','supervisor','salary',
    'visa_type','visa_status','residence_card','residence_expire','entry_date','contract_end',
    'passport_number','passport_expire','address','emergency_contact','insurance','status']
  const payload = { company_id: companyId }
  for (const f of fields) if (req.body[f] !== undefined) payload[f] = req.body[f] || null
  const { data, error } = await req.supabase.from('workers').insert(payload).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, id: data.id })
})

router.put('/api/workers/:id', requireAuth, async (req, res) => {
  const fields = ['name','nationality','language','job_title','department','supervisor','salary',
    'visa_type','visa_status','residence_card','residence_expire','entry_date','contract_end',
    'passport_number','passport_expire','address','emergency_contact','insurance','status']
  const payload = {}
  for (const f of fields) if (req.body[f] !== undefined) payload[f] = req.body[f] || null
  const { error } = await req.supabase.from('workers').update(payload).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

router.delete('/api/workers/:id', requireAuth, async (req, res) => {
  await req.supabase.from('workers').delete().eq('id', req.params.id)
  res.json({ ok: true })
})

// ── Shifts API ───────────────────────────────────────────────────────────────

// GET /app/api/shifts?year=2026&month=5
router.get('/api/shifts', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ shifts: [], requests: [] })

  const year  = parseInt(req.query.year  || new Date().getFullYear())
  const month = parseInt(req.query.month || new Date().getMonth() + 1)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate   = `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`

  const [shiftsRes, reqsRes] = await Promise.all([
    req.supabase
      .from('shifts')
      .select('id, worker_id, date, shift_type, note')
      .eq('company_id', companyId)
      .gte('date', startDate)
      .lte('date', endDate),
    req.supabase
      .from('shift_requests')
      .select('id, worker_id, date, shift_type, note, status, profiles(full_name)')
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ])

  // テーブル不在でもエラーにしない
  const requests = (reqsRes.data || []).map(r => ({
    id:          r.id,
    worker_id:   r.worker_id,
    worker_name: r.profiles?.full_name || '不明',
    date:        r.date,
    shift_type:  r.shift_type,
    note:        r.note,
    status:      r.status,
  }))

  res.json({ shifts: shiftsRes.data || [], requests })
})

// PUT /app/api/shifts — upsert
router.put('/api/shifts', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).json({ error: '会社が未設定です' })

  const { worker_id, date, shift_type, note } = req.body
  if (!worker_id || !date || !shift_type)
    return res.status(400).json({ error: 'worker_id, date, shift_type は必須です' })

  const { data, error } = await req.supabase
    .from('shifts')
    .upsert(
      { company_id: companyId, worker_id, date, shift_type, note: note || null },
      { onConflict: 'worker_id,date' }
    )
    .select()
    .single()

  if (error) {
    if (isTableMissing(error)) return res.json({ ok: true, local: true })
    return res.status(500).json({ error: error.message })
  }
  res.json({ ok: true, shift: data })
})

// DELETE /app/api/shifts/:id
router.delete('/api/shifts/:id', requireAuth, async (req, res) => {
  await req.supabase.from('shifts').delete().eq('id', req.params.id)
  res.json({ ok: true })
})

// ── Shift Requests API ───────────────────────────────────────────────────────

// POST /app/api/shift-requests
router.post('/api/shift-requests', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).json({ error: '会社が未設定です' })

  const { worker_id, date, shift_type, note } = req.body
  if (!date) return res.status(400).json({ error: '日付は必須です' })

  const { data, error } = await req.supabase
    .from('shift_requests')
    .insert({
      company_id:  companyId,
      worker_id:   worker_id || null,
      requested_by: req.user.id,
      date,
      shift_type:  shift_type || '休',
      note:        note || null,
      status:      'pending',
    })
    .select()
    .single()

  if (error) {
    // テーブルがまだ存在しない場合もokを返す（ローカルのみ）
    console.warn('shift_requests insert error:', error.message)
    return res.json({ ok: true, local: true })
  }
  res.json({ ok: true, request: data })
})

// PUT /app/api/shift-requests/:id — approve/reject
router.put('/api/shift-requests/:id', requireAuth, async (req, res) => {
  const { status } = req.body
  if (!['approved', 'rejected'].includes(status))
    return res.status(400).json({ error: '無効なステータス' })

  const companyId = req.profile?.company_id
  const sbAdmin = createAdminClient()

  // 申請内容取得（通知用）
  const { data: reqRow } = await sbAdmin
    .from('shift_requests').select('worker_id, date, shift_type').eq('id', req.params.id).maybeSingle()

  const { error } = await req.supabase
    .from('shift_requests')
    .update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: error.message })

  // 承認時はshiftsにも反映 + ワーカーに通知
  if (reqRow) {
    if (status === 'approved') {
      try {
        await sbAdmin.from('shifts').upsert({
          company_id: companyId,
          worker_id:  reqRow.worker_id,
          date:       reqRow.date,
          shift_type: reqRow.shift_type,
        }, { onConflict: 'worker_id,date' })
      } catch {}
    }
    // ワーカーへ通知
    const notif = {
      company_id: companyId,
      worker_id:  reqRow.worker_id,
      title:      status === 'approved' ? '✅ シフト申請が承認されました' : '❌ シフト申請が却下されました',
      body:       `${reqRow.date} の ${reqRow.shift_type}`,
      type:       status === 'approved' ? 'approval' : 'info',
    }
    try { await sbAdmin.from('notifications').insert(notif) } catch {}
    push.sendFromNotification({ ...notif, url: '/worker?tab=shift' }).catch(()=>{})
  }

  res.json({ ok: true })
})

// ── CSVエクスポート API ──────────────────────────────────────────
// CSV文字列のエスケープ
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /app/api/attendance/export.csv?from=&to=&worker_id=
router.get('/api/attendance/export.csv', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).send('forbidden')

  const sb = createAdminClient()
  let q = sb.from('attendance_records')
    .select('work_date, clock_in, clock_out, status, memo, source, workers(name, job_title, department)')
    .eq('company_id', companyId)
    .order('work_date', { ascending: false })
    .limit(5000)

  if (req.query.from)      q = q.gte('work_date', req.query.from)
  if (req.query.to)        q = q.lte('work_date', req.query.to)
  if (req.query.worker_id) q = q.eq('worker_id', req.query.worker_id)

  const { data, error } = await q
  if (error) return res.status(500).send(error.message)

  // 給与計算ソフト向けの一般的な列構成
  const headers = ['日付','氏名','部署','職種','出勤時刻','退勤時刻','勤務時間(分)','ステータス','種別','メモ']
  const rows = [headers.map(csvEscape).join(',')]

  for (const r of (data || [])) {
    const w = r.workers || {}
    const ci = r.clock_in  ? new Date(r.clock_in)  : null
    const co = r.clock_out ? new Date(r.clock_out) : null
    const mins = (ci && co) ? Math.max(0, Math.round((co - ci) / 60000)) : ''
    const fmt = d => d ? d.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' }) : ''
    const statusMap = { present:'出勤', late:'遅刻', absent:'欠勤', holiday:'休み' }

    rows.push([
      r.work_date,
      w.name || '',
      w.department || '',
      w.job_title || '',
      fmt(ci),
      fmt(co),
      mins,
      statusMap[r.status] || r.status || '',
      r.source === 'worker' ? '本人' : '管理者',
      r.memo || '',
    ].map(csvEscape).join(','))
  }

  const filename = `attendance_${(req.query.from || 'all')}_${(req.query.to || '')}.csv`.replace(/_$|^_/g, '')
  // BOM付き UTF-8 (Excel が文字化けしないように)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send('﻿' + rows.join('\r\n'))
})

// GET /app/api/shifts/export.csv?year=&month=&worker_id=
router.get('/api/shifts/export.csv', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).send('forbidden')

  const sb = createAdminClient()
  let q = sb.from('shifts')
    .select('date, shift_type, note, workers(name, job_title)')
    .eq('company_id', companyId)
    .order('date')

  if (req.query.year && req.query.month) {
    const y = parseInt(req.query.year), m = parseInt(req.query.month)
    const last = new Date(y, m, 0).getDate()
    q = q.gte('date', `${y}-${String(m).padStart(2,'0')}-01`)
         .lte('date', `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`)
  }
  if (req.query.worker_id) q = q.eq('worker_id', req.query.worker_id)

  const { data, error } = await q
  if (error) return res.status(500).send(error.message)

  const typeMap = { '日':'日勤','早':'早番','遅':'遅番','休':'休み','有':'有休','欠':'欠勤' }
  const headers = ['日付','氏名','職種','シフト種別','備考']
  const rows = [headers.map(csvEscape).join(',')]
  for (const r of (data || [])) {
    const w = r.workers || {}
    rows.push([
      r.date,
      w.name || '',
      w.job_title || '',
      typeMap[r.shift_type] || r.shift_type || '',
      r.note || '',
    ].map(csvEscape).join(','))
  }

  const filename = `shifts_${req.query.year||''}_${req.query.month||''}.csv`.replace(/_+$/, '')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send('﻿' + rows.join('\r\n'))
})

// GET /app/api/daily-reports/export.csv?from=&to=
router.get('/api/daily-reports/export.csv', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).send('forbidden')

  const sb = createAdminClient()
  let q = sb.from('daily_reports')
    .select('report_date, type, content, translated, status, created_at, workers(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (req.query.from) q = q.gte('report_date', req.query.from)
  if (req.query.to)   q = q.lte('report_date', req.query.to)

  const { data, error } = await q
  if (error) return res.status(500).send(error.message)

  const headers = ['日付','氏名','種別','原文','翻訳','ステータス','投稿日時']
  const rows = [headers.map(csvEscape).join(',')]
  for (const r of (data || [])) {
    rows.push([
      r.report_date,
      r.workers?.name || '',
      r.type === 'hayari' ? 'ヒヤリ・ハット' : '日報',
      r.content || '',
      r.translated || '',
      { pending:'確認待ち', reviewed:'確認済み', returned:'差戻し', approved:'確認済み' }[r.status] || r.status,
      r.created_at,
    ].map(csvEscape).join(','))
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="daily_reports.csv"`)
  res.send('﻿' + rows.join('\r\n'))
})

// ── 通知 API ─────────────────────────────────────────────────────
// GET /app/api/notifications — 会社内の全通知
router.get('/api/notifications', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('notifications')
    .select('id, worker_id, title, body, type, is_read, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (isTableMissing(error)) return res.json({ ok: true, notifications: [] })
    return res.status(500).json({ error: error.message })
  }
  res.json({ ok: true, notifications: data || [] })
})

// PUT /app/api/notifications/:id/read — 既読化
router.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const sb = createAdminClient()
  const { error } = await sb.from('notifications').update({ is_read: true }).eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// POST /app/api/notifications/read-all — 全既読化
router.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  const sb = createAdminClient()
  const { error } = await sb.from('notifications')
    .update({ is_read: true })
    .eq('company_id', companyId)
    .eq('is_read', false)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// ── ダッシュボード統計 API ────────────────────────────────────────
// GET /app/api/dashboard/stats — KPI一括取得
router.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ ok: true, stats: {} })

  const sb = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Supabase クエリビルダは .catch を持たないため、Promise でラップして安全化
  const safe = (builder, fallback = { count: 0, data: [] }) =>
    Promise.resolve(builder).then(r => r).catch(() => fallback)

  try {
    const [attRes, shiftReqRes, dailyRepRes, notifRes, msgRes, workerRes, todayNippoRes] = await Promise.all([
      // 今日の勤怠
      safe(sb.from('attendance_records').select('status', { count: 'exact' }).eq('company_id', companyId).eq('work_date', today)),
      // pending シフト申請
      safe(sb.from('shift_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending')),
      // pending 日報
      safe(sb.from('daily_reports').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending')),
      // 未読通知
      safe(sb.from('notifications').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_read', false)),
      // 未読メッセージ（ワーカー→管理者）
      safe(sb.from('messages').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('is_read', false)),
      // 全ワーカー数
      safe(sb.from('workers').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'active')),
      // 本日の日報総数
      safe(sb.from('daily_reports').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('report_date', today)),
    ])

    const attRecords = attRes.data || []
    const present = attRecords.filter(r => r.status === 'present').length
    const late    = attRecords.filter(r => r.status === 'late').length
    const absent  = attRecords.filter(r => r.status === 'absent').length
    const totalWorkers = workerRes.count || 0
    // 未打刻 = 在籍数 − (出勤 + 遅刻 + 欠勤)。負値はゼロ扱い
    const unpunched = Math.max(0, totalWorkers - (present + late + absent))
    const rate = totalWorkers > 0 ? Math.round(((present + late) / totalWorkers) * 100) : 0

    res.json({
      ok: true,
      stats: {
        attendance: { present, late, absent, unpunched, total: totalWorkers, rate },
        pending: {
          shiftRequests: shiftReqRes.count || 0,
          dailyReports:  dailyRepRes.count || 0,
        },
        unread: {
          notifications: notifRes.count || 0,
          messages:      msgRes.count  || 0,
        },
        today: {
          nippoCount: todayNippoRes.count || 0,
        },
      },
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Documents Upload API ─────────────────────────────────────────────────────

// POST /app/api/documents/upload  (multipart)
// Supabase Storage を優先、失敗時のみローカルフォールバック（開発用）
router.post('/api/documents/upload', requireAuth, upload.single('file'), async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).json({ error: '会社が未設定です' })

  const { name, category, notes, expire_date, worker_id, visible_roles } = req.body
  if (!name) return res.status(400).json({ error: '書類名は必須です' })

  let fileUrl = null, fileName = null, fileSize = null, mimeType = null, storagePath = null

  if (req.file) {
    const origName = req.file.originalname
    const ext      = path.extname(origName).toLowerCase() || '.bin'
    const safeName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`
    fileName = origName
    fileSize = req.file.size
    mimeType = ext === '.pdf' ? 'application/pdf' : (req.file.mimetype || 'application/octet-stream')

    storagePath = `${companyId}/${worker_id || 'shared'}/${safeName}`

    // ── ① Supabase Storage 優先（service_role で安定動作）────
    let storageOk = false
    try {
      const sb = createAdminClient()
      const { error: upErr } = await sb.storage
        .from('documents')
        .upload(storagePath, req.file.buffer, { contentType: mimeType, upsert: false })

      if (!upErr) {
        // 署名付きURL（24時間有効）でアクセス
        const { data: signed } = await sb.storage
          .from('documents').createSignedUrl(storagePath, 60 * 60 * 24)
        if (signed?.signedUrl) {
          fileUrl = signed.signedUrl
          storageOk = true
        }
      } else {
        console.warn('[storage] upload failed:', upErr.message)
      }
    } catch (e) {
      console.warn('[storage] error:', e.message)
    }

    // ── ② Storage 失敗時のみローカル保存（開発・フォールバック）────
    if (!storageOk && !IS_VERCEL) {
      const subDir  = worker_id
        ? path.join(companyId, worker_id)
        : path.join(companyId, 'shared')
      const saveDir = path.join(UPLOAD_ROOT, subDir)
      try {
        fs.mkdirSync(saveDir, { recursive: true })
        fs.writeFileSync(path.join(saveDir, safeName), req.file.buffer)
        fileUrl = `/uploads/documents/${subDir.replace(/\\/g, '/')}/${safeName}`
      } catch (e) {
        console.warn('[local file] write failed:', e.message)
      }
    }
  }

  // ── ③ ローカルJSONに必ず保存（リロード対策・DB不要） ──────────────────────
  let visibleRoles = []
  try { visibleRoles = JSON.parse(visible_roles || '[]') } catch {}

  const localId  = `local_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
  const localDoc = {
    id:            localId,
    company_id:    companyId,
    worker_id:     worker_id    || null,
    name,
    category:      category     || 'other',
    file_url:      fileUrl,
    file_name:     fileName,
    file_size:     fileSize,
    mime_type:     mimeType,
    notes:         notes        || null,
    expire_date:   expire_date  || null,
    visible_roles: visibleRoles,
    created_at:    new Date().toISOString(),
  }
  saveLocalDoc(localDoc)  // ← 常にローカルJSONに保存

  // ── ④ Supabase documents テーブルにも保存（存在する場合） ────────────────
  const { data, error } = await req.supabase.from('documents').insert({
    ...localDoc,
    uploaded_by: req.user.id,
  }).select().single()

  if (error) {
    console.warn('[DB] documents insert error (using local):', error.message)
    // DBなしでも localDoc をフロントに返す
    return res.json({ ok: true, local: true, doc: mapDoc(localDoc) })
  }

  // DB保存成功 → SupabaseのIDでローカルJSONを更新
  const dbDoc = mapDoc(data)
  updateLocalDoc(localId, { id: data.id })   // ローカルIDをDB IDに置き換え
  res.json({ ok: true, doc: dbDoc })
})

// PUT /app/api/documents/:id/worker — worker_id を更新（紐付け・解除）
router.put('/api/documents/:id/worker', requireAuth, async (req, res) => {
  const { worker_id } = req.body
  updateLocalDoc(req.params.id, { worker_id: worker_id || null })
  const { error } = await req.supabase
    .from('documents')
    .update({ worker_id: worker_id || null })
    .eq('id', req.params.id)
  if (error) console.warn('worker link DB error:', error.message)
  res.json({ ok: true })
})

// DELETE /app/api/documents/:id
router.delete('/api/documents/:id', requireAuth, async (req, res) => {
  const id = req.params.id

  // ローカルファイルも削除
  const localDocs = loadLocalDocs()
  const localDoc  = localDocs.find(d => d.id === id)
  if (localDoc?.file_url?.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, '..', '..', 'public', localDoc.file_url)
    try { fs.unlinkSync(filePath) } catch {}
  }
  deleteLocalDoc(id)

  // Supabase Storage からも削除
  const sbAdmin = createAdminClient()
  const { data: doc } = await sbAdmin.from('documents').select('file_url').eq('id', id).maybeSingle()
  if (doc?.file_url && !doc.file_url.startsWith('/uploads/')) {
    // signed URL も public URL も documents/[path] のパターン
    const m = doc.file_url.split('/documents/')[1]
    if (m) {
      const storagePath = m.split('?')[0]  // クエリ文字列を除去
      await sbAdmin.storage.from('documents').remove([storagePath]).catch(()=>{})
    }
  }
  await sbAdmin.from('documents').delete().eq('id', id)
  res.json({ ok: true })
})

// ── Users (Role Management) API ──────────────────────────────────────────────

// GET /app/api/users — 同一会社のユーザー一覧
router.get('/api/users', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ users: [] })

  const { data, error } = await req.supabase
    .from('profiles')
    .select('id, full_name, role, company_id')
    .eq('company_id', companyId)
    .order('full_name')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ users: data || [] })
})

// PUT /app/api/users/:id/role — ロール変更（管理者のみ）
router.put('/api/users/:id/role', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみロールを変更できます' })

  const { role } = req.body
  const allowed = ['admin', 'manager', 'staff', 'trainee']
  if (!allowed.includes(role))
    return res.status(400).json({ error: '無効なロールです' })

  // 自分自身の管理者権限は剥奪不可
  if (req.params.id === req.user.id && role !== 'admin')
    return res.status(400).json({ error: '自分自身の管理者権限は変更できません' })

  const { error } = await req.supabase
    .from('profiles')
    .update({ role })
    .eq('id', req.params.id)
    .eq('company_id', req.profile.company_id) // 同一会社のみ

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// ── Attendance API ────────────────────────────────────────────────────────────

// ISO文字列(timestamptz) → JSTの "HH:MM"。UTC保存・JSTオフセット保存どちらも正しく表示する
function fmtJstHM(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
    })
  } catch { return null }
}

// attendance_records 行 → フロント形式
function mapAttendance(r) {
  const w  = r.workers || {}
  // ★ UTC文字列をそのまま切り出すと9hズレる → JSTへ変換して表示
  const ci = fmtJstHM(r.clock_in)
  const co = fmtJstHM(r.clock_out)
  // 勤務時間は ISO の実時刻差から算出（TZ非依存で正確）
  let workMins = null
  if (r.clock_in && r.clock_out) {
    workMins = Math.round((new Date(r.clock_out) - new Date(r.clock_in)) / 60000)
    if (workMins < 0) workMins += 24 * 60   // 日跨ぎ対応
  }
  return {
    id:          r.id,
    worker_id:   r.worker_id,
    workerName:  w.name     || '不明',
    workerLang:  w.language || 'ja',
    work_date:   r.work_date,
    clock_in:    r.clock_in  || null,
    clock_out:   r.clock_out || null,
    clockInStr:  ci,
    clockOutStr: co,
    workMins,
    workHours:   workMins != null
      ? `${Math.floor(workMins / 60)}h${String(workMins % 60).padStart(2, '0')}m`
      : '-',
    status:  r.status || 'absent',
    memo:    r.memo   || '',
    source:  r.source || 'admin',  // 将来: worker/qr/gps
  }
}

// GET /app/api/attendance?date=&worker_id=&status=
router.get('/api/attendance', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみアクセスできます' })

  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ records: [] })

  let query = req.supabase
    .from('attendance_records')
    .select('id, worker_id, work_date, clock_in, clock_out, status, memo, source, created_at, updated_at, workers(name, language)')
    .eq('company_id', companyId)
    .order('work_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (req.query.date)      query = query.eq('work_date', req.query.date)
  if (req.query.worker_id) query = query.eq('worker_id', req.query.worker_id)
  if (req.query.status)    query = query.eq('status', req.query.status)

  const { data, error } = await query

  if (error) {
    if (isTableMissing(error)) return res.json({ records: [], missing: true })
    return res.status(500).json({ error: error.message })
  }
  res.json({ records: (data || []).map(mapAttendance) })
})

// GET /app/api/attendance/stats — 本日統計（ダッシュボード用）
router.get('/api/attendance/stats', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ present: 0, absent: 0, late: 0, recent: [] })

  const today = new Date().toISOString().slice(0, 10)

  const { data, error } = await req.supabase
    .from('attendance_records')
    .select('id, worker_id, status, clock_in, clock_out, work_date, workers(name, language)')
    .eq('company_id', companyId)
    .eq('work_date', today)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (isTableMissing(error))
      return res.json({ present: 0, absent: 0, late: 0, recent: [], missing: true })
    return res.json({ present: 0, absent: 0, late: 0, recent: [] })
  }

  const records = data || []
  const present = records.filter(r => r.status === 'present').length
  const late    = records.filter(r => r.status === 'late').length
  const absent  = records.filter(r => r.status === 'absent').length
  const recent  = records.slice(0, 5).map(mapAttendance)

  res.json({ present, absent, late, recent })
})

// POST /app/api/attendance — 登録（upsert: worker_id + work_date が重複なら更新）
router.post('/api/attendance', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ登録できます' })

  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).json({ error: '会社が未設定です' })

  const { worker_id, work_date, clock_in, clock_out, status, memo } = req.body
  if (!worker_id || !work_date)
    return res.status(400).json({ error: 'worker_id と work_date は必須です' })

  const payload = {
    company_id: companyId,
    worker_id,
    work_date,
    clock_in:   clock_in   || null,
    clock_out:  clock_out  || null,
    status:     status     || 'present',
    memo:       memo       || null,
    source:     'admin',   // 将来: worker/qr/gps に拡張可能
    created_by: req.user.id,
  }

  const { data, error } = await req.supabase
    .from('attendance_records')
    .upsert(payload, { onConflict: 'worker_id,work_date' })
    .select('*, workers(name, language)')
    .single()

  if (error) {
    if (isTableMissing(error)) return res.json({ ok: true, missing: true })
    return res.status(500).json({ error: error.message })
  }
  res.json({ ok: true, record: mapAttendance(data) })
})

// PUT /app/api/attendance/:id — 更新
router.put('/api/attendance/:id', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ更新できます' })

  const fields = ['clock_in', 'clock_out', 'status', 'memo']
  const payload = { updated_at: new Date().toISOString() }
  for (const f of fields) if (req.body[f] !== undefined) payload[f] = req.body[f] || null

  const { error } = await req.supabase
    .from('attendance_records')
    .update(payload)
    .eq('id', req.params.id)
    .eq('company_id', req.profile.company_id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// DELETE /app/api/attendance/:id — 削除
router.delete('/api/attendance/:id', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ削除できます' })

  await req.supabase
    .from('attendance_records')
    .delete()
    .eq('id', req.params.id)
    .eq('company_id', req.profile.company_id)

  res.json({ ok: true })
})

// ── Worker Account Management API ────────────────────────────────────────────
// 全エンドポイント: admin のみ / service_role_key はサーバー内のみ使用

// GET /app/api/workers/:id/account-status — アカウント有無・確認状態
router.get('/api/workers/:id/account-status', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみアクセスできます' })

  const companyId = req.profile?.company_id
  const workerId  = req.params.id
  const sb        = createAdminClient()

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, role, full_name')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .eq('role', 'worker')
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!profile) return res.json({ hasAccount: false })

  // auth.users から email・確認状態を取得
  try {
    const { data: { user }, error: uErr } = await sb.auth.admin.getUserById(profile.id)
    if (uErr || !user) return res.json({ hasAccount: true, email: '', confirmed: false })
    return res.json({
      hasAccount: true,
      email:      user.email || '',
      confirmed:  !!user.email_confirmed_at,
      authUserId: profile.id,
    })
  } catch {
    return res.json({ hasAccount: true, email: '', confirmed: false })
  }
})

// POST /app/api/workers/:id/create-account — workerアカウント新規作成
router.post('/api/workers/:id/create-account', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ操作できます' })

  const companyId = req.profile?.company_id
  const workerId  = req.params.id
  const { email, password } = req.body

  if (!email || !password)
    return res.status(400).json({ error: 'メールアドレスとパスワードは必須です' })
  if (password.length < 6)
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' })

  const sb = createAdminClient()

  // 既存アカウント確認
  const { data: existing } = await sb
    .from('profiles')
    .select('id')
    .eq('worker_id', workerId)
    .eq('role', 'worker')
    .maybeSingle()

  if (existing)
    return res.status(400).json({ error: 'このワーカーには既にアカウントがあります' })

  // worker の name 取得
  const { data: worker } = await sb
    .from('workers')
    .select('name')
    .eq('id', workerId)
    .single()

  // Supabase Auth ユーザー作成（email_confirm: true でメール確認スキップ）
  const { data: { user }, error: authErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authErr || !user)
    return res.status(500).json({ error: authErr?.message || 'ユーザー作成に失敗しました' })

  // profiles レコード作成
  const { error: profileErr } = await sb.from('profiles').insert({
    id:         user.id,
    company_id: companyId,
    worker_id:  workerId,
    role:       'worker',
    full_name:  worker?.name || email,
  })

  if (profileErr) {
    // rollback
    await sb.auth.admin.deleteUser(user.id).catch(() => {})
    return res.status(500).json({ error: profileErr.message })
  }

  res.json({ ok: true, authUserId: user.id, email })
})

// POST /app/api/workers/:id/reset-password — パスワード再設定
router.post('/api/workers/:id/reset-password', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ操作できます' })

  const companyId = req.profile?.company_id
  const workerId  = req.params.id
  const { password } = req.body

  if (!password || password.length < 6)
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' })

  const sb = createAdminClient()

  const { data: profile } = await sb
    .from('profiles')
    .select('id')
    .eq('worker_id', workerId)
    .eq('company_id', companyId)
    .eq('role', 'worker')
    .maybeSingle()

  if (!profile)
    return res.status(404).json({ error: 'アカウントが見つかりません' })

  const { error } = await sb.auth.admin.updateUserById(profile.id, { password })
  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true })
})

// POST /app/api/workers/:id/link-account — 既存アカウントとworker_idを紐付け
router.post('/api/workers/:id/link-account', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ操作できます' })

  const companyId = req.profile?.company_id
  const workerId  = req.params.id
  const email     = (req.body.email || '').trim().toLowerCase()

  if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' })

  const sb = createAdminClient()

  // メールアドレスで Auth.users を検索
  const { data: { users }, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) return res.status(500).json({ error: listErr.message })

  const authUser = users.find(u => (u.email || '').toLowerCase() === email)
  if (!authUser)
    return res.status(404).json({ error: '指定のメールアドレスのアカウントが見つかりません' })

  // 既存 profile 確認
  const { data: existingProfile } = await sb
    .from('profiles')
    .select('id, worker_id, role')
    .eq('id', authUser.id)
    .maybeSingle()

  if (existingProfile) {
    if (existingProfile.role !== 'worker')
      return res.status(400).json({ error: 'このアカウントはワーカー以外のロール（管理者等）です' })
    if (existingProfile.worker_id && existingProfile.worker_id !== workerId)
      return res.status(400).json({ error: 'このアカウントはすでに別の実習生と紐付いています' })

    // worker_id を更新
    const { error: upErr } = await sb
      .from('profiles')
      .update({ worker_id: workerId, company_id: companyId })
      .eq('id', authUser.id)
    if (upErr) return res.status(500).json({ error: upErr.message })
  } else {
    // profile が存在しない場合は挿入
    const { error: insErr } = await sb.from('profiles').insert({
      id:         authUser.id,
      company_id: companyId,
      worker_id:  workerId,
      role:       'worker',
      full_name:  authUser.user_metadata?.full_name || email,
    })
    if (insErr) return res.status(500).json({ error: insErr.message })
  }

  res.json({ ok: true, email: authUser.email })
})

// DELETE /app/api/workers/:id/link-account — 紐付け解除
router.delete('/api/workers/:id/link-account', requireAuth, async (req, res) => {
  if (req.profile?.role !== 'admin')
    return res.status(403).json({ error: '管理者のみ操作できます' })

  const companyId = req.profile?.company_id
  const workerId  = req.params.id
  const sb        = createAdminClient()

  const { error } = await sb
    .from('profiles')
    .update({ worker_id: null })
    .eq('worker_id', workerId)
    .eq('company_id', companyId)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// ── グループチャット API（Admin用） ──────────────────────────────
// GET /app/api/groups — グループ一覧
router.get('/api/groups', requireAuth, requireAdmin, async (req, res) => {
  const companyId = req.profile?.company_id
  const sb = createAdminClient()

  const { data: groups, error } = await sb
    .from('groups')
    .select('id, name, icon, bg_color, description, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (error) {
    if (isTableMissing(error)) return res.json({ ok: true, groups: [], missing: true })
    return res.status(500).json({ error: error.message })
  }

  // 各グループのメンバー数を取得
  const groupIds = (groups || []).map(g => g.id)
  let members = []
  if (groupIds.length) {
    const { data } = await sb
      .from('group_members')
      .select('group_id, user_id')
      .in('group_id', groupIds)
    members = data || []
  }

  const enriched = (groups || []).map(g => ({
    ...g,
    members: members.filter(m => m.group_id === g.id).map(m => m.user_id),
    memberCount: members.filter(m => m.group_id === g.id).length,
  }))

  res.json({ ok: true, groups: enriched })
})

// POST /app/api/groups — グループ作成
router.post('/api/groups', requireAuth, requireAdmin, async (req, res) => {
  const companyId = req.profile?.company_id
  const adminId   = req.user?.id
  const { name, icon, bg_color, description, member_ids } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'グループ名は必須です' })

  const sb = createAdminClient()
  const { data: group, error } = await sb
    .from('groups')
    .insert({
      company_id:  companyId,
      name:        name.trim(),
      icon:        icon || '👥',
      bg_color:    bg_color || '#e0e7ff',
      description: description || null,
      created_by:  adminId,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // メンバー追加（管理者自身も含める）
  const memberSet = new Set([adminId, ...(Array.isArray(member_ids) ? member_ids : [])])
  const memberRows = [...memberSet].map(uid => ({ group_id: group.id, user_id: uid }))
  if (memberRows.length) {
    await sb.from('group_members').insert(memberRows)
  }

  res.json({ ok: true, group })
})

// PUT /app/api/groups/:id — グループ更新（名前、メンバー等）
router.put('/api/groups/:id', requireAuth, requireAdmin, async (req, res) => {
  const groupId   = req.params.id
  const companyId = req.profile?.company_id
  const sb = createAdminClient()

  const { name, icon, bg_color, description, member_ids } = req.body

  // 自社グループか確認
  const { data: group } = await sb.from('groups').select('id').eq('id', groupId).eq('company_id', companyId).maybeSingle()
  if (!group) return res.status(404).json({ error: 'グループが見つかりません' })

  // 基本情報更新
  const updates = {}
  if (name !== undefined)        updates.name = name
  if (icon !== undefined)        updates.icon = icon
  if (bg_color !== undefined)    updates.bg_color = bg_color
  if (description !== undefined) updates.description = description

  if (Object.keys(updates).length) {
    const { error } = await sb.from('groups').update(updates).eq('id', groupId)
    if (error) return res.status(500).json({ error: error.message })
  }

  // メンバー更新（送信されたら全置換）
  if (Array.isArray(member_ids)) {
    await sb.from('group_members').delete().eq('group_id', groupId)
    const memberSet = new Set([req.user.id, ...member_ids])
    const rows = [...memberSet].map(uid => ({ group_id: groupId, user_id: uid }))
    if (rows.length) await sb.from('group_members').insert(rows)
  }

  res.json({ ok: true })
})

// DELETE /app/api/groups/:id — グループ削除
router.delete('/api/groups/:id', requireAuth, requireAdmin, async (req, res) => {
  const groupId   = req.params.id
  const companyId = req.profile?.company_id
  const sb = createAdminClient()

  const { error } = await sb.from('groups').delete().eq('id', groupId).eq('company_id', companyId)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

// GET /app/api/groups/:id/messages?after=ISO — グループメッセージ取得
router.get('/api/groups/:id/messages', requireAuth, requireAdmin, async (req, res) => {
  const groupId   = req.params.id
  const companyId = req.profile?.company_id
  const { after } = req.query
  const sb = createAdminClient()

  // 自社グループか確認
  const { data: group } = await sb.from('groups').select('id').eq('id', groupId).eq('company_id', companyId).maybeSingle()
  if (!group) return res.status(404).json({ error: 'グループが見つかりません' })

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

// POST /app/api/groups/:id/messages — グループにメッセージ送信
router.post('/api/groups/:id/messages', requireAuth, requireAdmin, async (req, res) => {
  const groupId   = req.params.id
  const companyId = req.profile?.company_id
  const adminId   = req.user?.id
  const { body, translated } = req.body

  if (!body?.trim()) return res.status(400).json({ error: 'メッセージ本文は必須です' })

  const sb = createAdminClient()
  const { data: group } = await sb.from('groups').select('id').eq('id', groupId).eq('company_id', companyId).maybeSingle()
  if (!group) return res.status(404).json({ error: 'グループが見つかりません' })

  const { data, error } = await sb.from('group_messages').insert({
    group_id:   groupId,
    sender_id:  adminId,
    body:       body.trim(),
    translated: translated || null,
  }).select('id, created_at').single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, message: data })
})

// ── メッセージ API（Admin用） ─────────────────────────────────────
// POST /app/api/messages — 管理者→ワーカーへメッセージ送信
router.post('/api/messages', requireAuth, requireAdmin, async (req, res) => {
  const companyId    = req.profile?.company_id
  const adminUserId  = req.user?.id
  const {
    worker_user_id, body, translated,
    attachment_url, attachment_path, attachment_type, attachment_mime, attachment_name, attachment_size,
  } = req.body

  if (!worker_user_id)
    return res.status(400).json({ error: 'worker_user_id は必須です' })
  if (!isUuid(worker_user_id))
    return res.status(400).json({ error: 'worker_user_id の形式が不正です' })

  const hasBody       = body && body.trim().length > 0
  const hasAttachment = !!attachment_path
  if (!hasBody && !hasAttachment) {
    return res.status(400).json({ error: 'メッセージまたは添付ファイルが必要です' })
  }

  const sbAdmin = createAdminClient()
  const row = {
    company_id:  companyId,
    sender_id:   adminUserId,
    receiver_id: worker_user_id,
    body:        hasBody ? body.trim() : '',  // 旧スキーマ body NOT NULL 互換
    translated:  translated || null,
  }
  if (hasAttachment) {
    row.attachment_url   = attachment_url   || null
    row.attachment_path  = attachment_path  || null
    row.attachment_type  = attachment_type  || null
    row.attachment_mime  = attachment_mime  || null
    row.attachment_name  = attachment_name  || null
    row.attachment_size  = attachment_size  || null
  }

  let { data, error } = await sbAdmin
    .from('messages')
    .insert(row)
    .select('id, created_at')
    .single()

  if (error && hasAttachment && /column .* does not exist|attachment_/i.test(error.message || '')) {
    const fallback = {
      company_id: row.company_id, sender_id: row.sender_id, receiver_id: row.receiver_id,
      body: row.body || '[画像]', translated: row.translated,
    }
    ;({ data, error } = await sbAdmin.from('messages').insert(fallback).select('id, created_at').single())
  }

  if (error) return res.status(500).json({ error: error.message })

  // push: 受信ワーカーへ通知（profile から worker_id を解決）
  ;(async () => {
    try {
      const { data: prof } = await sbAdmin
        .from('profiles').select('worker_id, full_name')
        .eq('id', worker_user_id).maybeSingle()
      if (prof?.worker_id) {
        await push.sendToWorker(companyId, prof.worker_id, {
          title: '💬 管理者からメッセージ',
          body:  body.trim().slice(0, 80),
          type:  'message',
          url:   '/worker?tab=chat',
          tag:   `gb-msg-${adminUserId}`,
        })
      }
    } catch {}
  })()

  res.json({ ok: true, message: data })
})

// GET /app/api/messages?worker_user_id=xxx&after=ISO — 管理者とワーカー間のメッセージ取得
router.get('/api/messages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId   = req.profile?.company_id
    const adminUserId = req.user?.id
    const { worker_user_id, after } = req.query

    if (!worker_user_id)
      return res.status(400).json({ error: 'worker_user_id は必須です' })
    if (!isUuid(worker_user_id))
      return res.status(400).json({ error: 'worker_user_id の形式が不正です' })

    // ★ 添付カラム対応 (migration 009) 済みかどうか分からないので、まず全カラムで試し、
    //   失敗（カラムなし等）したら基本カラムで再試行する
    const baseFilter = (q) => q
      .eq('company_id', companyId)
      .or(
        `and(sender_id.eq.${adminUserId},receiver_id.eq.${worker_user_id}),` +
        `and(sender_id.eq.${worker_user_id},receiver_id.eq.${adminUserId})`
      )
      .order('created_at', { ascending: true })
      .limit(100)
    const withAfter = (q) => after ? q.gt('created_at', after) : q

    const fullCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at, attachment_url, attachment_path, attachment_type, attachment_mime, attachment_name, attachment_size'
    const baseCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at'

    const sb = createAdminClient()
    let data, error
    ;({ data, error } = await withAfter(baseFilter(sb.from('messages').select(fullCols))))
    if (error && /column .* does not exist|attachment_/i.test(error.message || '')) {
      // 添付カラムが無い → migration 009 未実行 → 基本カラムで再試行
      ;({ data, error } = await withAfter(baseFilter(sb.from('messages').select(baseCols))))
    }
    if (error) return res.status(500).json({ error: error.message })

    // 未読を既読に更新（管理者が読んだので）
    const unreadIds = (data || [])
      .filter(m => m.sender_id === worker_user_id && !m.is_read)
      .map(m => m.id)
    if (unreadIds.length) {
      try {
        await createAdminClient()
          .from('messages')
          .update({ is_read: true })
          .in('id', unreadIds)
      } catch (e) {
        console.warn('[messages] mark as read failed:', e.message)
      }
    }

    res.json({ ok: true, messages: data || [] })
  } catch (e) {
    console.error('[/app/api/messages] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 日報 API（Admin用） ──────────────────────────────────────────
// GET /app/api/daily-reports?worker_id=&type=&status=
router.get('/api/daily-reports', requireAuth, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, reports: [] })

    const sb = createAdminClient()
    // 拡張カラム込みで取得。migration 012 未適用の環境では基本カラムにフォールバック
    const fullCols = `
      id, report_date, type, content, translated, status, created_at,
      site_name, work_content, attachments, reviewed_at,
      worker_id, workers(name, language)
    `
    const baseCols = `
      id, report_date, type, content, translated, status, created_at,
      worker_id, workers(name, language)
    `
    const limit = Math.min(parseInt(req.query.limit, 10) || 300, 1000)
    const build = (cols) => {
      let q = sb.from('daily_reports').select(cols)
        .eq('company_id', companyId)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit)
      if (req.query.worker_id) q = q.eq('worker_id', req.query.worker_id)
      if (req.query.type)      q = q.eq('type', req.query.type)
      if (req.query.status)    q = q.eq('status', req.query.status)
      if (req.query.from)      q = q.gte('report_date', req.query.from)
      if (req.query.to)        q = q.lte('report_date', req.query.to)
      return q
    }

    let { data, error } = await build(fullCols)
    if (error && /column .* does not exist|attachments|site_name|work_content/i.test(error.message || '')) {
      ;({ data, error } = await build(baseCols))
    }
    if (error) return res.status(500).json({ ok: false, error: error.message })

    const rows = data || []
    const ids = rows.map(r => r.id)

    // コメント数を集計（migration 012 未適用なら空）
    const commentCount = {}
    if (ids.length) {
      try {
        const { data: cs } = await sb.from('report_comments')
          .select('report_id').in('report_id', ids)
        ;(cs || []).forEach(c => { commentCount[c.report_id] = (commentCount[c.report_id] || 0) + 1 })
      } catch {}
    }

    // DB値(pending/reviewed/returned)をそのまま返す。旧 'reviewed' も互換
    const reports = rows.map(r => {
      const atts = Array.isArray(r.attachments) ? r.attachments : []
      const imageCount = atts.filter(a => a && a.type === 'image').length
      return {
        id:          r.id,
        wid:         r.worker_id,
        author:      r.workers?.name || '不明',
        lang:        r.workers?.language || 'vi',
        date:        (r.report_date || '').replace(/-/g, '/'),
        type:        r.type,
        status:      r.status || 'pending',
        original:    r.content,
        translated:  r.translated || r.content,
        title:       (r.translated || r.content || '').slice(0, 30),
        site_name:   r.site_name || '',
        work_content:r.work_content || '',
        attachments: atts,
        imageCount,
        commentCount: commentCount[r.id] || 0,
        created_at:  r.created_at,
      }
    })

    res.json({ ok: true, reports })
  } catch (e) {
    console.error('[daily-reports list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /app/api/daily-reports/:id — 詳細（コメント + 承認履歴つき）
router.get('/api/daily-reports/:id', requireAuth, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })

    const sb = createAdminClient()
    const fullCols = `id, report_date, type, content, translated, status, created_at,
               site_name, work_content, attachments, reviewed_at, reviewed_by,
               worker_id, workers(name, language, department, job_title)`
    const baseCols = `id, report_date, type, content, translated, status, created_at,
               worker_id, workers(name, language, department, job_title)`
    let { data: r, error } = await sb.from('daily_reports')
      .select(fullCols).eq('id', id).eq('company_id', companyId).maybeSingle()
    // 012未適用（拡張カラム無し）→ 基本カラムで再試行
    if (error && /column .* does not exist|site_name|work_content|attachments|reviewed_/i.test(error.message || '')) {
      ;({ data: r, error } = await sb.from('daily_reports')
        .select(baseCols).eq('id', id).eq('company_id', companyId).maybeSingle())
    }
    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!r) return res.status(404).json({ ok: false, error: 'not_found' })

    // コメント・履歴（テーブル未作成なら空配列にフォールバック）
    const safe = (b) => Promise.resolve(b).then(x => x).catch(() => ({ data: [] }))
    const [cRes, hRes] = await Promise.all([
      safe(sb.from('report_comments').select('*').eq('report_id', id).order('created_at', { ascending: true })),
      safe(sb.from('report_status_history').select('*').eq('report_id', id).order('created_at', { ascending: true })),
    ])
    const comments = cRes.data || []
    const history  = hRes.data || []

    res.json({
      ok: true,
      report: {
        id: r.id, wid: r.worker_id,
        author: r.workers?.name || '不明',
        lang: r.workers?.language || 'vi',
        department: r.workers?.department || '',
        job_title: r.workers?.job_title || '',
        date: (r.report_date || '').replace(/-/g, '/'),
        type: r.type, status: r.status || 'pending',
        original: r.content, translated: r.translated || r.content,
        site_name: r.site_name || '', work_content: r.work_content || '',
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        reviewed_at: r.reviewed_at, created_at: r.created_at,
      },
      comments: comments || [],
      history: history || [],
    })
  } catch (e) {
    console.error('[daily-report detail]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /app/api/daily-reports/:id/comments — 管理者コメント追加
router.post('/api/daily-reports/:id/comments', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const body = (req.body?.body || '').trim()
    if (!body) return res.status(400).json({ ok: false, error: 'コメントを入力してください' })

    const sb = createAdminClient()
    const { data, error } = await sb.from('report_comments').insert({
      company_id: companyId, report_id: id,
      author_id: req.user?.id,
      author_name: req.profile?.full_name || '管理者',
      body,
    }).select('*').single()
    if (error) return res.status(500).json({ ok: false, error: error.message })

    // ワーカーへ通知
    try {
      const { data: rep } = await sb.from('daily_reports').select('worker_id').eq('id', id).maybeSingle()
      if (rep?.worker_id) {
        const notif = {
          company_id: companyId, worker_id: rep.worker_id,
          title: '💬 日報にコメントが届きました',
          body: body.slice(0, 60), type: 'info',
        }
        await sb.from('notifications').insert(notif)
        push.sendFromNotification({ ...notif, url: '/worker?tab=daily' }).catch(()=>{})
      }
    } catch {}

    res.json({ ok: true, comment: data })
  } catch (e) {
    console.error('[daily-report comment]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// PUT /app/api/daily-reports/:id  — ステータス更新（確認済み/差戻し）+ 履歴記録
//   status: pending|reviewed|returned （旧 'approved' は 'reviewed' に正規化）
router.put('/api/daily-reports/:id', requireAuth, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    let { status, note } = req.body
    if (!status) return res.status(400).json({ ok: false, error: 'status は必須です' })
    // 旧UI互換: approved→reviewed / review→pending
    if (status === 'approved') status = 'reviewed'
    if (status === 'review')   status = 'pending'
    if (!['pending', 'reviewed', 'returned'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'status が不正です' })
    }

    const sbAdmin = createAdminClient()
    const { data: rep } = await sbAdmin
      .from('daily_reports').select('worker_id, report_date, status').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (!rep) return res.status(404).json({ ok: false, error: 'not_found' })

    const fromStatus = rep.status || 'pending'
    const update = { status }
    if (status === 'reviewed') {
      update.reviewed_at = new Date().toISOString()
      update.reviewed_by = req.user?.id
    }

    let { error } = await sbAdmin
      .from('daily_reports').update(update).eq('id', id).eq('company_id', companyId)
    // reviewed_at/by カラムが無い(012未適用)場合は status だけで再試行
    if (error && /column .* does not exist|reviewed_/i.test(error.message || '')) {
      ;({ error } = await sbAdmin.from('daily_reports').update({ status }).eq('id', id).eq('company_id', companyId))
    }
    if (error) return res.status(500).json({ ok: false, error: error.message })

    // 承認履歴を記録（テーブル未作成なら無視）
    try {
      await sbAdmin.from('report_status_history').insert({
        company_id: companyId, report_id: id,
        actor_id: req.user?.id, actor_name: req.profile?.full_name || '管理者',
        from_status: fromStatus, to_status: status, note: note || null,
      })
    } catch {}

    // ワーカーへ通知
    const label = status === 'reviewed' ? '✅ 日報が確認されました'
                : status === 'returned' ? '↩️ 日報が差戻しされました' : '日報のステータスが更新されました'
    const notif = {
      company_id: companyId, worker_id: rep.worker_id,
      title: label, body: `${rep.report_date} の日報`,
      type: status === 'returned' ? 'alert' : 'approval',
    }
    try { await sbAdmin.from('notifications').insert(notif) } catch {}
    push.sendFromNotification({ ...notif, url: '/worker?tab=daily' }).catch(()=>{})

    res.json({ ok: true })
  } catch (e) {
    console.error('[daily-report status]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── ホームタイムライン: 今日の出来事を統合 ─────────────────────────
// GET /app/api/home/activity
//   勤怠(打刻) / 日報 / シフト申請 / 通知 を統合して時系列で返す
router.get('/api/home/activity', requireAuth, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, events: [] })

    const sb = createAdminClient()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const safe = (b, fb = { data: [] }) => Promise.resolve(b).then(r => r).catch(() => fb)
    const [att, reports, shiftReqs] = await Promise.all([
      safe(sb.from('attendance_records')
        .select('id, work_date, clock_in, clock_out, status, worker_id, workers(name)')
        .eq('company_id', companyId)
        .eq('work_date', today)
        .order('clock_in', { ascending: false, nullsFirst: false })
        .limit(15)),
      safe(sb.from('daily_reports')
        .select('id, type, status, created_at, content, worker_id, workers(name)')
        .eq('company_id', companyId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(10)),
      safe(sb.from('shift_requests')
        .select('id, date, shift_type, status, created_at, worker_id, workers(name)')
        .eq('company_id', companyId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(10)),
    ])

    const events = []
    ;(att.data || []).forEach(a => {
      const name = a.workers?.name || '実習生'
      if (a.clock_in) events.push({
        time: a.clock_in, type: 'attendance',
        icon: '✓', color: a.status === 'late' ? 'warn' : 'success',
        actor: name,
        action: a.status === 'late' ? '遅刻出勤しました' : '出勤しました',
        typeLabel: '勤怠',
      })
      if (a.clock_out) events.push({
        time: a.clock_out, type: 'attendance',
        icon: '⏏', color: 'muted',
        actor: name, action: '退勤しました',
        typeLabel: '勤怠',
      })
    })
    ;(reports.data || []).forEach(r => {
      const name = r.workers?.name || '実習生'
      events.push({
        time: r.created_at, type: 'report',
        icon: r.type === 'hayari' ? '⚠' : '📝',
        color:  r.type === 'hayari' ? 'alert' : 'info',
        actor: name,
        action: r.type === 'hayari' ? 'ヒヤリ・ハットを報告' : '日報を提出',
        typeLabel: r.type === 'hayari' ? 'ヒヤリ' : '日報',
      })
    })
    ;(shiftReqs.data || []).forEach(s => {
      const name = s.workers?.name || '実習生'
      events.push({
        time: s.created_at, type: 'shift',
        icon: '🗓', color: 'warn',
        actor: name,
        action: `${s.date} ${s.shift_type} を申請`,
        typeLabel: 'シフト',
      })
    })

    events.sort((a, b) => new Date(b.time) - new Date(a.time))
    res.json({ ok: true, events: events.slice(0, 15) })
  } catch (e) {
    console.error('[/api/home/activity] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 管理者向け統合チャットポーリング ────────────────────────────
// GET /app/api/messages/recent?since=ISO
router.get('/api/messages/recent', requireAuth, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, messages: [] })

    const since = req.query.since
      || new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const sb = createAdminClient()
    const fullCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at, attachment_url, attachment_path, attachment_type, attachment_mime, attachment_name, attachment_size'
    const baseCols = 'id, sender_id, receiver_id, body, translated, is_read, created_at'

    const baseQ = (cols) => sb.from('messages').select(cols)
      .eq('company_id', companyId)
      .gt('created_at', since)
      .order('created_at', { ascending: true })
      .limit(200)

    let { data, error } = await baseQ(fullCols)
    if (error && /column .* does not exist|attachment_/i.test(error.message || '')) {
      ;({ data, error } = await baseQ(baseCols))
    }
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true, messages: data || [] })
  } catch (e) {
    console.error('[/api/messages/recent] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── チャット添付アップロード ──────────────────────────────────────
// POST /app/api/chat/upload — 管理者から画像/ファイル
const _chatUploadAdmin = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})
router.post('/api/chat/upload', requireAuth, requireAdmin, _chatUploadAdmin.single('file'), async (req, res) => {
  const companyId = req.profile?.company_id
  const userId    = req.user?.id
  if (!req.file) return res.status(400).json({ ok: false, error: 'file is required' })

  const mime    = req.file.mimetype || 'application/octet-stream'
  const isImage = mime.startsWith('image/')
  const ext     = path.extname(req.file.originalname || '').toLowerCase() || (isImage ? '.jpg' : '.bin')
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`
  const storagePath = `chat/${companyId}/${userId}/${safeName}`

  try {
    const sb = createAdminClient()
    const { error: upErr } = await sb.storage
      .from('documents')
      .upload(storagePath, req.file.buffer, { contentType: mime, upsert: false })
    if (upErr) {
      console.error('[chat upload admin]', upErr.message)
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
    console.error('[chat upload admin] exception:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── チャット履歴 CSV エクスポート ────────────────────────────────
// GET /app/api/messages/export.csv?worker_user_id=&from=&to=
//   worker_user_id 省略時 = 会社の全チャット
router.get('/api/messages/export.csv', requireAuth, requireAdmin, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.status(403).send('forbidden')

  const sb = createAdminClient()
  let q = sb.from('messages')
    .select(`
      id, sender_id, receiver_id, body, translated, is_read, created_at,
      attachment_name, attachment_type, attachment_url
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })
    .limit(5000)

  if (req.query.worker_user_id) {
    const wid = req.query.worker_user_id
    q = q.or(`sender_id.eq.${wid},receiver_id.eq.${wid}`)
  }
  if (req.query.from) q = q.gte('created_at', req.query.from)
  if (req.query.to)   q = q.lte('created_at', req.query.to)

  const { data: msgs = [], error } = await q
  if (error) return res.status(500).send('error: ' + error.message)

  // 送受信者の氏名解決用に profiles を一括取得
  const userIds = Array.from(new Set(msgs.flatMap(m => [m.sender_id, m.receiver_id]).filter(Boolean)))
  let profileMap = {}
  if (userIds.length) {
    const { data: profs } = await sb.from('profiles')
      .select('id, full_name, role')
      .in('id', userIds)
    profileMap = Object.fromEntries((profs || []).map(p => [p.id, p]))
  }

  const escape = v => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const headers = ['日時(JST)', '送信者', '送信者ロール', '受信者', '受信者ロール', 'メッセージ', '翻訳', '添付ファイル', '既読']
  const rows = msgs.map(m => {
    const dt = new Date(m.created_at)
    const jst = dt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
    const sndP = profileMap[m.sender_id]
    const rcvP = m.receiver_id ? profileMap[m.receiver_id] : null
    return [
      jst,
      sndP?.full_name || m.sender_id || '',
      sndP?.role || '',
      rcvP?.full_name || m.receiver_id || '(全社/未指定)',
      rcvP?.role || '',
      m.body || '',
      m.translated || '',
      m.attachment_name || (m.attachment_type === 'image' ? '【画像】' : ''),
      m.is_read ? '既読' : '未読',
    ].map(escape).join(',')
  })
  const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n')

  const fname = `chat_${req.query.worker_user_id ? req.query.worker_user_id.slice(0,8) + '_' : ''}${new Date().toISOString().slice(0,10)}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`)
  res.send(csv)
})

// ════════════════════════════════════════════════════════════════
// 💴 給与計算 API（Payroll）
// ════════════════════════════════════════════════════════════════

// period 'YYYY-MM' の月初・翌月初を JST で算出（attendance 抽出用）
function periodRange(period) {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return null
  const from = `${y}-${String(m).padStart(2,'0')}-01`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const to = `${ny}-${String(nm).padStart(2,'0')}-01`
  return { from, to }
}

// 賃金設定を取得（なければ default を返す）
async function getWageForWorker(sb, companyId, workerId) {
  const { data } = await sb.from('wage_settings')
    .select('*')
    .eq('company_id', companyId)
    .eq('worker_id', workerId)
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data || defaultWage(companyId, workerId)
}

// ── GET /app/api/wage/:workerId — 賃金設定取得 ───────────────────
router.get('/api/wage/:workerId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId  = req.params.workerId
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })

    const sb = createAdminClient()
    const wage = await getWageForWorker(sb, companyId, workerId)
    res.json({ ok: true, wage })
  } catch (e) {
    console.error('[wage get]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── PUT /app/api/wage/:workerId — 賃金設定保存（upsert）──────────
router.put('/api/wage/:workerId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId  = req.params.workerId
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })

    const b = req.body || {}
    const row = {
      company_id: companyId,
      worker_id:  workerId,
      wage_type:  b.wage_type === 'monthly' ? 'monthly' : 'hourly',
      base_amount:   Number(b.base_amount)   || 0,
      overtime_rate: Number(b.overtime_rate) || 1.25,
      night_rate:    Number(b.night_rate)    || 1.25,
      holiday_rate:  Number(b.holiday_rate)  || 1.35,
      monthly_standard_hours: Number(b.monthly_standard_hours) || 160,
      break_minutes: Number.isFinite(+b.break_minutes) ? +b.break_minutes : 60,
      rounding_unit: Number.isFinite(+b.rounding_unit) ? +b.rounding_unit : 15,
      rounding_mode: ['floor','round','ceil'].includes(b.rounding_mode) ? b.rounding_mode : 'floor',
      allowances: Array.isArray(b.allowances) ? b.allowances : [],
      deductions: Array.isArray(b.deductions) ? b.deductions : [],
      is_active: true,
    }

    const sb = createAdminClient()
    // 既存 active を取得して upsert（1ワーカー1 active 運用）
    const { data: existing } = await sb.from('wage_settings')
      .select('id').eq('company_id', companyId).eq('worker_id', workerId).eq('is_active', true)
      .limit(1).maybeSingle()

    let result
    if (existing) {
      result = await sb.from('wage_settings').update(row).eq('id', existing.id).select('*').single()
    } else {
      result = await sb.from('wage_settings').insert(row).select('*').single()
    }
    if (result.error) return res.status(500).json({ ok: false, error: result.error.message })
    res.json({ ok: true, wage: result.data })
  } catch (e) {
    console.error('[wage put]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── GET /app/api/payroll/preview?period=YYYY-MM[&worker_id=] ──────
// 計算プレビュー（DB保存なし）。worker_id 省略時は全員。
router.get('/api/payroll/preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const period = req.query.period
    if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ ok: false, error: 'period は YYYY-MM 形式です' })
    const range = periodRange(period)
    if (!range) return res.status(400).json({ ok: false, error: 'period が不正です' })

    const sb = createAdminClient()
    // 対象ワーカー
    let wq = sb.from('workers').select('id, name, company_id').eq('company_id', companyId).eq('status', 'active')
    if (req.query.worker_id) {
      if (!isUuid(req.query.worker_id)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })
      wq = wq.eq('id', req.query.worker_id)
    }
    const { data: workers = [] } = await wq

    // 既存 payslip（status）も合わせて返す
    const { data: existingSlips = [] } = await sb.from('payslips')
      .select('worker_id, status, id').eq('company_id', companyId).eq('period', period)
    const slipMap = Object.fromEntries((existingSlips || []).map(s => [s.worker_id, s]))

    const results = []
    for (const w of workers) {
      const wage = await getWageForWorker(sb, companyId, w.id)
      const { data: recs = [] } = await sb.from('attendance_records')
        .select('work_date, clock_in, clock_out, status')
        .eq('company_id', companyId).eq('worker_id', w.id)
        .gte('work_date', range.from).lt('work_date', range.to)
      const calc = calcPayroll({ worker: w, wage, records: recs, period })
      results.push({
        worker: { id: w.id, name: w.name },
        wageConfigured: (wage.base_amount || 0) > 0,
        existing: slipMap[w.id] ? { id: slipMap[w.id].id, status: slipMap[w.id].status } : null,
        ...calc,
      })
    }
    res.json({ ok: true, period, results })
  } catch (e) {
    console.error('[payroll preview]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/payroll/confirm — 月次確定 → payslips保存 + 勤怠lock ──
// body: { period, worker_ids: [] }  worker_ids 省略時は全員
router.post('/api/payroll/confirm', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const adminId   = req.user?.id
    const { period } = req.body || {}
    if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ ok: false, error: 'period は YYYY-MM 形式です' })
    const range = periodRange(period)

    const sb = createAdminClient()
    let wq = sb.from('workers').select('id, name, company_id').eq('company_id', companyId).eq('status', 'active')
    const ids = Array.isArray(req.body?.worker_ids) ? req.body.worker_ids.filter(isUuid) : null
    if (ids && ids.length) wq = wq.in('id', ids)
    const { data: workers = [] } = await wq

    const confirmed = []
    const skipped = []
    for (const w of workers) {
      // 既に confirmed/published なら immutable のためスキップ
      const { data: ex } = await sb.from('payslips')
        .select('id, status').eq('company_id', companyId).eq('worker_id', w.id).eq('period', period).maybeSingle()
      if (ex && (ex.status === 'confirmed' || ex.status === 'published')) {
        skipped.push({ worker_id: w.id, reason: 'already_' + ex.status })
        continue
      }

      const wage = await getWageForWorker(sb, companyId, w.id)
      if (!(wage.base_amount > 0)) { skipped.push({ worker_id: w.id, reason: 'no_wage' }); continue }

      const { data: recs = [] } = await sb.from('attendance_records')
        .select('id, work_date, clock_in, clock_out, status')
        .eq('company_id', companyId).eq('worker_id', w.id)
        .gte('work_date', range.from).lt('work_date', range.to)
      const calc = calcPayroll({ worker: w, wage, records: recs, period })

      const row = {
        ...calc,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: adminId,
      }

      let saved
      if (ex) {
        // draft を上書き確定
        saved = await sb.from('payslips').update(row).eq('id', ex.id).select('id').single()
      } else {
        saved = await sb.from('payslips').insert(row).select('id').single()
      }
      if (saved.error) { skipped.push({ worker_id: w.id, reason: saved.error.message }); continue }

      // 勤怠ロック（締め）
      const recIds = recs.map(r => r.id)
      if (recIds.length) {
        await sb.from('attendance_records')
          .update({ locked: true, locked_at: new Date().toISOString() })
          .in('id', recIds)
      }
      confirmed.push({ worker_id: w.id, payslip_id: saved.data.id })
    }

    res.json({ ok: true, period, confirmed, skipped })
  } catch (e) {
    console.error('[payroll confirm]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/payslips/:id/publish — ワーカーへ公開 ───────────
router.post('/api/payslips/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })

    const sb = createAdminClient()
    const { data: slip } = await sb.from('payslips').select('id, status, company_id').eq('id', id).maybeSingle()
    if (!slip || slip.company_id !== companyId) return res.status(404).json({ ok: false, error: 'not_found' })
    if (slip.status === 'draft') return res.status(400).json({ ok: false, error: '確定前の明細は公開できません' })

    const { error } = await sb.from('payslips')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true })
  } catch (e) {
    console.error('[payslip publish]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── GET /app/api/payslips?period=YYYY-MM — 月次明細一覧 ──────────
router.get('/api/payslips', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const sb = createAdminClient()
    let q = sb.from('payslips')
      .select('*, workers(name)')
      .eq('company_id', companyId)
      .order('period', { ascending: false })
      .limit(500)
    if (req.query.period) q = q.eq('period', req.query.period)
    if (req.query.worker_id && isUuid(req.query.worker_id)) q = q.eq('worker_id', req.query.worker_id)
    const { data, error } = await q
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true, payslips: data || [] })
  } catch (e) {
    console.error('[payslips list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── GET /app/api/payslips/:id — 単一明細（詳細・印刷用）──────────
router.get('/api/payslips/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = createAdminClient()
    const { data, error } = await sb.from('payslips')
      .select('*, workers(name, name_kana, department, job_title)')
      .eq('id', id).eq('company_id', companyId).maybeSingle()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!data) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, payslip: data })
  } catch (e) {
    console.error('[payslip get]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ════════════════════════════════════════════════════════════════
// 🌐 翻訳辞書 管理 API（Phase2: 翻訳精度向上）
//   会社辞書(company_dictionaries) は管理者が CRUD。
//   業界辞書(industry_dictionaries) は会社横断の共通辞書で参照のみ。
//   translationService の優先順位: 会社辞書 → 業界辞書 → cache → API
//   ※ migration 011 未適用環境ではテーブル不在を 503 で明示（画面側で案内）
// ════════════════════════════════════════════════════════════════

// 対応言語（UIのプルダウンと一致させる）
const DICT_LANGS = ['ja', 'vi', 'id', 'tl', 'zh', 'my', 'en']

// GET /app/api/dictionaries?source=&target=&q= — 会社辞書一覧（+業界辞書も返す）
router.get('/api/dictionaries', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, company: [], industry: [] })

    const sb = createAdminClient()
    const { source, target, q } = req.query

    let cq = sb.from('company_dictionaries')
      .select('id, source_lang, target_lang, source_text, target_text, note, updated_at')
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(1000)
    if (source) cq = cq.eq('source_lang', source)
    if (target) cq = cq.eq('target_lang', target)
    if (q)      cq = cq.or(`source_text.ilike.%${q}%,target_text.ilike.%${q}%`)

    let { data: company, error } = await cq
    if (error) {
      if (isTableMissing(error))
        return res.status(503).json({ ok: false, error: 'migration_011_required', detail: '翻訳辞書テーブルが未作成です（migration 011 を実行してください）' })
      return res.status(500).json({ ok: false, error: error.message })
    }

    // 業界辞書（会社横断・参照のみ）。件数は控えめに。
    let industry = []
    try {
      let iq = sb.from('industry_dictionaries')
        .select('id, industry, source_lang, target_lang, source_text, target_text')
        .order('source_text', { ascending: true })
        .limit(500)
      if (source) iq = iq.eq('source_lang', source)
      if (target) iq = iq.eq('target_lang', target)
      if (q)      iq = iq.or(`source_text.ilike.%${q}%,target_text.ilike.%${q}%`)
      const { data } = await iq
      industry = data || []
    } catch {}

    res.json({ ok: true, company: company || [], industry, langs: DICT_LANGS })
  } catch (e) {
    console.error('[dict list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// 入力バリデーション（辞書1件分）
function validateDictRow(b) {
  const source_lang = String(b.source_lang || '').trim()
  const target_lang = String(b.target_lang || '').trim()
  const source_text = String(b.source_text || '').trim()
  const target_text = String(b.target_text || '').trim()
  const note        = b.note != null ? String(b.note).trim() : null
  if (!DICT_LANGS.includes(source_lang)) return { error: '原文の言語が不正です' }
  if (!DICT_LANGS.includes(target_lang)) return { error: '訳文の言語が不正です' }
  if (source_lang === target_lang)       return { error: '原文と訳文の言語が同じです' }
  if (!source_text)                      return { error: '原文を入力してください' }
  if (!target_text)                      return { error: '訳文を入力してください' }
  if (source_text.length > 500 || target_text.length > 500) return { error: '500文字以内で入力してください' }
  return { row: { source_lang, target_lang, source_text, target_text, note } }
}

// POST /app/api/dictionaries — 会社辞書 追加（upsert: 同一 source なら訳を更新）
router.post('/api/dictionaries', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const v = validateDictRow(req.body || {})
    if (v.error) return res.status(400).json({ ok: false, error: v.error })

    const sb = createAdminClient()
    const { data, error } = await sb.from('company_dictionaries')
      .upsert({ company_id: companyId, ...v.row },
              { onConflict: 'company_id,source_lang,target_lang,source_text' })
      .select('id, source_lang, target_lang, source_text, target_text, note, updated_at')
      .single()
    if (error) {
      if (isTableMissing(error))
        return res.status(503).json({ ok: false, error: 'migration_011_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    res.json({ ok: true, entry: data })
  } catch (e) {
    console.error('[dict create]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// PUT /app/api/dictionaries/:id — 会社辞書 更新（訳文・備考のみ。キー項目は不変）
router.put('/api/dictionaries/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const target_text = String(req.body?.target_text || '').trim()
    if (!target_text) return res.status(400).json({ ok: false, error: '訳文を入力してください' })
    if (target_text.length > 500) return res.status(400).json({ ok: false, error: '500文字以内で入力してください' })
    const note = req.body?.note != null ? String(req.body.note).trim() : null

    const sb = createAdminClient()
    const { data, error } = await sb.from('company_dictionaries')
      .update({ target_text, note })
      .eq('id', id).eq('company_id', companyId)   // 自社のみ
      .select('id, source_lang, target_lang, source_text, target_text, note, updated_at')
      .maybeSingle()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!data) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, entry: data })
  } catch (e) {
    console.error('[dict update]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// DELETE /app/api/dictionaries/:id — 会社辞書 削除
router.delete('/api/dictionaries/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = createAdminClient()
    const { error } = await sb.from('company_dictionaries')
      .delete().eq('id', id).eq('company_id', companyId)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true })
  } catch (e) {
    console.error('[dict delete]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router

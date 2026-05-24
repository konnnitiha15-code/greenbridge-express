const express = require('express')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const { createClient: _createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
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

    res.render('spa', { workers, docs, gbUser, companyName, profile: req.profile, user: req.user })
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

  const { error } = await req.supabase
    .from('shift_requests')
    .update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
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

// attendance_records 行 → フロント形式
function mapAttendance(r) {
  const w  = r.workers || {}
  const ci = r.clock_in  ? String(r.clock_in).slice(11, 16)  : null
  const co = r.clock_out ? String(r.clock_out).slice(11, 16) : null
  let workMins = null
  if (ci && co) {
    const [ch, cm] = ci.split(':').map(Number)
    const [oh, om] = co.split(':').map(Number)
    workMins = (oh * 60 + om) - (ch * 60 + cm)
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
  const { worker_user_id, body } = req.body

  if (!worker_user_id || !body?.trim())
    return res.status(400).json({ error: 'worker_user_id と body は必須です' })

  const { data, error } = await createAdminClient()
    .from('messages')
    .insert({
      company_id:  companyId,
      sender_id:   adminUserId,
      receiver_id: worker_user_id,
      body:        body.trim(),
    })
    .select('id, created_at')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, message: data })
})

// GET /app/api/messages?worker_user_id=xxx&after=ISO — 管理者とワーカー間のメッセージ取得
router.get('/api/messages', requireAuth, requireAdmin, async (req, res) => {
  const companyId   = req.profile?.company_id
  const adminUserId = req.user?.id
  const { worker_user_id, after } = req.query

  if (!worker_user_id)
    return res.status(400).json({ error: 'worker_user_id は必須です' })

  let query = createAdminClient()
    .from('messages')
    .select('id, sender_id, receiver_id, body, translated, is_read, created_at')
    .eq('company_id', companyId)
    .or(
      `and(sender_id.eq.${adminUserId},receiver_id.eq.${worker_user_id}),` +
      `and(sender_id.eq.${worker_user_id},receiver_id.eq.${adminUserId})`
    )
    .order('created_at', { ascending: true })
    .limit(100)

  if (after) query = query.gt('created_at', after)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  // 未読を既読に更新（管理者が読んだので）
  const unreadIds = (data || [])
    .filter(m => m.sender_id === worker_user_id && !m.is_read)
    .map(m => m.id)
  if (unreadIds.length) {
    await createAdminClient()
      .from('messages')
      .update({ is_read: true })
      .in('id', unreadIds)
      .catch(() => {})
  }

  res.json({ ok: true, messages: data || [] })
})

// ── 日報 API（Admin用） ──────────────────────────────────────────
// GET /app/api/daily-reports?worker_id=&type=&status=
router.get('/api/daily-reports', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) return res.json({ ok: true, reports: [] })

  let query = req.supabase
    .from('daily_reports')
    .select(`
      id, report_date, type, content, translated, status, created_at,
      worker_id, workers(name, language)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (req.query.worker_id) query = query.eq('worker_id', req.query.worker_id)
  if (req.query.type)      query = query.eq('type', req.query.type)
  if (req.query.status)    query = query.eq('status', req.query.status)

  const { data, error } = await query
  if (error) return res.status(500).json({ ok: false, error: error.message })

  const reports = (data || []).map(r => ({
    id:          r.id,
    wid:         r.worker_id,
    author:      r.workers?.name || '不明',
    date:        (r.report_date || '').replace(/-/g, '/'),
    type:        r.type,
    status:      r.status,
    original:    r.content,
    translated:  r.translated || r.content,
    title:       r.translated?.slice(0, 30) || r.content?.slice(0, 30) || '',
    created_at:  r.created_at,
  }))

  res.json({ ok: true, reports })
})

// PUT /app/api/daily-reports/:id  — ステータス更新（承認など）
router.put('/api/daily-reports/:id', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  const { status } = req.body
  if (!status) return res.status(400).json({ error: 'status は必須です' })

  const { error } = await req.supabase
    .from('daily_reports')
    .update({ status })
    .eq('id', req.params.id)
    .eq('company_id', companyId)

  if (error) return res.status(500).json({ ok: false, error: error.message })
  res.json({ ok: true })
})

module.exports = router

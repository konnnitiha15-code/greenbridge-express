// ============================================================
// GreenBridge — 外国人雇用書類（在留資格届出）API（Phase9・管理者側）
//   /app/api/filings/* にマウント（requireAuth + requireAdmin）
//   在留資格別の入管・行政への定型届出を 提出期限/履歴/繰り返し で管理。
//   未適用(019)時は 503 migration_019_required。フロントは「準備中」表示。
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const { isUuid }       = require('../lib/validate')
const fl               = require('../lib/filings')
const push             = require('../lib/push')

const router = express.Router()
router.use(requireAuth, requireAdmin)

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
}

// 019未適用（テーブル不在）判定
const isFilingMissing = err =>
  err && (err.code === '42P01' || /employment_filings|does not exist|schema cache/i.test(err.message || ''))

function sendErr(res, err, ctx) {
  if (isFilingMissing(err)) return res.status(503).json({ ok: false, error: 'migration_019_required' })
  console.error(`[filings ${ctx}]`, err.message || err)
  return res.status(500).json({ ok: false, error: err.message || 'error' })
}

// 行を整形（pending+due_date に期限レベルを付与）
function decorate(row, today) {
  const cat = fl.CATEGORY_LABEL[row.visa_category] || row.visa_category
  let days = null, level = null
  if (row.status === 'pending') {
    days = fl.daysUntil(row.due_date, today)
    level = fl.expireLevel(days)
  }
  return {
    ...row,
    category_label: cat,
    due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
    submitted_date: row.submitted_date ? String(row.submitted_date).slice(0, 10) : null,
    days, level,
  }
}

// ── GET /app/api/filings — 一覧（?status=&visa_category=&worker_id=）─
router.get('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, rows: [], stats: {}, open_count: 0 })
    const sb = adminClient()

    let q = sb.from('employment_filings')
      .select('*, workers(name, nationality)')
      .eq('company_id', companyId).limit(1000)
    if (fl.VISA_CATEGORIES.includes(req.query.visa_category)) q = q.eq('visa_category', req.query.visa_category)
    if (fl.STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status)
    if (isUuid(req.query.worker_id || '')) q = q.eq('worker_id', req.query.worker_id)

    const { data, error } = await q
    if (error) return sendErr(res, error, 'list')

    const today = fl.todayJst()
    const rows = (data || []).map(r => decorate(r, today))
    // 期限の近い順（pending の days 昇順 → submitted/未設定は末尾）
    rows.sort((a, b) => {
      if (a.days == null && b.days == null) return 0
      if (a.days == null) return 1
      if (b.days == null) return -1
      return a.days - b.days
    })
    const stats = { expired: 0, urgent: 0, warn: 0, ok: 0, submitted: 0, not_required: 0 }
    rows.forEach(r => {
      if (r.status === 'submitted') stats.submitted++
      else if (r.status === 'not_required') stats.not_required++
      else if (r.level) stats[r.level]++
    })
    const openCount = rows.filter(r => r.status === 'pending').length
    res.json({ ok: true, rows, stats, open_count: openCount })
  } catch (e) { sendErr(res, e, 'list') }
})

// ── GET /app/api/filings/templates — 標準届出テンプレート ──────────
router.get('/templates', async (req, res) => {
  res.json({
    ok: true,
    categories: fl.VISA_CATEGORIES,
    category_label: fl.CATEGORY_LABEL,
    templates: fl.FILING_TEMPLATES,
    recurrence: fl.RECURRENCE,
  })
})

// ── GET /app/api/filings/:id — 詳細 + 同ワーカーの履歴 ─────────────
router.get('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()

    const { data: row, error } = await sb.from('employment_filings')
      .select('*, workers(name, nationality)')
      .eq('id', id).eq('company_id', companyId).maybeSingle()
    if (error) return sendErr(res, error, 'detail')
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' })

    // 同ワーカーの提出履歴
    const { data: history } = await sb.from('employment_filings')
      .select('id, filing_type, title, submitted_date, submitted_to, reference_no, status')
      .eq('company_id', companyId).eq('worker_id', row.worker_id).eq('status', 'submitted')
      .order('submitted_date', { ascending: false }).limit(100)

    res.json({ ok: true, filing: decorate(row, fl.todayJst()), history: history || [] })
  } catch (e) { sendErr(res, e, 'detail') }
})

// ── POST /app/api/filings — 作成 ─────────────────────────────────
//   body: { worker_id, visa_category, filing_type, title?, due_date?, recurrence?, submitted_to?, note? }
router.post('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const { worker_id } = req.body || {}
    if (!isUuid(worker_id || '')) return res.status(400).json({ ok: false, error: 'ワーカーを選択してください' })
    const visa_category = fl.VISA_CATEGORIES.includes(req.body?.visa_category) ? req.body.visa_category : 'other'
    const filing_type = String(req.body?.filing_type || '').trim()
    if (!filing_type) return res.status(400).json({ ok: false, error: '届出名を入力してください' })
    const recurrence = fl.RECURRENCE.includes(req.body?.recurrence) ? req.body.recurrence : 'none'
    const sb = adminClient()

    const { data: w } = await sb.from('workers').select('id').eq('id', worker_id).eq('company_id', companyId).maybeSingle()
    if (!w) return res.status(404).json({ ok: false, error: 'ワーカーが見つかりません' })

    const { data, error } = await sb.from('employment_filings').insert({
      company_id: companyId, worker_id, visa_category, filing_type,
      title: String(req.body?.title || '').trim() || filing_type,
      due_date: req.body?.due_date || null,
      submitted_to: req.body?.submitted_to ? String(req.body.submitted_to).trim() : null,
      recurrence, note: req.body?.note || null, created_by: req.user?.id,
    }).select('*').single()
    if (error) return sendErr(res, error, 'create')
    res.json({ ok: true, id: data.id, item: data })
  } catch (e) { sendErr(res, e, 'create') }
})

// ── PUT /app/api/filings/:id — 更新 ──────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const patch = {}
    if (req.body?.title !== undefined) {
      const t = String(req.body.title || '').trim()
      if (!t) return res.status(400).json({ ok: false, error: 'タイトルは必須です' })
      patch.title = t
    }
    if (req.body?.filing_type !== undefined) {
      const ft = String(req.body.filing_type || '').trim()
      if (!ft) return res.status(400).json({ ok: false, error: '届出名は必須です' })
      patch.filing_type = ft
    }
    if (req.body?.visa_category !== undefined && fl.VISA_CATEGORIES.includes(req.body.visa_category)) patch.visa_category = req.body.visa_category
    if (req.body?.status !== undefined) {
      if (!fl.STATUSES.includes(req.body.status)) return res.status(400).json({ ok: false, error: 'status が不正です' })
      patch.status = req.body.status
    }
    if (req.body?.recurrence !== undefined && fl.RECURRENCE.includes(req.body.recurrence)) patch.recurrence = req.body.recurrence
    if (req.body?.due_date !== undefined)       patch.due_date = req.body.due_date || null
    if (req.body?.submitted_date !== undefined) patch.submitted_date = req.body.submitted_date || null
    if (req.body?.submitted_to !== undefined)   patch.submitted_to = req.body.submitted_to ? String(req.body.submitted_to).trim() : null
    if (req.body?.reference_no !== undefined)   patch.reference_no = req.body.reference_no ? String(req.body.reference_no).trim() : null
    if (req.body?.note !== undefined)           patch.note = req.body.note || null
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: '更新内容がありません' })

    const sb = adminClient()
    const { data, error } = await sb.from('employment_filings')
      .update(patch).eq('id', id).eq('company_id', companyId).select('*').maybeSingle()
    if (error) return sendErr(res, error, 'update')
    if (!data) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, item: data })
  } catch (e) { sendErr(res, e, 'update') }
})

// ── POST /app/api/filings/:id/submit — 提出記録 ──────────────────
//   body: { submitted_date?, reference_no?, submitted_to? }
//   recurrence≠none なら次回 pending を nextDueDate(due_date or submitted_date) で自動生成。
router.post('/:id/submit', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()

    const { data: row, error: gErr } = await sb.from('employment_filings')
      .select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (gErr) return sendErr(res, gErr, 'submit-get')
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' })

    const submitted_date = req.body?.submitted_date || fl.todayJst()
    const patch = {
      status: 'submitted', submitted_date,
      submitted_to: req.body?.submitted_to ? String(req.body.submitted_to).trim() : row.submitted_to,
      reference_no: req.body?.reference_no ? String(req.body.reference_no).trim() : row.reference_no,
    }
    const { error: uErr } = await sb.from('employment_filings').update(patch).eq('id', id)
    if (uErr) return sendErr(res, uErr, 'submit-update')

    // 繰り返し → 次回 pending を自動生成
    let autoCreated = null
    if (row.recurrence && row.recurrence !== 'none') {
      const base = row.due_date || submitted_date
      const nextDue = fl.nextDueDate(base, row.recurrence)
      if (nextDue) {
        const { data: created } = await sb.from('employment_filings').insert({
          company_id: companyId, worker_id: row.worker_id, visa_category: row.visa_category,
          filing_type: row.filing_type, title: row.title, status: 'pending',
          due_date: nextDue, submitted_to: row.submitted_to, recurrence: row.recurrence,
          note: row.note, created_by: req.user?.id,
        }).select('id, due_date').single()
        if (created) autoCreated = created
      }
    }
    res.json({ ok: true, submitted_date, auto_created: autoCreated })
  } catch (e) { sendErr(res, e, 'submit') }
})

// ── DELETE /app/api/filings/:id ──────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()
    const { error } = await sb.from('employment_filings').delete().eq('id', id).eq('company_id', companyId)
    if (error) return sendErr(res, error, 'delete')
    res.json({ ok: true })
  } catch (e) { sendErr(res, e, 'delete') }
})

// ── POST /app/api/filings/notify — 期限が近い/超過の届出を管理者へ通知 ─
//   body: { days: 60 }  閾値。pending かつ expired/urgent/warn(<=days) を対象。同日重複防止。
router.post('/notify', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const threshold = Math.min(Math.max(parseInt(req.body?.days, 10) || 60, 1), 365)
    const sb = adminClient()

    const { data, error } = await sb.from('employment_filings')
      .select('*, workers(name)').eq('company_id', companyId).eq('status', 'pending')
    if (error) return sendErr(res, error, 'notify')

    const today = fl.todayJst()
    const { data: existing = [] } = await sb.from('notifications')
      .select('title').eq('company_id', companyId)
      .gte('created_at', today + 'T00:00:00+09:00').limit(500)
    const existingTitles = new Set((existing || []).map(n => n.title))

    const created = []
    for (const row of (data || [])) {
      const days = fl.daysUntil(row.due_date, today)
      const level = fl.expireLevel(days)
      if (level == null || level === 'ok') continue
      if (days > threshold) continue
      const wname = row.workers?.name || '(不明)'
      const head = level === 'expired'
        ? `【届出】期限超過：${wname} の${row.title}`
        : `【届出】期限間近：${wname} の${row.title}（あと${days}日）`
      if (existingTitles.has(head)) continue
      const notif = {
        company_id: companyId, worker_id: null, title: head,
        body: `提出期限 ${String(row.due_date).slice(0,10)}${row.submitted_to ? '（提出先: ' + row.submitted_to + '）' : ''}`,
        type: level === 'expired' ? 'alert' : 'info',
      }
      try {
        await sb.from('notifications').insert(notif)
        push.sendFromNotification({ ...notif, url: '/app#filings' }).catch(() => {})
        existingTitles.add(head)
        created.push({ id: row.id, level, days })
      } catch (e) { /* 1件失敗しても続行 */ }
    }
    res.json({ ok: true, threshold, created })
  } catch (e) { sendErr(res, e, 'notify') }
})

module.exports = router

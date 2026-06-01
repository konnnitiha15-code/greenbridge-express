// ============================================================
// GreenBridge — 健康診断・資格管理 API（Phase6・管理者側）
//   /app/api/certs/* にマウント（requireAuth + requireAdmin）
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const { isUuid }       = require('../lib/validate')
const push             = require('../lib/push')

const router = express.Router()
router.use(requireAuth, requireAdmin)

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
}
function todayJst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
}
function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00+09:00')
  if (isNaN(d)) return null
  const today = new Date(todayJst() + 'T00:00:00+09:00')
  return Math.round((d - today) / 86400000)
}
function expireLevel(days) {
  if (days == null) return null
  if (days < 0)   return 'expired'
  if (days <= 30) return 'urgent'
  if (days <= 90) return 'warn'
  return 'ok'
}
const isCertMissing = err =>
  err && (err.code === '42P01' || /worker_certifications|does not exist|schema cache/i.test(err.message || ''))

const CERT_TYPES = ['health_check', 'full_harness', 'sling', 'forklift', 'skill_training', 'other']
const CERT_TYPE_LABEL = {
  health_check: '健康診断', full_harness: 'フルハーネス', sling: '玉掛け',
  forklift: 'フォークリフト', skill_training: '技能講習', other: 'その他',
}

function normalizeRow(b) {
  const cert_type = CERT_TYPES.includes(b.cert_type) ? b.cert_type : 'other'
  const name = String(b.name || '').trim()
  const pickDate = v => { const s = v ? String(v).slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
  return {
    cert_type, name,
    issued_date: pickDate(b.issued_date),
    expire_date: pickDate(b.expire_date),
    issuer: b.issuer ? String(b.issuer).trim() : null,
    cert_no: b.cert_no ? String(b.cert_no).trim() : null,
    result:  b.result  ? String(b.result).trim()  : null,
    note:    b.note    ? String(b.note).trim()    : null,
  }
}

// ── GET /app/api/certs — 全資格一覧（期限近い順 + 統計）──────────
router.get('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, rows: [], stats: {} })
    const sb = adminClient()

    const { data, error } = await sb.from('worker_certifications')
      .select('*, workers(name, nationality)')
      .eq('company_id', companyId)
    if (error) {
      if (isCertMissing(error)) return res.status(503).json({ ok: false, error: 'migration_016_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }

    const rows = (data || []).map(c => {
      const days = daysUntil(c.expire_date)
      return {
        id: c.id, worker_id: c.worker_id,
        worker_name: c.workers?.name || '不明', nationality: c.workers?.nationality || '',
        cert_type: c.cert_type, cert_type_label: CERT_TYPE_LABEL[c.cert_type] || c.cert_type,
        name: c.name, issued_date: c.issued_date ? String(c.issued_date).slice(0,10) : null,
        expire_date: c.expire_date ? String(c.expire_date).slice(0,10) : null,
        issuer: c.issuer || '', cert_no: c.cert_no || '', result: c.result || '', note: c.note || '',
        days, level: expireLevel(days),
      }
    })
    // 期限近い順（期限なしは末尾）
    rows.sort((a, b) => {
      if (a.days == null && b.days == null) return 0
      if (a.days == null) return 1
      if (b.days == null) return -1
      return a.days - b.days
    })
    const stats = { expired: 0, urgent: 0, warn: 0, ok: 0, none: 0 }
    rows.forEach(r => { stats[r.level || 'none']++ })

    res.json({ ok: true, rows, stats, types: CERT_TYPES, typeLabels: CERT_TYPE_LABEL })
  } catch (e) {
    console.error('[certs list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/certs — 追加 ───────────────────────────────
router.post('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId = req.body?.worker_id
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id が不正です' })
    const row = normalizeRow(req.body || {})
    if (!row.name) return res.status(400).json({ ok: false, error: '名称を入力してください' })

    const sb = adminClient()
    const { data, error } = await sb.from('worker_certifications')
      .insert({ company_id: companyId, worker_id: workerId, ...row, created_by: req.user?.id })
      .select('*').single()
    if (error) {
      if (isCertMissing(error)) return res.status(503).json({ ok: false, error: 'migration_016_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    res.json({ ok: true, cert: data })
  } catch (e) {
    console.error('[certs create]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── PUT /app/api/certs/:id — 更新 ────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id が不正です' })
    const row = normalizeRow(req.body || {})
    if (!row.name) return res.status(400).json({ ok: false, error: '名称を入力してください' })

    const sb = adminClient()
    const { data, error } = await sb.from('worker_certifications')
      .update(row).eq('id', id).eq('company_id', companyId).select('*').maybeSingle()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!data) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, cert: data })
  } catch (e) {
    console.error('[certs update]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── DELETE /app/api/certs/:id — 削除 ─────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id が不正です' })
    const sb = adminClient()
    const { error } = await sb.from('worker_certifications').delete().eq('id', id).eq('company_id', companyId)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true })
  } catch (e) {
    console.error('[certs delete]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/certs/notify — 期限が近い資格を管理者へ通知 ────
//   body: { days: 60 }
router.post('/notify', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const threshold = Math.min(Math.max(parseInt(req.body?.days, 10) || 60, 1), 365)
    const sb = adminClient()

    const { data: certs = [], error } = await sb.from('worker_certifications')
      .select('*, workers(name)').eq('company_id', companyId)
    if (error) {
      if (isCertMissing(error)) return res.status(503).json({ ok: false, error: 'migration_016_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }

    const todayIso = todayJst()
    const { data: existing = [] } = await sb.from('notifications')
      .select('title').eq('company_id', companyId)
      .gte('created_at', todayIso + 'T00:00:00+09:00').limit(500)
    const existingTitles = new Set((existing || []).map(n => n.title))

    const created = []
    for (const c of (certs || [])) {
      const days = daysUntil(c.expire_date)
      const level = expireLevel(days)
      if (!level || level === 'ok') continue
      if (days > threshold) continue
      const wname = c.workers?.name || 'ワーカー'
      const label = CERT_TYPE_LABEL[c.cert_type] || c.cert_type
      const head = level === 'expired'
        ? `【資格】期限超過：${wname} の${label}「${c.name}」`
        : `【資格】期限間近：${wname} の${label}「${c.name}」（あと${days}日）`
      if (existingTitles.has(head)) continue
      const notif = {
        company_id: companyId, worker_id: null,
        title: head, body: `有効期限 ${String(c.expire_date).slice(0,10)}`,
        type: level === 'expired' ? 'alert' : 'info',
      }
      try {
        await sb.from('notifications').insert(notif)
        push.sendFromNotification({ ...notif, url: '/app#certs' }).catch(() => {})
        existingTitles.add(head)
        created.push({ id: c.id, level, days })
      } catch {}
    }
    res.json({ ok: true, threshold, created })
  } catch (e) {
    console.error('[certs notify]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router

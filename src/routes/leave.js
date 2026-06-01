// ============================================================
// GreenBridge — 年次有給休暇 API（Phase5・管理者側）
//   /app/api/leave/* にマウント（requireAuth + requireAdmin）
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const { isUuid }       = require('../lib/validate')
const leaveLib         = require('../lib/leave')
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
// テーブル未作成（015未適用）判定
const isLeaveMissing = err =>
  err && (err.code === '42P01' || /leave_ledger|leave_requests|does not exist|schema cache/i.test(err.message || ''))

// 台帳から1ワーカーの残数サマリ
async function workerSummary(sb, companyId, workerId) {
  const { data: entries, error } = await sb.from('leave_ledger')
    .select('entry_type, days, effective_date, expire_date')
    .eq('company_id', companyId).eq('worker_id', workerId)
  if (error) throw error
  return leaveLib.summarize(entries || [], todayJst())
}

// 法定付与を台帳に同期（冪等: 同じ付与日のgrantが無ければ作成）
async function syncGrants(sb, companyId, worker, createdBy) {
  if (!worker.entry_date) return { added: 0, skipped: 'no_entry_date' }
  const schedule = leaveLib.scheduledGrants(worker.entry_date, todayJst())
  if (!schedule.length) return { added: 0 }

  // 既存の grant（effective_date）を取得
  const { data: existing } = await sb.from('leave_ledger')
    .select('effective_date')
    .eq('company_id', companyId).eq('worker_id', worker.id).eq('entry_type', 'grant')
  const existDates = new Set((existing || []).map(e => String(e.effective_date).slice(0, 10)))

  const rows = schedule
    .filter(g => !existDates.has(g.grant_date))
    .map(g => ({
      company_id: companyId, worker_id: worker.id, entry_type: 'grant',
      days: g.days, effective_date: g.grant_date, expire_date: g.expire_date,
      note: `法定付与（勤続${g.serviceMonths}ヶ月）`, created_by: createdBy,
    }))
  if (!rows.length) return { added: 0 }
  const { error } = await sb.from('leave_ledger').insert(rows)
  if (error) throw error
  return { added: rows.length }
}

// ── GET /app/api/leave/overview — 全ワーカーの残数一覧 ───────────
router.get('/overview', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, rows: [] })
    const sb = adminClient()

    const { data: workers = [] } = await sb.from('workers')
      .select('id, name, nationality, entry_date').eq('company_id', companyId).eq('status', 'active').order('name')

    // 全台帳を1回で取得して worker ごとに集計
    let entries = []
    const { data, error } = await sb.from('leave_ledger')
      .select('worker_id, entry_type, days, effective_date, expire_date').eq('company_id', companyId)
    if (error) {
      if (isLeaveMissing(error)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    entries = data || []
    const byWorker = {}
    entries.forEach(e => { (byWorker[e.worker_id] = byWorker[e.worker_id] || []).push(e) })

    const today = todayJst()
    const rows = (workers || []).map(w => {
      const sum = leaveLib.summarize(byWorker[w.id] || [], today)
      // 法定上「付与されているべき」日数（同期忘れ検知用）
      const sched = leaveLib.scheduledGrants(w.entry_date, today)
      const scheduledTotal = sched.reduce((s, g) => s + g.days, 0)
      const grantedActual  = sum.granted
      return {
        worker_id: w.id, name: w.name, nationality: w.nationality || '',
        entry_date: w.entry_date ? String(w.entry_date).slice(0,10) : null,
        ...sum,
        scheduled_total: scheduledTotal,
        needs_sync: scheduledTotal > grantedActual,   // 未同期の法定付与あり
      }
    })
    res.json({ ok: true, rows })
  } catch (e) {
    console.error('[leave overview]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── GET /app/api/leave/:workerId — 1ワーカーの台帳明細 + 残数 ─────
router.get('/:workerId', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId = req.params.workerId
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })
    const sb = adminClient()

    const { data: w } = await sb.from('workers').select('id, name, entry_date').eq('id', workerId).eq('company_id', companyId).maybeSingle()
    if (!w) return res.status(404).json({ ok: false, error: 'not_found' })

    const { data: entries, error } = await sb.from('leave_ledger')
      .select('*').eq('company_id', companyId).eq('worker_id', workerId)
      .order('effective_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) {
      if (isLeaveMissing(error)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    const today = todayJst()
    const summary = leaveLib.summarize(entries || [], today)
    const schedule = leaveLib.scheduledGrants(w.entry_date, today)
    res.json({ ok: true, worker: { id: w.id, name: w.name, entry_date: w.entry_date }, summary, entries: entries || [], schedule })
  } catch (e) {
    console.error('[leave detail]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/leave/:workerId/sync — 法定付与を台帳へ同期 ─────
router.post('/:workerId/sync', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId = req.params.workerId
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })
    const sb = adminClient()
    const { data: w } = await sb.from('workers').select('id, entry_date').eq('id', workerId).eq('company_id', companyId).maybeSingle()
    if (!w) return res.status(404).json({ ok: false, error: 'not_found' })
    let result
    try {
      result = await syncGrants(sb, companyId, w, req.user?.id)
    } catch (e) {
      if (isLeaveMissing(e)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      throw e
    }
    const summary = await workerSummary(sb, companyId, workerId)
    res.json({ ok: true, ...result, summary })
  } catch (e) {
    console.error('[leave sync]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/leave/sync-all — 全ワーカー一括同期 ────────────
router.post('/sync-all', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const sb = adminClient()
    const { data: workers = [] } = await sb.from('workers')
      .select('id, entry_date').eq('company_id', companyId).eq('status', 'active')
    let totalAdded = 0, processed = 0
    for (const w of (workers || [])) {
      try {
        const r = await syncGrants(sb, companyId, w, req.user?.id)
        totalAdded += (r.added || 0); processed++
      } catch (e) {
        if (isLeaveMissing(e)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      }
    }
    res.json({ ok: true, processed, added: totalAdded })
  } catch (e) {
    console.error('[leave sync-all]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/leave/:workerId/adjust — 手動調整 ──────────────
//   body: { days(±), effective_date, note }
router.post('/:workerId/adjust', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const workerId = req.params.workerId
    if (!isUuid(workerId)) return res.status(400).json({ ok: false, error: 'worker_id の形式が不正です' })
    const days = Number(req.body?.days)
    if (!Number.isFinite(days) || days === 0) return res.status(400).json({ ok: false, error: '調整日数を入力してください' })
    const effective_date = req.body?.effective_date || todayJst()
    const sb = adminClient()
    const { error } = await sb.from('leave_ledger').insert({
      company_id: companyId, worker_id: workerId, entry_type: 'adjust',
      days, effective_date, note: req.body?.note || '手動調整', created_by: req.user?.id,
    })
    if (error) {
      if (isLeaveMissing(error)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    const summary = await workerSummary(sb, companyId, workerId)
    res.json({ ok: true, summary })
  } catch (e) {
    console.error('[leave adjust]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── 申請 ─────────────────────────────────────────────────────
// GET /app/api/leave/requests/list?status=
router.get('/requests/list', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const sb = adminClient()
    let q = sb.from('leave_requests')
      .select('*, workers(name, nationality)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(300)
    if (req.query.status) q = q.eq('status', req.query.status)
    const { data, error } = await q
    if (error) {
      if (isLeaveMissing(error)) return res.status(503).json({ ok: false, error: 'migration_015_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    res.json({ ok: true, requests: data || [] })
  } catch (e) {
    console.error('[leave requests list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /app/api/leave/requests/:id/review — 承認/却下
//   body: { action: 'approve'|'reject', note }
router.post('/requests/:id/review', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const action = req.body?.action
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ ok: false, error: 'action が不正です' })
    const sb = adminClient()

    const { data: reqRow } = await sb.from('leave_requests')
      .select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (!reqRow) return res.status(404).json({ ok: false, error: 'not_found' })
    if (reqRow.status !== 'pending') return res.status(400).json({ ok: false, error: 'この申請は既に処理済みです' })

    const status = action === 'approve' ? 'approved' : 'rejected'
    const { error: upErr } = await sb.from('leave_requests')
      .update({ status, reviewed_by: req.user?.id, reviewed_at: new Date().toISOString(), review_note: req.body?.note || null })
      .eq('id', id)
    if (upErr) return res.status(500).json({ ok: false, error: upErr.message })

    // 承認時は台帳に消化(use)を記録
    if (action === 'approve') {
      await sb.from('leave_ledger').insert({
        company_id: companyId, worker_id: reqRow.worker_id, entry_type: 'use',
        days: reqRow.days, effective_date: reqRow.start_date,
        note: `有給取得（${reqRow.start_date}〜${reqRow.end_date}）`, request_id: id, created_by: req.user?.id,
      })
    }

    // ワーカーへ通知
    const notif = {
      company_id: companyId, worker_id: reqRow.worker_id,
      title: action === 'approve' ? '✅ 有給申請が承認されました' : '❌ 有給申請が却下されました',
      body: `${reqRow.start_date}${reqRow.end_date !== reqRow.start_date ? '〜' + reqRow.end_date : ''}（${reqRow.days}日）`,
      type: action === 'approve' ? 'approval' : 'info',
    }
    try { await sb.from('notifications').insert(notif) } catch {}
    push.sendFromNotification({ ...notif, url: '/worker?tab=leave' }).catch(() => {})

    res.json({ ok: true })
  } catch (e) {
    console.error('[leave review]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router

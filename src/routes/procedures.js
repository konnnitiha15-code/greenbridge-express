// ============================================================
// GreenBridge — 労務手続きワークフロー API（Phase8・管理者側）
//   /app/api/procedures/* にマウント（requireAuth + requireAdmin）
//   手続き(hr_procedures) と タスク(hr_procedure_tasks) の CRUD。
//   未適用(018)時は 503 migration_018_required を返しフロントは「準備中」表示。
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const { isUuid }       = require('../lib/validate')
const proc             = require('../lib/procedures')

const router = express.Router()
router.use(requireAuth, requireAdmin)

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
}
function nowIso() { return new Date().toISOString() }

// 018未適用（テーブル不在）判定
const isHrMissing = err =>
  err && (err.code === '42P01' || /hr_procedures|hr_procedure_tasks|does not exist|schema cache/i.test(err.message || ''))

function sendErr(res, err, ctx) {
  if (isHrMissing(err)) return res.status(503).json({ ok: false, error: 'migration_018_required' })
  console.error(`[procedures ${ctx}]`, err.message || err)
  return res.status(500).json({ ok: false, error: err.message || 'error' })
}

// ── GET /app/api/procedures — 一覧（?status=&kind=&worker_id=）─────
router.get('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.json({ ok: true, rows: [] })
    const sb = adminClient()

    let q = sb.from('hr_procedures')
      .select('*, workers(name, nationality)')
      .eq('company_id', companyId)
      .order('status', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(500)
    if (proc.KINDS.includes(req.query.kind)) q = q.eq('kind', req.query.kind)
    if (['open', 'done', 'canceled'].includes(req.query.status)) q = q.eq('status', req.query.status)
    if (isUuid(req.query.worker_id || '')) q = q.eq('worker_id', req.query.worker_id)

    const { data, error } = await q
    if (error) return sendErr(res, error, 'list')

    const list = data || []
    // 各手続きの進捗をまとめて取得
    const ids = list.map(p => p.id)
    let tasksByProc = {}
    if (ids.length) {
      const { data: tasks, error: tErr } = await sb.from('hr_procedure_tasks')
        .select('procedure_id, status').in('procedure_id', ids)
      if (tErr) return sendErr(res, tErr, 'list-tasks')
      ;(tasks || []).forEach(t => { (tasksByProc[t.procedure_id] = tasksByProc[t.procedure_id] || []).push(t) })
    }
    const rows = list.map(p => ({
      ...p,
      kind_label: proc.KIND_LABEL[p.kind] || p.kind,
      progress: proc.progress(tasksByProc[p.id] || []),
    }))
    const openCount = rows.filter(r => r.status === 'open').length
    res.json({ ok: true, rows, open_count: openCount })
  } catch (e) { sendErr(res, e, 'list') }
})

// ── GET /app/api/procedures/:id — 詳細 + tasks ───────────────────
router.get('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()

    const { data: p, error } = await sb.from('hr_procedures')
      .select('*, workers(name, nationality)')
      .eq('id', id).eq('company_id', companyId).maybeSingle()
    if (error) return sendErr(res, error, 'detail')
    if (!p) return res.status(404).json({ ok: false, error: 'not_found' })

    const { data: tasks, error: tErr } = await sb.from('hr_procedure_tasks')
      .select('*').eq('procedure_id', id).order('sort_order').order('created_at')
    if (tErr) return sendErr(res, tErr, 'detail-tasks')

    res.json({
      ok: true,
      procedure: { ...p, kind_label: proc.KIND_LABEL[p.kind] || p.kind },
      tasks: tasks || [],
      progress: proc.progress(tasks || []),
    })
  } catch (e) { sendErr(res, e, 'detail') }
})

// ── POST /app/api/procedures — 作成（テンプレからタスク生成）──────
//   body: { worker_id, kind, title?, due_date? }
router.post('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const { worker_id } = req.body || {}
    const kind = proc.KINDS.includes(req.body?.kind) ? req.body.kind : 'other'
    if (!isUuid(worker_id || '')) return res.status(400).json({ ok: false, error: 'ワーカーを選択してください' })
    const title = String(req.body?.title || '').trim() || proc.defaultTitle(kind)
    const due_date = req.body?.due_date || null
    const sb = adminClient()

    // ワーカーが自社か確認
    const { data: w } = await sb.from('workers').select('id').eq('id', worker_id).eq('company_id', companyId).maybeSingle()
    if (!w) return res.status(404).json({ ok: false, error: 'ワーカーが見つかりません' })

    const { data: created, error } = await sb.from('hr_procedures')
      .insert({ company_id: companyId, worker_id, kind, title, due_date, created_by: req.user?.id })
      .select('*').single()
    if (error) return sendErr(res, error, 'create')

    // テンプレからタスク生成
    const tpl = proc.buildTasks(kind)
    if (tpl.length) {
      const rows = tpl.map(t => ({ procedure_id: created.id, company_id: companyId, ...t }))
      const { error: tErr } = await sb.from('hr_procedure_tasks').insert(rows)
      if (tErr) return sendErr(res, tErr, 'create-tasks')
    }
    res.json({ ok: true, id: created.id, item: created, task_count: tpl.length })
  } catch (e) { sendErr(res, e, 'create') }
})

// ── PUT /app/api/procedures/:id — 手続き更新 ─────────────────────
//   body: { status?, due_date?, note?, title? }
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const patch = {}
    if (req.body?.status !== undefined) {
      if (!['open', 'done', 'canceled'].includes(req.body.status))
        return res.status(400).json({ ok: false, error: 'status が不正です' })
      patch.status = req.body.status
      patch.completed_at = req.body.status === 'done' ? nowIso() : null
    }
    if (req.body?.title !== undefined)    patch.title    = String(req.body.title || '').trim() || null
    if (req.body?.due_date !== undefined) patch.due_date = req.body.due_date || null
    if (req.body?.note !== undefined)     patch.note     = req.body.note || null
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: '更新内容がありません' })
    if (patch.title === null) return res.status(400).json({ ok: false, error: 'タイトルは必須です' })

    const sb = adminClient()
    const { data, error } = await sb.from('hr_procedures')
      .update(patch).eq('id', id).eq('company_id', companyId).select('*').maybeSingle()
    if (error) return sendErr(res, error, 'update')
    if (!data) return res.status(404).json({ ok: false, error: 'not_found' })
    res.json({ ok: true, item: data })
  } catch (e) { sendErr(res, e, 'update') }
})

// ── DELETE /app/api/procedures/:id — 削除（tasksはCASCADE）────────
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()
    const { error } = await sb.from('hr_procedures').delete().eq('id', id).eq('company_id', companyId)
    if (error) return sendErr(res, error, 'delete')
    res.json({ ok: true })
  } catch (e) { sendErr(res, e, 'delete') }
})

// ── POST /app/api/procedures/:id/tasks — 任意タスク追加 ───────────
//   body: { label, category?, due_date?, assignee? }
router.post('/:id/tasks', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const label = String(req.body?.label || '').trim()
    if (!label) return res.status(400).json({ ok: false, error: 'タスク名を入力してください' })
    const sb = adminClient()

    // 親手続きが自社か確認 + 末尾 sort_order を算出
    const { data: parent } = await sb.from('hr_procedures')
      .select('id').eq('id', id).eq('company_id', companyId).maybeSingle()
    if (!parent) return res.status(404).json({ ok: false, error: 'not_found' })
    const { data: last } = await sb.from('hr_procedure_tasks')
      .select('sort_order').eq('procedure_id', id).order('sort_order', { ascending: false }).limit(1).maybeSingle()
    const sort_order = (last?.sort_order || 0) + 10

    const { data, error } = await sb.from('hr_procedure_tasks').insert({
      procedure_id: id, company_id: companyId, label,
      category: req.body?.category ? String(req.body.category).trim() : null,
      due_date: req.body?.due_date || null,
      assignee: req.body?.assignee ? String(req.body.assignee).trim() : null,
      sort_order,
    }).select('*').single()
    if (error) return sendErr(res, error, 'task-create')
    res.json({ ok: true, item: data })
  } catch (e) { sendErr(res, e, 'task-create') }
})

// ── PUT /app/api/procedures/tasks/:taskId — タスク更新 ────────────
//   body: { status?, assignee?, due_date?, note?, label? }
//   全タスクが done/skip になったら親手続きを自動で done に。
router.put('/tasks/:taskId', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const taskId = req.params.taskId
    if (!isUuid(taskId)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const patch = {}
    if (req.body?.status !== undefined) {
      if (!proc.TASK_STATUSES.includes(req.body.status))
        return res.status(400).json({ ok: false, error: 'status が不正です' })
      patch.status = req.body.status
      patch.completed_at = req.body.status === 'done' ? nowIso() : null
      patch.completed_by = req.body.status === 'done' ? (req.user?.id || null) : null
    }
    if (req.body?.assignee !== undefined) patch.assignee = req.body.assignee ? String(req.body.assignee).trim() : null
    if (req.body?.due_date !== undefined) patch.due_date = req.body.due_date || null
    if (req.body?.note !== undefined)     patch.note     = req.body.note || null
    if (req.body?.label !== undefined) {
      const lbl = String(req.body.label || '').trim()
      if (!lbl) return res.status(400).json({ ok: false, error: 'タスク名は必須です' })
      patch.label = lbl
    }
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: '更新内容がありません' })

    const sb = adminClient()
    const { data: task, error } = await sb.from('hr_procedure_tasks')
      .update(patch).eq('id', taskId).eq('company_id', companyId).select('*').maybeSingle()
    if (error) return sendErr(res, error, 'task-update')
    if (!task) return res.status(404).json({ ok: false, error: 'not_found' })

    // 進捗を再計算し、全完了なら親手続きを done に（status更新時のみ）
    let autoCompleted = false
    if (patch.status !== undefined) {
      const { data: siblings } = await sb.from('hr_procedure_tasks')
        .select('status').eq('procedure_id', task.procedure_id)
      const pg = proc.progress(siblings || [])
      const { data: parent } = await sb.from('hr_procedures')
        .select('status').eq('id', task.procedure_id).maybeSingle()
      if (pg.allClosed && parent && parent.status === 'open') {
        await sb.from('hr_procedures').update({ status: 'done', completed_at: nowIso() }).eq('id', task.procedure_id)
        autoCompleted = true
      } else if (!pg.allClosed && parent && parent.status === 'done') {
        // 完了後に done を巻き戻したら手続きも open に戻す
        await sb.from('hr_procedures').update({ status: 'open', completed_at: null }).eq('id', task.procedure_id)
      }
    }
    res.json({ ok: true, item: task, auto_completed: autoCompleted })
  } catch (e) { sendErr(res, e, 'task-update') }
})

// ── DELETE /app/api/procedures/tasks/:taskId — タスク削除 ─────────
router.delete('/tasks/:taskId', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const taskId = req.params.taskId
    if (!isUuid(taskId)) return res.status(400).json({ ok: false, error: 'id の形式が不正です' })
    const sb = adminClient()
    const { error } = await sb.from('hr_procedure_tasks').delete().eq('id', taskId).eq('company_id', companyId)
    if (error) return sendErr(res, error, 'task-delete')
    res.json({ ok: true })
  } catch (e) { sendErr(res, e, 'task-delete') }
})

module.exports = router

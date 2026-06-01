const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { format, parseISO } = require('date-fns')
const { ja } = require('date-fns/locale')
const router = express.Router()

const fmtDate = d => {
  if (!d) return ''
  try { return format(parseISO(d), 'yyyy-MM-dd') } catch { return d }
}

// 一覧
router.get('/', requireAuth, async (req, res) => {
  const { data: workers } = await req.supabase
    .from('workers')
    .select('id, name, name_kana, language, job_title, residence_expire, status')
    .order('name')
  res.render('workers/index', { title: '従業員管理', workers: workers ?? [] })
})

// 新規フォーム
router.get('/new', requireAuth, (req, res) => {
  res.render('workers/form', { title: '従業員登録', worker: null, action: '/workers' })
})

// 登録
router.post('/', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) { req.flash('error', '会社が設定されていません'); return res.redirect('/workers') }

  const payload = buildPayload(req.body, companyId)
  const { error } = await req.supabase.from('workers').insert(payload)
  if (error) { req.flash('error', '登録に失敗しました: ' + error.message); return res.redirect('/workers/new') }
  req.flash('success', '従業員を登録しました')
  res.redirect('/workers')
})

// 詳細
router.get('/:id', requireAuth, async (req, res) => {
  const { data: worker } = await req.supabase.from('workers').select('*').eq('id', req.params.id).single()
  if (!worker) return res.status(404).send('Not found')
  const { data: documents } = await req.supabase.from('documents').select('id, name, category, expire_date').eq('worker_id', req.params.id)
  res.render('workers/show', { title: worker.name, worker, documents: documents ?? [], fmtDate })
})

// 編集フォーム
router.get('/:id/edit', requireAuth, async (req, res) => {
  const { data: worker } = await req.supabase.from('workers').select('*').eq('id', req.params.id).single()
  if (!worker) return res.status(404).send('Not found')
  res.render('workers/form', { title: '従業員編集', worker, action: `/workers/${req.params.id}?_method=PUT` })
})

// 更新
router.post('/:id', requireAuth, async (req, res) => {
  if (req.body._method !== 'PUT') return res.status(405).send('Method Not Allowed')
  const companyId = req.profile?.company_id
  const payload = buildPayload(req.body, companyId)
  let { error } = await req.supabase.from('workers').update(payload).eq('id', req.params.id)
  // 014（work_permit）未適用環境ではカラム不在エラー → 拡張カラムを除いて再試行
  if (error && /column .* does not exist|work_permit/i.test(error.message || '')) {
    const { work_permit, work_permit_expire, ...base } = payload
    ;({ error } = await req.supabase.from('workers').update(base).eq('id', req.params.id))
  }
  // fetch(JSON)からの呼び出しにも対応（SPAのsaveWはJSONで叩く）
  const wantsJson = (req.headers['content-type'] || '').includes('application/json')
  if (error) {
    if (wantsJson) return res.status(500).json({ ok: false, error: error.message })
    req.flash('error', '更新に失敗しました'); return res.redirect(`/workers/${req.params.id}/edit`)
  }
  if (wantsJson) return res.json({ ok: true })
  req.flash('success', '従業員情報を更新しました')
  res.redirect(`/workers/${req.params.id}`)
})

// 削除
router.post('/:id/delete', requireAuth, async (req, res) => {
  await req.supabase.from('workers').delete().eq('id', req.params.id)
  req.flash('success', '従業員を削除しました')
  res.redirect('/workers')
})

function buildPayload(body, companyId) {
  const fields = [
    'name','name_kana','nationality','language','date_of_birth','gender',
    'visa_type','visa_status','residence_card','residence_expire','entry_date','contract_end',
    'passport_number','passport_expire','job_title','department','supervisor','salary',
    'address','emergency_contact','insurance','status','work_permit_expire'
  ]
  const payload = { company_id: companyId }
  for (const f of fields) {
    if (body[f] !== undefined) payload[f] = body[f] || null
  }
  // work_permit は boolean（false を null にしない。未設定は null）
  if (body.work_permit !== undefined) {
    payload.work_permit = (body.work_permit === true || body.work_permit === 'true') ? true
                        : (body.work_permit === false || body.work_permit === 'false') ? false : null
  }
  return payload
}

module.exports = router

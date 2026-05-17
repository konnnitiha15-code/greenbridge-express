const express = require('express')
const multer  = require('multer')
const { requireAuth } = require('../middleware/auth')
const { createServiceClient } = require('../lib/supabase')
const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })

const categoryLabel = {
  contract: '雇用契約', visa: '在留資格', insurance: '保険',
  salary: '給与', safety: '安全衛生', other: 'その他'
}

// 一覧
router.get('/', requireAuth, async (req, res) => {
  const { data: documents } = await req.supabase
    .from('documents')
    .select('id, name, category, file_url, file_name, file_size, expire_date, workers(name)')
    .order('created_at', { ascending: false })
  res.render('documents/index', { title: '書類管理', documents: documents ?? [], categoryLabel })
})

// アップロードフォーム
router.get('/upload', requireAuth, async (req, res) => {
  const companyId = req.profile?.company_id
  const { data: workers } = await req.supabase
    .from('workers').select('id, name').eq('company_id', companyId).eq('status', 'active').order('name')
  res.render('documents/upload', { title: '書類アップロード', workers: workers ?? [], categoryLabel })
})

// アップロード処理
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const companyId = req.profile?.company_id
  if (!companyId) { req.flash('error', '会社が設定されていません'); return res.redirect('/documents/upload') }

  let fileUrl = null, fileName = null, fileSize = null, mimeType = null

  if (req.file) {
    const svc = createServiceClient()
    const ext = req.file.originalname.split('.').pop()
    const path = `${companyId}/${Date.now()}.${ext}`
    const { error: upErr } = await svc.storage.from('documents').upload(path, req.file.buffer, { contentType: req.file.mimetype })
    if (upErr) { req.flash('error', 'ファイルアップロード失敗: ' + upErr.message); return res.redirect('/documents/upload') }
    const { data: { publicUrl } } = svc.storage.from('documents').getPublicUrl(path)
    fileUrl = publicUrl; fileName = req.file.originalname; fileSize = req.file.size; mimeType = req.file.mimetype
  }

  const { error } = await req.supabase.from('documents').insert({
    company_id: companyId,
    worker_id: req.body.worker_id || null,
    name: req.body.name,
    category: req.body.category,
    issue_date: req.body.issue_date || null,
    expire_date: req.body.expire_date || null,
    notes: req.body.notes || null,
    file_url: fileUrl, file_name: fileName, file_size: fileSize, mime_type: mimeType,
    uploaded_by: req.user.id,
  })
  if (error) { req.flash('error', '登録に失敗しました'); return res.redirect('/documents/upload') }
  req.flash('success', '書類を登録しました')
  res.redirect('/documents')
})

// 詳細
router.get('/:id', requireAuth, async (req, res) => {
  const { data: doc } = await req.supabase.from('documents').select('*, workers(id, name)').eq('id', req.params.id).single()
  if (!doc) return res.status(404).send('Not found')
  res.render('documents/show', { title: doc.name, doc, categoryLabel })
})

// 削除
router.post('/:id/delete', requireAuth, async (req, res) => {
  await req.supabase.from('documents').delete().eq('id', req.params.id)
  req.flash('success', '書類を削除しました')
  res.redirect('/documents')
})

module.exports = router

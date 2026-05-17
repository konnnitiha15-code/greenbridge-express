const express = require('express')
const { requireAuth } = require('../middleware/auth')
const router = express.Router()

router.get('/', requireAuth, async (req, res) => {
  const { data: companies } = await req.supabase.from('companies').select('*').order('name')
  res.render('companies/index', { title: '会社管理', companies: companies ?? [] })
})

router.get('/new', requireAuth, (req, res) => {
  res.render('companies/form', { title: '会社登録', company: null, action: '/companies' })
})

router.post('/', requireAuth, async (req, res) => {
  const { name, name_kana, address, phone, email } = req.body
  const { error } = await req.supabase.from('companies').insert({ name, name_kana, address, phone, email })
  if (error) { req.flash('error', '登録に失敗しました'); return res.redirect('/companies/new') }
  req.flash('success', '会社を登録しました')
  res.redirect('/companies')
})

router.get('/:id/edit', requireAuth, async (req, res) => {
  const { data: company } = await req.supabase.from('companies').select('*').eq('id', req.params.id).single()
  if (!company) return res.status(404).send('Not found')
  res.render('companies/form', { title: '会社編集', company, action: `/companies/${req.params.id}?_method=PUT` })
})

router.post('/:id', requireAuth, async (req, res) => {
  if (req.body._method !== 'PUT') return res.status(405).send('Method Not Allowed')
  const { name, name_kana, address, phone, email } = req.body
  const { error } = await req.supabase.from('companies').update({ name, name_kana, address, phone, email }).eq('id', req.params.id)
  if (error) { req.flash('error', '更新に失敗しました'); return res.redirect(`/companies/${req.params.id}/edit`) }
  req.flash('success', '会社情報を更新しました')
  res.redirect('/companies')
})

module.exports = router

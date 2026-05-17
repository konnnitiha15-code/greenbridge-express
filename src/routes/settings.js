const express = require('express')
const { requireAuth } = require('../middleware/auth')
const router = express.Router()

router.get('/', requireAuth, async (req, res) => {
  const { data: profiles } = await req.supabase
    .from('profiles')
    .select('id, full_name, role, companies(name)')
    .order('role')
  res.render('settings/index', { title: '設定・権限管理', profiles: profiles ?? [], user: req.user, profile: req.profile })
})

module.exports = router

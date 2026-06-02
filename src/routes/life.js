// ============================================================
// GreenBridge — 生活サポート API（Phase7・管理者側）
//   /app/api/life/* にマウント（requireAuth + requireAdmin）
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const { isUuid }       = require('../lib/validate')

const router = express.Router()
router.use(requireAuth, requireAdmin)

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
}
const isLifeMissing = err =>
  err && (err.code === '42P01' || /life_support|does not exist|schema cache/i.test(err.message || ''))

const LIFE_CATEGORIES = ['hospital', 'cityhall', 'garbage', 'bank', 'mobile', 'faq', 'other']

function normalizeRow(b) {
  const category = LIFE_CATEGORIES.includes(b.category) ? b.category : 'faq'
  return {
    category,
    title: String(b.title || '').trim(),
    body:  String(b.body || '').trim(),
    address: b.address ? String(b.address).trim() : null,
    phone:   b.phone   ? String(b.phone).trim()   : null,
    map_url: b.map_url ? String(b.map_url).trim() : null,
    sort_order: Number.isFinite(+b.sort_order) ? +b.sort_order : 0,
    is_active: b.is_active === false ? false : true,
  }
}

// ── GET /app/api/life — 自社 + 全社共通の生活情報一覧 ───────────
router.get('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const sb = adminClient()
    // 自社分 + 全社共通(company_id IS NULL)
    const { data, error } = await sb.from('life_support')
      .select('*')
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .order('category').order('sort_order').order('created_at')
    if (error) {
      if (isLifeMissing(error)) return res.status(503).json({ ok: false, error: 'migration_017_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    const rows = (data || []).map(r => ({ ...r, is_standard: r.company_id == null }))
    res.json({ ok: true, rows, categories: LIFE_CATEGORIES })
  } catch (e) {
    console.error('[life list]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /app/api/life — 追加（自社分のみ作成）─────────────────
router.post('/', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    if (!companyId) return res.status(403).json({ ok: false, error: '会社が未設定です' })
    const row = normalizeRow(req.body || {})
    if (!row.title) return res.status(400).json({ ok: false, error: 'タイトルを入力してください' })
    if (!row.body)  return res.status(400).json({ ok: false, error: '本文を入力してください' })
    const sb = adminClient()
    const { data, error } = await sb.from('life_support')
      .insert({ company_id: companyId, ...row, created_by: req.user?.id }).select('*').single()
    if (error) {
      if (isLifeMissing(error)) return res.status(503).json({ ok: false, error: 'migration_017_required' })
      return res.status(500).json({ ok: false, error: error.message })
    }
    res.json({ ok: true, item: data })
  } catch (e) {
    console.error('[life create]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── PUT /app/api/life/:id — 更新（自社分のみ）──────────────────
router.put('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id が不正です' })
    const row = normalizeRow(req.body || {})
    if (!row.title) return res.status(400).json({ ok: false, error: 'タイトルを入力してください' })
    if (!row.body)  return res.status(400).json({ ok: false, error: '本文を入力してください' })
    const sb = adminClient()
    // company_id 一致（自社分）のみ更新可。全社共通は編集不可。
    const { data, error } = await sb.from('life_support')
      .update(row).eq('id', id).eq('company_id', companyId).select('*').maybeSingle()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    if (!data) return res.status(404).json({ ok: false, error: '編集できません（自社の項目のみ編集可能）' })
    res.json({ ok: true, item: data })
  } catch (e) {
    console.error('[life update]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── DELETE /app/api/life/:id — 削除（自社分のみ）───────────────
router.delete('/:id', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const id = req.params.id
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'id が不正です' })
    const sb = adminClient()
    const { error } = await sb.from('life_support').delete().eq('id', id).eq('company_id', companyId)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    res.json({ ok: true })
  } catch (e) {
    console.error('[life delete]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

module.exports = router

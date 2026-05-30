// ============================================================
// GreenBridge — 翻訳 API
// POST /api/translate  { text, source, target }
//   admin / worker どちらのセッションでも利用可
//   translationService 経由（会社辞書→業界辞書→cache→MyMemory）
// ============================================================

const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { createServiceClient } = require('../lib/supabase')
const { translate } = require('../lib/translation')

const router = express.Router()

// admin / worker いずれかの Cookie からセッション解決
async function resolveSession(req) {
  const token = req.cookies['sb-access-token'] || req.cookies['gb-worker-token']
  if (!token) return null
  const sb = createClient(
    process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  try {
    const { data: { user }, error } = await sb.auth.getUser(token)
    if (error || !user) return null
    const sbAdmin = createServiceClient()
    const { data: profile } = await sbAdmin
      .from('profiles').select('role, company_id, worker_id')
      .eq('id', user.id).single()
    if (!profile) return null
    return { userId: user.id, ...profile }
  } catch { return null }
}

// POST /api/translate
router.post('/translate', async (req, res) => {
  const sess = await resolveSession(req)
  if (!sess) return res.status(401).json({ ok: false, error: 'unauthorized' })

  const { text, source, target } = req.body || {}
  if (!target) return res.status(400).json({ ok: false, error: 'target は必須です' })
  if (text == null || String(text).trim() === '') {
    return res.json({ ok: true, translated: text || '', via: 'empty' })
  }
  // source 省略時: target が ja 以外なら ja、ja なら en を仮定（基本は明示が望ましい）
  const src = source || (target === 'ja' ? 'en' : 'ja')

  try {
    const result = await translate(String(text), src, target, {
      companyId: sess.company_id,
    })
    res.json(result)
  } catch (e) {
    console.error('[/api/translate]', e.message)
    // 失敗時も原文を返して UI を壊さない
    res.json({ ok: false, translated: text, via: 'error', error: e.message })
  }
})

module.exports = router

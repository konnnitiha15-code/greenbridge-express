// ============================================================
// GreenBridge — Web Push サブスクリプション API
// ・/api/push/public-key       公開鍵を返す
// ・/api/push/subscribe        サブスクリプションを保存
// ・/api/push/unsubscribe      サブスクリプションを削除
// ・/api/push/resubscribe      pushsubscriptionchange 用（未認証可）
// ・/api/push/test             自分宛てテスト送信（要認証）
//
// 管理者・ワーカー共通で /api/push/* に集約。
// 認証 Cookie の有無で role を自動判定するため両方のセッションに対応。
// ============================================================

const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { createServiceClient } = require('../lib/supabase')
const push = require('../lib/push')

const router = express.Router()

// ── Cookie からセッション解決（admin / worker どちらでもOK） ──────────
async function resolveSession(req) {
  const adminToken  = req.cookies['sb-access-token']
  const workerToken = req.cookies['gb-worker-token']
  const token = adminToken || workerToken
  if (!token) return null

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  try {
    const { data: { user }, error } = await sb.auth.getUser(token)
    if (error || !user) return null
    const sbAdmin = createServiceClient()
    const { data: profile } = await sbAdmin
      .from('profiles')
      .select('role, company_id, worker_id')
      .eq('id', user.id)
      .single()
    if (!profile) return null
    return { userId: user.id, ...profile }
  } catch {
    return null
  }
}

// GET /api/push/public-key — VAPID 公開鍵を返す（誰でも取得可）
router.get('/public-key', (req, res) => {
  res.json({ ok: true, publicKey: push.publicKey(), enabled: push.isReady() })
})

// POST /api/push/subscribe
// body: { endpoint, keys: { p256dh, auth } }
router.post('/subscribe', async (req, res) => {
  const sess = await resolveSession(req)
  if (!sess) return res.status(401).json({ ok: false, error: 'unauthorized' })

  const { endpoint, keys } = req.body || {}
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ ok: false, error: 'invalid_subscription' })
  }

  const sbAdmin = createServiceClient()

  // 同一 endpoint があれば user_id / company_id / role を最新化（upsert）
  const row = {
    user_id:    sess.userId,
    company_id: sess.company_id,
    worker_id:  sess.worker_id || null,
    role:       sess.role,
    endpoint,
    p256dh:     keys.p256dh,
    auth_key:   keys.auth,
    user_agent: (req.headers['user-agent'] || '').slice(0, 250),
  }

  const { error } = await sbAdmin
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' })

  if (error) {
    console.error('[push] subscribe error:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  res.json({ ok: true })
})

// POST /api/push/unsubscribe — body: { endpoint }
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {}
  if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint required' })

  const sbAdmin = createServiceClient()
  await sbAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint)
  res.json({ ok: true })
})

// POST /api/push/resubscribe — ブラウザ自動再購読用（認証不要・oldEndpoint削除のみ）
router.post('/resubscribe', async (req, res) => {
  const { oldEndpoint } = req.body || {}
  if (oldEndpoint) {
    const sbAdmin = createServiceClient()
    await sbAdmin.from('push_subscriptions').delete().eq('endpoint', oldEndpoint)
  }
  res.json({ ok: true })
})

// POST /api/push/test — 自分宛てにテスト通知（開発・動作確認用）
router.post('/test', async (req, res) => {
  const sess = await resolveSession(req)
  if (!sess) return res.status(401).json({ ok: false, error: 'unauthorized' })

  const payload = {
    title: 'GreenBridge テスト通知',
    body:  '通知が届きました ✅',
    type:  'info',
    url:   sess.role === 'worker' ? '/worker' : '/app',
  }

  let result
  if (sess.role === 'worker') {
    result = await push.sendToWorker(sess.company_id, sess.worker_id, payload)
  } else {
    result = await push.sendToAdmins(sess.company_id, payload)
  }
  res.json({ ok: true, result })
})

module.exports = router

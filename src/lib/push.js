// ============================================================
// GreenBridge — Web Push 配信ヘルパ
// ・VAPID 鍵で web-push を初期化
// ・notifications テーブルに insert する箇所から呼んで使う
// ・配信失敗（410 Gone / 404）は自動でサブスクリプションを削除
// ============================================================

const webpush = require('web-push')
const { createServiceClient } = require('./supabase')

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@greenbridge.example.com'

let ready = false
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    ready = true
  } catch (e) {
    console.warn('[push] VAPID 初期化失敗:', e.message)
  }
} else {
  console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 未設定 — push 配信は無効')
}

function isReady() { return ready }
function publicKey() { return VAPID_PUBLIC || '' }

// サブスクリプション 1 件に payload を送信
async function sendOne(sub, payload, sbAdmin) {
  if (!ready) return { ok: false, skipped: true }
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth_key },
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 60 * 60 * 24 })
    return { ok: true }
  } catch (err) {
    // 404 / 410 はサブスクリプションが無効化された signal
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      try {
        await sbAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      } catch {}
      return { ok: false, removed: true }
    }
    console.warn('[push] send error:', err.statusCode, err.body)
    return { ok: false, error: err.message }
  }
}

// 共通: 抽出済みの subscription 配列に一斉送信
async function sendToSubs(subs, payload) {
  if (!ready || !subs || !subs.length) return { sent: 0 }
  const sbAdmin = createServiceClient()
  const results = await Promise.all(subs.map(s => sendOne(s, payload, sbAdmin)))
  return { sent: results.filter(r => r.ok).length, total: subs.length }
}

// 会社の指定 worker_id（特定のワーカー本人）に送信
async function sendToWorker(companyId, workerId, payload) {
  if (!ready || !companyId || !workerId) return { sent: 0 }
  const sbAdmin = createServiceClient()
  const { data: subs = [] } = await sbAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('company_id', companyId)
    .eq('role', 'worker')
    .eq('worker_id', workerId)
  return sendToSubs(subs, payload)
}

// 会社の admin / staff 全員に送信
async function sendToAdmins(companyId, payload) {
  if (!ready || !companyId) return { sent: 0 }
  const sbAdmin = createServiceClient()
  const { data: subs = [] } = await sbAdmin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('company_id', companyId)
    .in('role', ['admin', 'staff'])
  return sendToSubs(subs, payload)
}

// notifications テーブルへの insert に追従して push 配信
//   notif: { company_id, worker_id, title, body, type, url? }
// worker_id が指定されていれば本人へ。null なら同社の admin/staff 全員へ。
async function sendFromNotification(notif) {
  if (!ready || !notif || !notif.company_id) return { sent: 0 }
  const payload = {
    title: notif.title || 'GreenBridge',
    body:  notif.body  || '',
    type:  notif.type  || 'info',
    url:   notif.url   || (notif.worker_id ? '/worker' : '/app'),
    tag:   notif.tag   || `gb-${notif.type || 'info'}-${Date.now()}`,
  }
  if (notif.worker_id) {
    return sendToWorker(notif.company_id, notif.worker_id, payload)
  } else {
    return sendToAdmins(notif.company_id, payload)
  }
}

module.exports = {
  isReady,
  publicKey,
  sendToWorker,
  sendToAdmins,
  sendFromNotification,
}

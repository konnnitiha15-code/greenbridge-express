// ============================================================
// GreenBridge — Web Push クライアントヘルパ
// Service Worker 登録 + プッシュ購読のセットアップ
//
// 使い方:
//   await GBPush.init()                       // SW登録 + 既存購読を最新サーバー状態に同期
//   const status = await GBPush.getStatus()   // { supported, permission, subscribed }
//   await GBPush.enable()                     // 通知許可を求めて購読登録
//   await GBPush.disable()                    // 購読解除
//   await GBPush.test()                       // テスト送信
// ============================================================

(function () {
  const SW_PATH = '/sw.js'
  let _reg = null
  let _publicKey = null

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  }

  // URL-safe base64 → Uint8Array
  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  }

  async function fetchPublicKey() {
    if (_publicKey) return _publicKey
    try {
      const r = await fetch('/api/push/public-key', { credentials: 'include' })
      const j = await r.json()
      if (j.ok && j.publicKey) _publicKey = j.publicKey
      return _publicKey
    } catch { return null }
  }

  async function register() {
    if (!isSupported()) return null
    if (_reg) return _reg
    try {
      _reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
      return _reg
    } catch (e) {
      console.warn('[push] SW register failed:', e.message)
      return null
    }
  }

  async function init() {
    if (!isSupported()) return { supported: false }
    const reg = await register()
    if (!reg) return { supported: false }
    // 既存購読があればサーバーに再同期
    try {
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        }).catch(() => {})
      }
    } catch {}
    return { supported: true, registered: true }
  }

  async function getStatus() {
    if (!isSupported()) return { supported: false, permission: 'unsupported', subscribed: false }
    const reg = _reg || (await navigator.serviceWorker.getRegistration())
    let subscribed = false
    if (reg) {
      const sub = await reg.pushManager.getSubscription()
      subscribed = !!sub
    }
    return {
      supported: true,
      permission: Notification.permission,
      subscribed,
    }
  }

  async function enable() {
    if (!isSupported()) throw new Error('プッシュ通知はこのブラウザで利用できません')
    const reg = await register()
    if (!reg) throw new Error('Service Worker の登録に失敗しました')

    const perm = await Notification.requestPermission()
    if (perm !== 'granted') throw new Error('通知の許可が必要です')

    const pubKey = await fetchPublicKey()
    if (!pubKey) throw new Error('サーバーで Web Push が設定されていません')

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pubKey),
      })
    }

    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) throw new Error(j.error || '購読の保存に失敗しました')

    return { ok: true }
  }

  async function disable() {
    const reg = _reg || (await navigator.serviceWorker.getRegistration())
    if (!reg) return { ok: true }
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { ok: true }

    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})
    return { ok: true }
  }

  async function test() {
    const r = await fetch('/api/push/test', {
      method: 'POST',
      credentials: 'include',
    })
    return r.json()
  }

  window.GBPush = { isSupported, init, getStatus, enable, disable, test }
})()

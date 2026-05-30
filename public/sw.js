// GreenBridge Service Worker — PWA + Web Push
// バージョン番号を更新するとキャッシュが再生成される
const CACHE_VERSION = 'gb-v5-translate'
const STATIC_CACHE  = `${CACHE_VERSION}-static`

// ── キャッシュ対象（最小限） ──────────────────────────────────────
// 動的なHTML/API はキャッシュしない。静的アセットのみ。
const STATIC_ASSETS = [
  '/css/style.css',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/manifest-worker.json',
  '/manifest-admin.json',
]

// ── install: 静的アセットを事前キャッシュ ─────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(STATIC_ASSETS).catch(() => {})
    )
  )
  self.skipWaiting()
})

// ── activate: 古いキャッシュを削除 ────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// ── fetch: API/動的HTMLはネットワーク優先、静的アセットはキャッシュ優先 ──
self.addEventListener('fetch', (event) => {
  const { request } = event

  // 非GET（POST/PUT/DELETE等）は明示的にパススルー
  // ・iOS Safari の PWA で SW 経由のリクエストから Cookie/認証が消える既知バグへの保険
  // ・request 自体を fetch することで credentials などのモードを保持
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 同一オリジン以外はそのまま
  if (url.origin !== self.location.origin) return

  // API/動的ルートはキャッシュしない
  if (
    url.pathname.startsWith('/app/api/') ||
    url.pathname.startsWith('/worker/api/') ||
    url.pathname.startsWith('/api/')
  ) {
    return
  }

  // 静的アセット: cache-first
  if (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        }).catch(() => cached)
      })
    )
  }
})

// ── push: 通知受信 ────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'GreenBridge', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'GreenBridge'
  const options = {
    body:  payload.body || '',
    icon:  payload.icon || '/icons/icon.svg',
    badge: payload.badge || '/icons/icon.svg',
    tag:   payload.tag || 'gb-notification',
    data:  payload.data || { url: payload.url || '/' },
    renotify: !!payload.renotify,
    requireInteraction: payload.type === 'alert',
    vibrate: payload.type === 'alert' ? [200, 100, 200, 100, 200] : [100, 50, 100],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── notificationclick: 通知タップで該当画面を開く ─────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      // 既にアプリが開いていればそのウィンドウへフォーカス
      for (const client of clientsList) {
        const url = new URL(client.url)
        if (url.origin === self.location.origin) {
          client.focus()
          if ('navigate' in client) {
            try { client.navigate(target) } catch {}
          }
          return
        }
      }
      // 開いていなければ新規ウィンドウ
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})

// ── push subscription change: 自動再購読 ──────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    fetch('/api/push/resubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldEndpoint: event.oldSubscription && event.oldSubscription.endpoint,
      }),
    }).catch(() => {})
  )
})

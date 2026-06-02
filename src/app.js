require('dotenv').config()
const express      = require('express')
const cookieParser = require('cookie-parser')
const path         = require('path')

const authRoutes      = require('./routes/auth')
const spaRoutes       = require('./routes/spa')
const dashboardRoutes = require('./routes/dashboard')
const workerRoutes    = require('./routes/workers')
const documentRoutes  = require('./routes/documents')
const companyRoutes   = require('./routes/companies')
const settingsRoutes  = require('./routes/settings')
const workerAppRoutes = require('./routes/worker-app')
const pushRoutes      = require('./routes/push')
const translateRoutes = require('./routes/translate')
const leaveRoutes     = require('./routes/leave')
const certRoutes      = require('./routes/certs')
const lifeRoutes      = require('./routes/life')

const app = express()

// ── ビューエンジン ────────────────────────────
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '..', 'views'))

// ── ミドルウェア ──────────────────────────────
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(cookieParser())
const IS_PROD = !!(process.env.VERCEL || process.env.NODE_ENV === 'production')
app.use(express.static(path.join(__dirname, '..', 'public')))

// ── Cookie ベース flash（ステートレス・サーバーレス対応）─────────────
// express-session + connect-flash を廃止。
// MemoryStore がない＝Vercel の複数インスタンスでも安定動作する。
// req.flash(type, msg) の API は connect-flash と互換。
const FLASH_COOKIE = 'gb-flash'
app.use((req, res, next) => {
  // 1) 受信: 前回リクエストで積まれた flash を Cookie から取り出してクリア
  let incoming = {}
  if (req.cookies[FLASH_COOKIE]) {
    try { incoming = JSON.parse(req.cookies[FLASH_COOKIE]) } catch {}
    res.clearCookie(FLASH_COOKIE, { sameSite: 'lax', secure: IS_PROD })
  }
  res.locals.success = incoming.success || []
  res.locals.error   = incoming.error   || []

  // 2) 送信: req.flash(type, msg) で次レスポンスの Cookie に積む
  const pending = {}
  req.flash = (type, msg) => {
    if (msg === undefined) return incoming[type] || []
    pending[type] = pending[type] || []
    pending[type].push(msg)
    res.cookie(FLASH_COOKIE, JSON.stringify(pending), {
      httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 15000,
    })
    return pending[type]
  }
  next()
})

// ── ルーティング ──────────────────────────────
app.get('/',          (req, res) => res.render('index'))
app.get('/dashboard', (req, res) => res.redirect('/app'))
app.use('/',          authRoutes)
app.use('/app',       spaRoutes)
app.use('/workers',   workerRoutes)
app.use('/documents', documentRoutes)
app.use('/companies', companyRoutes)
app.use('/settings',  settingsRoutes)
app.use('/worker',    workerAppRoutes)
app.use('/api/push',  pushRoutes)
app.use('/api',       translateRoutes)
app.use('/app/api/leave', leaveRoutes)
app.use('/app/api/certs', certRoutes)
app.use('/app/api/life',  lifeRoutes)

// ── 起動（ローカル）・エクスポート（Vercel）────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => console.log(`GreenBridge running → http://localhost:${PORT}`))
}

module.exports = app

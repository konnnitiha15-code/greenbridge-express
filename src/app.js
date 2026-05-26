require('dotenv').config()
const express      = require('express')
const cookieParser = require('cookie-parser')
const session      = require('express-session')
const flash        = require('connect-flash')
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

const app = express()

// ── ビューエンジン ────────────────────────────
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, '..', 'views'))

// ── ミドルウェア ──────────────────────────────
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(cookieParser())
const IS_PROD = !!(process.env.VERCEL || process.env.NODE_ENV === 'production')
if (!process.env.SESSION_SECRET) {
  console.warn('[WARN] SESSION_SECRET 未設定 — 本番環境では必ず設定してください')
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'greenbridge-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: IS_PROD, sameSite: 'lax' },
}))
app.use(flash())
app.use(express.static(path.join(__dirname, '..', 'public')))

// flash を全ビューで使えるように
app.use((req, res, next) => {
  res.locals.success = req.flash('success')
  res.locals.error   = req.flash('error')
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

// ── 起動（ローカル）・エクスポート（Vercel）────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => console.log(`GreenBridge running → http://localhost:${PORT}`))
}

module.exports = app

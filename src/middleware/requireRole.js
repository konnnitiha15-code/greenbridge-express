/**
 * role ベースのアクセス制御ミドルウェア
 * requireAuth の後に使用してください。
 */

// admin / staff のみ許可
function requireAdmin(req, res, next) {
  const role = req.profile?.role
  if (role === 'admin' || role === 'staff') return next()

  if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
    return res.status(403).json({ error: '権限がありません' })
  }

  // worker が /app にアクセス → worker ログインページへ（admin側に混入させない）
  res.redirect('/worker/login')
}

// worker のみ許可
function requireWorker(req, res, next) {
  const role = req.profile?.role
  if (role === 'worker') return next()

  if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
    return res.status(403).json({ error: '権限がありません' })
  }

  // admin/staff が /worker にアクセス → admin ログインページへ
  res.redirect('/login')
}

module.exports = { requireAdmin, requireWorker }

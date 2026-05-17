/**
 * role ベースのアクセス制御ミドルウェア
 * requireAuth の後に使用してください。
 */

// admin / staff のみ許可
// worker が /app にアクセスした場合は /worker/login へ
function requireAdmin(req, res, next) {
  const role = req.profile?.role
  if (role === 'admin' || role === 'staff') return next()

  // API リクエストには JSON で返す
  if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
    return res.status(403).json({ error: '権限がありません' })
  }

  res.redirect('/worker')
}

// worker のみ許可
// admin/staff が /worker にアクセスした場合は /app へ
function requireWorker(req, res, next) {
  const role = req.profile?.role
  if (role === 'worker') return next()

  // API リクエストには JSON で返す
  if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
    return res.status(403).json({ error: '権限がありません' })
  }

  res.redirect('/app')
}

module.exports = { requireAdmin, requireWorker }

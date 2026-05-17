const express = require('express')
const { requireAuth } = require('../middleware/auth')
const { differenceInDays, parseISO } = require('date-fns')
const router = express.Router()

function calcStatus(dateStr) {
  if (!dateStr) return 'ok'
  const days = differenceInDays(parseISO(dateStr), new Date())
  if (days < 0)   return 'expired'
  if (days <= 30) return 'urgent'
  if (days <= 90) return 'warning'
  return 'ok'
}

router.get('/', requireAuth, async (req, res) => {
  const sb = req.supabase

  const [
    { count: workerCount },
    { count: documentCount },
    { count: companyCount },
    { data: workers },
  ] = await Promise.all([
    sb.from('workers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('documents').select('*', { count: 'exact', head: true }),
    sb.from('companies').select('*', { count: 'exact', head: true }),
    sb.from('workers').select('id, name, residence_expire, passport_expire, contract_end').eq('status', 'active'),
  ])

  const alerts = []
  for (const w of workers ?? []) {
    const checks = [
      { type: 'residence', label: '在留期限', date: w.residence_expire },
      { type: 'passport',  label: 'パスポート', date: w.passport_expire },
      { type: 'contract',  label: '契約終了', date: w.contract_end },
    ]
    for (const c of checks) {
      const status = calcStatus(c.date)
      if (status !== 'ok' && c.date) {
        const days = differenceInDays(parseISO(c.date), new Date())
        alerts.push({ worker_id: w.id, worker_name: w.name, ...c, days, status })
      }
    }
  }
  alerts.sort((a, b) => a.days - b.days)
  const urgentCount = alerts.filter(a => a.status === 'expired' || a.status === 'urgent').length

  res.render('dashboard/index', {
    title: 'ダッシュボード',
    workerCount: workerCount ?? 0,
    documentCount: documentCount ?? 0,
    companyCount: companyCount ?? 0,
    urgentCount,
    alerts,
  })
})

module.exports = router

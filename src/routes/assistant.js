// ============================================================
// GreenBridge — AIアシスタント API（Phase10・管理者側・内部完結）
//   /app/api/assistant/* にマウント（requireAuth + requireAdmin）
//   自然文を意図解析し、既存テーブル（workers/certs/filings/leave）を
//   横断照会して構造化回答を返す。外部API不要・読み取り専用。
//   未適用テーブルはデグレード（空＋注記）で常に応答する。
// ============================================================
const express = require('express')
const { createClient } = require('@supabase/supabase-js')
const { requireAuth }  = require('../middleware/auth')
const { requireAdmin } = require('../middleware/requireRole')
const assistant        = require('../lib/assistant')
const fl               = require('../lib/filings')   // daysUntil / expireLevel / todayJst を再利用
const leaveLib         = require('../lib/leave')      // summarize を再利用

const router = express.Router()
router.use(requireAuth, requireAdmin)

function adminClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } })
}

const LEVEL_RANK = { expired: 3, urgent: 2, warn: 1, ok: 0 }

// 期間内（days <= timeframe）かつ期限超過は常に対象
function inWindow(days, timeframeDays) {
  if (days == null) return false
  if (days < 0) return true
  return days <= timeframeDays
}

// ── 在留期限（workers の residence/passport/work_permit）─────────
async function queryVisa(sb, companyId, p) {
  const { data, error } = await sb.from('workers')
    .select('id, name, nationality, visa_type, residence_expire, passport_expire, work_permit, work_permit_expire')
    .eq('company_id', companyId).eq('status', 'active')
  if (error) throw error
  const today = fl.todayJst()
  const items = []
  for (const w of (data || [])) {
    const cands = [
      { label: '在留カード', date: w.residence_expire },
      { label: 'パスポート', date: w.passport_expire },
    ]
    if (w.work_permit === true) cands.push({ label: '資格外活動許可', date: w.work_permit_expire })
    let worst = null
    for (const c of cands) {
      const days = fl.daysUntil(c.date, today)
      const level = fl.expireLevel(days)
      if (level == null || level === 'ok') continue
      if (!inWindow(days, p.timeframeDays)) continue
      if (!worst || LEVEL_RANK[level] > LEVEL_RANK[worst.level] || (LEVEL_RANK[level] === LEVEL_RANK[worst.level] && days < worst.days)) {
        worst = { ...c, days, level }
      }
    }
    if (worst) {
      items.push({
        worker_id: w.id, name: w.name, tab: 'visa', level: worst.level,
        label: w.name, days: worst.days,
        sub: `${worst.label}：${String(worst.date).slice(0,10)}（${worst.days < 0 ? Math.abs(worst.days) + '日超過' : 'あと' + worst.days + '日'}）`,
      })
    }
  }
  items.sort((a, b) => a.days - b.days)
  return items
}

// ── 資格・健診（worker_certifications）──────────────────────────
async function queryCerts(sb, companyId, p) {
  const { data, error } = await sb.from('worker_certifications')
    .select('id, worker_id, name, cert_type, expire_date, workers(name)')
    .eq('company_id', companyId)
  if (error) throw error  // 016未適用は呼び出し側でデグレード
  const today = fl.todayJst()
  const items = []
  for (const c of (data || [])) {
    const days = fl.daysUntil(c.expire_date, today)
    const level = fl.expireLevel(days)
    if (level == null || level === 'ok') continue
    if (!inWindow(days, p.timeframeDays)) continue
    items.push({
      worker_id: c.worker_id, name: c.workers?.name || '不明', tab: 'certs', level, days,
      label: `${c.workers?.name || '不明'} — ${c.name}`,
      sub: `期限 ${String(c.expire_date).slice(0,10)}（${days < 0 ? Math.abs(days) + '日超過' : 'あと' + days + '日'}）`,
    })
  }
  items.sort((a, b) => a.days - b.days)
  return items
}

// ── 雇用書類・届出（employment_filings の pending）──────────────
async function queryFilings(sb, companyId, p) {
  const { data, error } = await sb.from('employment_filings')
    .select('id, worker_id, title, due_date, submitted_to, workers(name)')
    .eq('company_id', companyId).eq('status', 'pending')
  if (error) throw error  // 019未適用は呼び出し側でデグレード
  const today = fl.todayJst()
  const items = []
  for (const f of (data || [])) {
    const days = fl.daysUntil(f.due_date, today)
    const level = fl.expireLevel(days)
    // 期限未設定の pending も「未提出」として含める（level=null）
    if (level && level !== 'ok' && !inWindow(days, p.timeframeDays)) continue
    if (level === 'ok') continue
    items.push({
      worker_id: f.worker_id, name: f.workers?.name || '不明', tab: 'filings', level: level || 'warn',
      days: days == null ? 999999 : days,
      label: `${f.workers?.name || '不明'} — ${f.title}`,
      sub: f.due_date ? `提出期限 ${String(f.due_date).slice(0,10)}（${days < 0 ? Math.abs(days) + '日超過' : 'あと' + days + '日'}）` : '提出期限 未設定',
    })
  }
  items.sort((a, b) => a.days - b.days)
  return items
}

// ── 有給（leave_ledger を worker ごと集計）──────────────────────
async function queryLeave(sb, companyId, p) {
  const { data: workers, error: wErr } = await sb.from('workers')
    .select('id, name').eq('company_id', companyId).eq('status', 'active')
  if (wErr) throw wErr
  const { data: entries, error } = await sb.from('leave_ledger')
    .select('worker_id, entry_type, days').eq('company_id', companyId)
  if (error) throw error  // 015未適用はデグレード
  const byWorker = {}
  ;(entries || []).forEach(e => { (byWorker[e.worker_id] = byWorker[e.worker_id] || []).push(e) })
  const today = fl.todayJst()
  const items = []
  for (const w of (workers || [])) {
    const sum = leaveLib.summarize(byWorker[w.id] || [], today)
    if (sum.balance > p.threshold) continue
    items.push({
      worker_id: w.id, name: w.name, tab: 'leave',
      level: sum.balance <= 0 ? 'expired' : (sum.balance <= 3 ? 'urgent' : 'warn'),
      days: sum.balance,
      label: w.name, sub: `有給残 ${sum.balance}日（付与${sum.granted}・消化${sum.used}）`,
    })
  }
  items.sort((a, b) => a.days - b.days)
  return items
}

// ── 人数集計（visa_type / nationality）──────────────────────────
async function queryHeadcount(sb, companyId, p) {
  const { data, error } = await sb.from('workers')
    .select('id, name, visa_type, nationality, status').eq('company_id', companyId).eq('status', 'active')
  if (error) throw error
  const list = data || []
  const s = p.raw
  // visa_type で絞り込む語があれば該当者を列挙
  const VT = [
    { key: '特定技能', match: t => /特定技能/.test(t || '') },
    { key: '技能実習', match: t => /技能実習/.test(t || '') },
    { key: '技人国',   match: t => /技術・人文知識|技人国/.test(t || '') },
  ]
  const hit = VT.find(v => s.includes(v.key))
  if (hit) {
    const matched = list.filter(w => hit.match(w.visa_type))
    return {
      summary: `「${hit.key}」の在籍者は ${matched.length}名です（在籍者総数 ${list.length}名）。`,
      count: matched.length,
      items: matched.map(w => ({ worker_id: w.id, name: w.name, tab: 'workers', label: w.name, sub: w.visa_type || '在留資格未設定' })),
    }
  }
  // 国籍別 or 在留資格別の内訳
  const byNat = {}, byVisa = {}
  list.forEach(w => {
    const n = w.nationality || '未設定'; byNat[n] = (byNat[n] || 0) + 1
    const v = w.visa_type || '未設定'; byVisa[v] = (byVisa[v] || 0) + 1
  })
  const useNat = /国籍/.test(s)
  const breakdown = useNat ? byNat : byVisa
  const label = useNat ? '国籍別' : '在留資格別'
  const items = Object.entries(breakdown).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: k, tab: 'workers', label: k, sub: `${v}名` }))
  return {
    summary: `在籍者は合計 ${list.length}名です（${label}の内訳）。`,
    count: list.length, items,
  }
}

// ── POST /app/api/assistant/query ───────────────────────────────
router.post('/query', async (req, res) => {
  try {
    const companyId = req.profile?.company_id
    const p = assistant.parseQuery(req.body?.q || '')

    if (p.intent === 'help' || !companyId) {
      return res.json({
        ok: true, intent: 'help', intent_label: 'ヘルプ',
        summary: '「在留期限・資格/健診・届出・有給・人数」について質問できます。例：',
        count: 0, items: [], examples: assistant.EXAMPLES, tab: null,
      })
    }

    const sb = adminClient()
    let items = [], summary = '', tab = p.intent, note = null

    try {
      if (p.intent === 'visa') {
        items = await queryVisa(sb, companyId, p)
        summary = items.length
          ? `在留・パスポート等の期限が${p.timeframeDays}日以内（超過含む）の従業員は ${items.length}名です。`
          : `在留・パスポート等の期限が${p.timeframeDays}日以内に迫っている従業員はいません。`
      } else if (p.intent === 'certs') {
        items = await queryCerts(sb, companyId, p)
        summary = items.length
          ? `資格・健診の期限が${p.timeframeDays}日以内（超過含む）のものは ${items.length}件です。`
          : `資格・健診の期限が${p.timeframeDays}日以内に迫っているものはありません。`
      } else if (p.intent === 'filings') {
        items = await queryFilings(sb, companyId, p)
        summary = items.length
          ? `未提出の届出は ${items.length}件です（提出期限の近い順）。`
          : '未提出の届出で期限が近いものはありません。'
      } else if (p.intent === 'leave') {
        items = await queryLeave(sb, companyId, p)
        summary = items.length
          ? `有給残が ${p.threshold}日以下の従業員は ${items.length}名です。`
          : `有給残が ${p.threshold}日以下の従業員はいません。`
      } else if (p.intent === 'headcount') {
        const r = await queryHeadcount(sb, companyId, p)
        items = r.items; summary = r.summary
        return res.json({ ok: true, intent: p.intent, intent_label: p.intent_label, summary, count: r.count, items, tab })
      }
    } catch (e) {
      // 未適用テーブル等はデグレード（空＋注記）
      const miss = /worker_certifications|employment_filings|leave_ledger|does not exist|schema cache/i.test(e.message || '')
      if (miss) {
        note = 'この機能に必要なデータがまだ有効化されていません（マイグレーション未適用の可能性）。'
        items = []; summary = '該当データを取得できませんでした。'
      } else {
        throw e
      }
    }

    res.json({ ok: true, intent: p.intent, intent_label: p.intent_label, summary, count: items.length, items, tab, note })
  } catch (e) {
    console.error('[assistant query]', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── GET /app/api/assistant/examples ─────────────────────────────
router.get('/examples', (req, res) => {
  res.json({ ok: true, examples: assistant.EXAMPLES })
})

module.exports = router

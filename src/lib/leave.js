// ============================================================
// GreenBridge — 年次有給休暇 計算ロジック（Phase5）
// ・法定付与日数の算出（労基法39条）
// ・台帳(leave_ledger)からの残数・失効の集計
// 純粋関数（DB非依存）→ テスト容易。TZは Asia/Tokyo を前提に日付文字列で扱う。
// ============================================================

// 勤続年数(継続勤務months)に応じた法定付与日数（フルタイム・出勤率8割以上を前提）
// 6ヶ月:10 / 1.5年:11 / 2.5年:12 / 3.5年:14 / 4.5年:16 / 5.5年:18 / 6.5年以上:20
function statutoryGrantDays(serviceMonths) {
  if (serviceMonths < 6)  return 0
  if (serviceMonths < 18) return 10   // 6ヶ月〜1.5年未満
  if (serviceMonths < 30) return 11   // 1.5〜2.5年
  if (serviceMonths < 42) return 12   // 2.5〜3.5年
  if (serviceMonths < 54) return 14   // 3.5〜4.5年
  if (serviceMonths < 66) return 16   // 4.5〜5.5年
  if (serviceMonths < 78) return 18   // 5.5〜6.5年
  return 20                            // 6.5年以上
}

// 入社日(entry: 'YYYY-MM-DD')から、基準日(asOf)までに「付与されるべき」付与イベント一覧を生成。
//   付与日 = 入社6ヶ月後、その後1年ごと。各付与の失効日 = 付与日 + 2年。
//   返却: [{ grantNo, grant_date, expire_date, days, serviceMonths }]
function scheduledGrants(entryDateStr, asOfStr) {
  if (!entryDateStr) return []
  const entry = parseDate(entryDateStr)
  const asOf  = asOfStr ? parseDate(asOfStr) : new Date()
  if (!entry || isNaN(entry)) return []

  const grants = []
  // 1回目: 入社6ヶ月後。以降12ヶ月ごと。
  for (let i = 0; i < 50; i++) {
    const monthsAfter = 6 + i * 12
    const gd = addMonths(entry, monthsAfter)
    if (gd > asOf) break
    const serviceMonths = monthsAfter
    const days = statutoryGrantDays(serviceMonths)
    if (days <= 0) continue
    grants.push({
      grantNo: i + 1,
      grant_date:  fmt(gd),
      expire_date: fmt(addMonths(gd, 24)),  // 付与から2年で失効
      days,
      serviceMonths,
    })
  }
  return grants
}

// 台帳エントリ配列から残数・内訳を集計
//   entries: [{ entry_type, days, effective_date, expire_date }]
//   asOf: 基準日（失効判定用）
//   返却: { granted, used, adjusted, expired, balance, activeLots:[...] }
function summarize(entries, asOfStr) {
  const asOf = asOfStr ? parseDate(asOfStr) : new Date()
  let granted = 0, used = 0, adjusted = 0, expired = 0
  for (const e of (entries || [])) {
    const d = Number(e.days) || 0
    if (e.entry_type === 'grant')  granted  += d
    else if (e.entry_type === 'use')    used     += d
    else if (e.entry_type === 'adjust') adjusted += d   // 正負どちらもありうる
    else if (e.entry_type === 'expire') expired  += d
  }
  // 残数 = 付与 + 調整 − 消化 − 失効
  const balance = round1(granted + adjusted - used - expired)
  return { granted: round1(granted), used: round1(used), adjusted: round1(adjusted), expired: round1(expired), balance }
}

// ── 日付ヘルパ（タイムゾーン非依存・日付のみ）─────────────────
function parseDate(s) {
  if (!s) return null
  const str = String(s).slice(0, 10)
  const [y, m, d] = str.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}
function addMonths(date, months) {
  const d = new Date(date)
  const targetMonth = d.getUTCMonth() + months
  const nd = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, d.getUTCDate()))
  // 月末調整（例: 8/31 + 6ヶ月 = 2/28）
  if (nd.getUTCDate() !== d.getUTCDate()) nd.setUTCDate(0)
  return nd
}
function fmt(date) {
  return date.toISOString().slice(0, 10)
}
function round1(v) { return Math.round(v * 10) / 10 }

// 2日付間の日数（両端含む・暦日）。半休等は考慮せず単純な暦日数。
function dateRangeDays(startStr, endStr) {
  const s = parseDate(startStr), e = parseDate(endStr)
  if (!s || !e || e < s) return 0
  return Math.round((e - s) / 86400000) + 1
}

module.exports = {
  statutoryGrantDays,
  scheduledGrants,
  summarize,
  dateRangeDays,
  // テスト用
  _addMonths: addMonths,
}

// ============================================================
// GreenBridge — AIアシスタント 意図解析（Phase10・純粋関数・内部完結）
//   外部API不要。自然文をキーワード/パターンで解釈し、
//   どのドメイン(在留/資格/届出/有給/件数)をどの期間で問い合わせるかを返す。
//   実データ照会は src/routes/assistant.js が既存テーブルに対して行う。
// ============================================================

const INTENTS = ['visa', 'certs', 'filings', 'leave', 'headcount', 'help']

const INTENT_LABEL = {
  visa:      '在留期限',
  certs:     '資格・健診',
  filings:   '雇用書類・届出',
  leave:     '有給休暇',
  headcount: '人数集計',
  help:      'ヘルプ',
}

// ドメイン判定キーワード（部分一致）。先に並ぶものほど優先。
const KEYWORDS = {
  filings:   ['届出', '提出', '入管', '未提出', '受入れ届'],
  certs:     ['資格', '健診', '健康診断', '免許', '講習', 'フォークリフト', '玉掛', 'フルハーネス', '技能講習'],
  leave:     ['有給', '有休', '年休', '休暇', '残日数', '残数'],
  visa:      ['在留', 'ビザ', 'パスポート', '在留カード', '資格外', '更新'],
  headcount: ['何人', '人数', '国籍', '一覧', '全員', '在籍', '何名'],
}

// 全角→半角数字
function toHalf(s) {
  return String(s || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
}

// JST 今日
function todayJst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
}

// 今月末までの残日数（JST）
function daysToEndOfMonth(today) {
  const t = today || todayJst()
  const [y, m] = t.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()  // 当月末日
  const d = Number(t.slice(8, 10))
  return last - d
}

// 期間（日数）を自然文から推定。見つからなければ既定値を返す。
function parseTimeframe(q, def = 90) {
  const s = toHalf(q)
  // 明示的な「Nヶ月」「Nか月」「Nカ月」
  const mMonth = s.match(/(\d+)\s*[ヶか力カ]?\s*月/)
  if (mMonth) return Math.max(0, parseInt(mMonth[1], 10) * 30)
  // 「N日」
  const mDay = s.match(/(\d+)\s*日/)
  if (mDay) return Math.max(0, parseInt(mDay[1], 10))
  // 相対語
  if (/今日|本日/.test(s)) return 0
  if (/今週|一週間|1週間|週/.test(s)) return 7
  if (/今月/.test(s)) return daysToEndOfMonth()
  if (/来月|翌月/.test(s)) return daysToEndOfMonth() + 30
  if (/再来月/.test(s)) return daysToEndOfMonth() + 60
  if (/半年/.test(s)) return 180
  return def
}

// 有給の「残りわずか」閾値。「N日」を拾う。既定5日（年5日取得義務観点）。
function parseThreshold(q, def = 5) {
  const s = toHalf(q)
  const m = s.match(/(\d+)\s*日/)
  if (m) return Math.max(0, parseInt(m[1], 10))
  return def
}

// 「切れた/超過/過ぎ」など、期限超過を明示的に含めたいか
function wantsExpired(q) {
  return /切れ|超過|過ぎ|期限切れ|失効|オーバー/.test(String(q || ''))
}

// メイン: 自然文 → 意図
function parseQuery(q) {
  const raw = String(q || '').trim()
  const s = toHalf(raw)
  let intent = 'help'

  // visa_type を直接含む人数質問は headcount を優先
  const mentionsVisaType = /特定技能|技能実習|技人国|技術・人文知識|エンジニア/.test(s)
  const headcountWord = KEYWORDS.headcount.some(k => s.includes(k))

  if (mentionsVisaType && (headcountWord || /何人|何名|人数|一覧/.test(s))) {
    intent = 'headcount'
  } else {
    // 期限/残数の文脈語があるか
    for (const key of ['filings', 'certs', 'leave', 'visa', 'headcount']) {
      if (KEYWORDS[key].some(k => s.includes(k))) { intent = key; break }
    }
  }

  return {
    intent,
    intent_label: INTENT_LABEL[intent],
    timeframeDays: parseTimeframe(raw),
    threshold: parseThreshold(raw),
    wantsExpired: wantsExpired(raw),
    raw,
  }
}

// サジェスト用の質問例
const EXAMPLES = [
  '来月 在留期限が切れる従業員',
  '在留期限が30日以内の人',
  '資格・健診の期限が近い人',
  '未提出の届出',
  '有給が残り5日以下の人',
  '特定技能は何人',
  '国籍別の人数',
]

module.exports = {
  INTENTS, INTENT_LABEL, KEYWORDS, EXAMPLES,
  todayJst, daysToEndOfMonth, parseTimeframe, parseThreshold, wantsExpired, parseQuery,
}

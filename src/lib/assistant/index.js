// ============================================================
// GreenBridge — AIアシスタント 意図解析サービス（Phase10 / 内部完結＋LLM差し替え可）
//   自然文 → 意図 { intent, timeframeDays, threshold, wantsExpired }
//
//   解析エンジンは差し替え可能:
//     AI_PROVIDER=internal|anthropic|openai   （省略時 internal＝ルールベース）
//     将来追加時は providers/<name>.js を作り PROVIDERS に登録するだけ。
//
//   重要（プライバシー）: LLM へ送るのは「ユーザーの質問文」のみ（意図抽出=NLU）。
//   従業員データ（在留番号・氏名等）の照会と回答生成は常にサーバ内で完結し、
//   外部へは送信しない。LLM 失敗時・キー未設定時はルールベースに自動フォールバック。
//
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

// ── プロバイダ登録（翻訳サービスと同方式。将来ここに追加するだけで切替可能）──
const PROVIDERS = {
  anthropic: require('./providers/anthropic'),
  openai:    require('./providers/openai'),
}
function activeProviderName() {
  const name = (process.env.AI_PROVIDER || 'internal').toLowerCase()
  return name
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
  const mMonth = s.match(/(\d+)\s*[ヶか力カ]?\s*月/)
  if (mMonth) return Math.max(0, parseInt(mMonth[1], 10) * 30)
  const mDay = s.match(/(\d+)\s*日/)
  if (mDay) return Math.max(0, parseInt(mDay[1], 10))
  if (/今日|本日/.test(s)) return 0
  if (/今週|一週間|1週間|週/.test(s)) return 7
  if (/今月/.test(s)) return daysToEndOfMonth()
  if (/来月|翌月/.test(s)) return daysToEndOfMonth() + 30
  if (/再来月/.test(s)) return daysToEndOfMonth() + 60
  if (/半年/.test(s)) return 180
  return def
}

// 有給の「残りわずか」閾値。「N日」を拾う。既定5日。
function parseThreshold(q, def = 5) {
  const s = toHalf(q)
  const m = s.match(/(\d+)\s*日/)
  if (m) return Math.max(0, parseInt(m[1], 10))
  return def
}

function wantsExpired(q) {
  return /切れ|超過|過ぎ|期限切れ|失効|オーバー/.test(String(q || ''))
}

// ── ルールベース意図解析（既定・内部完結）──────────────────────
function parseQuery(q) {
  const raw = String(q || '').trim()
  const s = toHalf(raw)
  let intent = 'help'

  const mentionsVisaType = /特定技能|技能実習|技人国|技術・人文知識|エンジニア/.test(s)
  const headcountWord = KEYWORDS.headcount.some(k => s.includes(k))

  if (mentionsVisaType && (headcountWord || /何人|何名|人数|一覧/.test(s))) {
    intent = 'headcount'
  } else {
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
    via: 'internal',
  }
}

// 解析結果を正規化（LLMの返り値の欠損をルールベース既定で補完）
function normalizeIntent(obj, raw, via) {
  const rule = parseQuery(raw)
  const intent = INTENTS.includes(obj?.intent) ? obj.intent : rule.intent
  const tf = Number.isFinite(+obj?.timeframeDays) ? Math.max(0, +obj.timeframeDays) : rule.timeframeDays
  const th = Number.isFinite(+obj?.threshold) ? Math.max(0, +obj.threshold) : rule.threshold
  return {
    intent,
    intent_label: INTENT_LABEL[intent],
    timeframeDays: tf,
    threshold: th,
    wantsExpired: typeof obj?.wantsExpired === 'boolean' ? obj.wantsExpired : rule.wantsExpired,
    raw,
    via: via || 'internal',
  }
}

// ── 意図解決（公開IF）: プロバイダ優先、失敗時ルールベース ──────
async function resolveIntent(q) {
  const raw = String(q || '').trim()
  const name = activeProviderName()
  if (name === 'internal' || !PROVIDERS[name]) {
    return parseQuery(raw)   // via: 'internal'
  }
  try {
    const parsed = await PROVIDERS[name].parseIntent(raw, { intents: INTENTS, today: todayJst() })
    return normalizeIntent(parsed, raw, name)
  } catch (e) {
    // キー未設定・API失敗 → ルールベースへフォールバック（壊れない）
    const rule = parseQuery(raw)
    return { ...rule, via: 'internal-fallback' }
  }
}

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
  todayJst, daysToEndOfMonth, parseTimeframe, parseThreshold, wantsExpired,
  parseQuery, normalizeIntent, resolveIntent, activeProviderName,
}

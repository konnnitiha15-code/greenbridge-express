// ============================================================
// Anthropic（Claude）意図解析プロバイダ
//   共通インターフェース:
//     name: string
//     async parseIntent(question, ctx) -> { intent, timeframeDays?, threshold?, wantsExpired? }
//     失敗時は throw（index.js がルールベースへフォールバック）
//
//   送信するのは「ユーザーの質問文」のみ（NLU=意図抽出）。従業員データは送らない。
//   ANTHROPIC_API_KEY が未設定なら throw（=フォールバック）。
//   依存追加なし（fetch で直接呼び出し）。
// ============================================================

const API_KEY = process.env.ANTHROPIC_API_KEY || ''
const MODEL   = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest'

function buildSystem(ctx) {
  return [
    'あなたは外国人雇用・労務管理アプリの検索意図分類器です。',
    'ユーザーの日本語の質問を、次のいずれかの intent に分類してください:',
    '- visa: 在留カード/パスポート/資格外活動など在留期限に関する質問',
    '- certs: 資格・健康診断・技能講習などの有効期限に関する質問',
    '- filings: 入管・行政への届出（提出期限・未提出）に関する質問',
    '- leave: 有給休暇の残数に関する質問',
    '- headcount: 在籍人数・国籍別/在留資格別の集計に関する質問',
    '- help: 上記に当てはまらない/雑談',
    '',
    'あわせて次の数値を推定してください（不要なら省略可）:',
    '- timeframeDays: 期限の対象期間を日数で（例「来月」≒60, 「30日以内」=30, 「今月」=月末まで）',
    '- threshold: 有給の「残りわずか」の日数しきい値（既定5）',
    '- wantsExpired: 「切れた/超過」など期限超過を含めたいなら true',
    '',
    `今日は ${ctx.today} です。`,
    'JSON のみを出力してください。例: {"intent":"visa","timeframeDays":60,"wantsExpired":true}',
  ].join('\n')
}

module.exports = {
  name: 'anthropic',

  async parseIntent(question, ctx) {
    if (!API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    let res
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 200,
          system: buildSystem(ctx || {}),
          messages: [{ role: 'user', content: String(question || '').slice(0, 500) }],
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`anthropic http ${res.status}`)
    const json = await res.json()
    const text = (json.content || []).map(b => b.text || '').join('').trim()
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('anthropic: no json in response')
    return JSON.parse(m[0])
  },
}

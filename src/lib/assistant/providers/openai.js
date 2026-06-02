// ============================================================
// OpenAI 意図解析プロバイダ
//   共通インターフェース:
//     name: string
//     async parseIntent(question, ctx) -> { intent, timeframeDays?, threshold?, wantsExpired? }
//     失敗時は throw（index.js がルールベースへフォールバック）
//
//   送信するのは「ユーザーの質問文」のみ（NLU=意図抽出）。従業員データは送らない。
//   OPENAI_API_KEY が未設定なら throw（=フォールバック）。
//   依存追加なし（fetch で直接呼び出し）。
// ============================================================

const API_KEY = process.env.OPENAI_API_KEY || ''
const MODEL   = process.env.OPENAI_MODEL || 'gpt-4o-mini'

function buildSystem(ctx) {
  return [
    'あなたは外国人雇用・労務管理アプリの検索意図分類器です。',
    'ユーザーの日本語の質問を intent に分類します: visa / certs / filings / leave / headcount / help。',
    '- visa=在留/パスポート/資格外活動の期限, certs=資格・健診の期限, filings=入管届出, leave=有給残数, headcount=人数集計, help=その他',
    'あわせて timeframeDays(期間の日数), threshold(有給しきい値・既定5), wantsExpired(期限超過を含むか) を推定。',
    `今日は ${ctx.today} です。JSON オブジェクトのみを返してください。`,
  ].join('\n')
}

module.exports = {
  name: 'openai',

  async parseIntent(question, ctx) {
    if (!API_KEY) throw new Error('OPENAI_API_KEY not set')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    let res
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildSystem(ctx || {}) },
            { role: 'user', content: String(question || '').slice(0, 500) },
          ],
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`openai http ${res.status}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('openai: no json in response')
    return JSON.parse(m[0])
  },
}

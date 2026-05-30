// ============================================================
// MyMemory 翻訳プロバイダ
// https://mymemory.translated.net/doc/spec.php
//
// プロバイダ共通インターフェース:
//   name: string
//   async translate(text, sourceLang, targetLang) -> { translated, raw }
//   失敗時は throw
//
// 無料枠: 匿名は 1日あたり制限あり。MYMEMORY_EMAIL を設定すると上限が増える。
// ============================================================

// アプリの言語コード → MyMemory(ISO 639-1 系) へのマッピング
const LANG_MAP = {
  ja: 'ja',
  vi: 'vi',
  id: 'id',
  tl: 'tl',     // タガログ語
  zh: 'zh-CN',  // 中国語(簡体)
  my: 'my',     // ミャンマー語
  en: 'en',
}
function mmLang(code) {
  return LANG_MAP[code] || code
}

const EMAIL = process.env.MYMEMORY_EMAIL || ''

module.exports = {
  name: 'mymemory',

  async translate(text, sourceLang, targetLang) {
    const langpair = `${mmLang(sourceLang)}|${mmLang(targetLang)}`
    const params = new URLSearchParams({ q: text, langpair })
    if (EMAIL) params.set('de', EMAIL)
    const url = `https://api.mymemory.translated.net/get?${params.toString()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let res
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`mymemory http ${res.status}`)

    const json = await res.json()
    // responseStatus は 200 が正常。数値 or 文字列で返ることがある
    const status = Number(json.responseStatus)
    const translated = json.responseData && json.responseData.translatedText
    if (status !== 200 || !translated) {
      throw new Error(`mymemory failed: status=${json.responseStatus} detail=${(json.responseDetails||'').slice(0,80)}`)
    }
    // MyMemory は失敗時に英語の警告文を translatedText に入れることがある
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(translated)) {
      throw new Error('mymemory warning: ' + translated.slice(0, 80))
    }
    return { translated, raw: json }
  },
}

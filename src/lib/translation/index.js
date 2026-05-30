// ============================================================
// GreenBridge — translationService
// 共通インターフェース: translate(text, sourceLang, targetLang, opts)
//
// 翻訳優先順位:
//   1. 会社辞書 (company_dictionaries)   ※ opts.companyId が必要
//   2. 業界辞書 (industry_dictionaries)
//   3. translation_cache                 (API結果の再利用)
//   4. 外部プロバイダ (MyMemory 等)       → 成功時 cache に保存
//   失敗時は原文をそのまま返す（壊れない）
//
// プロバイダは差し替え可能:
//   TRANSLATION_PROVIDER=mymemory|google|deepl|anthropic|openai
//   将来追加時は providers/<name>.js を作り PROVIDERS に登録するだけ。
// ============================================================

const crypto = require('crypto')
const { createServiceClient } = require('../supabase')

// ── プロバイダ登録（将来ここに追加するだけで切替可能）──────────
const PROVIDERS = {
  mymemory: require('./providers/mymemory'),
  // google:   require('./providers/google'),
  // deepl:    require('./providers/deepl'),
  // anthropic:require('./providers/anthropic'),
  // openai:   require('./providers/openai'),
}
function activeProvider() {
  const name = process.env.TRANSLATION_PROVIDER || 'mymemory'
  return PROVIDERS[name] || PROVIDERS.mymemory
}

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex')
}

// ── データソース参照 ──────────────────────────────────────────
async function lookupCompanyDict(sb, companyId, source, target, text) {
  if (!companyId) return null
  const { data } = await sb.from('company_dictionaries')
    .select('target_text')
    .eq('company_id', companyId)
    .eq('source_lang', source).eq('target_lang', target)
    .eq('source_text', text)
    .limit(1).maybeSingle()
  return data?.target_text || null
}

async function lookupIndustryDict(sb, source, target, text, industry = 'general') {
  const { data } = await sb.from('industry_dictionaries')
    .select('target_text')
    .eq('industry', industry)
    .eq('source_lang', source).eq('target_lang', target)
    .eq('source_text', text)
    .limit(1).maybeSingle()
  return data?.target_text || null
}

async function lookupCache(sb, source, target, hash) {
  const { data } = await sb.from('translation_cache')
    .select('id, translated_text')
    .eq('source_lang', source).eq('target_lang', target)
    .eq('source_hash', hash)
    .limit(1).maybeSingle()
  return data || null
}

async function saveCache(sb, source, target, hash, text, translated, provider) {
  try {
    await sb.from('translation_cache').upsert({
      source_lang: source, target_lang: target,
      source_hash: hash, source_text: text,
      translated_text: translated, provider,
    }, { onConflict: 'source_lang,target_lang,source_hash' })
  } catch (e) { /* キャッシュ保存失敗は無視 */ }
}

// ── 公開IF: translate ─────────────────────────────────────────
// 戻り値: { ok, translated, via, provider }
//   via: 'empty'|'same'|'company_dict'|'industry_dict'|'cache'|<provider>|'fallback'
async function translate(text, sourceLang, targetLang, opts = {}) {
  const raw = (text == null) ? '' : String(text)
  const norm = raw.trim()
  if (!norm) return { ok: true, translated: raw, via: 'empty' }
  if (sourceLang === targetLang) return { ok: true, translated: raw, via: 'same' }

  const sb = opts.sb || createServiceClient()
  const { companyId, industry = 'general' } = opts

  // 1. 会社辞書
  try {
    const hit = await lookupCompanyDict(sb, companyId, sourceLang, targetLang, norm)
    if (hit) return { ok: true, translated: hit, via: 'company_dict' }
  } catch (e) { console.warn('[translate] company dict:', e.message) }

  // 2. 業界辞書
  try {
    const ind = await lookupIndustryDict(sb, sourceLang, targetLang, norm, industry)
    if (ind) return { ok: true, translated: ind, via: 'industry_dict' }
  } catch (e) { console.warn('[translate] industry dict:', e.message) }

  // 3. cache
  const hash = md5(norm)
  try {
    const cached = await lookupCache(sb, sourceLang, targetLang, hash)
    if (cached) {
      return { ok: true, translated: cached.translated_text, via: 'cache' }
    }
  } catch (e) { console.warn('[translate] cache:', e.message) }

  // 4. 外部プロバイダ
  const provider = activeProvider()
  try {
    const r = await provider.translate(norm, sourceLang, targetLang)
    if (r && r.translated) {
      await saveCache(sb, sourceLang, targetLang, hash, norm, r.translated, provider.name)
      return { ok: true, translated: r.translated, via: provider.name, provider: provider.name }
    }
  } catch (e) {
    console.warn('[translate] provider failed:', e.message)
  }

  // フォールバック: 原文
  return { ok: false, translated: raw, via: 'fallback' }
}

module.exports = { translate, activeProvider }

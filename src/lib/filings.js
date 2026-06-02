// ============================================================
// GreenBridge — 外国人雇用書類（在留資格届出）ロジック（Phase9・純粋関数）
//   在留資格別の標準届出テンプレート、提出期限レベル判定、
//   繰り返し届出の次回期限算出。すべて副作用なし。
// ============================================================

// 在留資格カテゴリ
const VISA_CATEGORIES = ['technical_intern', 'specified_skilled', 'engineer', 'common', 'other']

const CATEGORY_LABEL = {
  technical_intern:  '技能実習',
  specified_skilled: '特定技能',
  engineer:          '技人国',          // 技術・人文知識・国際業務
  common:            '共通',
  other:             'その他',
}

const STATUSES   = ['pending', 'submitted', 'not_required']
const RECURRENCE = ['none', 'quarterly', 'yearly']

// 標準届出テンプレート（コード固定）。各要素 { filing_type, recurrence, submitted_to, note? }
const FILING_TEMPLATES = {
  specified_skilled: [
    { filing_type: '受入れ状況に係る届出（定期）',         recurrence: 'quarterly', submitted_to: '出入国在留管理庁', note: '四半期ごと。翌四半期の初日から14日以内に提出' },
    { filing_type: '支援実施状況に係る届出（定期）',       recurrence: 'quarterly', submitted_to: '出入国在留管理庁', note: '四半期ごと' },
    { filing_type: '活動状況に係る届出（定期）',           recurrence: 'quarterly', submitted_to: '出入国在留管理庁', note: '四半期ごと' },
    { filing_type: '特定技能雇用契約の変更に係る届出（随時）', recurrence: 'none',   submitted_to: '出入国在留管理庁', note: '事由発生から14日以内' },
    { filing_type: '支援計画の変更に係る届出（随時）',     recurrence: 'none',      submitted_to: '出入国在留管理庁', note: '事由発生から14日以内' },
  ],
  technical_intern: [
    { filing_type: '技能実習実施困難時届出（随時）',       recurrence: 'none',      submitted_to: '外国人技能実習機構(OTIT)', note: '事由発生後遅滞なく' },
    { filing_type: '実施状況報告書（年次）',               recurrence: 'yearly',    submitted_to: '外国人技能実習機構(OTIT)', note: '毎年1回' },
    { filing_type: '技能実習計画の軽微な変更届出（随時）', recurrence: 'none',      submitted_to: '外国人技能実習機構(OTIT)' },
  ],
  engineer: [
    { filing_type: '中長期在留者の受入れ開始に関する届出', recurrence: 'none',      submitted_to: '出入国在留管理庁', note: '受入れ開始から14日以内' },
    { filing_type: '中長期在留者の受入れ終了に関する届出', recurrence: 'none',      submitted_to: '出入国在留管理庁', note: '受入れ終了から14日以内' },
    { filing_type: '契約機関に関する届出（契約変更）',     recurrence: 'none',      submitted_to: '出入国在留管理庁', note: '事由発生から14日以内' },
  ],
  common: [
    { filing_type: '在留期間更新許可申請',                 recurrence: 'none',      submitted_to: '出入国在留管理庁', note: '在留期限のおおむね3ヶ月前から申請可' },
    { filing_type: '在留資格変更許可申請',                 recurrence: 'none',      submitted_to: '出入国在留管理庁' },
  ],
}

// JST の今日（YYYY-MM-DD）
function todayJst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
}

// 指定日までの残日数（JST基準）。null安全。
function daysUntil(dateStr, today) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00+09:00')
  if (isNaN(d)) return null
  const base = new Date((today || todayJst()) + 'T00:00:00+09:00')
  return Math.round((d - base) / 86400000)
}

// 残日数 → レベル（visa/certs と統一）
function expireLevel(days) {
  if (days == null) return null
  if (days < 0)   return 'expired'
  if (days <= 30) return 'urgent'
  if (days <= 90) return 'warn'
  return 'ok'
}

// 月加算（日付の月末はその月の末日にクランプ）。YYYY-MM-DD を返す。
function addMonths(dateStr, months) {
  if (!dateStr) return null
  const s = String(dateStr).slice(0, 10)
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  const base = new Date(Date.UTC(y, m - 1, d))
  const targetMonth = base.getUTCMonth() + months
  const ty = base.getUTCFullYear() + Math.floor(targetMonth / 12)
  const tm = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const td = Math.min(d, lastDay)
  const mm = String(tm + 1).padStart(2, '0')
  const dd = String(td).padStart(2, '0')
  return `${ty}-${mm}-${dd}`
}

// 繰り返し届出の次回期限。baseDate（前回の due_date 等）から算出。
function nextDueDate(baseDate, recurrence) {
  if (!baseDate) return null
  if (recurrence === 'quarterly') return addMonths(baseDate, 3)
  if (recurrence === 'yearly')    return addMonths(baseDate, 12)
  return null
}

// カテゴリの標準届出リスト（作成UI候補）
function buildFromTemplate(category) {
  return (FILING_TEMPLATES[category] || []).slice()
}

module.exports = {
  VISA_CATEGORIES, CATEGORY_LABEL, STATUSES, RECURRENCE, FILING_TEMPLATES,
  todayJst, daysUntil, expireLevel, addMonths, nextDueDate, buildFromTemplate,
}

// ============================================================
// GreenBridge — 労務手続きワークフロー ロジック（Phase8・純粋関数）
//   入社/退社などの定型手続きの「標準ステップ（テンプレート）」を定義し、
//   作成時にタスク配列へ展開する。進捗集計もここに集約。
//   ※ コード固定テンプレート。作成後は個別タスクとしてDBで編集できる。
// ============================================================

// 手続き種別
const KINDS = ['onboarding', 'offboarding', 'other']

const KIND_LABEL = {
  onboarding:  '入社手続き',
  offboarding: '退社手続き',
  other:       'その他手続き',
}

// タスクの状態
const TASK_STATUSES = ['todo', 'doing', 'done', 'skip']

// 標準ステップ（コード固定）。各要素 { label, category }
const TEMPLATES = {
  onboarding: [
    { label: '雇用契約書の締結',                 category: '契約' },
    { label: '労働条件通知書の交付',             category: '契約' },
    { label: '在留カード・パスポートの確認',     category: '在留' },
    { label: '資格外活動許可の確認（必要時）',   category: '在留' },
    { label: '健康保険・厚生年金の加入手続き',   category: '社保' },
    { label: '雇用保険の加入手続き',             category: '社保' },
    { label: '住民票・マイナンバーの取得',       category: '総務' },
    { label: '給与振込口座の登録',               category: '給与' },
    { label: '雇入時健康診断の実施',             category: '安全' },
    { label: '安全衛生教育の実施',               category: '安全' },
    { label: '緊急連絡先の登録',                 category: '総務' },
  ],
  offboarding: [
    { label: '退職届の受理',                     category: '総務' },
    { label: '貸与品の返却確認',                 category: '総務' },
    { label: '健康保険・厚生年金の喪失手続き',   category: '社保' },
    { label: '雇用保険の喪失手続き・離職票発行', category: '社保' },
    { label: '最終給与・未消化有給の精算',       category: '給与' },
    { label: '源泉徴収票の発行',                 category: '給与' },
    { label: '在留資格に関する届出（受入終了）', category: '在留' },
    { label: '私物の返却・社内データの削除',     category: '総務' },
  ],
  other: [],
}

// 種別の既定タイトル
function defaultTitle(kind) {
  return KIND_LABEL[kind] || KIND_LABEL.other
}

// テンプレートからタスク雛形を生成（sort_order 付与）。DB列にそのまま使える形。
//   返り値: [{ label, category, sort_order }]
function buildTasks(kind) {
  const tpl = TEMPLATES[kind] || []
  return tpl.map((t, i) => ({
    label: t.label,
    category: t.category || null,
    sort_order: (i + 1) * 10,
  }))
}

// タスク配列から進捗を集計。done と skip を「完了扱い」、pct はその割合。
function progress(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  const total = list.length
  const done  = list.filter(t => t.status === 'done').length
  const skip  = list.filter(t => t.status === 'skip').length
  const doing = list.filter(t => t.status === 'doing').length
  const closed = done + skip
  const pct = total === 0 ? 0 : Math.round((closed / total) * 100)
  return { total, done, skip, doing, closed, pct, allClosed: total > 0 && closed === total }
}

module.exports = { KINDS, KIND_LABEL, TASK_STATUSES, TEMPLATES, defaultTitle, buildTasks, progress }

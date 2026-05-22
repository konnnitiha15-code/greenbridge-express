/**
 * GreenBridge — テストデータリセット & シードスクリプト
 *
 * 実行: node scripts/reset-and-seed.js
 *
 * 処理内容:
 * 1. Supabase Auth の全ユーザーを削除
 * 2. DB テーブルをクリア（companies → cascade）
 * 3. テスト会社を作成
 * 4. 管理者アカウントを作成
 * 5. ワーカーレコード + ワーカーアカウントを作成
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── テストアカウント定義 ─────────────────────────────────
const TEST_COMPANY = {
  name:     'GreenBridge テスト会社',
  name_kana:'ぐりーんぶりっじ てすとかいしゃ',
}

const ADMIN_ACCOUNT = {
  email:    'admin@greenbridge-test.com',
  password: 'GBAdmin2026!',
  role:     'admin',
  fullName: '管理者 テスト',
}

const WORKER_ACCOUNTS = [
  {
    email:    'worker01@greenbridge-test.com',
    password: 'GBWorker2026!',
    name:     'Nguyen Van An',
    language: 'vi',
    jobTitle: '溶接工',
    department: '製造第1課',
    supervisor: '管理者 テスト',
    nationality: 'ベトナム',
    entryDate: '2025-04-01',
  },
  {
    email:    'worker02@greenbridge-test.com',
    password: 'GBWorker2026!',
    name:     'Siti Rahayu',
    language: 'id',
    jobTitle: '組立工',
    department: '製造第2課',
    supervisor: '管理者 テスト',
    nationality: 'インドネシア',
    entryDate: '2025-06-01',
  },
]

// ── ユーティリティ ────────────────────────────────────────
function log(msg)  { console.log(`✓  ${msg}`) }
function warn(msg) { console.warn(`⚠  ${msg}`) }
function err(msg)  { console.error(`✗  ${msg}`) }

async function step(name, fn) {
  process.stdout.write(`  ${name}... `)
  try {
    const result = await fn()
    console.log('OK')
    return result
  } catch (e) {
    console.log(`FAILED: ${e.message}`)
    throw e
  }
}

// ── STEP 1: 全ユーザー削除 ────────────────────────────────
async function deleteAllUsers() {
  console.log('\n[1] Auth ユーザー全削除')
  const { data: { users }, error } = await sb.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error

  if (users.length === 0) {
    log('削除対象ユーザーなし')
    return
  }

  log(`${users.length} 件のユーザーを削除中...`)
  for (const u of users) {
    await step(`  削除: ${u.email}`, () => sb.auth.admin.deleteUser(u.id))
  }
}

// ── STEP 2: DB クリア ─────────────────────────────────────
async function clearDatabase() {
  console.log('\n[2] DB クリア（外部キー順）')

  const tables = [
    'notifications',
    'messages',
    'daily_reports',
    'shift_requests',
    'shifts',
    'attendance_records',
    'documents',
    'profiles',
    'workers',
    'companies',
  ]

  for (const table of tables) {
    await step(`${table} クリア`, async () => {
      const { error } = await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (!error) return
      // テーブルが存在しない場合はスキップ
      if (error.code === 'PGRST116' || error.message.includes('schema cache') || error.message.includes('does not exist')) return
      throw error
    })
  }
}

// ── STEP 3: 会社作成 ──────────────────────────────────────
async function createCompany() {
  console.log('\n[3] テスト会社作成')
  const { data, error } = await sb.from('companies').insert(TEST_COMPANY).select().single()
  if (error) throw error
  log(`会社ID: ${data.id}`)
  return data.id
}

// ── STEP 4: 管理者アカウント作成 ─────────────────────────
async function createAdmin(companyId) {
  console.log('\n[4] 管理者アカウント作成')

  // Auth ユーザー作成
  const { data: { user }, error: authErr } = await sb.auth.admin.createUser({
    email: ADMIN_ACCOUNT.email,
    password: ADMIN_ACCOUNT.password,
    email_confirm: true,
  })
  if (authErr) throw authErr
  log(`Auth ユーザー: ${user.id}`)

  // profiles 作成
  const { error: profileErr } = await sb.from('profiles').insert({
    id:         user.id,
    company_id: companyId,
    worker_id:  null,
    role:       ADMIN_ACCOUNT.role,
    full_name:  ADMIN_ACCOUNT.fullName,
  })
  if (profileErr) throw profileErr
  log(`プロフィール作成完了`)

  return user.id
}

// ── STEP 5: ワーカー作成 ──────────────────────────────────
async function createWorkers(companyId) {
  console.log('\n[5] ワーカーアカウント作成')

  for (const w of WORKER_ACCOUNTS) {
    console.log(`\n  ▸ ${w.name} (${w.email})`)

    // workers テーブルにレコード作成
    let workerRecord = null
    await step('workers レコード作成', async () => {
      const { data, error } = await sb.from('workers').insert({
        company_id:    companyId,
        name:          w.name,
        nationality:   w.nationality,
        language:      w.language,
        job_title:     w.jobTitle,
        department:    w.department,
        supervisor:    w.supervisor,
        entry_date:    w.entryDate,
        status:        'active',
      }).select().single()
      if (error) throw error
      if (!data) throw new Error('workers レコードが返されませんでした')
      workerRecord = data
    })

    // Auth ユーザー作成
    let workerUser = null
    await step('Auth ユーザー作成', async () => {
      const { data, error } = await sb.auth.admin.createUser({
        email: w.email,
        password: w.password,
        email_confirm: true,
      })
      if (error) throw error
      if (!data?.user) throw new Error('user が返されませんでした')
      workerUser = data.user
    })

    // profiles 作成（worker_id を紐付け）
    await step('profiles 作成（worker_id 紐付け）', async () => {
      const { error } = await sb.from('profiles').insert({
        id:         workerUser.id,
        company_id: companyId,
        worker_id:  workerRecord.id,
        role:       'worker',
        full_name:  w.name,
      })
      if (error) throw error
    })

    log(`worker_id: ${workerRecord.id} / auth_id: ${workerUser.id}`)
  }
}

// ── メイン ────────────────────────────────────────────────
async function main() {
  console.log('========================================')
  console.log('  GreenBridge テストデータ リセット')
  console.log('========================================')

  try {
    await deleteAllUsers()
    await clearDatabase()
    const companyId = await createCompany()
    await createAdmin(companyId)
    await createWorkers(companyId)

    console.log('\n========================================')
    console.log('  完了！テストアカウント情報')
    console.log('========================================')
    console.log('\n【管理者】')
    console.log(`  URL      : /login`)
    console.log(`  メール   : ${ADMIN_ACCOUNT.email}`)
    console.log(`  パスワード: ${ADMIN_ACCOUNT.password}`)
    console.log('\n【ワーカー①】')
    console.log(`  URL      : /worker/login`)
    console.log(`  メール   : ${WORKER_ACCOUNTS[0].email}`)
    console.log(`  パスワード: ${WORKER_ACCOUNTS[0].password}`)
    console.log(`  名前     : ${WORKER_ACCOUNTS[0].name}`)
    console.log('\n【ワーカー②】')
    console.log(`  URL      : /worker/login`)
    console.log(`  メール   : ${WORKER_ACCOUNTS[1].email}`)
    console.log(`  パスワード: ${WORKER_ACCOUNTS[1].password}`)
    console.log(`  名前     : ${WORKER_ACCOUNTS[1].name}`)
    console.log('')
  } catch (e) {
    err(`スクリプト失敗: ${e.message}`)
    process.exit(1)
  }
}

main()

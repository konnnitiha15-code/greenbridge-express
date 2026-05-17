/**
 * GreenBridge — Supabase マイグレーション実行スクリプト
 *
 * 使い方:
 *   node scripts/migrate.js <DBパスワード>
 *
 * DBパスワードの確認場所:
 *   Supabase Dashboard → Project Settings → Database → Database password
 */

const { Client } = require('pg')
const fs         = require('fs')
const path       = require('path')

const PROJECT_REF = 'lbwiusqlzxlkldtvnquf'
const DB_PASSWORD = process.argv[2]

if (!DB_PASSWORD) {
  console.error('❌ DBパスワードを引数で渡してください')
  console.error('   node scripts/migrate.js <パスワード>')
  console.error('')
  console.error('   パスワードの確認:')
  console.error('   https://supabase.com/dashboard/project/lbwiusqlzxlkldtvnquf/settings/database')
  process.exit(1)
}

const client = new Client({
  host:     `db.${PROJECT_REF}.supabase.co`,
  port:     5432,
  database: 'postgres',
  user:     'postgres',
  password: DB_PASSWORD,
  ssl:      { rejectUnauthorized: false },
})

// SQL を文単位に分割（コメント・空行を除く）
function splitSQL(sql) {
  // $$ で囲まれた関数定義をそのまま保つために、
  // セミコロン区切りでも $$ 内は分割しない
  const stmts = []
  let buf = ''
  let inDollar = false

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('--')) {
      buf += '\n'
      continue
    }
    buf += line + '\n'
    if (trimmed.includes('$$')) {
      inDollar = !inDollar
    }
    if (!inDollar && trimmed.endsWith(';')) {
      const stmt = buf.trim()
      if (stmt) stmts.push(stmt)
      buf = ''
    }
  }
  if (buf.trim()) stmts.push(buf.trim())
  return stmts
}

async function run() {
  const sqlFile = path.join(__dirname, '..', 'supabase', 'migrations', '002_worker_rls.sql')
  const sql     = fs.readFileSync(sqlFile, 'utf8')
  const stmts   = splitSQL(sql)

  console.log(`\n🚀 GreenBridge Migration 002`)
  console.log(`   接続先: db.${PROJECT_REF}.supabase.co`)
  console.log(`   ステートメント数: ${stmts.length}\n`)

  await client.connect()

  let ok = 0
  let skip = 0

  for (const stmt of stmts) {
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 70)
    try {
      await client.query(stmt)
      console.log(`  ✅ ${preview}`)
      ok++
    } catch (e) {
      // "already exists" 系は無視
      if (
        e.message.includes('already exists') ||
        e.message.includes('does not exist') ||
        e.message.includes('duplicate')
      ) {
        console.log(`  ⏭  ${preview} (スキップ: ${e.message.split('\n')[0]})`)
        skip++
      } else {
        console.error(`  ❌ ${preview}`)
        console.error(`     エラー: ${e.message}`)
        await client.end()
        process.exit(1)
      }
    }
  }

  await client.end()
  console.log(`\n✨ 完了 — 成功: ${ok} / スキップ: ${skip} / 合計: ${stmts.length}\n`)
}

run().catch(async e => {
  console.error('\n❌ 接続エラー:', e.message)
  console.error('   DBパスワードを確認してください')
  console.error('   https://supabase.com/dashboard/project/lbwiusqlzxlkldtvnquf/settings/database')
  process.exit(1)
})

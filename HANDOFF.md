# GreenBridge Express — Handoff

## プロジェクト概要

技能実習生向けSaaSプラットフォーム。管理者（PC）とワーカー（スマホ）の2画面構成。

| 項目 | 内容 |
|------|------|
| バックエンド | Node.js / Express / EJS |
| DB・認証 | Supabase (PostgreSQL + Auth + RLS) |
| フロント | Vanilla JS（独自CSS、Tailwindなし） |
| デプロイ | Vercel（本番） / localhost:3000（開発） |
| リポジトリ | github.com/konnnitiha15-code/greenbridge-express |

---

## 画面構成

| URL | 対象 | 内容 |
|-----|------|------|
| `/` | 共通 | ログイン先選択ページ |
| `/login` | 管理者専用 | 管理者ログイン |
| `/app` | 管理者 | 実習生管理SPA |
| `/worker/login` | ワーカー専用 | ワーカーログイン |
| `/worker` | ワーカー | モバイル向けアプリ |

---

## 直近やったこと

### Vercel対応 & 認証分離
1. Vercelデプロイ対応（`vercel.json`、`module.exports = app`、`fs.mkdirSync` → `/tmp`）
2. **認証導線完全分離**：管理者(`sb-access-token`) / ワーカー(`gb-worker-token`)で同時ログイン可能
3. `/app/api/*` 全ルートに `requireAdmin` 一括適用
4. Cookie を本番(VERCEL)で `secure: true` 化
5. `connect-flash` → URLクエリパラメータ方式（Vercel serverless対応）

### データ整理
6. **localStorage → Supabase DB 移行**：チャット双方向通信、storage abstraction
7. ハードコード「田中」を全削除 → SERVER_DATA から動的取得
8. **テストデータリセット**：`scripts/reset-and-seed.js` で完全再シード
9. **トップページ追加**（`/`）：管理者・ワーカー選択UI

### 通信改善（最新）
10. **「タブを開く＝最新取得」パターン徹底**：
    - 管理者：home (KPI+勤怠統計)、chat (開いてるチャットの履歴再取得)、shift、nippo、attend
    - ワーカー：s-chat (即時 pollMessages)、s-nippo (DBから日報取得)、s-tpl (テンプレート毎回描画)
11. **JSTタイムゾーン修正**：勤怠フィルターが UTC→JST に
12. **ワーカー側日報をDB化**：`NIPPOS const → let`、`loadAndRenderNippos()` 追加

---

## 現在の状態（動作確認済み）

### ✅ 動作
- `/` ログイン選択ページ
- `/login` 管理者ログイン（URLクエリエラー表示）
- `/worker/login` ワーカーログイン
- `/app` 管理者SPA（二重ガード）
- `/worker` ワーカーアプリ（二重ガード）
- 同時ログイン（同一ブラウザでadmin・worker両立）
- 勤怠打刻 → 管理者勤怠タブで即時反映（タブ開で更新）
- チャット双方向通信（admin 5秒、worker 8秒ポーリング）
- worker_id 紐付けUI（管理者アカウントタブ）
- Vercel本番デプロイ動作中

### 📊 DBテーブル（すべてRLS適用済み）
- profiles / companies / workers
- attendance_records / shifts / shift_requests
- documents / daily_reports / messages / notifications

---

## 未完了のタスク

### 🟡 機能
- [ ] グループチャットDB化（現在 `gb_groups` localStorage）→ `groups` + `group_messages` テーブル要作成
- [ ] ファイルアップロード Supabase Storage 移行（現在 Vercel `/tmp`、再起動で消える）
- [ ] `aiTx()` 翻訳機能の実装（現在は原文返却）
- [ ] シフト申請の承認フロー通知

### 🔵 UX
- [ ] チャット未読バッジの正確な計算
- [ ] 通知（notifications）テーブルの活用

### 🟢 運用
- [ ] Supabase Realtime（WebSocket）でポーリング廃止
- [ ] エラー監視（Sentry等）導入

---

## 重要な決定事項

### Cookie戦略
- **管理者**：`sb-access-token` / `sb-refresh-token`
- **ワーカー**：`gb-worker-token` / `gb-worker-refresh`（独自命名で衝突回避）
- 別Cookie名にすることで**同一ブラウザでの両側同時ログイン**が可能
- `secure: !!(process.env.VERCEL || NODE_ENV === 'production')`

### Vercel対応
- `vercel.json`: 全routes → `src/app.js`
- `src/app.js`: `module.exports = app` + `require.main === module` 分岐
- `fs.mkdirSync` を try/catch でラップ、Vercel時は `/tmp` 使用
- `connect-flash` 使わず URLクエリパラメータ方式

### データ更新方針
- **手動リフレッシュ廃止** → 「タブを開く＝必ず最新取得」
- 30秒/60秒の長期ポーリングは廃止（タブ開閉トリガーで十分）
- 例外：チャットはアクティブ時のみ短間隔ポーリング（5秒/8秒）

### localStorage 使用ルール
- **OK**: theme, language, activeTab, draft, UI state, API cache
- **NG**: 勤怠/シフト/書類/ワーカー/role情報、チャット履歴本体
- `public/js/services/storage.js` でラップ

---

## テストアカウント

| 種別 | URL | メール | パスワード |
|------|-----|--------|-----------|
| 管理者 | `/login` | `admin@greenbridge-test.com` | `GBAdmin2026!` |
| ワーカー① | `/worker/login` | `worker01@greenbridge-test.com` | `GBWorker2026!` |
| ワーカー② | `/worker/login` | `worker02@greenbridge-test.com` | `GBWorker2026!` |

---

## 開発コマンド

```bash
# ローカル起動
npm run dev

# テストデータリセット & 再シード
node scripts/reset-and-seed.js

# Vercelへ自動デプロイ
git push
```

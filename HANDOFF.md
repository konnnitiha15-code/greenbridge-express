# GreenBridge Express — 完全引き継ぎドキュメント

> **新セッション開始時、最初にこのファイルを読み込んでください**
> `cat C:\Users\mayniti\Downloads\greenbridge-express\HANDOFF.md` または `Read` ツールで読む

---

## 🎯 プロジェクト概要

技能実習生（外国人労働者）管理 SaaS プラットフォーム「**GreenBridge**」。
管理者（PC）とワーカー（スマホ）の2画面構成。**完全動作中・Vercel本番稼働中**。

| 項目 | 内容 |
|------|------|
| バックエンド | Node.js 24+ / Express 4 / EJS |
| DB・認証 | Supabase（PostgreSQL + Auth + Realtime + Storage） |
| フロント | Vanilla JS（独自CSS、Tailwindなし） |
| デプロイ | Vercel（本番）/ localhost:3000（開発）/ nodemon |
| リポジトリ | github.com/konnnitiha15-code/greenbridge-express |
| Supabase Project | `lbwiusqlzxlkldtvnquf` |
| 本番URL | https://greenbridge-express.vercel.app |

---

## 🔑 テストアカウント

| 種別 | URL | メール | パスワード |
|------|-----|--------|-----------|
| 👤 管理者 | `/login` | `admin@greenbridge-test.com` | `GBAdmin2026!` |
| 👷 ワーカー① (Nguyen Van An / ベトナム) | `/worker/login` | `worker01@greenbridge-test.com` | `GBWorker2026!` |
| 👷 ワーカー② (Siti Rahayu / インドネシア) | `/worker/login` | `worker02@greenbridge-test.com` | `GBWorker2026!` |

---

## 📁 ディレクトリ構成

```
greenbridge-express/
├── src/
│   ├── app.js                  # Express エントリ
│   ├── middleware/
│   │   ├── auth.js             # requireAuth (admin) / requireWorkerAuth
│   │   └── requireRole.js      # requireAdmin / requireWorker
│   └── routes/
│       ├── auth.js             # /login (admin)
│       ├── spa.js              # /app/* 全API + メインSPA
│       ├── worker-app.js       # /worker/* 全API + ワーカーアプリ
│       └── ... (workers, documents, companies, settings)
├── views/
│   ├── index.ejs               # トップページ（管理者/ワーカー選択）
│   ├── auth/login.ejs          # 管理者ログイン
│   ├── worker-login.ejs        # ワーカーログイン
│   ├── spa.ejs                 # 管理者SPA本体（12タブ）
│   └── worker.ejs              # ワーカーアプリ本体（モバイル）
├── public/
│   ├── css/style.css
│   └── js/
│       ├── app.js                  # 管理者フロント（3000行）
│       ├── worker/attendance.js    # 打刻ロジック
│       └── services/
│           ├── storage.js          # localStorage 抽象化
│           └── realtime.js         # Supabase Realtime 共通
├── supabase/migrations/        # 全SQL（001〜007）
├── scripts/
│   ├── migrate.js              # SQL マイグレーション実行
│   ├── reset-and-seed.js       # テストデータ再生成
│   └── setup-storage.js        # Storage バケット作成
├── HANDOFF.md                  # ← このファイル
├── vercel.json                 # Vercel デプロイ設定
├── .env                        # Supabase キー（gitignore）
└── .env.example                # サンプル
```

---

## ✅ 実装済み機能（完全動作）

### 共通基盤
- ✅ 認証分離（管理者は `sb-access-token`、ワーカーは `gb-worker-token`）
  - **同一ブラウザで両側同時ログイン可能**
- ✅ URL ルーティング: `/` → 選択ページ、`/login` → 管理者、`/worker/login` → ワーカー
- ✅ 全 `/app/api/*` に `requireAuth + requireAdmin` 二重ガード
- ✅ 全 `/worker/api/*` に `requireWorkerAuth + requireWorker` 二重ガード
- ✅ Vercel 本番 `secure: true` Cookie

### 管理者側（/app）
- ✅ ホーム（12 KPI カード - 多すぎるので削減候補）
- ✅ 実習生管理（CRUD・ビザ・在留期限）
- ✅ ワーカーアカウント紐付け UI
- ✅ チャット（個別、検索バー、既読 ✓✓ 表示）
- ✅ グループチャット（メンバー管理、メッセージ）
- ✅ シフト管理（月次、申請承認）
- ✅ 勤怠管理（CRUD、統計、CSV出力）
- ✅ 日報・報告（承認フロー、CSV出力）
- ✅ 書類管理（Supabase Storage、24h署名URL）
- ✅ 通知センター（🔔モーダル + 未読バッジ）
- ✅ ダッシュボード統計 API
- ✅ CSV出力（勤怠・シフト・日報、BOM付UTF-8）
- ✅ 動画マニュアル（UI のみ、削除候補）
- ✅ タスク管理（Kanban、削除候補）

### ワーカー側（/worker）
- ✅ ホーム（クイックアクション、今日のシフト）
- ✅ 打刻（出勤・退勤、JST対応）
- ✅ シフト確認（週単位、自動更新、誰のシフトか表示）
- ✅ 個別チャット（既読、入力欄）
- ✅ グループチャット
- ✅ 申請テンプレート（休み・遅刻・体調不良等、母国語OK）
- ✅ 日報・ヒヤリハット
- ✅ 書類確認（PDF・画像を新規タブで開く、署名URL再発行）
- ✅ SOS緊急連絡
- ✅ ログアウトボタン
- ✅ 6言語対応（vi/id/tl/zh/my/ja）— **部分的**（次セクション参照）

### Realtime（Supabase WebSocket）
- ✅ messages（個別チャット）即時受信
- ✅ group_messages（グループ）即時受信
- ✅ shifts（シフト変更）即時通知 + トースト
- ✅ notifications（通知）即時表示
- ✅ shift_requests / daily_reports（KPI即時更新）
- ✅ ポーリング廃止（フォールバックは残存）

---

## 🗄️ Supabase DB スキーマ

### テーブル一覧（全11テーブル）

| テーブル | 用途 |
|---------|------|
| profiles | ユーザープロフィール（auth.users と worker_id 紐付け） |
| companies | 会社情報 |
| workers | 実習生レコード |
| attendance_records | 勤怠記録 |
| shifts | シフト表 |
| shift_requests | シフト変更申請 |
| documents | 書類メタデータ |
| messages | 個別チャット |
| daily_reports | 日報・ヒヤリハット |
| notifications | 通知 |
| groups | グループ |
| group_members | グループメンバー |
| group_messages | グループメッセージ |

### マイグレーション履歴

```
001 - 初期スキーマ（profiles, companies, workers, documents）
002 - worker_id 紐付け + RLS + helper関数 (my_role, my_company_id, my_worker_id)
003 - shifts + shift_requests
004 - messages + daily_reports
005 - groups + group_members + group_messages
006 - storage bucket (documents)
007 - Realtime publication 設定（REPLICA IDENTITY FULL）
```

すべて **実行済み** ✅

### Supabase Storage
- バケット名: `documents`
- 上限: 50MB
- 対応形式: PDF/画像/Word/Excel/CSV
- 公開: 非公開（署名URL方式）

### RLS（行レベルセキュリティ）
- すべてのテーブルで RLS 有効
- helper関数: `my_role()` / `my_company_id()` / `my_worker_id()`
- admin/staff: 自社内すべてアクセス可
- worker: 自分のレコードのみ

---

## 🌐 環境変数（.env）

```
SUPABASE_URL=https://lbwiusqlzxlkldtvnquf.supabase.co
SUPABASE_ANON_KEY=（.env参照）
SUPABASE_SERVICE_ROLE_KEY=（.env参照）
SESSION_SECRET=greenbridge-secret-2025
PORT=3000
```

**Vercel本番にも設定済み** ✅

---

## 🛠 開発コマンド

```bash
# ローカル起動
npm run dev

# テストデータリセット & 再シード
node scripts/reset-and-seed.js

# SQL マイグレーション実行
node scripts/migrate.js <DBパスワード> <ファイル名>

# Storage バケット作成
node scripts/setup-storage.js

# Vercel自動デプロイ
git push
```

---

## 🔐 重要な技術的決定

### Cookie 戦略
- 管理者: `sb-access-token` / `sb-refresh-token`
- ワーカー: `gb-worker-token` / `gb-worker-refresh`（独自命名で衝突回避）
- 同一ブラウザで両側同時ログイン可能

### Vercel 対応
- `vercel.json` で全 routes → `src/app.js`
- `src/app.js` の最後で `module.exports = app`
- `if (require.main === module)` でローカル起動分岐
- `fs.mkdirSync` を try/catch、Vercel時は `/tmp` を使用
- `connect-flash` は使わず URLクエリパラメータ方式

### Realtime
- Supabase JS SDK を CDN から読み込み
- `realtime.js` ヘルパで購読を抽象化
- 認証は accessToken を `setSession()` で渡す
- フォールバックでポーリングに切り替え

### データ更新方針
- 「タブを開く = 最新取得」を徹底
- ポーリングは Realtime のフォールバックのみ

### localStorage 使用ルール
- ✅ 許可: theme, language, activeTab, draft, UI state, API cache
- ❌ 禁止: 業務データ全般（チャット履歴・勤怠・シフト・書類本体）
- `public/js/services/storage.js` でラップ

---

## 📋 未完了タスク・既知の問題

### 🟡 言語切替の対応漏れ
applyL() で更新される ID は付与済みだが、まだ日本語のままの箇所がある可能性。
特に：
- ホーム画面の動的なテキスト（「8日」「1年目」など）
- モーダルラベル
- 一部のボタン

### 🟡 機能の中途半端さ
- `aiTx()` 翻訳機能は原文返却のみ（実装案: MyMemory 無料API）
- 動画マニュアル: UI のみで実体なし
- タスク管理: 実習生管理と相性悪い

### 🟢 軽微
- ファイルアップロードの multer メモリストア（小規模なら問題なし）
- スタッフロールの活用が不十分

---

## 💡 機能アイデア集（前セッション最終提案）

### 🗑️ 削除・縮小候補

| 機能 | 理由 | 対応 |
|------|------|------|
| タスク管理（Kanban） | 実習生管理SaaSと相性悪い | 削除 OR 「業務指示」として再設計 |
| 動画マニュアル | UI のみで実体なし | 当面非表示 |
| 管理者ホームKPI（12枚） | 多すぎる | 重要4〜6枚に絞る |
| 書類テンプレート | 中途半端 | 完成 or 削除 |

### ⭐ 追加すべき機能（業務必須）

**A. 給与計算連携**
- 時給/月給設定（ワーカーごと）
- 残業時間の自動計算（8h超）
- 休日割増対応（日曜・祝日係数）
- 給与明細PDF配布

**B. ビザ・在留管理（実習生特有）**
- 在留期限カレンダーUI
- 書類期限の自動メール通知
- 健康診断スケジュール管理
- 安全教育・技能講習履歴

**C. コミュニケーション**
- AI翻訳の本実装（MyMemory無料 / Claude API）
- 音声メッセージ
- 既読時刻表示（「14:23 既読」）
- メッセージ検索

**D. データ可視化・分析**
- 勤怠グラフ（月別推移・遅刻傾向）
- ワーカー個別詳細ダッシュボード
- 月次レポートPDF出力

**E. UX・操作性**
- PWA対応（スマホホーム画面追加）
- プッシュ通知（Web Push）
- 全データ横断検索
- 複数ファイル一括アップロード

**F. 運用効率**
- シフト自動生成（過去パターンから提案）
- ワーカー一括登録（CSVインポート）
- テンプレ定型メッセージ
- 多店舗・多部署対応

**G. セキュリティ・コンプライアンス**
- アクセスログ
- 退職者データ完全削除（GDPR的）
- 管理者2要素認証

### 🌟 独自アイデア（GreenBridge特有）

| アイデア | 説明 |
|---------|------|
| 🏥 病院・通訳マッチング | 体調不良時、近隣の対応可能病院＋通訳案内 |
| 🌏 母国送金状況の管理 | 家族への仕送り計画支援 |
| 📚 日本語学習タブ | 業務フレーズ集、漢字テスト |
| 🍱 食事補助 | 社食/弁当注文記録 |
| 🚗 通勤手段管理 | 災害時の安否確認用 |
| 🎂 誕生日リマインダー | 管理者にワーカーの誕生日通知 |
| 💴 給与カウントダウン | 「給与日まで X 日」表示 |
| 🌡 体調記録 | 毎朝の体温記録（コロナ後標準） |
| 📞 緊急連絡網 | SOS発動時に順次連絡 |
| 🗓 法定休暇管理 | 有給5日取得義務管理 |

### 🎯 推奨実装ロードマップ

**Phase 1: 整理&基盤強化（1〜2週間）**
1. ✂️ 削除: タスク管理、動画マニュアル
2. 🔧 ホームKPI を 6 枚に削減
3. ✨ AI翻訳実装（MyMemory無料）
4. ✨ PWA化（スマホホーム追加）
5. ✨ プッシュ通知（Web Push）

**Phase 2: 業務適合（2〜3週間）**
- 給与計算（時給×勤務時間+残業）
- 給与明細PDF
- ビザ期限の自動メール通知
- 健康診断スケジュール

**Phase 3: 効率化・拡張（1ヶ月〜）**
- シフト自動生成
- ワーカーCSV一括登録
- 勤怠分析ダッシュボード
- アクセスログ

**Phase 4: 独自付加価値（任意）**
- 日本語学習タブ
- 誕生日リマインダー
- 病院・通訳マッチング
- 法定有給管理

### 🏆 もし次の1つを選ぶなら

**PWA化 + プッシュ通知**

理由: 既存のRealtimeが活きる、無料、ワーカー体験が劇的UP、ストア審査不要

第2候補: **AI翻訳の本実装（MyMemory無料）** — コンセプトの根幹

---

## 📜 セッション履歴サマリー（直近）

### 完了済みの主要マイルストーン
1. Vercelデプロイ対応（vercel.json、module.exports）
2. 認証導線完全分離（admin/worker別Cookie）
3. localStorage → Supabase DB 完全移行
4. テストデータリセット + 再シード
5. トップページ（選択画面）追加
6. 勤怠管理: タブ開く度に最新取得 + JSTタイムゾーン
7. ワーカー側: 申請テンプレ・日報の表示復活
8. シフトAPIの末日喪失バグ修正（toISOString → getDate）
9. localStorage の古いキャッシュ問題修正
10. _sw TDZ バグ修正（worker.ejs renderShift）
11. グループチャットDB化（005マイグレーション）
12. 書類アップロードのStorage化（24h署名URL）
13. ファイル開くボタン追加（worker側）
14. チャット既読表示（✓ / ✓✓）
15. チャット検索拡張（名前/職種/国籍/部署/言語）
16. Supabase Realtime 完全導入（007マイグレーション）
17. 通知システム（自動生成 + Realtime + 通知センター）
18. 管理者ダッシュボード強化（4枚KPIカード追加）
19. CSV出力（勤怠/シフト/日報、BOM付UTF-8）
20. 言語切替の対応範囲拡大（出退勤・ナビ・チャット）

---

## 🚀 新セッションでの始め方

新しいセッションを開いたら、最初のメッセージで以下のように伝えてください：

```
プロジェクトディレクトリは C:\Users\mayniti\Downloads\greenbridge-express です。
まず HANDOFF.md を読んで、プロジェクトの現状を把握してください。
その後、[ここに実装したい内容] を実装してください。
```

または最も簡単に：

```
C:\Users\mayniti\Downloads\greenbridge-express\HANDOFF.md を読んで、続きを始めましょう。
```

これだけで完全引き継ぎ可能です。

---

## 🔗 参考リンク

- Supabase Dashboard: https://supabase.com/dashboard/project/lbwiusqlzxlkldtvnquf
- Vercel Dashboard: https://vercel.com/konnnitiha39-4420s-projects/greenbridge-express
- GitHub: https://github.com/konnnitiha15-code/greenbridge-express
- 本番URL: https://greenbridge-express.vercel.app

---

**最終更新: 2026-05 末**
**最終コミット: bb86d70 (feat: CSVエクスポート + 言語切替の対象範囲拡大)**

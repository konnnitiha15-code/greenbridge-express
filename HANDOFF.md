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
- ✅ ホーム（監視UI v3: Action Bar / Today Strip / 在留期限pill / 今日の申請・異常 / Slack風Timeline）
- ✅ 実習生管理（CRUD・ビザ・在留期限）
- ✅ ワーカーアカウント紐付け UI
- ✅ チャット（個別、検索バー、既読 ✓✓、画像添付、クイック返信、CSV出力）
- ✅ グループチャット（メンバー管理、メッセージ）
- ✅ シフト管理（月次、申請承認）
- ✅ 勤怠管理（CRUD、統計、CSV出力）
- ✅ 日報・報告（承認フロー、CSV出力）
- ✅ 書類管理（Supabase Storage、24h署名URL）
- ✅ 通知センター（🔔モーダル + 未読バッジ）+ Web Push
- ✅ **給与管理（賃金設定・月次自動計算・確定・明細PDF印刷）** ← 010
- ✅ ダッシュボード統計 API
- ✅ CSV出力（勤怠・シフト・日報・チャット、BOM付UTF-8）
- ✅ 動画マニュアル（UI のみ、削除候補）
- ✅ タスク管理（Kanban、削除候補）

### ワーカー側（/worker）
- ✅ ホーム（クイックアクション、今日のシフト）
- ✅ 打刻（出勤・退勤、JST対応）
- ✅ シフト確認（週単位、自動更新、誰のシフトか表示）
- ✅ 個別チャット（既読、入力欄）
- ✅ グループチャット
- ✅ 申請テンプレート（休み・遅刻・体調不良等、母国語OK・AI翻訳で日本語送信）
- ✅ 日報・ヒヤリハット
- ✅ 書類確認（PDF・画像を新規タブで開く、署名URL再発行）
- ✅ SOS緊急連絡
- ✅ 画像添付（チャット）
- ✅ **給与明細閲覧（公開済みのみ・カード表示）** ← 010
- ✅ ログアウトボタン
- ✅ 6言語対応（vi/id/tl/zh/my/ja）— **部分的**（次セクション参照）

### Realtime（Supabase WebSocket）
- ✅ messages（個別チャット）即時受信
- ✅ group_messages（グループ）即時受信
- ✅ shifts（シフト変更）即時通知 + トースト
- ✅ notifications（通知）即時表示
- ✅ shift_requests / daily_reports（KPI即時更新）
- ✅ ポーリング廃止（フォールバックは残存）

### PWA + Web Push（2026-05-27追加）
- ✅ `manifest-worker.json` / `manifest-admin.json`（standalone, theme #00b050）
- ✅ Service Worker `/sw.js`（静的キャッシュ + push/notificationclick）
- ✅ アイコン `/icons/icon.svg` `/icons/icon-maskable.svg`
- ✅ ワーカー側ショートカット（打刻 / シフト / チャット）
- ✅ web-push (VAPID) サーバー配信ヘルパ `src/lib/push.js`
- ✅ サブスクリプション API `src/routes/push.js`（/api/push/{public-key,subscribe,unsubscribe,resubscribe,test}）
- ✅ DB: `push_subscriptions` テーブル + RLS（008マイグレーション）
- ✅ 既存 notifications.insert 箇所すべてに push 配信を追加
  - 管理者→ワーカー: シフト承認/却下、日報承認、個別チャット
  - ワーカー→管理者: 日報・ヒヤリ提出、シフト変更申請、SOS
- ✅ フロント `public/js/services/push-client.js`（init/enable/disable/test）
- ✅ 設定タブにトグルUI（worker.ejs / spa.ejs）

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
| push_subscriptions | Web Push 購読情報 |
| wage_settings | 賃金設定（時給/月給・割増率・手当/控除） |
| payslips | 給与明細（月次・snapshot・immutable） |
| translation_cache | 翻訳キャッシュ（API結果再利用） |
| company_dictionaries | 会社辞書（翻訳・最優先） |
| industry_dictionaries | 業界辞書（翻訳・会社横断） |

### マイグレーション履歴

```
001 - 初期スキーマ（profiles, companies, workers, documents）
002 - worker_id 紐付け + RLS + helper関数 (my_role, my_company_id, my_worker_id)
003 - shifts + shift_requests
004 - messages + daily_reports
005 - groups + group_members + group_messages
006 - storage bucket (documents)
007 - Realtime publication 設定（REPLICA IDENTITY FULL）
008 - push_subscriptions（Web Push サブスクリプション保存）
009 - message attachments（messages/group_messages に添付カラム）
010 - payroll（wage_settings + payslips + attendance lock + immutable トリガ）
011 - translation（translation_cache + company/industry_dictionaries）
012 - daily_reports拡張（site_name/work_content/attachments + report_comments + report_status_history）
013 - company_info（companies に representative/representative_title/registration_no/fax/postal_code 追加）
```

001〜012 は **実行済み** ✅／**013 は要実行**（会社情報の拡張カラム。未実行でも基本情報は保存可・拡張項目だけ無効）

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

# Web Push（VAPID）— 新規追加。本番Vercelにも要設定
VAPID_PUBLIC_KEY=BGULrS63UsXoHfRgB-s0Jd73ENg1Lft4dlwTMf0K9n0q2Geeu0I4pfFw5j5UBMXltdW6KKdDnulo-OoAI3Wb3G4
VAPID_PRIVATE_KEY=（.env参照）
VAPID_SUBJECT=mailto:admin@greenbridge.example.com
```

**Vercel本番にも設定済み** ✅（※ VAPID_* は次セッションで Vercel に追加要）

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
- **完全ステートレス**（express-session/connect-flash 廃止済み）
  - 認証は Cookie のみ（sb-access-token / gb-worker-token）
  - flash は Cookie ベースの自作ミドルウェア（app.js 内、`gb-flash` Cookie）
  - MemoryStore 警告なし → Vercel 複数インスタンスで安定

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
- ~~`aiTx()` 翻訳機能は原文返却のみ~~ → ✅ translationService(MyMemory)で本実装済み（011）
- 動画マニュアル: UI のみで実体なし
- タスク管理: 実習生管理と相性悪い

### 🔤 翻訳サービス（011で追加）
- `src/lib/translation/index.js` = translationService（共通IF）
- 優先順位: 会社辞書 → 業界辞書 → translation_cache → MyMemory API
- プロバイダ差し替え: `TRANSLATION_PROVIDER` env（mymemory既定、google/deepl/anthropic/openai拡張可）
- `src/lib/translation/providers/<name>.js` を追加し index.js の PROVIDERS に登録するだけ
- 定型UI文言はローカル辞書(LS/applyL)のまま。APIは動的テキスト(チャット/申請/日報)のみ
- フロント `aiTx(text, target, source?)`（ワーカー）/ `adminTx(text, target, source)`（管理者）が `/api/translate` を呼ぶ。失敗時は原文返却
- **双方向対応**: 管理者送信は日本語→ワーカー言語に翻訳して translated 保存。ワーカー発の原文は管理者画面の「🌐 日本語に翻訳」ボタンで翻訳（translateIncoming）

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

### 2026-05-28 セッション（PWA〜ホーム刷新〜安定化）
21. PWA化 + Web Push 通知（008マイグレーション、VAPID、SW）
22. 認証失敗時 302→401 JSON 化（Unexpected token 解消）
23. チャット TDZ バグ修正・複数admin対応・自動連絡先・申請のチャット連携
24. チャット画像送信（009マイグレーション、Supabase Storage）
25. クイック返信テンプレ（管理者）+ チャット履歴CSV出力
26. Realtime失敗時の並行ポーリング（双方向メッセージ確実化）
27. Supabase クエリビルダ `.catch is not a function` 全箇所修正
28. 管理者ホーム監視UI化（Action Bar / Today Strip / Activity Feed）
29. ホームv3（在留期限pill / 今日の申請・異常 / Slack風Timeline）
30. **セッション完全廃止 → Cookieベースflash（ステートレス化）**
31. **無効UUIDの 400 正規化（500/ログ汚染防止）**

### 2026-05-29 セッション（給与計算）
32. **給与計算 MVP（010マイグレーション）**
    - 計算エンジン `src/lib/payroll.js`（JST固定・丸めルール・残業/深夜/休日の動的割増）
    - 賃金設定（時給/月給・割増率・休憩・手当/控除JSONB）
    - 月次プレビュー → 確定 → 公開 のフロー分離
    - payslips に wage_snapshot + breakdown JSON 保存
    - confirmed/published は immutable（DBトリガで改ざん・削除をブロック）
    - 確定時に attendance_records をロック（locked カラム）
    - 管理者UI（給与タブ・計算表・賃金設定モーダル・明細HTML印刷）
    - ワーカーUI（給与明細カード閲覧、published のみ）
    - 本番 E2E 検証済み（snapshot/immutable/lock すべて実証）
33. 賃金設定UIの時給/月給切替（ラベル・所定時間欄・説明を動的化）
34. **AI翻訳の本実装（011マイグレーション）**
    - translationService（共通IF translate(text,source,target)）
    - 優先順位: 会社辞書→業界辞書→translation_cache→MyMemory API
    - プロバイダ差し替え構造（google/deepl/anthropic/openai 拡張可）
    - /api/translate（admin/worker両対応）、aiTx をサーバー翻訳に接続
    - MyMemory実呼び出し検証済み（ja⇔vi/en）。失敗時は原文フォールバック
35. **管理者側フル双方向翻訳**
    - 管理者→ワーカー: sendMsg で日本語をワーカー言語に翻訳し translated 保存（adminTx）
    - ワーカー→管理者: 受信メッセージに「🌐 日本語に翻訳」ボタン（translateIncoming）
    - 翻訳UIが ワーカー側aiTx + 管理者側adminTx の両系統で揃った
36. **日報・報告画面 監視UI化（012）**
    - daily_reports拡張 + report_comments + report_status_history（012実行済み✅）
    - status: pending/reviewed/returned の3値、確定時に履歴自動記録
    - 管理者UI: 統計バー / 9種フィルター / リアルタイム検索 / 詳細パネル / 画像モーダル / コメント / 承認履歴 / 未確認優先の自動選択
    - 全API 012未適用でもフォールバック動作（カラム/テーブル欠如を吸収）
37. **過去日報の閲覧**
    - サーバー: from/to/limit パラメータ（worker:200/最大500、admin:300/最大1000）+ report_date DESC優先ソート
    - ワーカー: 期間チップ（今日/今週/今月/すべて）+ 月選択input
    - 管理者: 「今月」フィルタ + 任意月ピッカー（input type=month）+ クリア

### 2026-06-01 セッション（011/012適用 + 勤怠・シフトのバグ修正）
38. **マイグレーション 011・012 を本番適用**（Supabase SQL Editor）— 翻訳辞書/cache・日報コメント/承認履歴/添付が有効化
39. **勤怠時刻のJST表示ズレ修正**：`mapAttendance`(spa.js) が UTC文字列を `slice(11,16)` で切り出し9hズレ（09:24→00:24）していたのを `fmtJstHM()`（timeZone:Asia/Tokyo）に修正。勤務時間も実時刻差で算出。編集モーダル(app.js)も clockInStr/JST変換優先に統一
40. **ワーカーシフトの日付キー正規化**：`workerShifts[String(s.date).slice(0,10)]` にして週またぎ・月またぎでのキー不一致（未マッチ）を解消
41. **シフト表示方針の明確化**：ワーカーは管理者が確定（DB保存）したシフトのみ表示、未設定日は「未定」。管理者画面の平日=日勤/土日=休みはあくまで画面上の既定でDB未保存
42. **会社辞書の管理UI（Phase2最優先）**：管理者が `/app` の「翻訳辞書」タブで会社辞書を CRUD できる画面を追加
    - サーバー: `GET/POST/PUT/DELETE /app/api/dictionaries`（spa.js末尾）。POSTはupsert（onConflict: company_id,source_lang,target_lang,source_text）。業界辞書は参照のみ同梱。011未適用時は503 `migration_011_required`
    - フロント: 新規ページ `dict`（spa.ejs page-dict + サイドバー nav-dict）/ app.js に initDictPage・loadDictionaries・renderDictCompany/Industry・save/edit/delete
    - 対応言語 ja/vi/id/tl/zh/my/en。translationService の優先順位（会社辞書→業界辞書→cache→API）にそのまま乗る
    - ローカル検証済: CRUD・upsert・バリデーション・翻訳APIで via:"company_dict" を確認
    - マイグレーション不要（011のテーブルを使用）
43. **通知翻訳（Phase2）**：ワーカーのお知らせを母国語で表示
    - サーバー: `GET /worker/api/notifications` が translationService で title/body を翻訳し `title_tl`/`body_tl` を付与。言語は `?lang=`（アプリ上の切替言語）最優先→workers.language。ja は翻訳せず原文。会社辞書→業界辞書→cache→API の優先順位に乗る
    - フロント(worker.ejs): ホームの「お知らせ」をハードコードのダミーから実通知の動的描画へ刷新。loadNotifications/markNotifRead 追加。ホーム表示時・言語切替時(applyL)・起動時にロード。未読バッジ・既読化対応
    - ローカル検証済: vi/en で通知が翻訳され、`?lang=` 切替で再翻訳されることを確認。絵文字保持
    - マイグレーション不要
44. **書類自動生成の拡張（Phase3）**：既存の DOC_TEMPLATES/generatePDF 土台に正式書類を追加
    - 新規4書類: 労働条件通知書(労基法15条準拠)・雇用契約書(労使双方署名)・誓約書・個人情報同意書。既存3(雇用条件通知書/在留カード届出書/出勤簿)と合わせ計7テンプレート
    - 「📦 入社書類一式」一括生成: laborConditions/employmentContract/pledge/privacyConsent を改ページ区切りで1PDFに（ワーカー詳細→書類タブのヘッダーボタン）
    - 会社情報を書類に反映: spa.js ルートで companies を `select('*')`、`companyInfo` を render→ spa.ejs `GB_COMPANY_INFO`。app.js のヘルパ `_ci/_coName/_companyBlock/_signBlock` が住所・電話・代表者・署名欄を出力（未設定カラムは空欄で安全）
    - generatePDF の CSS に `.doc-page{page-break-after}` 追加（一括生成の改ページ）
    - ローカル検証済: 全7テンプレートがエラーなく生成、GB_COMPANY_INFO がサーバーから供給されることを確認
    - マイグレーション不要。※生年月日等は現 mapWorker が返さないため書類に未使用（既存データ範囲で完結）
45. **会社情報の設定UI（Phase3補完）**：書類の事業主欄を会社が自分で設定
    - マイグレーション **013**（companies に representative/representative_title/registration_no/fax/postal_code 追加・全NULL許容）。※要実行だが未実行でも基本情報は保存可
    - サーバー: `GET/PUT /app/api/company`（admin自社のみ）。PUTは拡張カラム込み→失敗時(013未適用)は基本カラムのみで再試行し `warn:migration_013_required` を返すフォールバック。null/空は null 保存（"null"文字列化バグ修正済）
    - フロント: 設定タブに「会社情報」パネル追加（admin限定）。loadCompanyInfo/saveCompanyInfo。保存後 window.GB_COMPANY_INFO を更新し書類へ即反映。`_ci()` が window優先で参照
    - 書類ヘルパ強化: `_repName()`（役職+氏名）、`_companyBlock` が郵便番号+住所・代表者役職を出力
    - ローカル検証済: GET/PUT・013フォールバック警告・バリデーション・認証401・null保存を確認

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

**最終更新: 2026-06-01**
**最終コミット: 9f92f6e (feat: 過去日報の閲覧 — 期間フィルタ + 月選択)**

> ✅ **マイグレーション 011・012 は 2026-06-01 に Supabase SQL Editor で適用完了。**
> 翻訳の辞書・キャッシュ、日報のコメント・承認履歴・現場名・添付画像がすべて有効になった。
> 未実行マイグレーションは無し（001〜012 全適用済み）。

---

## 📌 次にやるべきタスク（優先度順）

### ✅ 完了済み
- ~~#1 セッションストア本番対応~~ → ステートレス化（f979832）
- ~~#2 無効UUID 400正規化~~ → 完了（f979832）
- ~~給与計算連携 MVP~~ → 完了（4c84349 / 010実行済み）
- ~~AI翻訳の本実装~~ → translationService/MyMemory 完了（17b9445 / **011は要実行**）

### 🟡 業務価値が高い（Phase 2: 業務適合）
1. **会社辞書の管理UI**（翻訳の精度向上）
   - company_dictionaries を管理者が編集できる画面（現状はDB直接のみ）
   - 規模: 小〜中
2. **ビザ・在留管理の強化**
   - 在留期限カレンダーUI、書類期限の自動通知バッチ、健康診断スケジュール
   - 規模: 中（2〜3日）
3. **給与計算の拡張**（MVP完了済み → 余力あれば）
   - 給与明細の正式PDF生成（現状はHTML印刷）
   - 社保・所得税の自動計算、月60h超残業の50%割増
   - 休日カレンダー（現状は日曜のみ休日判定）
4. **翻訳の拡張**（余力あれば）
   - DeepL/Google/Anthropic プロバイダ追加（providers/ に足すだけ）
   - ~~管理者チャットでもワーカー言語へ翻訳送信~~ → ✅ 完了（38717ab・双方向化）
   - 日報・申請レビュー画面でも管理者翻訳ボタン（チャットは対応済み）

### 🟢 整理・改善（Phase 1の残り）
4. 不要機能の削除/再設計（タスク管理Kanban・動画マニュアル）— 小
5. 言語切替の対応漏れ修正（applyL未対応の動的テキスト/モーダル）— 小〜中

### 🔵 効率化・拡張（Phase 3）
6. ワーカーCSV一括登録（インポート）
7. シフト自動生成（過去パターン提案）
8. 勤怠分析ダッシュボード（グラフ・遅刻傾向）
9. アクセスログ（セキュリティ）

### 💡 GreenBridge特有の付加価値（Phase 4・任意）
- 既読時刻表示「14:23 既読」/ メッセージ検索 / 法定有給5日管理
- 誕生日リマインダー / 体調記録（毎朝の体温）/ 病院・通訳マッチング

### 🔧 技術的な改善メモ（任意）
- pollAdminMessages / pollMessages は 5秒間隔。Realtime安定後は間引き検討
- 旧MPAルート（/companies /documents /workers）は SPA移行で実質未使用 → 整理候補

### 📱 動作確認の宿題（実機）
- 設定→プッシュ通知→有効化 でブラウザ許可 → テスト送信で受信確認

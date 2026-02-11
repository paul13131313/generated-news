# 生成新聞（Generated News）

## プロジェクト概要

**紙の新聞とデジタルを融合させた、AI生成パーソナライズニュースサービス**

ユーザーの関心領域に合わせて、AIが自動でニュースを収集・要約・再構成し、
クラシックな新聞紙面レイアウトで毎朝・毎夕届ける。

### コンセプト
- **クラシックな文字組** × **最先端のアニメーション・生成AI**
- 紙の新聞の「紙面を組む」体験をデジタルで再現
- 「選ばれるニュース」ではなく「生まれるニュース」
- 関心の外にあるニュースとの「偶然の出会い」も設計に組み込む

### デザインの方向性
- 新聞的な縦書き風レイアウト、段組、見出し階層
- 令和七年〜の和暦表記、号数表記
- マーケットティッカー（リアルタイム風）
- 天声生成（AIコラム）
- 朝刊 06:00 ／ 夕刊 17:00 の2回配信
- ローディング演出：「関心領域を分析中…」→「記事を構成中…」→「朝刊を配達中…」

---

## ビジネスモデル

### 料金
- **月額300円（税込）** のサブスクリプション
- 広告的プロダクトとして運営（利益は後回し）

### コスト構造
- API呼び出し1回あたり約5円
- 朝刊＋夕刊 = 1日2回 × 30日 = 60回/月
- 月間コスト: 約300円/ユーザー
- → 300円/月のサブスクでトントン（広告価値で回収する想定）

---

## 技術仕様

### フロントエンド
- GitHub Pages でホスティング（現状）
- HTML/CSS/JS（バニラ or 軽量フレームワーク）
- アニメーション：Canvas / CSS Animation / WebGL

### バックエンド（要構築）
- ニュースソース: News API / Google News RSS / 各社RSS
- AI要約・再構成: Claude API (Haiku推奨 = コスト抑制)
- スケジューラ: Cloudflare Workers / Vercel Cron / GitHub Actions
- データ保存: Supabase / Cloudflare KV
- 認証: Supabase Auth
- 決済: Stripe（300円/月サブスク）

### 配信フロー
1. 朝5:30 / 夕16:30 にCronジョブ起動
2. ニュースソースからRSS/API取得
3. ユーザーの関心プロファイルに基づきフィルタリング
4. Claude API で記事要約＋紙面構成（見出し・本文・コラム）
5. 静的HTML生成 or JSON API として配信
6. フロントエンドで紙面レンダリング
7. プッシュ通知（PWA / Web Push）

---

## 現在のステータス

### 完了
- [x] モックアップサイト（デザイン・インタラクション確定）
  - URL: https://paul13131313.github.io/generated-news/
  - カテゴリ：総合、テクノロジー、国際、経済、文化
  - ティッカー、天声生成コラム、注目記事セクション
  - ローディングアニメーション
  - 朝刊/夕刊切り替え
- [x] LP（ランディングページ）制作・公開
  - URL: https://paul13131313.github.io/generated-news/lp.html
- [x] **Phase 2 Step 1: ニュースソース収集パイプライン**
  - Cloudflare Worker `news-collector` をデプロイ
  - URL: https://news-collector.hiroshinagano0113.workers.dev
  - 11本のRSSフィードから7カテゴリのニュースを収集
  - ソース: NHK（総合/社会/政治/経済/国際/科学/スポーツ）、Yahoo!ニュース、ITmedia、はてなブックマーク、Zenn
  - エンドポイント:
    - `GET /api/news` — 全ニュース一覧（最新順、デフォルト50件）
    - `GET /api/news?category={category}` — カテゴリ別
    - `GET /api/news?limit={n}` — 件数制限（最大200）
    - `GET /api/sources` — ソース一覧
    - `GET /api/categories` — カテゴリ一覧
    - `GET /health` — ヘルスチェック
  - コード: `workers/news-collector/`

### 進行中
- [ ] Phase 2 Step 2: AI要約・紙面構成パイプライン ← 次のステップ

### TODO
- [ ] AI要約・紙面構成（Claude API連携）
- [ ] ユーザー認証（サインアップ/ログイン）
- [ ] 関心プロファイル設定UI
- [ ] Stripe決済連携（300円/月）
- [ ] PWA化・プッシュ通知
- [ ] 本番運用開始

---

## 開発方針

### チャット消失対策
- **このPROJECT.mdをリポジトリに常に最新化する**
- 実装はClaude Codeと併用し、コードは常にローカル＋GitHubに残す
- 新しいチャットでは「PROJECT.md読んで続きやって」で復帰可能

### リポジトリ
- GitHub: paul13131313/generated-news
- ホスティング: GitHub Pages

---

## 更新履歴
- 2026-02-11: Phase 2 Step 1 完了 — news-collector Worker デプロイ（11 RSS、7カテゴリ）
- 2026-02-11: LP制作完了・公開
- 2026-02-11: PROJECT.md作成、LP制作再開

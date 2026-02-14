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
- **初月無料（30日間トライアル）** → 翌月から **月額300円（税込）** のサブスクリプション
- 無料トライアル期間中に解約すれば料金は発生しない
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
  - ティッカー、天声生成コラム、本日の見出しセクション
  - ローディングアニメーション
  - 朝刊/夕刊切り替え
- [x] LP（ランディングページ）制作・公開
  - URL: https://paul13131313.github.io/generated-news/lp.html
- [x] **Phase 2 Step 1: ニュースソース収集パイプライン**
  - Cloudflare Worker `news-collector` をデプロイ
  - URL: https://news-collector.hiroshinagano0113.workers.dev
  - 15本のRSSフィードから10カテゴリのニュースを収集
  - ソース: NHK（総合/社会/政治/経済/国際/科学/スポーツ/エンタメ/文化/生活）、Yahoo!ニュース、ITmedia、はてなブックマーク、Zenn、ナタリー
  - カテゴリ: 総合, テクノロジー, 国際, 経済, 社会, 政治, スポーツ, エンタメ, 文化, 暮らし
  - エンドポイント:
    - `GET /api/news` — 全ニュース一覧（最新順、デフォルト50件）
    - `GET /api/news?category={category}` — カテゴリ別
    - `GET /api/news?limit={n}` — 件数制限（最大200）
    - `GET /api/sources` — ソース一覧
    - `GET /api/categories` — カテゴリ一覧
    - `GET /health` — ヘルスチェック
  - コード: `workers/news-collector/`

- [x] **Phase 2 Step 2: AI紙面生成パイプライン**
  - Cloudflare Worker `news-generator` をデプロイ
  - URL: https://news-generator.hiroshinagano0113.workers.dev
  - RSSフィードから直接ニュース取得 → Claude Haiku 4.5で紙面JSON生成
  - 生成内容: 一面記事、カテゴリ別記事5本、天声生成コラム、ティッカー6銘柄、注目記事5本
  - 出力JSON構造: date, edition, issueNumber, headline, articles, column, ticker, highlights
  - 記事バランス: 硬いニュース（政治/経済/国際/総合）3件 + 柔らかいニュース（文化/エンタメ/暮らし/スポーツ/テクノロジー）2件
  - 文体: 格式ある新聞調、漢語・熟語多用、漢数字表記
  - コスト: 1回あたり約1.8円（目標5円以内をクリア）
  - エンドポイント:
    - `GET /api/generate` — 紙面JSON生成（時間帯で朝刊/夕刊自動判定）
    - `GET /api/generate?edition=morning` — 朝刊指定
    - `GET /api/generate?edition=evening` — 夕刊指定
    - `GET /health` — ヘルスチェック
  - コード: `workers/news-generator/`

- [x] **Phase 2 Step 3: フロントエンド連携**
  - index.htmlをnews-generator APIと連携、動的レンダリングに変更
  - ページ読み込み時にAPIからリアルニュースを取得し紙面を生成
  - ローディングアニメーションとAPI取得を同期（両方完了後に紙面表示）
  - APIエラー時はフォールバックデータで表示
  - 朝刊/夕刊切り替えでAPI再取得に対応
  - 動的レンダリング対象: 日付、号数、ティッカー、一面記事、カテゴリ記事5本、天声生成コラム、注目記事5本

- [x] **ニュース写真（Unsplash API）**
  - headline + articles にUnsplash写真を並列取得（Promise.all）
  - headline: 一面記事に必ず写真付与
  - articles: 5件中2〜3件にimageKeyword付与、残りはnull（視覚的にイメージしやすい記事を優先）
  - 写真付き記事: 全幅1カラム表示（写真を大きく見せる）
  - 写真なし記事同士: 2カラム並び表示
  - 写真なし時: 写真エリア自体を非表示
  - Unsplash利用規約準拠クレジット表示
  - 環境変数: `UNSPLASH_ACCESS_KEY`（Cloudflare Workers Secrets）

- [x] **Phase 2 Step 4: Cronスケジューラ＆KVキャッシュ**
  - Cloudflare KV namespace `NEWSPAPER_CACHE` を作成・バインド
  - キャッシュキー形式: `{edition}-{YYYY-MM-DD}`（例: `morning-2026-02-12`）
  - キャッシュTTL: 12時間
  - API取得フロー: KVキャッシュ確認 → ヒット時はキャッシュ返却 → ミス時は生成してKV保存
  - `force=true` パラメータでキャッシュ無視して再生成
  - Cron Triggers:
    - `0 21 * * *`（UTC 21:00 = JST 06:00）→ 朝刊自動生成・キャッシュ
    - `0 8 * * *`（UTC 08:00 = JST 17:00）→ 夕刊自動生成・キャッシュ
  - フロントエンド: JST時間からeditionを自動判定（6:00〜16:59→朝刊、17:00〜5:59→夕刊）
  - エンドポイント追加: `GET /api/generate?force=true` — キャッシュ無視して再生成
  - コード: `workers/news-generator/`

- [x] **Phase 2 Step 5: ウェイトリスト登録フォーム**
  - Cloudflare Worker `waitlist-api` をデプロイ
  - URL: https://waitlist-api.hiroshinagano0113.workers.dev
  - Cloudflare KV namespace `WAITLIST` を作成・バインド
  - エンドポイント:
    - `POST /api/waitlist` — メールアドレス登録（バリデーション＋重複チェック）
    - `GET /api/waitlist/count` — 登録者数取得
    - `GET /health` — ヘルスチェック
  - KV保存形式: キー=メールアドレス、値={ email, registeredAt, source: "lp" }
  - lp.htmlのフォームをAPI連携に変更:
    - 成功時: 「ご登録ありがとうございます。正式リリース時にご案内いたします。」
    - 重複時: 「すでにご登録いただいています。」
    - エラー時: 「登録に失敗しました。時間をおいてお試しください。」
    - 送信中はボタン「登録中...」で連打防止
  - CORS: GitHub Pagesドメイン許可
  - コード: `workers/waitlist-api/`

- [x] **Phase 3 Step 1: Stripe決済（Checkout Session）**
  - Cloudflare Worker `payment-api` をデプロイ
  - URL: https://payment-api.hiroshinagano0113.workers.dev
  - Stripe Checkout Session方式（サーバーサイドでSession作成 → クライアントをCheckoutページにリダイレクト）
  - 商品: 生成新聞 初月無料+月額300円（JPY）サブスクリプション（price_data + trial_period_days: 30）
  - エンドポイント:
    - `POST /api/checkout` — Stripe Checkout Session作成、{ url } を返す
    - `GET /health` — ヘルスチェック
  - success_url: index.html?subscribed=true
  - cancel_url: lp.html
  - CORS: GitHub Pagesドメイン許可
  - 環境変数: `STRIPE_SECRET_KEY`（Cloudflare Workers Secrets、Test Mode）
  - lp.htmlの料金セクションに「初月無料で始める」ボタン追加
  - コード: `workers/payment-api/`

- [x] **Phase 3 Step 2: Stripe Webhook＆購読者管理**
  - payment-api に Webhook エンドポイント追加
  - Cloudflare KV namespace `SUBSCRIBERS`（id: e41c7b32f3714d668e2bea60c56be914）
  - Stripe Webhook署名検証（Web Crypto API、HMAC-SHA256）
  - 対応イベント:
    - `checkout.session.completed` → 購読者KV保存（email, customerId, subscriptionId, status）
    - `customer.subscription.updated` → ステータス更新（active, past_due, canceled等）
    - `customer.subscription.deleted` → ステータスをcanceledに変更
  - エンドポイント:
    - `POST /api/webhook` — Stripe Webhook受信（署名検証付き）
    - `GET /api/subscriber/:email` — 購読ステータス確認
    - `POST /api/cancel` — サブスクリプション解約（cancel_at_period_end）
  - 環境変数: `STRIPE_WEBHOOK_SECRET`（Cloudflare Workers Secrets）
  - index.html: `?subscribed=true` パラメータで購読成功トースト表示（8秒自動消去）
  - index.html: ユーザーバーに「購読管理」リンク追加、解約確認モーダル、解約後は期間終了まで閲覧可能
  - コード: `workers/payment-api/`

- [x] **Phase 3 Step 3: ユーザー認証**
  - Cloudflare Worker `auth-api` をデプロイ
  - URL: https://auth-api.hiroshinagano0113.workers.dev
  - Cloudflare KV namespace `USERS`（id: f3516f2af8334296a502b691ad355854）
  - Cloudflare KV namespace `SESSIONS`（id: 2c3df91f79f140dc83ea68b4679d7605）
  - パスワードハッシュ: PBKDF2 + Web Crypto API（100,000 iterations, SHA-256）
  - セッション: Bearer Token方式、30日TTL
  - エンドポイント:
    - `POST /api/signup` — メール+パスワードで新規登録（バリデーション付き）
    - `POST /api/login` — ログイン（セッショントークン発行）
    - `POST /api/logout` — ログアウト（セッション削除）
    - `GET /api/me` — セッションからユーザー情報取得
    - `GET /health` — ヘルスチェック
  - lp.html: ヘッダーにログイン/新規登録ボタン、モーダルUI（サインアップ/ログイン切替）
  - index.html: mastheadの上にユーザーバー（メール表示、ログアウト）
  - ログイン状態はlocalStorage（auth_token, auth_email）で管理
  - ページ読み込み時にGET /api/meでセッション有効性を検証
  - コード: `workers/auth-api/`

- [x] **Phase 3 Step 4: 関心プロファイル設定**
  - auth-api に `GET /api/profile`、`PUT /api/profile` エンドポイント追加
  - プロファイル: categories（カテゴリ配列）、keywords（キーワード配列、最大10個）
  - カテゴリバリデーション（10カテゴリのみ許可）
  - GET /api/me にもプロファイル情報を含める
  - index.html: ユーザーバーに「関心設定」リンク追加
  - プロファイルモーダル: カテゴリ選択（トグルボタン）+ キーワード入力（Enter追加、×削除）
  - プロファイルはUSERS KV内のユーザーデータに保存

- [x] **PWA強化**
  - manifest.json: id, scope, categories, shortcuts（朝刊/夕刊）, maskableアイコン追加
  - offline.html: 新聞風デザインのオフラインフォールバックページ
  - sw.js v4: offline.htmlプリキャッシュ、navigate失敗時オフラインフォールバック、静的アセットのキャッシュ更新
  - ~~A2HSバナー: beforeinstallprompt対応~~ → 削除済み（不要と判断）
  - SW登録コード簡素化（v3の全unregisterロジック削除）

- [x] **Web Push通知**
  - push-api Worker新規作成（`workers/push-api/`）
  - VAPID鍵生成（ES256）、Cloudflare Secretsに保存
  - Cloudflare KV namespace `PUSH_SUBSCRIPTIONS`（id: d11cfed6a61546dbaddb8c6fe777ca2a）
  - Web Crypto APIによるRFC 8291準拠のプッシュ暗号化（ECDH + AES-128-GCM）
  - エンドポイント: GET /api/vapid-public-key, POST /api/push/subscribe, DELETE /api/push/subscribe, POST /api/push/trigger
  - sw.js v5: pushイベント + notificationclickイベント追加
  - index.html: ユーザーバーに通知ON/OFF切替リンク
  - news-generator → push-api Service Binding連携（生成完了時に自動通知）

- [x] **本番運用準備**
  - Stripe本番鍵（sk_live_）設定、本番Webhook署名シークレット設定
  - Google Analytics GA4導入（G-N9N0681N4H）
  - .gitignore追加、SEOメタタグ（OGP, Twitter Card）追加

- [x] **利用規約・プライバシーポリシー**
  - terms.html: 利用規約（12条、サービス概要・料金・AI生成コンテンツ免責・禁止事項・準拠法等）
  - privacy.html: プライバシーポリシー（14条、収集情報・利用目的・第三者サービス連携・Cookie/localStorage・Web Push・GA4・セキュリティ等）
  - LP・利用規約・プライバシーポリシー間の相互フッターリンク
  - LP風デザイン（新聞紙面テクスチャ、明朝体見出し）

- [x] **UI整理: カテゴリタブ削除＆注目記事セクション控えめ化**
  - masthead内のカテゴリナビ（総合/テクノロジー/国際/経済/文化）を削除（HTML/CSS/JS全て除去）
  - 「注目の記事」セクションを「本日の見出し」に改名
  - ランキング番号（01, 02...）を非表示、フォントサイズ縮小、クリッカブルでないデザインに変更

- [x] **ヘッダーデザイン洗練＆ユーザーバー再配置**
  - masthead: ボーダー・罫線を削除、ロゴ上下に大きな余白（48px/40px）、号数バッジを控えめテキストに
  - 高級紙の題字のような余白とミニマルデザイン（NYT/FTの品格を参考）
  - ユーザーバー: ヘッダー上部→フッター内に移動（紙面ヘッダーをクリーンに）
  - 通知ON/OFF: テキストリンク→スライド式トグルスイッチに変更（ON:緑/OFF:グレー、実際のPush購読状態を反映）

- [x] **初月無料トライアル（30日間）**
  - payment-api: Stripe Checkout Sessionに `subscription_data.trial_period_days: 30` 追加
  - lp.html: ヒーローCTA「初月無料で始める」、料金セクション「初月無料、翌月から月額300円」表記、購読ボタン変更
  - index.html: 解約モーダルに「無料トライアル期間中に解約すれば料金は発生しません」追記
  - terms.html: 第4条（料金・決済）に無料トライアル・自動移行・トライアル中解約に関する条項追加

- [x] **体験パス（Invite Pass）**
  - payment-api: `POST /api/invite` エンドポイント追加（招待コード検証 → SUBSCRIBERS KVに status: "invite", expiresAt: 7日後 で登録）
  - 招待コード管理: SUBSCRIBERS KVの `INVITE_CODES` キーにJSON配列で保存（初期値: `["PAUL"]`、複数回使用可）
  - `GET /api/subscriber/:email` 修正: invite ユーザーの期限チェック、期限切れ時は `status: "invite_expired"` を返す
  - index.html: フッターに「招待コードをお持ちの方」リンク、招待モーダルUI（メール+コード入力）
  - ユーザーバー3状態対応: 認証ユーザー / 招待ユーザー（体験パス期限+正式購読リンク）/ 未認証
  - ページ読込時にsubscriber APIで招待期限を検証、期限切れ時はトーストで通知
  - Stripe不要 — 招待コードだけで7日間新聞を閲覧可能
  - **招待URLパラメータ**: `?invite=XXXX` でページを開くと招待モーダルが自動表示、コード入力欄にXXXXをプリセット。ログイン済み/招待済みユーザーには非表示。URLパラメータは即座にクリーン。独立IIFEで実装（ローディング完了をポーリング検知→モーダル表示、revealContent依存を排除）
  - 共有URL例: `https://paul13131313.github.io/generated-news/?invite=PAUL`

- [x] **「数字で読む」セクション**
  - news-generator prompt.js: `highlights` → `numbers` フィールドに変更
  - 出力形式: `{ number: "13万人", label: "米1月雇用者増加数" }` × 5件
  - index.html: 「本日の見出し」→「数字で読む」に改名、数字を明朝体太字大きめ+ラベルをゴシック体小さめの横並びレイアウト
  - renderHighlights → renderNumbers に関数名変更、フォールバックデータ更新
  - **旧フォーマット互換**: renderNumbers()にフォールバック追加 — `data.numbers`（新）優先、なければ`data.highlights`（旧: title/summary→number/labelマッピング）、どちらもなければセクション非表示

### TODO
- [ ] カスタムドメイン設定（任意）

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
- 2026-02-14: 一面リード文バグ修正 — switchEdition()でtypeSub()が呼ばれず前号のリード文が残る問題を修正。renderNewspaper()でtopHeadline/topSubをリセットするよう追加
- 2026-02-12: 招待URLパラメータ修正 — revealContent内の処理を独立IIFEに分離、ローディング完了をポーリング検知してモーダル表示、URLパラメータ即座クリーン
- 2026-02-12: 招待URLパラメータ — ?invite=XXXXで招待モーダル自動表示＋コードプリセット、ログイン済み/招待済みユーザーはスキップ
- 2026-02-12: 「数字で読む」旧データ互換 — renderNumbers()にhighlights(旧)→numbers(新)フォールバック追加、KV旧データでもundefinedにならず正常表示
- 2026-02-12: 「数字で読む」セクション — highlights→numbers変更、記事から象徴的数字を抽出表示、明朝体太字+ゴシック体ラベルの横並びレイアウト
- 2026-02-12: 体験パス（Invite Pass）— POST /api/invite追加、招待コード"PAUL"で7日間無料体験、index.html招待モーダルUI・ユーザーバー3状態対応
- 2026-02-12: mastheadデザイン微調整 — 日付行下に細い罫線追加、号数バッジに枠線追加、ロゴ余白を適正化（48px→28px）
- 2026-02-12: 初月無料トライアル導入 — payment-apiにtrial_period_days:30追加、LP・index.html・terms.htmlのコピー更新
- 2026-02-12: ヘッダーデザイン洗練 — masthead罫線削除・ロゴ余白拡大、ユーザーバーをフッターに移動、通知トグルスイッチUI導入
- 2026-02-12: UI整理 — カテゴリタブ（総合/テクノロジー/国際/経済/文化）削除、「注目の記事」→「本日の見出し」に改名・控えめデザインに変更
- 2026-02-12: 解約フロー実装 — payment-apiに/cancelエンドポイント追加（cancel_at_period_end）、index.htmlに解約確認モーダル・購読管理リンク追加
- 2026-02-12: index.html整理 — A2HSバナー削除、統計セクション（生成記事数/読者数/生成回数カウンター）削除
- 2026-02-12: LP改修 — ヒーローCTAをStripe購読ボタンに変更、事前登録セクション削除、ヒーロー〜プレビュー間余白調整
- 2026-02-12: 利用規約・プライバシーポリシー — terms.html（12条）、privacy.html（14条）作成、LPフッターリンク追加
- 2026-02-12: 本番運用準備 — Stripe本番鍵、GA4、.gitignore、SEOメタタグ
- 2026-02-12: Web Push通知 — push-api Worker、VAPID認証、SW v5、通知ON/OFF UI、news-generator連携
- 2026-02-12: PWA強化 — manifest改善（shortcuts, maskable）、オフラインフォールバックページ、SW v4、A2HSバナー
- 2026-02-12: Phase 3 Step 4 完了 — 関心プロファイル設定（カテゴリ選択、キーワード登録、プロファイルモーダルUI）
- 2026-02-12: Phase 3 Step 3 完了 — ユーザー認証実装（auth-api Worker、PBKDF2パスワードハッシュ、セッション管理、LP＋紙面のログインUI）
- 2026-02-12: Phase 3 Step 2 完了 — Stripe Webhook実装（署名検証、購読者KV保存、ステータス確認API、購読成功トースト）
- 2026-02-12: Phase 3 Step 1 完了 — Stripe Checkout Session実装（payment-api Worker、月額300円サブスク、lp.htmlに購読ボタン追加）
- 2026-02-12: RSSソース拡充 — 15フィード10カテゴリに拡大（エンタメ/文化/暮らし追加）、記事バランスを硬3+柔2に
- 2026-02-12: 記事写真・レイアウト改善 — articles 5件中2-3件にUnsplash写真追加、写真付き記事は全幅1カラム表示、SWキャッシュ問題修正(v3)
- 2026-02-12: Phase 2 Step 5 完了 — ウェイトリスト登録フォーム実装（waitlist-api Worker + KV、lp.html API連携）
- 2026-02-12: Phase 2 Step 4 完了 — KVキャッシュ＆Cron Triggers実装（朝刊06:00/夕刊17:00自動生成、12時間TTL、force再生成対応）
- 2026-02-12: 関連ニュースフロー — LIVE GENERATIVEをニュース写真+関連ニュースオーバーレイに変更、Canvas廃止、relatedNews 4件ローテーション表示
- 2026-02-12: ニュース写真連携 — Unsplash APIで一面記事写真を取得、クレジット表示対応
- 2026-02-12: バグ修正 — 変数now重複宣言SyntaxError修正、fetchタイムアウト追加、セーフティタイムアウト追加、CORS制限
- 2026-02-11: UI改善 — ヒーローキャンバスをキーワード連動ジェネラティブアートに変更、号数自動採番、一面記事本文200-300字に増量、ステータスバーをフッター付近に移動
- 2026-02-11: Phase 2 Step 3 完了 — フロントエンド連携（リアルニュースで紙面動的生成）
- 2026-02-11: Phase 2 Step 2 完了 — news-generator Worker デプロイ（Claude Haiku 4.5で紙面生成、約1.8円/回）
- 2026-02-11: Phase 2 Step 1 完了 — news-collector Worker デプロイ（11 RSS、7カテゴリ）
- 2026-02-11: LP制作完了・公開
- 2026-02-11: PROJECT.md作成、LP制作再開

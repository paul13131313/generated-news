# CHANGELOG.md — 変更履歴

## 2026-03-01

### Phase 3 実装: 位置情報パーソナライズ
- **Geolocation API** — 認証成功時にブラウザの位置情報を自動取得、localStorageとサーバーに保存
- **郵便番号フォールバック** — 位置情報拒否時に郵便番号入力モーダルを表示、zipcloud API→Nominatim正引きで座標変換
- **天気コーナー位置連動** — fetchWeatherData(lat, lon)で購読者の位置の天気を取得
- **ご近所ニュース位置連動** — 逆ジオコーディング結果に基づきGoogle News RSSの検索語を動的生成
- **プロンプト位置連動** — buildPrompt()にエリア名を動的注入、ローカルニュースの制約文も動的化
- **購読者locationスキーマ** — payment-apiにPOST /api/locationエンドポイント追加（lat, lng, area_name, prefecture, postal_code, source）
- **ユーザーバーに地域表示** — 「地域: XXX」リンクから郵便番号モーダルで変更可能
- **バックグラウンド更新** — アクセス時にhaversine距離1km以上の移動で自動更新
- **管理画面** — admin.html購読者一覧に「地域」カラム追加
- **OpenWeather APIキー設定** — wrangler secret put OPENWEATHER_API_KEY

### Phase 2 実装: 無料化と導線整理
- **課金フロー停止** — index.html: Stripe Checkout・解約モーダル・招待モーダルのHTML/CSS/JSをコメントアウト、購読管理リンク削除
- **LP無料化** — lp.html: ヒーローCTA「無料で購読する」に変更、料金セクション「FREE / ¥0」に書き換え、招待モーダル・Stripe JS削除
- **ユーザーバー簡素化** — 招待ユーザー状態・招待コードリンク・購読管理リンクを削除
- **リダイレクト条件簡素化** — 未認証リダイレクトから invite/subscribed/cancel の除外条件を削除
- **利用規約** — 第4条を「現在無料、将来有料化時は事前通知」に書き換え
- **プライバシーポリシー** — Stripe連携を「現在未使用」に更新

### Phase 1 実装
- **天声生成コーナーを廃止** — index.html（CSS/HTML/JS）、prompt.js から天声生成（AIコラム）セクションを完全削除
- **仕様書の一元化** — CLAUDE.md を全体指示書として書き直し、docs/ARCHITECTURE.md・ROADMAP.md・CHANGELOG.md を新規作成。旧仕様書（PROJECT.md, NEW_CORNERS_SPEC.md, ADMIN_SPEC.md, LP_SPEC.md）を docs/archive/ に移動
- **Apple Payメール上書きバグ修正** — payment-api の Webhook で registrationEmail を優先保存、Checkout endpoint で lp.html から auth email を受け取り metadata に保存
- **ダッシュボードにメール編集機能** — admin.html にインライン編集UI追加、admin.js に PATCH API 追加

### インフラ
- **カスタムドメイン設定** — seiseishinbun.com を Cloudflare Registrar で取得、GitHub Pages にCNAME設定、SSL証明書プロビジョニング
- **メール配信の独自ドメイン化** — Resend で seiseishinbun.com を検証、送信元を noreply@seiseishinbun.com に変更
- **全Worker URL移行** — 全7 Workers の ALLOWED_ORIGINS、SITE_URL、リダイレクトURLを seiseishinbun.com に更新
- **未認証ユーザーのLPリダイレクト** — index.html のセッション検証でlp.htmlにリダイレクト（?sample, ?invite, ?subscribed, #cancel は除外）

### コンテンツ品質
- **催事・ご近所情報の重複排除** — KVキャッシュから前回URLを取得して同一記事をフィルタ、ニュースがない場合は「※本日のニュースはありませんでした」を表示

## 2026-02-17
- メール配信機能 — email-notifier Worker（Resend API連携）、news-generator Service Binding、メール通知トグルUI
- RSSフィード修正 — NHK 2桁cat・natalie.mu の壊れたフィードを Yahoo!/モデルプレス/J-CASTに置換

## 2026-02-16
- 最新号表示ロジック — detectEdition() + フォールバック表示
- 号数ロジック化 — 起算日 2026-01-01 から採番
- 朝刊/夕刊ニュース重複排除 — 前回タイトルをプロンプトに注入

## 2026-02-14
- 一面リード文バグ修正 — switchEdition()でtypeSub()未呼び出し問題を修正

## 2026-02-12
- 招待URLパラメータ — ?invite=XXXX で招待モーダル自動表示
- 「数字で読む」セクション — highlights → numbers 変更
- 体験パス（Invite Pass）— 招待コードで7日間無料体験
- 初月無料トライアル — trial_period_days: 30
- ヘッダーデザイン洗練 — ユーザーバーをフッターに移動
- UI整理 — カテゴリタブ削除、「注目の記事」→「本日の見出し」
- 利用規約・プライバシーポリシー作成
- Web Push通知 — push-api Worker + VAPID認証
- PWA強化 — manifest改善、オフラインフォールバック
- 関心プロファイル設定
- ユーザー認証（auth-api Worker）
- Stripe Webhook + 購読者管理
- Stripe Checkout Session
- ウェイトリスト登録フォーム
- KVキャッシュ & Cron Triggers
- Unsplash写真連携

## 2026-02-11
- news-generator Worker デプロイ
- news-collector Worker デプロイ
- LP制作・公開
- プロジェクト開始

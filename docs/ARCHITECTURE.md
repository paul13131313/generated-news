# ARCHITECTURE.md — 技術構成の全体像

## システム構成図

```
[ユーザー] ←→ [GitHub Pages (seiseishinbun.com)]
                    ↓ API呼び出し
            [Cloudflare Workers]
            ├── news-generator ← Cron Trigger (06:00/17:00 JST)
            │   ├── RSS取得 → Claude Haiku 4.5 → 紙面JSON
            │   ├── KV(NEWSPAPER_CACHE) 保存
            │   ├── → push-api (Service Binding)
            │   └── → email-notifier (Service Binding)
            ├── payment-api
            │   ├── Stripe Checkout/Webhook
            │   └── KV(SUBSCRIBERS) 管理
            ├── auth-api
            │   ├── PBKDF2パスワードハッシュ
            │   └── KV(USERS, SESSIONS) 管理
            ├── email-notifier
            │   └── Resend API → noreply@seiseishinbun.com
            ├── push-api
            │   ├── VAPID認証 + RFC 8291暗号化
            │   └── KV(PUSH_SUBSCRIPTIONS) 管理
            └── waitlist-api
                └── KV(WAITLIST) 管理
```

## Workers 詳細

### news-generator
- **Cron Triggers**: `0 21 * * *` (UTC=JST 06:00), `0 8 * * *` (UTC=JST 17:00)
- **AI**: Claude Haiku 4.5 (MAX_TOKENS: 6000)
- **RSSソース**: NHK, Yahoo!ニュース, ITmedia, はてブ, Zenn, J-CAST, モデルプレス, artscape, CINRA, cinemacafe
- **キャッシュ**: KV `{edition}-{YYYY-MM-DD}` (TTL 12時間)
- **重複排除**: 前回タイトル・前回URL をプロンプトに注入
- **管理API**: JWT認証、購読者CRUD、招待コード管理
- **エンドポイント**:
  - `GET /api/generate` — 紙面JSON取得（?edition=morning|evening, ?force=true）
  - `GET /api/admin/*` — 管理API群

### payment-api
- **Stripe**: Checkout Session + Webhook（署名検証: HMAC-SHA256）
- **購読**: 月額300円、初月無料30日トライアル（現在コメントアウト中）
- **招待コード**: SUBSCRIBERS KV の `INVITE_CODES` キーにJSON配列
- **エンドポイント**:
  - `POST /api/checkout` — Checkout Session作成
  - `POST /api/webhook` — Stripe Webhook
  - `GET /api/subscriber/:email` — 購読ステータス
  - `POST /api/invite` — 招待コード検証
  - `POST /api/cancel` — 解約（cancel_at_period_end）
  - `POST /api/email-notify` — メール通知ON/OFF

### auth-api
- **認証**: PBKDF2 (100,000 iterations, SHA-256) + Bearer Token
- **セッション**: 30日TTL
- **エンドポイント**:
  - `POST /api/signup`, `POST /api/login`, `POST /api/logout`
  - `GET /api/me` — セッション検証
  - `GET /api/profile`, `PUT /api/profile` — 関心プロファイル

### email-notifier
- **配信**: Resend API (noreply@seiseishinbun.com)
- **対象**: status="active" or "invite"(期限内) かつ email_notify ≠ false
- **Service Binding**: news-generator から呼び出し

### push-api
- **認証**: VAPID (ES256)
- **暗号化**: RFC 8291 (ECDH + AES-128-GCM)
- **Service Binding**: news-generator から呼び出し

## KV スキーマ

### NEWSPAPER_CACHE
- キー: `morning-2026-03-01` / `evening-2026-03-01`
- 値: 紙面JSON（headline, articles, culture, weatherFashion, localNews, numbers, ticker, hatenaTrend, genArt）

### SUBSCRIBERS
- キー: メールアドレス
- 値: `{ email, customerId, subscriptionId, status, email_notify, registrationEmail, apple_pay_email, ... }`
- 特殊キー: `INVITE_CODES` — 招待コード配列

### USERS
- キー: メールアドレス
- 値: `{ email, passwordHash, salt, profile: { categories, keywords }, createdAt }`

### SESSIONS
- キー: セッショントークン
- 値: `{ email, createdAt }`（TTL: 30日）

## フロントエンド認証
- localStorage: `auth_email`, `auth_token`, `invite_user`
- ページ読込時にauth-api `/api/me` でセッション検証
- 未認証 → lp.htmlリダイレクト（?sample, ?invite, ?subscribed, #cancel は除外）
- 招待ユーザー: 期限チェック、期限切れはトースト通知

## ドメイン・DNS
- ドメイン: seiseishinbun.com（Cloudflare Registrar）
- DNS: Cloudflare DNS（CNAME → paul13131313.github.io、DNS Only）
- メール: Resend（DKIM, SPF, MX レコード設定済み）
- SSL: GitHub Pages 自動証明書

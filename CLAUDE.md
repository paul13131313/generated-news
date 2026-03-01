# CLAUDE.md — 生成新聞 プロジェクト指示書

> このファイルだけ読めばプロジェクトの全体像が把握できる状態にする

## プロジェクト概要

**AI生成パーソナライズドニュースサービス**
- URL: https://seiseishinbun.com/
- コンセプト: クラシックな新聞紙面レイアウト × 生成AI
- 配信: 朝刊 06:00 JST / 夕刊 17:00 JST（Cron Trigger）
- 料金: **完全無料**（メールアドレスのみで購読開始）
- ホスティング: GitHub Pages（フロント） + Cloudflare Workers（バックエンド）

## 技術スタック

### フロントエンド
- HTML/CSS/JS（バニラ）
- PWA対応（manifest.json, sw.js, offline.html）
- GitHub Pages でホスティング（カスタムドメイン: seiseishinbun.com）

### バックエンド（Cloudflare Workers）
| Worker | 役割 | URL |
|--------|------|-----|
| news-generator | 紙面JSON生成（Claude Haiku 4.5）+ 管理API | news-generator.hiroshinagano0113.workers.dev |
| payment-api | Stripe決済・購読者管理 | payment-api.hiroshinagano0113.workers.dev |
| auth-api | ユーザー認証（PBKDF2） | auth-api.hiroshinagano0113.workers.dev |
| email-notifier | メール配信（Resend API） | email-notifier.hiroshinagano0113.workers.dev |
| push-api | Web Push通知（VAPID） | push-api.hiroshinagano0113.workers.dev |
| waitlist-api | ウェイトリスト | waitlist-api.hiroshinagano0113.workers.dev |

### KV Namespaces
| KV | 用途 |
|----|------|
| NEWSPAPER_CACHE | 紙面JSONキャッシュ（キー: `{edition}-{YYYY-MM-DD}`、TTL: 12時間） |
| SUBSCRIBERS | 購読者データ |
| USERS | ユーザー認証データ |
| SESSIONS | セッショントークン |
| PUSH_SUBSCRIPTIONS | Web Push購読情報 |
| WAITLIST | ウェイトリスト |

### Service Bindings
- news-generator → push-api（生成完了時に通知）
- news-generator → email-notifier（生成完了時にメール配信）

### 外部API
| API | 用途 |
|-----|------|
| Claude API (Haiku 4.5) | 紙面JSON生成（約3.5円/回） |
| Unsplash API | 記事写真 |
| Open-Meteo API | 天気データ |
| Resend API | メール配信（from: noreply@seiseishinbun.com） |
| Stripe API | 決済（現在コメントアウト中、将来再導入の可能性あり） |
| Google News RSS | ご近所ニュース |
| artscape / CINRA / cinemacafe RSS | 催事情報 |
| はてブ hotentry | SNSトレンド |
| Yahoo Finance / CoinGecko | 株価ティッカー |

## 紙面構成

### レイアウト順
一面 → 記事5本 → 催事 → 天気と服装 → ご近所情報 → GEN ART → SNSトレンド → 数字で読む

### コーナーとデータソース
1. **一面** — RSS + Claude生成
2. **記事5本** — RSS + Claude生成（硬3+柔2のバランス）
3. **催事** — artscape + CINRA + cinemacafe RSSで実データ注入
4. **天気と服装** — Open-Meteo API実データ + Claude服装提案
5. **ご近所情報** — Google News RSS「渋谷 恵比寿」で実データ注入
6. **GEN ART** — Canvas ジェネラティブアート
7. **SNSトレンド** — はてブhotentry 3件で実データ注入
8. **数字で読む** — Claude生成（出典メディア名付き）
9. **株価ティッカー** — Yahoo Finance + CoinGecko実データ

### 重複排除
- 朝刊/夕刊間で同じ記事タイトルが出ないようプロンプトに前回タイトルを注入
- 催事・ご近所情報はKVキャッシュから前回URLを取得してフィルタ

## ファイル構成

```
generated-news/
├── index.html          # メイン紙面
├── lp.html             # ランディングページ
├── admin.html          # 管理画面（ダッシュボード）
├── terms.html          # 利用規約
├── privacy.html        # プライバシーポリシー
├── sample.html         # 見本紙
├── manifest.json       # PWA
├── sw.js               # Service Worker
├── offline.html        # オフラインページ
├── CNAME               # GitHub Pages カスタムドメイン
├── CLAUDE.md           # この文書
├── REFACTOR_PLAN.md    # リファクタリング計画
├── docs/
│   ├── ARCHITECTURE.md # 技術構成詳細
│   ├── ROADMAP.md      # やること・やらないこと
│   ├── CHANGELOG.md    # 変更履歴
│   └── archive/        # 旧仕様書
└── workers/
    ├── news-generator/ # 紙面生成Worker
    │   └── src/
    │       ├── index.js    # メインルーティング
    │       ├── prompt.js   # Claude APIプロンプト
    │       ├── claude.js   # Claude API呼び出し
    │       └── admin.js    # 管理API
    ├── payment-api/    # 決済Worker
    ├── auth-api/       # 認証Worker
    ├── email-notifier/ # メール配信Worker
    ├── push-api/       # Push通知Worker
    └── waitlist-api/   # ウェイトリストWorker
```

## 配信フロー
1. Cron Trigger（朝06:00/夕17:00 JST）で news-generator 起動
2. RSSフィードからニュース取得
3. Claude Haiku 4.5で紙面JSON生成
4. KVにキャッシュ保存
5. Service Binding経由でpush-api・email-notifier起動
6. フロントエンドはAPI経由でJSON取得 → レンダリング

## デプロイ

### フロントエンド
```bash
git add . && git commit -m "メッセージ" && git push origin main
# → GitHub Pages自動デプロイ
```

### Workers
```bash
cd workers/{worker名} && npx wrangler deploy
```

## 認証フロー
- ユーザーバーでメール表示・ログアウト
- localStorage: `auth_email`, `auth_token`, `invite_user`
- 未認証ユーザーはlp.htmlにリダイレクト（?sample, ?invite, ?subscribed, #cancel は除外）
- 招待コード: 7日間無料体験

## 管理画面（admin.html）
- JWT認証
- 購読者一覧・メール編集・招待コード適用
- 紙面プレビュー・見本紙発行
- お知らせ配信
- 配信ログ

## 開発ルール
- 変更時は `docs/CHANGELOG.md` に記録
- 技術構成の変更は `docs/ARCHITECTURE.md` を更新
- 課金関連コードは削除せずコメントアウトで残す
- Stripe/Apple Pay関連は将来再導入の可能性あり

# ROADMAP.md — やること・やらないことの一覧

## 完了済み（Phase 1: 基盤整理）

- [x] 仕様書の一元化（CLAUDE.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/CHANGELOG.md）
- [x] 天声生成コーナーの廃止（index.html, prompt.js から削除）
- [x] Apple Payメール上書きバグの修正（payment-api Webhook で registrationEmail を優先）
- [x] ダッシュボードにメール手動編集機能を追加（admin.html + admin.js PATCH API）
- [x] カスタムドメイン設定（seiseishinbun.com）
- [x] メール配信の独自ドメイン化（noreply@seiseishinbun.com）
- [x] 未認証ユーザーのLPリダイレクト
- [x] 催事・ご近所情報の重複排除

## Phase 2: 無料化と導線整理（次の優先）

- [ ] 課金フローの停止（Apple Pay / Stripe をコメントアウト）
- [ ] 体験パス（招待コード制）の廃止
- [ ] 購読ボタンを「メールアドレス入力 → 購読開始」に変更
- [ ] lp.html: 「無料で購読する」に変更、料金表示を削除
- [ ] index.html: 購読導線を無料前提に
- [ ] 利用規約・プライバシーポリシーから課金関連の記述を調整

## Phase 3: 位置情報パーソナライズ

- [ ] ブラウザ Geolocation API で位置情報取得
- [ ] 許可拒否時のフォールバックUI（都道府県 → 市区町村選択）
- [ ] 購読者プロフィールに location フィールド追加（lat, lng, area_name）
- [ ] 逆ジオコーディング（Workers側）
- [ ] 天気コーナーを位置情報連動に変更
- [ ] ご近所ニュースを位置情報連動に変更
- [ ] 催事を位置情報連動に変更
- [ ] 毎回のアクセス時に位置情報を更新（1km以上変化時のみ）
- [ ] 設定画面に「位置情報を手動で変更」オプション

## Phase 4: 朝刊・夕刊の差別化

- [ ] プロンプトの分離（朝刊用・夕刊用）
- [ ] 朝刊コーナー: 一面、近所ニュース、催事、数字で読む、天気と服装
- [ ] 夕刊コーナー: トレンド/SNS話題、ほっこりニュース、エンタメ、明日の天気
- [ ] デザイン上の差別化（朝刊白基調、夕刊クリーム色基調）

## やらないこと

- news-collector Worker の再利用（news-generatorが直接RSS取得する方式で十分）
- threads-poster Worker（未デプロイ、優先度低）
- 複雑なRAG/ベクトル検索（現在のRSS+Claude方式で十分）

## 注意事項

- Phase順に実装すること（2 → 3 → 4）
- Phase 3の位置情報APIは外部サービスのキー取得が必要（事前確認を取ること）
- KVスキーマ変更時はマイグレーション手順も記述すること
- 課金関連コードは削除せずコメントアウトで残す

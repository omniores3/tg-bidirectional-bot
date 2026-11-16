# Telegram 双方向カスタマーサポート Bot

[中文](README.md) · [English](README.en.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

データベース、Google Sheets、KV、永続メッセージストレージを使わない Telegram 双方向サポート Bot です。顧客は Bot と個別チャットを行い、メッセージは設定されたオペレーターまたは通常グループへ届きます。オペレーターは Telegram 標準の返信操作で顧客に回答できます。

## 重要：デプロイ方式はどちらか一方

このプロジェクトには、**完全に独立し、同じ業務機能を持つ二つの実装**があります。両方をデプロイする必要はありません。

```text
方式 A：Telegram → Cloudflare Worker → Telegram Bot API / AI API
方式 B：Telegram → Google Apps Script Web App → Telegram Bot API / AI API
```

- Cloudflare Workers だけを使う場合、Google アカウントと Apps Script は不要です。
- Google Apps Script だけを使う場合、Cloudflare アカウントと Worker は不要です。
- 両側が相互呼び出しを行うことはなく、内部共有シークレット、署名エンベロープ、転送 URL もありません。
- ルートの `config.js` が、どちらの方式にも共通する唯一の業務設定ファイルです。

## 機能

- 状態を保存しない `round_robin`、または全対象へ送る `all`。
- 数値 ID、数値文字列、`@username` だけのシンプルな振り分けリスト。
- 顧客名、ユーザー名、数値 ID、メッセージ種別、時刻、内容を表示。
- テキスト、写真、ドキュメント、音声、スタンプなどの Telegram メッセージに対応。
- 長文を分割しても署名付き返信ルートを維持。
- Telegram 標準返信と `/reply 顧客ID 内容` の予備チャネル。
- `/start` の歓迎文と本文下の Inline Keyboard を設定可能。
- 順序付きキーワードルール。回答と元メッセージをオペレーターにも表示。
- 顧客が明示的に `/ai 質問` を送った場合だけ OpenAI 互換 AI を呼び出し。
- 公開 HTTPS Markdown 知識ファイルを 1 時間キャッシュし、会話履歴は保存しない。
- グループ返信ホワイトリスト、オペレーター署名、HMAC ルート保護。
- 明確な中国語の中核コードコメント、6 言語文書、両プラットフォームのテスト。

## スポンサーとカスタム開発

- TRC20 寄付アドレス：`THzYfLHVbEaZ4UXwq5AxuZ9aunxq4m4pQg`
- Bot カスタム開発の連絡先：Telegram `@easSearchs`

## プロジェクト構成

```text
config.js                    実際のローカル設定で、.gitignore により除外
config.example.js            全項目の注釈付き設定テンプレート
CloudflareWorkers/           単独デプロイ可能な完全な Worker 実装
GoogleScripts/               単独デプロイ可能な完全な Apps Script 実装
scripts/sync-config.mjs      設定を検証し、両側の実行設定を生成
scripts/set-webhook.mjs      選択したプラットフォームの Webhook を設定
```

## 1. 共通準備

### Bot の作成

Telegram で `@BotFather` を開き、`/newbot` を送信して Bot Token を保存します。サポートグループに Bot を追加します。個別チャットのオペレーターは、Bot からメッセージを受け取る前に必ず Bot を開いて `/start` を送信してください。

グループの Privacy Mode は、Bot 自身のメッセージへの返信受信を妨げません。追加のグループコマンドが必要な場合だけ BotFather で変更します。

### 設定のコピー

Node.js 20 以降をインストールします。

```sh
cp config.example.js config.js
```

Windows PowerShell：

```powershell
Copy-Item config.example.js config.js
```

### 数値 ID の取得

ユーザーに Bot へ `/id` を送ってもらうか、Bot を対象グループへ一時的に追加して `/id` を送信します。ユーザー ID とチャット ID が返されます。通常グループとスーパーグループに対応し、トピック機能は使用しません。

### 二つの独立したシークレットを生成

次のコマンドを二回実行します。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- 一つ目を Webhook 認証用の `telegram.webhookSecret` に設定します。
- 二つ目を返信ルート署名用の `replies.routeSecret` に設定します。

Worker と Apps Script の間の第三の共有シークレットは存在しません。

## 2. config.js 全設定リファレンス

ルートの `config.js` を編集します。各項目の詳細な中国語コメントは [config.example.js](config.example.js) を参照してください。

### Telegram と Worker

| 項目 | 説明 |
| --- | --- |
| `telegram.botToken` | BotFather から発行された Token。 |
| `telegram.webhookSecret` | 16–256 文字の英数字、アンダースコア、ハイフン。Worker はヘッダー、Apps Script は `/exec?secret=...` を検証します。 |
| `telegram.apiBaseUrl` | Telegram API のルート。通常は `https://api.telegram.org`。 |
| `worker.requestTimeoutMs` | Worker が Telegram、AI、知識 URL を呼ぶタイムアウト（ミリ秒）。Worker のみで使用。 |
| `worker.maxUpdateBytes` | Update の最大 UTF-8 バイト数。Worker のみで使用。 |

### 振り分け

| 項目 | 説明 |
| --- | --- |
| `dispatch.mode` | `round_robin` または `all`。循環は `update_id % 対象数` を使い、カーソルを保存しません。 |
| `dispatch.users` | オペレーターユーザー配列（例：`[111111111, "@kefu001"]`）。 |
| `dispatch.groups` | 通常グループ配列（例：`[-1001234567890, "@my_support_group"]`）。 |

```js
dispatch: {
  mode: "round_robin",
  users: [111111111, "@kefu001"],
  groups: [-1001234567890, "@my_support_group"]
}
```

数値文字列は数値へ正規化され、ユーザー名の大文字小文字は区別されません。公開ユーザー名は変わる可能性があるため、長期運用では数値 ID を推奨します。

### 歓迎メッセージと Inline Keyboard

| 項目 | 説明 |
| --- | --- |
| `welcome.text` | `/start` の歓迎本文。 |
| `welcome.buttons` | 行とボタンから成る二次元配列。 |
| ボタン `text` | ボタン表示文字列。 |
| ボタン `callbackData` | 1–64 バイトのコールバックデータ。`url` とどちらか一方。 |
| ボタン `response` | コールバックボタン押下後に顧客へ送る任意の回答。 |
| ボタン `url` | HTTPS リンク。`callbackData` とどちらか一方。 |

```js
welcome: {
  text: "サービスを選ぶか、質問を送信してください。",
  buttons: [
    [{ text: "ヘルプ", callbackData: "help", response: "ここに質問を送信してください。" }],
    [{ text: "Web サイト", url: "https://example.com" }]
  ]
}
```

入力欄の下の Reply Keyboard ではなく、`reply_markup.inline_keyboard` を生成します。

### キーワード自動応答

| 項目 | 説明 |
| --- | --- |
| `autoReply.enabled` | 固定ルールを有効にするかどうか。 |
| `autoReply.rules` | 順序付きルール配列で、最初に一致したルールを使用。 |
| ルール `keywords` | 空でないキーワード配列。いずれか一つが一致すれば有効。 |
| ルール `reply` | 顧客へ送り、オペレーターにもコピーする回答。 |

英語の大文字小文字を区別しない部分一致です。一致しない通常メッセージはオペレーターへ送るだけで、AI を自動呼び出ししません。

### AI とオンライン Markdown

| 項目 | 説明 |
| --- | --- |
| `ai.enabled` | 明示的な `/ai` 要求を有効化。 |
| `ai.apiBaseUrl` | `https://api.openai.com/v1` などの OpenAI 互換 API ルート。 |
| `ai.apiKey` | AI サービスのキー。 |
| `ai.model` | モデル名。 |
| `ai.systemPrompt` | システムプロンプト。 |
| `ai.knowledgeUrls` | 公開 HTTPS Markdown URL の配列。 |
| `ai.maxKnowledgeChars` | 一回の要求で使う知識の合計文字数上限。 |
| `ai.maxOutputTokens` | 最大出力 Token 数（1–4096）。 |
| `ai.temperature` | サンプリング温度（0–2）。 |

最大 10 ファイル、各ファイル最大 50000 文字を読み取り、リダイレクトを禁止します。Apps Script は `CacheService` に 1 時間保存し、Worker は現在のインスタンスのメモリに 1 時間保存します。インスタンス回収後は再ダウンロードします。知識または AI が失敗しても顧客へ通知し、元の質問はオペレーターへ届けます。

### 返信と表示

| 項目 | 説明 |
| --- | --- |
| `replies.groupPolicy` | `all_members` または `whitelist`。 |
| `replies.allowedUserIds` | ホワイトリスト時に返信できるオペレーターの数値 ID 配列。 |
| `replies.showOperatorName` | 顧客へオペレーター名を表示。`false` の場合は `copyMessage` で送信元を隠します。 |
| `replies.linkToOriginal` | 顧客の元メッセージへ関連付け、削除済みなら関連付けを外して再試行。 |
| `replies.routeSecret` | 16 文字以上の HMAC ルートシークレット。 |
| `presentation.timeZone` | `Asia/Shanghai` などの IANA タイムゾーン。 |
| `presentation.showLanguage` | 顧客の Telegram 言語を表示。 |
| `presentation.showTimestamp` | 顧客メッセージの時刻を表示。 |

### メッセージ文

| 項目 | 用途 |
| --- | --- |
| `messages.customerHelp` | 顧客の `/help` と不明なコマンド。 |
| `messages.aiHelp` | 質問のない `/ai`。 |
| `messages.aiUnavailable` | AI または知識が利用不可。 |
| `messages.invalidButton` | 無効または期限切れのコールバック。 |
| `messages.adminHelp` | オペレーターヘルプ。 |
| `messages.unsupported` | 未対応のメッセージ種別。 |
| `messages.deliveryFailed` | 全振り分け先への配信失敗。 |
| `messages.routeNotFound` | 無効なルートまたは別 Bot のメッセージ。 |
| `messages.unauthorized` | オペレーター返信の権限なし。 |
| `messages.replyFailed` | 顧客への返信失敗。 |
| `messages.replySent` | `/reply` 予備チャネルの成功。 |
| `messages.invalidReplyCommand` | `/reply` の形式エラー。 |

## 3. 方式 A：Cloudflare Workers のみ

Apps Script プロジェクトは不要です。

### インストール、認証、デプロイ

```sh
npm install --prefix CloudflareWorkers
npm exec --prefix CloudflareWorkers -- wrangler login
npm run sync:config
npm run deploy:worker
```

`CloudflareWorkers/wrangler.jsonc` で Worker 名を変更できます。無料の workers.dev サブドメインで利用可能です。発行された `https://NAME.SUBDOMAIN.workers.dev` をコピーします。

### Webhook の設定

```sh
npm run webhook:set -- https://NAME.SUBDOMAIN.workers.dev
```

スクリプトが `/webhook` を追加し、`telegram.webhookSecret` を Telegram Secret Token として設定します。ヘルスチェック：

```text
https://NAME.SUBDOMAIN.workers.dev/health
```

任意で `wrangler secret put` を使い、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`REPLIES_ROUTE_SECRET`、`AI_API_KEY` を設定できます。生成済みの対応シークレットを上書きしますが、環境変数がなくても単独で動作します。

## 4. 方式 B：Google Apps Script のみ

Cloudflare アカウント、Wrangler、Worker は不要です。

### clasp のインストールと認証

```sh
npm install --prefix GoogleScripts
npm exec --prefix GoogleScripts -- clasp login
```

### プロジェクト作成とアップロード

`https://script.google.com/` で空のプロジェクトを作成します。プロジェクト設定またはブラウザ URL から Script ID をコピーし、`GoogleScripts/.clasp.json` を作成します。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "."
}
```

独立実装をアップロードします。

```sh
npm run sync:config
npm run push:gas
```

`GoogleScripts/config.generated.js` を手動編集しないでください。

### Web App の公開

Apps Script エディターで **デプロイ → 新しいデプロイ → ウェブアプリ** を選択します。

- 実行ユーザー：**自分**。
- アクセスできるユーザー：**全員**。
- `/dev` テスト URL ではなく、`/exec` で終わる公開 URL をコピーします。

### Webhook の設定

```sh
npm run webhook:set -- https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Apps Script は Telegram Secret Token ヘッダーを読めないため、スクリプトが `/exec` に `?secret=...` を追加します。`doPost` は同じ `telegram.webhookSecret` で検証します。完全な Webhook URL を公開しないでください。

## 5. 利用と受け入れ確認

1. 顧客として `/start` を送り、歓迎本文と Inline Keyboard を確認します。
2. テキスト、写真、スタンプを送り、設定先に顧客情報と内容が届くことを確認します。
3. Bot の情報カード、ルート付きテキスト、メディア caption に返信し、顧客への到着を確認します。
4. オペレーターチャットで `/reply 顧客ID 内容` を試します。
5. `/id` の数値 ID と `config.js` を比較します。
6. 設定したキーワードを試し、顧客とオペレーターの両方が回答を受け取ることを確認します。
7. `/ai インストール方法は？` を送り、回答とオペレーター用コピーを確認します。通常メッセージで AI を呼ばないことも確認します。
8. ホワイトリスト使用時は、許可されたメンバーと許可されていないメンバーをそれぞれ試します。

```text
/start                 顧客の歓迎メッセージ
/help                  顧客またはオペレーターヘルプ
/ai 質問               明示的な AI 質問
/id                    ユーザーとチャット ID の表示
/reply 顧客ID 内容      オペレーターの予備返信
```

## 6. 更新、テスト、トラブルシューティング

設定変更後：

```sh
npm run sync:config
npm run test:worker
npm run test:gas
npm run build:worker
```

選択したプラットフォームだけを更新します。

- Worker：`npm run deploy:worker`。
- Apps Script：`npm run push:gas` の後、**デプロイを管理** で Web App を編集し、新しいバージョンを作成してデプロイします。通常 `/exec` URL は変わらないため、Webhook の再設定は不要です。

トラブルシューティング：

- **Webhook 401/unauthorized**：`webhook:set` を再実行し、デプロイ側の `webhookSecret` を確認します。
- **Bot が送信できない**：Bot Token、実行ログ、Telegram Webhook 情報を確認します。個別オペレーターは先に `/start` が必要です。
- **グループに届かない**：Bot の参加、負のグループ ID、公開 `@username` を確認します。
- **オペレーター返信が無効**：`R.customerId.messageId.signature` を含む Bot メッセージへ返信してください。他の Bot のメッセージは使えません。
- **AI が失敗する**：API URL、キー、モデル、HTTPS 知識 URL、公開アクセスを確認します。有人への振り分けは継続します。
- **Apps Script の変更が反映されない**：Script ID を確認し、Web App の新バージョンを公開します。

顧客メッセージ、会話、振り分けカーソル、返信マッピングは永続保存しません。`config.js`、生成設定ファイル、完全な Apps Script Webhook URL を保護してください。

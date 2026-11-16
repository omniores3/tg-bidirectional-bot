# Telegram Bidirectional Support Bot

[中文](README.md) · [English](README.en.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

A Telegram two-way support bot with no database, Google Sheets, KV, or persistent message storage. Customers chat privately with the bot. Their messages are delivered to configured agents or ordinary groups, and agents reply using Telegram's native reply action.

## Important: choose exactly one deployment

The project contains two **fully independent implementations with the same business features**. You do not deploy both:

```text
Option A: Telegram → Cloudflare Worker → Telegram Bot API / AI API
Option B: Telegram → Google Apps Script Web App → Telegram Bot API / AI API
```

- Cloudflare-only deployment requires no Google account or Apps Script project.
- Apps Script-only deployment requires no Cloudflare account or Worker.
- Neither side calls the other. There is no internal shared secret, signed envelope, or forwarding URL.
- Root `config.js` is the single shared business configuration file for either option.

## Features

- Stateless `round_robin` delivery or `all` delivery to every target.
- Targets are plain numeric IDs, numeric strings, or `@username` values.
- Agent messages include customer name, username, numeric ID, type, timestamp, and content.
- Text, photos, documents, voice, stickers, and other supported Telegram messages.
- Long messages are split without losing the signed reply route.
- Native Telegram replies plus `/reply CUSTOMER_ID text` as a fallback.
- Configurable `/start` message and Inline Keyboard below the message body.
- Ordered keyword rules; both the answer and original message are visible to agents.
- OpenAI-compatible AI only when a customer explicitly sends `/ai question`.
- Public HTTPS Markdown knowledge with a one-hour temporary cache and no chat history.
- Optional group reply whitelist, operator signatures, and HMAC-protected routes.
- Clear Chinese core-code comments, six-language documentation, and tests for both runtimes.

## Sponsorship and customization

- TRC20 donation address: `THzYfLHVbEaZ4UXwq5AxuZ9aunxq4m4pQg`
- Custom bot development: Telegram `@easSearchs`

## Project layout

```text
config.js                    Local secrets; ignored by .gitignore
config.example.js            Fully annotated configuration template
CloudflareWorkers/           Complete standalone Worker implementation
GoogleScripts/               Complete standalone Apps Script implementation
scripts/sync-config.mjs      Validates and generates runtime configuration
scripts/set-webhook.mjs      Sets a Telegram Webhook for either platform
```

## 1. Shared preparation

### Create the bot

Open `@BotFather` in Telegram, send `/newbot`, and save the Bot Token. Add the bot to each support group. Every private-chat agent must open the bot and send `/start` before Telegram allows the bot to message them.

Group privacy mode does not prevent replies to the bot's own messages. Adjust Privacy Mode through BotFather only if you need additional group commands.

### Install and copy configuration

Install Node.js 20 or newer:

```sh
cp config.example.js config.js
```

Windows PowerShell:

```powershell
Copy-Item config.example.js config.js
```

### Obtain numeric IDs

Ask a user to send `/id` to the bot, or temporarily add the bot to the target group and send `/id` there. The response contains the user ID and chat ID. Ordinary groups and supergroups are supported; no topic feature is used.

### Generate two independent secrets

Run this command twice:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- Put the first value in `telegram.webhookSecret` for Webhook authentication.
- Put the second value in `replies.routeSecret` for signed agent reply routes.

No third Worker-to-Apps-Script shared secret exists.

## 2. Complete config.js reference

Edit root `config.js`. See [config.example.js](config.example.js) for line-by-line Chinese annotations.

### Telegram and Worker

| Field | Description |
| --- | --- |
| `telegram.botToken` | Token from BotFather. |
| `telegram.webhookSecret` | 16–256 letters, digits, underscores, or hyphens. Worker checks the request header; Apps Script checks `/exec?secret=...`. |
| `telegram.apiBaseUrl` | Telegram API root, normally `https://api.telegram.org`. |
| `worker.requestTimeoutMs` | Worker timeout for Telegram, AI, and knowledge requests; Worker only. |
| `worker.maxUpdateBytes` | Maximum UTF-8 Update size in bytes; Worker only. |

### Dispatch

| Field | Description |
| --- | --- |
| `dispatch.mode` | `round_robin` or `all`. Round-robin uses `update_id % target count` and stores no cursor. |
| `dispatch.users` | Agent users, for example `[111111111, "@kefu001"]`. |
| `dispatch.groups` | Ordinary groups, for example `[-1001234567890, "@my_support_group"]`. |

```js
dispatch: {
  mode: "round_robin",
  users: [111111111, "@kefu001"],
  groups: [-1001234567890, "@my_support_group"]
}
```

Numeric strings are normalized to numbers and usernames are case-insensitive. Prefer numeric IDs for long-term use because public usernames can change.

### Welcome and Inline Keyboard

| Field | Description |
| --- | --- |
| `welcome.text` | `/start` welcome body. |
| `welcome.buttons` | Two-dimensional array: rows containing buttons. |
| Button `text` | Visible button label. |
| Button `callbackData` | 1–64-byte callback value; use this or `url`. |
| Button `response` | Optional message sent after a callback button is clicked. |
| Button `url` | HTTPS link; use this or `callbackData`. |

```js
welcome: {
  text: "Choose a service or send your question.",
  buttons: [
    [{ text: "Help", callbackData: "help", response: "Send your question here." }],
    [{ text: "Website", url: "https://example.com" }]
  ]
}
```

This creates `reply_markup.inline_keyboard`, not a Reply Keyboard beside the input box.

### Keyword auto-replies

| Field | Description |
| --- | --- |
| `autoReply.enabled` | Enables fixed rules. |
| `autoReply.rules` | Ordered rules; the first matching rule wins. |
| Rule `keywords` | Non-empty keywords; any keyword in a rule can match. |
| Rule `reply` | Answer sent to the customer and copied to agents. |

Matching is case-insensitive for English and uses substrings. An unmatched ordinary message goes only to human agents and never calls AI automatically.

### AI and online Markdown

| Field | Description |
| --- | --- |
| `ai.enabled` | Enables explicit `/ai` requests. |
| `ai.apiBaseUrl` | OpenAI-compatible API root, such as `https://api.openai.com/v1`. |
| `ai.apiKey` | AI provider key. |
| `ai.model` | Model name. |
| `ai.systemPrompt` | System prompt. |
| `ai.knowledgeUrls` | Public HTTPS Markdown URLs. |
| `ai.maxKnowledgeChars` | Maximum combined knowledge characters per request. |
| `ai.maxOutputTokens` | Maximum output tokens, 1–4096. |
| `ai.temperature` | Sampling temperature, 0–2. |

At most 10 files and 50000 characters per file are read, with redirects disabled. Apps Script uses `CacheService` for one hour. Worker uses in-memory caching in the current isolate for one hour and downloads again after isolate recycling. Knowledge or AI failure produces a customer notice while the original question still reaches human agents.

### Replies and presentation

| Field | Description |
| --- | --- |
| `replies.groupPolicy` | `all_members` or `whitelist`. |
| `replies.allowedUserIds` | Numeric agent IDs allowed when whitelist mode is active. |
| `replies.showOperatorName` | Shows the agent name to customers. When false, `copyMessage` hides the agent source. |
| `replies.linkToOriginal` | Links replies to the customer's original message; retries without linking if it was deleted. |
| `replies.routeSecret` | HMAC route secret, at least 16 characters. |
| `presentation.timeZone` | IANA time zone, such as `Asia/Shanghai`. |
| `presentation.showLanguage` | Shows the customer's Telegram language. |
| `presentation.showTimestamp` | Shows the customer message timestamp. |

### Message texts

| Field | Purpose |
| --- | --- |
| `messages.customerHelp` | Customer `/help` and unknown commands. |
| `messages.aiHelp` | `/ai` without a question. |
| `messages.aiUnavailable` | AI or knowledge unavailable. |
| `messages.invalidButton` | Invalid or expired callback. |
| `messages.adminHelp` | Agent help. |
| `messages.unsupported` | Unsupported message type. |
| `messages.deliveryFailed` | Every agent target failed. |
| `messages.routeNotFound` | Invalid route or a message from a different bot. |
| `messages.unauthorized` | Agent reply not authorized. |
| `messages.replyFailed` | Customer reply failed. |
| `messages.replySent` | `/reply` fallback succeeded. |
| `messages.invalidReplyCommand` | Invalid `/reply` syntax. |

## 3. Option A: Cloudflare Workers only

No Apps Script project is required.

### Install, authenticate, and deploy

```sh
npm install --prefix CloudflareWorkers
npm exec --prefix CloudflareWorkers -- wrangler login
npm run sync:config
npm run deploy:worker
```

You can change the Worker name in `CloudflareWorkers/wrangler.jsonc`. A free workers.dev subdomain is sufficient. Copy the resulting `https://NAME.SUBDOMAIN.workers.dev` URL.

### Set the Webhook

```sh
npm run webhook:set -- https://NAME.SUBDOMAIN.workers.dev
```

The script appends `/webhook` and configures `telegram.webhookSecret` as Telegram's Secret Token. Health check:

```text
https://NAME.SUBDOMAIN.workers.dev/health
```

Optional `wrangler secret put` variables are `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `REPLIES_ROUTE_SECRET`, and `AI_API_KEY`. They override corresponding generated secrets; no environment variable is required for standalone operation.

## 4. Option B: Google Apps Script only

No Cloudflare account, Wrangler, or Worker is required.

### Install and authenticate clasp

```sh
npm install --prefix GoogleScripts
npm exec --prefix GoogleScripts -- clasp login
```

### Create and upload the project

Create a blank project at `https://script.google.com/`. Copy its Script ID from project settings or the browser URL, then create `GoogleScripts/.clasp.json`:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "."
}
```

Upload the standalone implementation:

```sh
npm run sync:config
npm run push:gas
```

Do not manually edit `GoogleScripts/config.generated.js`.

### Publish the Web App

In the Apps Script editor, choose **Deploy → New deployment → Web app**:

- Execute as: **Me**.
- Who has access: **Anyone**.
- Copy the published URL ending in `/exec`, not the `/dev` test URL.

### Set the Webhook

```sh
npm run webhook:set -- https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Apps Script cannot read Telegram's Secret Token request header, so the script adds `?secret=...` to `/exec`. `doPost` verifies it against the same `telegram.webhookSecret`. Do not publish the complete Webhook URL.

## 5. Usage and acceptance checks

1. Send `/start` as a customer and verify the welcome body and Inline Keyboard.
2. Send text, a photo, and a sticker; verify customer identity and content at configured targets.
3. Reply to a bot information card, routed text, or media caption; the customer should receive the agent reply.
4. Test `/reply CUSTOMER_ID text` in an agent chat.
5. Send `/id` and compare the numeric IDs with `config.js`.
6. Test a configured keyword; both customer and agents should see the answer.
7. Send `/ai How do I install?`; verify the answer and agent copy. Ordinary messages must not call AI.
8. With whitelist mode enabled, test both an allowed and a non-allowed group member.

```text
/start                 Customer welcome
/help                  Customer or agent help
/ai question           Explicit AI request
/id                    Show user and chat IDs
/reply CUSTOMER_ID text Agent fallback reply
```

## 6. Updates, tests, and troubleshooting

After changing configuration:

```sh
npm run sync:config
npm run test:worker
npm run test:gas
npm run build:worker
```

Update only the selected platform:

- Worker: run `npm run deploy:worker`.
- Apps Script: run `npm run push:gas`, then edit the Web App under **Manage deployments**, create a new version, and deploy. The `/exec` URL normally stays unchanged, so the Webhook does not need to be reset.

Troubleshooting:

- **Webhook 401/unauthorized**: run `webhook:set` again and verify the deployed `webhookSecret`.
- **The bot does not send messages**: check the Bot Token, runtime logs, and Telegram Webhook information. Private agents must start the bot first.
- **A group receives nothing**: check bot membership, the negative group ID, and any public `@username`.
- **An agent reply is invalid**: reply to a bot message containing `R.customerId.messageId.signature`; messages from other bots cannot be used.
- **AI fails**: check API URL, key, model, HTTPS knowledge URLs, and public access. Human delivery still runs.
- **Apps Script changes do not appear**: verify the Script ID and publish a new Web App version.

No customer messages, conversations, dispatch cursors, or reply mappings are persisted. Protect `config.js`, generated configuration files, and the complete Apps Script Webhook URL.

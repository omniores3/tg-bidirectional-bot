# Telegram 双向客服机器人

[中文](README.md) · [English](README.en.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

一个无需数据库、无需 Google Sheets、无需 KV 的 Telegram 双向客服机器人。客户只与机器人私聊，消息会按配置分发给客服用户或普通群组；客服直接回复机器人转发的消息即可回信给客户。

## 重要：两种部署方式二选一

本项目提供两套**完全独立、功能一致**的实现，不需要同时部署：

```text
方式 A：Telegram → Cloudflare Worker → Telegram Bot API / AI API
方式 B：Telegram → Google Apps Script Web App → Telegram Bot API / AI API
```

- 只使用 Cloudflare Workers 时，不需要 Google 账号或 Apps Script。
- 只使用 Google Apps Script 时，不需要 Cloudflare 账号或 Worker。
- 两端不会互相请求，也没有内部共享密钥、签名信封或转发地址。
- 根目录 `config.js` 是两种部署共用的唯一业务配置入口。

## 功能

- `round_robin` 无状态轮询，或 `all` 发送给全部客服目标。
- 分发列表只填写数字 ID、数字字符串或 `@username`。
- 管理端显示客户姓名、用户名、数字 ID、消息类型、时间和内容。
- 支持文本、图片、文件、语音、贴纸等消息；长文本自动分段并保留回复路由。
- 客服使用 Telegram 原生回复，或使用 `/reply 客户ID 内容`。
- `/start` 欢迎语和消息正文下方的 Inline Keyboard 均可配置。
- 固定关键词按顺序匹配，答案和原消息都会转给客服。
- 仅客户显式发送 `/ai 问题` 时调用 OpenAI 兼容接口。
- 在线 HTTPS Markdown 知识库，一小时临时缓存，无多轮对话存储。
- 支持群组回复白名单、客服姓名签名、路由 HMAC 防伪造。
- 中文核心代码注释、六语言文档和双平台自动化测试。

## 赞助与定制

- TRC20 赞助地址：`THzYfLHVbEaZ4UXwq5AxuZ9aunxq4m4pQg`
- 机器人定制开发：Telegram `@easSearchs`

## 目录

```text
config.js                    本地真实配置，已被 .gitignore 忽略
config.example.js            带完整中文注释的配置模板
CloudflareWorkers/           可单独部署的完整 Worker 实现
GoogleScripts/               可单独部署的完整 Apps Script 实现
scripts/sync-config.mjs      校验配置并生成两端运行配置
scripts/set-webhook.mjs      为任一平台设置 Telegram Webhook
```

## 一、共同准备

### 1. 创建机器人

在 Telegram 找 `@BotFather`，发送 `/newbot`，保存 Bot Token。把机器人加入需要接收客户消息的客服群；私聊客服必须先主动打开机器人并发送 `/start`。

Bot 的群隐私模式不影响它接收“回复机器人自己的消息”。如果需要在群里使用其他命令，按 BotFather 提示调整 Privacy Mode。

### 2. 准备环境

安装 Node.js 20 或更高版本，然后复制配置：

```sh
cp config.example.js config.js
```

Windows PowerShell 可使用：

```powershell
Copy-Item config.example.js config.js
```

### 3. 获取数字 ID

临时把机器人加入目标群或让目标用户私聊机器人，发送 `/id`。机器人会返回当前用户 ID 和聊天 ID。普通群、超级群均可，不需要启用任何话题功能。

也可以先保留示例列表，部署后使用 `/id` 获取真实 ID，再修改 `config.js` 并重新部署。

### 4. 生成两个独立密钥

分别执行两次以下命令：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- 第一串填入 `telegram.webhookSecret`：验证 Telegram Webhook。
- 第二串填入 `replies.routeSecret`：签名管理端客户回复路由。

不再需要 Worker 与 Apps Script 之间的第三把共享密钥。

## 二、完整 config.js 配置

直接编辑根目录 `config.js`。所有字段的逐行中文注释见 [config.example.js](config.example.js)。

### Telegram 与 Worker

| 字段 | 说明 |
| --- | --- |
| `telegram.botToken` | BotFather 提供的 Token。 |
| `telegram.webhookSecret` | 16–256 位字母、数字、下划线或连字符。Worker 校验请求头；Apps Script 校验 `/exec?secret=...`。 |
| `telegram.apiBaseUrl` | Telegram API 根地址，默认 `https://api.telegram.org`。 |
| `worker.requestTimeoutMs` | Worker 调用 Telegram、AI 和知识地址的超时毫秒数，仅 Worker 使用。 |
| `worker.maxUpdateBytes` | 单个 Update 最大 UTF-8 字节数，仅 Worker 使用。 |

### 分发

| 字段 | 说明 |
| --- | --- |
| `dispatch.mode` | `round_robin` 或 `all`。轮询使用 `update_id % 目标数`，不保存游标。 |
| `dispatch.users` | 客服用户数组，例如 `[111111111, "@kefu001"]`。 |
| `dispatch.groups` | 普通客服群数组，例如 `[-1001234567890, "@my_support_group"]`。 |

```js
dispatch: {
  mode: "round_robin",
  users: [111111111, "@kefu001"],
  groups: [-1001234567890, "@my_support_group"]
}
```

数字字符串会自动转换为数字；用户名不区分大小写。公开用户名可能变化，长期使用优先数字 ID。

### 欢迎消息与 Inline Keyboard

| 字段 | 说明 |
| --- | --- |
| `welcome.text` | `/start` 欢迎正文。 |
| `welcome.buttons` | 二维数组；外层是行，内层是该行按钮。 |
| 按钮 `text` | 按钮显示文字，必填。 |
| 按钮 `callbackData` | 回调数据，1–64 字节；与 `url` 二选一。 |
| 按钮 `response` | 点击回调按钮后发送给客户的正文，可省略。 |
| 按钮 `url` | HTTPS 链接；与 `callbackData` 二选一。 |

```js
welcome: {
  text: "你好，请选择服务，也可以直接发送问题。",
  buttons: [
    [{ text: "使用帮助", callbackData: "help", response: "直接发送问题即可。" }],
    [{ text: "访问官网", url: "https://example.com" }]
  ]
}
```

这里生成的是 `reply_markup.inline_keyboard`，不是输入框下方的 Reply Keyboard。

### 固定关键词自动回复

| 字段 | 说明 |
| --- | --- |
| `autoReply.enabled` | 是否启用固定规则。 |
| `autoReply.rules` | 规则数组，按数组顺序取第一条命中规则。 |
| 规则 `keywords` | 非空关键词数组，同一规则命中任意一个即可。 |
| 规则 `reply` | 发送给客户的答案，同时复制给客服。 |

英文匹配不区分大小写，采用子串匹配。普通消息未命中规则时只转人工，不会自动调用 AI。

### AI 与在线 Markdown

| 字段 | 说明 |
| --- | --- |
| `ai.enabled` | 是否允许 `/ai` 调用模型。 |
| `ai.apiBaseUrl` | OpenAI 兼容 API 根地址，例如 `https://api.openai.com/v1`。 |
| `ai.apiKey` | AI 服务密钥。 |
| `ai.model` | 模型名称。 |
| `ai.systemPrompt` | 系统提示词。 |
| `ai.knowledgeUrls` | 公网 HTTPS Markdown 地址数组。 |
| `ai.maxKnowledgeChars` | 单次请求使用的知识总字符上限。 |
| `ai.maxOutputTokens` | 最大输出 Token，1–4096。 |
| `ai.temperature` | 采样温度，0–2。 |

最多读取 10 个文件，每个文件最多 50000 字符，禁止重定向。Apps Script 使用 `CacheService` 缓存一小时；Worker 使用当前实例内存缓存一小时，实例回收后会重新下载。知识不可用或 AI 失败时，客户会收到提示，原问题仍转人工。

### 客服回复与展示

| 字段 | 说明 |
| --- | --- |
| `replies.groupPolicy` | `all_members` 允许群内成员回复；`whitelist` 只允许白名单。 |
| `replies.allowedUserIds` | 白名单客服数字 ID 数组。 |
| `replies.showOperatorName` | 是否在客户收到的回复中显示客服姓名。默认 `false` 时使用 `copyMessage` 隐藏来源。 |
| `replies.linkToOriginal` | 是否关联客户原消息；原消息已删除时会取消关联并重试。 |
| `replies.routeSecret` | 回复路由 HMAC 密钥，至少 16 个字符。 |
| `presentation.timeZone` | IANA 时区，例如 `Asia/Shanghai`。 |
| `presentation.showLanguage` | 是否显示客户 Telegram 语言。 |
| `presentation.showTimestamp` | 是否显示客户消息时间。 |

### 文案

| 字段 | 用途 |
| --- | --- |
| `messages.customerHelp` | 客户 `/help` 或未知命令。 |
| `messages.aiHelp` | `/ai` 未填写问题。 |
| `messages.aiUnavailable` | AI 或知识不可用。 |
| `messages.invalidButton` | 按钮已失效或回调未配置。 |
| `messages.adminHelp` | 管理端帮助。 |
| `messages.unsupported` | 不支持的消息类型。 |
| `messages.deliveryFailed` | 全部客服目标投递失败。 |
| `messages.routeNotFound` | 回复路由无效或不是本 Bot 的消息。 |
| `messages.unauthorized` | 无权执行客服回复。 |
| `messages.replyFailed` | 回复客户失败。 |
| `messages.replySent` | `/reply` 备用通道发送成功。 |
| `messages.invalidReplyCommand` | `/reply` 格式错误。 |

## 三、方式 A：仅部署 Cloudflare Workers

不需要创建 Apps Script 项目。

### 1. 安装并登录

```sh
npm install --prefix CloudflareWorkers
npm exec --prefix CloudflareWorkers -- wrangler login
```

可在 `CloudflareWorkers/wrangler.jsonc` 修改 Worker 名称。免费 workers.dev 子域名即可使用。

### 2. 同步配置并部署

```sh
npm run sync:config
npm run deploy:worker
```

部署成功后复制 `https://你的名称.你的子域.workers.dev`。

### 3. 设置 Webhook

```sh
npm run webhook:set -- https://你的名称.你的子域.workers.dev
```

脚本自动拼接 `/webhook`，并把 `telegram.webhookSecret` 设置为 Telegram Secret Token。健康检查地址：

```text
https://你的名称.你的子域.workers.dev/health
```

可选：使用 `wrangler secret put` 设置 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`REPLIES_ROUTE_SECRET`、`AI_API_KEY`，环境变量会覆盖生成配置中的对应密钥。不设置也能独立运行。

## 四、方式 B：仅部署 Google Apps Script

不需要 Cloudflare 账号、Wrangler 或 Worker。

### 1. 安装并登录 clasp

```sh
npm install --prefix GoogleScripts
npm exec --prefix GoogleScripts -- clasp login
```

### 2. 创建 Apps Script 项目

打开 `https://script.google.com/`，新建空白项目。在项目设置或浏览器地址中复制 Script ID，然后创建 `GoogleScripts/.clasp.json`：

```json
{
  "scriptId": "你的_SCRIPT_ID",
  "rootDir": "."
}
```

### 3. 同步并上传

```sh
npm run sync:config
npm run push:gas
```

`GoogleScripts/config.generated.js` 由脚本生成，不要手工修改。

### 4. 发布 Web App

在 Apps Script 编辑器选择“部署”→“新建部署”→“Web 应用”：

- 执行身份：**我**。
- 谁可以访问：**任何人**。
- 部署后复制以 `/exec` 结尾的 Web App URL，不要使用 `/dev` 测试地址。

### 5. 设置 Webhook

```sh
npm run webhook:set -- https://script.google.com/macros/s/你的部署ID/exec
```

Apps Script 无法读取 Telegram Secret Token 请求头，所以脚本自动在 `/exec` 后添加 `?secret=...`，`doPost` 使用同一个 `telegram.webhookSecret` 校验。不要公开完整 Webhook URL。

## 五、使用与验收

1. 客户发送 `/start`，检查欢迎正文和消息下方按钮。
2. 客户发送文本、图片或贴纸，检查配置目标是否收到客户信息和内容。
3. 客服在 Telegram 中回复信息卡、带路由的文本或媒体 caption，客户应收到回复。
4. 在客服群发送 `/reply 客户ID 内容`，验证备用通道。
5. 发送 `/id`，确认返回的数字 ID 与配置一致。
6. 启用固定规则后发送关键词，客户和客服都应看到答案。
7. 启用 AI 后发送 `/ai 如何安装？`，检查答案及客服副本；普通消息不应触发 AI。
8. 若使用白名单，分别用白名单内、外成员测试回复权限。

常用命令：

```text
/start                 客户欢迎消息
/help                  客户或管理端帮助
/ai 问题               显式 AI 问答
/id                    获取用户和聊天 ID
/reply 客户ID 内容      管理端备用回复
```

## 六、更新、测试与故障排查

修改配置后先执行：

```sh
npm run sync:config
npm run test:worker
npm run test:gas
npm run build:worker
```

只更新所选平台：

- Worker：`npm run deploy:worker`。
- Apps Script：`npm run push:gas`，然后在“管理部署”中编辑 Web App、创建新版本并重新部署；通常 `/exec` 地址保持不变，无需重设 Webhook。

故障排查：

- **Webhook 401/unauthorized**：确认重新执行了 `webhook:set`，并且平台使用的 `webhookSecret` 与配置一致。
- **机器人不发消息**：检查 Bot Token、部署日志和 Telegram Webhook 信息；私聊客服需先启动 Bot。
- **群收不到**：确认 Bot 已入群，数字 ID 包含负号，公开 `@username` 正确。
- **客服回复无效**：必须回复带 `R.客户ID.消息ID.签名` 的 Bot 消息；其他 Bot 的消息不能使用。
- **AI 失败**：检查 API 地址、Key、模型、HTTPS 知识 URL 和公开访问权限；失败不影响人工分发。
- **Apps Script 修改未生效**：确认上传的是正确 Script ID，并为 Web App 创建了新版本。

本项目不保存客户消息、会话、轮询游标或回复映射。请保护 `config.js`、生成的配置文件及完整 Apps Script Webhook URL。

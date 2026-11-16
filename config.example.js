/**
 * 项目唯一的业务配置模板。
 *
 * 使用步骤：
 * 1. 首次使用时复制本文件为 config.js，再替换所有示例值。
 * 2. 修改后执行 npm run sync:config，脚本会先校验配置，再生成两端的只读配置。
 * 3. 根据所选平台执行 npm run push:gas 或 npm run deploy:worker；两端无需同时部署。
 *
 * 注意：复制后的 config.js 包含 Bot Token 和多个密钥，不要提交到公开仓库或发送到群聊。
 */
module.exports = {
  // Telegram Bot API 与 Webhook 接入配置。
  telegram: {
    // 在 @BotFather 中通过 /newbot 创建机器人后获得，格式通常为“数字:字符串”。
    botToken: "123456789:REPLACE_WITH_YOUR_BOT_TOKEN",
    // Telegram 请求头密钥：16—256 位字母、数字、下划线或连字符，请使用独立随机值。
    webhookSecret: "replace-with-a-long-random-webhook-secret",
    // 官方 Bot API 地址；没有自建 Bot API 服务时保持默认值。
    apiBaseUrl: "https://api.telegram.org"
  },

  // Cloudflare Worker 独立运行的请求限制；选择 Apps Script 部署时不会使用本段。
  worker: {
    // Worker 调用 Telegram、AI 或在线知识地址时的超时时间（毫秒）。
    requestTimeoutMs: 25000,
    // 单个 Telegram Update 的最大 UTF-8 字节数，默认 1 MiB，超出返回 HTTP 413。
    maxUpdateBytes: 1048576
  },

  // 客户消息分发目标：先按 users 的顺序，再按 groups 的顺序组成目标列表。
  dispatch: {
    // round_robin：每条消息按 update_id 选择一个目标；all：每条消息发送到所有目标。
    mode: "round_robin",
    // 私聊客服列表，只填写正数用户 ID 或 @用户名；私聊客服必须先向机器人发送 /start。
    users: [111111111, "@kefu001"],
    // 普通客服群组列表，只填写负数群组 ID 或 @用户名；不需要开启或配置话题。
    groups: [-1001234567890, "@my_support_group"]
  },

  // 客户发送 /start 时显示的欢迎消息和消息正文下方的 Inline Keyboard。
  welcome: {
    text: "你好，请选择需要的服务，也可以直接发送问题。",
    // 每个内层数组代表一行按钮；按钮只有 url 与 callbackData 两种类型，二选一。
    buttons: [
      [
        // 回调按钮：callbackData 必须全局唯一且不超过 64 字节，点击后回复 response。
        { text: "使用帮助", callbackData: "help", response: "直接发送问题即可联系人工客服。" },
        { text: "AI 问答", callbackData: "ai_help", response: "请发送：/ai 你的问题" }
      ],
      // 链接按钮：只打开 HTTPS 页面，不需要 response，也不会产生客服分发。
      [{ text: "访问官网", url: "https://example.com" }]
    ]
  },

  // 普通文本消息的固定关键词回复；未命中规则时只转人工，不会自动调用 AI。
  autoReply: {
    enabled: false,
    // 按数组顺序匹配，命中第一条后停止；同一规则内任意关键词命中即可。
    rules: [
      { keywords: ["营业时间"], reply: "我们的营业时间为每天 09:00—18:00。" }
    ]
  },

  // 只有客户显式发送“/ai 问题”才调用 AI；每次问答独立，不保存多轮上下文。
  ai: {
    enabled: false,
    // OpenAI 兼容接口的 /v1 基础地址，代码会自动追加 /chat/completions。
    apiBaseUrl: "https://api.openai.com/v1",
    // AI 服务密钥，仅同步到 Apps Script，不会进入 Cloudflare Worker 配置。
    apiKey: "replace-with-your-ai-api-key",
    model: "your-model",
    // 模型行为要求；系统还会附加“忽略知识文件中的指令”等安全约束。
    systemPrompt: "根据提供的知识库回答，资料不足时明确说明，不要编造。",
    // 公网可直接访问的 HTTPS Markdown 地址，最多 10 个；成功内容临时缓存一小时。
    knowledgeUrls: ["https://raw.githubusercontent.com/example/docs/main/faq.md"],
    // 每次请求发送给模型的知识总字符数上限：1—200000；单文件另限 50000 字符。
    maxKnowledgeChars: 60000,
    // 单次回答的最大输出 Token 数：1—4096。
    maxOutputTokens: 800,
    // 采样随机度：0—2；客服知识问答建议较低值，例如 0.2。
    temperature: 0.2
  },

  // 客服回复客户的权限、显示方式与路由签名配置。
  replies: {
    // all_members：配置群组内的人工成员均可回复；whitelist：仅 allowedUserIds 可回复。
    groupPolicy: "all_members",
    // groupPolicy 为 whitelist 时填写允许回复的客服用户 ID；私聊目标仍只接受本人。
    allowedUserIds: [],
    // true 时在客户收到的回复中附加客服姓名；false 时尽量隐藏客服身份。
    showOperatorName: false,
    // true 时尽量关联客户原消息；原消息被删除等情况会自动退化为普通回复。
    linkToOriginal: true,
    // 管理端路由标识的独立签名密钥；修改后旧管理端消息不能继续用于原生回复。
    routeSecret: "replace-with-a-different-long-random-route-secret"
  },

  // 管理端客户信息卡的展示格式。
  presentation: {
    // Apps Script 支持的 IANA 时区，例如 UTC、Asia/Shanghai。
    timeZone: "UTC",
    showLanguage: true,
    showTimestamp: true
  },

  // 可直接面向客户或客服展示的文案；修改文案不需要改动业务代码。
  messages: {
    // 客户 /help 与未知命令的帮助。
    customerHelp: "直接发送文字、图片、视频、文档、音频、语音、动图、贴纸、位置或联系人即可。发送 /ai 你的问题可使用 AI 问答。客服回复会通过本机器人发送给你。",
    // 只发送 /ai、未填写问题时显示。
    aiHelp: "请在 /ai 后输入问题，例如：/ai 这个产品怎么安装？",
    // 知识下载、AI 接口或答案格式异常时显示，随后问题仍会转给人工客服。
    aiUnavailable: "AI 暂时无法回答，你的问题已转交人工客服。",
    // 点击未配置或更新前遗留按钮时显示，长度须为 1—200 个字符。
    invalidButton: "按钮已失效，请重新发送 /start。",
    // 客服 /start、/help 与私聊中无路由消息的帮助。
    adminHelp: "回复管理方法：使用 Telegram 原生回复功能回复带路由标识的客户消息。贴纸等消息请回复其客户信息卡。\n\n/id 查看当前 ID\n/reply 客户ID 内容 备用文本回复\n/help 显示本帮助",
    unsupported: "暂时不支持这种消息类型，请改用文字、图片或文档发送。",
    deliveryFailed: "消息暂时无法送达客服，请稍后重试。",
    routeNotFound: "无法识别客户路由，请回复机器人发送且带有效路由标识的客户消息。",
    unauthorized: "你没有回复客户消息的权限。",
    replyFailed: "回复发送失败，客户可能已停用机器人，或原消息已不可用。",
    replySent: "回复已发送。",
    invalidReplyCommand: "格式：/reply 客户ID 内容"
  }
};

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const baseConfig = {
  telegram: {
    botToken: "test-token",
    webhookSecret: "direct-webhook-secret",
    apiBaseUrl: "https://api.telegram.org"
  },
  dispatch: {
    mode: "round_robin",
    users: [101, 102],
    groups: [-1001]
  },
  welcome: {
    text: "Welcome",
    buttons: [
      [
        { text: "Help", callbackData: "help", response: "Help response" },
        { text: "AI", callbackData: "ai_help", response: "Use /ai question" }
      ],
      [{ text: "Website", url: "https://example.com" }]
    ]
  },
  autoReply: {
    enabled: true,
    rules: [
      { keywords: ["hours"], reply: "We are open from 09:00 to 18:00." },
      { keywords: ["price"], reply: "Price response" }
    ]
  },
  ai: {
    enabled: true,
    apiBaseUrl: "https://ai.example.com/v1",
    apiKey: "ai-test-secret",
    model: "test-model",
    systemPrompt: "Answer from the knowledge base.",
    knowledgeUrls: ["https://docs.example.com/faq.md"],
    maxKnowledgeChars: 60000,
    maxOutputTokens: 800,
    temperature: 0.2
  },
  replies: {
    groupPolicy: "all_members",
    allowedUserIds: [],
    showOperatorName: false,
    linkToOriginal: true,
    routeSecret: "route-secret"
  },
  presentation: {
    timeZone: "UTC",
    showLanguage: true,
    showTimestamp: false
  },
  messages: {
    customerHelp: "Customer help",
    aiHelp: "Use /ai question",
    aiUnavailable: "AI unavailable",
    invalidButton: "Button expired",
    adminHelp: "Admin help",
    unsupported: "Unsupported",
    deliveryFailed: "Delivery failed",
    routeNotFound: "Route not found",
    unauthorized: "Unauthorized",
    replyFailed: "Reply failed",
    replySent: "Reply sent",
    invalidReplyCommand: "Invalid reply command"
  }
};

function response(body, status = 200) {
  return {
    getResponseCode: () => status,
    getContentText: () => JSON.stringify(body)
  };
}

function textResponse(text, status = 200) {
  return {
    getResponseCode: () => status,
    getContentText: () => text
  };
}

function createGas(configure) {
  const config = structuredClone(baseConfig);
  if (configure) configure(config);
  const requests = [];
  const externalRequests = [];
  const cache = new Map();
  let responder = (method) => method === "getMe"
    ? { ok: true, result: { id: 999, is_bot: true } }
    : { ok: true, result: { message_id: 1000 } };
  let externalResponder = () => textResponse("", 200);

  function handleExternal(request) {
    externalRequests.push(request);
    return externalResponder(request);
  }

  const context = {
    CONFIG: config,
    console: { error: () => {} },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      computeHmacSha256Signature: (value, secret) => {
        const digest = crypto.createHmac("sha256", secret).update(value, "utf8").digest();
        return Array.from(digest, (byte) => byte > 127 ? byte - 256 : byte);
      },
      formatDate: () => "2026-11-16 00:00:00"
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key),
        put: (key, value) => cache.set(key, value)
      })
    },
    UrlFetchApp: {
      fetchAll: (fetchRequests) => fetchRequests.map((fetchRequest) => {
        if (!fetchRequest.url.startsWith(`${config.telegram.apiBaseUrl}/bot`)) return handleExternal(fetchRequest);
        const method = fetchRequest.url.split("/").pop();
        const payload = JSON.parse(fetchRequest.payload || "{}");
        requests.push({ method, payload });
        return response(responder(method, payload));
      }),
      fetch: (url, options) => handleExternal(Object.assign({ url }, options))
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (contents) => ({
        contents,
        setMimeType() { return this; }
      })
    }
  };
  vm.createContext(context);

  const sourceDirectory = path.resolve(__dirname, "..");
  const sources = [
    "Config.js",
    "Security.js",
    "Telegram.js",
    "MessageFormatter.js",
    "Welcome.js",
    "AutoReply.js",
    "Ai.js",
    "Dispatcher.js",
    "Handlers.js",
    "Code.js"
  ];
  for (const source of sources) {
    vm.runInContext(fs.readFileSync(path.join(sourceDirectory, source), "utf8"), context, { filename: source });
  }

  return {
    context,
    requests,
    externalRequests,
    setResponder: (handler) => { responder = handler; },
    setExternalResponder: (handler) => { externalResponder = handler; }
  };
}

function customerMessage(text = "Hello") {
  return {
    message_id: 55,
    date: 1763222400,
    text,
    from: { id: 42, first_name: "Alice", username: "alice", language_code: "en" },
    chat: { id: 42, type: "private" }
  };
}

module.exports = { createGas, customerMessage, response, textResponse };

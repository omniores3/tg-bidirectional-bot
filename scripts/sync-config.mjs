import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 配置唯一同步入口：读取根目录 config.js → 完整校验 → 生成两套独立部署配置。
 * 两端都包含完整业务实现，因此各自需要 Bot Token、路由密钥和可选 AI 配置；不会互相调用。
 */

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = require(path.join(root, "config.js"));

/** 任一配置不合法立即终止，避免把不完整或危险的配置部署到线上。 */
function assert(condition, message) {
  if (!condition) throw new Error(`config.js: ${message}`);
}

assert(config && typeof config === "object", "configuration must be an object");
assert(config.telegram && typeof config.telegram.botToken === "string", "telegram.botToken is required");
assert(/^[A-Za-z0-9_-]{16,256}$/.test(config.telegram.webhookSecret), "telegram.webhookSecret must contain 16-256 letters, digits, underscores, or hyphens");
assert(Number.isSafeInteger(config.worker?.requestTimeoutMs) && config.worker.requestTimeoutMs > 0, "worker.requestTimeoutMs must be a positive integer");
assert(Number.isSafeInteger(config.worker?.maxUpdateBytes) && config.worker.maxUpdateBytes > 0, "worker.maxUpdateBytes must be a positive integer");
assert(typeof config.replies?.routeSecret === "string" && config.replies.routeSecret.length >= 16, "replies.routeSecret must contain at least 16 characters");
assert(["round_robin", "all"].includes(config.dispatch?.mode), "dispatch.mode must be round_robin or all");
assert(typeof config.presentation?.timeZone === "string" && config.presentation.timeZone.length > 0, "presentation.timeZone is required");
try { new Intl.DateTimeFormat("en-US", { timeZone: config.presentation.timeZone }).format(); } catch { throw new Error("presentation.timeZone must be a valid IANA time zone"); }
assert(Array.isArray(config.dispatch.users), "dispatch.users must be an array");
assert(Array.isArray(config.dispatch.groups), "dispatch.groups must be an array");
assert(["all_members", "whitelist"].includes(config.replies?.groupPolicy), "replies.groupPolicy must be all_members or whitelist");

/** 用户 ID 必须为正数，群组 ID 必须为负数；非数字目标必须是合法 @username。 */
function validateTarget(target, type) {
  assert(["number", "string"].includes(typeof target), `${type} target must be a Telegram ID or @username`);
  const value = String(target).trim();
  if (/^-?\d+$/.test(value)) {
    const id = Number(value);
    assert(Number.isSafeInteger(id), `${type} target ID must be a safe integer: ${value}`);
    assert(type === "user" ? id > 0 : id < 0, `${type} target ID has the wrong sign: ${value}`);
    return;
  }
  assert(/^@[A-Za-z0-9_]{5,32}$/.test(value), `${type} target must be a numeric ID or valid @username: ${value}`);
}

for (const target of config.dispatch.users) validateTarget(target, "user");
for (const target of config.dispatch.groups) validateTarget(target, "group");
assert(Array.isArray(config.replies.allowedUserIds), "replies.allowedUserIds must be an array");
assert(typeof config.messages?.invalidButton === "string" && config.messages.invalidButton.length > 0 && config.messages.invalidButton.length <= 200, "messages.invalidButton must contain 1-200 characters");

/** 欢迎链接、AI 接口和知识文件统一限制 HTTPS，拒绝无效 URL 与明文 HTTP。 */
function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

assert(typeof config.welcome?.text === "string" && config.welcome.text.trim().length > 0 && config.welcome.text.length <= 4096, "welcome.text must contain 1-4096 characters");
assert(Array.isArray(config.welcome.buttons), "welcome.buttons must be an array of button rows");
const callbackData = new Set();
for (const row of config.welcome.buttons) {
  assert(Array.isArray(row), "each welcome button row must be an array");
  for (const button of row) {
    assert(typeof button.text === "string" && button.text.trim().length > 0 && button.text.length <= 64, "welcome button text must contain 1-64 characters");
    const hasUrl = typeof button.url === "string" && button.url.length > 0;
    const hasCallback = typeof button.callbackData === "string" && button.callbackData.length > 0;
    assert(hasUrl !== hasCallback, `welcome button ${button.text} must have either url or callbackData`);
    if (hasUrl) {
      assert(isHttpsUrl(button.url), `welcome button URL must use HTTPS: ${button.url}`);
      continue;
    }
    assert(Buffer.byteLength(button.callbackData, "utf8") <= 64, `welcome callbackData must not exceed 64 bytes: ${button.callbackData}`);
    assert(!callbackData.has(button.callbackData), `duplicate welcome callbackData: ${button.callbackData}`);
    callbackData.add(button.callbackData);
    assert(typeof button.response === "string" && button.response.trim().length > 0, `welcome button response is required: ${button.callbackData}`);
  }
}

assert(typeof config.autoReply?.enabled === "boolean", "autoReply.enabled must be boolean");
assert(Array.isArray(config.autoReply.rules), "autoReply.rules must be an array");
for (const rule of config.autoReply.rules) {
  assert(Array.isArray(rule.keywords) && rule.keywords.length > 0, "autoReply rule keywords must be a non-empty array");
  assert(rule.keywords.every((keyword) => typeof keyword === "string" && keyword.trim().length > 0), "autoReply keywords must be non-empty strings");
  assert(typeof rule.reply === "string" && rule.reply.trim().length > 0, "autoReply rule reply must be a non-empty string");
}

assert(typeof config.ai?.enabled === "boolean", "ai.enabled must be boolean");
assert(isHttpsUrl(config.ai.apiBaseUrl), "ai.apiBaseUrl must use HTTPS");
assert(typeof config.ai.apiKey === "string" && config.ai.apiKey.length > 0, "ai.apiKey is required");
assert(typeof config.ai.model === "string" && config.ai.model.trim().length > 0, "ai.model is required");
assert(typeof config.ai.systemPrompt === "string" && config.ai.systemPrompt.trim().length > 0, "ai.systemPrompt is required");
assert(Array.isArray(config.ai.knowledgeUrls) && config.ai.knowledgeUrls.length <= 10, "ai.knowledgeUrls must contain at most 10 URLs");
assert(config.ai.knowledgeUrls.every(isHttpsUrl), "every AI knowledge URL must use HTTPS");
assert(!config.ai.enabled || config.ai.knowledgeUrls.length > 0, "ai.knowledgeUrls must not be empty when AI is enabled");
assert(Number.isSafeInteger(config.ai.maxKnowledgeChars) && config.ai.maxKnowledgeChars > 0 && config.ai.maxKnowledgeChars <= 200000, "ai.maxKnowledgeChars must be between 1 and 200000");
assert(Number.isSafeInteger(config.ai.maxOutputTokens) && config.ai.maxOutputTokens > 0 && config.ai.maxOutputTokens <= 4096, "ai.maxOutputTokens must be between 1 and 4096");
assert(typeof config.ai.temperature === "number" && config.ai.temperature >= 0 && config.ai.temperature <= 2, "ai.temperature must be between 0 and 2");

// 两套独立运行时代码使用同一份完整业务配置，保证功能与文案一致。
const serialized = JSON.stringify(config, null, 2);

const workerDirectory = path.join(root, "CloudflareWorkers", "src");
const gasDirectory = path.join(root, "GoogleScripts");
await mkdir(workerDirectory, { recursive: true });
await mkdir(gasDirectory, { recursive: true });

// 生成文件每次完整覆盖；部署者只能修改根目录 config.js，不能手改生成文件。
await writeFile(
  path.join(workerDirectory, "config.generated.ts"),
  `// Generated by scripts/sync-config.mjs. Edit the root config.js instead.\nexport const WORKER_CONFIG = ${serialized} as const;\n`,
  "utf8"
);
await writeFile(
  path.join(gasDirectory, "config.generated.js"),
  `// Generated by scripts/sync-config.mjs. Edit the root config.js instead.\nconst CONFIG = ${serialized};\n`,
  "utf8"
);

console.log("Configuration synchronized to CloudflareWorkers and GoogleScripts.");

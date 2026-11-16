import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 为两种独立部署方式设置 Telegram Webhook：
 * - Cloudflare Worker：node scripts/set-webhook.mjs https://your-worker.workers.dev
 * - Apps Script：node scripts/set-webhook.mjs https://script.google.com/macros/s/DEPLOYMENT_ID/exec
 * 两种方式都只读取根目录 config.js，不需要在命令行传入 Token 或密钥。
 */

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = require(path.join(root, "config.js"));
const deploymentUrl = process.argv[2];

if (!deploymentUrl) {
  console.error("Usage: node scripts/set-webhook.mjs https://your-worker.workers.dev");
  console.error("   or: node scripts/set-webhook.mjs https://script.google.com/macros/s/DEPLOYMENT_ID/exec");
  process.exit(1);
}

const target = new URL(deploymentUrl);
if (target.protocol !== "https:") {
  throw new Error("The deployment URL must use HTTPS.");
}

let webhookUrl;
let displayUrl;
if (target.hostname === "script.google.com") {
  if (!/^\/macros\/s\/[^/]+\/exec$/.test(target.pathname)) {
    throw new Error("The Apps Script URL must be a published /exec Web App URL.");
  }
  // Apps Script 无法读取 Secret Token 请求头，所以通过查询参数传递同一密钥。
  target.searchParams.set("secret", config.telegram.webhookSecret);
  webhookUrl = target.toString();
  // 日志不打印查询密钥，避免终端历史或 CI 日志泄露 Webhook 凭据。
  displayUrl = `${target.origin}${target.pathname}?secret=[redacted]`;
} else {
  // Worker 使用固定 /webhook 路由，并通过 Telegram 请求头验证密钥。
  webhookUrl = new URL("/webhook", target).toString();
  displayUrl = webhookUrl;
}

const apiBaseUrl = config.telegram.apiBaseUrl.replace(/\/+$/, "");
const apiUrl = `${apiBaseUrl}/bot${config.telegram.botToken}/setWebhook`;
const response = await fetch(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: config.telegram.webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false
  })
});
const result = await response.json();

// HTTP 状态和 Telegram JSON 中的 ok 字段都必须检查。
if (!response.ok || !result.ok) {
  throw new Error(`Telegram rejected setWebhook: ${result.description || response.status}`);
}

console.log(`Webhook configured: ${displayUrl}`);

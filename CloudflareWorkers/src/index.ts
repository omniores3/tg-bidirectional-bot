import { WORKER_CONFIG } from "./config.generated.ts";
import { routeUpdate } from "./handlers.ts";
import { constantTimeEqual } from "./security.ts";
import { logEvent, sanitizeError } from "./telegram.ts";
import type { TelegramUpdate, WorkerConfig, WorkerEnv } from "./types.ts";

/**
 * Cloudflare Worker 独立 Telegram Webhook。
 * Telegram 直接调用本 Worker，本 Worker 直接调用 Telegram Bot API 和可选 AI API；
 * 不依赖 Google Apps Script，也不存在 Worker → Apps Script 转发步骤。
 */

function jsonResponse(body: Record<string, any>, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

/** 默认使用生成的完整配置，可选环境变量只覆盖四个密钥字段。 */
function getRuntimeConfig(env: WorkerEnv): WorkerConfig {
  const config = WORKER_CONFIG as unknown as WorkerConfig;
  return {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: env.TELEGRAM_BOT_TOKEN || config.telegram.botToken,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || config.telegram.webhookSecret
    },
    replies: {
      ...config.replies,
      routeSecret: env.REPLIES_ROUTE_SECRET || config.replies.routeSecret
    },
    ai: {
      ...config.ai,
      apiKey: env.AI_API_KEY || config.ai.apiKey
    }
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const config = getRuntimeConfig(env);

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "telegram-bidirectional-bot" });
    }
    if (url.pathname !== "/webhook") return jsonResponse({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });

    // Telegram Secret Token 请求头是 Worker 独立部署的 Webhook 身份凭据。
    const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!constantTimeEqual(providedSecret, config.telegram.webhookSecret)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }
    if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
      return jsonResponse({ ok: false, error: "unsupported_media_type" }, 415);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > config.worker.maxUpdateBytes) {
      return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
    }
    const rawUpdate = await request.text();
    if (new TextEncoder().encode(rawUpdate).byteLength > config.worker.maxUpdateBytes) {
      return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
    }

    let update: TelegramUpdate;
    try {
      update = JSON.parse(rawUpdate) as TelegramUpdate;
    } catch {
      return jsonResponse({ ok: false, error: "invalid_update" }, 400);
    }
    if (!update || !Number.isSafeInteger(update.update_id)) {
      return jsonResponse({ ok: false, error: "invalid_update" }, 400);
    }

    try {
      const result = await routeUpdate(config, update);
      return jsonResponse({ ok: true, result });
    } catch (error) {
      // 业务异常返回 500，让 Telegram 稍后重试；解析错误则按不可重试的 400 处理。
      logEvent("update_processing_failed", {
        error: sanitizeError(error, [config.telegram.botToken, config.ai.apiKey, config.replies.routeSecret])
      });
      return jsonResponse({ ok: false, error: "internal_error" }, 500);
    }
  }
} satisfies ExportedHandler<WorkerEnv>;

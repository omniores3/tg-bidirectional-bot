import { splitTextRanges } from "./messages.ts";
import type { TelegramEntity, TelegramRequest, TelegramResult, TelegramTarget, WorkerConfig } from "./types.ts";

/** 给所有外部请求加超时，避免单个慢请求耗尽 Worker 的执行时间。 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** 日志只保留错误类别，不写入 Bot Token、AI Key、消息正文或完整外部地址。 */
export function logEvent(event: string, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ event, ...details }));
}

export function sanitizeError(error: unknown, secrets: string[] = []): string {
  let value = (error instanceof Error ? error.message : String(error)).replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]");
  for (const secret of secrets.filter(Boolean)) value = value.split(secret).join("[redacted]");
  return value.slice(0, 500);
}

/** 调用一次 Telegram Bot API，网络错误也转换为统一结果，便于批量投递隔离失败。 */
export async function telegramRequest(config: WorkerConfig, request: TelegramRequest): Promise<TelegramResult> {
  const baseUrl = config.telegram.apiBaseUrl.replace(/\/+$/, "");
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/bot${config.telegram.botToken}/${request.method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.payload)
      },
      config.worker.requestTimeoutMs
    );
    const result = await response.json() as Record<string, any>;
    if (!response.ok || !result.ok) {
      return {
        ok: false,
        status: response.status,
        description: String(result.description || `Telegram HTTP ${response.status}`)
      };
    }
    return { ok: true, status: response.status, result: result.result };
  } catch (error) {
    return { ok: false, description: sanitizeError(error, [config.telegram.botToken, config.ai.apiKey]) };
  }
}

/** 不同目标的请求并行执行；单个请求失败不会让 Promise.all 整体拒绝。 */
export async function telegramBatch(config: WorkerConfig, requests: TelegramRequest[]): Promise<TelegramResult[]> {
  return Promise.all(requests.map((request) => telegramRequest(config, request)));
}

export interface SendTextOptions {
  entities?: TelegramEntity[];
  replyMarkup?: Record<string, any>;
  replyParameters?: Record<string, any>;
}

/** 发送一段文本，调用方负责按 4096 UTF-16 字符上限切片。 */
export function sendText(
  config: WorkerConfig,
  chatId: TelegramTarget,
  text: string,
  options: SendTextOptions = {}
): Promise<TelegramResult> {
  return telegramRequest(config, {
    method: "sendMessage",
    payload: {
      chat_id: chatId,
      text,
      ...(options.entities ? { entities: options.entities } : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      ...(options.replyParameters ? { reply_parameters: options.replyParameters } : {})
    }
  });
}

/** 顺序发送长文本，只有第一段关联原消息，避免后续片段引用同一个上下文。 */
export async function sendLongText(
  config: WorkerConfig,
  chatId: TelegramTarget,
  text: string,
  replyToMessageId?: number
): Promise<TelegramResult[]> {
  const results: TelegramResult[] = [];
  const ranges = splitTextRanges(String(text));
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    results.push(await sendText(config, chatId, String(text).slice(range.start, range.end), {
      ...(index === 0 && replyToMessageId ? { replyParameters: { message_id: replyToMessageId } } : {})
    }));
  }
  return results;
}

/** 原样复制文本、图片、贴纸等 Telegram 消息，不重新上传媒体文件。 */
export function copyMessage(
  config: WorkerConfig,
  chatId: TelegramTarget,
  fromChatId: TelegramTarget,
  messageId: number,
  replyParameters?: Record<string, any>
): Promise<TelegramResult> {
  return telegramRequest(config, {
    method: "copyMessage",
    payload: {
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...(replyParameters ? { reply_parameters: replyParameters } : {})
    }
  });
}

let cachedBotId: number | null = null;

/** Bot ID 仅在当前 Worker 实例内短期复用，用于拒绝把机器人自己的管理消息当作客服回复。 */
export async function getBotId(config: WorkerConfig): Promise<number> {
  if (cachedBotId !== null) return cachedBotId;
  const result = await telegramRequest(config, { method: "getMe", payload: {} });
  if (!result.ok || typeof result.result?.id !== "number") {
    throw new Error(result.description || "getMe failed");
  }
  const botId = result.result.id as number;
  cachedBotId = botId;
  return botId;
}

/** 测试或同一实例热替换配置时可以清空缓存；部署新 Worker 时实例通常也会重建。 */
export function clearBotIdCache(): void {
  cachedBotId = null;
}

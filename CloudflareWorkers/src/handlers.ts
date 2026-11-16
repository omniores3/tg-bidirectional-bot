import { generateAiReply } from "./ai.ts";
import {
  buildCustomerDeliveryPlan,
  CAPTION_MESSAGE_TYPES,
  getDisplayName,
  getMessageKind,
  sliceAndShiftEntities,
  splitTextRanges
} from "./messages.ts";
import { parseRouteToken } from "./security.ts";
import { getBotId, logEvent, sanitizeError, sendLongText, sendText, telegramBatch, telegramRequest } from "./telegram.ts";
import type {
  AssistantReply,
  DeliveryPlan,
  DispatchTarget,
  ReplyRoute,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramRequest,
  TelegramTarget,
  TelegramUpdate,
  WorkerConfig
} from "./types.ts";

function normalizeTarget(target: TelegramTarget): TelegramTarget {
  if (typeof target !== "string") return target;
  const value = target.trim();
  return /^-?\d+$/.test(value) ? Number(value) : value;
}

/** 用户和群组都直接使用 config.js 中的数字 ID、数字字符串或 @用户名。 */
export function getDispatchTargets(config: WorkerConfig): DispatchTarget[] {
  return [
    ...config.dispatch.users.map((id) => ({ id: normalizeTarget(id), type: "user" as const })),
    ...config.dispatch.groups.map((id) => ({ id: normalizeTarget(id), type: "group" as const }))
  ];
}

/** 数字 ID 直接比较，@用户名不区分大小写；匹配后使用本次 Update 的数字聊天 ID 回复。 */
function getConfiguredTarget(config: WorkerConfig, type: "user" | "group", chat: TelegramChat): DispatchTarget | null {
  const source = type === "user" ? config.dispatch.users : config.dispatch.groups;
  const target = source.find((item) => {
    const id = normalizeTarget(item);
    if (typeof id === "number") return id === Number(chat.id);
    return id.startsWith("@") && id.slice(1).toLowerCase() === String(chat.username || "").toLowerCase();
  });
  return target === undefined ? null : { type, id: Number(chat.id) };
}

export function selectDispatchTargets(config: WorkerConfig, updateId: number): DispatchTarget[] {
  const targets = getDispatchTargets(config);
  if (config.dispatch.mode === "all" || targets.length <= 1) return targets;
  return [targets[Math.abs(Number(updateId)) % targets.length]];
}

function getCommand(text?: string): string | null {
  if (typeof text !== "string" || !text.startsWith("/")) return null;
  return text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
}

function isAuthorizedAdmin(config: WorkerConfig, message: TelegramMessage, target: DispatchTarget): boolean {
  const senderId = Number(message.from?.id);
  if (target.type === "user") {
    return message.chat.type === "private" && Number(message.chat.id) === target.id && senderId === target.id;
  }
  if (Number(message.chat.id) !== target.id) return false;
  return config.replies.groupPolicy !== "whitelist" || config.replies.allowedUserIds.map(Number).includes(senderId);
}

/** 欢迎按钮只生成 Inline Keyboard；无按钮时不发送空 reply_markup。 */
export function sendWelcome(config: WorkerConfig, chatId: TelegramTarget): Promise<any> {
  const rows = config.welcome.buttons.map((row) => row.map((button) => button.url
    ? { text: button.text, url: button.url }
    : { text: button.text, callback_data: button.callbackData }
  ));
  return sendText(config, chatId, config.welcome.text, {
    ...(rows.length ? { replyMarkup: { inline_keyboard: rows } } : {})
  });
}

/** 只接受客户本人私聊中的已配置按钮，所有有效 query 都先 answerCallbackQuery。 */
export async function handleCallbackQuery(config: WorkerConfig, query: TelegramCallbackQuery): Promise<Record<string, any>> {
  if (!query?.id || !query.from || query.from.is_bot) return { ignored: true };
  const chat = query.message?.chat;
  if (!chat || chat.type !== "private" || Number(chat.id) !== Number(query.from.id)) {
    await telegramRequest(config, { method: "answerCallbackQuery", payload: { callback_query_id: query.id } });
    return { ignored: true };
  }

  const button = config.welcome.buttons.flat().find((item) => !item.url && item.callbackData === (query.data || ""));
  if (!button) {
    await telegramRequest(config, {
      method: "answerCallbackQuery",
      payload: { callback_query_id: query.id, text: config.messages.invalidButton }
    });
    return { ok: false, error: "invalid_button" };
  }
  await telegramRequest(config, { method: "answerCallbackQuery", payload: { callback_query_id: query.id } });
  const results = await sendLongText(config, chat.id, button.response || "已收到你的选择。");
  return { ok: results.every((result) => result.ok), action: button.callbackData };
}

/** 固定规则按数组顺序进行子串匹配，英文忽略大小写。 */
export function findAutoReply(config: WorkerConfig, text?: string): string | null {
  if (!config.autoReply.enabled || typeof text !== "string") return null;
  const normalized = text.toLocaleLowerCase();
  const rule = config.autoReply.rules.find((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())));
  return rule?.reply || null;
}

/** 同一目标严格按步骤发送，不同目标的同一步并行；单目标失败不影响其他目标。 */
async function deliverCustomerMessage(
  config: WorkerConfig,
  message: TelegramMessage,
  updateId: number,
  assistantReply?: AssistantReply
): Promise<Record<string, any>> {
  const targets = selectDispatchTargets(config, updateId);
  const plans = (await Promise.all(targets.map((target) => buildCustomerDeliveryPlan(config, message, target, assistantReply))))
    .filter((plan): plan is DeliveryPlan => plan !== null);
  if (!plans.length) return { targetCount: 0, successCount: 0, failures: [] };

  const failed = new Set<number>();
  const failures: Array<Record<string, any>> = [];
  const maximumSteps = Math.max(...plans.map((plan) => plan.steps.length));
  for (let stepIndex = 0; stepIndex < maximumSteps; stepIndex += 1) {
    const active = plans.map((plan, index) => ({ plan, index }))
      .filter(({ plan, index }) => !failed.has(index) && plan.steps[stepIndex]);
    if (!active.length) continue;
    const responses = await telegramBatch(config, active.map(({ plan }) => plan.steps[stepIndex]));
    active.forEach(({ plan, index }, responseIndex) => {
      const result = responses[responseIndex];
      if (result?.ok) return;
      failed.add(index);
      failures.push({ target: plan.target.id, error: result?.description || "No Telegram response" });
    });
  }
  return { targetCount: plans.length, successCount: plans.length - failed.size, failures };
}

async function deliverAndReport(
  config: WorkerConfig,
  message: TelegramMessage,
  updateId: number,
  assistantReply?: AssistantReply
): Promise<Record<string, any>> {
  const result = await deliverCustomerMessage(config, message, updateId, assistantReply);
  if (result.successCount === 0) await sendText(config, message.chat.id, config.messages.deliveryFailed);
  if (result.failures.length) {
    logEvent("customer_delivery_partially_failed", {
      updateId,
      targetCount: result.targetCount,
      successCount: result.successCount
    });
  }
  return result;
}

async function handleCustomerMessage(config: WorkerConfig, message: TelegramMessage, updateId: number): Promise<Record<string, any>> {
  const command = getCommand(message.text);
  if (command === "/start") return sendWelcome(config, message.chat.id);
  if (command === "/ai") return handleAiCustomerMessage(config, message, updateId);
  if (command === "/help" || command) return sendText(config, message.chat.id, config.messages.customerHelp);
  if (!getMessageKind(message)) return sendText(config, message.chat.id, config.messages.unsupported);

  let assistantReply: AssistantReply | undefined;
  const automaticAnswer = findAutoReply(config, message.text);
  if (automaticAnswer) {
    const results = await sendLongText(config, message.chat.id, automaticAnswer);
    const sent = results.length > 0 && results.every((result) => result.ok);
    assistantReply = { kind: "auto", text: automaticAnswer, ...(sent ? {} : { error: "send_failed" }) };
  }
  return deliverAndReport(config, message, updateId, assistantReply);
}

/** 仅显式 /ai 触发模型；成功或失败都发送长文本并继续转人工。 */
async function handleAiCustomerMessage(config: WorkerConfig, message: TelegramMessage, updateId: number): Promise<Record<string, any>> {
  const match = String(message.text || "").match(/^\/ai(?:@\w+)?\s+([\s\S]+)$/i);
  const question = match?.[1].trim();
  if (!question) return sendText(config, message.chat.id, config.messages.aiHelp);

  const result = await generateAiReply(config, question);
  const answer = result.ok ? String(result.text) : config.messages.aiUnavailable;
  const results = await sendLongText(config, message.chat.id, answer);
  const sent = results.length > 0 && results.every((item) => item.ok);
  const assistantReply: AssistantReply = {
    kind: "ai",
    text: answer,
    ...(result.ok && sent ? {} : { error: result.ok ? "send_failed" : result.error || "request_failed" })
  };
  return deliverAndReport(config, message, updateId, assistantReply);
}

/** 默认 copyMessage 隐藏客服来源；显示姓名时保留文本 entities 或媒体 caption。 */
export function buildAdminReplyRequests(config: WorkerConfig, message: TelegramMessage, route: ReplyRoute): TelegramRequest[] {
  const copyRequest: TelegramRequest = {
    method: "copyMessage",
    payload: {
      chat_id: route.userId,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
      ...(config.replies.linkToOriginal ? { reply_parameters: { message_id: route.messageId } } : {})
    }
  };
  if (!config.replies.showOperatorName) return [copyRequest];

  const signature = `${getDisplayName(message.from)}：\n`;
  const kind = getMessageKind(message);
  if (kind === "text") {
    const contentLimit = 4096 - signature.length;
    if (contentLimit <= 0) throw new Error("Operator name exceeds Telegram text limits.");
    return splitTextRanges(message.text || "", contentLimit).map((range, index) => {
      const entities = sliceAndShiftEntities(message.entities, range.start, range.end, signature.length);
      return {
        method: "sendMessage",
        payload: {
          chat_id: route.userId,
          text: signature + String(message.text || "").slice(range.start, range.end),
          ...(entities.length ? { entities } : {}),
          ...(index === 0 && config.replies.linkToOriginal ? { reply_parameters: { message_id: route.messageId } } : {})
        }
      };
    });
  }

  if (kind && CAPTION_MESSAGE_TYPES.includes(kind)) {
    const caption = signature + String(message.caption || "");
    if (caption.length <= 1024) {
      copyRequest.payload.caption = caption;
      const entities = sliceAndShiftEntities(message.caption_entities, 0, String(message.caption || "").length, signature.length);
      if (entities.length) copyRequest.payload.caption_entities = entities;
      return [copyRequest];
    }
  }
  return [
    { method: "sendMessage", payload: { chat_id: route.userId, text: signature.trim() } },
    copyRequest
  ];
}

function isMissingReplyTarget(description?: string): boolean {
  const value = String(description || "").toLowerCase();
  return value.includes("replied message not found") || value.includes("message to be replied not found") ||
    value.includes("reply message not found") || value.includes("message_id_invalid");
}

/** 顺序发送客服回复；客户原消息已删除时移除关联参数重试一次。 */
async function sendAdminReply(config: WorkerConfig, message: TelegramMessage, route: ReplyRoute): Promise<void> {
  for (const request of buildAdminReplyRequests(config, message, route)) {
    let result = await telegramRequest(config, request);
    if (!result.ok && request.payload.reply_parameters && isMissingReplyTarget(result.description)) {
      const fallbackPayload = { ...request.payload };
      delete fallbackPayload.reply_parameters;
      result = await telegramRequest(config, { method: request.method, payload: fallbackPayload });
    }
    if (!result.ok) throw new Error(result.description || "Failed to send admin reply");
  }
}

async function handleNativeAdminReply(config: WorkerConfig, message: TelegramMessage, target: DispatchTarget): Promise<Record<string, any>> {
  const repliedMessage = message.reply_to_message as TelegramMessage;
  const isPrivate = message.chat.type === "private";
  if (!repliedMessage.from?.is_bot) {
    if (isPrivate) await sendText(config, message.chat.id, config.messages.routeNotFound, { replyParameters: { message_id: message.message_id } });
    return { ok: false, error: "not_a_bot_message" };
  }

  const routeMatch = String(repliedMessage.text || repliedMessage.caption || "").match(/R\.\d+\.\d+\.[a-f0-9]{16}/i);
  const route = routeMatch ? await parseRouteToken(config.replies.routeSecret, routeMatch[0]) : null;
  if (!route) {
    await sendText(config, message.chat.id, config.messages.routeNotFound, { replyParameters: { message_id: message.message_id } });
    return { ok: false, error: "route_not_found" };
  }
  if (!isAuthorizedAdmin(config, message, target)) {
    await sendText(config, message.chat.id, config.messages.unauthorized, { replyParameters: { message_id: message.message_id } });
    return { ok: false, error: "unauthorized" };
  }

  try {
    if (Number(repliedMessage.from.id) !== await getBotId(config)) {
      await sendText(config, message.chat.id, config.messages.routeNotFound, { replyParameters: { message_id: message.message_id } });
      return { ok: false, error: "different_bot" };
    }
    await sendAdminReply(config, message, route);
    return { ok: true, customerId: route.userId };
  } catch (error) {
    logEvent("admin_reply_failed", { customerId: route.userId, error: sanitizeError(error, [config.telegram.botToken]) });
    await sendText(config, message.chat.id, config.messages.replyFailed, { replyParameters: { message_id: message.message_id } });
    return { ok: false, error: "delivery_failed" };
  }
}

/** /reply 客户ID 内容 是路由失效时的备用长文本通道。 */
async function handleReplyCommand(config: WorkerConfig, message: TelegramMessage, target: DispatchTarget): Promise<Record<string, any>> {
  if (!isAuthorizedAdmin(config, message, target)) return sendText(config, message.chat.id, config.messages.unauthorized);
  const match = String(message.text || "").match(/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/i);
  const customerId = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(customerId) || customerId <= 0) {
    return sendText(config, message.chat.id, config.messages.invalidReplyCommand, { replyParameters: { message_id: message.message_id } });
  }
  const results = await sendLongText(config, customerId, match[2]);
  const sent = results.length > 0 && results.every((result) => result.ok);
  await sendText(config, message.chat.id, sent ? config.messages.replySent : config.messages.replyFailed, {
    replyParameters: { message_id: message.message_id }
  });
  return { ok: sent, customerId };
}

async function handleAdminMessage(config: WorkerConfig, message: TelegramMessage, target: DispatchTarget): Promise<Record<string, any>> {
  const command = getCommand(message.text);
  if (command === "/start" || command === "/help") {
    return sendText(config, message.chat.id, config.messages.adminHelp, { replyParameters: { message_id: message.message_id } });
  }
  if (command === "/reply") return handleReplyCommand(config, message, target);
  if (command) {
    return sendText(config, message.chat.id, config.messages.adminHelp, { replyParameters: { message_id: message.message_id } });
  }
  if (message.reply_to_message) return handleNativeAdminReply(config, message, target);
  if (message.chat.type === "private") return sendText(config, message.chat.id, config.messages.adminHelp);
  return { ignored: true };
}

/** Worker 独立 Update 路由：不调用 Apps Script，直接在本进程完成全部业务。 */
export async function routeUpdate(config: WorkerConfig, update: TelegramUpdate): Promise<Record<string, any>> {
  if (update.callback_query) return handleCallbackQuery(config, update.callback_query);
  const message = update.message;
  if (!message?.chat || !message.from || message.from.is_bot) return { ignored: true };

  if (getCommand(message.text) === "/id") {
    return sendText(config, message.chat.id, `当前用户 ID：${message.from.id}\n当前聊天 ID：${message.chat.id}\n聊天类型：${message.chat.type}`, {
      replyParameters: { message_id: message.message_id }
    });
  }
  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    const group = getConfiguredTarget(config, "group", message.chat);
    return group ? handleAdminMessage(config, message, group) : { ignored: true };
  }
  if (message.chat.type !== "private") return { ignored: true };
  const configuredUser = getConfiguredTarget(config, "user", message.chat);
  return configuredUser ? handleAdminMessage(config, message, configuredUser) : handleCustomerMessage(config, message, update.update_id);
}

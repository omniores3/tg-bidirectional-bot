import { createRouteToken } from "./security.ts";
import type {
  AssistantReply,
  DeliveryPlan,
  DispatchTarget,
  TelegramEntity,
  TelegramMessage,
  TelegramRequest,
  TelegramUser,
  WorkerConfig
} from "./types.ts";

export const CAPTION_MESSAGE_TYPES = ["photo", "video", "document", "audio", "voice", "animation"];
export const COPY_MESSAGE_TYPES = ["sticker", "location", "venue", "contact", "video_note", "dice", "poll"];

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  text: "文本",
  photo: "图片",
  video: "视频",
  document: "文档",
  audio: "音频",
  voice: "语音",
  animation: "动图",
  sticker: "贴纸",
  location: "位置",
  venue: "地点",
  contact: "联系人",
  video_note: "视频消息",
  dice: "骰子",
  poll: "投票"
};

/** 按 Telegram 实际字段识别可转发类型，未知类型会明确提示客户而不是静默丢弃。 */
export function getMessageKind(message?: TelegramMessage): string | null {
  if (!message) return null;
  if (typeof message.text === "string") return "text";
  return [...CAPTION_MESSAGE_TYPES, ...COPY_MESSAGE_TYPES].find((kind) => Boolean(message[kind])) || null;
}

export function getDisplayName(from?: TelegramUser): string {
  if (!from) return "未知用户";
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return fullName || from.username || String(from.id || "未知用户");
}

/** Telegram 时间戳按配置时区显示，不使用 Worker 数据中心的本地时区。 */
function formatMessageDate(config: WorkerConfig, unixSeconds: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.presentation.timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(unixSeconds * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const timeZone = config.presentation.timeZone || "UTC";
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second} ${timeZone}`;
}

/** 信息头同时包含客户身份、消息类型和签名路由，客服直接回复该消息即可回信。 */
export async function buildCustomerHeader(config: WorkerConfig, message: TelegramMessage): Promise<string> {
  const sender: Partial<TelegramUser> = message.from || {};
  const userId = Number(sender.id || message.chat.id);
  const kind = getMessageKind(message);
  const routeToken = await createRouteToken(config.replies.routeSecret, userId, message.message_id);
  const lines = [
    "客户新消息",
    "",
    `姓名：${getDisplayName(message.from)}`,
    `用户名：${sender.username ? `@${sender.username}` : "未设置"}`,
    `客户 ID：${userId}`
  ];
  if (config.presentation.showLanguage) lines.push(`语言：${sender.language_code || "未知"}`);
  lines.push(`消息类型：${MESSAGE_TYPE_LABELS[String(kind)] || kind}`);
  if (config.presentation.showTimestamp && message.date) lines.push(`发送时间：${formatMessageDate(config, message.date)}`);
  lines.push(`路由标识：${routeToken}`);
  return `${lines.join("\n")}\n\n消息内容：\n`;
}

/** 无法附加 caption 的媒体使用独立信息卡，客服必须回复这张卡来定位客户。 */
async function buildCustomerInfoCard(config: WorkerConfig, message: TelegramMessage): Promise<string> {
  const header = (await buildCustomerHeader(config, message)).replace(/\n\n消息内容：\n$/, "");
  return `${header}\n\n此消息类型不能直接附加路由说明。请回复本信息卡，机器人会将回复发送给对应客户。`;
}

function createCopyRequest(message: TelegramMessage, target: DispatchTarget): TelegramRequest {
  return {
    method: "copyMessage",
    payload: { chat_id: target.id, from_chat_id: message.chat.id, message_id: message.message_id }
  };
}

/** 所有切片都避免拆开 UTF-16 代理对，保证 emoji 与 Telegram entities 偏移有效。 */
export function splitTextRanges(text: string, maximumLength = 4096): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maximumLength, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
    if (end <= start) end = Math.min(start + 1, text.length);
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

/** 截取当前片段内的富文本实体，并计算加入信息头或客服签名后的新偏移。 */
export function sliceAndShiftEntities(
  entities: TelegramEntity[] | undefined,
  start: number,
  end: number,
  shift: number
): TelegramEntity[] {
  return (entities || []).reduce<TelegramEntity[]>((result, entity) => {
    const intersectionStart = Math.max(start, entity.offset);
    const intersectionEnd = Math.min(end, entity.offset + entity.length);
    if (intersectionStart >= intersectionEnd) return result;
    result.push({ ...entity, offset: intersectionStart - start + shift, length: intersectionEnd - intersectionStart });
    return result;
  }, []);
}

function buildTextDeliverySteps(message: TelegramMessage, target: DispatchTarget, header: string): TelegramRequest[] {
  const contentLimit = 4096 - header.length;
  if (contentLimit <= 0) throw new Error("Customer header exceeds Telegram text limits.");
  return splitTextRanges(message.text || "", contentLimit).map((range) => {
    const entities = sliceAndShiftEntities(message.entities, range.start, range.end, header.length);
    return {
      method: "sendMessage",
      payload: {
        chat_id: target.id,
        text: header + String(message.text || "").slice(range.start, range.end),
        ...(entities.length ? { entities } : {})
      }
    };
  });
}

/** 答案副本保留同一客户路由；长答案每段都带完整状态和客户 ID。 */
async function buildAssistantDeliverySteps(
  config: WorkerConfig,
  message: TelegramMessage,
  target: DispatchTarget,
  assistantReply?: AssistantReply
): Promise<TelegramRequest[]> {
  if (!assistantReply?.text) return [];
  const label = assistantReply.error
    ? assistantReply.kind === "ai" ? "AI 回复失败，请人工处理" : "自动回复发送失败"
    : assistantReply.kind === "ai" ? "已发送 AI 回复" : "已发送自动回复";
  const userId = Number(message.from?.id || message.chat.id);
  const routeToken = await createRouteToken(config.replies.routeSecret, userId, message.message_id);
  const header = `${label}\n客户 ID：${userId}\n路由标识：${routeToken}\n\n回复内容：\n`;
  const contentLimit = 4096 - header.length;
  if (contentLimit <= 0) throw new Error("Assistant header exceeds Telegram text limits.");
  return splitTextRanges(assistantReply.text, contentLimit).map((range) => ({
    method: "sendMessage",
    payload: { chat_id: target.id, text: header + assistantReply.text.slice(range.start, range.end) }
  }));
}

/**
 * 文本直接带头发送；短 caption 媒体把路由写进 caption；其他媒体先发信息卡再复制。
 * 自动回复或 AI 答案副本始终追加在原消息之后。
 */
export async function buildCustomerDeliveryPlan(
  config: WorkerConfig,
  message: TelegramMessage,
  target: DispatchTarget,
  assistantReply?: AssistantReply
): Promise<DeliveryPlan | null> {
  const kind = getMessageKind(message);
  if (!kind) return null;
  const header = await buildCustomerHeader(config, message);
  let steps: TelegramRequest[];

  if (kind === "text") {
    steps = buildTextDeliverySteps(message, target, header);
  } else if (CAPTION_MESSAGE_TYPES.includes(kind) && (header + String(message.caption || "")).length <= 1024) {
    const request = createCopyRequest(message, target);
    const originalCaption = String(message.caption || "");
    request.payload.caption = header + originalCaption;
    const entities = sliceAndShiftEntities(message.caption_entities, 0, originalCaption.length, header.length);
    if (entities.length) request.payload.caption_entities = entities;
    steps = [request];
  } else {
    steps = [
      { method: "sendMessage", payload: { chat_id: target.id, text: await buildCustomerInfoCard(config, message) } },
      createCopyRequest(message, target)
    ];
  }

  steps.push(...await buildAssistantDeliverySteps(config, message, target, assistantReply));
  return { target, steps };
}

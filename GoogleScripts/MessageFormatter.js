/** 将 Telegram Update 转换为管理端信息卡、媒体请求、长文本片段和回复路由。 */

// 这些媒体允许携带 caption，可在内容不超长时直接把客户信息写入说明。
const CAPTION_MESSAGE_TYPES_ = ["photo", "video", "document", "audio", "voice", "animation"];
const COPY_MESSAGE_TYPES_ = ["sticker", "location", "venue", "contact", "video_note", "dice", "poll"];

const MESSAGE_TYPE_LABELS_ = {
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

/** 按支持的字段识别消息类型；无法识别的类型由上层提示客户，不会静默转发。 */
function getMessageKind(message) {
  if (!message) return null;
  if (typeof message.text === "string") return "text";
  const kinds = CAPTION_MESSAGE_TYPES_.concat(COPY_MESSAGE_TYPES_);
  return kinds.find((kind) => Boolean(message[kind])) || null;
}

/** Telegram 时间戳单位为秒，按配置的 IANA 时区格式化。 */
function formatMessageDate_(timestamp) {
  if (!CONFIG.presentation.showTimestamp || !timestamp) return null;
  const timeZone = CONFIG.presentation.timeZone || "UTC";
  return `${Utilities.formatDate(new Date(timestamp * 1000), timeZone, "yyyy-MM-dd HH:mm:ss")} ${timeZone}`;
}

/** 生成管理端客户身份与路由头，客服可直接回复包含此头的消息。 */
function buildCustomerHeader_(message) {
  const from = message.from || {};
  const userId = Number(from.id || message.chat.id);
  const kind = getMessageKind(message);
  const routeToken = createRouteToken(userId, message.message_id);
  const lines = [
    "客户新消息",
    "",
    `姓名：${getDisplayName_(from)}`,
    `用户名：${from.username ? `@${from.username}` : "未设置"}`,
    `客户 ID：${userId}`
  ];

  if (CONFIG.presentation.showLanguage) lines.push(`语言：${from.language_code || "未知"}`);
  lines.push(`消息类型：${MESSAGE_TYPE_LABELS_[kind] || kind}`);
  const formattedDate = formatMessageDate_(message.date);
  if (formattedDate) lines.push(`发送时间：${formattedDate}`);
  lines.push(`路由标识：${routeToken}`);
  return `${lines.join("\n")}\n\n消息内容：\n`;
}

/** 贴纸等无法附加路由说明的类型使用独立信息卡，客服必须回复此卡。 */
function buildCustomerInfoCard_(message) {
  const header = buildCustomerHeader_(message).replace(/\n\n消息内容：\n$/, "");
  return `${header}\n\n此消息类型不能直接附加路由说明。请回复本信息卡，机器人会将回复发送给对应客户。`;
}

/** 将当前分发目标写入 Bot API payload，避免各消息构造分支重复赋值。 */
function applyTarget_(payload, target) {
  payload.chat_id = target.id;
  return payload;
}

/** 使用 copyMessage 保留媒体内容且默认不暴露原始发送者信息。 */
function createCopyRequest_(message, target) {
  return {
    method: "copyMessage",
    payload: applyTarget_({
      from_chat_id: message.chat.id,
      message_id: message.message_id
    }, target)
  };
}

/**
 * 计算不拆分 UTF-16 代理对的文本范围。
 * JavaScript 与 Telegram entities 都使用 UTF-16 偏移，因此后续切片可保持一致。
 */
function splitTextRanges_(text, maximumLength) {
  const ranges = [];
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

/** 截取当前文本片段内的富文本实体，并重算加入管理端头部后的偏移与长度。 */
function sliceAndShiftEntities_(entities, start, end, shift) {
  return (entities || []).reduce((result, entity) => {
    const entityStart = entity.offset;
    const entityEnd = entity.offset + entity.length;
    const intersectionStart = Math.max(start, entityStart);
    const intersectionEnd = Math.min(end, entityEnd);
    if (intersectionStart >= intersectionEnd) return result;

    const adjusted = Object.assign({}, entity, {
      offset: intersectionStart - start + shift,
      length: intersectionEnd - intersectionStart
    });
    result.push(adjusted);
    return result;
  }, []);
}

/** 文本消息可能需要多条 sendMessage，每条都重复头部和有效路由。 */
function buildTextDeliverySteps_(message, target, header) {
  const contentLimit = 4096 - header.length;
  if (contentLimit <= 0) throw new Error("Customer header exceeds Telegram text limits.");
  const ranges = splitTextRanges_(message.text, contentLimit);

  return ranges.map((range) => {
    const entities = sliceAndShiftEntities_(message.entities, range.start, range.end, header.length);
    const payload = applyTarget_({
      text: header + message.text.slice(range.start, range.end)
    }, target);
    if (entities.length) payload.entities = entities;
    return { method: "sendMessage", payload };
  });
}

/** 为客服生成自动回复/AI 答案副本，长答案的每一段都包含同一客户路由。 */
function buildAssistantDeliverySteps_(message, target, assistantReply) {
  if (!assistantReply || !assistantReply.text) return [];
  const labels = {
    auto: "已发送自动回复",
    auto_failed: "自动回复发送失败",
    ai: "已发送 AI 回复",
    ai_failed: "AI 回复失败，请人工处理"
  };
  const userId = Number(message.from.id || message.chat.id);
  const routeToken = createRouteToken(userId, message.message_id);
  const header = `${labels[assistantReply.type] || "机器人回复"}\n客户 ID：${userId}\n路由标识：${routeToken}\n\n回复内容：\n`;
  const contentLimit = 4096 - header.length;
  if (contentLimit <= 0) throw new Error("Assistant header exceeds Telegram text limits.");
  return splitTextRanges_(assistantReply.text, contentLimit).map((range) => ({
    method: "sendMessage",
    payload: applyTarget_({ text: header + assistantReply.text.slice(range.start, range.end) }, target)
  }));
}

/** 把答案副本追加在原消息之后，保证客服先看到客户内容，再看到机器人答案。 */
function appendAssistantSteps_(plan, message, target, assistantReply) {
  plan.steps = plan.steps.concat(buildAssistantDeliverySteps_(message, target, assistantReply));
  return plan;
}

/**
 * 为单个目标构造有序请求计划：文本直接带头发送；短说明媒体复制并覆盖 caption；
 * 长说明或无 caption 类型先发信息卡再复制媒体，最后附加自动回复/AI 副本。
 */
function buildCustomerDeliveryPlan(message, target, assistantReply) {
  const kind = getMessageKind(message);
  if (!kind) return null;
  const header = buildCustomerHeader_(message);

  if (kind === "text") {
    const plan = { target, steps: buildTextDeliverySteps_(message, target, header) };
    return appendAssistantSteps_(plan, message, target, assistantReply);
  }

  if (CAPTION_MESSAGE_TYPES_.includes(kind)) {
    const originalCaption = message.caption || "";
    const caption = header + originalCaption;
    if (caption.length <= 1024) {
      const request = createCopyRequest_(message, target);
      request.payload.caption = caption;
      const entities = sliceAndShiftEntities_(message.caption_entities, 0, originalCaption.length, header.length);
      if (entities.length) request.payload.caption_entities = entities;
      return appendAssistantSteps_({ target, steps: [request] }, message, target, assistantReply);
    }
  }

  const infoCard = {
    method: "sendMessage",
    payload: applyTarget_({ text: buildCustomerInfoCard_(message) }, target)
  };
  const plan = { target, steps: [infoCard, createCopyRequest_(message, target)] };
  return appendAssistantSteps_(plan, message, target, assistantReply);
}

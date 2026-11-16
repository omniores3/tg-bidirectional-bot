/**
 * Telegram Update 总路由：按钮回调、客户私聊、客服私聊和配置群组分别处理。
 * 所有管理回复都必须来自 config.js 配置的目标；普通未配置群组直接忽略。
 */
function routeUpdate(update) {
  if (update && update.callback_query) return handleWelcomeCallback_(update.callback_query);
  const message = update && update.message;
  if (!message || !message.chat || !message.from || message.from.is_bot) {
    return { ignored: true };
  }

  if (getMessageCommand_(message.text) === "/id") {
    const text = `当前用户 ID：${message.from.id}\n当前聊天 ID：${message.chat.id}\n聊天类型：${message.chat.type}`;
    return sendText(message.chat.id, text, message.message_id);
  }

  if (message.chat.type === "group" || message.chat.type === "supergroup") {
    const group = getConfiguredTarget("group", message.chat);
    if (!group) return { ignored: true };
    return handleAdminMessage(message, group);
  }

  if (message.chat.type !== "private") return { ignored: true };
  const configuredUser = getConfiguredTarget("user", message.chat);
  if (configuredUser) return handleAdminMessage(message, configuredUser);
  return handleCustomerMessage(message, update.update_id);
}

/** 统一执行客户消息分发、全目标失败提醒和部分失败日志，避免各业务分支重复实现。 */
function deliverAndReport_(message, updateId, assistantReply) {
  const result = deliverCustomerMessage(message, updateId, assistantReply);
  if (result.successCount === 0) {
    sendText(message.chat.id, CONFIG.messages.deliveryFailed);
  }
  if (result.failures.length) {
    logEvent_("customer_delivery_partially_failed", {
      updateId,
      targetCount: result.targetCount,
      successCount: result.successCount
    });
  }
  return result;
}

/**
 * 客户命令优先级：/start → /ai → /help → 未知命令。
 * 普通消息先匹配固定回复；无论是否命中都会转人工，未命中不会自动调用 AI。
 */
function handleCustomerMessage(message, updateId) {
  const command = getMessageCommand_(message.text);
  if (command === "/start") return sendWelcome(message.chat.id);
  if (command === "/ai") return handleAiCustomerMessage_(message, updateId);
  if (command === "/help") return sendText(message.chat.id, CONFIG.messages.customerHelp);
  if (command) return sendText(message.chat.id, CONFIG.messages.customerHelp);

  if (!getMessageKind(message)) {
    return sendText(message.chat.id, CONFIG.messages.unsupported);
  }

  let assistantReply = null;
  const autoReply = findAutoReply_(message.text);
  if (autoReply) {
    const results = sendLongText(message.chat.id, autoReply);
    const sent = results.length > 0 && results.every((result) => result.ok);
    assistantReply = { type: sent ? "auto" : "auto_failed", text: autoReply };
  }
  return deliverAndReport_(message, updateId, assistantReply);
}

/** 私聊目标只允许本人；群组目标按 all_members 或 allowedUserIds 白名单授权。 */
function isAuthorizedAdmin_(message, target) {
  const senderId = Number(message.from.id);
  if (target.type === "user") {
    return message.chat.type === "private" && Number(message.chat.id) === target.id && senderId === target.id;
  }
  if (Number(message.chat.id) !== target.id) return false;
  if (CONFIG.replies.groupPolicy !== "whitelist") return true;
  return (CONFIG.replies.allowedUserIds || []).map(Number).includes(senderId);
}

/** 识别 Telegram 返回的“原消息不存在”错误，用于移除 reply_parameters 后重试。 */
function isMissingReplyTarget_(result) {
  const description = String(result && result.description || "").toLowerCase();
  return description.includes("replied message not found") ||
    description.includes("message to be replied not found") ||
    description.includes("reply message not found") ||
    description.includes("message_id_invalid");
}

/**
 * 构造客服到客户的请求。
 * 默认 copyMessage 隐藏客服来源；显示客服姓名时，文本需要重发并平移 entities，
 * 媒体优先覆盖 caption，无法安全附加说明时则先发姓名再复制原消息。
 */
function buildAdminReplyRequests_(message, route) {
  const copyPayload = {
    chat_id: route.userId,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  };
  if (CONFIG.replies.linkToOriginal) {
    copyPayload.reply_parameters = { message_id: route.messageId };
  }
  const copyRequest = { method: "copyMessage", payload: copyPayload };
  if (!CONFIG.replies.showOperatorName) return [copyRequest];

  const signature = `${getDisplayName_(message.from)}：\n`;
  const kind = getMessageKind(message);
  if (kind === "text") {
    const contentLimit = 4096 - signature.length;
    if (contentLimit <= 0) throw new Error("Operator name exceeds Telegram text limits.");
    return splitTextRanges_(message.text, contentLimit).map((range, index) => {
      const payload = {
        chat_id: route.userId,
        text: signature + message.text.slice(range.start, range.end)
      };
      const entities = sliceAndShiftEntities_(message.entities, range.start, range.end, signature.length);
      if (entities.length) payload.entities = entities;
      if (index === 0 && CONFIG.replies.linkToOriginal) {
        payload.reply_parameters = { message_id: route.messageId };
      }
      return { method: "sendMessage", payload };
    });
  }

  if (CAPTION_MESSAGE_TYPES_.includes(kind)) {
    const caption = signature + (message.caption || "");
    if (caption.length <= 1024) {
      copyRequest.payload.caption = caption;
      const entities = sliceAndShiftEntities_(message.caption_entities, 0, (message.caption || "").length, signature.length);
      if (entities.length) copyRequest.payload.caption_entities = entities;
      return [copyRequest];
    }
  }

  return [
    { method: "sendMessage", payload: { chat_id: route.userId, text: signature.trim() } },
    copyRequest
  ];
}

/** 顺序发送客服回复；原消息已删除时取消关联重试，其余失败向上抛出统一处理。 */
function sendAdminReply_(message, route) {
  const requests = buildAdminReplyRequests_(message, route);
  for (const request of requests) {
    let result = telegramCall(request.method, request.payload);
    if (!result.ok && request.payload.reply_parameters && isMissingReplyTarget_(result)) {
      const fallbackPayload = Object.assign({}, request.payload);
      delete fallbackPayload.reply_parameters;
      result = telegramCall(request.method, fallbackPayload);
    }
    if (!result.ok) throw new Error(result.description || "Failed to send admin reply");
  }
}

/**
 * Telegram 原生回复主流程：验证被回复消息属于 Bot、验证路由签名、验证客服权限和 Bot ID，
 * 全部通过后才向客户发送，防止普通群消息或其他 Bot 消息被当成路由凭据。
 */
function handleNativeAdminReply_(message, target) {
  const repliedMessage = message.reply_to_message;
  const isPrivate = message.chat.type === "private";
  if (!repliedMessage.from || !repliedMessage.from.is_bot) {
    if (isPrivate) sendText(message.chat.id, CONFIG.messages.routeNotFound, message.message_id);
    return { ok: false, error: "not_a_bot_message" };
  }

  const route = parseRouteToken(repliedMessage.text || repliedMessage.caption || "");
  if (!route) {
    sendText(message.chat.id, CONFIG.messages.routeNotFound, message.message_id);
    return { ok: false, error: "route_not_found" };
  }
  if (!isAuthorizedAdmin_(message, target)) {
    sendText(message.chat.id, CONFIG.messages.unauthorized, message.message_id);
    return { ok: false, error: "unauthorized" };
  }

  try {
    if (Number(repliedMessage.from.id) !== getBotId()) {
      sendText(message.chat.id, CONFIG.messages.routeNotFound, message.message_id);
      return { ok: false, error: "different_bot" };
    }
    sendAdminReply_(message, route);
    return { ok: true, customerId: route.userId };
  } catch (error) {
    logEvent_("admin_reply_failed", { customerId: route.userId, error: sanitizeError_(error) });
    sendText(message.chat.id, CONFIG.messages.replyFailed, message.message_id);
    return { ok: false, error: "delivery_failed" };
  }
}

/** /reply 客户ID 内容 备用文本通道，适用于旧路由失效但仍明确知道客户 ID 的场景。 */
function handleReplyCommand_(message, target) {
  if (!isAuthorizedAdmin_(message, target)) {
    return sendText(message.chat.id, CONFIG.messages.unauthorized, message.message_id);
  }
  const match = String(message.text || "").match(/^\/reply(?:@\w+)?\s+(\d+)\s+([\s\S]+)$/i);
  if (!match) {
    return sendText(message.chat.id, CONFIG.messages.invalidReplyCommand, message.message_id);
  }

  const customerId = Number(match[1]);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return sendText(message.chat.id, CONFIG.messages.invalidReplyCommand, message.message_id);
  }

  const result = sendText(customerId, match[2]);
  const notice = result.ok ? CONFIG.messages.replySent : CONFIG.messages.replyFailed;
  sendText(message.chat.id, notice, message.message_id);
  return result;
}

/** 管理命令优先于原生回复；普通群闲聊忽略，客服私聊无路由时返回使用帮助。 */
function handleAdminMessage(message, target) {
  const command = getMessageCommand_(message.text);
  if (command === "/start" || command === "/help") {
    return sendText(message.chat.id, CONFIG.messages.adminHelp, message.message_id);
  }
  if (command === "/reply") return handleReplyCommand_(message, target);
  if (command) {
    return sendText(message.chat.id, CONFIG.messages.adminHelp, message.message_id);
  }

  if (message.reply_to_message) return handleNativeAdminReply_(message, target);

  if (message.chat.type === "private") {
    return sendText(message.chat.id, CONFIG.messages.adminHelp);
  }
  return { ignored: true };
}

/** Telegram Bot API 封装：批量请求、错误脱敏、消息发送与长文本分段。 */

// 单次 Apps Script 执行内缓存 Bot ID，避免每条客服回复都重复调用 getMe。
var BOT_ID_CACHE = null;

/** 写日志前移除 Bot Token 和 AI API Key，防止第三方错误响应把密钥带入平台日志。 */
function sanitizeError_(error) {
  const token = CONFIG.telegram.botToken;
  const aiKey = CONFIG.ai && CONFIG.ai.apiKey;
  let message = String(error && error.message ? error.message : error);
  if (token) message = message.split(token).join("[redacted]");
  if (aiKey) message = message.split(aiKey).join("[redacted]");
  return message;
}

/** 只记录调用方提供的错误元数据，不在这里附加消息正文、Token 或知识内容。 */
function logEvent_(event, details) {
  const entry = Object.assign({ event }, details || {});
  console.error(JSON.stringify(entry));
}

/**
 * 并行调用多个 Telegram Bot API 请求，并保持响应顺序与请求顺序一致。
 * muteHttpExceptions 让 4xx/5xx 也进入统一解析；网络级异常会映射为等长失败结果。
 */
function telegramBatch(requests) {
  if (!requests.length) return [];
  const baseUrl = CONFIG.telegram.apiBaseUrl.replace(/\/+$/, "");
  const fetchRequests = requests.map((request) => ({
    url: `${baseUrl}/bot${CONFIG.telegram.botToken}/${request.method}`,
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(request.payload || {}),
    muteHttpExceptions: true
  }));

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(fetchRequests);
  } catch (error) {
    const description = sanitizeError_(error);
    return requests.map(() => ({ ok: false, description }));
  }

  return responses.map((response) => {
    try {
      const body = JSON.parse(response.getContentText());
      const httpOk = response.getResponseCode() >= 200 && response.getResponseCode() < 300;
      return {
        ok: httpOk && body.ok === true,
        result: body.result,
        description: body.description || (httpOk ? "" : `HTTP ${response.getResponseCode()}`),
        errorCode: body.error_code || response.getResponseCode()
      };
    } catch (error) {
      return { ok: false, description: sanitizeError_(error) };
    }
  });
}

/** 单请求便捷封装；返回 { ok, result, description, errorCode } 结构。 */
function telegramCall(method, payload) {
  return telegramBatch([{ method, payload }])[0];
}

/** 获取当前 Token 对应的 Bot ID，用于确认客服回复的确实是本机器人发出的消息。 */
function getBotId() {
  if (BOT_ID_CACHE !== null) return BOT_ID_CACHE;
  const result = telegramCall("getMe", {});
  if (!result.ok || !result.result || !Number.isSafeInteger(result.result.id)) {
    throw new Error(result.description || "getMe failed");
  }
  BOT_ID_CACHE = result.result.id;
  return BOT_ID_CACHE;
}

/**
 * 发送一条文本。replyToMessageId 与 replyMarkup 均可选；
 * 欢迎按钮通过 replyMarkup 传入 { inline_keyboard: [...] }，不会改变输入框键盘。
 */
function sendText(chatId, text, replyToMessageId, replyMarkup) {
  const payload = { chat_id: chatId, text };
  if (replyToMessageId) payload.reply_parameters = { message_id: replyToMessageId };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return telegramCall("sendMessage", payload);
}

/** 按 Telegram 4096 字符上限分段，仅第一段关联原消息，返回每段独立的发送结果。 */
function sendLongText(chatId, text, replyToMessageId) {
  return splitTextRanges_(String(text), 4096).map((range, index) => {
    return sendText(chatId, String(text).slice(range.start, range.end), index === 0 ? replyToMessageId : null);
  });
}

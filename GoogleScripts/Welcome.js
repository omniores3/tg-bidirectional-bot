/** /start 欢迎消息与 Inline Keyboard 回调处理。 */

/** 将 config.js 的 camelCase 按钮配置转换为 Telegram Bot API 的 inline_keyboard。 */
function buildWelcomeKeyboard_() {
  const rows = (CONFIG.welcome.buttons || []).map((row) => row.map((button) => {
    if (button.url) return { text: button.text, url: button.url };
    return { text: button.text, callback_data: button.callbackData };
  }));
  return rows.length ? { inline_keyboard: rows } : null;
}

/** 发送配置欢迎语；无按钮时 replyMarkup 为 null，不会附带空键盘。 */
function sendWelcome(chatId) {
  return sendText(chatId, CONFIG.welcome.text, null, buildWelcomeKeyboard_());
}

/** 只查找当前配置中的回调按钮，URL 按钮由 Telegram 直接打开，不产生回调。 */
function findWelcomeButton_(callbackData) {
  for (const row of CONFIG.welcome.buttons || []) {
    const button = row.find((item) => !item.url && item.callbackData === callbackData);
    if (button) return button;
  }
  return null;
}

/**
 * 处理按钮点击。
 * 仅接受客户自己的私聊消息，先 answerCallbackQuery 关闭客户端加载状态；
 * 未配置的 callbackData 只提示按钮失效，不进入客户消息分发，避免伪造回调触发业务。
 */
function handleWelcomeCallback_(query) {
  if (!query || !query.id || !query.from || query.from.is_bot) return { ignored: true };
  const chat = query.message && query.message.chat;
  if (!chat || chat.type !== "private" || Number(chat.id) !== Number(query.from.id)) {
    telegramCall("answerCallbackQuery", { callback_query_id: query.id });
    return { ignored: true };
  }

  const button = findWelcomeButton_(query.data || "");
  if (!button) {
    telegramCall("answerCallbackQuery", {
      callback_query_id: query.id,
      text: CONFIG.messages.invalidButton
    });
    return { ok: false, error: "invalid_button" };
  }

  telegramCall("answerCallbackQuery", { callback_query_id: query.id });
  const results = sendLongText(chat.id, button.response);
  return { ok: results.every((result) => result.ok), action: button.callbackData };
}

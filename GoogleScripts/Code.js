/**
 * Google Apps Script 独立 Web App 入口。
 * Telegram 直接请求本文件，不经过 Cloudflare Worker，也不存在 Worker 签名信封。
 */

/** 将普通对象序列化为 Apps Script 可返回的 JSON 响应。 */
function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 浏览器或人工访问 /exec 时用于确认 Web App 已部署，不触发任何消息业务。 */
function doGet() {
  return jsonResponse_({ ok: true, service: "telegram-bidirectional-bot" });
}

/**
 * 接收 Telegram 直接发送的原始 Update。
 * Apps Script 不暴露 HTTP 请求头，因此无法读取 Telegram Secret Token 头；
 * set-webhook 会把同一个 webhookSecret 写入 /exec?secret=...，这里使用常量时间比较校验。
 */
function doPost(event) {
  try {
    const providedSecret = event && event.parameter && event.parameter.secret || "";
    if (!constantTimeEqual_(providedSecret, CONFIG.telegram.webhookSecret)) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
    }
    if (!event || !event.postData || typeof event.postData.contents !== "string") {
      return jsonResponse_({ ok: false, error: "missing_body" });
    }

    let update;
    try {
      update = JSON.parse(event.postData.contents);
    } catch (error) {
      return jsonResponse_({ ok: false, error: "invalid_update" });
    }
    if (!update || !Number.isSafeInteger(update.update_id)) {
      return jsonResponse_({ ok: false, error: "invalid_update" });
    }

    const result = routeUpdate(update);
    return jsonResponse_({ ok: true, result });
  } catch (error) {
    logEvent_("update_processing_failed", { error: sanitizeError_(error) });
    return jsonResponse_({ ok: false, error: "internal_error" });
  }
}

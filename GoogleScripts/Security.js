/**
 * 独立 Apps Script 部署的安全校验：
 * 1. telegram.webhookSecret 通过 /exec?secret=... 验证 Telegram Webhook 入口。
 * 2. replies.routeSecret 验证客服消息里的客户路由，阻止伪造客户 ID 和消息 ID。
 */

/** Apps Script 签名字节可能为负数，转换成无符号字节后再生成两位十六进制。 */
function bytesToHex_(bytes) {
  return bytes
    .map((byte) => {
      const unsigned = byte < 0 ? byte + 256 : byte;
      return unsigned.toString(16).padStart(2, "0");
    })
    .join("");
}

/** 使用 Apps Script Utilities 计算 UTF-8 文本的 HMAC-SHA256 十六进制摘要。 */
function hmacSha256Hex_(secret, value) {
  const bytes = Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

/** 长度相同时逐字符累计差异，避免普通相等比较因提前退出而产生时序侧信道。 */
function constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * 生成 R.客户ID.原消息ID.签名 形式的路由标识。
 * 签名只取前 16 个十六进制字符以缩短消息；三份密钥中路由密钥必须独立保管。
 */
function createRouteToken(userId, messageId) {
  const signature = hmacSha256Hex_(
    CONFIG.replies.routeSecret,
    `route:${userId}:${messageId}`
  ).slice(0, 16);
  return `R.${userId}.${messageId}.${signature}`;
}

/**
 * 从被回复消息的正文或说明中提取路由，并重新计算签名验证。
 * 即使客户或群成员手工写出相同格式，没有 routeSecret 也无法伪造有效路由。
 */
function parseRouteToken(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/\bR\.(\d{1,20})\.(\d{1,20})\.([a-f0-9]{16})\b/i);
  if (!match) return null;

  const userId = Number(match[1]);
  const messageId = Number(match[2]);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(messageId) || messageId <= 0) {
    return null;
  }

  const expected = createRouteToken(userId, messageId).split(".").pop();
  if (!constantTimeEqual_(match[3].toLowerCase(), expected)) return null;
  return { userId, messageId };
}


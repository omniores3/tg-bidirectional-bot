import type { ReplyRoute } from "./types.ts";

/** 使用 Web Crypto 计算 HMAC-SHA256，供 Telegram 密钥和回复路由共用。 */
export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 常量时间比较，避免把秘密值是否匹配转化为可观察的逐字符退出时间。 */
export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index % leftBytes.length] || 0) ^ (rightBytes[index % rightBytes.length] || 0);
  }
  return difference === 0;
}

/**
 * 把客户 ID 和原消息 ID 编码进管理端消息。
 * 截断签名只负责防误改和防伪造，完整 HMAC 仍在每次回复时重新计算。
 */
export async function createRouteToken(secret: string, userId: number, messageId: number): Promise<string> {
  const payload = `${userId}.${messageId}`;
  const signature = await hmacSha256Hex(secret, payload);
  return `R.${payload}.${signature.slice(0, 16)}`;
}

/** 验证管理端回复中的路由；任何 ID、格式或签名变化都会被拒绝。 */
export async function parseRouteToken(secret: string, value: string): Promise<ReplyRoute | null> {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4 || parts[0] !== "R") return null;
  const userId = Number(parts[1]);
  const messageId = Number(parts[2]);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(messageId) || messageId <= 0) {
    return null;
  }

  const expected = (await hmacSha256Hex(secret, `${userId}.${messageId}`)).slice(0, 16);
  return constantTimeEqual(parts[3].toLowerCase(), expected) ? { userId, messageId } : null;
}

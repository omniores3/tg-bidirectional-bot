/**
 * 查找第一条命中的固定回复规则。
 * 这里只计算答案，不直接发送或分发；Handlers.js 会统一把客户原消息和答案副本交给客服。
 */
function findAutoReply_(text) {
  if (!CONFIG.autoReply.enabled || typeof text !== "string") return null;
  // 子串匹配且忽略英文大小写；find/some 保证规则顺序和关键词短路语义。
  const normalizedText = text.toLocaleLowerCase();
  const rule = CONFIG.autoReply.rules.find((item) => item.keywords.some((keyword) => {
    return normalizedText.includes(keyword.toLocaleLowerCase());
  }));
  return rule ? rule.reply : null;
}

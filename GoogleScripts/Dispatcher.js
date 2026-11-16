/** 客户消息的无状态目标选择与批量投递。 */

/**
 * all 模式返回全部目标；round_robin 使用 Telegram update_id 对目标数取模。
 * 不保存游标，因此同一客户的连续消息可能轮到不同客服目标。
 */
function selectDispatchTargets(updateId) {
  const targets = getDispatchTargets();
  if (CONFIG.dispatch.mode === "all" || targets.length <= 1) return targets;
  const index = Math.abs(Number(updateId)) % targets.length;
  return [targets[index]];
}

/**
 * 为每个目标生成独立投递计划，再按步骤批量发送。
 * assistantReply 是已经发送给客户（或发送失败）的自动回复/AI 答案副本。
 * 某目标任一步失败后停止该目标的后续步骤，但不影响其他目标。
 */
function deliverCustomerMessage(message, updateId, assistantReply) {
  const targets = selectDispatchTargets(updateId);
  const plans = targets
    .map((target) => buildCustomerDeliveryPlan(message, target, assistantReply))
    .filter(Boolean);

  if (!plans.length) {
    return { targetCount: 0, successCount: 0, failures: [] };
  }

  const failed = {};
  const failures = [];
  const targetKey = (target) => `${target.type}:${target.id}`;
  const maximumSteps = Math.max(...plans.map((plan) => plan.steps.length));

  // 同一目标的步骤严格按顺序执行；不同目标的同一步通过 fetchAll 并行发送。
  for (let stepIndex = 0; stepIndex < maximumSteps; stepIndex += 1) {
    const active = plans.filter((plan) => !failed[targetKey(plan.target)] && plan.steps[stepIndex]);
    if (!active.length) continue;

    const responses = telegramBatch(active.map((plan) => plan.steps[stepIndex]));
    active.forEach((plan, index) => {
      const result = responses[index];
      if (result && result.ok) return;
      const key = targetKey(plan.target);
      failed[key] = true;
      failures.push({
        target: plan.target.name,
        targetId: plan.target.id,
        error: result ? result.description : "No Telegram response"
      });
    });
  }

  // 只有所有步骤都成功才计为成功，调用方据此决定是否需要提醒客户投递失败。
  const successCount = plans.filter((plan) => !failed[targetKey(plan.target)]).length;
  return { targetCount: plans.length, successCount, failures };
}

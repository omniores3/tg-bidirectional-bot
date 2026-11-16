const test = require("node:test");
const assert = require("node:assert/strict");
const { createGas, customerMessage } = require("./helpers");

function createAdminReply(gas, header, text = "Received") {
  return {
    message_id: 500,
    text,
    from: { id: 777, first_name: "Operator" },
    chat: { id: -1001, type: "supergroup" },
    reply_to_message: {
      message_id: 900,
      text: header,
      from: { id: 999, is_bot: true }
    }
  };
}

test("round robin selects users and groups without state", () => {
  const { context } = createGas();
  assert.equal(context.selectDispatchTargets(0)[0].id, 101);
  assert.equal(context.selectDispatchTargets(1)[0].id, 102);
  assert.equal(context.selectDispatchTargets(2)[0].id, -1001);
  assert.equal(context.selectDispatchTargets(3)[0].id, 101);
});

test("all mode returns every configured target", () => {
  const { context } = createGas((config) => {
    config.dispatch.mode = "all";
    config.dispatch.users = [101];
  });
  const targets = context.selectDispatchTargets(10);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].id, 101);
  assert.equal(targets[1].id, -1001);
});

test("plain ID and username lists dispatch directly", () => {
  const { context, requests } = createGas((config) => {
    config.dispatch.mode = "all";
    config.dispatch.users = [101, "@Agent_A"];
    config.dispatch.groups = ["@Support_Group"];
  });
  const result = context.routeUpdate({ update_id: 9, message: customerMessage() });
  assert.equal(result.successCount, 3);
  assert.deepEqual(requests.map((request) => request.payload.chat_id), [101, "@Agent_A", "@Support_Group"]);
});

test("a group configured by username recognizes admin replies", () => {
  const { context, requests } = createGas((config) => {
    config.dispatch.groups = ["@Support_Group"];
  });
  const header = context.buildCustomerHeader_(customerMessage());
  const adminReply = createAdminReply({ context }, header);
  adminReply.chat.username = "Support_Group";
  const result = context.routeUpdate({ update_id: 20, message: adminReply });
  assert.equal(result.ok, true);
  assert.equal(requests[1].payload.chat_id, 42);
});

test("route tokens cannot be forged or altered", () => {
  const { context } = createGas();
  const token = context.createRouteToken(42, 55);
  assert.deepEqual({ ...context.parseRouteToken(token) }, { userId: 42, messageId: 55 });
  assert.equal(context.parseRouteToken(token.replace("R.42.", "R.43.")), null);
  assert.equal(context.parseRouteToken("R.42.55.0000000000000000"), null);
});

test("doPost verifies the query secret and handles raw Telegram updates directly", () => {
  const { context, requests } = createGas();
  const rawUpdate = JSON.stringify({ update_id: 1, message: customerMessage("/help") });
  const rejected = context.doPost({ parameter: { secret: "wrong" }, postData: { contents: rawUpdate } });
  assert.equal(JSON.parse(rejected.contents).error, "unauthorized");
  assert.equal(requests.length, 0);

  const accepted = context.doPost({
    parameter: { secret: "direct-webhook-secret" },
    postData: { contents: rawUpdate }
  });
  assert.equal(JSON.parse(accepted.contents).ok, true);
  assert.equal(requests[0].payload.text, "Customer help");

  const malformed = context.doPost({ parameter: { secret: "direct-webhook-secret" }, postData: { contents: "not-json" } });
  assert.equal(JSON.parse(malformed.contents).error, "invalid_update");
});

test("customer text includes identity, content and shifted entities", () => {
  const { context } = createGas();
  const message = customerMessage("hello");
  message.entities = [{ type: "bold", offset: 0, length: 5 }];
  const target = context.getDispatchTargets()[0];
  const plan = context.buildCustomerDeliveryPlan(message, target);
  const payload = plan.steps[0].payload;
  assert.equal(plan.steps[0].method, "sendMessage");
  assert.equal(payload.chat_id, 101);
  assert.match(payload.text, /Alice/);
  assert.match(payload.text, /42/);
  assert.match(payload.text, /hello$/);
  assert.match(payload.text, /R\.42\.55\.[a-f0-9]{16}/);
  assert.equal(payload.entities[0].offset, payload.text.length - 5);
});

test("all mode fans out one text update to every target", () => {
  const { context, requests } = createGas((config) => { config.dispatch.mode = "all"; });
  const result = context.routeUpdate({ update_id: 9, message: customerMessage() });
  assert.equal(result.successCount, 3);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.payload.chat_id), [101, 102, -1001]);
});

test("round robin delivers only one copy", () => {
  const { context, requests } = createGas();
  const result = context.routeUpdate({ update_id: 1, message: customerMessage() });
  assert.equal(result.successCount, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.chat_id, 102);
});

test("stickers use a routable information card before the content", () => {
  const { context, requests } = createGas();
  const message = customerMessage();
  delete message.text;
  message.sticker = { file_id: "sticker" };
  context.routeUpdate({ update_id: 0, message });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "sendMessage");
  assert.match(requests[0].payload.text, /R\.42\.55/);
  assert.equal(requests[1].method, "copyMessage");
});

test("native group replies route to the customer and original message", () => {
  const { context, requests } = createGas();
  const target = context.getDispatchTargets()[0];
  const header = context.buildCustomerHeader_(customerMessage());
  const adminReply = createAdminReply({ context }, header);
  const result = context.routeUpdate({ update_id: 20, message: adminReply });
  assert.equal(result.ok, true);
  assert.equal(requests[0].method, "getMe");
  assert.equal(requests[1].method, "copyMessage");
  assert.equal(requests[1].payload.chat_id, 42);
  assert.equal(requests[1].payload.from_chat_id, -1001);
  assert.equal(requests[1].payload.message_id, 500);
  assert.equal(requests[1].payload.reply_parameters.message_id, 55);
  assert.equal(target.id, 101);
});

test("whitelist rejects an unauthorized group member", () => {
  const { context, requests } = createGas((config) => {
    config.replies.groupPolicy = "whitelist";
    config.replies.allowedUserIds = [888];
  });
  const header = context.buildCustomerHeader_(customerMessage());
  const result = context.routeUpdate({ update_id: 20, message: createAdminReply({ context }, header) });
  assert.equal(result.error, "unauthorized");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "sendMessage");
  assert.equal(requests[0].payload.text, "Unauthorized");
});

test("ordinary group messages are ignored", () => {
  const { context, requests } = createGas();
  const message = createAdminReply({ context }, "not a route");
  delete message.reply_to_message;
  const result = context.routeUpdate({ update_id: 20, message });
  assert.equal(result.ignored, true);
  assert.equal(requests.length, 0);
});

test("long text is split with a valid route in every chunk", () => {
  const { context } = createGas();
  const message = customerMessage("x".repeat(9000));
  const plan = context.buildCustomerDeliveryPlan(message, context.getDispatchTargets()[0]);
  assert.equal(plan.steps.length, 3);
  for (const step of plan.steps) {
    assert.ok(step.payload.text.length <= 4096);
    assert.match(step.payload.text, /R\.42\.55\.[a-f0-9]{16}/);
  }
  const combined = plan.steps.map((step) => step.payload.text.split("消息内容：\n")[1]).join("");
  assert.equal(combined.length, 9000);
});

test("operator signatures preserve long reply limits", () => {
  const { context } = createGas((config) => { config.replies.showOperatorName = true; });
  const message = createAdminReply({ context }, "unused", "y".repeat(9000));
  const requests = context.buildAdminReplyRequests_(message, { userId: 42, messageId: 55 });
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.method, "sendMessage");
    assert.ok(request.payload.text.length <= 4096);
    assert.match(request.payload.text, /^Operator/);
  }
});

test("id command works before a group is configured", () => {
  const { context, requests } = createGas();
  const message = {
    message_id: 77,
    text: "/id",
    from: { id: 777, first_name: "Operator" },
    chat: { id: -2002, type: "supergroup" }
  };
  context.routeUpdate({ update_id: 21, message });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.chat_id, -2002);
  assert.match(requests[0].payload.text, /-2002/);
});

test("reply command provides a stateless text fallback", () => {
  const { context, requests } = createGas();
  const message = {
    message_id: 501,
    text: "/reply 42 fallback response",
    from: { id: 777, first_name: "Operator" },
    chat: { id: -1001, type: "supergroup" }
  };
  context.routeUpdate({ update_id: 21, message });
  assert.equal(requests[0].payload.chat_id, 42);
  assert.equal(requests[0].payload.text, "fallback response");
  assert.equal(requests[1].payload.text, "Reply sent");
});

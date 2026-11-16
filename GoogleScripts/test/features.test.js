const test = require("node:test");
const assert = require("node:assert/strict");
const { createGas, customerMessage, response, textResponse } = require("./helpers");

function welcomeCallback(data = "help") {
  return {
    id: "callback-1",
    data,
    from: { id: 42, first_name: "Alice" },
    message: { chat: { id: 42, type: "private" } }
  };
}

test("start sends configured text and inline keyboard buttons", () => {
  const { context, requests } = createGas();
  context.routeUpdate({ update_id: 1, message: customerMessage("/start") });
  assert.equal(requests.length, 1);
  const payload = requests[0].payload;
  assert.equal(payload.text, "Welcome");
  assert.equal(payload.reply_markup.inline_keyboard[0][0].callback_data, "help");
  assert.equal(payload.reply_markup.inline_keyboard[1][0].url, "https://example.com");
  assert.equal(payload.reply_markup.keyboard, undefined);
});

test("welcome callback answers the query and sends its configured response", () => {
  const { context, requests } = createGas();
  const result = context.routeUpdate({ update_id: 2, callback_query: welcomeCallback() });
  assert.equal(result.ok, true);
  assert.equal(requests[0].method, "answerCallbackQuery");
  assert.equal(requests[0].payload.callback_query_id, "callback-1");
  assert.equal(requests[1].method, "sendMessage");
  assert.equal(requests[1].payload.chat_id, 42);
  assert.equal(requests[1].payload.text, "Help response");
});

test("unknown welcome callbacks do not dispatch a customer message", () => {
  const { context, requests } = createGas();
  const result = context.routeUpdate({ update_id: 3, callback_query: welcomeCallback("forged") });
  assert.equal(result.error, "invalid_button");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "answerCallbackQuery");
  assert.equal(requests[0].payload.text, "Button expired");
});

test("keyword auto replies reach the customer and are visible to agents", () => {
  const { context, requests } = createGas();
  const result = context.routeUpdate({ update_id: 0, message: customerMessage("What are your HOURS?") });
  assert.equal(result.successCount, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].payload.chat_id, 42);
  assert.match(requests[0].payload.text, /09:00/);
  assert.equal(requests[1].payload.chat_id, 101);
  assert.match(requests[1].payload.text, /What are your HOURS/);
  assert.equal(requests[2].payload.chat_id, 101);
  assert.match(requests[2].payload.text, /已发送自动回复/);
  assert.match(requests[2].payload.text, /R\.42\.55\.[a-f0-9]{16}/);
});

test("auto reply rules use configuration order", () => {
  const { context, requests } = createGas((config) => {
    config.autoReply.rules = [
      { keywords: ["hello"], reply: "First rule" },
      { keywords: ["hello"], reply: "Second rule" }
    ];
  });
  context.routeUpdate({ update_id: 0, message: customerMessage("hello") });
  assert.equal(requests[0].payload.text, "First rule");
});

test("AI replies include online Markdown and are forwarded to agents", () => {
  const { context, requests, externalRequests, setExternalResponder } = createGas();
  setExternalResponder((request) => {
    if (request.method === "get") return textResponse("# FAQ\nInstall with the setup command.");
    assert.equal(request.headers.Authorization, "Bearer ai-test-secret");
    const payload = JSON.parse(request.payload);
    assert.equal(payload.model, "test-model");
    assert.match(payload.messages[1].content, /Install with the setup command/);
    assert.match(payload.messages[1].content, /How do I install/);
    return response({ choices: [{ message: { content: "Use the setup command." } }] });
  });
  const result = context.routeUpdate({ update_id: 0, message: customerMessage("/ai How do I install?") });
  assert.equal(result.successCount, 1);
  assert.equal(externalRequests.length, 2);
  assert.equal(externalRequests[0].followRedirects, false);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].payload.chat_id, 42);
  assert.equal(requests[0].payload.text, "Use the setup command.");
  assert.equal(requests[2].payload.chat_id, 101);
  assert.match(requests[2].payload.text, /已发送 AI 回复/);
  assert.match(requests[2].payload.text, /Use the setup command/);
});

test("Markdown knowledge is cached for subsequent AI questions", () => {
  const { context, externalRequests, setExternalResponder } = createGas();
  setExternalResponder((request) => {
    if (request.method === "get") return textResponse("# Cached FAQ");
    return response({ choices: [{ message: { content: "Cached answer" } }] });
  });
  context.routeUpdate({ update_id: 0, message: customerMessage("/ai First question") });
  context.routeUpdate({ update_id: 0, message: customerMessage("/ai Second question") });
  assert.equal(externalRequests.filter((request) => request.method === "get").length, 1);
  assert.equal(externalRequests.filter((request) => request.method === "post").length, 2);
});

test("AI and knowledge failures fall back to human delivery", () => {
  const { context, requests, setExternalResponder } = createGas();
  setExternalResponder(() => textResponse("Unavailable", 503));
  const result = context.routeUpdate({ update_id: 0, message: customerMessage("/ai Need help") });
  assert.equal(result.successCount, 1);
  assert.equal(requests[0].payload.chat_id, 42);
  assert.equal(requests[0].payload.text, "AI unavailable");
  assert.equal(requests[2].payload.chat_id, 101);
  assert.match(requests[2].payload.text, /AI 回复失败/);
});

test("AI command without a question only returns usage instructions", () => {
  const { context, requests, externalRequests } = createGas();
  context.routeUpdate({ update_id: 0, message: customerMessage("/ai") });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.text, "Use /ai question");
  assert.equal(externalRequests.length, 0);
});

test("long automatic answers are split with routable agent copies", () => {
  const { context, requests } = createGas((config) => {
    config.autoReply.rules = [{ keywords: ["long"], reply: "x".repeat(9000) }];
  });
  context.routeUpdate({ update_id: 0, message: customerMessage("long") });
  assert.ok(requests.every((request) => request.payload.text.length <= 4096));
  const agentAnswers = requests.filter((request) => request.payload.chat_id === 101 && request.payload.text.includes("回复内容："));
  assert.equal(agentAnswers.length, 3);
  for (const request of agentAnswers) assert.match(request.payload.text, /R\.42\.55\.[a-f0-9]{16}/);
});

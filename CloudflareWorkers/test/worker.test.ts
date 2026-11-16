import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { WORKER_CONFIG } from "../src/config.generated.ts";
import { clearKnowledgeCache } from "../src/ai.ts";
import { buildCustomerDeliveryPlan, buildCustomerHeader } from "../src/messages.ts";
import { buildAdminReplyRequests, getDispatchTargets, routeUpdate, selectDispatchTargets } from "../src/handlers.ts";
import { createRouteToken, parseRouteToken } from "../src/security.ts";
import { clearBotIdCache } from "../src/telegram.ts";
import type { TelegramMessage, TelegramRequest, WorkerConfig, WorkerEnv } from "../src/types.ts";

const env: WorkerEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "telegram-test-secret"
};

function testConfig(): WorkerConfig {
  const config = structuredClone(WORKER_CONFIG) as unknown as WorkerConfig;
  config.telegram = { botToken: "test-token", webhookSecret: "telegram-test-secret", apiBaseUrl: "https://api.telegram.org" };
  config.worker = { requestTimeoutMs: 1000, maxUpdateBytes: 1048576 };
  config.dispatch = { mode: "round_robin", users: [101, 102], groups: [-1001] };
  config.welcome = {
    text: "Welcome",
    buttons: [
      [{ text: "Help", callbackData: "help", response: "Help response" }],
      [{ text: "Website", url: "https://example.com" }]
    ]
  };
  config.autoReply = { enabled: true, rules: [{ keywords: ["hours"], reply: "We are open from 09:00 to 18:00." }] };
  config.ai = {
    enabled: true,
    apiBaseUrl: "https://ai.example.com/v1",
    apiKey: "ai-test-secret",
    model: "test-model",
    systemPrompt: "Answer from the knowledge base.",
    knowledgeUrls: ["https://docs.example.com/faq.md"],
    maxKnowledgeChars: 60000,
    maxOutputTokens: 800,
    temperature: 0.2
  };
  config.replies = {
    groupPolicy: "all_members",
    allowedUserIds: [],
    showOperatorName: false,
    linkToOriginal: true,
    routeSecret: "route-secret"
  };
  config.presentation = { timeZone: "UTC", showLanguage: true, showTimestamp: false };
  config.messages = {
    customerHelp: "Customer help",
    aiHelp: "Use /ai question",
    aiUnavailable: "AI unavailable",
    invalidButton: "Button expired",
    adminHelp: "Admin help",
    unsupported: "Unsupported",
    deliveryFailed: "Delivery failed",
    routeNotFound: "Route not found",
    unauthorized: "Unauthorized",
    replyFailed: "Reply failed",
    replySent: "Reply sent",
    invalidReplyCommand: "Invalid reply command"
  };
  return config;
}

function customerMessage(text = "Hello"): TelegramMessage {
  return {
    message_id: 55,
    date: 1763222400,
    text,
    from: { id: 42, first_name: "Alice", username: "alice", language_code: "en" },
    chat: { id: 42, type: "private" }
  };
}

function adminReply(header: string, text = "Received"): TelegramMessage {
  return {
    message_id: 500,
    text,
    from: { id: 777, first_name: "Operator" },
    chat: { id: -1001, type: "supergroup" },
    reply_to_message: {
      message_id: 900,
      text: header,
      from: { id: 999, is_bot: true },
      chat: { id: -1001, type: "supergroup" }
    }
  };
}

function webhookRequest(body: string, secret = "telegram-test-secret") {
  return new Request("https://worker.example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret
    },
    body
  });
}

type ExternalHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
type TelegramHandler = (method: string, payload: Record<string, any>) => Response | undefined | Promise<Response | undefined>;

function installFetch(externalHandler?: ExternalHandler, telegramHandler?: TelegramHandler) {
  const telegramRequests: Array<TelegramRequest & { url: string }> = [];
  const externalRequests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/bot")) {
      const method = url.split("/").pop() || "";
      const payload = JSON.parse(String(init?.body || "{}"));
      telegramRequests.push({ url, method, payload });
      const customResponse = telegramHandler ? await telegramHandler(method, payload) : undefined;
      if (customResponse) return customResponse;
      const result = method === "getMe" ? { id: 999, is_bot: true } : { message_id: 1000 };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    }
    externalRequests.push({ url, init });
    return externalHandler ? externalHandler(url, init) : new Response("Unavailable", { status: 503 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { telegramRequests, externalRequests, fetchMock };
}

beforeEach(() => {
  clearKnowledgeCache();
  clearBotIdCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("standalone Cloudflare Worker webhook", () => {
  it("provides a public health check", async () => {
    const response = await worker.fetch(new Request("https://worker.example.com/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "telegram-bidirectional-bot" });
  });

  it("rejects an invalid Telegram webhook secret", async () => {
    const response = await worker.fetch(webhookRequest('{"update_id":1}', "wrong"), env);
    expect(response.status).toBe(401);
  });

  it("rejects malformed updates and non-JSON requests", async () => {
    expect((await worker.fetch(webhookRequest("not-json"), env)).status).toBe(400);
    const request = new Request("https://worker.example.com/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "telegram-test-secret" },
      body: "{}"
    });
    expect((await worker.fetch(request, env)).status).toBe(415);
  });

  it("only accepts POST on the webhook route", async () => {
    const response = await worker.fetch(new Request("https://worker.example.com/webhook"), env);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("handles /start itself and calls Telegram directly without Apps Script", async () => {
    const { telegramRequests, fetchMock } = installFetch();
    const rawUpdate = JSON.stringify({ update_id: 1, message: customerMessage("/start") });
    const response = await worker.fetch(webhookRequest(rawUpdate), env);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(telegramRequests[0].url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(telegramRequests[0].payload.reply_markup.inline_keyboard).toBeDefined();
    expect(telegramRequests[0].payload.reply_markup.keyboard).toBeUndefined();
  });
});

describe("standalone Worker business", () => {
  it("selects round-robin and all targets without storage", () => {
    const config = testConfig();
    expect(selectDispatchTargets(config, 0)[0].id).toBe(101);
    expect(selectDispatchTargets(config, 1)[0].id).toBe(102);
    expect(selectDispatchTargets(config, 2)[0].id).toBe(-1001);
    config.dispatch.mode = "all";
    expect(selectDispatchTargets(config, 10).map((target) => target.id)).toEqual([101, 102, -1001]);
  });

  it("dispatches plain IDs and @usernames directly", async () => {
    const config = testConfig();
    config.dispatch = { mode: "all", users: [101, "@Agent_A"], groups: ["@Support_Group"] };
    const { telegramRequests } = installFetch();
    const result = await routeUpdate(config, { update_id: 9, message: customerMessage() });
    expect(result.successCount).toBe(3);
    expect(telegramRequests.map((request) => request.payload.chat_id)).toEqual([101, "@Agent_A", "@Support_Group"]);
  });

  it("rejects forged or altered reply routes", async () => {
    const token = await createRouteToken("route-secret", 42, 55);
    expect(await parseRouteToken("route-secret", token)).toEqual({ userId: 42, messageId: 55 });
    expect(await parseRouteToken("route-secret", token.replace("R.42.", "R.43."))).toBeNull();
    expect(await parseRouteToken("route-secret", "R.42.55.0000000000000000")).toBeNull();
  });

  it("sends configured inline buttons and answers callbacks", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    await routeUpdate(config, { update_id: 1, message: customerMessage("/start") });
    expect(telegramRequests[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe("help");

    await routeUpdate(config, {
      update_id: 2,
      callback_query: {
        id: "callback-1",
        data: "help",
        from: { id: 42, first_name: "Alice" },
        message: { message_id: 80, chat: { id: 42, type: "private" } }
      }
    });
    expect(telegramRequests[1].method).toBe("answerCallbackQuery");
    expect(telegramRequests[2].payload.text).toBe("Help response");
  });

  it("sends keyword answers to the customer and routable copies to agents", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    const result = await routeUpdate(config, { update_id: 0, message: customerMessage("What are your HOURS?") });
    expect(result.successCount).toBe(1);
    expect(telegramRequests).toHaveLength(3);
    expect(telegramRequests[0].payload.chat_id).toBe(42);
    expect(telegramRequests[0].payload.text).toContain("09:00");
    expect(telegramRequests[2].payload.text).toContain("已发送自动回复");
    expect(telegramRequests[2].payload.text).toMatch(/R\.42\.55\.[a-f0-9]{16}/);
  });

  it("does not call AI for an ordinary unmatched message", async () => {
    const config = testConfig();
    const { telegramRequests, externalRequests } = installFetch();
    await routeUpdate(config, { update_id: 0, message: customerMessage("No matching rule") });
    expect(telegramRequests).toHaveLength(1);
    expect(externalRequests).toHaveLength(0);
  });

  it("uses online Markdown for explicit /ai and forwards the answer", async () => {
    const config = testConfig();
    const { telegramRequests, externalRequests } = installFetch((url, init) => {
      if (url === "https://docs.example.com/faq.md") return new Response("# FAQ\nInstall with the setup command.");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer ai-test-secret" });
      const payload = JSON.parse(String(init?.body));
      expect(payload.messages[1].content).toContain("Install with the setup command");
      expect(payload.messages[1].content).toContain("How do I install?");
      return new Response(JSON.stringify({ choices: [{ message: { content: "Use the setup command." } }] }));
    });
    const result = await routeUpdate(config, { update_id: 0, message: customerMessage("/ai How do I install?") });
    expect(result.successCount).toBe(1);
    expect(externalRequests).toHaveLength(2);
    expect(externalRequests[0].init?.redirect).toBe("manual");
    expect(telegramRequests[0].payload.text).toBe("Use the setup command.");
    expect(telegramRequests[2].payload.text).toContain("已发送 AI 回复");
  });

  it("caches Markdown for one hour within the current Worker instance", async () => {
    const config = testConfig();
    const { externalRequests } = installFetch((url) => url.includes("docs.example.com")
      ? new Response("# Cached FAQ")
      : new Response(JSON.stringify({ choices: [{ message: { content: "Cached answer" } }] })));
    await routeUpdate(config, { update_id: 0, message: customerMessage("/ai First question") });
    await routeUpdate(config, { update_id: 0, message: customerMessage("/ai Second question") });
    expect(externalRequests.filter((request) => request.url.includes("docs.example.com"))).toHaveLength(1);
    expect(externalRequests.filter((request) => request.url.includes("chat/completions"))).toHaveLength(2);
  });

  it("falls back to human delivery when AI or knowledge fails", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    const result = await routeUpdate(config, { update_id: 0, message: customerMessage("/ai Need help") });
    expect(result.successCount).toBe(1);
    expect(telegramRequests[0].payload.text).toBe("AI unavailable");
    expect(telegramRequests[2].payload.text).toContain("AI 回复失败");
  });

  it("routes native group replies to the customer and original message", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    const header = await buildCustomerHeader(config, customerMessage());
    const result = await routeUpdate(config, { update_id: 20, message: adminReply(header) });
    expect(result.ok).toBe(true);
    expect(telegramRequests[0].method).toBe("getMe");
    expect(telegramRequests[1].method).toBe("copyMessage");
    expect(telegramRequests[1].payload.chat_id).toBe(42);
    expect(telegramRequests[1].payload.reply_parameters.message_id).toBe(55);
  });

  it("enforces the optional group reply whitelist", async () => {
    const config = testConfig();
    config.replies.groupPolicy = "whitelist";
    config.replies.allowedUserIds = [888];
    const { telegramRequests } = installFetch();
    const header = await buildCustomerHeader(config, customerMessage());
    const result = await routeUpdate(config, { update_id: 20, message: adminReply(header) });
    expect(result.error).toBe("unauthorized");
    expect(telegramRequests).toHaveLength(1);
    expect(telegramRequests[0].payload.text).toBe("Unauthorized");
  });

  it("uses a routable information card before copied media", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    const message = customerMessage();
    delete message.text;
    message.sticker = { file_id: "sticker" };
    await routeUpdate(config, { update_id: 0, message });
    expect(telegramRequests).toHaveLength(2);
    expect(telegramRequests[0].method).toBe("sendMessage");
    expect(telegramRequests[0].payload.text).toContain("R.42.55");
    expect(telegramRequests[1].method).toBe("copyMessage");
  });

  it("keeps every long-text chunk within 4096 characters and routable", async () => {
    const config = testConfig();
    const plan = await buildCustomerDeliveryPlan(config, customerMessage("x".repeat(9000)), getDispatchTargets(config)[0]);
    expect(plan.steps).toHaveLength(3);
    for (const step of plan.steps) {
      expect(step.payload.text.length).toBeLessThanOrEqual(4096);
      expect(step.payload.text).toMatch(/R\.42\.55\.[a-f0-9]{16}/);
    }
  });

  it("supports /id before a group is configured and /reply as a fallback", async () => {
    const config = testConfig();
    const { telegramRequests } = installFetch();
    await routeUpdate(config, {
      update_id: 20,
      message: {
        message_id: 77,
        text: "/id",
        from: { id: 777 },
        chat: { id: -2002, type: "supergroup" }
      }
    });
    expect(telegramRequests[0].payload.chat_id).toBe(-2002);
    expect(telegramRequests[0].payload.text).toContain("-2002");

    await routeUpdate(config, {
      update_id: 21,
      message: {
        message_id: 501,
        text: "/reply 42 fallback response",
        from: { id: 777 },
        chat: { id: -1001, type: "supergroup" }
      }
    });
    expect(telegramRequests[1].payload.chat_id).toBe(42);
    expect(telegramRequests[1].payload.text).toBe("fallback response");
    expect(telegramRequests[2].payload.text).toBe("Reply sent");
  });

  it("splits long automatic answers for both customers and agents", async () => {
    const config = testConfig();
    config.autoReply.rules = [{ keywords: ["long"], reply: "x".repeat(9000) }];
    const { telegramRequests } = installFetch();
    await routeUpdate(config, { update_id: 0, message: customerMessage("long") });
    expect(telegramRequests.every((request) => request.payload.text.length <= 4096)).toBe(true);
    const agentAnswers = telegramRequests.filter((request) => request.payload.chat_id === 101 && request.payload.text.includes("回复内容："));
    expect(agentAnswers).toHaveLength(3);
    expect(agentAnswers.every((request) => /R\.42\.55\.[a-f0-9]{16}/.test(request.payload.text))).toBe(true);
  });

  it("preserves operator signatures and text limits when enabled", () => {
    const config = testConfig();
    config.replies.showOperatorName = true;
    const requests = buildAdminReplyRequests(config, adminReply("unused", "y".repeat(9000)), { userId: 42, messageId: 55 });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.method === "sendMessage" && request.payload.text.length <= 4096)).toBe(true);
    expect(requests.every((request) => request.payload.text.startsWith("Operator"))).toBe(true);
  });

  it("puts short media captions and their reply route into copyMessage", async () => {
    const config = testConfig();
    const message = customerMessage();
    delete message.text;
    message.photo = [{ file_id: "photo" }];
    message.caption = "A photo";
    const plan = await buildCustomerDeliveryPlan(config, message, getDispatchTargets(config)[0]);
    expect(plan?.steps).toHaveLength(1);
    expect(plan?.steps[0].method).toBe("copyMessage");
    expect(plan?.steps[0].payload.caption).toContain("A photo");
    expect(plan?.steps[0].payload.caption).toMatch(/R\.42\.55\.[a-f0-9]{16}/);
  });

  it("retries without reply_parameters when the customer's original message was deleted", async () => {
    const config = testConfig();
    let copyAttempts = 0;
    const { telegramRequests } = installFetch(undefined, (method) => {
      if (method === "copyMessage" && copyAttempts++ === 0) {
        return new Response(JSON.stringify({ ok: false, description: "replied message not found" }), { status: 400 });
      }
      return undefined;
    });
    const header = await buildCustomerHeader(config, customerMessage());
    const result = await routeUpdate(config, { update_id: 20, message: adminReply(header) });
    expect(result.ok).toBe(true);
    const copies = telegramRequests.filter((request) => request.method === "copyMessage");
    expect(copies).toHaveLength(2);
    expect(copies[0].payload.reply_parameters.message_id).toBe(55);
    expect(copies[1].payload.reply_parameters).toBeUndefined();
  });
});

/** 根目录 config.js 同步到 Worker 后的完整独立业务配置。 */
export interface WorkerConfig {
  telegram: {
    botToken: string;
    webhookSecret: string;
    apiBaseUrl: string;
  };
  worker: {
    requestTimeoutMs: number;
    maxUpdateBytes: number;
  };
  dispatch: {
    mode: "round_robin" | "all";
    users: TelegramTarget[];
    groups: TelegramTarget[];
  };
  welcome: {
    text: string;
    buttons: WelcomeButton[][];
  };
  autoReply: {
    enabled: boolean;
    rules: Array<{ keywords: string[]; reply: string }>;
  };
  ai: {
    enabled: boolean;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    knowledgeUrls: string[];
    maxKnowledgeChars: number;
    maxOutputTokens: number;
    temperature: number;
  };
  replies: {
    groupPolicy: "all_members" | "whitelist";
    allowedUserIds: number[];
    showOperatorName: boolean;
    linkToOriginal: boolean;
    routeSecret: string;
  };
  presentation: {
    timeZone: string;
    showLanguage: boolean;
    showTimestamp: boolean;
  };
  messages: {
    customerHelp: string;
    aiHelp: string;
    aiUnavailable: string;
    invalidButton: string;
    adminHelp: string;
    unsupported: string;
    deliveryFailed: string;
    routeNotFound: string;
    unauthorized: string;
    replyFailed: string;
    replySent: string;
    invalidReplyCommand: string;
  };
}

/**
 * 可选环境变量用于临时覆盖生成配置中的密钥。
 * 不配置任何变量也能仅凭 sync-config 生成的文件完整运行。
 */
export interface WorkerEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  REPLIES_ROUTE_SECRET?: string;
  AI_API_KEY?: string;
}

export type TelegramTarget = number | string;

export interface WelcomeButton {
  text: string;
  callbackData?: string;
  response?: string;
  url?: string;
}

export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
  [key: string]: any;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number | string;
  type: string;
  username?: string;
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: TelegramMessage;
  [key: string]: any;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from: TelegramUser;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramRequest {
  method: string;
  payload: Record<string, any>;
}

export interface TelegramResult {
  ok: boolean;
  result?: any;
  status?: number;
  description?: string;
}

export interface DispatchTarget {
  id: TelegramTarget;
  type: "user" | "group";
}

export interface ReplyRoute {
  userId: number;
  messageId: number;
}

export interface DeliveryPlan {
  target: DispatchTarget;
  steps: TelegramRequest[];
}

export interface AssistantReply {
  kind: "auto" | "ai";
  text: string;
  error?: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  error?: string;
}

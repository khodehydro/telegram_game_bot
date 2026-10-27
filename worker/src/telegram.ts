/** Telegram types used by the worker (subset of the Bot API). */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/** Minimal Bot API client, JSON only, no extra dependencies. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly apiBase = "https://api.telegram.org",
  ) {}

  private async call<T = any>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result as T;
  }

  getMe() {
    return this.call<TgUser>("getMe");
  }

  sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ) {
    return this.call<TgMessage | boolean>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string, showAlert = false) {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text } : {}),
      ...(showAlert ? { show_alert: true } : {}),
    });
  }

  setMyCommands(commands: { command: string; description: string }[]) {
    return this.call<boolean>("setMyCommands", { commands });
  }

  setWebhook(url: string, secretToken?: string) {
    return this.call<boolean>("setWebhook", {
      url,
      ...(secretToken ? { secret_token: secretToken } : {}),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
  }

  deleteWebhook() {
    return this.call<boolean>("deleteWebhook", {});
  }
}

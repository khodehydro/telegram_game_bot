/** کلاینت سبک Bot API (فقط متدهایی که لازم داریم). */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
  language_code?: string;
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
  data?: string;
  message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export type InlineKeyboard = { inline_keyboard: Array<Array<Record<string, unknown>>> };

export class BotApi {
  constructor(
    private readonly token: string,
    private readonly base = "https://api.telegram.org",
  ) {}

  private async call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
    return data.result as T;
  }

  getMe() {
    return this.call<TgUser>("getMe");
  }

  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text, show_alert: false } : {}),
    });
  }

  setMyCommands(commands: { command: string; description: string }[]) {
    return this.call<boolean>("setMyCommands", { commands });
  }

  setChatMenuButton(payload: Record<string, unknown>) {
    return this.call<boolean>("setChatMenuButton", payload);
  }

  setWebhook(url: string, secret?: string) {
    return this.call<boolean>("setWebhook", {
      url,
      ...(secret ? { secret_token: secret } : {}),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
  }
}

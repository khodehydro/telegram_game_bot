/** In-memory Telegram client used by the integration tests. */

import type {
  InlineKeyboardMarkup,
  TgCallbackQuery,
  TgChat,
  TgMessage,
  TgUser,
} from "../src/telegram";

interface StoredMessage {
  chatId: number;
  messageId: number;
  text: string;
  markup?: InlineKeyboardMarkup;
}

export class FakeTelegram {
  messages: StoredMessage[] = [];
  answered: { id: string; text?: string; alert: boolean }[] = [];
  private nextId = 100;

  async getMe(): Promise<TgUser> {
    return { id: 42, is_bot: true, first_name: "TestBot", username: "hydrogameofficialbot" };
  }

  async sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<TgMessage> {
    const messageId = ++this.nextId;
    this.messages.push({ chatId, messageId, text, markup: replyMarkup });
    return this.toMessage(chatId, messageId, text);
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<TgMessage | boolean> {
    const existing = this.messages.find((m) => m.chatId === chatId && m.messageId === messageId);
    if (!existing) {
      const err = new Error(
        "Bad Request: message to edit not found",
      );
      throw err;
    }
    if (existing.text === text && JSON.stringify(existing.markup) === JSON.stringify(replyMarkup)) {
      throw new Error("Bad Request: message is not modified");
    }
    existing.text = text;
    existing.markup = replyMarkup;
    return this.toMessage(chatId, messageId, text);
  }

  async answerCallbackQuery(id: string, text?: string, showAlert = false): Promise<boolean> {
    this.answered.push({ id, text, alert: showAlert });
    return true;
  }

  async setMyCommands(): Promise<boolean> {
    return true;
  }

  async setWebhook(): Promise<boolean> {
    return true;
  }

  async deleteWebhook(): Promise<boolean> {
    return true;
  }

  toMessage(chatId: number, messageId: number, text: string): TgMessage {
    const chat: TgChat = { id: chatId, type: chatId > 0 ? "private" : "supergroup" };
    return { message_id: messageId, date: Math.floor(Date.now() / 1000), chat, text };
  }

  /** Latest message sent/edited in a chat. */
  latest(chatId: number): StoredMessage | undefined {
    return [...this.messages].reverse().find((m) => m.chatId === chatId);
  }

  /** Latest message for a chat, including the keyboard. */
  latestKeyboard(chatId: number): InlineKeyboardMarkup | undefined {
    return this.latest(chatId)?.markup;
  }

  buttonsFor(chatId: number): { text: string; callback_data: string }[] {
    const kb = this.latestKeyboard(chatId);
    if (!kb) return [];
    return kb.inline_keyboard.flat();
  }

  textsFor(chatId: number): string[] {
    return this.messages.filter((m) => m.chatId === chatId).map((m) => m.text);
  }
}

export function user(id: number, name: string): TgUser {
  return { id, is_bot: false, first_name: name, username: `u${id}` };
}

export function message(chatId: number, from: TgUser, text: string, messageId = 1): TgMessage {
  return {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: chatId > 0 ? "private" : "supergroup" },
    from,
    text,
  };
}

export function callback(
  id: string,
  from: TgUser,
  data: string,
  chatId: number,
  messageId = 1,
): TgCallbackQuery {
  return {
    id,
    from,
    data,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: chatId > 0 ? "private" : "supergroup" },
      text: "",
    },
  };
}

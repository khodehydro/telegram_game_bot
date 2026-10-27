/** Update routing: commands, deep links and inline callbacks. */

import { GameError } from "./games/base";
import { GAMES, nameFa } from "./games/registry";
import { mainMenuKeyboard } from "./render";
import { GameService, escapeHtml } from "./service";
import { Storage } from "./storage";
import { TelegramClient, TgCallbackQuery, TgMessage, TgUpdate } from "./telegram";

export const WELCOME = `🎴 <b>ربات بازی‌های کارتی ایرانی</b>

اینجا می‌توانید با دوستانتان <b>پاسور</b> و <b>حکم</b> بازی کنید — هم داخل گروه، هم در میز خصوصی.

<b>در گروه:</b>
/new pasur — میز پاسور بساز
/new hokm — میز حکم بساز
/join — نشستن سر میز
/cancel — لغو میز

<b>در چت خصوصی:</b>
/new pasur — ساخت میز خصوصی و گرفتن لینک دعوت

/stats — آمار شما
/top — برترین بازیکنان
/rules — قوانین بازی‌ها

⚠️ برای دیدن برگ‌هایتان، هر بازیکن باید یک بار ربات را در چت خصوصی استارت کند.`;

export const RULES_PASUR = `🎣 <b>قوانین پاسور</b>

با ۵۲ برگ و ۲ تا ۴ نفر (۴ نفره: دو تیم دو نفره، یارها روبه‌روی هم).

<b>پخش:</b> به هر نفر ۴ برگ و ۴ برگ رو به زمین. اگر بیش از یک سرباز روی زمین بیاید دوباره پخش می‌شود.

<b>برداشتن برگ‌ها:</b>
• شاه، شاه را و بی‌بی، بی‌بی را برمی‌دارد.
• سرباز همهٔ برگ‌های عددی و سربازهای روی زمین را برمی‌دارد (نه شاه و بی‌بی).
• برگ‌های عددی (آس=۱ … ۱۰=۱۰) هر ترکیبی را که با آن‌ها جمعش ۱۱ شود برمی‌دارند.

<b>سور:</b> اگر با برگی غیر از سرباز زمین را کامل خالی کنی، ۵ امتیاز می‌گیری (در پخش آخر و بعد از ۵۰ امتیاز حساب نمی‌شود).

<b>امتیازها:</b> هر آس ۱، هر سرباز ۱، ۲♣ ۲، ۱۰♦ ۳، هفت برگ یا بیشتر گشنیز ۷، هر سور ۵. اولین نفری/تیمی که به ۶۲ برسد برنده است.`;

export const RULES_HOKM = `👑 <b>قوانین حکم</b>

دقیقاً ۴ نفر، دو تیم دو نفره (یارها روبه‌روی هم). ۵۲ برگ و ۱۳ برگ برای هر نفر.

<b>شروع:</b> حاکم ۵ برگ می‌گیرد و خال حکم را انتخاب می‌کند، بعد بقیهٔ برگ‌ها پخش می‌شود. حاکم اولین دست را شروع می‌کند.

<b>بازی:</b> باید از خال زمینه بازی کنی، اگر نداشتی هر برگی می‌توانی بیندازی. حکم از همه بالاتر است.

<b>امتیاز:</b>
• برد عادی: ۱ امتیاز
• کوت (۷ بر ۰): ۲ امتیاز
• حاکم‌کوت (تیم حاکم ۷ بر ۰ ببازد): ۳ امتیاز

اولین تیمی که ۷ امتیاز بیاورد برندهٔ بازی است.`;

function parseGame(arg: string | undefined | null): string {
  const key = (arg ?? "").trim().toLowerCase();
  if (!key) return "pasur";
  const aliases: Record<string, string> = {
    pasur: "pasur",
    پاسور: "pasur",
    basra: "pasur",
    hokm: "hokm",
    حکم: "hokm",
  };
  const game = aliases[key];
  if (!game) throw new GameError("unknown game", "بازی‌های موجود: pasur (پاسور) و hokm (حکم).");
  return game;
}

export class UpdateHandler {
  constructor(
    private readonly tg: TelegramClient,
    private readonly db: Storage,
    private readonly service: GameService,
  ) {}

  async handle(update: TgUpdate): Promise<void> {
    if (update.message) return this.onMessage(update.message);
    if (update.callback_query) return this.onCallback(update.callback_query);
  }

  // ------------------------------------------------------------------ messages
  private async onMessage(message: TgMessage): Promise<void> {
    const from = message.from;
    if (!from) return;
    const text = (message.text ?? "").trim();
    if (!text.startsWith("/")) return;

    await this.db.upsertUser(from.id, from.username ?? null, from.first_name ?? null);
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split("@")[0].toLowerCase();
    const args = rest.join(" ");
    const name = escapeHtml(from.first_name);

    try {
      switch (cmd) {
        case "/start":
          await this.onStart(message, from.id, name, args);
          return;
        case "/help":
          await this.tg.sendMessage(message.chat.id, WELCOME, mainMenuKeyboard());
          return;
        case "/rules":
          await this.onRules(message, args);
          return;
        case "/new":
        case "/game":
        case "/بازی":
        case "/میز":
          await this.onNew(message, from.id, name, args);
          return;
        case "/join":
        case "/نشستن":
          await this.onJoin(message, from.id, name);
          return;
        case "/cancel":
          await this.onCancel(message, from.id);
          return;
        case "/stats":
        case "/آمار": {
          const stats = await this.service.stats(from.id);
          await this.tg.sendMessage(message.chat.id, stats ?? "هنوز بازی‌ای ثبت نشده. یک میز بساز و بازی کن! 🎴");
          return;
        }
        case "/top":
        case "/برترین":
          await this.tg.sendMessage(message.chat.id, await this.service.leaderboard());
          return;
        default:
          return;
      }
    } catch (err) {
      console.error("handler error", err);
    }
  }

  private async onStart(message: TgMessage, userId: number, name: string, payload: string): Promise<void> {
    if (payload.startsWith("join_")) {
      const sessionId = payload.slice(5);
      const session = await this.db.getSession(sessionId);
      if (!session) {
        await this.tg.sendMessage(message.chat.id, "این میز پیدا نشد یا بسته شده است.");
        return;
      }
      try {
        await this.service.join(session, userId, name);
      } catch (err) {
        if (err instanceof GameError && err.fa.includes("قبلاً")) {
          await this.tg.sendMessage(message.chat.id, "شما قبلاً سر این میز نشسته‌اید 🙂");
          return;
        }
        throw err;
      }
      await this.tg.sendMessage(
        message.chat.id,
        `✅ سر میز ${nameFa(session.game)} نشستید!\nوقتی بازی شروع شود، برگ‌هایتان همین‌جا می‌آید.`,
        mainMenuKeyboard(),
      );
      return;
    }
    await this.tg.sendMessage(message.chat.id, WELCOME, mainMenuKeyboard());
  }

  private async onRules(message: TgMessage, args: string): Promise<void> {
    const key = args.trim().toLowerCase();
    if (key === "pasur" || key === "پاسور") {
      await this.tg.sendMessage(message.chat.id, RULES_PASUR);
    } else if (key === "hokm" || key === "حکم") {
      await this.tg.sendMessage(message.chat.id, RULES_HOKM);
    } else {
      await this.tg.sendMessage(message.chat.id, RULES_PASUR);
      await this.tg.sendMessage(message.chat.id, RULES_HOKM);
    }
  }

  private async onNew(message: TgMessage, userId: number, name: string, args: string): Promise<void> {
    let game: string;
    try {
      game = parseGame(args);
    } catch (err) {
      if (err instanceof GameError) {
        await this.tg.sendMessage(message.chat.id, err.fa);
        return;
      }
      throw err;
    }
    try {
      const session = await this.service.createLobby({
        chatId: message.chat.id,
        chatType: message.chat.type,
        ownerId: userId,
        ownerName: name,
        game,
      });
      await this.service.renderLobby(session);
      if (message.chat.type === "private") {
        const link = this.service.botLink(session.id);
        await this.tg.sendMessage(
          message.chat.id,
          `🔗 لینک دعوت میز شما:\n<code>${escapeHtml(link)}</code>\n\nاین لینک را برای دوستتان بفرستید. هر کس باز کند، سر میز می‌نشیند.`,
        );
      }
    } catch (err) {
      if (err instanceof GameError) {
        await this.tg.sendMessage(message.chat.id, err.fa);
        return;
      }
      throw err;
    }
  }

  private async onJoin(message: TgMessage, userId: number, name: string): Promise<void> {
    const session = await this.db.getActiveSession(message.chat.id);
    if (!session || session.status !== "lobby") {
      await this.tg.sendMessage(message.chat.id, "میز بازی در این چت باز نیست. با /new بسازید.");
      return;
    }
    try {
      await this.service.join(session, userId, name);
    } catch (err) {
      if (err instanceof GameError) {
        await this.tg.sendMessage(message.chat.id, err.fa);
        return;
      }
      throw err;
    }
    await this.tg.sendMessage(message.chat.id, `✅ ${name} سر میز نشست.`);
  }

  private async onCancel(message: TgMessage, userId: number): Promise<void> {
    const session = await this.db.getActiveSession(message.chat.id);
    if (!session) {
      await this.tg.sendMessage(message.chat.id, "میز فعالی در این چت نیست.");
      return;
    }
    const players = (session.state.players as number[]) ?? [];
    if (userId !== session.owner_id && !players.includes(userId)) {
      await this.tg.sendMessage(message.chat.id, "فقط سازنده یا بازیکنان میز می‌توانند لغو کنند.");
      return;
    }
    await this.service.cancel(session);
  }

  // ------------------------------------------------------------------ callbacks
  private async onCallback(call: TgCallbackQuery): Promise<void> {
    const data = call.data ?? "";
    const parts = data.split(":");
    const userId = call.from.id;
    const name = escapeHtml(call.from.first_name);
    const chatId = call.message?.chat.id ?? userId;

    try {
      if (parts[0] === "menu") return await this.onMenu(call, parts, chatId, name);
      if (parts[0] === "l") return await this.onLobby(call, parts, userId, name);
      if (parts[0] === "g") return await this.onGame(call, parts, userId);
      await this.tg.answerCallbackQuery(call.id);
    } catch (err) {
      if (err instanceof GameError) {
        await this.tg.answerCallbackQuery(call.id, err.fa, true);
        return;
      }
      console.error("callback error", err);
      await this.tg.answerCallbackQuery(call.id, "خطایی رخ داد؛ دوباره تلاش کنید.", true);
    }
  }

  private async onMenu(
    call: TgCallbackQuery,
    parts: string[],
    chatId: number,
    name: string,
  ): Promise<void> {
    const action = parts[1];
    if (action === "new") {
      const game = parts[2];
      if (call.message?.chat.type !== "private") {
        await this.tg.answerCallbackQuery(call.id, "برای ساخت میز در گروه از دستور /new استفاده کنید.", true);
        return;
      }
      const session = await this.service.createLobby({
        chatId,
        chatType: "private",
        ownerId: call.from.id,
        ownerName: name,
        game,
      });
      await this.service.renderLobby(session);
      await this.tg.sendMessage(
        chatId,
        `🔗 لینک دعوت میز شما:\n<code>${escapeHtml(this.service.botLink(session.id))}</code>`,
      );
      await this.tg.answerCallbackQuery(call.id);
      return;
    }
    if (action === "stats") {
      const stats = await this.service.stats(call.from.id);
      await this.tg.answerCallbackQuery(call.id);
      await this.tg.sendMessage(chatId, stats ?? "هنوز آماری برای شما ثبت نشده است.");
      return;
    }
    if (action === "top") {
      const board = await this.service.leaderboard();
      await this.tg.answerCallbackQuery(call.id);
      await this.tg.sendMessage(chatId, board);
      return;
    }
    if (action === "rules") {
      await this.tg.answerCallbackQuery(call.id);
      await this.tg.sendMessage(chatId, RULES_PASUR);
      await this.tg.sendMessage(chatId, RULES_HOKM);
      return;
    }
    await this.tg.answerCallbackQuery(call.id);
  }

  private async onLobby(
    call: TgCallbackQuery,
    parts: string[],
    userId: number,
    name: string,
  ): Promise<void> {
    const action = parts[1];
    if (action === "n") {
      const game = parts[2];
      const chat = call.message?.chat;
      if (!chat) return void (await this.tg.answerCallbackQuery(call.id));
      const session = await this.service.createLobby({
        chatId: chat.id,
        chatType: chat.type,
        ownerId: userId,
        ownerName: name,
        game,
      });
      await this.service.renderLobby(session);
      await this.tg.answerCallbackQuery(call.id, "میز جدید ساخته شد.");
      return;
    }

    const session = await this.db.getSession(parts[2]);
    if (!session) {
      await this.tg.answerCallbackQuery(call.id, "این میز پیدا نشد یا بسته شده است.", true);
      return;
    }
    switch (action) {
      case "j":
        await this.service.join(session, userId, name);
        await this.tg.answerCallbackQuery(call.id, "نشستید! ✅");
        return;
      case "l":
        await this.service.leave(session, userId);
        await this.tg.answerCallbackQuery(call.id, "از میز بلند شدید.");
        return;
      case "s":
        if (userId !== session.owner_id) {
          await this.tg.answerCallbackQuery(call.id, "فقط سازندهٔ میز می‌تواند بازی را شروع کند.", true);
          return;
        }
        await this.service.start(session);
        await this.tg.answerCallbackQuery(call.id, "بازی شروع شد! 🎉");
        return;
      case "c": {
        const players = (session.state.players as number[]) ?? [];
        if (userId !== session.owner_id && !players.includes(userId)) {
          await this.tg.answerCallbackQuery(call.id, "فقط بازیکنان میز می‌توانند لغو کنند.", true);
          return;
        }
        await this.service.cancel(session);
        await this.tg.answerCallbackQuery(call.id, "میز لغو شد.");
        return;
      }
      default:
        await this.tg.answerCallbackQuery(call.id);
    }
  }

  private async onGame(call: TgCallbackQuery, parts: string[], userId: number): Promise<void> {
    const action = parts[1];
    const session = await this.db.getSession(parts[2]);
    if (!session) {
      await this.tg.answerCallbackQuery(call.id, "این بازی پیدا نشد.", true);
      return;
    }
    switch (action) {
      case "p":
        await this.service.playCard(session, userId, parts[3]);
        await this.tg.answerCallbackQuery(call.id, "انجام شد ✅");
        return;
      case "c":
        await this.service.chooseCapture(session, userId, Number(parts[3]));
        await this.tg.answerCallbackQuery(call.id, "برداشته شد ✅");
        return;
      case "t":
        await this.service.chooseTrump(session, userId, parts[3]);
        await this.tg.answerCallbackQuery(call.id, "حکم انتخاب شد 🃏");
        return;
      case "b":
        await this.service.restoreHand(session, userId);
        await this.tg.answerCallbackQuery(call.id, "برگشت.");
        return;
      default:
        await this.tg.answerCallbackQuery(call.id);
    }
  }
}

export function gameList(): string {
  return Object.keys(GAMES)
    .map((k) => `${nameFa(k)} (/new ${k})`)
    .join(" • ");
}


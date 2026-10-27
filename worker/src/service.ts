/**
 * Orchestration layer — the Cloudflare/D1 counterpart of `bot/service.py`.
 * Keeps engines pure and talks to Telegram + D1.
 */

import { cardLabel, faNumber, parseCard } from "./games/cards";
import { Action, BaseGame, GameError, GameEvent } from "./games/base";
import { gameEmoji, getEngineClass, nameFa } from "./games/registry";
import {
  captureKeyboard,
  finishedKeyboard,
  handKeyboard,
  handText,
  lobbyKeyboard,
  lobbyText,
  tableText,
} from "./render";
import { Storage, SessionRow } from "./storage";
import { InlineKeyboardMarkup, TelegramClient, TgUpdate, TgUser } from "./telegram";

const MAX_MESSAGE = 3900; // Telegram hard limit is 4096; keep headroom

function isNotModified(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /message is not modified/i.test(msg);
}

function isUnreachable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /chat not found|bot was blocked|user is deactivated|forbidden/i.test(msg);
}

export class GameService {
  private pending = new Map<string, string>(); // `${sessionId}:${userId}` -> card

  constructor(
    private readonly tg: TelegramClient,
    private readonly db: Storage,
    private readonly opts: { lobbyTimeout?: number; turnTimeout?: number; botUsername?: string } = {},
  ) {}

  // ------------------------------------------------------------------ helpers
  engine(session: SessionRow): BaseGame {
    const cls = getEngineClass(session.game);
    return new cls(session.state);
  }

  names(session: SessionRow): string[] {
    return (session.state.names as string[]) ?? [];
  }

  private view(session: SessionRow, seat: number | null) {
    const engine = this.engine(session);
    const view = engine.view(seat);
    view.names = this.names(session);
    return view;
  }

  private ui(session: SessionRow): any {
    session.state._ui = session.state._ui ?? {};
    return session.state._ui;
  }

  private async safeEdit(
    chatId: number,
    messageId: number,
    text: string,
    kb?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    try {
      await this.tg.editMessageText(chatId, messageId, text.slice(0, MAX_MESSAGE), kb);
      return true;
    } catch (err) {
      if (isNotModified(err)) return true;
      return false;
    }
  }

  private async safeSend(
    chatId: number,
    text: string,
    kb?: InlineKeyboardMarkup,
  ): Promise<number | null> {
    try {
      const msg = await this.tg.sendMessage(chatId, text.slice(0, MAX_MESSAGE), kb);
      return msg.message_id;
    } catch (err) {
      if (isUnreachable(err)) return null;
      throw err;
    }
  }

  // ------------------------------------------------------------------ lobby
  async createLobby(opts: {
    chatId: number;
    chatType: string;
    ownerId: number;
    ownerName: string;
    game: string;
  }): Promise<SessionRow> {
    getEngineClass(opts.game); // validates the key
    const existing = await this.db.getActiveSession(opts.chatId);
    if (existing) {
      throw new GameError("a game is already active", "در این چت یک بازی در جریان است. اول آن را تمام کنید.");
    }
    const session = await this.db.createSession({
      chatId: opts.chatId,
      chatType: opts.chatType,
      game: opts.game,
      ownerId: opts.ownerId,
      players: [opts.ownerId],
    });
    session.state = {
      phase: "lobby",
      players: [opts.ownerId],
      names: [opts.ownerName],
      lobby_deadline: Math.floor(Date.now() / 1000) + (this.opts.lobbyTimeout ?? 180),
      _ui: {},
    };
    await this.db.saveSession(session);
    return session;
  }

  async renderLobby(session: SessionRow): Promise<void> {
    const cls = getEngineClass(session.game);
    const names = this.names(session);
    const text = lobbyText(
      session.game,
      names,
      cls.MIN_PLAYERS,
      cls.MAX_PLAYERS,
      session.chat_type === "private",
    );
    const kb = lobbyKeyboard(session.id, true);
    if (session.message_id) {
      if (await this.safeEdit(session.chat_id, session.message_id, text, kb)) return;
    }
    const mid = await this.safeSend(session.chat_id, text, kb);
    if (mid) {
      session.message_id = mid;
      await this.db.saveSession(session);
    }
  }

  async join(session: SessionRow, userId: number, userName: string): Promise<void> {
    if (session.status !== "lobby") throw new GameError("game already started", "این بازی شروع شده است.");
    const cls = getEngineClass(session.game);
    const players = session.state.players as number[];
    const names = session.state.names as string[];
    if (players.includes(userId)) throw new GameError("already joined", "شما قبلاً نشسته‌اید.");
    if (players.length >= cls.MAX_PLAYERS) throw new GameError("table is full", "میز پر است!");
    players.push(userId);
    names.push(userName);
    await this.db.saveSession(session);
    await this.renderLobby(session);
  }

  async leave(session: SessionRow, userId: number): Promise<void> {
    if (session.status !== "lobby") {
      throw new GameError("game already started", "بازی شروع شده؛ نمی‌شود بلند شد.");
    }
    const players = session.state.players as number[];
    const names = session.state.names as string[];
    const idx = players.indexOf(userId);
    if (idx === -1) throw new GameError("not in lobby", "شما در این میز نیستید.");
    players.splice(idx, 1);
    names.splice(idx, 1);
    await this.db.saveSession(session);
    await this.renderLobby(session);
  }

  async cancel(session: SessionRow): Promise<void> {
    await this.db.finishSession(session.id);
    session.status = "finished";
    if (session.message_id) {
      await this.safeEdit(
        session.chat_id,
        session.message_id,
        `🗑 میز ${nameFa(session.game)} لغو شد.`,
      );
    }
  }

  // ------------------------------------------------------------------ start
  async start(session: SessionRow): Promise<void> {
    if (session.status !== "lobby") throw new GameError("already started", "این بازی قبلاً شروع شده است.");
    const cls = getEngineClass(session.game);
    const players = [...(session.state.players as number[])];
    if (players.length < cls.MIN_PLAYERS) {
      throw new GameError(
        "not enough players",
        `${nameFa(session.game)} حداقل ${faNumber(cls.MIN_PLAYERS)} بازیکن می‌خواهد.`,
      );
    }
    const names = [...(session.state.names as string[])];
    const create = (cls as any).create as (p: number[]) => any;
    session.state = create(players);
    session.state.names = names;
    session.state._ui = {};
    session.status = "running";
    await this.db.saveSession(session);
    await this.refresh(session, [], true);
  }

  // ------------------------------------------------------------------ actions
  async act(session: SessionRow, userId: number, action: Action): Promise<GameEvent[]> {
    if (session.status !== "running") throw new GameError("game is not running", "این بازی در جریان نیست.");
    const engine = this.engine(session);
    const seat = engine.seatOf(userId);
    if (seat === null) throw new GameError("you are not playing", "شما در این بازی نیستید.");
    const events = engine.apply(seat, action);
    await this.db.saveSession(session);
    await this.refresh(session, events);
    return events;
  }

  async playCard(session: SessionRow, userId: number, card: string): Promise<void> {
    const engine = this.engine(session);
    const seat = engine.seatOf(userId);
    if (seat === null) throw new GameError("not a player", "شما در این بازی نیستید.");
    if (seat !== engine.currentSeat()) throw new GameError("not your turn", "الان نوبت شما نیست.");
    if (session.game === "hokm") {
      await this.act(session, userId, { type: "play", card });
      return;
    }
    const pasur = engine as any;
    const options: string[][] = pasur.captureOptions(parseCard(card));
    if (options.length <= 1) {
      this.pending.delete(`${session.id}:${userId}`);
      await this.act(session, userId, { type: "play", card });
      return;
    }
    this.pending.set(`${session.id}:${userId}`, card);
    const ui = this.ui(session);
    ui.hands = ui.hands ?? {};
    const mid = ui.hands[String(userId)];
    const text = `🎴 با ${cardLabel(card)} می‌توانی یکی از این مجموعه‌ها را برداری:`;
    const kb = captureKeyboard(options, session.id);
    if (mid && (await this.safeEdit(userId, mid, text, kb))) return;
    const newMid = await this.safeSend(userId, text, kb);
    if (newMid) ui.hands[String(userId)] = newMid;
    await this.db.saveSession(session);
  }

  async chooseCapture(session: SessionRow, userId: number, index: number): Promise<void> {
    const key = `${session.id}:${userId}`;
    const card = this.pending.get(key);
    if (!card) throw new GameError("nothing to choose", "انتخاب منقضی شده؛ دوباره برگ را بزنید.");
    this.pending.delete(key);
    const engine = this.engine(session) as any;
    const options: string[][] = engine.captureOptions(parseCard(card));
    if (index < 0 || index >= options.length) throw new GameError("invalid choice", "گزینه نامعتبر است.");
    await this.act(session, userId, { type: "play", card, capture: options[index] });
  }

  /** Cancel a pending capture choice and show the hand keyboard again. */
  async restoreHand(session: SessionRow, userId: number): Promise<void> {
    this.pending.delete(`${session.id}:${userId}`);
    const seat = (session.state.players as number[]).indexOf(userId);
    if (seat === -1) return;
    const engine = this.engine(session);
    const view = this.view(session, seat);
    const text = handText(view, seat);
    const kb = handKeyboard(engine, view, session.id, seat);
    const mid = this.ui(session).hands?.[String(userId)];
    if (mid) {
      if (await this.safeEdit(userId, mid, text, kb ?? undefined)) return;
    }
    const newMid = await this.safeSend(userId, text, kb ?? undefined);
    if (newMid) this.ui(session).hands[String(userId)] = newMid;
  }

  async chooseTrump(session: SessionRow, userId: number, suit: string): Promise<void> {
    await this.act(session, userId, { type: "trump", suit });
  }

  // ------------------------------------------------------------------ rendering
  async refresh(session: SessionRow, events: GameEvent[] = [], intro = false): Promise<void> {
    const engine = this.engine(session);
    const names = this.names(session);
    const note = this.note(engine, names, events, intro);
    const publicView = this.view(session, null);
    const text = tableText(publicView, note);
    const kb = engine.finished ? finishedKeyboard(session.game) : undefined;

    if (session.chat_type === "private") {
      const ui = this.ui(session);
      ui.tables = ui.tables ?? {};
      for (const uid of session.state.players as number[]) {
        const mid = ui.tables[String(uid)];
        if (mid && (await this.safeEdit(uid, mid, text, kb))) continue;
        const newMid = await this.safeSend(uid, text, kb);
        if (newMid) ui.tables[String(uid)] = newMid;
      }
      await this.db.saveSession(session);
    } else {
      if (session.message_id && (await this.safeEdit(session.chat_id, session.message_id, text, kb))) {
        // edited in place
      } else {
        const mid = await this.safeSend(session.chat_id, text, kb);
        if (mid) {
          session.message_id = mid;
          await this.db.saveSession(session);
        }
      }
    }

    for (let seat = 0; seat < (session.state.players as number[]).length; seat++) {
      await this.updateHand(session, seat);
    }

    if (engine.finished) await this.finalise(session, engine);
  }

  private async updateHand(session: SessionRow, seat: number): Promise<void> {
    const engine = this.engine(session);
    const uid = (session.state.players as number[])[seat];
    if (uid === undefined) return;
    const ui = this.ui(session);
    ui.hands = ui.hands ?? {};
    ui.blocked = ui.blocked ?? [];
    if (ui.blocked.includes(String(uid))) return;

    const view = this.view(session, seat);
    let text = handText(view, seat);
    const kb = handKeyboard(engine, view, session.id, seat);
    if (!kb && !engine.finished && view.turn !== seat) text += "\n\n<i>تا نوبتتان صبر کنید.</i>";

    const mid = ui.hands[String(uid)];
    if (mid) {
      try {
        await this.tg.editMessageText(uid, mid, text.slice(0, MAX_MESSAGE), kb ?? undefined);
        return;
      } catch (err) {
        if (isNotModified(err)) return;
        if (isUnreachable(err)) {
          ui.blocked.push(String(uid));
          return;
        }
      }
    }
    const newMid = await this.safeSend(uid, text, kb ?? undefined);
    if (newMid) ui.hands[String(uid)] = newMid;
    else ui.blocked.push(String(uid));
  }

  note(engine: BaseGame, names: string[], events: GameEvent[], intro: boolean): string {
    if (intro) {
      if (engine.gameKey === "pasur") {
        return "🎴 شروع شد! آس و سرباز ۱، ۲♣ ۲، ۱۰♦ ۳، هفت‌خاج ۷ و هر سور ۵ امتیاز دارد. تا ۶۲ امتیاز.";
      }
      return "🎴 شروع شد! حاکم خال حکم را انتخاب می‌کند. هر تیم با ۷ دست، دست را می‌برد.";
    }
    const lines: string[] = [];
    for (const event of events) {
      const who = (seat: number) => names[seat] ?? "?";
      switch (event.type) {
        case "play": {
          const seat = event.seat as number;
          let line = `🃏 ${who(seat)}: ${(event.card as string) && cardLabelSafe(event.card as string)}`;
          const captured = (event.captured as string[]) ?? [];
          if (captured.length) line += " و برداشت " + captured.map(cardLabelSafe).join(" ");
          if (event.sur) line += " ⭐ سور!";
          lines.push(line);
          break;
        }
        case "trick_end":
          lines.push(`✅ دست را ${who(event.winner as number)} برد.`);
          break;
        case "sweep":
          lines.push(`🧹 ${who(event.seat as number)} برگ‌های باقی‌مانده روی زمین را برداشت.`);
          break;
        case "round_end": {
          const gains = event.gains as number[] | undefined;
          if (gains) {
            const parts = gains
              .map((g, i) => (i < names.length ? `${names[i]}: ${faNumber(g)}` : ""))
              .filter(Boolean)
              .join(" • ");
            lines.push(`📊 پایان دور — امتیاز این دور: ${parts}`);
          } else {
            const label =
              event.kind === "kot" ? "کوت!" : event.kind === "hakem_kot" ? "حاکم‌کوت!" : "برد عادی";
            lines.push(`📊 پایان دست — ${label} (+${faNumber(event.points as number)} امتیاز)`);
          }
          break;
        }
        case "game_end":
          lines.push(`🏁 <b>برنده: ${who(event.winner as number)}</b>`);
          break;
        case "new_round":
          lines.push("🔁 دست جدید شروع شد.");
          break;
        case "trump":
          lines.push("🃏 حکم انتخاب شد.");
          break;
        default:
          break;
      }
    }
    let text = lines.slice(-6).join("\n");
    if (engine.finished) text += "\n\n🎉 بازی تمام شد!";
    return text;
  }

  async finalise(session: SessionRow, engine: BaseGame): Promise<void> {
    if (session.status === "finished") return;
    const view = engine.view(null);
    const names = this.names(session);
    const winner = view.winner ?? null;
    const players = session.state.players as number[];
    const scores = (view.scores as number[]) ?? [];
    const rows = players.map((uid, seat) => ({
      user_id: uid,
      seat,
      won:
        view.teams && winner !== null
          ? seat % 2 === winner % 2
          : seat === winner,
      points: scores[seat] ?? 0,
    }));

    try {
      await this.db.recordResult({
        sessionId: session.id,
        game: session.game,
        chatId: session.chat_id,
        players: rows,
        winnerSeat: winner,
      });
    } catch (err) {
      console.error("could not record the result", err);
    }

    session.status = "finished";
    await this.db.saveSession(session);

    if (session.chat_type !== "private" && winner !== null && winner < names.length) {
      await this.safeSend(
        session.chat_id,
        `${gameEmoji(session.game)} بازی ${nameFa(session.game)} تمام شد — برنده: <b>${names[winner]}</b>`,
      );
    }
  }

  // ------------------------------------------------------------------ timeouts
  async processTimeouts(now = Math.floor(Date.now() / 1000)): Promise<number> {
    const sessions = await this.db.listActiveSessions();
    let acted = 0;
    for (const session of sessions) {
      try {
        if (session.status === "lobby") {
          const deadline = session.state.lobby_deadline as number | undefined;
          if (deadline && now > deadline) {
            await this.cancel(session);
            acted++;
          }
          continue;
        }
        const deadline = session.state.deadline as number | null;
        if (!deadline || now < deadline) continue;
        const engine = this.engine(session);
        const seat = engine.currentSeat();
        if (seat === null) continue;
        const action = engine.autoAction(seat);
        const fresh = await this.db.getSession(session.id);
        if (!fresh || fresh.status !== "running") continue;
        const freshEngine = this.engine(fresh);
        if (freshEngine.currentSeat() !== seat) continue;
        const events = freshEngine.apply(seat, action);
        await this.db.saveSession(fresh);
        await this.refresh(fresh, events);
        acted++;
      } catch (err) {
        console.error(`timeout handling failed for ${session.id}`, err);
      }
    }
    return acted;
  }

  // ------------------------------------------------------------------ misc
  async stats(userId: number): Promise<string | null> {
    const user = await this.db.getUser(userId);
    if (!user) return null;
    const rate = user.games_played ? Math.round((user.wins / user.games_played) * 100) : 0;
    return [
      `📊 <b>آمار ${escapeHtml(user.first_name ?? "بازیکن")}</b>`,
      "",
      `بازی‌ها: ${faNumber(user.games_played)}`,
      `برد: ${faNumber(user.wins)} — باخت: ${faNumber(user.losses)}`,
      `نرخ برد: ${faNumber(rate)}٪`,
      `امتیاز کل: ${faNumber(user.points)}`,
    ].join("\n");
  }

  async leaderboard(): Promise<string> {
    const rows = await this.db.leaderboard();
    if (!rows.length) return "هنوز هیچ بازی‌ای ثبت نشده است.";
    const medals = ["🥇", "🥈", "🥉"];
    const lines = ["🏆 <b>برترین بازیکنان</b>", ""];
    rows.forEach((u, i) => {
      const medal = i < 3 ? medals[i] : `${faNumber(i + 1)}.`;
      lines.push(
        `${medal} ${escapeHtml(u.first_name ?? u.username ?? "بازیکن")} — ${faNumber(u.wins)} برد از ${faNumber(u.games_played)} بازی`,
      );
    });
    return lines.join("\n");
  }

  botLink(sessionId: string): string {
    return `https://t.me/${this.opts.botUsername ?? "hydrogameofficialbot"}?start=join_${sessionId}`;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cardLabelSafe(code: string): string {
  try {
    return cardLabel(code);
  } catch {
    return code;
  }
}

/** End-to-end tests: Telegram update → handler → engine → D1 → rendered messages. */

import { beforeEach, describe, expect, it } from "vitest";
import { UpdateHandler } from "../src/handlers";
import { GameService } from "../src/service";
import { Storage } from "../src/storage";
import type { TelegramClient } from "../src/telegram";
import { makeD1 } from "./d1";
import { FakeTelegram, callback, message, user } from "./fake-telegram";

const GROUP = -100123;
const users = {
  ali: user(1, "علی"),
  sara: user(2, "سارا"),
  reza: user(3, "رضا"),
  nina: user(4, "نینا"),
};

async function setup() {
  const d1 = makeD1();
  const db = new Storage(d1);
  await db.init();
  const tg = new FakeTelegram();
  const service = new GameService(tg as unknown as TelegramClient, db, {
    botUsername: "hydrogameofficialbot",
    lobbyTimeout: 180,
  });
  const handler = new UpdateHandler(tg as unknown as TelegramClient, db, service);
  return { db, tg, service, handler };
}

describe("lobby flow", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it("creates a lobby in a group", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    const session = await ctx.db.getActiveSession(GROUP);
    expect(session).not.toBeNull();
    expect(session!.status).toBe("lobby");
    expect(ctx.tg.textsFor(GROUP).some((t) => t.includes("پاسور"))).toBe(true);
    expect(ctx.tg.buttonsFor(GROUP).map((b) => b.callback_data)).toContain(`l:j:${session!.id}`);
  });

  it("lets a second player join with /join", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    await ctx.handler.handle({ update_id: 2, message: message(GROUP, users.sara, "/join") });
    const session = await ctx.db.getActiveSession(GROUP);
    expect(session!.state.players).toEqual([1, 2]);
    expect(session!.state.names).toEqual(["علی", "سارا"]);
  });

  it("rejects a second table in the same chat", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    await ctx.handler.handle({ update_id: 2, message: message(GROUP, users.ali, "/new hokm") });
    expect(ctx.tg.textsFor(GROUP).some((t) => t.includes("در جریان است"))).toBe(true);
  });

  it("does not let a non-owner start the game", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    const session = await ctx.db.getActiveSession(GROUP);
    await ctx.handler.handle({
      update_id: 2,
      callback_query: callback("cb1", users.sara, `l:s:${session!.id}`, GROUP),
    });
    expect((await ctx.db.getSession(session!.id))!.status).toBe("lobby");
    expect(ctx.tg.answered.at(-1)?.alert).toBe(true);
  });

  it("needs four players for hokm", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new hokm") });
    await ctx.handler.handle({ update_id: 2, message: message(GROUP, users.sara, "/join") });
    const session = await ctx.db.getActiveSession(GROUP);
    await ctx.handler.handle({
      update_id: 3,
      callback_query: callback("cb2", users.ali, `l:s:${session!.id}`, GROUP),
    });
    expect(ctx.tg.answered.at(-1)?.text).toContain("حداقل");
  });

  it("joins through a deep link", async () => {
    await ctx.handler.handle({ update_id: 1, message: message(1, users.ali, "/new pasur") });
    const session = await ctx.db.getActiveSession(1);
    await ctx.handler.handle({
      update_id: 2,
      message: message(5, user(5, "مینا"), `/start join_${session!.id}`),
    });
    const reloaded = await ctx.db.getSession(session!.id);
    expect(reloaded!.state.players).toEqual([1, 5]);
    expect(ctx.tg.textsFor(5).some((t) => t.includes("نشستید"))).toBe(true);
  });
});

describe("playing a full pasur match", () => {
  it("walks the whole game through inline buttons", async () => {
    const { db, tg, service, handler } = await setup();
    await handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    await handler.handle({ update_id: 2, message: message(GROUP, users.sara, "/join") });
    const session = await db.getActiveSession(GROUP);
    await handler.handle({
      update_id: 3,
      callback_query: callback("cb3", users.ali, `l:s:${session!.id}`, GROUP),
    });

    let steps = 0;
    while (steps++ < 1600) {
      const current = await db.getSession(session!.id);
      if (!current || current.status !== "running") break;
      const engine = service.engine(current);
      if (engine.finished) break;
      const seat = engine.currentSeat()!;
      const uid = (current.state.players as number[])[seat];
      // the hand message lives in that player's private chat
      const buttons = tg.buttonsFor(uid);
      const play = buttons.filter((b) => b.callback_data.startsWith("g:p:"));
      const capture = buttons.filter((b) => b.callback_data.startsWith("g:c:"));
      const action = play[0] ?? capture[0];
      expect(action, `no button for seat ${seat}`).toBeDefined();
      await handler.handle({
        update_id: 100 + steps,
        callback_query: callback(`cb${steps}`, user(uid, `P${uid}`), action.callback_data, uid),
      });
    }

    const finished = await db.getSession(session!.id);
    expect(finished!.status).toBe("finished");
    const ali = await db.getUser(1);
    expect(ali!.games_played).toBe(1);
    expect(await service.leaderboard()).toContain("برترین");
  });
});

describe("timeouts", () => {
  it("auto-plays a turn whose deadline has passed", async () => {
    const { db, service, handler } = await setup();
    await handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    await handler.handle({ update_id: 2, message: message(GROUP, users.sara, "/join") });
    const session = await db.getActiveSession(GROUP);
    await handler.handle({
      update_id: 3,
      callback_query: callback("cb", users.ali, `l:s:${session!.id}`, GROUP),
    });

    const before = (await db.getSession(session!.id))!.state;
    const handSize = before.hands[before.turn].length;
    const acted = await service.processTimeouts(Math.floor(Date.now() / 1000) + 999);
    expect(acted).toBe(1);
    const after = (await db.getSession(session!.id))!;
    expect(after.state.hands[before.turn].length).toBe(handSize - 1);
  });

  it("cancels a stale lobby", async () => {
    const { db, service, handler } = await setup();
    await handler.handle({ update_id: 1, message: message(GROUP, users.ali, "/new pasur") });
    const acted = await service.processTimeouts(Math.floor(Date.now() / 1000) + 999);
    expect(acted).toBe(1);
    expect((await db.getActiveSession(GROUP))).toBeNull();
  });
});

describe("stats", () => {
  it("returns null for a brand new user", async () => {
    const { service } = await setup();
    expect(await service.stats(999)).toBeNull();
  });
});

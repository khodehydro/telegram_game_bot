/**
 * Cloudflare Worker entry point.
 *
 *   POST /webhook   ← Telegram (secret-token protected)
 *   GET  /health    ← healthcheck
 *   GET  /setup     ← one-shot webhook + command registration (SETUP_TOKEN)
 *   scheduled()     ← cron: turn/lobby timeouts
 */

import { UpdateHandler } from "./handlers";
import { GameService } from "./service";
import { Storage } from "./storage";
import { TelegramClient, TgUpdate } from "./telegram";

export interface Env {
  BOT_TOKEN: string;
  DB: D1Database;
  WEBHOOK_SECRET?: string;
  SETUP_TOKEN?: string;
  BOT_USERNAME?: string;
  TURN_TIMEOUT?: string;
  LOBBY_TIMEOUT?: string;
}

// Per-isolate caches: avoids an extra Bot API call and DDL round-trip per update.
let cachedUsername: string | null = null;
let schemaReady = false;

const COMMANDS = [
  { command: "new", description: "ساخت میز بازی (پاسور / حکم)" },
  { command: "join", description: "نشستن سر میز" },
  { command: "cancel", description: "لغو میز" },
  { command: "rules", description: "قوانین بازی‌ها" },
  { command: "stats", description: "آمار من" },
  { command: "top", description: "برترین بازیکنان" },
  { command: "help", description: "راهنما" },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function build(env: Env) {
  const tg = new TelegramClient(env.BOT_TOKEN);
  const db = new Storage(env.DB);
  if (!schemaReady) {
    await db.init();
    schemaReady = true;
  }
  if (!cachedUsername) {
    if (env.BOT_USERNAME) {
      cachedUsername = env.BOT_USERNAME;
    } else {
      try {
        cachedUsername = (await tg.getMe()).username ?? null;
      } catch {
        cachedUsername = null; // retry on the next request
      }
    }
  }
  const service = new GameService(tg, db, {
    lobbyTimeout: Number(env.LOBBY_TIMEOUT ?? 180),
    turnTimeout: Number(env.TURN_TIMEOUT ?? 45),
    botUsername: cachedUsername ?? undefined,
  });
  return { tg, db, service };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "telegram-card-games", runtime: "cloudflare-worker" });
    }

    if (url.pathname === "/setup") {
      if (!env.SETUP_TOKEN || url.searchParams.get("token") !== env.SETUP_TOKEN) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
      const { tg } = await build(env);
      const webhookUrl = `${url.origin}/webhook`;
      await tg.setWebhook(webhookUrl, env.WEBHOOK_SECRET);
      await tg.setMyCommands(COMMANDS);
      const me = await tg.getMe();
      return json({ ok: true, webhook: webhookUrl, bot: me.username });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (env.WEBHOOK_SECRET) {
        const header = request.headers.get("x-telegram-bot-api-secret-token");
        if (header !== env.WEBHOOK_SECRET) return json({ ok: false, error: "bad secret" }, 401);
      }
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return json({ ok: false, error: "invalid json" }, 400);
      }
      try {
        const { tg, db, service } = await build(env);
        const handler = new UpdateHandler(tg, db, service);
        await handler.handle(update);
      } catch (err) {
        // Always ack: otherwise Telegram retries the update forever.
        console.error("update failed", err);
      }
      return json({ ok: true });
    }

    return new Response(
      "🎴 Telegram card games worker is running.\nhealth: /health\nwebhook: POST /webhook\n",
      { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const { service } = await build(env);
          const acted = await service.processTimeouts();
          if (acted) console.log(`auto-played ${acted} timed-out turn(s)`);
        } catch (err) {
          console.error("scheduled sweep failed", err);
        }
      })(),
    );
  },
};

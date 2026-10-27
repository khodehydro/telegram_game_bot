/**
 * نقطهٔ ورود Worker:
 *   GET  /health          → سلامت سرویس
 *   GET  /setup?token=…   → ثبت وبهوک + منوی ربات + دکمهٔ مینی‌اپ (یک‌بار)
 *   POST /webhook         → آپدیت‌های تلگرام
 *   *    /api/*           → REST مینی‌اپ
 *   *                     → فایل‌های استاتیک مینی‌اپ (public/)
 */

import { Env, json, routeApi, fail, Ctx } from "./api";
import { handleUpdate } from "./bot";
import { Store } from "./db";
import { BotApi, TgUpdate } from "./telegram";

export interface FullEnv extends Env {
  ASSETS?: Fetcher;
}

let schemaReady = false;

async function storeFor(env: FullEnv): Promise<Store> {
  const store = new Store(env.DB);
  if (!schemaReady) {
    try {
      await store.init();
      schemaReady = true;
    } catch (err) {
      console.error("schema init failed", err);
    }
  }
  return store;
}

async function handleSetup(url: URL, env: FullEnv): Promise<Response> {
  if (!env.SETUP_TOKEN || url.searchParams.get("token") !== env.SETUP_TOKEN) {
    return fail("unauthorized", "توکن تنظیمات نامعتبر است.", 401);
  }
  if (!env.BOT_TOKEN) return fail("no_bot_token", "BOT_TOKEN تنظیم نشده است.", 500);

  const origin = url.origin;
  const api = new BotApi(env.BOT_TOKEN);
  try {
    const me = await api.getMe();
    const appUrl = env.APP_URL || origin;
    await api.setWebhook(`${origin}/webhook`, env.WEBHOOK_SECRET);
    await api.setMyCommands([
      { command: "start", description: "شروع بازی و منو" },
      { command: "today", description: "مرحلهٔ امروز" },
      { command: "top", description: "جدول برترین‌ها" },
      { command: "stats", description: "آمار من" },
      { command: "rules", description: "راهنمای بازی" },
    ]);
    await api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "🎮 بازی",
        web_app: { url: appUrl },
      },
    });
    return json({
      ok: true,
      bot: me.username,
      webhook: `${origin}/webhook`,
      app: appUrl,
    });
  } catch (err) {
    return fail(
      "telegram_error",
      `ارتباط با تلگرام ناموفق بود: ${(err as Error).message}`,
      502,
    );
  }
}

export default {
  async fetch(request: Request, env: FullEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "kalame-bazi", version: 1 });
    }

    if (url.pathname === "/setup") return handleSetup(url, env);

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (env.WEBHOOK_SECRET) {
        const header = request.headers.get("x-telegram-bot-api-secret-token");
        if (header !== env.WEBHOOK_SECRET) return fail("bad_secret", "secret نامعتبر", 401);
      }
      let update: TgUpdate;
      try {
        update = (await request.json()) as TgUpdate;
      } catch {
        return fail("bad_json", "بدنهٔ نامعتبر", 400);
      }
      try {
        const store = await storeFor(env);
        await handleUpdate(update, env, store);
      } catch (err) {
        console.error("update failed", err);
      }
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      const ctx: Ctx = { env, store: await storeFor(env), request, url };
      try {
        return await routeApi(ctx);
      } catch (err) {
        console.error("api error", err);
        return fail("server_error", "خطای سرور؛ دوباره تلاش کنید.", 500);
      }
    }

    // بقیهٔ مسیرها: فایل‌های استاتیک مینی‌اپ
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      if (!url.pathname.includes(".")) {
        const indexUrl = new URL("/index.html", url);
        return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
      return asset;
    }

    return new Response("Kalame Bazi worker is running. UI assets are not configured.", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

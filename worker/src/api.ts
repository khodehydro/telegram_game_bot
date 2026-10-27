/** REST API مینی‌اپ؛ همهٔ داوری‌ها سمت سرور انجام می‌شود. */

import { verifyInitData, WebAppUser } from "./auth";
import { PlayerRow, Store } from "./db";
import {
  COMPLETE_COINS,
  COMPLETE_POINTS,
  HINT_COST,
  LEVEL_COUNT,
  dailyLevelNumber,
  getLevel,
  judgeGuess,
  normalize,
  pickHint,
  slotsOf,
  tehranDay,
} from "./levels";

export interface Env {
  BOT_TOKEN: string;
  DB: D1Database;
  WEBHOOK_SECRET?: string;
  SETUP_TOKEN?: string;
  APP_URL?: string;
  BOT_USERNAME?: string;
  DEV_AUTH?: string;
}

export interface Ctx {
  env: Env;
  store: Store;
  request: Request;
  url: URL;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function fail(error: string, message: string, status = 400): Response {
  return json({ ok: false, error, message }, status);
}

export function playerView(player: PlayerRow) {
  return {
    id: player.id,
    name: player.first_name ?? player.username ?? "بازیکن",
    username: player.username,
    photo: player.photo_url,
    coins: player.coins,
    points: player.total_points,
    level: player.level,
    streak: player.streak,
    hints: player.hints,
  };
}

/** کاربر را از هدر initData استخراج می‌کند (یا در حالت dev از هدر تست) */
export async function authenticate(ctx: Ctx): Promise<WebAppUser | Response> {
  if (ctx.env.DEV_AUTH === "1") {
    const dev = ctx.request.headers.get("x-dev-user");
    if (dev) {
      try {
        const parsed = JSON.parse(decodeURIComponent(dev)) as WebAppUser;
        if (typeof parsed.id === "number") return parsed;
      } catch {
        /* ignore */
      }
    }
  }
  const initData =
    ctx.request.headers.get("x-init-data") ?? ctx.url.searchParams.get("init_data") ?? "";
  const result = await verifyInitData(initData, ctx.env.BOT_TOKEN);
  if (!result.ok || !result.user) {
    return fail("unauthorized", "اعتبارسنجی تلگرام ناموفق بود؛ مینی‌اپ را از داخل تلگرام باز کنید.", 401);
  }
  return result.user;
}

// ------------------------------------------------------------------ handlers
export async function handleMe(ctx: Ctx): Promise<Response> {
  const auth = await authenticate(ctx);
  if (auth instanceof Response) return auth;

  let player = await ctx.store.ensurePlayer(auth);
  player = await ctx.store.touchStreak(player);
  const today = await ctx.store.todayPoints(player.id);
  const rank = await ctx.store.todayRank(player.id);

  return json({
    ok: true,
    player: playerView(player),
    today: { points: today, rank },
    levels: LEVEL_COUNT,
    daily: dailyLevelNumber(),
    botUsername: ctx.env.BOT_USERNAME ?? "",
  });
}

export async function handleLevel(ctx: Ctx): Promise<Response> {
  const auth = await authenticate(ctx);
  if (auth instanceof Response) return auth;
  const n = Number(ctx.url.searchParams.get("n") ?? "1");
  const level = getLevel(n);
  const player = await ctx.store.ensurePlayer(auth);
  const progress = await ctx.store.getProgress(player.id, level.id);
  const solved = progress.words
    .map((word) => ({
      index: level.targets.findIndex((target) => normalize(target) === normalize(word)),
      word,
    }))
    .filter((item) => item.index >= 0);
  const bonusFound = progress.words.filter(
    (word) => !level.targets.some((target) => normalize(target) === normalize(word)),
  );

  return json({
    ok: true,
    level: {
      id: level.id,
      letters: level.letters,
      slots: slotsOf(level),
      solved,
      bonusFound,
      hints: progress.hints,
      complete: level.targets.every((w) => progress.words.includes(w)),
      total: LEVEL_COUNT,
    },
    player: playerView(player),
  });
}

export async function handleGuess(ctx: Ctx): Promise<Response> {
  const auth = await authenticate(ctx);
  if (auth instanceof Response) return auth;

  let body: { level?: number; word?: string };
  try {
    body = (await ctx.request.json()) as { level?: number; word?: string };
  } catch {
    return fail("bad_body", "درخواست نامعتبر است.");
  }

  const level = getLevel(Number(body.level ?? 1));
  const player = await ctx.store.ensurePlayer(auth);
  const progress = await ctx.store.getProgress(player.id, level.id);
  const result = judgeGuess(level, String(body.word ?? ""), progress.words);

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_a_word: "این کلمه در فرهنگ‌لغت بازی نیست",
      not_in_wheel: "این کلمه با حروف گردونه ساخته نمی‌شود",
      already_found: "این کلمه را قبلاً پیدا کرده‌اید",
      too_short: "کلمه باید حداقل ۳ حرف باشد",
    };
    return json(
      { ok: false, error: result.reason, message: messages[result.reason ?? ""] ?? "کلمه پذیرفته نشد" },
      200,
    );
  }

  progress.words = [...progress.words, result.word!];
  let levelComplete = false;

  const foundSet = new Set(progress.words.map((w) => normalize(w)));
  const allFound = level.targets.every((w) => foundSet.has(normalize(w)));
  if (allFound && !progress.claimed) {
    progress.claimed = 1;
    levelComplete = true;
  }

  const awardedPoints = (result.points ?? 0) + (levelComplete ? COMPLETE_POINTS : 0);
  const awardedCoins = (result.coins ?? 0) + (levelComplete ? COMPLETE_COINS : 0);

  await ctx.store.saveProgress(progress);
  // امتیاز جایزهٔ تکمیل مرحله هم در plays ثبت می‌شود تا جدول روزانه با امتیاز کل یکی باشد
  await ctx.store.logPlay({
    userId: player.id,
    level: level.id,
    word: result.word!,
    points: awardedPoints,
    bonus: Boolean(result.isBonus),
  });
  await ctx.store.addPoints(player.id, awardedPoints);
  await ctx.store.addCoins(player.id, awardedCoins);
  if (levelComplete && level.id >= player.level) {
    await ctx.store.setLevel(player.id, Math.min(level.id + 1, LEVEL_COUNT));
  }

  const fresh = (await ctx.store.getPlayer(player.id))!;
  const today = await ctx.store.todayPoints(player.id);

  return json({
    ok: true,
    word: result.word,
    slotIndex: result.slotIndex,
    points: result.points,
    coins: result.coins,
    isBonus: Boolean(result.isBonus),
    levelComplete,
    completeBonus: levelComplete ? COMPLETE_POINTS : 0,
    completeCoins: levelComplete ? COMPLETE_COINS : 0,
    totalPoints: today,
    player: playerView(fresh),
    found: progress.words,
  });
}

export async function handleHint(ctx: Ctx): Promise<Response> {
  const auth = await authenticate(ctx);
  if (auth instanceof Response) return auth;

  let body: { level?: number };
  try {
    body = (await ctx.request.json()) as { level?: number };
  } catch {
    body = {};
  }
  const level = getLevel(Number(body.level ?? 1));
  const player = await ctx.store.ensurePlayer(auth);

  // اول راهنمای رایگان، بعد سکه
  if (player.hints <= 0 && player.coins < HINT_COST) {
    return json(
      { ok: false, error: "not_enough_coins", message: `برای راهنما ${HINT_COST} سکه لازم است.` },
      200,
    );
  }

  const progress = await ctx.store.getProgress(player.id, level.id);
  const hint = pickHint(level, progress.words, progress.hints);
  if (!hint) {
    return json({ ok: false, error: "no_hint", message: "راهنمای دیگری باقی نمانده." }, 200);
  }

  progress.hints = [...progress.hints, hint];
  await ctx.store.saveProgress(progress);

  let paid = 0;
  if (player.hints > 0) {
    await ctx.store.addHints(player.id, -1);
  } else {
    await ctx.store.addCoins(player.id, -HINT_COST);
    paid = HINT_COST;
  }

  const fresh = (await ctx.store.getPlayer(player.id))!;
  return json({ ok: true, hint, paid, player: playerView(fresh) });
}

export async function handleLeaderboard(ctx: Ctx): Promise<Response> {
  const auth = await authenticate(ctx);
  if (auth instanceof Response) return auth;

  const periodParam = ctx.url.searchParams.get("period") ?? "today";
  const period = periodParam === "week" || periodParam === "all" ? periodParam : "today";
  const rows = await ctx.store.leaderboard(period, 50);
  const me = await ctx.store.ensurePlayer(auth);

  return json({
    ok: true,
    period,
    rows: rows.map((row, i) => ({
      rank: i + 1,
      id: row.id,
      name: row.first_name ?? row.username ?? "بازیکن",
      points: Number(row.points),
      me: row.id === me.id,
    })),
  });
}

export async function routeApi(ctx: Ctx): Promise<Response> {
  const path = ctx.url.pathname;
  if (path === "/api/me") return handleMe(ctx);
  if (path === "/api/level") return handleLevel(ctx);
  if (path === "/api/guess" && ctx.request.method === "POST") return handleGuess(ctx);
  if (path === "/api/hint" && ctx.request.method === "POST") return handleHint(ctx);
  if (path === "/api/leaderboard") return handleLeaderboard(ctx);
  return fail("not_found", "مسیر پیدا نشد", 404);
}

export { tehranDay };

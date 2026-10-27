/**
 * هندلر وب‌هوک تلگرام: /start، /today، /top، /stats، /rules و دکمهٔ مینی‌اپ.
 * پیام‌ها عمداً کم‌تعدادند تا هزینهٔ ارسال برای هزاران کاربر روزانه پایین بماند.
 */

import { Store } from "./db";
import { dailyLevelNumber, getLevel, tehranDay } from "./levels";
import { BotApi, InlineKeyboard, TgCallbackQuery, TgMessage, TgUpdate } from "./telegram";

export interface BotEnv {
  BOT_TOKEN: string;
  APP_URL?: string;
  BOT_USERNAME?: string;
}

const esc = (value: string): string =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function playKeyboard(appUrl?: string): InlineKeyboard | undefined {
  if (!appUrl) return undefined;
  return {
    inline_keyboard: [
      [{ text: "🎮 بازی کن", web_app: { url: appUrl } }],
      [
        { text: "🏆 جدول برترین‌ها", callback_data: "top" },
        { text: "📣 دعوت دوستان", url: shareUrl(appUrl) },
      ],
    ],
  };
}

function dailyKeyboard(appUrl?: string): InlineKeyboard | undefined {
  if (!appUrl) return undefined;
  const sep = appUrl.includes("?") ? "&" : "?";
  return {
    inline_keyboard: [
      [{ text: "📅 مرحلهٔ امروز را بازی کن", web_app: { url: `${appUrl}${sep}daily=1` } }],
      [{ text: "🏆 جدول برترین‌ها", callback_data: "top" }],
    ],
  };
}

function shareUrl(appUrl: string, botUsername?: string): string {
  const text = "با «کلمه‌بازی» حافظه‌ت رو تست کن! 🎮";
  const url = botUsername ? `https://t.me/${botUsername}` : appUrl;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

function welcomeText(name: string, coins: number): string {
  return `سلام <b>${esc(name)}</b> 👋

🎯 <b>کلمه‌بازی</b> — با حروف گردونه، کلمه بساز و مرحله‌ها را باز کن.

• 🔤 با کشیدن انگشت روی حروف، کلمه بساز
• 🎁 کلمه‌های اضافه امتیاز جایزه دارند
• 🔥 هر روز بازی کن تا استریک‌ات بالا برود
• 🏆 در جدول برترین‌ها بالا برو

💰 سکهٔ شما: <b>${coins}</b>

دکمهٔ «🎮 بازی کن» را بزن تا شروع کنیم!`;
}

export const RULES_TEXT = `📖 <b>راهنمای بازی</b>

۱) روی حروف گردونه انگشت را بکش و کلمه بساز؛ با برداشتن انگشت کلمه ثبت می‌شود.
۲) هر کلمهٔ درست، امتیاز و سکه می‌دهد (کلمهٔ بلندتر، امتیاز بیشتر).
۳) کلمه‌هایی که در جای خالی‌ها نیستند هم اگر معتبر باشند «کلمهٔ اضافه» حساب می‌شوند.
۴) با ۴۰ سکه می‌توانی یک حرف از یک کلمه را ببینی (اول ۳ راهنمای رایگان).
۵) با پیدا کردن همهٔ کلمه‌های مرحله، جایزهٔ تکمیل (+۱۰۰ امتیاز و +۲۵ سکه) می‌گیری.
۶) امتیاز روزانه در جدول «امروز» و «این هفته» حساب می‌شود.

موفق باشی! 🍀`;

function leaderboardText(rows: { first_name: string | null; username: string | null; points: number }[]): string {
  if (!rows.length) return "امروز هنوز کسی امتیاز نگرفته — اولین نفر باش! 🥇";
  const medals = ["🥇", "🥈", "🥉"];
  const lines = [`🏆 <b>برترین‌های امروز</b> — ${tehranDay()}`, ""];
  rows.forEach((row, i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    const name = esc(row.first_name ?? row.username ?? "بازیکن");
    lines.push(`${medal} ${name} — <b>${row.points}</b> امتیاز`);
  });
  return lines.join("\n");
}

async function sendLeaderboard(store: Store, api: BotApi, chatId: number, appUrl?: string) {
  const rows = await store.leaderboard("today", 10);
  await api.sendMessage(chatId, leaderboardText(rows), playKeyboard(appUrl));
}

export async function handleUpdate(update: TgUpdate, env: BotEnv, store: Store): Promise<void> {
  const api = new BotApi(env.BOT_TOKEN);
  const appUrl = env.APP_URL;

  if (update.callback_query) {
    await handleCallback(update.callback_query, api, store, appUrl);
    return;
  }

  const message: TgMessage | undefined = update.message;
  if (!message?.from || !message.text) return;

  const text = message.text.trim();
  const [rawCmd] = text.split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();
  const chatId = message.chat.id;

  if (cmd === "/start") {
    const player = await store.ensurePlayer(message.from);
    const touched = await store.touchStreak(player);
    await api.sendMessage(chatId, welcomeText(message.from.first_name, touched.coins), playKeyboard(appUrl));
    return;
  }

  if (cmd === "/rules" || cmd === "/help") {
    await api.sendMessage(chatId, RULES_TEXT, playKeyboard(appUrl));
    return;
  }

  if (cmd === "/today" || cmd === "/daily") {
    const level = getLevel(dailyLevelNumber());
    await api.sendMessage(
      chatId,
      `📅 <b>مرحلهٔ امروز</b>\n\nحروف: ${esc(level.letters.join(" • "))}\nبا دکمهٔ زیر بازی کن و امتیازت را در جدول امروز ثبت کن.`,
      dailyKeyboard(appUrl),
    );
    return;
  }

  if (cmd === "/top") {
    await sendLeaderboard(store, api, chatId, appUrl);
    return;
  }

  if (cmd === "/stats") {
    const player = await store.ensurePlayer(message.from);
    const today = await store.todayPoints(player.id);
    await api.sendMessage(
      chatId,
      [
        `📊 <b>آمار شما</b>`,
        "",
        `مرحله: <b>${player.level}</b>`,
        `امتیاز کل: <b>${player.total_points}</b>`,
        `امتیاز امروز: <b>${today}</b>`,
        `استریک: <b>${player.streak}</b> روز 🔥`,
        `سکه: <b>${player.coins}</b> 💰`,
      ].join("\n"),
      playKeyboard(appUrl),
    );
    return;
  }

  if (!text.startsWith("/")) {
    // پیام متنی آزاد: دکمهٔ بازی را نشان بده
    await api.sendMessage(chatId, "برای شروع، دکمهٔ «🎮 بازی کن» را بزن 👇", playKeyboard(appUrl));
  }
}

async function handleCallback(
  query: TgCallbackQuery,
  api: BotApi,
  store: Store,
  appUrl?: string,
): Promise<void> {
  const chatId = query.message?.chat.id;
  try {
    await api.answerCallbackQuery(query.id, query.data === "top" ? "جدول امروز 👇" : undefined);
    if (chatId && query.data === "top") {
      await sendLeaderboard(store, api, chatId, appUrl);
    }
  } catch (err) {
    console.error("callback failed", err);
  }
}

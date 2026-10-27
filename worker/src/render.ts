/** Persian rendering (port of `bot/render.py`). */

import { Card, SUITS, SUIT_EMOJI, SUIT_FA, faNumber, cardLabel, cardsLine, parseCard } from "./games/cards";
import { BaseGame, GameView } from "./games/base";
import { gameEmoji, nameFa } from "./games/registry";
import { InlineKeyboardMarkup } from "./telegram";

export function suitName(suit: string): string {
  return SUIT_FA[suit as keyof typeof SUIT_FA] ?? suit;
}

export function suitEmoji(suit: string): string {
  return SUIT_EMOJI[suit as keyof typeof SUIT_EMOJI] ?? "";
}

export function namesOf(view: GameView): string[] {
  const names = (view.names as string[]) ?? [];
  return names.length
    ? names
    : (view.players ?? []).map((_, i) => `بازیکن ${faNumber(i + 1)}`);
}

// ------------------------------------------------------------------ lobby
export function lobbyText(
  gameKey: string,
  players: string[],
  minP: number,
  maxP: number,
  isRoom: boolean,
): string {
  const lines = [`${gameEmoji(gameKey)} <b>${nameFa(gameKey)}</b> — میز جدید`, ""];
  if (players.length) {
    lines.push("بازیکنان:");
    players.forEach((name, i) => lines.push(`${faNumber(i + 1)}. ${name}`));
  } else {
    lines.push("هنوز کسی ننشسته!");
  }
  lines.push("", `حداقل ${faNumber(minP)} و حداکثر ${faNumber(maxP)} نفر.`);
  if (isRoom) lines.push("این میز خصوصی است؛ هرکس با لینک دعوت بتواند بپیوندد.");
  lines.push("", "برای نشستن روی «می‌نشینم» بزنید.");
  return lines.join("\n");
}

export function lobbyKeyboard(
  sessionId: string,
  isOwner: boolean,
): InlineKeyboardMarkup {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: "🪑 می‌نشینم", callback_data: `l:j:${sessionId}` }],
  ];
  if (isOwner) {
    rows.push([
      { text: "▶️ شروع بازی", callback_data: `l:s:${sessionId}` },
      { text: "🗑 لغو", callback_data: `l:c:${sessionId}` },
    ]);
  } else {
    rows.push([{ text: "🚪 خروج", callback_data: `l:l:${sessionId}` }]);
  }
  return { inline_keyboard: rows };
}

// ------------------------------------------------------------------ table
export function tableText(view: GameView, note = ""): string {
  const names = namesOf(view);
  return view.game === "pasur" ? pasurTable(view, names, note) : hokmTable(view, names, note);
}

function pasurTable(view: GameView, names: string[], note: string): string {
  const table = (view.table as string[]) ?? [];
  const scores = (view.scores as number[]) ?? [];
  const surs = (view.surs as number[]) ?? [];
  const counts = (view.counts as number[]) ?? [];
  const lines = [`🎣 <b>پاسور</b> — دور ${faNumber(((view.round as number) ?? 0) + 1)}`, ""];
  lines.push(`🃏 <b>روی زمین:</b> ${cardsLine(table)}`);
  const turn = view.turn as number | null;
  if (!view.finished && turn !== null && turn !== undefined && turn < names.length) {
    lines.push(`🎯 <b>نوبت:</b> ${names[turn]}`);
  }
  if (view.teams && names.length === 4) {
    lines.push(
      "",
      `👥 تیم ${names[0]} و ${names[2]} — ${faNumber(scores[0])} امتیاز`,
      `👥 تیم ${names[1]} و ${names[3]} — ${faNumber(scores[1])} امتیاز`,
    );
  } else {
    lines.push("", "📊 " + names.map((n, i) => `${n}: ${faNumber(scores[i] ?? 0)}`).join(" • "));
  }
  if (surs.some((s) => s > 0)) {
    lines.push(
      "⭐ سور: " + names.map((n, i) => (surs[i] ? `${n} ×${faNumber(surs[i])}` : "")).filter(Boolean).join("، "),
    );
  }
  lines.push(
    "",
    "🖐 برگ‌ها: " + names.map((n, i) => `${n}: ${faNumber(counts[i] ?? 0)}`).join(" • "),
    `🎴 باقی مانده در پاکت: ${faNumber((view.deck_left as number) ?? 0)}`,
  );
  if (note) lines.push("", note);
  return lines.join("\n");
}

function hokmTable(view: GameView, names: string[], note: string): string {
  const trick = (view.trick as { seat: number; card: string }[]) ?? [];
  const tw = (view.tricks_won as number[]) ?? [0, 0, 0, 0];
  const sc = (view.scores as number[]) ?? [0, 0];
  const lines = [`👑 <b>حکم</b> — دست ${faNumber((view.round as number) ?? 1)}`, ""];
  const trump = view.trump as string | null;
  lines.push(
    trump
      ? `🃏 <b>حکم:</b> ${suitEmoji(trump)} ${suitName(trump)}`
      : "🃏 <b>حکم:</b> هنوز انتخاب نشده",
  );
  lines.push(`👑 <b>حاکم:</b> ${names[view.hakem as number] ?? "?"}`);
  lines.push(
    trick.length
      ? "🎯 <b>دست کنونی:</b> " + trick.map((p) => `${names[p.seat]}: ${cardLabel(p.card)}`).join("، ")
      : "🎯 <b>دست کنونی:</b> —",
  );
  if (view.phase === "playing" && view.turn !== null && view.turn !== undefined) {
    lines.push(`⏳ <b>نوبت:</b> ${names[view.turn as number] ?? "?"}`);
  }
  lines.push(
    "",
    `🏆 دست‌های برده — تیم ${names[0]} و ${names[2]}: ${faNumber(tw[0] + tw[2])}`,
    `🏆 دست‌های برده — تیم ${names[1]} و ${names[3]}: ${faNumber(tw[1] + tw[3])}`,
    "",
    `📊 امتیاز تیم ${names[0]}: ${faNumber(sc[0] ?? 0)}   |   امتیاز تیم ۲: ${faNumber(sc[1] ?? 0)}`,
  );
  if (note) lines.push("", note);
  return lines.join("\n");
}

// ------------------------------------------------------------------ hands
export function handText(view: GameView, seat: number): string {
  const names = namesOf(view);
  const hand = (view.hand as string[]) ?? [];
  const myTurn = view.turn === seat && !view.finished;
  const header = myTurn ? "🟢 نوبت شماست!" : "⏳ منتظر حرکت بقیه...";

  if (view.game === "pasur") {
    return [
      "🎣 <b>پاسور</b> — برگ‌های شما",
      `🃏 روی زمین: ${cardsLine((view.table as string[]) ?? [])}`,
      "",
      cardsLine(hand, "   "),
      "",
      header,
      `📊 امتیاز: ${faNumber(((view.scores as number[]) ?? [])[seat] ?? 0)}`,
    ].join("\n");
  }

  const body = ["👑 <b>حکم</b> — برگ‌های شما"];
  const trump = view.trump as string | null;
  if (trump) body.push(`🃏 حکم: ${suitEmoji(trump)} ${suitName(trump)}`);
  const trick = (view.trick as { seat: number; card: string }[]) ?? [];
  if (trick.length) {
    body.push("🎯 روی میز: " + trick.map((p) => `${names[p.seat]}: ${cardLabel(p.card)}`).join("، "));
  }
  body.push("", cardsLine(hand, "   "), "", header);
  return body.join("\n");
}

export function handKeyboard(
  game: BaseGame,
  view: GameView,
  sessionId: string,
  seat: number,
): InlineKeyboardMarkup | null {
  if (view.finished) return null;
  if (game.gameKey === "hokm" && view.phase === "trump") {
    if (seat !== view.hakem) return null;
    return {
      inline_keyboard: [
        SUITS.map((s) => ({
          text: `${suitEmoji(s)} ${suitName(s)}`,
          callback_data: `g:t:${sessionId}:${s}`,
        })),
      ],
    };
  }
  if (view.turn !== seat) return null;

  const hand = (view.hand as string[]) ?? [];
  if (!hand.length) return null;

  const rows: { text: string; callback_data: string }[][] = [];
  for (const suit of SUITS) {
    const row = hand
      .filter((c) => parseCard(c).suit === suit)
      .map((c) => ({ text: cardLabel(c), callback_data: `g:p:${sessionId}:${c}` }));
    if (row.length) rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function captureKeyboard(options: string[][], sessionId: string): InlineKeyboardMarkup {
  const rows = options.map((opt, idx) => [
    {
      text: `بگیر ${cardsLine(opt, " + ")}`,
      callback_data: `g:c:${sessionId}:${idx}`,
    },
  ]);
  rows.push([{ text: "↩️ بازگشت", callback_data: `g:b:${sessionId}` }]);
  return { inline_keyboard: rows };
}

export function finishedKeyboard(gameKey: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: `🔁 بازی جدید (${nameFa(gameKey)})`, callback_data: `l:n:${gameKey}` }],
    ],
  };
}

export function mainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "🎣 پاسور", callback_data: "menu:new:pasur" },
        { text: "👑 حکم", callback_data: "menu:new:hokm" },
      ],
      [
        { text: "📊 آمار من", callback_data: "menu:stats" },
        { text: "🏆 برترین‌ها", callback_data: "menu:top" },
      ],
      [{ text: "📖 قوانین", callback_data: "menu:rules" }],
    ],
  };
}

export function cardText(code: string): string {
  const card: Card = parseCard(code);
  return cardLabel(code);
}

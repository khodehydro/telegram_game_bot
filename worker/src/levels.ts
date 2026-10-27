/**
 * منطق مرحله‌ها و امتیازدهی (سمت سرور، ضدتقلب).
 *
 * کلاینت هرگز لیست کلمات هدف را نمی‌گیرد؛ فقط «نقشهٔ جای خالی‌ها» را می‌گیرد.
 * داوری کلمه، امتیاز و سکه فقط اینجا محاسبه می‌شود.
 */

import levelsData from "./data/levels.json";

export interface Level {
  id: number;
  letters: string[];
  targets: string[];
  bonus: string[];
}

const LEVELS: Level[] = (levelsData as { levels: Level[] }).levels;

export const LEVEL_COUNT = LEVELS.length;

/** امتیاز هر واژه بر اساس طولش */
export const WORD_POINTS: Record<number, number> = {
  3: 10,
  4: 20,
  5: 35,
  6: 55,
  7: 80,
};

export const BONUS_POINTS = 3;
export const COMPLETE_POINTS = 100;
export const COMPLETE_COINS = 25;
export const HINT_COST = 40;
export const START_COINS = 120;

/** نرمال‌سازی ورودی کاربر: ی/ک عربی، حذف نیم‌فاصله و فاصله‌ها */
export function normalize(word: string): string {
  return String(word ?? "")
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ی")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[\u200c\u200d\u200e\u200f\s]/g, "")
    .replace(/[ًٌٍَُِّْـ]/g, "");
}

export function getLevel(n: number): Level {
  const id = Math.min(Math.max(1, Math.floor(n) || 1), LEVEL_COUNT);
  return LEVELS[id - 1];
}

/**
 * «نقشهٔ جای خالی»: برای هر واژهٔ هدف طولش را می‌دهیم؛ ترتیبش پایدار است
 * (مرتب‌شده بر اساس طول و سپس الفبا) تا سرور و کلاینت یک ایندکس مشترک داشته باشند.
 */
export function slotsOf(level: Level): { length: number; index: number }[] {
  return level.targets.map((word, index) => ({ length: word.length, index }));
}

export function isTarget(level: Level, word: string): boolean {
  const target = normalize(word);
  return level.targets.some((w) => normalize(w) === target);
}

export function isBonus(level: Level, word: string): boolean {
  const target = normalize(word);
  return level.bonus.some((w) => normalize(w) === target);
}

export function wordPoints(word: string): number {
  return WORD_POINTS[word.length] ?? 10;
}

/** آیا واژه فقط از حروف گردونه ساخته می‌شود؟ */
export function fitsWheel(letterLimit: Record<string, number>, word: string): boolean {
  const need: Record<string, number> = {};
  for (const ch of word) need[ch] = (need[ch] ?? 0) + 1;
  for (const [ch, count] of Object.entries(need)) {
    if ((letterLimit[ch] ?? 0) < count) return false;
  }
  return true;
}

export function letterLimitOf(level: Level): Record<string, number> {
  const limit: Record<string, number> = {};
  // حروف گردونه نرمال‌اند ولی برای اطمینان «آ/أ/…» را هم یکدست می‌کنیم
  for (const raw of level.letters) {
    for (const ch of normalize(raw)) limit[ch] = (limit[ch] ?? 0) + 1;
  }
  return limit;
}

export interface GuessResult {
  ok: boolean;
  reason?: "not_a_word" | "not_in_wheel" | "already_found" | "too_short";
  word?: string;
  slotIndex?: number;
  points?: number;
  coins?: number;
  isBonus?: boolean;
  levelComplete?: boolean;
}

/** داوری یک حدس؛ وضعیت حل‌شده‌ها از بیرون داده می‌شود (بدون side effect) */
export function judgeGuess(
  level: Level,
  rawWord: string,
  foundWords: string[],
): GuessResult {
  const word = normalize(rawWord);
  if (word.length < 3) return { ok: false, reason: "too_short" };

  const limit = letterLimitOf(level);
  if (!fitsWheel(limit, word)) return { ok: false, reason: "not_in_wheel" };

  const found = new Set(foundWords.map((w) => normalize(w)));
  const slotIndex = level.targets.findIndex((w) => normalize(w) === word);

  if (slotIndex !== -1) {
    if (found.has(word)) return { ok: false, reason: "already_found" };
    const points = wordPoints(word);
    return {
      ok: true,
      word: level.targets[slotIndex],
      slotIndex,
      points,
      coins: Math.max(1, Math.round(points / 10)),
      isBonus: false,
      levelComplete: level.targets.every((w) => normalize(w) === word || found.has(normalize(w))),
    };
  }

  const bonusWord = level.bonus.find((w) => normalize(w) === word);
  if (bonusWord) {
    if (found.has(word)) return { ok: false, reason: "already_found" };
    return { ok: true, word: bonusWord, points: BONUS_POINTS, coins: 1, isBonus: true };
  }

  return { ok: false, reason: "not_a_word" };
}

/** کدام حرف از کدام واژهٔ حل‌نشده لو برود؟ (برای راهنما) */
export function pickHint(
  level: Level,
  foundWords: string[],
  revealed: { index: number; position: number }[],
): { index: number; position: number; letter: string } | null {
  const found = new Set(foundWords.map((w) => normalize(w)));
  const taken = new Set(revealed.map((r) => `${r.index}:${r.position}`));

  for (let index = 0; index < level.targets.length; index++) {
    const word = level.targets[index];
    if (found.has(normalize(word))) continue;
    for (let pos = 0; pos < word.length; pos++) {
      if (!taken.has(`${index}:${pos}`)) {
        return { index, position: pos, letter: word[pos] };
      }
    }
  }
  return null;
}

export function dailyLevelNumber(date = new Date()): number {
  // شمارهٔ مرحلهٔ روز، پایدار برای هر تاریخ میلادی
  const start = Date.UTC(2024, 0, 1);
  const days = Math.floor((date.getTime() - start) / 86_400_000);
  return ((days * 7 + 13) % LEVEL_COUNT) + 1;
}

export function tehranDay(date = new Date()): string {
  // YYYY-MM-DD به وقت تهران (UTC+3:30)
  const shifted = new Date(date.getTime() + 3.5 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

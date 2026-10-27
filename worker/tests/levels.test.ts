import { describe, expect, it } from "vitest";
import levelsData from "../src/data/levels.json";
import {
  LEVEL_COUNT,
  dailyLevelNumber,
  fitsWheel,
  getLevel,
  isBonus,
  isTarget,
  judgeGuess,
  letterLimitOf,
  normalize,
  pickHint,
  slotsOf,
  tehranDay,
  wordPoints,
  type Level,
} from "../src/levels";

const LEVELS = (levelsData as { levels: Level[] }).levels;

describe("normalize", () => {
  it("ي و ك عربی را به فارسی تبدیل می‌کند", () => {
    expect(normalize("كتابي")).toBe("کتابی");
  });

  it("نیم‌فاصله، فاصله و اعراب را حذف می‌کند", () => {
    expect(normalize("می‌ روم")).toBe("میروم");
    expect(normalize("کِتَاب")).toBe("کتاب");
  });

  it("همزه/آ را یکدست می‌کند", () => {
    expect(normalize("آب")).toBe("اب");
    expect(normalize("أب")).toBe("اب");
  });
});

describe("levels data", () => {
  it("۴۰۰ مرحله دارد", () => {
    expect(LEVEL_COUNT).toBe(400);
    expect(LEVELS).toHaveLength(400);
  });

  it("هر مرحله گردونه و جای خالی معتبر دارد", () => {
    for (const level of LEVELS) {
      expect(level.letters.length).toBeGreaterThanOrEqual(6);
      expect(level.letters.length).toBeLessThanOrEqual(8);
      expect(level.targets.length).toBeGreaterThanOrEqual(5);
      expect(new Set(level.targets).size).toBe(level.targets.length);

      const limit = letterLimitOf(level);
      for (const word of [...level.targets, ...level.bonus]) {
        expect(word.length).toBeGreaterThanOrEqual(3);
        // املای نمایشی (آ/ئ/…) هم‌طول شکل نرمال است تا جای خالی‌ها دقیق بمانند
        expect(normalize(word)).toHaveLength(word.length);
        expect(word).not.toContain("\u200c");
        expect(word).not.toContain(" ");
        expect(fitsWheel(limit, normalize(word))).toBe(true);
      }
      expect(new Set(level.targets).size).toBe(level.targets.length);
    }
  });

  it("سختی مرحله‌ها از آسان به سخت زیاد می‌شود", () => {
    const counts = LEVELS.map((level) => level.targets.length);
    const avg = (list: number[]) => list.reduce((sum, n) => sum + n, 0) / list.length;

    expect(counts[0]).toBeLessThanOrEqual(6);
    expect(counts[LEVELS.length - 1]).toBeGreaterThanOrEqual(10);
    expect(Math.max(...counts)).toBeLessThanOrEqual(12);
    expect(avg(counts.slice(0, 100))).toBeLessThan(avg(counts.slice(-100)));

    // مرحله‌های آغازین نباید با کلمه‌های بلند/دشوار شروع شوند
    const earlyMaxWord = Math.max(
      ...LEVELS.slice(0, 30).flatMap((level) => level.targets.map((w) => w.length)),
    );
    expect(earlyMaxWord).toBeLessThanOrEqual(5);
  });

  it("گردونهٔ هر مرحله یکتاست", () => {
    const wheels = LEVELS.map((level) => [...level.letters].sort().join(""));
    expect(new Set(wheels).size).toBe(LEVELS.length);
  });

  it("getLevel شماره را در محدودهٔ مجاز نگه می‌دارد", () => {
    expect(getLevel(-5).id).toBe(1);
    expect(getLevel(9999).id).toBe(LEVEL_COUNT);
    expect(getLevel(2).id).toBe(2);
  });
});

describe("judgeGuess", () => {
  const level: Level = {
    id: 1,
    letters: ["د", "س", "ت", "گ", "ا", "ه"],
    targets: ["دست", "است"],
    bonus: ["ساده"],
  };

  it("کلمهٔ هدف را با ایندکس جای خالی و امتیاز برمی‌گرداند", () => {
    const result = judgeGuess(level, "دست", []);
    expect(result.ok).toBe(true);
    expect(result.word).toBe("دست");
    expect(result.slotIndex).toBe(0);
    expect(result.points).toBe(wordPoints("دست"));
    expect(result.isBonus).toBe(false);
  });

  it("کلمهٔ هدف تکراری رد می‌شود", () => {
    expect(judgeGuess(level, "دست", ["دست"])).toMatchObject({ ok: false, reason: "already_found" });
  });

  it("کلمهٔ اضافه امتیاز جایزه می‌دهد", () => {
    const result = judgeGuess(level, "ساده", []);
    expect(result).toMatchObject({ ok: true, isBonus: true, points: 3 });
  });

  it("حروف بیرون از گردونه رد می‌شود", () => {
    expect(judgeGuess(level, "مادر", [])).toMatchObject({ ok: false, reason: "not_in_wheel" });
  });

  it("کلمهٔ ناموجود رد می‌شود", () => {
    expect(judgeGuess(level, "تاد", [])).toMatchObject({ ok: false, reason: "not_a_word" });
  });

  it("کلمهٔ کوتاه رد می‌شود", () => {
    expect(judgeGuess(level, "دس", [])).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("ورودی عربی/غیرنرمال را نرمال می‌کند", () => {
    expect(judgeGuess(level, " دسـت ", []).word).toBe("دست");
  });

  it("آخرین کلمهٔ هدف، تکمیل مرحله را اعلام می‌کند", () => {
    expect(judgeGuess(level, "است", ["دست"]).levelComplete).toBe(true);
    expect(judgeGuess(level, "دست", []).levelComplete).toBe(false);
  });
});

describe("املای نمایشی و نرمال‌سازی", () => {
  const level: Level = {
    id: 2,
    letters: ["ا", "ب", "د", "س", "ت", "ه", "و", "ر", "ی"],
    targets: ["آبی", "دست"],
    bonus: ["آهو"],
  };

  it("کلمهٔ هدف با آ پذیرفته می‌شود و شکل نمایشی برمی‌گردد", () => {
    const result = judgeGuess(level, "آبی", []);
    expect(result).toMatchObject({ ok: true, word: "آبی", slotIndex: 0 });
  });

  it("همان کلمه با ا هم پذیرفته می‌شود", () => {
    expect(judgeGuess(level, "ابی", [])).toMatchObject({ ok: true, word: "آبی" });
  });

  it("تکراری‌بودن با شکل‌های مختلف ا/آ تشخیص داده می‌شود", () => {
    expect(judgeGuess(level, "ابی", ["آبی"])).toMatchObject({ ok: false, reason: "already_found" });
  });

  it("کلمهٔ اضافه شکل نمایشی برمی‌گرداند", () => {
    expect(judgeGuess(level, "اهو", [])).toMatchObject({ ok: true, word: "آهو", isBonus: true });
  });

  it("pickHint حرف آ را نشان می‌دهد", () => {
    expect(pickHint(level, ["دست"], [])).toEqual({ index: 0, position: 0, letter: "آ" });
  });

  it("isTarget با هر دو شکل کار می‌کند", () => {
    expect(isTarget(level, "ابی")).toBe(true);
    expect(isTarget(level, "آبی")).toBe(true);
    expect(isBonus(level, "اهو")).toBe(true);
  });
});

describe("pickHint", () => {
  const level: Level = {
    id: 1,
    letters: ["د", "س", "ت", "گ", "ا", "ه"],
    targets: ["دست", "است"],
    bonus: [],
  };

  it("حرفی از کلمهٔ حل‌نشده لو می‌دهد", () => {
    const hint = pickHint(level, ["دست"], []);
    expect(hint).toEqual({ index: 1, position: 0, letter: "ا" });
  });

  it("حرف‌های قبلی را تکرار نمی‌کند", () => {
    const hint = pickHint(level, ["دست"], [{ index: 1, position: 0 }]);
    expect(hint).toEqual({ index: 1, position: 1, letter: "س" });
  });

  it("وقتی همه حل شده باشد null می‌دهد", () => {
    expect(pickHint(level, ["دست", "است"], [])).toBeNull();
  });
});

describe("slotsOf", () => {
  it("برای هر کلمه یک جای خالی با طول درست می‌سازد", () => {
    const level: Level = { id: 1, letters: ["ا", "ب", "ت"], targets: ["اب", "تاب"], bonus: [] };
    expect(slotsOf(level)).toEqual([
      { length: 2, index: 0 },
      { length: 3, index: 1 },
    ]);
  });
});

describe("زمان و مرحلهٔ روز", () => {
  it("شمارهٔ مرحلهٔ روز همیشه در محدوده است", () => {
    for (let day = 0; day < 400; day++) {
      const n = dailyLevelNumber(new Date(Date.UTC(2026, 0, 1 + day)));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(LEVEL_COUNT);
    }
  });

  it("شمارهٔ مرحلهٔ روز در یک روز ثابت است", () => {
    const a = dailyLevelNumber(new Date("2026-10-27T08:00:00Z"));
    const b = dailyLevelNumber(new Date("2026-10-27T20:00:00Z"));
    expect(a).toBe(b);
  });

  it("روز تهران با آفست ۳:۳۰ محاسبه می‌شود", () => {
    expect(tehranDay(new Date("2026-10-27T21:00:00Z"))).toBe("2026-10-28");
    expect(tehranDay(new Date("2026-10-27T20:00:00Z"))).toBe("2026-10-27");
  });
});

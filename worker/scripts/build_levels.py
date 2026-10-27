#!/usr/bin/env python3
"""ساخت مرحله‌های بازی «کلمه‌بازی» از دیکشنری فارسی.

ورودی: JSON به شکل {واژه: وزن} (خروجی build_dictionary.py)؛ وزن > 0 یعنی
        «واژهٔ پرکاربرد/شناخته‌شده» و وزن = 0 یعنی کم‌کاربرد (فقط کلمهٔ اضافه).
خروجی: worker/src/data/levels.json

الگوریتم:
  ۱) واژه‌های ۳ تا ۷ حرفی نرمال‌سازی می‌شوند (ی/ک عربی، آ→ا، حذف نیم‌فاصله)
     ولی شکل نمایشیِ درست (آ، ئ، …) برای خروجی نگه داشته می‌شود.
  ۲) برای هر واژهٔ ۶/۷ حرفیِ پرکاربرد یک «گردونه» ساخته می‌شود.
  ۳) همهٔ واژه‌هایی که از حروف گردونه ساخته می‌شوند با ایندکس بیتی پیدا می‌شوند.
  ۴) اهداف مرحله: ترکیبی از واژه‌های ۳ تا ۷ حرفی (حداکثر ۱۴ واژه).
  ۵) بقیهٔ واژه‌ها به‌عنوان «کلمهٔ اضافه» با امتیاز کمتر پذیرفته می‌شوند.

اجرا:
  python scripts/build_levels.py --input data/dictionary.json --out src/data/levels.json --count 400
"""

from __future__ import annotations

import argparse
import collections
import json
import random
import re
import unicodedata

PERSIAN_LETTERS = "ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی"
LETTER_SET = set(PERSIAN_LETTERS)
MAX_LEN = 7
MIN_LEN = 3

TRANSLATE = {
    "ي": "ی", "ك": "ک", "ﻻ": "لا", "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ؤ": "و", "ئ": "ی", "ة": "ه", "ۀ": "ه",
    "\u200c": "", "\u200d": "", "\u200e": "", "\u200f": "",
}
DROP_CHARS = set("ءًٌٍَُِّْـ")

# واژه‌های دستوری که به‌عنوان «هدف» بازی مناسب نیستند
STOPWORDS = set("""و به در از که این با را است من تو برای بود هم تا یک ها شد می یا بر شما همه سال
کرد خود هر یه چه های نه باید دو پس اما اون ای فقط یکی داره کرده دارد چرا کردن اگه او آن ما
شود بودن کنید کنم بکن بودم بودی بشه کنه بکنم بشود شدند کردند بودند آنها ایشان همین همان
شدیم شدید بشیم بشن کسی چیزی وقتی چون اگر ولی لیکن زیرا نیز حتی دیگر آنکه اینکه خب دیگه""".split())

# واژه‌های نامناسب که هرگز نباید در مرحله‌ها بیایند
BANNED = set(
    """
کون کونی کس کص کیر کیری جنده جنده‌گی خایه خایه‌مال گوه گوهی لاشی کثافت چس شاش
گاییدن بگا سکس سکسی واژن کاندوم شهوت شهوانی ممه مادرجنده خواهرجنده حروم‌زاده
حرومزاده بی‌شرف بیشرف بی‌غیرت بیغیرت عوضی آشغال کونده کیرم کصم خایمال پدرسوخته
کسخل کسکش شاشو صدام
""".split()
)


def normalise(word: str) -> str:
    word = unicodedata.normalize("NFC", word)
    for src, dst in TRANSLATE.items():
        word = word.replace(src, dst)
    word = "".join(ch for ch in word if ch not in DROP_CHARS)
    return re.sub(r"\s+", "", word).strip()


def is_clean(word: str) -> bool:
    if not (MIN_LEN <= len(word) <= MAX_LEN):
        return False
    if any(ch not in LETTER_SET for ch in word):
        return False
    if re.search(r"(.)\1\1", word):
        return False
    return True


def load_dictionary(path: str) -> tuple[dict[str, int], dict[str, str]]:
    """وزن‌ها را با کلید نرمال و شکل نمایشی درست برمی‌گرداند."""
    raw = json.load(open(path, encoding="utf-8"))
    weights: dict[str, int] = {}
    display: dict[str, str] = {}
    for word, weight in raw.items():
        norm = normalise(word)
        if not is_clean(norm):
            continue
        if len(word) != len(norm):
            continue
        weights[norm] = max(weights.get(norm, 0), int(weight))
        # شکل دارای آ/همزه را ترجیح بده
        current = display.get(norm)
        if current is None or word.count("آ") > current.count("آ"):
            display[norm] = word
    return weights, display


def build_index(words: dict[str, int]) -> dict[int, list[str]]:
    index: dict[int, list[str]] = collections.defaultdict(list)
    for word in words:
        mask = 0
        for ch in set(word):
            mask |= 1 << PERSIAN_LETTERS.index(ch)
        index[mask].append(word)
    return index


def lookup(wheel: collections.Counter, index: dict[int, list[str]]) -> list[str]:
    letters = list(wheel)
    out: list[str] = []
    for bits in range(1, 1 << len(letters)):
        mask = 0
        for i, ch in enumerate(letters):
            if bits >> i & 1:
                mask |= 1 << PERSIAN_LETTERS.index(ch)
        for word in index.get(mask, ()):
            need = collections.Counter(word)
            if all(wheel[ch] >= c for ch, c in need.items()):
                out.append(word)
    return out


def pick_targets(base: str, common: list[str], limit: int) -> list[str]:
    """ترکیبی از واژه‌های کوتاه تا بلند انتخاب می‌کند تا مرحله متنوع باشد.

    واژه‌هایی که در مرحله‌های قبلی کم‌تر استفاده شده‌اند اولویت دارند تا
    دایرهٔ واژگان بازی در ۴۰۰ مرحله پخش شود و هر مرحله تکراری نشود.
    """
    by_len: dict[int, list[str]] = collections.defaultdict(list)
    for word in common:
        by_len[len(word)].append(word)
    targets: list[str] = [base]

    # سهم هر طول: بلندترها کمتر، کوتاه‌ها بیشتر
    quota = {3: 3, 4: 4, 5: 3, 6: 2, 7: 1}
    for length in (5, 4, 3, 6, 7):
        pool = [w for w in by_len.get(length, []) if w not in targets]
        take = min(quota[length], len(pool), limit - len(targets))
        targets.extend(pool[:take])
        if len(targets) >= limit:
            break
    return targets[:limit]


def level_score(targets: list[str], letters: list[str], weights: dict[str, int]) -> float:
    """امتیاز سختی؛ هرچه کمتر، مرحله آسان‌تر.

    تعداد کلمه‌ها و طولشان بیشترین اثر را دارند و واژه‌های پرکاربرد
    مرحله را آسان‌تر می‌کنند.
    """
    n = len(targets)
    lengths = [len(w) for w in targets]
    avg_len = sum(lengths) / n
    max_len = max(lengths)
    avg_weight = sum(weights.get(w, 0) for w in targets) / n
    return (
        n * 2.0
        + max_len * 2.2
        + avg_len * 1.4
        + len(letters) * 0.9
        - avg_weight / 2500.0
    )


def keep_count_for_rank(rank: int, total: int) -> int:
    """پله‌های تعداد کلمه: شروع ۵ کلمه‌ای، پایان ۱۲ کلمه‌ای."""
    frac = rank / max(1, total - 1)
    if frac < 0.08:
        return 5
    if frac < 0.25:
        return 6
    if frac < 0.60:
        return 7 if rank % 2 == 0 else 8
    return 9 + (rank % 4)


def trim_targets(entry: dict, keep: int, max_bonus: int) -> dict:
    """کوتاه‌ترین/پرتکرارترین کلمه‌ها را نگه می‌دارد و بقیه را «کلمهٔ اضافه» می‌کند."""
    targets = entry["targets"]
    keep = max(5, min(keep, len(targets)))
    kept = targets[:keep]
    dropped = [w for w in targets[keep:] if w not in kept]
    bonus = [w for w in entry["bonus"] if w not in kept]
    bonus = sorted(set(bonus + dropped), key=lambda w: (len(w), w))[:max_bonus]
    return {"letters": entry["letters"], "targets": kept, "bonus": bonus}


def order_by_difficulty(
    entries: list[dict],
    weights: dict[str, int],
    display: dict[str, str],
    *,
    max_bonus: int = 30,
) -> list[dict]:
    """مرحله‌ها را از آسان به سخت می‌چیند و تعداد کلمه‌ها را پله‌ای می‌کند."""
    easy_first = sorted(
        entries, key=lambda e: level_score(e["targets"], e["letters"], weights)
    )
    tiered = []
    for rank, entry in enumerate(easy_first):
        keep = keep_count_for_rank(rank, len(easy_first))
        tiered.append(trim_targets(entry, keep, max_bonus))

    tiered.sort(
        key=lambda e: (
            level_score(e["targets"], e["letters"], weights),
            len(e["targets"]),
        )
    )
    return [
        {
            "letters": entry["letters"],
            "targets": [display.get(w, w) for w in entry["targets"]],
            "bonus": [display.get(w, w) for w in entry["bonus"]],
        }
        for entry in tiered
    ]


def build_levels(
    words: dict[str, int],
    display: dict[str, str] | None = None,
    *,
    target_pool: set[str] | None = None,
    bonus_min_weight: int = 0,
    count: int = 400,
    max_targets: int = 12,
    min_targets: int = 8,
    max_bonus: int = 30,
    seed: int = 7,
) -> list[dict]:
    rng = random.Random(seed)
    display = display or {}
    index = build_index(words)
    pool = target_pool if target_pool is not None else {w for w, v in words.items() if v > 0}
    pool = {w for w in pool if w not in STOPWORDS and w not in BANNED}
    common_weight = {w: words[w] for w in pool if w in words}

    candidates = [w for w in common_weight if len(w) in (6, 7)]
    candidates.sort(key=lambda w: -common_weight[w])

    seen: set[tuple[str, ...]] = set()
    usage: collections.Counter[str] = collections.Counter()
    levels: list[dict] = []

    for base in candidates:
        if len(levels) >= count:
            break
        wheel = collections.Counter(base)
        if len(wheel) < 6 or any(c > 2 for c in wheel.values()):
            continue
        key = tuple(sorted(wheel.elements()))
        if key in seen:
            continue

        found = lookup(wheel, index)
        common = [w for w in found if w in common_weight]
        if len(common) < min_targets:
            continue

        common.sort(key=lambda w: (usage[w] // 2, -common_weight[w]))
        fresh = [w for w in common if usage[w] < 4]
        if len(fresh) >= min_targets:
            common = fresh
        targets = pick_targets(base, common, max_targets)
        if len(targets) < min_targets:
            continue

        # کلمه‌های اضافه: واژه‌های ۴ حرف و بیشترِ دیکشنری که در اهداف نیستند
        bonus = [
            w
            for w in found
            if w not in targets
            and len(w) >= 4
            and w not in STOPWORDS
            and w not in BANNED
            and words.get(w, 0) >= bonus_min_weight
        ]
        bonus.sort(key=lambda w: -words.get(w, 0))
        bonus = bonus[:max_bonus]

        letters = list(wheel.elements())
        rng.shuffle(letters)

        targets.sort(key=lambda w: (len(w), -common_weight[w]))
        bonus.sort(key=lambda w: (len(w), w))
        levels.append({"letters": letters, "targets": targets, "bonus": bonus})
        usage.update(targets)
        seen.add(key)

    levels = order_by_difficulty(levels, words, display, max_bonus=max_bonus)
    for i, lv in enumerate(levels, 1):
        lv["id"] = i
    return levels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--count", type=int, default=400)
    parser.add_argument("--max-targets", type=int, default=14)
    parser.add_argument("--min-weight", type=int, default=0, help="حداقل وزن واژه‌های هدف")
    parser.add_argument(
        "--bonus-min-weight", type=int, default=0, help="حداقل وزن کلمه‌های اضافه"
    )
    args = parser.parse_args()

    words, display = load_dictionary(args.input)
    target_pool = {w for w, v in words.items() if v >= args.min_weight}
    print(f"dictionary: {len(words)} words (3-7 letters)")

    levels = build_levels(
        words,
        display=display,
        target_pool=target_pool,
        bonus_min_weight=args.bonus_min_weight,
        count=args.count,
        max_targets=args.max_targets,
    )
    print(f"levels: {len(levels)}")

    payload = {"version": 1, "levels": levels}
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    if levels:
        sizes = collections.Counter(len(lv["targets"]) for lv in levels)
        print("targets per level:", dict(sorted(sizes.items())))
        print("sample:", json.dumps(levels[0], ensure_ascii=False)[:400])


if __name__ == "__main__":
    main()

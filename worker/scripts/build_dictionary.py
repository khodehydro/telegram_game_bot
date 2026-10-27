#!/usr/bin/env python3
"""ساخت دیکشنری فارسی «کلمه‌بازی» با املای درست (آ، ئ، ؤ …) و وزن فراوانی.

ورودی: فهرست واژه‌های پرکاربرد wordfreq برای زبان فارسی
خروجی: JSON به شکل {واژه: وزن}، که «واژه» شکل نمایشیِ درست است و
        وزن از رتبهٔ فراوانی می‌آید (واژهٔ پرکاربردتر = وزن بیشتر).

نکته: برای هر شکل نرمال‌شده فقط یک شکل نمایشی نگه می‌داریم و ترجیح
می‌دهیم «آ» را به «ا» ترجیح دهیم (آب به‌جای اب، آدم به‌جای ادم …).

اجرا (داخل venv با wordfreq):
  python scripts/build_dictionary.py --out data/dictionary.json
"""

from __future__ import annotations

import argparse
import json
import os

from wordfreq import top_n_list

from build_levels import is_clean, normalise


def hazm_vocab() -> dict[str, str]:
    """واژگان فرهنگ hazm و برچسب دستوری هر واژه (اگر نصب باشد)."""
    try:
        import hazm  # type: ignore
    except ImportError:
        print("warning: hazm نصب نیست؛ فیلتر فرهنگ لغت انجام نمی‌شود")
        return {}
    path = os.path.join(os.path.dirname(hazm.__file__), "data", "words.dat")
    if not os.path.exists(path):
        return {}
    out: dict[str, str] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if not parts or not parts[0]:
                continue
            tags = parts[2] if len(parts) > 2 else ""
            out[normalise(parts[0])] = tags
    return out

BASE_WEIGHT = 16000


def display_score(word: str) -> int:
    """شکل نمایشیِ دارای آ/همزه را ترجیح می‌دهد."""
    return (
        word.count("آ") * 4
        + word.count("ئ")
        + word.count("ؤ")
        + word.count("ۀ")
        + word.count("ة")
        + word.count("أ")
        + word.count("إ")
    )


def build(top: int, use_hazm: bool = True) -> dict[str, int]:
    out: dict[str, int] = {}
    display: dict[str, str] = {}
    scores: dict[str, int] = {}
    vocab = hazm_vocab() if use_hazm else {}

    for rank, raw in enumerate(top_n_list("fa", top), start=1):
        word = raw.strip()
        norm = normalise(word)
        if not is_clean(norm):
            continue
        # شکل نمایشی باید هم‌طول نرمال‌شده باشد تا جای خالی‌ها دقیق بمانند
        if len(word) != len(norm) or "\u200c" in word or " " in word:
            continue

        if vocab:
            tags = vocab.get(norm)
            # فقط اسم/صفت از فرهنگ لغت؛ فعل‌ها و قیدها برای جای خالی مناسب نیستند
            if tags is None:
                continue
            kinds = set(tags.split(","))
            if not (kinds & {"N", "AJ"}):
                continue

        weight = max(0, BASE_WEIGHT - rank)
        out[norm] = max(out.get(norm, 0), weight)

        score = display_score(word) * 10_000_000 + (BASE_WEIGHT - rank)
        if norm not in display or score > scores[norm]:
            display[norm] = word
            scores[norm] = score

    result: dict[str, int] = {}
    for norm, weight in out.items():
        result[display.get(norm, norm)] = weight
    return dict(sorted(result.items(), key=lambda kv: -kv[1]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--top", type=int, default=40000)
    parser.add_argument("--no-hazm", action="store_true", help="بدون فیلتر فرهنگ لغت hazm")
    args = parser.parse_args()

    words = build(args.top, use_hazm=not args.no_hazm)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(words, fh, ensure_ascii=False, indent=0)
        fh.write("\n")
    print(f"dictionary: {len(words)} words (top {args.top})")


if __name__ == "__main__":
    main()

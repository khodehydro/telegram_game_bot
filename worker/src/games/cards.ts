/**
 * Card primitives — a straight port of the Python engine (`bot/cards.py`).
 *
 * Cards are stored as compact codes: "SA" (ace of spades), "H10", "CJ" …
 */

export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number];

export const SUIT_FA: Record<Suit, string> = {
  S: "پیک",
  H: "دل",
  D: "خشت",
  C: "گشنیز",
};

export const SUIT_EMOJI: Record<Suit, string> = {
  S: "♠️",
  H: "♥️",
  D: "♦️",
  C: "♣️",
};

export const JACK = 11;
export const QUEEN = 12;
export const KING = 13;
export const ACE = 14;

export const RANKS: number[] = Array.from({ length: 13 }, (_, i) => i + 2);

export interface Card {
  suit: Suit;
  rank: number;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function faNumber(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

const CODE_LABEL: Record<number, string> = { [JACK]: "J", [QUEEN]: "Q", [KING]: "K", [ACE]: "A" };
const CODE_RANK: Record<string, number> = { J: JACK, Q: QUEEN, K: KING, A: ACE };

export const RANK_FA: Record<number, string> = {
  2: "۲",
  3: "۳",
  4: "۴",
  5: "۵",
  6: "۶",
  7: "۷",
  8: "۸",
  9: "۹",
  10: "۱۰",
  [JACK]: "سرباز",
  [QUEEN]: "بی‌بی",
  [KING]: "شاه",
  [ACE]: "آس",
};

export function isSuit(value: string): value is Suit {
  return (SUITS as readonly string[]).includes(value);
}

export function cardCode(card: Card): string {
  return `${card.suit}${CODE_LABEL[card.rank] ?? card.rank}`;
}

export function parseCard(code: string): Card {
  const raw = String(code).trim().toUpperCase();
  if (raw.length < 2) throw new Error(`invalid card code: ${code}`);
  const suit = raw[0] as Suit;
  if (!isSuit(suit)) throw new Error(`invalid suit: ${code}`);
  const rankPart = raw.slice(1);
  const rank = CODE_RANK[rankPart] ?? Number(rankPart);
  if (!RANKS.includes(rank)) throw new Error(`invalid rank: ${code}`);
  return { suit, rank };
}

export function cardLabel(code: string): string {
  const card = parseCard(code);
  const rank = CODE_LABEL[card.rank] ?? faNumber(card.rank);
  return `${rank}${SUIT_EMOJI[card.suit]}`;
}

export function cardsLine(codes: string[], sep = " "): string {
  return codes.length ? codes.map(cardLabel).join(sep) : "—";
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

/** Deterministic-friendly Fisher–Yates (accepts an injectable RNG). */
export function shuffledDeck(rng: () => number = Math.random): Card[] {
  const deck = fullDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function sortCards(codes: string[], trump?: string | null): string[] {
  return [...codes].sort((a, b) => {
    const ca = parseCard(a);
    const cb = parseCard(b);
    const ta = trump && ca.suit === trump ? 0 : 1;
    const tb = trump && cb.suit === trump ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const sa = SUITS.indexOf(ca.suit);
    const sb = SUITS.indexOf(cb.suit);
    if (sa !== sb) return sa - sb;
    return cb.rank - ca.rank;
  });
}

/** Small deterministic RNG (mulberry32) used by tests and seeded games. */
export function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

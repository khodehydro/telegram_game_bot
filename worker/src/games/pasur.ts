/**
 * Pâsur (پاسور / Basra) — port of `bot/games/pasur.py`.
 * Rules follow the Pagat / Wikipedia consensus; see the Python module docs.
 */

import {
  ACE,
  Card,
  JACK,
  KING,
  QUEEN,
  SUITS,
  cardCode,
  makeRng,
  parseCard,
  shuffledDeck,
} from "./cards";
import { Action, BaseGame, GameError, GameEvent, GameView } from "./base";

export const MAX_SCORE = 62;
export const SUR_POINTS = 5;
export const SUR_BLOCK_SCORE = 50;

function pip(card: Card): number {
  if (card.rank === ACE) return 1;
  if (card.rank <= 10) return card.rank;
  return 0;
}

function combos(items: Card[], size: number): Card[][] {
  const out: Card[][] = [];
  const walk = (start: number, acc: Card[]) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

export class PasurGame extends BaseGame {
  static override GAME = "pasur";
  static override MIN_PLAYERS = 2;
  static override MAX_PLAYERS = 4;
  static override TURN_SECONDS = 45;

  static create(players: number[], rng: () => number = Math.random): any {
    const n = players.length;
    if (n < PasurGame.MIN_PLAYERS || n > PasurGame.MAX_PLAYERS) {
      throw new GameError("pasur needs 2-4 players", "پاسور بین ۲ تا ۴ بازیکن نیاز دارد.");
    }
    const state: any = {
      game: PasurGame.GAME,
      players: [...players],
      phase: "playing",
      hands: players.map(() => [] as string[]),
      piles: players.map(() => [] as string[]),
      surs: players.map(() => 0),
      scores: players.map(() => 0),
      table: [] as string[],
      deck: [] as string[],
      dealer: n - 1,
      turn: 0,
      deal_no: 0,
      last_capturer: null,
      batch: 0,
      round: 0,
      log: [] as string[],
      deadline: null,
    };
    const game = new PasurGame(state);
    game.startRound(rng);
    return state;
  }

  // ---------------------------------------------------------------- helpers
  isTeamGame(): boolean {
    return this.state.players.length === 4;
  }

  side(seat: number): number[] {
    if (!this.isTeamGame()) return [seat];
    return seat % 2 === 0 ? [0, 2] : [1, 3];
  }

  opponents(seat: number): number[] {
    const side = this.side(seat);
    return this.state.players.map((_: number, i: number) => i).filter((s: number) => !side.includes(s));
  }

  addScore(seat: number, points: number): void {
    for (const s of this.side(seat)) this.state.scores[s] += points;
  }

  sideScore(seat: number): number {
    return Math.max(...this.side(seat).map((s) => this.state.scores[s] as number));
  }

  // ---------------------------------------------------------------- dealing
  private newDeck(rng: () => number): Card[] {
    for (;;) {
      const deck = shuffledDeck(rng);
      const table = deck.slice(0, 4);
      const rest = deck.slice(4);
      let jacks = table.filter((c) => c.rank === JACK).length;
      const queens = table.filter((c) => c.rank === QUEEN).length;
      const kings = table.filter((c) => c.rank === KING).length;
      if (jacks > 1 || queens > 2 || kings > 2) continue;
      if (jacks === 1) {
        const jack = table.find((c) => c.rank === JACK)!;
        table.splice(table.indexOf(jack), 1);
        const replacement = rest.shift()!;
        table.push(replacement);
        if (
          replacement.rank === JACK ||
          table.filter((c) => c.rank === QUEEN).length > 2
        ) {
          continue;
        }
        rest.push(jack); // buried jack goes to the bottom of the pack
      }
      this.state.table = table.map(cardCode);
      return rest;
    }
  }

  private startRound(rng: () => number): void {
    const st = this.state;
    const n = st.players.length;
    st.hands = st.players.map(() => [] as string[]);
    st.piles = st.players.map(() => [] as string[]);
    st.surs = st.players.map(() => 0);
    st.last_capturer = null;
    st.batch = 0;
    st.deck = this.newDeck(rng).map(cardCode);
    st.dealer = (st.dealer + 1) % n;
    st.turn = (st.dealer + 1) % n;
    this.dealBatch();
    st.phase = "playing";
    this.touchDeadline();
  }

  private dealBatch(): void {
    const st = this.state;
    const n = st.players.length;
    let size = 4;
    if (st.deck.length < size * n) size = n ? Math.floor(st.deck.length / n) : 0;
    for (let i = 0; i < size; i++) {
      for (let seat = 0; seat < n; seat++) {
        if (st.deck.length) st.hands[seat].push(st.deck.shift());
      }
    }
    st.batch += 1;
  }

  // ---------------------------------------------------------------- queries
  override currentSeat(): number | null {
    if (this.finished) return null;
    return this.state.turn as number;
  }

  tableCards(): Card[] {
    return (this.state.table as string[]).map(parseCard);
  }

  captureOptions(card: Card): string[][] {
    const table = this.tableCards();
    let outs: string[][] = [];
    if (card.rank === KING) {
      outs = [table.filter((c) => c.rank === KING).map(cardCode)];
    } else if (card.rank === QUEEN) {
      outs = [table.filter((c) => c.rank === QUEEN).map(cardCode)];
    } else if (card.rank === JACK) {
      outs = [table.filter((c) => c.rank === JACK || c.rank <= 10).map(cardCode)];
    } else {
      const target = 11 - pip(card);
      const numerals = table.filter((c) => c.rank <= 10);
      outs = [];
      for (let r = 1; r <= numerals.length; r++) {
        for (const combo of combos(numerals, r)) {
          if (combo.reduce((sum, c) => sum + pip(c), 0) === target) {
            outs.push(combo.map(cardCode));
          }
        }
      }
    }
    return outs.filter((o) => o.length > 0);
  }

  override legalActions(seat: number): Action[] {
    if (this.finished || seat !== this.state.turn) return [];
    const actions: Action[] = [];
    for (const code of this.state.hands[seat] as string[]) {
      const card = parseCard(code);
      const opts = this.captureOptions(card);
      if (!opts.length) actions.push({ type: "play", card: code });
      else for (const opt of opts) actions.push({ type: "play", card: code, capture: opt });
    }
    return actions;
  }

  override view(seat: number | null): GameView {
    const st = this.state;
    return {
      game: PasurGame.GAME,
      players: [...st.players],
      phase: st.phase,
      turn: st.turn,
      table: [...st.table],
      counts: st.hands.map((h: string[]) => h.length),
      hand: seat !== null ? [...st.hands[seat]] : [],
      scores: [...st.scores],
      surs: [...st.surs],
      deck_left: st.deck.length,
      round: st.round,
      finished: this.finished,
      winner: st.winner ?? null,
      teams: this.isTeamGame(),
      n: st.players.length,
    };
  }

  // ---------------------------------------------------------------- actions
  override apply(seat: number, action: Action): GameEvent[] {
    const st = this.state;
    if (this.finished) throw new GameError("game is over", "این بازی تمام شده است.");
    if (seat !== st.turn) throw new GameError("not your turn", "الان نوبت شما نیست.");
    if (action.type !== "play") throw new GameError("unknown action", "حرکت نامعتبر است.");

    const code = action.card as string;
    if (!(st.hands[seat] as string[]).includes(code)) {
      throw new GameError("card not in hand", "این برگ در دست شما نیست.");
    }

    const card = parseCard(code);
    const options = this.captureOptions(card);
    let chosen: string[];
    if (options.length) {
      if (action.capture === undefined || action.capture === null) {
        chosen = options.reduce((best, opt) =>
          this.captureValue(opt) > this.captureValue(best) ? opt : best,
        );
      } else {
        chosen = action.capture as string[];
        if (!options.some((opt) => sameSet(opt, chosen))) {
          throw new GameError("invalid capture", "این ترکیب قابل برداشتن نیست.");
        }
      }
    } else {
      chosen = [];
    }

    st.hands[seat].splice((st.hands[seat] as string[]).indexOf(code), 1);
    const events: GameEvent[] = [];
    let sur = false;
    if (chosen.length) {
      st.table = (st.table as string[]).filter((c: string) => !chosen.includes(c));
      st.piles[seat].push(...chosen, code);
      st.last_capturer = seat;
      if (card.rank !== JACK && st.table.length === 0 && this.surAllowed(seat)) {
        sur = this.registerSur(seat);
      }
    } else {
      st.table.push(code);
    }

    events.push({ type: "play", seat, card: code, captured: chosen, sur });
    this.log(`seat ${seat} played ${code}`);

    st.turn = (seat + 1) % st.players.length;
    events.push(...this.afterPlay());
    return events;
  }

  captureValue(cards: string[]): number {
    let total = 0;
    for (const code of cards) {
      const c = parseCard(code);
      if (c.rank === ACE || c.rank === JACK) total += 1;
      if (c.suit === "C" && c.rank === 2) total += 2;
      if (c.suit === "D" && c.rank === 10) total += 3;
    }
    return total;
  }

  private surAllowed(seat: number): boolean {
    if (!this.state.deck.length) return false; // no surs in the last deal
    return this.sideScore(seat) < SUR_BLOCK_SCORE;
  }

  private registerSur(seat: number): boolean {
    const st = this.state;
    for (const opp of this.opponents(seat)) {
      if (st.surs[opp] > 0) {
        st.surs[opp] -= 1;
        return false;
      }
    }
    for (const s of this.side(seat)) st.surs[s] += 1;
    return true;
  }

  private afterPlay(): GameEvent[] {
    const st = this.state;
    const events: GameEvent[] = [];
    const empty = (st.hands as string[][]).every((h) => h.length === 0);
    if (empty) {
      if ((st.deck as string[]).length) {
        this.dealBatch();
        st.turn = (st.dealer + 1) % st.players.length;
        this.touchDeadline();
        return events;
      }
      if ((st.table as string[]).length && st.last_capturer !== null) {
        const winnerSeat = st.last_capturer as number;
        st.piles[winnerSeat].push(...(st.table as string[]));
        events.push({ type: "sweep", seat: winnerSeat, cards: [...st.table] });
        st.table = [];
      }
      events.push(...this.endRound());
      return events;
    }
    this.touchDeadline();
    return events;
  }

  // ---------------------------------------------------------------- scoring
  endRound(): GameEvent[] {
    const st = this.state;
    const n = st.players.length;
    st.round += 1;

    const clubs = new Array(n).fill(0);
    const gains = new Array(n).fill(0);
    for (let seat = 0; seat < n; seat++) {
      for (const code of st.piles[seat] as string[]) {
        const card = parseCard(code);
        if (card.rank === ACE) gains[seat] += 1;
        else if (card.rank === JACK) gains[seat] += 1;
        else if (card.suit === "C" && card.rank === 2) gains[seat] += 2;
        else if (card.suit === "D" && card.rank === 10) gains[seat] += 3;
        if (card.suit === "C") clubs[seat] += 1;
      }
    }

    const best = Math.max(...clubs);
    if (best >= 7 && clubs.filter((c) => c === best).length === 1) {
      gains[clubs.indexOf(best)] += 7;
    }
    for (let seat = 0; seat < n; seat++) gains[seat] += st.surs[seat] * SUR_POINTS;
    for (let seat = 0; seat < n; seat++) this.addScore(seat, gains[seat]);

    st.surs = new Array(n).fill(0);
    st.last_capturer = null;

    const events: GameEvent[] = [
      { type: "round_end", gains, scores: [...st.scores], clubs },
    ];

    const sideA = this.sideScore(0);
    const sideB = n > 1 ? this.sideScore(1) : sideA;
    const tie = sideA === sideB;
    const top = Math.max(sideA, sideB);
    if (top >= MAX_SCORE && !tie) {
      const winner = sideA > sideB ? 0 : 1;
      st.winner = winner;
      st.phase = "finished";
      st.turn = null;
      this.clearDeadline();
      events.push({ type: "game_end", winner, scores: [...st.scores] });
      return events;
    }

    this.startRound(Math.random);
    events.push({ type: "new_round", round: st.round, dealer: st.dealer });
    return events;
  }

  override autoAction(seat: number): Action {
    const actions = this.legalActions(seat);
    if (!actions.length) throw new GameError("no legal action");
    const captures = actions.filter((a) => a.capture);
    if (captures.length) {
      return captures.reduce((best, a) =>
        this.captureValue(a.capture as string[]) > this.captureValue(best.capture as string[])
          ? a
          : best,
      );
    }
    return actions[Math.floor(Math.random() * actions.length)];
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Re-export for tests that need a seeded game. */
export function newPasur(players: number[], seed?: number): PasurGame {
  return new PasurGame(PasurGame.create(players, makeRng(seed)));
}

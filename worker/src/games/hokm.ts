/**
 * Hokm (حکم) — port of `bot/games/hokm.py`.
 * 4 players, two partnerships (seats 0+2 vs 1+3), 13 cards each.
 */

import { SUITS, Suit, cardCode, makeRng, parseCard, shuffledDeck, sortCards } from "./cards";
import { Action, BaseGame, GameError, GameEvent, GameView } from "./base";

export const TARGET_POINTS = 7;
export const TRICKS_TO_WIN = 7;

export class HokmGame extends BaseGame {
  static override GAME = "hokm";
  static override MIN_PLAYERS = 4;
  static override MAX_PLAYERS = 4;
  static override TURN_SECONDS = 60;

  static create(players: number[], rng: () => number = Math.random): any {
    if (players.length !== 4) {
      throw new GameError("hokm needs exactly 4 players", "حکم دقیقاً ۴ بازیکن می‌خواهد.");
    }
    const state: any = {
      game: HokmGame.GAME,
      players: [...players],
      phase: "trump",
      hands: players.map(() => [] as string[]),
      trump: null,
      hakem: Math.floor(rng() * 4),
      turn: 0,
      trick: [] as { seat: number; card: string }[],
      history: [] as unknown[],
      tricks_won: [0, 0, 0, 0],
      scores: [0, 0, 0, 0],
      round: 0,
      leader: 0,
      winner: null,
      deck: [] as string[],
      log: [] as string[],
      deadline: null,
    };
    const game = new HokmGame(state);
    game.startRound(rng);
    return state;
  }

  team(seat: number): number {
    return seat % 2;
  }

  teamPool(team: number): number[] {
    return [team, team + 2];
  }

  private startRound(rng: () => number): void {
    const st = this.state;
    st.round += 1;
    const deck = shuffledDeck(rng).map(cardCode);
    st.hands = [0, 1, 2, 3].map((s) => deck.slice(s * 5, (s + 1) * 5));
    st.deck = deck.slice(20);
    st.trump = null;
    st.trick = [];
    st.tricks_won = [0, 0, 0, 0];
    st.leader = st.hakem;
    st.turn = st.hakem;
    st.phase = "trump";
    this.touchDeadline();
  }

  private dealRest(): void {
    const st = this.state;
    const deck = [...(st.deck as string[])];
    const start = (st.hakem + 1) % 4;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 4; j++) {
        const seat = (start + j) % 4;
        st.hands[seat].push(deck.shift()!);
      }
    }
    st.deck = [];
  }

  override currentSeat(): number | null {
    if (this.finished) return null;
    return this.state.turn as number;
  }

  legalCards(seat: number): string[] {
    const hand = this.state.hands[seat] as string[];
    const trick = this.state.trick as { seat: number; card: string }[];
    if (!trick.length) return [...hand];
    const led = parseCard(trick[0].card).suit;
    const follow = hand.filter((c) => parseCard(c).suit === led);
    return follow.length ? follow : [...hand];
  }

  override legalActions(seat: number): Action[] {
    if (this.finished) return [];
    if (this.state.phase === "trump") {
      if (seat !== this.state.hakem) return [];
      return SUITS.map((suit) => ({ type: "trump", suit }));
    }
    if (seat !== this.state.turn) return [];
    return this.legalCards(seat).map((card) => ({ type: "play", card }));
  }

  override view(seat: number | null): GameView {
    const st = this.state;
    return {
      game: HokmGame.GAME,
      players: [...st.players],
      phase: st.phase,
      turn: st.turn,
      hakem: st.hakem,
      trump: st.trump,
      trick: [...st.trick],
      hand: seat !== null ? sortCards(st.hands[seat] as string[], st.trump) : [],
      counts: (st.hands as string[][]).map((h) => h.length),
      tricks_won: [...st.tricks_won],
      scores: [...st.scores],
      round: st.round,
      winner: st.winner ?? null,
      finished: this.finished,
    };
  }

  override apply(seat: number, action: Action): GameEvent[] {
    if (this.finished) throw new GameError("game is over", "این بازی تمام شده است.");
    if (action.type === "trump") return this.chooseTrump(seat, action.suit as string);
    if (action.type === "play") return this.play(seat, action.card as string);
    throw new GameError("unknown action", "حرکت نامعتبر است.");
  }

  private chooseTrump(seat: number, suit: string | undefined): GameEvent[] {
    const st = this.state;
    if (st.phase !== "trump") throw new GameError("trump already chosen", "حکم قبلاً انتخاب شده است.");
    if (seat !== st.hakem) {
      throw new GameError("only the hakem picks trump", "فقط حاکم می‌تواند حکم را انتخاب کند.");
    }
    if (!suit || !SUITS.includes(suit as Suit)) {
      throw new GameError("bad suit", "خال نامعتبر است.");
    }
    st.trump = suit;
    this.dealRest();
    st.phase = "playing";
    st.turn = st.hakem;
    this.touchDeadline();
    return [{ type: "trump", seat, suit }];
  }

  private play(seat: number, code: string | undefined): GameEvent[] {
    const st = this.state;
    if (st.phase !== "playing") throw new GameError("trump not chosen yet", "اول باید خال حکم انتخاب شود.");
    if (seat !== st.turn) throw new GameError("not your turn", "الان نوبت شما نیست.");
    if (!code || !(st.hands[seat] as string[]).includes(code)) {
      throw new GameError("card not in hand", "این برگ در دست شما نیست.");
    }
    if (!this.legalCards(seat).includes(code)) {
      throw new GameError("must follow suit", "باید از خال زمینه بازی کنی.");
    }

    (st.hands[seat] as string[]).splice((st.hands[seat] as string[]).indexOf(code), 1);
    st.trick.push({ seat, card: code });
    this.log(`${seat}:${code}`);

    const events: GameEvent[] = [{ type: "play", seat, card: code }];

    if (st.trick.length < 4) {
      st.turn = (seat + 1) % 4;
      this.touchDeadline();
      return events;
    }

    const winner = this.trickWinner();
    st.tricks_won[winner] += 1;
    st.history.push({ cards: [...st.trick], winner, n: st.round });
    events.push({
      type: "trick_end",
      winner,
      cards: [...st.trick],
      tricks_won: [...st.tricks_won],
    });
    st.trick = [];
    st.leader = winner;
    st.turn = winner;

    const team = this.team(winner);
    const teamTricks = st.tricks_won[team] + st.tricks_won[team + 2];
    if (teamTricks >= TRICKS_TO_WIN) {
      events.push(...this.endRound(team));
      return events;
    }

    this.touchDeadline();
    return events;
  }

  private trickWinner(): number {
    const st = this.state;
    const trump = st.trump as string;
    const led = parseCard(st.trick[0].card).suit;
    const strength = (entry: { seat: number; card: string }): [number, number] => {
      const card = parseCard(entry.card);
      const tier = card.suit === trump ? 2 : card.suit === led ? 1 : 0;
      return [tier, card.rank];
    };
    let best = st.trick[0];
    for (const entry of st.trick.slice(1)) {
      const [ta, ra] = strength(entry);
      const [tb, rb] = strength(best);
      if (ta > tb || (ta === tb && ra > rb)) best = entry;
    }
    return best.seat;
  }

  endRound(winningTeam: number): GameEvent[] {
    const st = this.state;
    const losingTeam = 1 - winningTeam;
    const loseTricks = st.tricks_won[losingTeam] + st.tricks_won[losingTeam + 2];
    const hakemTeam = this.team(st.hakem);

    let points = 1;
    let kind = "normal";
    if (loseTricks === 0) {
      points = winningTeam !== hakemTeam ? 3 : 2;
      kind = winningTeam !== hakemTeam ? "hakem_kot" : "kot";
    }

    for (const seat of this.teamPool(winningTeam)) st.scores[seat] += points;

    const events: GameEvent[] = [
      {
        type: "round_end",
        team: winningTeam,
        kind,
        points,
        scores: [...st.scores],
        tricks_won: [...st.tricks_won],
      },
    ];

    if (st.scores[winningTeam] >= TARGET_POINTS) {
      st.winner = winningTeam;
      st.phase = "finished";
      st.turn = null;
      this.clearDeadline();
      events.push({ type: "game_end", winner: winningTeam, scores: [...st.scores] });
      return events;
    }

    let hakem = st.hakem as number;
    if (this.team(hakem) !== winningTeam) hakem = (hakem + 1) % 4;
    st.hakem = hakem;
    this.startRound(Math.random);
    events.push({ type: "new_round", round: st.round, hakem });
    return events;
  }

  override autoAction(seat: number): Action {
    if (this.state.phase === "trump") {
      const hand = (this.state.hands[seat] as string[]).map(parseCard);
      const counts: Record<string, number> = {};
      for (const card of hand) counts[card.suit] = (counts[card.suit] ?? 0) + 1;
      const suit = Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b));
      return { type: "trump", suit };
    }
    const legal = this.legalCards(seat).map(parseCard);
    const lowest = legal.reduce((a, b) => (a.rank <= b.rank ? a : b));
    return { type: "play", card: cardCode(lowest) };
  }
}

export function newHokm(players: number[], seed?: number): HokmGame {
  return new HokmGame(HokmGame.create(players, makeRng(seed)));
}

import { describe, expect, it } from "vitest";
import { Card, fullDeck, makeRng, parseCard, shuffledDeck } from "../src/games/cards";
import { GameError } from "../src/games/base";
import { PasurGame, newPasur } from "../src/games/pasur";

function fresh(seed = 1, players = 2) {
  return newPasur(
    Array.from({ length: players }, (_, i) => i + 1),
    seed,
  );
}

describe("deck", () => {
  it("has 52 unique cards", () => {
    expect(fullDeck()).toHaveLength(52);
    expect(new Set(fullDeck().map((c) => `${c.suit}${c.rank}`)).size).toBe(52);
    expect(shuffledDeck(makeRng(3))).toHaveLength(52);
  });
});

describe("pasur dealing", () => {
  it("deals four cards each plus a four card table", () => {
    const game = fresh(1);
    const st = game.state;
    expect(game.phase).toBe("playing");
    expect(st.hands.map((h: string[]) => h.length)).toEqual([4, 4]);
    expect(st.table).toHaveLength(4);
    expect(st.deck).toHaveLength(52 - 8 - 4);
    expect(st.table.filter((c: string) => parseCard(c).rank === 11).length).toBeLessThanOrEqual(1);
    const total = st.table.length + st.deck.length + st.hands.flat().length;
    expect(total).toBe(52);
  });

  it("makes a four player game a team game", () => {
    const game = fresh(3, 4);
    expect(game.isTeamGame()).toBe(true);
    expect(game.side(0)).toEqual([0, 2]);
    expect(game.side(1)).toEqual([1, 3]);
  });
});

describe("captures", () => {
  it("king and queen capture their own rank", () => {
    const game = fresh();
    game.state.table = ["SK", "S5", "HQ"];
    expect(game.captureOptions({ suit: "H", rank: 13 } as Card)).toEqual([["SK"]]);
    expect(game.captureOptions({ suit: "D", rank: 12 } as Card)).toEqual([["HQ"]]);
  });

  it("jack takes numerals and jacks but not court cards", () => {
    const game = fresh();
    game.state.table = ["SK", "HQ", "S5", "C9", "DJ"];
    expect(game.captureOptions({ suit: "H", rank: 11 })).toEqual([["S5", "C9", "DJ"]]);
  });

  it("numerals capture sets summing to eleven", () => {
    const game = fresh();
    game.state.table = ["S6", "H3", "D2", "C10"];
    expect(game.captureOptions({ suit: "H", rank: 5 })).toEqual([["S6"]]);
    expect(game.captureOptions({ suit: "H", rank: 6 })).toContainEqual(["H3", "D2"]);
  });

  it("ace counts as one", () => {
    const game = fresh();
    game.state.table = ["S10"];
    expect(game.captureOptions({ suit: "H", rank: 14 })).toEqual([["S10"]]);
  });

  it("rejects an impossible capture", () => {
    const game = fresh();
    game.state.table = ["S6", "H2"];
    game.state.hands[0] = ["D5", "C7"];
    game.state.turn = 0;
    expect(() => game.apply(0, { type: "play", card: "D5", capture: ["H2"] })).toThrow(GameError);
  });
});

describe("sur", () => {
  it("scores when a non-jack clears the table", () => {
    const game = fresh();
    game.state.table = ["S6"];
    game.state.hands[0] = ["D5", "C7"];
    game.state.deck = ["H2", "H3", "H4"];
    game.state.turn = 0;
    const events = game.apply(0, { type: "play", card: "D5" });
    expect(events[0].sur).toBe(true);
    expect(game.state.surs[0]).toBe(1);
  });

  it("is not scored on the last deal", () => {
    const game = fresh();
    game.state.table = ["S6"];
    game.state.hands = [["D5"], ["C7"]];
    game.state.deck = [];
    game.state.turn = 0;
    expect(game.apply(0, { type: "play", card: "D5" })[0].sur).toBe(false);
  });

  it("cancels an opponent sur", () => {
    const game = fresh();
    game.state.surs = [1, 0];
    game.state.table = ["S6"];
    game.state.hands = [["H8"], ["D5", "C7"]];
    game.state.deck = ["H2", "H3", "H4"];
    game.state.turn = 1;
    expect(game.apply(1, { type: "play", card: "D5" })[0].sur).toBe(false);
    expect(game.state.surs).toEqual([0, 0]);
  });
});

describe("scoring", () => {
  it("counts aces, jacks, 2C, 10D and seven clubs", () => {
    const game = fresh();
    game.state.piles = [
      ["SA", "HA", "C2", "D10", "C3", "C4", "C5", "C6", "C7", "C8", "C9"],
      ["SJ", "HJ", "H2", "S3"],
    ];
    game.state.hands = [[], []];
    game.state.deck = [];
    const events = game.endRound();
    expect(events[0].gains).toEqual([14, 2]);
  });

  it("last capturer sweeps the table", () => {
    const game = fresh();
    game.state.table = ["HK", "SQ"];
    game.state.hands = [["D3"], ["C4"]];
    game.state.piles = [["SA"], []];
    game.state.deck = [];
    game.state.last_capturer = 0;
    game.state.turn = 0;
    game.apply(0, { type: "play", card: "D3" });
    const events = game.apply(1, { type: "play", card: "C4" });
    expect(events.some((e) => e.type === "sweep" && e.seat === 0)).toBe(true);
  });

  it("ends the game at 62", () => {
    const game = fresh(5);
    game.state.scores = [57, 10];
    game.state.piles = [["SA", "HA", "DA", "SJ", "HJ"], []];
    game.state.hands = [[], []];
    game.state.deck = [];
    const events = game.endRound();
    expect(game.finished).toBe(true);
    expect(events.some((e) => e.type === "game_end" && e.winner === 0)).toBe(true);
  });

  it("keeps playing on a tie above 62", () => {
    const game = fresh(5);
    game.state.scores = [62, 62];
    game.state.piles = [[], []];
    game.state.hands = [[], []];
    game.state.deck = [];
    game.endRound();
    expect(game.finished).toBe(false);
  });
});

describe("turn order", () => {
  it("rejects a move out of turn", () => {
    const game = fresh();
    const other = (game.state.turn + 1) % 2;
    expect(() => game.apply(other, { type: "play", card: game.state.hands[other][0] })).toThrow(GameError);
  });

  it("plays a whole round to the end", () => {
    const rng = makeRng(7);
    const game = fresh(7, 4);
    let guard = 0;
    while (game.state.round === 0 && guard++ < 5000) {
      const seat = game.currentSeat()!;
      const actions = game.legalActions(seat);
      expect(actions.length).toBeGreaterThan(0);
      game.apply(seat, actions[Math.floor(rng() * actions.length)]);
    }
    expect(game.state.round).toBe(1);
  });

  it("finishes a full match", () => {
    const rng = makeRng(11);
    const game = fresh(11, 4);
    let guard = 0;
    while (!game.finished && guard++ < 20000) {
      const seat = game.currentSeat()!;
      const actions = game.legalActions(seat);
      game.apply(seat, actions[Math.floor(rng() * actions.length)]);
    }
    expect(game.finished).toBe(true);
    expect(Math.max(...(game.state.scores as number[]))).toBeGreaterThanOrEqual(62);
  });
});

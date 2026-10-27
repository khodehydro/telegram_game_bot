import { describe, expect, it } from "vitest";
import { GameError } from "../src/games/base";
import { HokmGame, newHokm } from "../src/games/hokm";
import { makeRng } from "../src/games/cards";

function fresh(seed = 1) {
  return newHokm([10, 20, 30, 40], seed);
}

describe("hokm setup", () => {
  it("starts with five cards each", () => {
    const game = fresh();
    expect(game.phase).toBe("trump");
    expect(game.state.hands.map((h: string[]) => h.length)).toEqual([5, 5, 5, 5]);
    expect(game.state.trump).toBeNull();
    expect(game.state.deck).toHaveLength(32);
    expect(game.currentSeat()).toBe(game.state.hakem);
  });

  it("only the hakem picks trump", () => {
    const game = fresh();
    const hakem = game.state.hakem as number;
    const other = (hakem + 1) % 4;
    expect(game.legalActions(other)).toEqual([]);
    expect(game.legalActions(hakem)).toHaveLength(4);
    expect(() => game.apply(other, { type: "trump", suit: "H" })).toThrow(GameError);
  });

  it("completes the deal to thirteen cards", () => {
    const game = fresh();
    game.apply(game.state.hakem, { type: "trump", suit: "S" });
    expect(game.phase).toBe("playing");
    expect(game.state.hands.map((h: string[]) => h.length)).toEqual([13, 13, 13, 13]);
    expect(game.state.deck).toEqual([]);
  });
});

describe("trick play", () => {
  it("refuses to discard while holding the led suit", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.apply(0, { type: "trump", suit: "H" });
    game.state.hands = [["S5", "S2"], ["S3", "C3"], ["D4", "D5"], ["C6", "C7"]];
    game.apply(0, { type: "play", card: "S5" });
    expect(() => game.apply(1, { type: "play", card: "C3" })).toThrow(GameError);
    game.apply(1, { type: "play", card: "S3" });
  });

  it("a trump beats the led suit", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.apply(0, { type: "trump", suit: "H" });
    game.state.hands = [["S5", "S2"], ["S9", "S3"], ["H2", "H4"], ["S7", "S6"]];
    game.state.turn = 0;
    game.apply(0, { type: "play", card: "S5" });
    game.apply(1, { type: "play", card: "S9" });
    game.apply(2, { type: "play", card: "H2" });
    const events = game.apply(3, { type: "play", card: "S7" });
    const trick = events.find((e) => e.type === "trick_end")!;
    expect(trick.winner).toBe(2);
    expect(game.state.turn).toBe(2);
  });

  it("an off-suit discard cannot win", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.apply(0, { type: "trump", suit: "H" });
    game.state.hands = [["S5", "S2"], ["S9", "S3"], ["D10", "D5"], ["S7", "S6"]];
    game.state.turn = 0;
    game.apply(0, { type: "play", card: "S5" });
    game.apply(1, { type: "play", card: "S9" });
    game.apply(2, { type: "play", card: "D10" });
    const events = game.apply(3, { type: "play", card: "S7" });
    expect(events.find((e) => e.type === "trick_end")!.winner).toBe(1);
  });
});

describe("scoring", () => {
  it("awards one point for a normal win", () => {
    const game = fresh();
    game.state.tricks_won = [5, 2, 2, 0];
    const events = game.endRound(0);
    expect(events[0].kind).toBe("normal");
    expect(events[0].points).toBe(1);
  });

  it("awards two points for a kot", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.state.tricks_won = [7, 0, 0, 0];
    const events = game.endRound(0);
    expect(events[0].kind).toBe("kot");
    expect(events[0].points).toBe(2);
    expect(game.state.scores[0]).toBe(2);
  });

  it("awards three points for a hakem kot", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.state.tricks_won = [0, 7, 0, 0];
    const events = game.endRound(1);
    expect(events[0].kind).toBe("hakem_kot");
    expect(events[0].points).toBe(3);
  });

  it("ends the match at seven points", () => {
    const game = fresh();
    game.state.scores = [6, 2, 6, 2];
    game.state.tricks_won = [7, 0, 0, 0];
    game.state.hakem = 0;
    const events = game.endRound(0);
    expect(game.finished).toBe(true);
    expect(events.find((e) => e.type === "game_end")!.winner).toBe(0);
  });

  it("passes the hakem seat to the winning team", () => {
    const game = fresh();
    game.state.hakem = 0;
    game.state.tricks_won = [0, 7, 0, 0];
    game.endRound(1);
    expect(game.team(game.state.hakem)).toBe(1);
  });

  it("plays a complete match", () => {
    const rng = makeRng(9);
    const game = new HokmGame(HokmGame.create([1, 2, 3, 4], makeRng(9)));
    let guard = 0;
    while (!game.finished && guard++ < 6000) {
      const seat = game.currentSeat()!;
      const actions = game.legalActions(seat);
      game.apply(seat, actions[Math.floor(rng() * actions.length)]);
    }
    expect(game.finished).toBe(true);
    expect(Math.max(...(game.state.scores as number[]))).toBeGreaterThanOrEqual(7);
  });
});

describe("privacy", () => {
  it("never exposes other hands", () => {
    const game = fresh();
    expect(game.view(1).hand).toHaveLength(5);
    expect(game.view(null).hand).toEqual([]);
  });
});

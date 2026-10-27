/** Shared contract for game engines (port of `bot/games/base.py`). */

export interface GameView {
  game: string;
  players: number[];
  phase: string;
  turn?: number | null;
  names?: string[];
  hand: string[];
  finished: boolean;
  winner?: number | null;
  [key: string]: unknown;
}

export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export interface Action {
  type: string;
  [key: string]: unknown;
}

export class GameError extends Error {
  fa: string;
  constructor(message: string, fa?: string) {
    super(message);
    this.name = "GameError";
    this.fa = fa ?? message;
  }
}

export abstract class BaseGame {
  static GAME = "";
  static MIN_PLAYERS = 1;
  static MAX_PLAYERS = 1;
  static TURN_SECONDS = 60;

  constructor(public state: any) {}

  get game(): string {
    return this.state.game;
  }

  /** Static GAME key of the concrete engine. */
  get gameKey(): string {
    return (this.constructor as typeof BaseGame).GAME;
  }

  get phase(): string {
    return this.state.phase;
  }

  get finished(): boolean {
    return this.state.phase === "finished";
  }

  abstract currentSeat(): number | null;
  abstract legalActions(seat: number): Action[];
  abstract view(seat: number | null): GameView;
  abstract apply(seat: number, action: Action): GameEvent[];
  abstract autoAction(seat: number): Action;

  isPlayer(userId: number): boolean {
    return (this.state.players as number[]).includes(userId);
  }

  seatOf(userId: number): number | null {
    const idx = (this.state.players as number[]).indexOf(userId);
    return idx === -1 ? null : idx;
  }

  touchDeadline(): void {
    this.state.deadline = Math.floor(Date.now() / 1000) + (this.constructor as typeof BaseGame).TURN_SECONDS;
  }

  clearDeadline(): void {
    this.state.deadline = null;
  }

  log(text: string): void {
    if (!Array.isArray(this.state.log)) this.state.log = [];
    this.state.log.push(text);
    if (this.state.log.length > 60) this.state.log.splice(0, this.state.log.length - 60);
  }
}

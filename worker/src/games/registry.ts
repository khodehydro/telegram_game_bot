/** Game registry (port of `bot/games/registry.ts`). */

import { BaseGame, GameError } from "./base";
import { HokmGame } from "./hokm";
import { PasurGame } from "./pasur";

export interface EngineConstructor {
  new (state: any): BaseGame;
  GAME: string;
  MIN_PLAYERS: number;
  MAX_PLAYERS: number;
  TURN_SECONDS: number;
  create(players: number[], rng?: () => number): any;
}

export const GAMES: Record<string, EngineConstructor> = {
  pasur: PasurGame as unknown as EngineConstructor,
  hokm: HokmGame as unknown as EngineConstructor,
};

export const FA_NAMES: Record<string, string> = {
  pasur: "پاسور",
  hokm: "حکم",
};

export const EMOJI: Record<string, string> = {
  pasur: "🎣",
  hokm: "👑",
};

export function getEngineClass(key: string): EngineConstructor {
  const cls = GAMES[key];
  if (!cls) throw new GameError(`unknown game: ${key}`, "این بازی وجود ندارد.");
  return cls;
}

export function nameFa(key: string): string {
  return FA_NAMES[key] ?? key;
}

export function gameEmoji(key: string): string {
  return EMOJI[key] ?? "🎴";
}

export function minPlayers(key: string): number {
  return getEngineClass(key).MIN_PLAYERS;
}

export function maxPlayers(key: string): number {
  return getEngineClass(key).MAX_PLAYERS;
}

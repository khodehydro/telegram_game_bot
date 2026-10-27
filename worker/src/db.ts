/** لایهٔ داده روی Cloudflare D1 (SQLite). */

import { tehranDay } from "./levels";

export interface PlayerRow {
  id: number;
  username: string | null;
  first_name: string | null;
  photo_url: string | null;
  coins: number;
  total_points: number;
  level: number;
  streak: number;
  last_played: string | null;
  hints: number;
}

export interface LeaderRow {
  id: number;
  first_name: string | null;
  username: string | null;
  points: number;
}

export const SCHEMA = `
create table if not exists players (
  id integer primary key,
  username text,
  first_name text,
  photo_url text,
  coins integer not null default 120,
  total_points integer not null default 0,
  level integer not null default 1,
  streak integer not null default 0,
  last_played text,
  hints integer not null default 3,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

create table if not exists progress (
  user_id integer not null,
  level integer not null,
  words text not null default '[]',
  hints text not null default '[]',
  claimed integer not null default 0,
  updated_at text not null default (datetime('now')),
  primary key (user_id, level)
);

create table if not exists plays (
  id integer primary key autoincrement,
  user_id integer not null,
  level integer not null,
  word text not null,
  points integer not null,
  bonus integer not null default 0,
  day text not null,
  created_at text not null default (datetime('now'))
);

create index if not exists ix_plays_day_user on plays (day, user_id);
create index if not exists ix_plays_user on plays (user_id, day);
create index if not exists ix_players_points on players (total_points desc);
`;

export interface ProgressRow {
  user_id: number;
  level: number;
  words: string[];
  hints: { index: number; position: number; letter: string }[];
  claimed: number;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class Store {
  constructor(private readonly db: D1Database) {}

  async init(): Promise<void> {
    const statements = SCHEMA.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const sql of statements) await this.db.prepare(sql).run();
  }

  // ---------------------------------------------------------------- players
  async getPlayer(id: number): Promise<PlayerRow | null> {
    const row = await this.db
      .prepare("select * from players where id = ?")
      .bind(id)
      .first<PlayerRow>();
    return row ?? null;
  }

  async upsertPlayer(user: {
    id: number;
    first_name?: string;
    username?: string;
    photo_url?: string;
  }): Promise<PlayerRow> {
    await this.db
      .prepare(
        `insert into players (id, username, first_name, photo_url, last_played, streak)
         values (?1, ?2, ?3, ?4, null, 0)
         on conflict(id) do update set
           username = excluded.username,
           first_name = excluded.first_name,
           photo_url = coalesce(excluded.photo_url, players.photo_url),
           updated_at = datetime('now')`,
      )
      .bind(user.id, user.username ?? null, user.first_name ?? null, user.photo_url ?? null)
      .run();
    return (await this.getPlayer(user.id))!;
  }

  /** به‌روزرسانی استریک بر اساس روز آخرین بازی */
  async touchStreak(player: PlayerRow, today = tehranDay()): Promise<PlayerRow> {
    if (player.last_played === today) return player;
    const yesterday = tehranDay(new Date(Date.now() - 86_400_000));
    const streak = player.last_played === yesterday ? player.streak + 1 : 1;
    await this.db
      .prepare("update players set streak = ?, last_played = ?, updated_at = datetime('now') where id = ?")
      .bind(streak, today, player.id)
      .run();
    return { ...player, streak, last_played: today };
  }

  async addCoins(userId: number, delta: number): Promise<void> {
    await this.db
      .prepare(
        "update players set coins = max(0, coins + ?), updated_at = datetime('now') where id = ?",
      )
      .bind(delta, userId)
      .run();
  }

  async addPoints(userId: number, points: number): Promise<void> {
    await this.db
      .prepare("update players set total_points = total_points + ?, updated_at = datetime('now') where id = ?")
      .bind(points, userId)
      .run();
  }

  async setLevel(userId: number, level: number): Promise<void> {
    await this.db
      .prepare("update players set level = max(level, ?), updated_at = datetime('now') where id = ?")
      .bind(level, userId)
      .run();
  }

  async addHints(userId: number, delta: number): Promise<void> {
    await this.db
      .prepare("update players set hints = max(0, hints + ?), updated_at = datetime('now') where id = ?")
      .bind(delta, userId)
      .run();
  }

  // ---------------------------------------------------------------- progress
  async getProgress(userId: number, level: number): Promise<ProgressRow> {
    const row = await this.db
      .prepare("select * from progress where user_id = ? and level = ?")
      .bind(userId, level)
      .first<Record<string, unknown>>();
    if (!row) {
      return { user_id: userId, level, words: [], hints: [], claimed: 0 };
    }
    return {
      user_id: userId,
      level,
      words: parseJson<string[]>(row.words, []),
      hints: parseJson<{ index: number; position: number; letter: string }[]>(row.hints, []),
      claimed: Number(row.claimed ?? 0),
    };
  }

  async saveProgress(progress: ProgressRow): Promise<void> {
    await this.db
      .prepare(
        `insert into progress (user_id, level, words, hints, claimed, updated_at)
         values (?, ?, ?, ?, ?, datetime('now'))
         on conflict(user_id, level) do update set
           words = excluded.words,
           hints = excluded.hints,
           claimed = excluded.claimed,
           updated_at = datetime('now')`,
      )
      .bind(
        progress.user_id,
        progress.level,
        JSON.stringify(progress.words),
        JSON.stringify(progress.hints),
        progress.claimed,
      )
      .run();
  }

  // ---------------------------------------------------------------- plays
  async logPlay(opts: {
    userId: number;
    level: number;
    word: string;
    points: number;
    bonus: boolean;
    day?: string;
  }): Promise<void> {
    await this.db
      .prepare(
        "insert into plays (user_id, level, word, points, bonus, day) values (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        opts.userId,
        opts.level,
        opts.word,
        opts.points,
        opts.bonus ? 1 : 0,
        opts.day ?? tehranDay(),
      )
      .run();
  }

  /** امتیاز امروز یک بازیکن */
  async todayPoints(userId: number, today = tehranDay()): Promise<number> {
    const row = await this.db
      .prepare("select coalesce(sum(points), 0) as points from plays where user_id = ? and day = ?")
      .bind(userId, today)
      .first<{ points: number }>();
    return Number(row?.points ?? 0);
  }

  /** رتبهٔ بازیکن در جدول امروز */
  async todayRank(userId: number, today = tehranDay()): Promise<number | null> {
    const row = await this.db
      .prepare(
        `select count(*) as rank from (
           select user_id, sum(points) as p from plays where day = ? group by user_id
         ) t where t.p > (select coalesce(sum(points),0) from plays where user_id = ? and day = ?)`,
      )
      .bind(today, userId, today)
      .first<{ rank: number }>();
    if (!row) return null;
    const points = await this.todayPoints(userId, today);
    if (points === 0) return null;
    return Number(row.rank) + 1;
  }

  async leaderboard(period: "today" | "week" | "all", limit = 50): Promise<LeaderRow[]> {
    if (period === "all") {
      const res = await this.db
        .prepare(
          `select id, first_name, username, total_points as points from players
           where total_points > 0 order by total_points desc, id asc limit ?`,
        )
        .bind(limit)
        .all<LeaderRow>();
      return res.results ?? [];
    }
    const days = period === "today" ? 1 : 7;
    const res = await this.db
      .prepare(
        `select p.id, p.first_name, p.username, sum(pl.points) as points
         from plays pl join players p on p.id = pl.user_id
         where pl.day >= date(?, ?)
         group by pl.user_id
         order by points desc, p.id asc
         limit ?`,
      )
      .bind(tehranDay(), `-${days - 1} days`, limit)
      .all<LeaderRow>();
    return res.results ?? [];
  }

  async playerCount(): Promise<number> {
    const row = await this.db.prepare("select count(*) as c from players").first<{ c: number }>();
    return Number(row?.c ?? 0);
  }

  async ensurePlayer(user: {
    id: number;
    first_name?: string;
    username?: string;
    photo_url?: string;
  }): Promise<PlayerRow> {
    return this.upsertPlayer(user);
  }
}

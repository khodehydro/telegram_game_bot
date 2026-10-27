/** D1 (SQLite) persistence layer — the Cloudflare counterpart of `bot/db/storage.py`. */

export interface UserRow {
  id: number;
  username: string | null;
  first_name: string | null;
  games_played: number;
  wins: number;
  losses: number;
  points: number;
}

export interface SessionRow {
  id: string;
  chat_id: number;
  chat_type: string;
  game: string;
  status: "lobby" | "running" | "finished";
  owner_id: number;
  message_id: number | null;
  state: any;
  created_at?: string;
  updated_at?: string;
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function rowToSession(row: any): SessionRow {
  return {
    ...row,
    state: typeof row.state === "string" ? JSON.parse(row.state) : row.state,
  };
}

export class Storage {
  constructor(private readonly db: D1Database) {}

  async init(): Promise<void> {
    // Tables are normally created by `schema.sql`; this makes a fresh database
    // usable even if the operator forgot to run it.
    const stmts = SCHEMA.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length && !s.startsWith("--"));
    for (const stmt of stmts) {
      await this.db.prepare(stmt).run();
    }
  }

  // ------------------------------------------------------------------ users
  async upsertUser(id: number, username: string | null, firstName: string | null): Promise<UserRow> {
    const existing = await this.getUser(id);
    if (existing) {
      await this.db
        .prepare("update users set username = ?, first_name = ? where id = ?")
        .bind(username, firstName, id)
        .run();
      return { ...existing, username, first_name: firstName };
    }
    await this.db
      .prepare("insert into users (id, username, first_name) values (?, ?, ?)")
      .bind(id, username, firstName)
      .run();
    return (await this.getUser(id))!;
  }

  async getUser(id: number): Promise<UserRow | null> {
    const row = await this.db.prepare("select * from users where id = ?").bind(id).first<UserRow>();
    return row ?? null;
  }

  async leaderboard(limit = 10): Promise<UserRow[]> {
    const res = await this.db
      .prepare(
        `select * from users where games_played > 0
         order by wins desc, points desc, games_played desc limit ?`,
      )
      .bind(limit)
      .all<UserRow>();
    return res.results ?? [];
  }

  // ------------------------------------------------------------------ sessions
  async createSession(opts: {
    chatId: number;
    chatType: string;
    game: string;
    ownerId: number;
    players: number[];
  }): Promise<SessionRow> {
    const id = newId();
    const state = { phase: "lobby", players: opts.players };
    await this.db
      .prepare(
        `insert into game_sessions (id, chat_id, chat_type, game, status, owner_id, state)
         values (?, ?, ?, ?, 'lobby', ?, ?)`,
      )
      .bind(id, opts.chatId, opts.chatType, opts.game, opts.ownerId, JSON.stringify(state))
      .run();
    return (await this.getSession(id))!;
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = await this.db.prepare("select * from game_sessions where id = ?").bind(id).first();
    return row ? rowToSession(row) : null;
  }

  async getActiveSession(chatId: number): Promise<SessionRow | null> {
    const row = await this.db
      .prepare(
        `select * from game_sessions where chat_id = ? and status in ('lobby','running')
         order by created_at desc limit 1`,
      )
      .bind(chatId)
      .first();
    return row ? rowToSession(row) : null;
  }

  async saveSession(session: SessionRow): Promise<void> {
    await this.db
      .prepare(
        `update game_sessions set status = ?, state = ?, message_id = ?, updated_at = datetime('now')
         where id = ?`,
      )
      .bind(session.status, JSON.stringify(session.state), session.message_id, session.id)
      .run();
  }

  async finishSession(id: string): Promise<void> {
    await this.db
      .prepare("update game_sessions set status = 'finished', updated_at = datetime('now') where id = ?")
      .bind(id)
      .run();
  }

  async listActiveSessions(): Promise<SessionRow[]> {
    const res = await this.db
      .prepare("select * from game_sessions where status in ('lobby','running')")
      .all();
    return (res.results ?? []).map(rowToSession);
  }

  // ------------------------------------------------------------------ results
  async recordResult(opts: {
    sessionId: string;
    game: string;
    chatId: number;
    players: { user_id: number; seat: number; won: boolean; points: number }[];
    winnerSeat: number | null;
  }): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `insert into match_results (session_id, game, chat_id, players, winner_seat)
           values (?, ?, ?, ?, ?)`,
        )
        .bind(
          opts.sessionId,
          opts.game,
          opts.chatId,
          JSON.stringify(opts.players),
          opts.winnerSeat,
        ),
    ];
    for (const entry of opts.players) {
      statements.push(
        this.db
          .prepare(
            `insert into users (id, games_played, wins, losses, points) values (?, 1, ?, ?, ?)
             on conflict(id) do update set
               games_played = games_played + 1,
               wins = wins + excluded.wins,
               losses = losses + excluded.losses,
               points = points + excluded.points`,
          )
          .bind(
            entry.user_id,
            entry.won ? 1 : 0,
            entry.won ? 0 : 1,
            Math.trunc(entry.points ?? 0),
          ),
      );
    }
    await this.db.batch(statements);
  }
}

export const SCHEMA = `
create table if not exists users (
  id integer primary key,
  username text,
  first_name text,
  created_at text default (datetime('now')),
  games_played integer default 0,
  wins integer default 0,
  losses integer default 0,
  points integer default 0
);

create table if not exists game_sessions (
  id text primary key,
  chat_id integer not null,
  chat_type text default 'group',
  game text not null,
  status text default 'lobby',
  owner_id integer not null,
  message_id integer,
  state text default '{}',
  created_at text default (datetime('now')),
  updated_at text default (datetime('now'))
);

create index if not exists ix_game_sessions_chat_id on game_sessions (chat_id);
create index if not exists ix_game_sessions_status on game_sessions (status);

create table if not exists match_results (
  id integer primary key autoincrement,
  session_id text references game_sessions (id) on delete cascade,
  game text not null,
  chat_id integer not null,
  players text default '[]',
  winner_seat integer,
  created_at text default (datetime('now'))
);

create index if not exists ix_match_results_game on match_results (game)
`;

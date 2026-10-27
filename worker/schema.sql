-- Cloudflare D1 schema.  Apply with:
--   npx wrangler d1 execute telegram-card-games --remote --file=./schema.sql
-- (the worker also creates the tables on first use)

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

create index if not exists ix_match_results_game on match_results (game);

-- Schema for the Telegram card-games bot.
-- The bot creates these tables automatically on start-up (SQLAlchemy
-- create_all); this file is for manual setup, inspection or Supabase SQL editor.

create table if not exists users (
    id            bigint primary key,
    username      varchar(64),
    first_name    varchar(128),
    created_at    timestamptz default now(),
    games_played  integer default 0,
    wins          integer default 0,
    losses        integer default 0,
    points        integer default 0
);

create table if not exists game_sessions (
    id          varchar(32) primary key,
    chat_id     bigint not null,
    chat_type   varchar(16) default 'group',
    game        varchar(16) not null,
    status      varchar(16) default 'lobby',
    owner_id    bigint not null,
    message_id  bigint,
    state       jsonb default '{}'::jsonb,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

create index if not exists ix_game_sessions_chat_id on game_sessions (chat_id);
create index if not exists ix_game_sessions_status on game_sessions (status);

create table if not exists match_results (
    id          serial primary key,
    session_id  varchar(32) references game_sessions (id) on delete cascade,
    game        varchar(16) not null,
    chat_id     bigint not null,
    players     jsonb default '[]'::jsonb,
    winner_seat integer,
    created_at  timestamptz default now()
);

create index if not exists ix_match_results_game on match_results (game);

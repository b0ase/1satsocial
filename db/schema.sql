-- 1satsocial schema. Applied automatically on first use; kept here for review / manual migration.
create table if not exists ss_messages (
  id bigserial primary key,
  room text not null,          -- "bsv21:<id>", "bsv20:<TICK>", "coll:<collection origin outpoint>"
  user_id text not null,       -- identity key (Yours v5) or ordinals address (legacy)
  name text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ss_messages_room_id on ss_messages (room, id);

-- Provisional access from a purchase the server verified on the network but indexers haven't confirmed yet.
create table if not exists ss_grants (
  room text not null,
  user_id text not null,
  txid text not null,
  holding text not null,
  expires_at timestamptz not null,
  primary key (room, txid)
);

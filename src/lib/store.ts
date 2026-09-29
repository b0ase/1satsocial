import postgres from "postgres";

export type Message = {
  id: number;
  room: string;
  userId: string;
  name: string | null;
  body: string;
  createdAt: string;
};

export type RoomActivity = { room: string; messages: number; members: number; lastAt: string };

/** Provisional room access from a verified-but-unconfirmed purchase, until the indexers catch up. */
export type Grant = { room: string; userId: string; txid: string; holding: string; expiresAt: string };

interface Store {
  add(m: Omit<Message, "id" | "createdAt">): Promise<Message>;
  list(room: string, opts: { after?: number; limit?: number }): Promise<Message[]>;
  activeRooms(limit: number): Promise<RoomActivity[]>;
  /** False if this transaction has already been claimed for the room (by anyone). */
  addGrant(g: Grant): Promise<boolean>;
  activeGrant(room: string, userId: string): Promise<Grant | null>;
}

// ---- In-memory store (dev / no DATABASE_URL). Survives HMR, not restarts.
// Process-wide state lives on globalThis so it survives dev hot reloads; the store objects themselves
// are rebuilt on each module load so new methods take effect (a cached instance would keep old code).
type MemoryData = { rows: Message[]; seq: number; grants: Grant[] };
const g = globalThis as unknown as { __ssMemory?: MemoryData; __ssSql?: postgres.Sql };

class MemoryStore implements Store {
  private data: MemoryData = (g.__ssMemory ??= { rows: [], seq: 0, grants: [] });
  private get rows() {
    return this.data.rows;
  }
  private get grants() {
    return this.data.grants;
  }
  async addGrant(g: Grant) {
    const existing = this.grants.find((x) => x.txid === g.txid && x.room === g.room);
    if (existing) return existing.userId === g.userId;
    this.grants.unshift(g);
    return true;
  }
  async activeGrant(room: string, userId: string) {
    const now = new Date().toISOString();
    return this.grants.find((g) => g.room === room && g.userId === userId && g.expiresAt > now) ?? null;
  }
  async add(m: Omit<Message, "id" | "createdAt">) {
    const row = { ...m, id: ++this.data.seq, createdAt: new Date().toISOString() };
    this.rows.push(row);
    return row;
  }
  async list(room: string, { after, limit = 100 }: { after?: number; limit?: number }) {
    const rows = this.rows.filter((r) => r.room === room && (after === undefined || r.id > after));
    return after === undefined ? rows.slice(-limit) : rows.slice(0, limit);
  }
  async activeRooms(limit: number) {
    const by = new Map<string, { messages: number; users: Set<string>; lastAt: string }>();
    for (const r of this.rows) {
      const e = by.get(r.room) ?? { messages: 0, users: new Set(), lastAt: r.createdAt };
      e.messages++;
      e.users.add(r.userId);
      e.lastAt = r.createdAt;
      by.set(r.room, e);
    }
    return [...by]
      .map(([room, e]) => ({ room, messages: e.messages, members: e.users.size, lastAt: e.lastAt }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .slice(0, limit);
  }
}

// ---- Postgres store (production). Schema lives in db/schema.sql and is applied on first use.
class PgStore implements Store {
  private sql: postgres.Sql;
  private ready: Promise<unknown>;
  constructor(url: string) {
    this.sql = g.__ssSql ??= postgres(url, { max: 5, idle_timeout: 20, onnotice: () => {} });
    this.ready = this.sql`
      create table if not exists ss_messages (
        id bigserial primary key,
        room text not null,
        user_id text not null,
        name text,
        body text not null,
        created_at timestamptz not null default now()
      )`.then(() => this.sql`create index if not exists ss_messages_room_id on ss_messages (room, id)`)
      .then(
        () => this.sql`
          create table if not exists ss_grants (
            room text not null,
            user_id text not null,
            txid text not null,
            holding text not null,
            expires_at timestamptz not null,
            primary key (room, txid)
          )`,
      );
  }
  private map = (r: postgres.Row): Message => ({
    id: Number(r.id),
    room: r.room,
    userId: r.user_id,
    name: r.name,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
  });
  async add(m: Omit<Message, "id" | "createdAt">) {
    await this.ready;
    const [row] = await this.sql`
      insert into ss_messages (room, user_id, name, body)
      values (${m.room}, ${m.userId}, ${m.name}, ${m.body}) returning *`;
    return this.map(row);
  }
  async list(room: string, { after, limit = 100 }: { after?: number; limit?: number }) {
    await this.ready;
    const rows =
      after === undefined
        ? await this.sql`select * from (select * from ss_messages where room = ${room} order by id desc limit ${limit}) t order by id`
        : await this.sql`select * from ss_messages where room = ${room} and id > ${after} order by id limit ${limit}`;
    return rows.map(this.map);
  }
  async addGrant(g: Grant) {
    await this.ready;
    await this.sql`
      insert into ss_grants (room, user_id, txid, holding, expires_at)
      values (${g.room}, ${g.userId}, ${g.txid}, ${g.holding}, ${g.expiresAt})
      on conflict (room, txid) do nothing`;
    const [row] = await this.sql`select user_id from ss_grants where room = ${g.room} and txid = ${g.txid}`;
    return row?.user_id === g.userId;
  }
  async activeGrant(room: string, userId: string) {
    await this.ready;
    const [r] = await this.sql`
      select * from ss_grants where room = ${room} and user_id = ${userId} and expires_at > now()
      order by expires_at desc limit 1`;
    return r
      ? { room: r.room, userId: r.user_id, txid: r.txid, holding: r.holding, expiresAt: new Date(r.expires_at).toISOString() }
      : null;
  }
  async activeRooms(limit: number) {
    await this.ready;
    const rows = await this.sql`
      select room, count(*)::int as messages, count(distinct user_id)::int as members, max(created_at) as last_at
      from ss_messages where created_at > now() - interval '30 days'
      group by room order by last_at desc limit ${limit}`;
    return rows.map((r) => ({ room: r.room, messages: r.messages, members: r.members, lastAt: new Date(r.last_at).toISOString() }));
  }
}

export const store: Store = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();

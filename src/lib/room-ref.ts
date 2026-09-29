// Pure helpers, safe to import in the browser.
export type RoomKind = "bsv21" | "bsv20" | "coll";
export type RoomRef = { kind: RoomKind; id: string; key: string };

const OUTPOINT = /^[0-9a-f]{64}_\d{1,6}$/;
const TICK = /^[^\s/<>"'`]{1,32}$/u;

export function parseRoom(kind: string, rawId: string): RoomRef | null {
  const id = decodeURIComponent(rawId).trim();
  if ((kind === "bsv21" || kind === "coll") && OUTPOINT.test(id.toLowerCase())) {
    const norm = id.toLowerCase();
    return { kind, id: norm, key: `${kind}:${norm}` };
  }
  if (kind === "bsv20" && TICK.test(id)) {
    const norm = id.toUpperCase();
    return { kind, id: norm, key: `bsv20:${norm}` };
  }
  return null;
}

export function roomFromKey(key: string): RoomRef | null {
  const i = key.indexOf(":");
  return i > 0 ? parseRoom(key.slice(0, i), key.slice(i + 1)) : null;
}

export function roomPath(r: Pick<RoomRef, "kind" | "id">) {
  return `/r/${r.kind}/${encodeURIComponent(r.id)}`;
}

/** Turn whatever the user pasted (token id, tick, collection outpoint, 1sat.market URL) into a room. */
export function resolveRoomInput(input: string): RoomRef | null {
  const s = input.trim();
  const outpoint = s.match(/([0-9a-fA-F]{64})[_.](\d{1,6})/);
  if (outpoint) {
    const id = `${outpoint[1]}_${outpoint[2]}`;
    const kind: RoomKind = /collection/i.test(s) ? "coll" : "bsv21";
    return parseRoom(kind, id);
  }
  const tick = s.replace(/^\$/, "");
  return parseRoom("bsv20", tick);
}

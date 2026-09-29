import { ImageResponse } from "next/og";
import { roomMeta } from "@/lib/indexer";
import { roomMarket } from "@/lib/market";
import { parseRoom } from "@/lib/room-ref";
import { store } from "@/lib/store";

export const alt = "Holder-only chat room on 1satsocial";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#e8b04a";
// Satori (ImageResponse) renders these; WebP/AVIF inscriptions fall back to initials.
const RENDERABLE = ["image/png", "image/jpeg", "image/gif", "image/svg+xml"];

async function iconDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !RENDERABLE.includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1_500_000) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = { bsv21: "BSV-21 token", bsv20: "BSV-20 token", coll: "1Sat Ordinals collection" };

export default async function Image({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const room = parseRoom(kind, id);
  const meta = room ? await roomMeta(room.kind, room.id) : null;
  const [icon, market, active] = await Promise.all([
    iconDataUrl(meta?.image ?? null),
    room ? roomMarket(room).catch(() => null) : null,
    store.activeRooms(200).catch(() => []),
  ]);
  const chat = room ? active.find((a) => a.room === room.key) : undefined;
  const title = meta?.title ?? "Holder-only room";

  const stats: [string, string][] = [];
  if (meta?.holders) stats.push(["Holders", meta.holders.toLocaleString("en-US")]);
  if (market?.floorLabel) stats.push(["Floor", market.floorLabel]);
  if (chat) stats.push(["Chatting", `${chat.members} ${chat.members === 1 ? "member" : "members"}`]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(circle at 85% 15%, #2a2210 0%, #09090b 55%)",
          color: "#ededf0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                background: GOLD,
                color: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              1
            </div>
            <div style={{ display: "flex" }}>
              1sat<span style={{ color: GOLD }}>social</span>
            </div>
          </div>
          <div style={{ display: "flex", padding: "8px 20px", borderRadius: 999, border: `2px solid ${GOLD}`, color: GOLD, fontSize: 24 }}>
            🔒 Holders only
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <div
            style={{
              width: 200,
              height: 200,
              borderRadius: 32,
              background: "#17171b",
              border: "2px solid #26262c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              color: GOLD,
              fontSize: 72,
              fontWeight: 700,
            }}
          >
            {icon ? (
              <img src={icon} width={200} height={200} style={{ objectFit: "cover" }} alt="" />
            ) : (
              title.replace("$", "").slice(0, 2)
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 780 }}>
            <div style={{ fontSize: title.length > 18 ? 64 : 88, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: "flex", fontSize: 32, color: "#8b8b95", marginTop: 8 }}>
              {`${room ? KIND_LABEL[room.kind] : "Chat room"} · group chat`}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 56 }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 22, color: "#8b8b95", textTransform: "uppercase", letterSpacing: 2 }}>{label}</div>
                <div style={{ fontSize: 38, fontWeight: 600, color: label === "Floor" ? GOLD : "#ededf0" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#8b8b95" }}>Hold it to join · buy in with Yours</div>
        </div>
      </div>
    ),
    size,
  );
}

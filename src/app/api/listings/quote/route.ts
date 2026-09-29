import { json } from "@/lib/http";
import { quoteListing } from "@/lib/quote";
import { parseRoom } from "@/lib/room-ref";

// GET /api/listings/quote?kind=bsv21&id=<tokenId>&outpoint=<txid_vout>&label=<text>&chatOnly=1
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const room = parseRoom(q.get("kind") ?? "", q.get("id") ?? "");
  if (!room || room.kind === "bsv20") return json({ error: "Unsupported room" }, 400);

  const address = process.env.NEXT_PUBLIC_MARKET_FEE_ADDRESS;
  const rate = Number(process.env.NEXT_PUBLIC_MARKET_FEE_RATE);
  const quote = await quoteListing(room, {
    outpoint: q.get("outpoint") ?? "",
    label: (q.get("label") ?? "Listing").slice(0, 80),
    chatOnly: q.get("chatOnly") === "1",
    marketFee: address && rate > 0 ? { address, rate } : undefined,
  });
  return json(quote, "error" in quote ? 409 : 200);
}

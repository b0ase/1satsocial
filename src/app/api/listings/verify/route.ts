import { json } from "@/lib/http";
import { verifyListing } from "@/lib/overlay";

// GET /api/listings/verify?tokenId=<id>&outpoint=<txid_vout>
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tokenId = q.get("tokenId") ?? "";
  const outpoint = q.get("outpoint") ?? "";
  if (!/^[0-9a-f]{64}_\d+$/.test(tokenId)) return json({ ok: false, reason: "bad-token" }, 400);
  return json(await verifyListing(tokenId, outpoint));
}

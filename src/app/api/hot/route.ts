import { hotBoard } from "@/lib/hot";

// GET /api/hot: the landing page's live board. Shared CDN caching keeps upstream APIs calm.
export async function GET() {
  return Response.json(await hotBoard(), {
    headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}

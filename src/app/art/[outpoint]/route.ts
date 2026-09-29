import { fetchContent, isOutpoint } from "@/lib/content";

// Only image content is proxied; inscriptions can be anything (HTML, JS), which we never serve from our origin.
const IMAGE = /^image\/(png|jpeg|gif|webp|avif|svg\+xml|bmp)$/;

// GET /art/<txid_vout>: an inscription's image, cached for a year (content at an outpoint never changes).
export async function GET(_req: Request, ctx: RouteContext<"/art/[outpoint]">) {
  const { outpoint } = await ctx.params;
  if (!isOutpoint(outpoint)) return new Response("Bad outpoint", { status: 400 });
  const content = await fetchContent(outpoint);
  if (!content) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  if (!IMAGE.test(content.type)) return new Response("Not an image", { status: 415, headers: { "cache-control": "public, max-age=86400" } });
  return new Response(content.bytes as BodyInit, {
    headers: {
      "content-type": content.type,
      "cache-control": "public, max-age=31536000, immutable",
      // SVGs can carry script: never let one execute or render as a document from our origin.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

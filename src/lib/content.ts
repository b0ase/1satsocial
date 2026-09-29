// Inscription content (token icons, collection art): 1sat-stack's ORDFS, with ordfs.network as a second ORDFS host.
const HOSTS = ["https://api.1sat.app/content", "https://ordfs.network/content"];

const OUTPOINT = /^[0-9a-f]{64}_\d{1,6}$/;
export const MAX_ART_BYTES = 8_000_000;

export function isOutpoint(s: string) {
  return OUTPOINT.test(s);
}

/** Site-relative URL for an inscription's content, served by /art/[outpoint] with long-lived caching. */
export function artUrl(outpoint: string | null | undefined): string | null {
  return outpoint && isOutpoint(outpoint) ? `/art/${outpoint}` : null;
}

export async function fetchContent(outpoint: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isOutpoint(outpoint)) return null;
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/${outpoint}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!res.ok) continue;
      const type = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_ART_BYTES) continue;
      return { bytes: buf, type };
    } catch {
      /* slow or down: try the next host */
    }
  }
  return null;
}

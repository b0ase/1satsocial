// BSV/USD spot price for showing estimated dollar prices. Tries several public sources in order.

type Source = { name: string; url: string; read: (data: unknown) => number | undefined };

const SOURCES: Source[] = [
  {
    name: "whatsonchain",
    url: "https://api.whatsonchain.com/v1/bsv/main/exchangerate",
    read: (d) => Number((d as { rate?: number }).rate),
  },
  {
    name: "coinpaprika",
    url: "https://api.coinpaprika.com/v1/tickers/bsv-bitcoin-sv",
    read: (d) => Number((d as { quotes?: { USD?: { price?: number } } }).quotes?.USD?.price),
  },
  {
    name: "kucoin",
    url: "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BSV-USDT",
    read: (d) => Number((d as { data?: { price?: string } }).data?.price),
  },
  {
    name: "gate",
    url: "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BSV_USDT",
    read: (d) => Number((d as { last?: string }[])[0]?.last),
  },
];

const g = globalThis as unknown as { __ssPrice?: { usd: number; expires: number } };

/** USD per BSV, cached 5 minutes. Null if every source fails. */
export async function bsvUsd(): Promise<number | null> {
  if (g.__ssPrice && g.__ssPrice.expires > Date.now()) return g.__ssPrice.usd;
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
      if (!res.ok) continue;
      const usd = s.read(await res.json());
      if (Number.isFinite(usd) && usd! > 0) {
        g.__ssPrice = { usd: usd!, expires: Date.now() + 5 * 60_000 };
        return usd!;
      }
    } catch {
      /* try the next source */
    }
  }
  return g.__ssPrice?.usd ?? null; // stale beats nothing
}

/** "$4.19", "$0.02", "$0.0035" (two significant figures below a cent), "<$0.000001" */
export function formatUsd(sats: number, usdPerBsv: number): string {
  const usd = (sats / 1e8) * usdPerBsv;
  if (usd > 0 && usd < 0.000001) return "<$0.000001";
  if (usd > 0 && usd < 0.01) {
    const fixed = Number(usd.toPrecision(2)).toFixed(Math.min(6, 1 - Math.floor(Math.log10(usd))));
    return `$${fixed.replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usd >= 100 ? 0 : 2 });
}

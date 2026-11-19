import { ApiError } from "./solana.js";

export interface SolPrice {
  usd: number;
  source: string;
  updatedAt: number;
}

const CACHE_MS = 60_000;
let cached: SolPrice | null = null;
let inflight: Promise<SolPrice> | null = null;

const SOURCES: { name: string; url: string; parse(data: any): number }[] = [
  {
    name: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    parse: (d) => d?.solana?.usd,
  },
  {
    name: "binance",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
    parse: (d) => Number(d?.price),
  },
];

async function fetchPrice(): Promise<SolPrice> {
  const failures: string[] = [];
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const usd = source.parse(await res.json());
      if (!Number.isFinite(usd) || usd <= 0) throw new Error("unexpected response");
      return { usd, source: source.name, updatedAt: Date.now() };
    } catch (err) {
      failures.push(`${source.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(failures.join("; "));
}

/** Mainnet SOL/USD price, cached for a minute. Serves a stale price if all sources fail. */
export async function getSolPrice(): Promise<SolPrice> {
  if (cached && Date.now() - cached.updatedAt < CACHE_MS) return cached;
  inflight ??= fetchPrice().finally(() => (inflight = null));
  try {
    cached = await inflight;
    return cached;
  } catch (err) {
    if (cached) return cached;
    throw new ApiError(`SOL price unavailable (${err instanceof Error ? err.message : err})`, 502);
  }
}

import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { ApiError, connect, parseNetwork, parsePubkey } from "./solana.js";

/** Tokens the swap is allowed to route between. */
export const TOKENS = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
} as const;

const ALLOWED_MINTS = new Set<string>(Object.values(TOKENS).map((t) => t.mint));

async function jupiter<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.jupiter.apiKey) headers["x-api-key"] = config.jupiter.apiKey;
  const res = await fetch(`${config.jupiter.apiUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = data?.error ?? data?.message ?? `HTTP ${res.status}`;
    // Jupiter 4xx = bad input / no route; anything else is upstream trouble.
    throw new ApiError(`Jupiter: ${msg}`, res.status >= 400 && res.status < 500 ? 400 : 502);
  }
  return data as T;
}

function requireMint(value: unknown, field: string): string {
  if (typeof value !== "string" || !ALLOWED_MINTS.has(value)) {
    throw new ApiError(`${field} must be SOL or USDT`);
  }
  return value;
}

export async function getQuote(query: Record<string, unknown>) {
  const inputMint = requireMint(query.inputMint, "inputMint");
  const outputMint = requireMint(query.outputMint, "outputMint");
  if (inputMint === outputMint) throw new ApiError("inputMint and outputMint must differ");

  const amount = String(query.amount ?? "");
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new ApiError("amount must be a positive integer in base units");
  }
  const slippageBps = query.slippageBps === undefined ? 50 : Number(query.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) {
    throw new ApiError("slippageBps must be an integer between 1 and 5000");
  }

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
  });
  return jupiter<Record<string, unknown>>(`/quote?${params}`);
}

/** Turns a quote into an unsigned transaction for the user's wallet to sign. */
export async function buildSwap(body: unknown) {
  const b = (body ?? {}) as Record<string, any>;
  const user = parsePubkey(b.userPublicKey, "userPublicKey");
  const quote = b.quoteResponse;
  if (!quote || typeof quote !== "object") throw new ApiError("quoteResponse is required");
  requireMint(quote.inputMint, "quoteResponse.inputMint");
  requireMint(quote.outputMint, "quoteResponse.outputMint");

  return jupiter<{ swapTransaction: string; lastValidBlockHeight: number; prioritizationFeeLamports?: number }>(
    "/swap",
    {
      method: "POST",
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: user.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        // Pay a competitive priority fee, capped at 0.001 SOL.
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" },
        },
      }),
    },
  );
}

/** Sums the owner's token accounts for `mint` (an owner can hold several). */
export async function getTokenBalance(query: Record<string, unknown>) {
  const { rpcUrl } = parseNetwork(query);
  const owner = parsePubkey(query.pubkey);
  const mint = parsePubkey(query.mint, "mint");
  const { value } = await connect(rpcUrl).getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });

  let amount = 0n;
  let decimals = Object.values(TOKENS).find((t) => t.mint === mint.toBase58())?.decimals ?? 0;
  for (const { account } of value) {
    const info = account.data.parsed?.info?.tokenAmount;
    if (!info) continue;
    amount += BigInt(info.amount);
    decimals = info.decimals;
  }
  return { mint: mint.toBase58(), amount: amount.toString(), decimals, uiAmount: Number(amount) / 10 ** decimals };
}

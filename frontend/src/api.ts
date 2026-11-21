export type Network = "mainnet" | "devnet" | "testnet" | "custom";

/** The selected network; `rpcUrl` is only set for custom. */
export interface NetSelection {
  network: Network;
  rpcUrl?: string;
}

export interface ServerConfig {
  maxAirdropSol: number;
  mainnetEnabled: boolean;
  faucetAddress: string | null;
}

export interface AirdropResult {
  signature: string;
  method: "airdrop" | "transfer";
  rpcUrl: string;
  balance: number;
}

export interface BalanceResult {
  pubkey: string;
  lamports: number;
  balance: number;
}

export interface BlockhashResult {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SendResult {
  signature: string;
  rpcUrl: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function query(net: NetSelection, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ network: net.network, ...extra });
  if (net.rpcUrl) params.set("rpcUrl", net.rpcUrl);
  return params.toString();
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getConfig = () => request<ServerConfig>("/api/config");

export const requestAirdrop = (net: NetSelection, amount: string, pubkey: string) =>
  request<AirdropResult>("/api/airdrop", post({ ...net, amount, pubkey }));

export const getBalance = (net: NetSelection, pubkey: string) =>
  request<BalanceResult>(`/api/balance?${query(net, { pubkey })}`);

export const getBlockhash = (net: NetSelection) => request<BlockhashResult>(`/api/blockhash?${query(net)}`);

export interface SolPrice {
  usd: number;
  source: string;
  updatedAt: number;
}

export const getSolPrice = () => request<SolPrice>("/api/price");

export const TOKENS = {
  SOL: { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  USDT: { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
} as const;
export type TokenSymbol = keyof typeof TOKENS;

export interface TokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

export const getTokenBalance = (net: NetSelection, pubkey: string, mint: string) =>
  request<TokenBalance>(`/api/token-balance?${query(net, { pubkey, mint })}`);

export interface TokenHolding {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: string;
  program: "token" | "token-2022";
  name: string | null;
  symbol: string | null;
  accounts: number;
}

export const getTokens = (net: NetSelection, pubkey: string) =>
  request<{ owner: string; tokens: TokenHolding[] }>(`/api/tokens?${query(net, { pubkey })}`);

/** Jupiter quote; kept opaque except for the fields the UI reads, and passed back verbatim to build. */
export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: { swapInfo: { label: string } }[];
  [key: string]: unknown;
}

export const getSwapQuote = (inputMint: string, outputMint: string, amount: string, slippageBps: number) =>
  request<SwapQuote>(
    `/api/swap/quote?${new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slippageBps) })}`,
  );

export const buildSwap = (quoteResponse: SwapQuote, userPublicKey: string) =>
  request<{ swapTransaction: string; lastValidBlockHeight: number; prioritizationFeeLamports?: number }>(
    "/api/swap/build",
    post({ quoteResponse, userPublicKey }),
  );

export const sendSigned = (net: NetSelection, tx: string, lastValidBlockHeight: number) =>
  request<SendResult>("/api/send", post({ ...net, tx, lastValidBlockHeight }));

export function explorerTxUrl(signature: string, net: NetSelection, rpcUrl: string): string {
  return explorerUrl("tx", signature, net, rpcUrl);
}

export function explorerAddressUrl(address: string, net: NetSelection): string {
  return explorerUrl("account", address, net, net.rpcUrl ?? "");
}

export function explorerTokenUrl(mint: string, net: NetSelection): string {
  return explorerUrl("token", mint, net, net.rpcUrl ?? "");
}

/**
 * Solscan for the public clusters. Solscan can't read an arbitrary RPC, so custom networks
 * (local validators, forks) fall back to Solana Explorer, which can.
 */
function explorerUrl(kind: "tx" | "account" | "token", id: string, net: NetSelection, rpcUrl: string): string {
  if (net.network === "custom") {
    const path = kind === "tx" ? `tx/${id}` : `address/${id}`;
    return `https://explorer.solana.com/${path}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  }
  const base = `https://solscan.io/${kind}/${id}`;
  return net.network === "mainnet" ? base : `${base}?cluster=${net.network}`;
}

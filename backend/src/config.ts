import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${name}: ${raw}`);
  return value;
}

function loadFaucet(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY?.trim();
  if (!raw) return null;
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}

export const config = {
  port: num("PORT", 4100),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5180").split(",").map((s) => s.trim()),
  maxAirdropSol: num("MAX_AIRDROP_SOL", 5),
  rateLimitMax: num("RATE_LIMIT_MAX", 10),
  rateLimitWindowMs: num("RATE_LIMIT_WINDOW_MS", 60_000),
  rpc: {
    mainnet: process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
    devnet: process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com",
    testnet: process.env.TESTNET_RPC_URL || "https://api.testnet.solana.com",
  },
  faucet: loadFaucet(),
  allowMainnet: process.env.ALLOW_MAINNET === "true",
  jupiter: {
    apiUrl: (process.env.JUPITER_API_URL || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, ""),
    apiKey: process.env.JUPITER_API_KEY || null,
  },
};

export type Network = "mainnet" | "devnet" | "testnet" | "custom";
export const NETWORKS: Network[] = ["mainnet", "devnet", "testnet", "custom"];

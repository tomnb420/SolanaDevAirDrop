import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { config } from "./config.js";
import { ApiError, confirmByPolling, connect, parseNetwork, parsePubkey, type ResolvedNetwork } from "./solana.js";

export interface AirdropRequest extends ResolvedNetwork {
  amount: number;
  to: PublicKey;
}

export interface AirdropResult {
  signature: string;
  method: "airdrop" | "transfer";
  rpcUrl: string;
  balance: number;
}

export function parseRequest(body: unknown): AirdropRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const net = parseNetwork(b);

  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError("amount must be a positive number");
  }
  if (amount > config.maxAirdropSol) {
    throw new ApiError(`amount exceeds the maximum of ${config.maxAirdropSol} SOL`);
  }
  if (!/^\d+(\.\d{1,9})?$/.test(String(b.amount))) {
    throw new ApiError("amount supports at most 9 decimal places");
  }

  return { ...net, amount, to: parsePubkey(b.pubkey) };
}

async function viaFaucetRpc(conn: Connection, to: PublicKey, lamports: number): Promise<string> {
  const latest = await conn.getLatestBlockhash("confirmed");
  const signature = await conn.requestAirdrop(to, lamports);
  await confirmByPolling(conn, signature, latest);
  return signature;
}

async function viaTransfer(conn: Connection, to: PublicKey, lamports: number): Promise<string> {
  const faucet = config.faucet;
  if (!faucet) throw new ApiError("No faucet wallet is configured on the server", 503);
  const address = faucet.publicKey.toBase58();

  const balance = await conn.getBalance(faucet.publicKey);
  if (balance < lamports + 5_000) {
    throw new ApiError(
      `Faucet wallet ${address} has ${balance / LAMPORTS_PER_SOL} SOL, not enough for this request. ` +
        "Top it up (devnet/testnet: https://faucet.solana.com) and try again.",
      503,
    );
  }
  const latest = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: faucet.publicKey, ...latest }).add(
    SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: to, lamports }),
  );
  tx.sign(faucet);
  const signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  await confirmByPolling(conn, signature, latest);
  return signature;
}

export async function airdrop(req: AirdropRequest): Promise<AirdropResult> {
  const { to, rpcUrl } = req;
  const lamports = Math.round(req.amount * LAMPORTS_PER_SOL);
  const conn = connect(rpcUrl);

  let signature: string;
  let method: AirdropResult["method"];

  if (req.network === "mainnet") {
    // Mainnet has no faucet; the only option is a real transfer from the server wallet.
    if (!config.allowMainnet) {
      throw new ApiError("Mainnet airdrops are disabled on this server", 403);
    }
    signature = await viaTransfer(conn, to, lamports);
    method = "transfer";
  } else {
    try {
      signature = await viaFaucetRpc(conn, to, lamports);
      method = "airdrop";
    } catch (err) {
      if (!config.faucet) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ApiError(
          `RPC airdrop failed: ${msg.trim()}. Set FAUCET_SECRET_KEY on the server (npm run keygen -w backend) ` +
            "and fund that wallet to send from it instead.",
          502,
        );
      }
      console.warn(`requestAirdrop failed on ${rpcUrl}, falling back to faucet transfer:`, err);
      signature = await viaTransfer(conn, to, lamports);
      method = "transfer";
    }
  }

  const balance = (await conn.getBalance(to, "confirmed")) / LAMPORTS_PER_SOL;
  return { signature, method, rpcUrl, balance };
}

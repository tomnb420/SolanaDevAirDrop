import { LAMPORTS_PER_SOL, SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import { ApiError, confirmByPolling, connect, parseNetwork, parsePubkey } from "./solana.js";

export async function getBalance(query: Record<string, unknown>) {
  const { rpcUrl } = parseNetwork(query);
  const pubkey = parsePubkey(query.pubkey);
  const lamports = await connect(rpcUrl).getBalance(pubkey, "confirmed");
  return { pubkey: pubkey.toBase58(), lamports, balance: lamports / LAMPORTS_PER_SOL };
}

export async function getBlockhash(query: Record<string, unknown>) {
  const { rpcUrl } = parseNetwork(query);
  return connect(rpcUrl).getLatestBlockhash("confirmed");
}

/**
 * Relays a transaction the user already signed in their browser wallet, then confirms it by
 * HTTP polling. The server never holds the user's key.
 */
export async function sendSigned(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const { rpcUrl } = parseNetwork(b);

  if (typeof b.tx !== "string" || !b.tx) throw new ApiError("tx (base64 signed transaction) is required");
  const lastValidBlockHeight = Number(b.lastValidBlockHeight);
  if (!Number.isInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) {
    throw new ApiError("lastValidBlockHeight is required");
  }

  // VersionedTransaction parses both legacy and v0 (Jupiter swaps use v0 + lookup tables).
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(b.tx, "base64"));
  } catch {
    throw new ApiError("tx is not a valid serialized transaction");
  }
  const required = tx.message.header.numRequiredSignatures;
  const signed = tx.signatures.slice(0, required).every((sig) => sig.some((byte) => byte !== 0));
  if (tx.signatures.length < required || !signed) throw new ApiError("Transaction is not fully signed");

  const conn = connect(rpcUrl);
  let signature: string;
  try {
    signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  } catch (err) {
    // Preflight failures (e.g. insufficient funds) are the caller's problem, not a server error.
    if (err instanceof SendTransactionError) throw new ApiError(err.message);
    throw err;
  }
  await confirmByPolling(conn, signature, { lastValidBlockHeight });
  return { signature, rpcUrl };
}

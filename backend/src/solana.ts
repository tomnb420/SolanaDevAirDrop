import { Connection, PublicKey, type BlockhashWithExpiryBlockHeight } from "@solana/web3.js";
import { config, NETWORKS, type Network } from "./config.js";

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface ResolvedNetwork {
  network: Network;
  rpcUrl: string;
}

/** Validates `network` (+ `rpcUrl` for custom) from a request body or query string. */
export function parseNetwork(input: Record<string, unknown>): ResolvedNetwork {
  if (!NETWORKS.includes(input.network as Network)) {
    throw new ApiError(`network must be one of: ${NETWORKS.join(", ")}`);
  }
  const network = input.network as Network;
  if (network !== "custom") return { network, rpcUrl: config.rpc[network] };

  if (typeof input.rpcUrl !== "string" || !input.rpcUrl.trim()) {
    throw new ApiError("rpcUrl is required for a custom network");
  }
  let url: URL;
  try {
    url = new URL(input.rpcUrl.trim());
  } catch {
    throw new ApiError("rpcUrl is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError("rpcUrl must use http or https");
  }
  return { network, rpcUrl: url.toString() };
}

export function parsePubkey(value: unknown, field = "pubkey"): PublicKey {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(`${field} is required`);
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new ApiError(`${field} is not a valid Solana public key`);
  }
}

export const connect = (rpcUrl: string) => new Connection(rpcUrl, "confirmed");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Confirms over plain HTTP polling. web3.js's confirmTransaction subscribes via WebSocket,
// which many RPCs/proxies don't support (they answer the upgrade with e.g. 405).
export async function confirmByPolling(
  conn: Connection,
  signature: string,
  { lastValidBlockHeight }: Pick<BlockhashWithExpiryBlockHeight, "lastValidBlockHeight">,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new Error(`Transaction expired before confirmation (${signature})`);
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for confirmation (${signature})`);
}

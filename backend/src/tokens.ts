import { PublicKey, type AccountInfo, type Connection, type ParsedAccountData } from "@solana/web3.js";
import { connect, parseNetwork, parsePubkey } from "./solana.js";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

export interface TokenHolding {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: string;
  program: "token" | "token-2022";
  name: string | null;
  symbol: string | null;
  /** Token accounts the owner has for this mint (usually 1). */
  accounts: number;
}

interface Meta {
  name: string;
  symbol: string;
}

function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${s.slice(0, -decimals)}.${frac}` : s.slice(0, -decimals);
}

const clean = (s: string) => s.replace(/\0/g, "").trim();

/** Reads name + symbol from a Metaplex metadata account: key(1) update_authority(32) mint(32) name symbol … */
function parseMetaplex(data: Buffer): Meta | null {
  try {
    let o = 65;
    const str = () => {
      const len = data.readUInt32LE(o);
      const s = data.subarray(o + 4, o + 4 + len).toString("utf8");
      o += 4 + len;
      return clean(s);
    };
    const name = str();
    const symbol = str();
    return name || symbol ? { name, symbol } : null;
  } catch {
    return null;
  }
}

async function getMultiple<T>(conn: Connection, keys: PublicKey[], fetch: (batch: PublicKey[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await fetch(keys.slice(i, i + 100))));
  return out;
}

/** Token-2022 metadata extension first, then Metaplex. Missing metadata just means no name. */
async function loadMetadata(conn: Connection, mints: PublicKey[]): Promise<Map<string, Meta>> {
  const result = new Map<string, Meta>();
  const parsedMints = await getMultiple(conn, mints, (b) =>
    conn.getMultipleParsedAccounts(b).then((r) => r.value),
  );
  parsedMints.forEach((acc, i) => {
    const exts = ((acc?.data as ParsedAccountData | undefined)?.parsed?.info?.extensions ?? []) as any[];
    const state = exts.find((e) => e?.extension === "tokenMetadata")?.state;
    if (state?.name || state?.symbol) {
      result.set(mints[i].toBase58(), { name: clean(state.name ?? ""), symbol: clean(state.symbol ?? "") });
    }
  });

  const missing = mints.filter((m) => !result.has(m.toBase58()));
  const pdas = missing.map(
    (m) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), m.toBuffer()], METADATA_PROGRAM)[0],
  );
  const infos = await getMultiple<AccountInfo<Buffer> | null>(conn, pdas, (b) => conn.getMultipleAccountsInfo(b));
  infos.forEach((info, i) => {
    const meta = info && parseMetaplex(info.data);
    if (meta) result.set(missing[i].toBase58(), meta);
  });
  return result;
}

/** Every SPL Token and Token-2022 holding of `pubkey`, merged per mint. */
export async function getTokens(query: Record<string, unknown>) {
  const { rpcUrl } = parseNetwork(query);
  const owner = parsePubkey(query.pubkey);
  const conn = connect(rpcUrl);

  const [classic, t22] = await Promise.all([
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM }),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM }),
  ]);

  const byMint = new Map<string, { amount: bigint; decimals: number; program: TokenHolding["program"]; accounts: number }>();
  const add = (accounts: typeof classic.value, program: TokenHolding["program"]) => {
    for (const { account } of accounts) {
      const info = account.data.parsed?.info;
      if (!info?.mint || !info.tokenAmount) continue;
      const entry = byMint.get(info.mint) ?? { amount: 0n, decimals: info.tokenAmount.decimals, program, accounts: 0 };
      entry.amount += BigInt(info.tokenAmount.amount);
      entry.accounts += 1;
      byMint.set(info.mint, entry);
    }
  };
  add(classic.value, "token");
  add(t22.value, "token-2022");

  const metadata = byMint.size ? await loadMetadata(conn, [...byMint.keys()].map((m) => new PublicKey(m))) : new Map();

  const tokens: TokenHolding[] = [...byMint].map(([mint, e]) => ({
    mint,
    amount: e.amount.toString(),
    decimals: e.decimals,
    uiAmount: formatUnits(e.amount, e.decimals),
    program: e.program,
    name: metadata.get(mint)?.name || null,
    symbol: metadata.get(mint)?.symbol || null,
    accounts: e.accounts,
  }));
  // Held tokens first, named before unnamed, then alphabetically.
  tokens.sort(
    (a, b) =>
      Number(b.amount !== "0") - Number(a.amount !== "0") ||
      Number(!!b.symbol) - Number(!!a.symbol) ||
      (a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint),
  );
  return { owner: owner.toBase58(), tokens };
}

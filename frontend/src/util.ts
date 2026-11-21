import { useCallback, useEffect, useState } from "react";
import { getBalance, getSolPrice, getTokenBalance, getTokens, type NetSelection, type SolPrice, type TokenHolding } from "./api";

export const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const AMOUNT = /^\d+(\.\d{1,9})?$/;
export const USD_AMOUNT = /^\d+(\.\d{1,2})?$/;
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Base fee for a single-signature transaction. */
export const TX_FEE_LAMPORTS = 5_000;

export const isPubkey = (value: string) => BASE58_PUBKEY.test(value.trim());

export function shorten(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Exact SOL string -> lamports, avoiding float rounding. Assumes `AMOUNT` already matched. */
export function solToLamports(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(frac.padEnd(9, "0"));
}

/** Decimal string -> integer base units, e.g. ("1.5", 6) -> 1500000n. Returns null if invalid. */
export function toBaseUnits(amount: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
}

/** Integer base units -> exact decimal string, e.g. (1500000n, 6) -> "1.5". */
export function fromBaseUnits(units: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${units / base}.${frac}` : (units / base).toString();
}

/** Lamports -> exact SOL string for an input field, e.g. 1500000000n -> "1.5". */
export const lamportsToSolString = (lamports: bigint) => fromBaseUnits(lamports, 9);

export function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 9 });
}

/** Returns an error message, or null if the amount is a valid positive SOL value. */
export function validateAmount(amount: string): string | null {
  if (!AMOUNT.test(amount) || solToLamports(amount) <= 0n) return "Enter a positive amount (max 9 decimals).";
  return null;
}

export function formatUsd(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export const lamportsToUsd = (lamports: number | bigint, price: number) =>
  (Number(lamports) / LAMPORTS_PER_SOL) * price;

/** USD -> lamports, rounded down so the user never sends more than the stated dollar amount. */
export const usdToLamports = (usd: string, price: number) =>
  BigInt(Math.floor((Number(usd) / price) * LAMPORTS_PER_SOL));

/** Mainnet SOL/USD price from the backend, refreshed every minute. */
export function useSolPrice() {
  const [price, setPrice] = useState<SolPrice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getSolPrice()
        .then((p) => active && (setPrice(p), setError(null)))
        .catch((e: Error) => active && setError(e.message));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return { price, error };
}

/** SPL token balance (base units) for `address`; refetches when inputs change. */
export function useTokenBalance(net: NetSelection | null, address: string | null, mint: string) {
  const [amount, setAmount] = useState<bigint | null>(null);
  const key = net && address && isPubkey(address) ? `${net.network}|${net.rpcUrl ?? ""}|${address}|${mint}` : null;

  const refresh = useCallback(async () => {
    if (!key || !net || !address) return;
    try {
      setAmount(BigInt((await getTokenBalance(net, address, mint)).amount));
    } catch {
      setAmount(null);
    }
  }, [key]); // `key` captures net + address + mint

  useEffect(() => {
    setAmount(null);
    refresh();
  }, [refresh]);

  return { amount, refresh };
}

/** Fetches the SOL balance for `address` on `net`; refetches when either changes. */
export function useBalance(net: NetSelection | null, address: string | null) {
  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = net && address && isPubkey(address) ? `${net.network}|${net.rpcUrl ?? ""}|${address}` : null;

  const refresh = useCallback(async () => {
    if (!key || !net || !address) return;
    setLoading(true);
    setError(null);
    try {
      setLamports((await getBalance(net, address.trim())).lamports);
    } catch (e) {
      setLamports(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [key]); // `key` captures net + address

  useEffect(() => {
    setLamports(null);
    refresh();
  }, [refresh]);

  return { lamports, loading, error, refresh };
}

/** All SPL / Token-2022 holdings of `address` on `net`; refetches when either changes. */
export function useTokens(net: NetSelection | null, address: string | null) {
  const [tokens, setTokens] = useState<TokenHolding[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = net && address && isPubkey(address) ? `${net.network}|${net.rpcUrl ?? ""}|${address}` : null;

  const refresh = useCallback(async () => {
    if (!key || !net || !address) return;
    setLoading(true);
    setError(null);
    try {
      setTokens((await getTokens(net, address.trim())).tokens);
    } catch (e) {
      setTokens(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [key]); // `key` captures net + address

  useEffect(() => {
    setTokens(null);
    refresh();
  }, [refresh]);

  return { tokens, loading, error, refresh };
}

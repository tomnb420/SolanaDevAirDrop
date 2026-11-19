// Minimal integration with injected browser wallets (Phantom, Solflare, Backpack).
// The wallet signs transactions locally; the private key never leaves the extension.
import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";

interface PublicKeyLike {
  toString(): string;
}

interface InjectedProvider {
  isConnected?: boolean;
  publicKey?: PublicKeyLike | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKeyLike } | void>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  on?(event: "accountChanged" | "disconnect", handler: (key?: PublicKeyLike | null) => void): void;
  off?(event: "accountChanged" | "disconnect", handler: (key?: PublicKeyLike | null) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    backpack?: InjectedProvider;
    solana?: InjectedProvider;
  }
}

export interface DetectedWallet {
  name: string;
  provider: InjectedProvider;
}

export function detectWallet(): DetectedWallet | null {
  if (window.phantom?.solana) return { name: "Phantom", provider: window.phantom.solana };
  if (window.solflare) return { name: "Solflare", provider: window.solflare };
  if (window.backpack) return { name: "Backpack", provider: window.backpack };
  if (window.solana) return { name: "Wallet", provider: window.solana };
  return null;
}

async function connectWallet(wallet: DetectedWallet, onlyIfTrusted = false): Promise<string> {
  const res = await wallet.provider.connect(onlyIfTrusted ? { onlyIfTrusted } : undefined);
  const key = res?.publicKey ?? wallet.provider.publicKey;
  if (!key) throw new Error(`${wallet.name} did not return a public key`);
  return key.toString();
}

export interface WalletState {
  wallet: DetectedWallet | null;
  address: string | null;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
}

export function useWallet(): WalletState {
  const [wallet, setWallet] = useState<DetectedWallet | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    // Extensions may inject their provider after first paint; detect once the page has loaded.
    const detect = () => {
      const w = detectWallet();
      setWallet(w);
      // Silently reconnect if the user already approved this site.
      if (w) connectWallet(w, true).then(setAddress).catch(() => {});
    };
    if (document.readyState === "complete") detect();
    else window.addEventListener("load", detect, { once: true });
    return () => window.removeEventListener("load", detect);
  }, []);

  useEffect(() => {
    const provider = wallet?.provider;
    if (!provider?.on) return;
    const onAccount = (key?: PublicKeyLike | null) => setAddress(key ? key.toString() : null);
    const onDisconnect = () => setAddress(null);
    provider.on("accountChanged", onAccount);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.off?.("accountChanged", onAccount);
      provider.off?.("disconnect", onDisconnect);
    };
  }, [wallet]);

  const connect = useCallback(async () => {
    const w = wallet ?? detectWallet();
    if (!w) throw new Error("No browser wallet found");
    setWallet(w);
    const addr = await connectWallet(w);
    setAddress(addr);
    return addr;
  }, [wallet]);

  const disconnect = useCallback(async () => {
    await wallet?.provider.disconnect().catch(() => {});
    setAddress(null);
  }, [wallet]);

  return { wallet, address, connect, disconnect };
}

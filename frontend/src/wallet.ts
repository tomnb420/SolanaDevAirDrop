// Minimal integration with injected browser wallets (Phantom, Solflare, Backpack), plus a
// wallet built from a pasted private key. Either way, transactions are signed in the browser:
// an extension's key never leaves the extension, and a pasted key is held only in memory
// (never persisted, never sent to the backend) until disconnect or page reload.
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useCallback, useEffect, useMemo, useState } from "react";

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

/** Parses a base58 secret key (Phantom/Solflare export) or a JSON byte array (Solana CLI id.json). */
export function parseSecretKey(input: string): Keypair {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a private key");
  let bytes: Uint8Array;
  try {
    bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
  } catch {
    throw new Error("Not a valid base58 string or JSON byte array");
  }
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  if (bytes.length !== 64) throw new Error(`Expected a 64-byte secret key, got ${bytes.length} bytes`);
  try {
    // Throws if the public half doesn't match the private half.
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error("Invalid secret key");
  }
}

function keypairWallet(kp: Keypair): DetectedWallet {
  return {
    name: "Private key",
    provider: {
      publicKey: kp.publicKey,
      async connect() {},
      async disconnect() {},
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
        return tx;
      },
    },
  };
}

export interface WalletState {
  /** The active wallet: the imported key if there is one, otherwise the browser extension. */
  wallet: DetectedWallet | null;
  /** The browser extension, if installed. */
  injected: DetectedWallet | null;
  address: string | null;
  connect(): Promise<string>;
  /** Uses a pasted private key as the wallet. Returns its address. */
  importKey(secret: string): string;
  disconnect(): Promise<void>;
}

export function useWallet(): WalletState {
  const [injected, setInjected] = useState<DetectedWallet | null>(null);
  const [injectedAddress, setInjectedAddress] = useState<string | null>(null);
  const [keypair, setKeypair] = useState<Keypair | null>(null);

  useEffect(() => {
    // Extensions may inject their provider after first paint; detect once the page has loaded.
    const detect = () => {
      const w = detectWallet();
      setInjected(w);
      // Silently reconnect if the user already approved this site.
      if (w) connectWallet(w, true).then(setInjectedAddress).catch(() => {});
    };
    if (document.readyState === "complete") detect();
    else window.addEventListener("load", detect, { once: true });
    return () => window.removeEventListener("load", detect);
  }, []);

  useEffect(() => {
    const provider = injected?.provider;
    if (!provider?.on) return;
    const onAccount = (key?: PublicKeyLike | null) => setInjectedAddress(key ? key.toString() : null);
    const onDisconnect = () => setInjectedAddress(null);
    provider.on("accountChanged", onAccount);
    provider.on("disconnect", onDisconnect);
    return () => {
      provider.off?.("accountChanged", onAccount);
      provider.off?.("disconnect", onDisconnect);
    };
  }, [injected]);

  const connect = useCallback(async () => {
    const w = injected ?? detectWallet();
    if (!w) throw new Error("No browser wallet found");
    setInjected(w);
    const addr = await connectWallet(w);
    setKeypair(null);
    setInjectedAddress(addr);
    return addr;
  }, [injected]);

  const importKey = useCallback((secret: string) => {
    const kp = parseSecretKey(secret);
    setKeypair(kp);
    return kp.publicKey.toBase58();
  }, []);

  const disconnect = useCallback(async () => {
    if (keypair) {
      setKeypair(null);
      return;
    }
    await injected?.provider.disconnect().catch(() => {});
    setInjectedAddress(null);
  }, [keypair, injected]);

  const keyWallet = useMemo(() => (keypair ? keypairWallet(keypair) : null), [keypair]);

  return {
    wallet: keyWallet ?? injected,
    injected,
    address: keypair ? keypair.publicKey.toBase58() : injectedAddress,
    connect,
    importKey,
    disconnect,
  };
}

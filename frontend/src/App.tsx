import { useEffect, useState } from "react";
import { getConfig, type NetSelection, type Network, type ServerConfig } from "./api";
import { AirdropTab } from "./components/AirdropTab";
import { BalanceTab } from "./components/BalanceTab";
import { loadSavedRpcUrls, NETWORK_OPTIONS, NetworkPicker, validateRpcUrl } from "./components/NetworkPicker";
import { SendTab } from "./components/SendTab";
import { SwapTab } from "./components/SwapTab";
import { WalletBar } from "./components/WalletBar";
import { useWallet } from "./wallet";

type Tab = "airdrop" | "balance" | "send" | "swap";

const TABS: { value: Tab; label: string }[] = [
  { value: "airdrop", label: "Airdrop" },
  { value: "balance", label: "Balance" },
  { value: "send", label: "Send" },
  { value: "swap", label: "Swap" },
];

export default function App() {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [network, setNetwork] = useState<Network>("devnet");
  const [rpcUrl, setRpcUrl] = useState(() => loadSavedRpcUrls()[0] ?? "http://127.0.0.1:8899");
  const [tab, setTab] = useState<Tab>("airdrop");
  const [busy, setBusy] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    getConfig()
      .then(setServerConfig)
      .catch((e: Error) => setBackendError(`Cannot reach backend: ${e.message}`));
  }, []);

  const rpcUrlError = network === "custom" ? validateRpcUrl(rpcUrl) : null;
  // null while the custom RPC URL is invalid, so tabs don't query a bad endpoint.
  const net: NetSelection | null = rpcUrlError
    ? null
    : { network, rpcUrl: network === "custom" ? rpcUrl.trim() : undefined };
  const networkLabel = NETWORK_OPTIONS.find((o) => o.value === network)!.label;

  return (
    <main className="card">
      <h1>Solana Wallet Manager</h1>
      <p className="subtitle">Airdrop, check balances, send SOL and swap SOL/USDT.</p>

      <NetworkPicker
        network={network}
        rpcUrl={rpcUrl}
        rpcUrlError={rpcUrlError}
        disabled={busy}
        onNetworkChange={setNetwork}
        onRpcUrlChange={setRpcUrl}
      />

      <WalletBar wallet={wallet} net={net} />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={tab === t.value ? "active" : ""}
            disabled={busy && tab !== t.value}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "airdrop" && (
        <AirdropTab
          net={net}
          networkLabel={networkLabel}
          serverConfig={serverConfig}
          walletAddress={wallet.address}
          onBusyChange={setBusy}
        />
      )}
      {tab === "balance" && <BalanceTab net={net} walletAddress={wallet.address} />}
      {tab === "send" && <SendTab net={net} networkLabel={networkLabel} wallet={wallet} onBusyChange={setBusy} />}
      {tab === "swap" && <SwapTab net={net} wallet={wallet} onBusyChange={setBusy} onNetworkChange={setNetwork} />}

      {backendError && <p className="error">{backendError}</p>}
    </main>
  );
}

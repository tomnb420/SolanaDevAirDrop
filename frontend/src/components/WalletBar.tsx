import { useState, type FormEvent } from "react";
import { explorerAddressUrl, type NetSelection } from "../api";
import { formatSol, shorten, useBalance } from "../util";
import type { WalletState } from "../wallet";

/** Connected-wallet status with its live balance on the selected network. */
export function WalletBar({ wallet, net }: { wallet: WalletState; net: NetSelection | null }) {
  const { lamports, loading, error, refresh } = useBalance(net, wallet.address);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!wallet.address) {
    if (importing) return <ImportKeyForm wallet={wallet} onDone={() => setImporting(false)} />;
    return (
      <div className="wallet-bar">
        {wallet.injected ? (
          <button
            type="button"
            onClick={() => {
              setConnectError(null);
              wallet.connect().catch((e: Error) => setConnectError(e.message));
            }}
          >
            Connect {wallet.injected.name}
          </button>
        ) : (
          <span className="muted">
            No browser wallet found.{" "}
            <a href="https://phantom.com/download" target="_blank" rel="noreferrer">
              Install Phantom
            </a>{" "}
            or
          </span>
        )}
        <button type="button" onClick={() => setImporting(true)}>
          Use private key
        </button>
        {connectError && <span className="field-error">{connectError}</span>}
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <span className="dot" />
      <span>
        {wallet.wallet?.name}:{" "}
        {net ? (
          <a className="mono" href={explorerAddressUrl(wallet.address, net)} target="_blank" rel="noreferrer">
            {shorten(wallet.address)}
          </a>
        ) : (
          <span className="mono">{shorten(wallet.address)}</span>
        )}
      </span>
      <strong className="balance">
        {error ? <span className="field-error" title={error}>balance unavailable</span> : lamports === null ? "…" : `${formatSol(lamports)} SOL`}
      </strong>
      <button type="button" className="icon" onClick={refresh} disabled={loading} title="Refresh balance">
        ↻
      </button>
      <button type="button" onClick={wallet.disconnect}>
        {wallet.wallet?.name === "Private key" ? "Forget key" : "Disconnect"}
      </button>
    </div>
  );
}

/** Pasted-key form. The key is parsed in the browser and kept only in memory. */
function ImportKeyForm({ wallet, onDone }: { wallet: WalletState; onDone(): void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      wallet.importKey(secret);
      setSecret("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form className="wallet-bar import-key" onSubmit={submit}>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Private key (base58 or [1,2,…] byte array)"
        value={secret}
        className={error ? "invalid" : ""}
        onChange={(e) => {
          setSecret(e.target.value);
          setError(null);
        }}
        autoFocus
      />
      <button type="submit" className="primary" disabled={!secret.trim()}>
        Import
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
      {error && <span className="field-error">{error}</span>}
      <p className="hint">
        Stays in this tab's memory only. It's never saved or sent to the server, and it's gone on reload. Use a
        dev wallet, not one holding real funds.
      </p>
    </form>
  );
}

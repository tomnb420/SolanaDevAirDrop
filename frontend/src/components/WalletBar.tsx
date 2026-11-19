import { useState } from "react";
import { explorerAddressUrl, type NetSelection } from "../api";
import { formatSol, shorten, useBalance } from "../util";
import type { WalletState } from "../wallet";

/** Connected-wallet status with its live balance on the selected network. */
export function WalletBar({ wallet, net }: { wallet: WalletState; net: NetSelection | null }) {
  const { lamports, loading, error, refresh } = useBalance(net, wallet.address);
  const [connectError, setConnectError] = useState<string | null>(null);

  if (!wallet.wallet) {
    return (
      <div className="wallet-bar muted">
        No browser wallet found.{" "}
        <a href="https://phantom.com/download" target="_blank" rel="noreferrer">
          Install Phantom
        </a>{" "}
        to send SOL.
      </div>
    );
  }

  if (!wallet.address) {
    return (
      <div className="wallet-bar">
        <button
          type="button"
          onClick={() => {
            setConnectError(null);
            wallet.connect().catch((e: Error) => setConnectError(e.message));
          }}
        >
          Connect {wallet.wallet.name}
        </button>
        {connectError && <span className="field-error">{connectError}</span>}
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <span className="dot" />
      <span>
        {wallet.wallet.name}:{" "}
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
        Disconnect
      </button>
    </div>
  );
}

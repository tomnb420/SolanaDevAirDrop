import { useState } from "react";
import { explorerAddressUrl, type NetSelection } from "../api";
import { formatSol, isPubkey, useBalance } from "../util";
import { Step } from "./Step";

export function BalanceTab({ net, walletAddress }: { net: NetSelection | null; walletAddress: string | null }) {
  const [input, setInput] = useState("");
  // Look up whatever is typed; fall back to the connected wallet when the field is empty.
  const address = input.trim() || walletAddress || "";
  const valid = isPubkey(address);
  const { lamports, loading, error, refresh } = useBalance(net, valid ? address : null);

  return (
    <>
      <Step n={1} title="Wallet address" error={input && !valid ? "Enter a valid base58 wallet address." : null}>
        <input
          className={input && !valid ? "invalid" : ""}
          placeholder={walletAddress ?? "e.g. 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"}
          spellCheck={false}
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {walletAddress && !input && <p className="hint">Showing your connected wallet. Type another address to look it up.</p>}
      </Step>

      <Step n={2} title="Balance" error={error}>
        {!valid || !net ? (
          <p className="muted">Enter an address to see its balance.</p>
        ) : (
          <div className="balance-card">
            <div className="big">{lamports === null ? "…" : formatSol(lamports)} <span>SOL</span></div>
            {lamports !== null && <div className="muted small">{lamports.toLocaleString()} lamports</div>}
            <div className="actions">
              <button type="button" onClick={refresh} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
              <a className="button" href={explorerAddressUrl(address, net)} target="_blank" rel="noreferrer">
                View in Explorer
              </a>
            </div>
          </div>
        )}
      </Step>
    </>
  );
}

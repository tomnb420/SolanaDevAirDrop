import { useState } from "react";
import { explorerAddressUrl, explorerTokenUrl, type NetSelection } from "../api";
import { formatSol, isPubkey, shorten, useBalance, useTokens } from "../util";
import { Step } from "./Step";

export function BalanceTab({ net, walletAddress }: { net: NetSelection | null; walletAddress: string | null }) {
  const [input, setInput] = useState("");
  // Look up whatever is typed; fall back to the connected wallet when the field is empty.
  const address = input.trim() || walletAddress || "";
  const valid = isPubkey(address);
  const { lamports, loading, error, refresh } = useBalance(net, valid ? address : null);
  const tokens = useTokens(net, valid ? address : null);
  const [showEmpty, setShowEmpty] = useState(false);
  const held = tokens.tokens?.filter((t) => t.amount !== "0") ?? [];
  const empty = tokens.tokens?.filter((t) => t.amount === "0") ?? [];
  const shown = showEmpty ? [...held, ...empty] : held;

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
              <button
                type="button"
                onClick={() => {
                  refresh();
                  tokens.refresh();
                }}
                disabled={loading || tokens.loading}
              >
                {loading || tokens.loading ? "Loading…" : "Refresh"}
              </button>
              <a className="button" href={explorerAddressUrl(address, net)} target="_blank" rel="noreferrer">
                {net.network === "custom" ? "View in Explorer" : "View on Solscan"}
              </a>
            </div>
          </div>
        )}
      </Step>

      {valid && net && (
        <Step n={3} title={tokens.tokens ? `Tokens (${held.length})` : "Tokens"} error={tokens.error}>
          {tokens.tokens === null ? (
            !tokens.error && <p className="muted">Loading tokens…</p>
          ) : tokens.tokens.length === 0 ? (
            <p className="muted">No SPL tokens in this wallet.</p>
          ) : (
            <>
              {shown.length > 0 && (
                <ul className="token-list">
                  {shown.map((t) => (
                    <li key={t.mint} className={t.amount === "0" ? "zero" : ""}>
                      <div className="token-id">
                        <strong>{t.symbol || shorten(t.mint)}</strong>
                        {t.program === "token-2022" && <span className="tag">Token-2022</span>}
                        <a className="mono small" href={explorerTokenUrl(t.mint, net)} target="_blank" rel="noreferrer" title={t.mint}>
                          {t.name || shorten(t.mint)}
                        </a>
                      </div>
                      <span className="token-amount mono" title={`${t.amount} base units, ${t.decimals} decimals`}>
                        {t.uiAmount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {held.length === 0 && <p className="muted">No token balances.</p>}
              {empty.length > 0 && (
                <button type="button" className="link" onClick={() => setShowEmpty((v) => !v)}>
                  {showEmpty ? "Hide" : "Show"} {empty.length} empty token account{empty.length === 1 ? "" : "s"}
                </button>
              )}
            </>
          )}
        </Step>
      )}
    </>
  );
}

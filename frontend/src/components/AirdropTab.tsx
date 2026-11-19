import { useEffect, useState, type FormEvent } from "react";
import { explorerTxUrl, requestAirdrop, type AirdropResult, type NetSelection, type ServerConfig } from "../api";
import { isPubkey, validateAmount } from "../util";
import { Step } from "./Step";

type Phase = "edit" | "confirm" | "sending" | "done";

interface Props {
  net: NetSelection | null;
  networkLabel: string;
  serverConfig: ServerConfig | null;
  walletAddress: string | null;
  onBusyChange(busy: boolean): void;
}

export function AirdropTab({ net, networkLabel, serverConfig, walletAddress, onBusyChange }: Props) {
  const [amount, setAmount] = useState("1");
  const [pubkey, setPubkey] = useState(walletAddress ?? "");
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AirdropResult | null>(null);

  useEffect(() => onBusyChange(phase === "confirm" || phase === "sending"), [phase, onBusyChange]);
  // Prefill with the wallet once it connects, unless the user already typed something.
  useEffect(() => {
    if (walletAddress) setPubkey((p) => p || walletAddress);
  }, [walletAddress]);

  const maxSol = serverConfig?.maxAirdropSol ?? Infinity;
  const networkError =
    net?.network === "mainnet" && serverConfig && !serverConfig.mainnetEnabled
      ? "Mainnet has no public faucet and is not enabled on this server."
      : null;
  const amountError = validateAmount(amount) ?? (Number(amount) > maxSol ? `Maximum is ${maxSol} SOL.` : null);
  const pubkeyError = isPubkey(pubkey) ? null : "Enter a valid base58 wallet address.";
  const isValid = net !== null && !networkError && !amountError && !pubkeyError;

  function onReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isValid) setPhase("confirm");
  }

  async function onConfirm() {
    if (!net) return;
    setPhase("sending");
    setError(null);
    try {
      setResult(await requestAirdrop(net, amount, pubkey.trim()));
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("confirm");
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setPhase("edit");
  }

  return (
    <form onSubmit={onReview}>
      {networkError && <p className="field-error">{networkError}</p>}
      <fieldset disabled={phase !== "edit"}>
        <Step n={1} title="SOL amount" error={amountError}>
          <div className="amount">
            <input
              className={amountError ? "invalid" : ""}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.trim())}
            />
            <span>SOL</span>
          </div>
          <div className="presets">
            {[0.5, 1, 2, 5].filter((v) => v <= maxSol).map((v) => (
              <button type="button" key={v} onClick={() => setAmount(String(v))}>
                {v}
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Recipient wallet" error={pubkey ? pubkeyError : null}>
          <input
            className={pubkey && pubkeyError ? "invalid" : ""}
            placeholder="e.g. 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
            spellCheck={false}
            autoComplete="off"
            value={pubkey}
            onChange={(e) => setPubkey(e.target.value)}
          />
          {walletAddress && pubkey !== walletAddress && (
            <div className="presets">
              <button type="button" onClick={() => setPubkey(walletAddress)}>
                Use my wallet
              </button>
            </div>
          )}
        </Step>
      </fieldset>

      <Step n={3} title="Confirm">
        {phase === "edit" && (
          <button type="submit" className="primary" disabled={!isValid}>
            Review airdrop
          </button>
        )}

        {(phase === "confirm" || phase === "sending") && net && (
          <div className="summary">
            <dl>
              <dt>Network</dt>
              <dd>{net.rpcUrl ?? networkLabel}</dd>
              <dt>Amount</dt>
              <dd>{amount} SOL</dd>
              <dt>Recipient</dt>
              <dd className="mono">{pubkey.trim()}</dd>
            </dl>
            {net.network === "mainnet" && (
              <p className="warning">This sends real SOL from the server's faucet wallet.</p>
            )}
            <div className="actions">
              <button type="button" onClick={reset} disabled={phase === "sending"}>
                Back
              </button>
              <button type="button" className="primary" onClick={onConfirm} disabled={phase === "sending"}>
                {phase === "sending" ? "Sending…" : "Confirm airdrop"}
              </button>
            </div>
          </div>
        )}

        {phase === "done" && result && net && (
          <div className="success">
            <p>
              <strong>{amount} SOL</strong> sent via{" "}
              {result.method === "airdrop" ? "RPC faucet" : "faucet wallet transfer"}.
            </p>
            <p>
              Recipient balance: <strong>{result.balance} SOL</strong>
            </p>
            <p className="mono small">
              <a href={explorerTxUrl(result.signature, net, result.rpcUrl)} target="_blank" rel="noreferrer">
                {result.signature}
              </a>
            </p>
            <button type="button" className="primary" onClick={reset}>
              New airdrop
            </button>
          </div>
        )}
      </Step>

      {error && <p className="error">{error}</p>}
    </form>
  );
}

import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useEffect, useState, type FormEvent } from "react";
import { explorerTxUrl, getBlockhash, sendSigned, type NetSelection, type SendResult } from "../api";
import {
  formatSol,
  formatUsd,
  isPubkey,
  lamportsToSolString,
  lamportsToUsd,
  shorten,
  solToLamports,
  TX_FEE_LAMPORTS,
  USD_AMOUNT,
  usdToLamports,
  useBalance,
  useSolPrice,
  validateAmount,
} from "../util";
import type { WalletState } from "../wallet";
import { Step } from "./Step";

type Phase = "edit" | "confirm" | "signing" | "sending" | "done";
type Unit = "SOL" | "USD";

const PRESETS: Record<Unit, number[]> = { SOL: [0.1, 0.5, 1], USD: [1, 5, 10, 20] };

interface Props {
  net: NetSelection | null;
  networkLabel: string;
  wallet: WalletState;
  onBusyChange(busy: boolean): void;
}

/** Parses the amount field into lamports, or returns an error message. */
function parseAmount(amount: string, unit: Unit, priceUsd: number | undefined): bigint | string {
  if (unit === "SOL") return validateAmount(amount) ?? solToLamports(amount);
  if (!priceUsd) return "SOL price unavailable; enter the amount in SOL.";
  if (!USD_AMOUNT.test(amount) || Number(amount) <= 0) return "Enter a positive dollar amount (max 2 decimals).";
  const lamports = usdToLamports(amount, priceUsd);
  return lamports > 0n ? lamports : "Amount is too small.";
}

export function SendTab({ net, networkLabel, wallet, onBusyChange }: Props) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<Unit>("SOL");
  // Lamports locked in at review time, so a price tick can't change what gets signed.
  const [frozenLamports, setFrozenLamports] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const from = wallet.address;
  const { lamports: balance, refresh } = useBalance(net, from);
  const { price, error: priceError } = useSolPrice();
  const priceUsd = price?.usd;

  const busy = phase === "confirm" || phase === "signing" || phase === "sending";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const toError = isPubkey(to) ? null : "Enter a valid base58 wallet address.";
  const parsed = parseAmount(amount, unit, priceUsd);
  let lamports = typeof parsed === "bigint" ? parsed : null;
  let amountError = typeof parsed === "string" ? parsed : null;
  if (lamports !== null && balance !== null && lamports + BigInt(TX_FEE_LAMPORTS) > BigInt(balance)) {
    amountError = `Insufficient balance. You have ${formatSol(balance)} SOL (fee ≈ ${formatSol(TX_FEE_LAMPORTS)} SOL).`;
    lamports = null;
  }
  const isValid = !!net && !!from && !toError && lamports !== null;

  const conversion =
    lamports === null
      ? null
      : unit === "SOL"
        ? priceUsd && `≈ ${formatUsd(lamportsToUsd(lamports, priceUsd))}`
        : `≈ ${lamportsToSolString(lamports)} SOL`;

  function switchUnit(next: Unit) {
    if (next === unit) return;
    // Carry the current value over to the new unit.
    if (typeof parsed === "bigint" && priceUsd) {
      setAmount(next === "USD" ? lamportsToUsd(parsed, priceUsd).toFixed(2) : lamportsToSolString(parsed));
    }
    setUnit(next);
  }

  function setMax() {
    if (balance === null) return;
    const max = BigInt(Math.max(0, balance - TX_FEE_LAMPORTS));
    if (unit === "SOL") setAmount(lamportsToSolString(max));
    else if (priceUsd) setAmount((Math.floor(lamportsToUsd(max, priceUsd) * 100) / 100).toFixed(2));
  }

  function onReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValid) return;
    setFrozenLamports(lamports);
    setPhase("confirm");
  }

  async function onConfirm() {
    if (!net || !from || !wallet.wallet || frozenLamports === null) return;
    setError(null);
    try {
      setPhase("signing");
      const { blockhash, lastValidBlockHeight } = await getBlockhash(net);
      const fromKey = new PublicKey(from);
      const tx = new Transaction({ feePayer: fromKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: new PublicKey(to.trim()), lamports: frozenLamports }),
      );
      // Sign in the wallet, but submit through our backend so custom RPCs work.
      const signed = await wallet.wallet.provider.signTransaction(tx);

      setPhase("sending");
      const res = await sendSigned(net, signed.serialize().toString("base64"), lastValidBlockHeight);
      setResult(res);
      setPhase("done");
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase("confirm");
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setFrozenLamports(null);
    setPhase("edit");
  }

  const solAndUsd = (l: bigint) =>
    `${lamportsToSolString(l)} SOL${priceUsd ? ` (≈ ${formatUsd(lamportsToUsd(l, priceUsd))})` : ""}`;

  if (!from) {
    return (
      <div className="empty">
        <p>Connect a browser wallet to send SOL. Your wallet signs the transaction; your key never leaves it.</p>
        {wallet.wallet && (
          <button type="button" className="primary" onClick={() => wallet.connect().catch((e: Error) => setError(e.message))}>
            Connect {wallet.wallet.name}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={onReview}>
      <fieldset disabled={phase !== "edit"}>
        <Step n={1} title="From">
          <div className="from-row">
            <span className="mono">{shorten(from)}</span>
            <span className="muted">
              {balance === null
                ? "…"
                : `${formatSol(balance)} SOL${priceUsd ? ` ≈ ${formatUsd(lamportsToUsd(balance, priceUsd))}` : ""} available`}
            </span>
          </div>
        </Step>

        <Step n={2} title="Recipient wallet" error={to ? toError : null}>
          <input
            className={to && toError ? "invalid" : ""}
            placeholder="Recipient public key"
            spellCheck={false}
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          {to.trim() === from && <p className="hint">This is your own wallet.</p>}
        </Step>

        <Step n={3} title="Amount" error={amount ? amountError : null}>
          <div className="amount-row">
            <div className="amount">
              {unit === "USD" && <span className="prefix">$</span>}
              <input
                className={`${amount && amountError ? "invalid" : ""} ${unit === "USD" ? "has-prefix" : ""}`}
                inputMode="decimal"
                placeholder={unit === "SOL" ? "0.0" : "0.00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value.trim())}
              />
            </div>
            <div className="unit-toggle">
              {(["SOL", "USD"] as Unit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={unit === u ? "active" : ""}
                  disabled={u === "USD" && !priceUsd}
                  onClick={() => switchUnit(u)}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          {conversion && <p className="hint">{conversion}</p>}
          <div className="presets">
            {PRESETS[unit].map((v) => (
              <button type="button" key={v} onClick={() => setAmount(unit === "USD" ? v.toFixed(2) : String(v))}>
                {unit === "USD" ? `$${v}` : v}
              </button>
            ))}
            <button type="button" onClick={setMax} disabled={balance === null}>
              Max
            </button>
          </div>
          <p className="hint">
            {priceUsd
              ? `1 SOL = ${formatUsd(priceUsd)} (${price!.source})`
              : priceError
                ? "USD price unavailable."
                : "Loading SOL price…"}
            {net && net.network !== "mainnet" && priceUsd && " · uses the mainnet price; test SOL has no real value."}
          </p>
        </Step>
      </fieldset>

      <Step n={4} title="Confirm">
        {phase === "edit" && (
          <button type="submit" className="primary" disabled={!isValid}>
            Review transfer
          </button>
        )}

        {busy && net && frozenLamports !== null && (
          <div className="summary">
            <dl>
              <dt>Network</dt>
              <dd>{net.rpcUrl ?? networkLabel}</dd>
              <dt>From</dt>
              <dd className="mono">{from}</dd>
              <dt>To</dt>
              <dd className="mono">{to.trim()}</dd>
              <dt>Amount</dt>
              <dd>{solAndUsd(frozenLamports)}</dd>
              <dt>Fee</dt>
              <dd>≈ {formatSol(TX_FEE_LAMPORTS)} SOL</dd>
            </dl>
            {net.network === "mainnet" && <p className="warning">This is a real mainnet transfer and can't be undone.</p>}
            <div className="actions">
              <button type="button" onClick={reset} disabled={phase !== "confirm"}>
                Back
              </button>
              <button type="button" className="primary" onClick={onConfirm} disabled={phase !== "confirm"}>
                {phase === "signing" ? `Approve in ${wallet.wallet?.name}…` : phase === "sending" ? "Sending…" : "Sign & send"}
              </button>
            </div>
          </div>
        )}

        {phase === "done" && result && net && frozenLamports !== null && (
          <div className="success">
            <p>
              <strong>{solAndUsd(frozenLamports)}</strong> sent to <span className="mono">{shorten(to.trim())}</span>.
            </p>
            <p>
              Your balance: <strong>{balance === null ? "…" : `${formatSol(balance)} SOL`}</strong>
            </p>
            <p className="mono small">
              <a href={explorerTxUrl(result.signature, net, result.rpcUrl)} target="_blank" rel="noreferrer">
                {result.signature}
              </a>
            </p>
            <button type="button" className="primary" onClick={reset}>
              New transfer
            </button>
          </div>
        )}
      </Step>

      {error && <p className="error">{error}</p>}
    </form>
  );
}

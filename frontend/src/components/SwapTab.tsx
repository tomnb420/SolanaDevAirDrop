import { VersionedTransaction } from "@solana/web3.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildSwap,
  explorerTxUrl,
  getSwapQuote,
  sendSigned,
  TOKENS,
  type NetSelection,
  type Network,
  type SendResult,
  type SwapQuote,
  type TokenSymbol,
} from "../api";
import { fromBaseUnits, shorten, toBaseUnits, useBalance, useTokenBalance } from "../util";
import type { WalletState } from "../wallet";
import { Step } from "./Step";

type Phase = "edit" | "confirm" | "signing" | "sending" | "done";

const SLIPPAGE_OPTIONS = [10, 50, 100]; // bps
/** SOL kept back on "Max": network + priority fees and rent for a new USDT account. */
const SOL_RESERVE_LAMPORTS = 10_000_000n;
const QUOTE_REFRESH_MS = 15_000;

interface Props {
  net: NetSelection | null;
  wallet: WalletState;
  onBusyChange(busy: boolean): void;
  onNetworkChange(network: Network): void;
}

const fmt = (units: bigint | null, symbol: TokenSymbol, maxDigits = 6) =>
  units === null
    ? "…"
    : Number(fromBaseUnits(units, TOKENS[symbol].decimals)).toLocaleString(undefined, { maximumFractionDigits: maxDigits });

export function SwapTab({ net, wallet, onBusyChange, onNetworkChange }: Props) {
  const [input, setInput] = useState<TokenSymbol>("SOL");
  const output: TokenSymbol = input === "SOL" ? "USDT" : "SOL";
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [frozen, setFrozen] = useState<SwapQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const from = wallet.address;
  const supported = net?.network === "mainnet" || net?.network === "custom";
  const sol = useBalance(supported ? net : null, from);
  const usdt = useTokenBalance(supported ? net : null, from, TOKENS.USDT.mint);
  const balances: Record<TokenSymbol, bigint | null> = {
    SOL: sol.lamports === null ? null : BigInt(sol.lamports),
    USDT: usdt.amount,
  };

  const busy = phase === "confirm" || phase === "signing" || phase === "sending";
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  const inUnits = toBaseUnits(amount, TOKENS[input].decimals);
  let amountError: string | null = null;
  if (amount && (inUnits === null || inUnits <= 0n)) {
    amountError = `Enter a positive amount (max ${TOKENS[input].decimals} decimals).`;
  } else if (inUnits !== null && balances[input] !== null) {
    const needed = input === "SOL" ? inUnits + SOL_RESERVE_LAMPORTS : inUnits;
    if (needed > balances[input]!) {
      amountError =
        input === "SOL"
          ? `Insufficient SOL. Keep ~${fmt(SOL_RESERVE_LAMPORTS, "SOL")} SOL for fees.`
          : "Insufficient USDT balance.";
    }
  }

  // Debounced quote fetching, refreshed periodically while editing.
  const reqId = useRef(0);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!supported || phase !== "edit" || inUnits === null || inUnits <= 0n) return;
    const fetchQuote = async () => {
      const id = ++reqId.current;
      setQuoting(true);
      try {
        const q = await getSwapQuote(TOKENS[input].mint, TOKENS[output].mint, inUnits.toString(), slippageBps);
        if (id === reqId.current) setQuote(q);
      } catch (e) {
        if (id === reqId.current) setQuoteError((e as Error).message);
      } finally {
        if (id === reqId.current) setQuoting(false);
      }
    };
    const debounce = setTimeout(fetchQuote, 400);
    const interval = setInterval(fetchQuote, QUOTE_REFRESH_MS);
    return () => {
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [supported, phase, input, output, inUnits?.toString(), slippageBps]);

  function flip() {
    setInput(output);
    // Carry the quoted output over as the new input amount.
    setAmount(quote ? fromBaseUnits(BigInt(quote.outAmount), TOKENS[output].decimals) : "");
  }

  function setMax() {
    const bal = balances[input];
    if (bal === null) return;
    const max = input === "SOL" ? (bal > SOL_RESERVE_LAMPORTS ? bal - SOL_RESERVE_LAMPORTS : 0n) : bal;
    setAmount(fromBaseUnits(max, TOKENS[input].decimals));
  }

  const isValid = supported && !!from && !!quote && !amountError && inUnits !== null && inUnits > 0n;

  function onReview(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValid) return;
    setFrozen(quote);
    setPhase("confirm");
  }

  async function onConfirm() {
    if (!net || !from || !wallet.wallet || !frozen) return;
    setError(null);
    try {
      setPhase("signing");
      // Re-quote so the transaction uses fresh routes; refuse if the price moved past the reviewed minimum.
      const fresh = await getSwapQuote(frozen.inputMint, frozen.outputMint, frozen.inAmount, frozen.slippageBps);
      if (BigInt(fresh.outAmount) < BigInt(frozen.otherAmountThreshold)) {
        setFrozen(null);
        setPhase("edit");
        setError("Price moved beyond your slippage since you reviewed. Check the new quote and try again.");
        return;
      }
      const { swapTransaction, lastValidBlockHeight } = await buildSwap(fresh, from);
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
      const signed = await wallet.wallet.provider.signTransaction(tx);

      setPhase("sending");
      const b64 = btoa(String.fromCharCode(...signed.serialize()));
      setResult(await sendSigned(net, b64, lastValidBlockHeight));
      setFrozen(fresh);
      setPhase("done");
      sol.refresh();
      usdt.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase("confirm");
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setFrozen(null);
    setAmount("");
    setPhase("edit");
  }

  if (!supported) {
    return (
      <div className="empty">
        <p>Swaps use Jupiter liquidity, which only exists on mainnet. Devnet and testnet have no USDT market.</p>
        <button type="button" className="primary" onClick={() => onNetworkChange("mainnet")}>
          Switch to Mainnet
        </button>
      </div>
    );
  }

  if (!from) {
    return (
      <div className="empty">
        <p>Connect a browser wallet to swap. Your wallet signs the transaction; your key never leaves it.</p>
        {wallet.wallet && (
          <button type="button" className="primary" onClick={() => wallet.connect().catch((e: Error) => setError(e.message))}>
            Connect {wallet.wallet.name}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const shown = frozen ?? quote;
  const outUnits = shown ? BigInt(shown.outAmount) : null;
  const minUnits = shown ? BigInt(shown.otherAmountThreshold) : null;
  const rate =
    shown && inUnits
      ? Number(fromBaseUnits(BigInt(shown.outAmount), TOKENS[output].decimals)) /
        Number(fromBaseUnits(BigInt(shown.inAmount), TOKENS[input].decimals))
      : null;
  const impact = shown ? Number(shown.priceImpactPct) * 100 : 0;

  return (
    <form onSubmit={onReview}>
      {net?.network === "custom" && (
        <p className="hint">Custom RPC must point at mainnet (or a mainnet fork) for swaps to work.</p>
      )}
      <fieldset disabled={phase !== "edit"}>
        <Step n={1} title="You pay" error={amountError}>
          <div className="swap-box">
            <input
              className={amountError ? "invalid" : ""}
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.trim())}
            />
            <span className="token">{input}</span>
          </div>
          <div className="swap-meta">
            <span className="muted">
              Balance: {fmt(balances[input], input)} {input}
            </span>
            <button type="button" onClick={setMax} disabled={balances[input] === null}>
              Max
            </button>
          </div>
        </Step>

        <div className="flip-row">
          <button type="button" className="flip" onClick={flip} title="Switch direction">
            ⇅
          </button>
        </div>

        <Step n={2} title="You receive" error={quoteError}>
          <div className="swap-box readonly">
            <span className="out">{quoting && !quote ? "Fetching quote…" : outUnits === null ? "0.0" : fmt(outUnits, output)}</span>
            <span className="token">{output}</span>
          </div>
          <div className="swap-meta">
            <span className="muted">
              Balance: {fmt(balances[output], output)} {output}
            </span>
          </div>
        </Step>

        <Step n={3} title="Slippage tolerance">
          <div className="presets">
            {SLIPPAGE_OPTIONS.map((bps) => (
              <button
                type="button"
                key={bps}
                className={slippageBps === bps ? "selected" : ""}
                onClick={() => setSlippageBps(bps)}
              >
                {bps / 100}%
              </button>
            ))}
          </div>
        </Step>
      </fieldset>

      {shown && (
        <dl className="quote-details">
          <dt>Rate</dt>
          <dd>
            1 {input} ≈ {rate?.toLocaleString(undefined, { maximumFractionDigits: 6 })} {output}
          </dd>
          <dt>Minimum received</dt>
          <dd>
            {fmt(minUnits, output)} {output}
          </dd>
          <dt>Price impact</dt>
          <dd className={impact > 1 ? "warning" : ""}>{impact < 0.01 ? "< 0.01" : impact.toFixed(2)}%</dd>
          <dt>Route</dt>
          <dd>{shown.routePlan.map((r) => r.swapInfo.label).join(" → ")}</dd>
        </dl>
      )}

      <Step n={4} title="Confirm">
        {phase === "edit" && (
          <button type="submit" className="primary" disabled={!isValid}>
            {quoting && !quote && inUnits ? "Fetching quote…" : "Review swap"}
          </button>
        )}

        {busy && frozen && (
          <div className="summary">
            <dl>
              <dt>Wallet</dt>
              <dd className="mono">{shorten(from)}</dd>
              <dt>Pay</dt>
              <dd>
                {fmt(BigInt(frozen.inAmount), input, 9)} {input}
              </dd>
              <dt>Receive</dt>
              <dd>
                ≈ {fmt(BigInt(frozen.outAmount), output)} {output} (min {fmt(BigInt(frozen.otherAmountThreshold), output)})
              </dd>
            </dl>
            <p className="warning">This is a real mainnet swap and can't be undone.</p>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  setFrozen(null);
                  setPhase("edit");
                }}
                disabled={phase !== "confirm"}
              >
                Back
              </button>
              <button type="button" className="primary" onClick={onConfirm} disabled={phase !== "confirm"}>
                {phase === "signing" ? `Approve in ${wallet.wallet?.name}…` : phase === "sending" ? "Swapping…" : "Sign & swap"}
              </button>
            </div>
          </div>
        )}

        {phase === "done" && result && net && frozen && (
          <div className="success">
            <p>
              Swapped <strong>{fmt(BigInt(frozen.inAmount), input, 9)} {input}</strong> for ≈{" "}
              <strong>
                {fmt(BigInt(frozen.outAmount), output)} {output}
              </strong>
              .
            </p>
            <p>
              Balances: <strong>{fmt(balances.SOL, "SOL")} SOL</strong> · <strong>{fmt(balances.USDT, "USDT")} USDT</strong>
            </p>
            <p className="mono small">
              <a href={explorerTxUrl(result.signature, net, result.rpcUrl)} target="_blank" rel="noreferrer">
                {result.signature}
              </a>
            </p>
            <button type="button" className="primary" onClick={reset}>
              New swap
            </button>
          </div>
        )}
      </Step>

      {error && <p className="error">{error}</p>}
    </form>
  );
}

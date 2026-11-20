import { useState, type FormEvent } from "react";
import type { Network } from "../api";

export const NETWORK_OPTIONS: { value: Network; label: string }[] = [
  { value: "devnet", label: "Devnet" },
  { value: "testnet", label: "Testnet" },
  { value: "mainnet", label: "Mainnet" },
  { value: "custom", label: "Custom RPC" },
];

export function validateRpcUrl(rpcUrl: string): string | null {
  try {
    const u = new URL(rpcUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "Must be http(s).";
  } catch {
    return "Enter a valid RPC URL.";
  }
}

const STORAGE_KEY = "savedRpcUrls";
const MAX_SAVED = 10;

/** Saved custom RPC URLs, most recent first. Storage can be unavailable (private mode), so failures are ignored. */
export function loadSavedRpcUrls(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((u): u is string => typeof u === "string" && !validateRpcUrl(u)) : [];
  } catch {
    return [];
  }
}

/**
 * Short label for a saved URL: the host (with port), plus the last 4 characters of any path/query so
 * several endpoints on one host stay distinguishable. Also keeps API keys in the URL off screen.
 */
export function shortRpcUrl(rpcUrl: string): string {
  try {
    const u = new URL(rpcUrl);
    const rest = (u.pathname + u.search).replace(/^\/$/, "");
    return rest ? `${u.host}/…${rest.slice(-4)}` : u.host;
  } catch {
    return rpcUrl;
  }
}

function storeSavedRpcUrls(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Not persisted; the list still works for this session.
  }
}

interface Props {
  network: Network;
  rpcUrl: string;
  rpcUrlError: string | null;
  disabled?: boolean;
  onNetworkChange(network: Network): void;
  onRpcUrlChange(rpcUrl: string): void;
}

export function NetworkPicker(props: Props) {
  const [saved, setSaved] = useState(loadSavedRpcUrls);
  const url = props.rpcUrl.trim();

  const updateSaved = (list: string[]) => {
    setSaved(list);
    storeSavedRpcUrls(list);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (props.rpcUrlError || !url) return;
    updateSaved([url, ...saved.filter((u) => u !== url)].slice(0, MAX_SAVED));
  };

  return (
    <fieldset className="network" disabled={props.disabled}>
      <div className="segmented">
        {NETWORK_OPTIONS.map((o) => (
          <label key={o.value} className={props.network === o.value ? "active" : ""}>
            <input
              type="radio"
              name="network"
              value={o.value}
              checked={props.network === o.value}
              onChange={() => props.onNetworkChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {props.network === "custom" && (
        <>
          <form className="rpc-row" onSubmit={save}>
            <input
              className={props.rpcUrlError ? "invalid" : ""}
              type="url"
              placeholder="https://my-rpc.example.com"
              value={props.rpcUrl}
              onChange={(e) => props.onRpcUrlChange(e.target.value)}
            />
            <button type="submit" disabled={!!props.rpcUrlError || saved.includes(url)}>
              {saved.includes(url) ? "Saved" : "Save"}
            </button>
          </form>
          {saved.length > 0 && (
            <ul className="saved-rpcs">
              {saved.map((u) => (
                <li key={u} className={u === url ? "active" : ""}>
                  <button type="button" className="rpc-url mono" title={u} onClick={() => props.onRpcUrlChange(u)}>
                    {shortRpcUrl(u)}
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title="Remove"
                    aria-label={`Remove ${shortRpcUrl(u)}`}
                    onClick={() => updateSaved(saved.filter((x) => x !== u))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {props.rpcUrlError && <p className="field-error">{props.rpcUrlError}</p>}
    </fieldset>
  );
}

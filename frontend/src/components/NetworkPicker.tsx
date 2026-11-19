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

interface Props {
  network: Network;
  rpcUrl: string;
  rpcUrlError: string | null;
  disabled?: boolean;
  onNetworkChange(network: Network): void;
  onRpcUrlChange(rpcUrl: string): void;
}

export function NetworkPicker(props: Props) {
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
        <input
          className={props.rpcUrlError ? "invalid" : ""}
          type="url"
          placeholder="https://my-rpc.example.com"
          value={props.rpcUrl}
          onChange={(e) => props.onRpcUrlChange(e.target.value)}
        />
      )}
      {props.rpcUrlError && <p className="field-error">{props.rpcUrlError}</p>}
    </fieldset>
  );
}

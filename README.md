# Solana Wallet Manager

Send SOL to any wallet through a 4-step flow: pick a network, enter an amount, enter a wallet public key, and confirm.

- `frontend/`: React + TypeScript (Vite), served on http://localhost:5180
- `backend/`: Express + TypeScript (`@solana/web3.js`), served on http://localhost:4100

## Quick start

```bash
npm install
cp backend/.env.example backend/.env   # then edit it
npm run dev                            # starts the API and the web app together
```

## How SOL is delivered

| Network          | Method                                                                                |
| ---------------- | ------------------------------------------------------------------------------------- |
| Devnet / Testnet | The RPC's `requestAirdrop`. If that fails, a transfer from the faucet wallet, when one is configured |
| Custom RPC       | Same as above (works out of the box with `solana-test-validator` / Surfpool at `http://127.0.0.1:8899`) |
| Mainnet          | A transfer from the faucet wallet only. Needs `ALLOW_MAINNET=true` and `FAUCET_SECRET_KEY` |

> **Note:** The public `api.devnet.solana.com` and `api.testnet.solana.com` RPCs have closed their
> airdrop faucets (they return `410 Gone`). To airdrop on those clusters, either point
> `DEVNET_RPC_URL`/`TESTNET_RPC_URL` at a provider that still supports `requestAirdrop`, or set up
> a faucet wallet:
>
> ```bash
> npm run keygen -w backend      # prints an address and FAUCET_SECRET_KEY=...
> ```
>
> Paste the key into `backend/.env`, fund the address at https://faucet.solana.com, and restart the backend.

## API

`GET /api/config` → `{ maxAirdropSol, mainnetEnabled, faucetAddress }`

`POST /api/airdrop`

```json
{ "network": "devnet", "amount": "1", "pubkey": "<base58>", "rpcUrl": "<only for custom>" }
```

→ `{ signature, method: "airdrop" | "transfer", rpcUrl, balance }`, or `{ error }` with a 4xx/5xx status.

`GET /api/balance?network=devnet&pubkey=<base58>[&rpcUrl=…]` → `{ pubkey, lamports, balance }`

`GET /api/blockhash?network=devnet[&rpcUrl=…]` → `{ blockhash, lastValidBlockHeight }`

`POST /api/send` `{ network, rpcUrl?, tx: "<base64 signed tx>", lastValidBlockHeight }` → `{ signature, rpcUrl }`

`GET /api/token-balance?network=mainnet&pubkey=<base58>&mint=<mint>` → `{ mint, amount, decimals, uiAmount }`

`GET /api/tokens?network=devnet&pubkey=<base58>[&rpcUrl=…]` → `{ owner, tokens: [{ mint, amount, decimals, uiAmount, program, name, symbol, accounts }] }`:
every SPL Token and Token-2022 holding, merged per mint, with name/symbol from Token-2022 or Metaplex metadata when present.
The **Balance** tab lists these under the SOL balance (empty token accounts are hidden behind a toggle).

`GET /api/swap/quote?inputMint=…&outputMint=…&amount=<base units>&slippageBps=50` → Jupiter quote

`POST /api/swap/build` `{ quoteResponse, userPublicKey }` → `{ swapTransaction, lastValidBlockHeight }`

The **Swap** tab swaps SOL ⇄ USDT through the [Jupiter](https://jup.ag) aggregator. It works only on mainnet,
or on a custom RPC pointing at mainnet or a mainnet fork. The backend only accepts SOL and USDT mints. It gets
a quote, has Jupiter build a v0 transaction, the wallet signs it, and it's relayed through `/api/send`. Right
before building, the quote is refreshed; if the price has moved past the reviewed minimum, the swap is refused.
The public mainnet RPC often drops transactions under load, so set `MAINNET_RPC_URL` to a private RPC
(Helius, Triton, QuickNode, …) for reliable swaps.

`GET /api/price` → `{ usd, source, updatedAt }`: the mainnet SOL/USD price (CoinGecko, Binance as a fallback),
cached for 60 seconds. The Send tab uses it so you can enter amounts in SOL or US$. The lamport amount is
fixed when you click Review, and USD conversions round down.

The **Send** tab builds a SOL transfer in the browser, has the connected wallet (Phantom/Solflare/Backpack)
sign it, and relays it through `/api/send`. The server only forwards the signed transaction and never sees
the user's key. Routing through the backend means sends use the same RPC as the rest of the app (including
custom ones) and confirm over HTTP polling, so RPCs without WebSocket support work.

**Saved RPCs.** With **Custom RPC** selected, click **Save** (or press Enter) to remember the URL in the
browser's `localStorage` (up to 10, most recent first). Saved URLs are listed under the field: click one to
use it, × to remove it. The most recent one is pre-filled on the next visit.

**Wallets.** Connect Phantom (or Solflare/Backpack), or click **Use private key** and paste a secret key
(base58 as exported by Phantom/Solflare, or a Solana CLI `id.json` byte array). A pasted key is parsed and
used for signing in the browser only: it's held in memory, never saved or sent to the backend, and is gone on
reload or **Forget key**. Use a dev wallet for this, not one holding real funds.

## Safeguards

- `MAX_AIRDROP_SOL` caps the amount per request (default 5).
- Per-IP rate limiting (`RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS`).
- Mainnet is off by default, because it spends real SOL from the faucet wallet. If you turn it on,
  put the backend behind authentication; an IP rate limit alone won't stop someone draining the wallet.
- Custom RPC URLs must be http(s). The backend makes requests to whatever URL the user supplies,
  so on a public deployment restrict this to trusted hosts.

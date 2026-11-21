import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { airdrop, parseRequest } from "./airdrop.js";
import { config } from "./config.js";
import { getSolPrice } from "./price.js";
import { ApiError } from "./solana.js";
import { buildSwap, getQuote, getTokenBalance } from "./swap.js";
import { getTokens } from "./tokens.js";
import { getBalance, getBlockhash, sendSigned } from "./wallet.js";

const app = express();
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: "100kb" }));

const limiter = (limit: number) =>
  rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });

app.get("/api/config", (_req, res) => {
  res.json({
    maxAirdropSol: config.maxAirdropSol,
    mainnetEnabled: config.allowMainnet && config.faucet !== null,
    faucetAddress: config.faucet?.publicKey.toBase58() ?? null,
  });
});

app.post("/api/airdrop", limiter(config.rateLimitMax), async (req, res) => {
  const request = parseRequest(req.body);
  const result = await airdrop(request);
  console.log(
    `[airdrop] ${request.amount} SOL -> ${request.to.toBase58()} on ${request.network} (${result.method}) ${result.signature}`,
  );
  res.json(result);
});

app.get("/api/balance", limiter(120), async (req, res) => {
  res.json(await getBalance(req.query));
});

app.get("/api/blockhash", limiter(60), async (req, res) => {
  res.json(await getBlockhash(req.query));
});

app.get("/api/price", async (_req, res) => {
  res.json(await getSolPrice());
});

app.get("/api/token-balance", limiter(120), async (req, res) => {
  res.json(await getTokenBalance(req.query));
});

app.get("/api/tokens", limiter(60), async (req, res) => {
  res.json(await getTokens(req.query));
});

app.get("/api/swap/quote", limiter(120), async (req, res) => {
  res.json(await getQuote(req.query));
});

app.post("/api/swap/build", limiter(30), async (req, res) => {
  res.json(await buildSwap(req.body));
});

app.post("/api/send", limiter(30), async (req, res) => {
  const result = await sendSigned(req.body);
  console.log(`[send] relayed ${result.signature}`);
  res.json(result);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Airdrop API listening on http://localhost:${config.port}`);
  if (config.faucet) console.log(`Faucet wallet: ${config.faucet.publicKey.toBase58()}`);
  console.log(`Mainnet: ${config.allowMainnet && config.faucet ? "ENABLED" : "disabled"}`);
});

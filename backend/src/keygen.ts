// Generates a new faucet keypair. Paste the secret into backend/.env as FAUCET_SECRET_KEY,
// then fund the address (e.g. https://faucet.solana.com for devnet/testnet).
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();
console.log(`Address:           ${kp.publicKey.toBase58()}`);
console.log(`FAUCET_SECRET_KEY=${bs58.encode(kp.secretKey)}`);

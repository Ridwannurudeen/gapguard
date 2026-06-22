import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";

const privateKeyPath = resolve(
  process.env.ARENA_SIGNING_KEY_FILE ?? ".arena-signing-key.pem",
);
const publicKeyPath = resolve(process.argv[2] ?? "public/arena-pubkey.pem");

if (existsSync(privateKeyPath)) {
  throw new Error(
    `${privateKeyPath} already exists; move it first if you intend to rotate the Arena signing identity`,
  );
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(privateKeyPath), { recursive: true });
mkdirSync(dirname(publicKeyPath), { recursive: true });
writeFileSync(
  privateKeyPath,
  privateKey.export({ format: "pem", type: "pkcs8" }),
  { mode: 0o600 },
);
writeFileSync(
  publicKeyPath,
  publicKey.export({ format: "pem", type: "spki" }),
);

console.log(`Arena signing key created: ${privateKeyPath}`);
console.log(`Arena public key published: ${publicKeyPath}`);

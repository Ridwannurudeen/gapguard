import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";

export const DEFAULT_SIGNING_KEY_FILE = ".arena-signing-key.pem";
export const DEFAULT_PUBLIC_KEY_FILE = "public/arena-pubkey.pem";

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function loadArenaSigningKey(
  env: NodeJS.ProcessEnv = process.env,
): KeyObject | null {
  const inline = env.ARENA_SIGNING_KEY;
  if (inline) return createPrivateKey(normalizePem(inline));

  const file = resolve(env.ARENA_SIGNING_KEY_FILE ?? DEFAULT_SIGNING_KEY_FILE);
  if (!existsSync(file)) return null;
  return createPrivateKey(readFileSync(file, "utf8"));
}

export function readArenaPublicKey(path = DEFAULT_PUBLIC_KEY_FILE): KeyObject {
  return createPublicKey(readFileSync(resolve(path), "utf8"));
}

export function publicKeySpkiB64(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

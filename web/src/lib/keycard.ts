// Key cards: the SLH-DSA-SHA2-128s key that is the ONLY authority to change an
// order (ARCHITECTURE.md §4.2, §7.1). Generated and used in the browser, never
// sent anywhere. Saved as an encrypted JSON file:
//
//   secret key (64 bytes) --AES-GCM--> ciphertext
//   AES key = PBKDF2-SHA256(password, random salt, 600,000 iterations)
//   additional data = the public key, so a file can't be edited to claim another key
//
// After decrypting we also check that the secret key contains the public key
// (in SLH-DSA the last 32 bytes of the secret key are the public key).

import { bytesToHex, hexToBytes, type Hex } from "viem";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD = 10;

export interface KeyCardFile {
  format: "writ-keycard";
  version: 1;
  publicKey: Hex;
  createdAt: string;
  network?: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: Hex };
  cipher: { name: "AES-GCM"; iv: Hex };
  ciphertext: Hex;
  note: string;
}

export interface KeyCard {
  publicKey: Uint8Array; // 32 bytes, goes on chain as pqKey
  secretKey: Uint8Array; // 64 bytes, never leaves the browser
}

export class KeyCardError extends Error {}

const enc = new TextEncoder();
// WebCrypto wants ArrayBuffer-backed views; copy to be safe across realms.
const buf = (u: Uint8Array) => new Uint8Array(u).buffer as ArrayBuffer;

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function checkPassword(pw: string, confirm?: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (confirm !== undefined && pw !== confirm) return "The two passwords don't match.";
  return null;
}

export async function encryptKeyCard(card: KeyCard, password: string, network?: string): Promise<KeyCardFile> {
  if (card.publicKey.length !== 32 || card.secretKey.length !== 64) throw new KeyCardError("Malformed key card.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: buf(iv), additionalData: buf(card.publicKey) }, key, buf(card.secretKey),
  );
  return {
    format: "writ-keycard",
    version: 1,
    publicKey: bytesToHex(card.publicKey),
    createdAt: new Date().toISOString(),
    ...(network && { network }),
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToHex(salt) },
    cipher: { name: "AES-GCM", iv: bytesToHex(iv) },
    ciphertext: bytesToHex(new Uint8Array(ct)),
    note: "Writ key card. This is the only key that can change or cancel your order. Keep it and its password safe. Writ cannot recover it.",
  };
}

export function parseKeyCardFile(text: string): KeyCardFile {
  let j: KeyCardFile;
  try {
    j = JSON.parse(text);
  } catch {
    throw new KeyCardError("That file isn't a Writ key card (it isn't valid JSON).");
  }
  if (j?.format !== "writ-keycard" || j.version !== 1) throw new KeyCardError("That file isn't a Writ key card.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(j.publicKey ?? "")) throw new KeyCardError("This key card file is damaged (bad public key).");
  if (j.kdf?.name !== "PBKDF2" || j.cipher?.name !== "AES-GCM") throw new KeyCardError("This key card uses an unsupported format.");
  return j;
}

export async function decryptKeyCard(file: KeyCardFile, password: string): Promise<KeyCard> {
  const publicKey = hexToBytes(file.publicKey);
  const key = await deriveKey(password, hexToBytes(file.kdf.salt), file.kdf.iterations);
  let sk: Uint8Array;
  try {
    sk = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buf(hexToBytes(file.cipher.iv)), additionalData: buf(publicKey) },
      key,
      buf(hexToBytes(file.ciphertext)),
    ));
  } catch {
    throw new KeyCardError("Wrong password, or the key card file was changed.");
  }
  if (sk.length !== 64 || bytesToHex(sk.slice(32)) !== file.publicKey.toLowerCase()) {
    throw new KeyCardError("This key card file is damaged: its secret doesn't match its public key.");
  }
  return { publicKey, secretKey: sk };
}

export function keyCardFileName(publicKey: Hex) {
  return `writ-keycard-${publicKey.slice(2, 10)}.json`;
}

export function downloadKeyCard(file: KeyCardFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = keyCardFileName(file.publicKey);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readFileText(f: File): Promise<string> {
  if (f.size > 64 * 1024) throw new KeyCardError("That file is too large to be a key card.");
  return f.text();
}

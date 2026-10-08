// A key card file is untrusted input: it arrives from the user's disk and
// nothing signed it. These cover the validation added after the audit.
import { describe, expect, it } from "vitest";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import {
  encryptKeyCard, parseKeyCardFile, decryptKeyCard, KeyCardError,
  MAX_ITERATIONS, MIN_ITERATIONS, PBKDF2_ITERATIONS,
} from "./keycard";

const kp = S.keygen(new Uint8Array(48).fill(3));
const card = { publicKey: kp.publicKey, secretKey: kp.secretKey };
const good = async () => encryptKeyCard(card, "correct horse battery");

describe("key card file validation", () => {
  it("rejects an iteration count that would hang the tab", async () => {
    const f = { ...(await good()), kdf: { ...(await good()).kdf, iterations: 1_000_000_000 } };
    expect(() => parseKeyCardFile(JSON.stringify(f))).toThrow(/key-derivation/);
  }, 60_000);

  it("rejects an iteration count low enough to weaken the card", async () => {
    const base = await good();
    const f = { ...base, kdf: { ...base.kdf, iterations: 1 } };
    expect(() => parseKeyCardFile(JSON.stringify(f))).toThrow(/key-derivation/);
  }, 60_000);

  it("accepts the bounds themselves", async () => {
    const base = await good();
    for (const n of [MIN_ITERATIONS, PBKDF2_ITERATIONS, MAX_ITERATIONS]) {
      const f = { ...base, kdf: { ...base.kdf, iterations: n } };
      expect(parseKeyCardFile(JSON.stringify(f)).kdf.iterations).toBe(n);
    }
  }, 60_000);

  it("rejects non-hex salt, iv and ciphertext with a key-card message", async () => {
    const base = await good();
    for (const bad of [
      { ...base, kdf: { ...base.kdf, salt: "not hex" } },
      { ...base, cipher: { ...base.cipher, iv: "0xZZ" } },
      { ...base, ciphertext: "oops" },
    ]) {
      expect(() => parseKeyCardFile(JSON.stringify(bad))).toThrow(KeyCardError);
    }
  }, 60_000);

  it("rejects a truncated ciphertext", async () => {
    const f = { ...(await good()), ciphertext: "0xdeadbeef" };
    expect(() => parseKeyCardFile(JSON.stringify(f))).toThrow(/truncated/);
  }, 60_000);

  it("rejects an unsupported kdf hash", async () => {
    const base = await good();
    const f = { ...base, kdf: { ...base.kdf, hash: "SHA-1" } };
    expect(() => parseKeyCardFile(JSON.stringify(f))).toThrow(/unsupported/);
  }, 60_000);

  it("still round-trips a valid card", async () => {
    const f = await good();
    const back = await decryptKeyCard(parseKeyCardFile(JSON.stringify(f)), "correct horse battery");
    expect(back.secretKey.length).toBe(64);
  }, 60_000);
});

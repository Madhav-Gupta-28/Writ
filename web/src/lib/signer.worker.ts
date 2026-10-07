/// <reference lib="webworker" />
// SLH-DSA-SHA2-128s keygen and signing off the main thread (~1-4 s per signature
// in pure JS, ARCHITECTURE.md §3.4). Uses the FIPS-205 "pure" API: Arc rejects
// signatures made with .internal.sign.

import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";

export type SignerRequest =
  | { id: number; type: "keygen" }
  | { id: number; type: "sign"; secretKey: Uint8Array; message: Uint8Array };

export type SignerResponse =
  | { id: number; ok: true; publicKey?: Uint8Array; secretKey?: Uint8Array; signature?: Uint8Array; ms: number }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<SignerRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  try {
    if (req.type === "keygen") {
      const k = S.keygen();
      const res: SignerResponse = { id: req.id, ok: true, publicKey: k.publicKey, secretKey: k.secretKey, ms: performance.now() - t0 };
      (self as unknown as Worker).postMessage(res);
    } else {
      const signature = S.sign(req.message, req.secretKey); // pure FIPS-205
      if (signature.length !== 7856) throw new Error(`signature is ${signature.length} bytes`);
      const res: SignerResponse = { id: req.id, ok: true, signature, ms: performance.now() - t0 };
      (self as unknown as Worker).postMessage(res);
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: String((e as Error)?.message ?? e) } satisfies SignerResponse);
  }
};

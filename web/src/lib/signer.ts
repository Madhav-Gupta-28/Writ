// Main-thread wrapper around signer.worker.ts.

import type { KeyCard } from "./keycard";
import type { SignerRequest, SignerResponse } from "./signer.worker";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: SignerResponse) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./signer.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<SignerResponse>) => {
      pending.get(ev.data.id)?.(ev.data);
      pending.delete(ev.data.id);
    };
  }
  return worker;
}

type Req = { type: "keygen" } | { type: "sign"; secretKey: Uint8Array; message: Uint8Array };

function call(req: Req): Promise<Extract<SignerResponse, { ok: true }>> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, (r) => (r.ok ? resolve(r) : reject(new Error(r.error))));
    getWorker().postMessage({ ...req, id } as SignerRequest);
  });
}

export async function generateKeyCard(): Promise<KeyCard> {
  const r = await call({ type: "keygen" });
  return { publicKey: r.publicKey!, secretKey: r.secretKey! };
}

/** Sign a 32-byte digest with the key card. Returns the 7,856-byte signature and the time taken. */
export async function signDigest(card: KeyCard, digest: Uint8Array): Promise<{ signature: Uint8Array; ms: number }> {
  const r = await call({ type: "sign", secretKey: card.secretKey, message: digest });
  return { signature: r.signature!, ms: r.ms };
}

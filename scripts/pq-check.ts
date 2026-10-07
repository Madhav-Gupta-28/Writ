// Checks the Arc PQ precompile against @noble/post-quantum (ARCHITECTURE.md §3.4).
//
// Generates an SLH-DSA-SHA2-128s keypair, signs one random 32-byte digest twice:
//   - pure FIPS-205 sign  -> the precompile must return true
//   - .internal.sign      -> the precompile must return false
// and prints a `cast call` for each.
//
// Diagnostics go to stderr, commands to stdout, so this works:
//   node scripts/pq-check.ts > pq-check.sh
//
// Usage: node scripts/pq-check.ts [rpc-url]   (default: Arc testnet)

import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";

const PQ_PRECOMPILE = "0x1800000000000000000000000000000000000004";
const RPC = process.argv[2] ?? "https://rpc.testnet.arc.io";

const PUBKEY_LEN = 32;
const SIG_LEN = 7856;

const hex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");

const castCall = (vk: Uint8Array, msg: Uint8Array, sig: Uint8Array) =>
  `cast call ${PQ_PRECOMPILE} "verifySlhDsaSha2128s(bytes,bytes,bytes)(bool)" ` +
  `${hex(vk)} ${hex(msg)} ${hex(sig)} --rpc-url ${RPC}`;

const { publicKey, secretKey } = S.keygen();
const digest = crypto.getRandomValues(new Uint8Array(32));

let t = performance.now();
const pureSig = S.sign(digest, secretKey); // FIPS-205 pure: 0x00 ‖ len(ctx) ‖ ctx ‖ msg, empty ctx
const pureMs = performance.now() - t;
const internalSig = S.internal.sign(digest, secretKey); // no domain prefix; Arc rejects this

// The precompile reverts on wrong lengths rather than returning false. Fail here instead.
if (publicKey.length !== PUBKEY_LEN) throw new Error(`public key is ${publicKey.length} bytes, want ${PUBKEY_LEN}`);
for (const [name, sig] of [["pure", pureSig], ["internal", internalSig]] as const) {
  if (sig.length !== SIG_LEN) throw new Error(`${name} signature is ${sig.length} bytes, want ${SIG_LEN}`);
}

// Local sanity: each signature verifies only under its own variant.
const local = {
  pure: S.verify(pureSig, digest, publicKey),
  internal: S.internal.verify(internalSig, digest, publicKey),
  internalAsPure: S.verify(internalSig, digest, publicKey),
};
if (!local.pure || !local.internal || local.internalAsPure) {
  throw new Error(`local verification mismatch: ${JSON.stringify(local)}`);
}

console.error(`vk      ${hex(publicKey)}`);
console.error(`digest  ${hex(digest)}`);
console.error(`signed (pure) in ${pureMs.toFixed(0)} ms`);
console.error(`local verify: pure=${local.pure} internal=${local.internal} internal-under-pure=${local.internalAsPure}`);
console.error(`\nrpc ${RPC}. Run the two commands below.\n`);

console.log(`# pure FIPS-205 signature: expect true`);
console.log(castCall(publicKey, digest, pureSig));
console.log(`\n# .internal signature: expect false`);
console.log(castCall(publicKey, digest, internalSig));

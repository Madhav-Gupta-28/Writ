// shared/abi/writ.ts must match the current Foundry build (skipped if contracts/out is absent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { writAbi } from "../shared/abi/writ.ts";

const out = new URL("../contracts/out/Writ.sol/Writ.json", import.meta.url);

test("shared/abi/writ.ts matches contracts/out (run `npm run abi` if not)", { skip: !existsSync(out) }, () => {
  assert.deepEqual(writAbi, JSON.parse(readFileSync(out, "utf8")).abi);
});

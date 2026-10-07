import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// web/ imports the digest and EIP-3009 nonce code from ../shared, the same
// files the contract tests pin byte for byte. Dedupe so shared/ uses web's
// copies of viem and noble.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["viem", "@noble/post-quantum"] },
  server: { fs: { allow: [".."] } },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});

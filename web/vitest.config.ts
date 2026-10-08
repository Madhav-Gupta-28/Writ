// Test config, kept out of vite.config.ts so the production build does not
// depend on vitest's types at all.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        provider: "v8",
        all: true,
        include: ["src/**"],
        // main.tsx is the three-line React root mount, and signer.worker.ts only
        // runs inside a real module Worker, which jsdom does not provide. Both
        // are exercised by the Playwright e2e run (web/e2e/flow.e2e.ts).
        exclude: ["src/**/*.test.*", "src/test/**", "src/main.tsx", "src/lib/signer.worker.ts"],
        reporter: ["text", "lcov"],
      },
    },
  }),
);

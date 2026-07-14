import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Three repo-level test-env fixes live here:
// 1. The shell inherits NODE_ENV=production (Vercel deploys ship it), which
//    makes `react/cjs/react.production.js` load — that bundle omits `act`,
//    which @testing-library/react@16 requires. We force NODE_ENV=test for the
//    vitest worker subprocess so the dev bundle is loaded.
// 2. The shell also inherits VERCEL_ENV=production; --mode=test alone did not
//    override process.env.NODE_ENV in the worker. Setting env.NODE_ENV here
//    propagates it deterministically regardless of the parent shell.
// 3. Vitest's default include picks up every worktree under .worktrees/,
//    quadrupling every failure. Explicit include keeps the run scoped to
//    the repo root only.
export default defineConfig({
  plugins: [react()],
  test: {
    env: { NODE_ENV: "test" },
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "api/**/*.{test,spec}.{js,ts}",
      "middleware.test.js",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      ".worktrees/**",
    ],
  },
});

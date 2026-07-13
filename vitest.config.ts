import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Two repo-level test-env fixes live here:
// 1. The shell inherits VERCEL_ENV=production, which makes React load its
//    production bundle (no `act` on the named export) and breaks every
//    @testing-library/react@16 render. Forcing mode=test propagates the
//    correct NODE_ENV into Vitest's worker.
// 2. Vitest's default include picks up every worktree under .worktrees/,
//    quadrupling every failure. Explicit include keeps the run scoped to
//    the repo root only.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "api/**/*.{test,spec}.{js,ts}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      ".worktrees/**",
    ],
  },
});
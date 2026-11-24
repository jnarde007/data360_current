# Lint baseline (Phase 2 · Item 1)

`npm run lint` currently reports **652 errors / 54 warnings** across the
existing codebase (mostly `@typescript-eslint/no-explicit-any` and a few
`prefer-const` / `no-require-imports`). None of these were introduced by
Phase 2 work.

To unblock CI without a giant cleanup PR, the **Lint** step in
`.github/workflows/ci.yml` runs with `continue-on-error: true` and is
treated as **advisory**. All other gates (TypeScript compile, Vitest, build,
Deno edge-function tests) are **blocking**.

## Plan to flip lint to blocking

1. Burn down `any` in `supabase/functions/**` (largest cluster).
2. Burn down `any` in `src/lib/**` and `src/components/admin/**`.
3. Fix the 3 trivial `prefer-const` / `no-require-imports` errors.
4. Once `npm run lint` exits 0, remove `continue-on-error: true` from the
   Lint step and delete this file.

## Running locally

```bash
npm ci
npm run lint           # advisory today, blocking once baseline hits 0
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build

# Edge functions
deno test --allow-net --allow-env --allow-read \
  supabase/functions/**/*.test.ts
```

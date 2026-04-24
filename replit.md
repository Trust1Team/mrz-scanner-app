# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### MRZ Scanner (`artifacts/mrz-scanner`)
- **Type**: Expo (React Native) mobile app
- **Purpose**: Scan MRZ zones on ID documents and passports using the device camera
- **Features**:
  - Full-screen camera view with torch/flashlight toggle
  - Animated scan overlay (TD1/TD2/TD3 frame guides)
  - MRZ parser (`lib/mrz.ts`) — pure TypeScript, no native deps
    - TD1 (ID cards, 3×30), TD2 (2×36), TD3 (passports, 2×44)
    - OCR error correction (0↔O, 1↔I/L, 8↔B, etc.)
    - ICAO 9303 checksum validation for all fields
    - Date parsing with century ambiguity handling
    - Field extraction (name, nationality, DOB, expiry, doc number, sex)
  - Manual MRZ entry modal with sample TD1/TD3 data for testing
  - Result card with validation status, field breakdown, raw MRZ display
  - Camera permission flow with Settings fallback
- **On-device OCR**: Fully local — no network call for scanning.
  - Android: Google ML Kit Text Recognition (`@react-native-ml-kit/text-recognition`)
  - iOS: Apple Vision framework (via the same package)
  - Captured frame → resized to ≤1000 px via `expo-image-manipulator` → URI passed to `TextRecognition.recognize()` → text fed to ICAO 9303 parser
  - Typical scan time: 200–500 ms per frame (vs 1–3 s with a remote API)
  - Requires a custom **development build** (EAS) — not compatible with Expo Go
- **EAS build**: `eas.json` configured with development/preview/production profiles. Bundle ID: `com.mrzscanner.app`. New architecture disabled (`newArchEnabled: false`) for ML Kit compatibility.
- **Auto-torch**: Tiny silent capture (quality 0.05) measures brightness via base64 length heuristic; auto-enables torch when dark.
- **Live frame thumbnail**: 108×76 px bottom-left thumbnail with green border and flash animation per captured frame; tap to expand.
- **Web fallback**: Manual MRZ entry with sample TD1/TD3 data for testing in the browser (no OCR, parser only).
- **Building the dev client**: Run `eas build --profile development --platform android` (or `ios`). Install the resulting `.apk`/`.ipa` on the device, then point it at the Metro bundler URL shown in the Expo workflow.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

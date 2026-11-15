# POMAK — interface direction (web + Android)

This branch refreshes the existing React + Tailwind UI. **The Capacitor Android app renders the same frontend**, so the new responsive interface, component styles and semantic tokens automatically carry over when the Android bundle is rebuilt and synced.

## Direction

Calm, confident, training-focused. Replace the generic white-card/teal-strip look with warm neutral canvas, deep botanical green, bright lime highlights on signature moments, editorial titles, and subtle layered surfaces. Prioritize clarity of the next action over decorative illustrations or invented progress numbers.

## Design tokens

All source-of-truth tokens live in `frontend/src/index.css` in `@theme`. Never hard-code new brand colors in feature screens.

| Token | Value | Usage |
| --- | --- | --- |
| `ink` | `#172c2a` | Main text |
| `muted` | `#63736e` | Secondary copy |
| `surface` | `#f3f6f1` | Canvas |
| `card` | `#ffffff` | Interactive surfaces |
| `line` | `#dce5df` | Dividers |
| `brand` | `#176c58` | Main controls |
| `brand-dark` | `#0d5041` | Hover / emphasis |
| `brand-soft` | `#e7f2ec` | Active rows, subtle CTAs |
| `accent` | `#e8b75a` | Secondary emphasis |
| `lime` | `#e0f3a7` | Signature hero CTA |
| `danger` | `#b13e43` | Semantic error and destructive actions |

The desktop sidebar is enabled at a wide viewport (980px). On mobile and native Android, keep the rounded floating bottom navigation; its links still point to the same routes. The app shell respects CSS safe-area insets for devices with cutouts and gesture navigation.

## Component rules

- Start new pages with `PageHeader`, use `Card`/`Button`/`Field` for consistent interactions.
- Preserve minimum 44px touch targets, readable labels, visible focus, reduced-motion support.
- Use actual backend data for metrics; never fake streaks, ratings or health numbers to fill a design.
- Reuse feature screens for web + Android rather than forking per-platform components.
- Do not modify nutrition/training computation, authentication, or data persistence for a purely visual change.

## QA checklist before merging

1. `cd frontend && npm ci && npm test && npm run lint -- --deny-warnings && npm run build`
2. Verify at 320px, 390px, 768px and desktop 1280px; check keyboard navigation.
3. Check today / training / nutrition / progress / coach tabs in both languages.
4. Check active workout, keyboard covering input, scroll restoration, and Android safe areas.
5. Check native via `npx cap sync android`, Gradle build, and a device/emulator.
6. Open the Vercel preview and review in the browser before merging into `main`.

No production deployment or main-branch update is performed by this design branch alone.

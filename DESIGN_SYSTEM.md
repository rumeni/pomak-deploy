# POMAK — interface direction (web + Android)

This branch refreshes the existing React + Tailwind UI. **The Capacitor Android app renders the same frontend**, so the new responsive interface, component styles and semantic tokens automatically carry over when the Android bundle is rebuilt and synced.

## Direction

Athletic, editorial, data-first. Warm paper canvas with faint grain, near-black ink panels, one signal color (orange) for the active state, progress and the brand mark. Titles and big numbers use the condensed cut of Archivo (bundled locally, works offline in the APK). The only decoration is the topographic contour drawing in `frontend/src/assets/topo.svg` (own artwork, generated from noise), applied as a CSS mask (`.topo-layer`) so one file works in any color. The Today panel shows real numbers (workouts this week, kcal today, latest weight, days trained) instead of a slogan.

## Design tokens

All source-of-truth tokens live in `frontend/src/index.css` in `@theme`. Never hard-code new brand colors in feature screens.

| Token | Value | Usage |
| --- | --- | --- |
| `ink` | `#141615` | Main text, dark panels, navigation |
| `muted` | `#6c6f6a` | Secondary copy |
| `surface` | `#f2efe9` | Paper canvas (with grain) |
| `card` | `#fdfcfa` | Interactive surfaces |
| `line` | `#e3dfd7` | Dividers, card borders |
| `brand` | `#171918` | Primary buttons, selected borders |
| `brand-dark` | `#050605` | Emphasis text, hover |
| `brand-soft` | `#e9e5dd` | Secondary buttons, selected rows |
| `accent` | `#ff5a1f` | Active nav icon, progress, charts, focus ring, brand mark |
| `danger` | `#b8262f` | Semantic error and destructive actions |

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

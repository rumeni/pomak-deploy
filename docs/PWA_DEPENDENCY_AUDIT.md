# PWA build dependency security audit — 2026-11-15

Tracking: [Issue #9](https://github.com/rumeni/pomak-deploy/issues/9).

## Baseline

The POMAK frontend uses Vite 8 and `vite-plugin-pwa@1.3.0` to generate a Workbox service worker. The service worker is registered only in the browser (see `src/lib/native.ts`); the Android Capacitor build does not register it.

Verified with npm audit on Node 24 in GitHub Actions:

| Variant | Low | Moderate | High/Critical | Production advisories |
| --- | ---: | ---: | ---: | ---: |
| Original PWA plugin / lockfile | 2 | 4 | 0 | 0 |
| PWA plugin 2.0.0 without other changes | 2 | 4 | 0 | 0 |
| Workbox-scoped `glob@14.0.3` override | 4 | 0 | 0 | 0 |
| Global `glob@14.0.3` and `minimatch@11.0.8` overrides | 4 | 0 | 0 | 0 |

The warnings are **package-level audit findings**, not six independent exploits in the POMAK service worker.

## Implemented mitigation on this branch

Prefer the **Workbox-scoped** patch, avoiding broad changes to unrelated packages. Workbox 7.4.1 formally depends on `glob@^11`, so forcing `glob@14` crosses a major-version boundary even though the Vite build succeeds. The candidate passed a real Chromium browser test of the generated service worker, not only TypeScript/Vitest.

Do not deploy the override if browser offline navigation, service-worker update, or Android Capacitor builds regress. Do not use `npm audit fix --force`.

## Why four low audit entries remain

They are the transitive dependency/advisory chain: `@rollup/plugin-node-resolve`, `deepmerge`, `vite-plugin-pwa`, `workbox-build`. As of this audit, `deepmerge@4.3.1` has **no compatible patched release**; updating `vite-plugin-pwa` to 2.0.0 does not remove the inherited advisory. Track upstream fixes rather than hide or ignore their findings.

References:
- https://github.com/vite-pwa/vite-plugin-pwa/issues/959
- https://github.com/GoogleChrome/workbox/issues/3599

## Regression gates

1. `npm ci`, `npm test`, strict Oxlint and `npm run build`.
2. Confirm `dist/sw.js` and `dist/manifest.webmanifest` are emitted.
3. GitHub CI runs `frontend/scripts/pwa-offline-smoke.mjs` in **real Chromium** using the runner's preinstalled Chrome and an unsaved Playwright test-only package. This verified that the service worker controls the page and renders both the homepage and `/trener` route offline. CI preserves this regression check.
4. Manually validate an already-installed PWA's update procedure, offline workout/diary queues, reconnect sync, and Android package before declaring cross-device equivalence.

The production dependency audit must remain at zero. The remaining four **low, build-only** audit entries should stay explicitly tracked in Issue #9 until upstream fixes become available.

## Verified GitHub Actions result

A scoped `workbox-build.glob=14.0.3` override was installed using a regenerated npm lockfile. The GitHub Actions trial completed successfully: **99 frontend tests, strict Oxlint, Vite 8 build, emitted service worker, Chromium offline homepage and offline deep route**. Audit metadata: 4 low, 0 moderate/high/critical; production audit: 0. Experimental upgrading to `vite-plugin-pwa@2.0.0` produced the original 6 advisories, so it was not kept.

Browser validation proves shell precache/navigation on Chrome, **not** that offline diary and workout queue synchronization or a native Android APK has been manually tested. Those device-level acceptance checks remain outstanding and should be completed before treating Issue #9 as fully closed.

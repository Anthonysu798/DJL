# Desktop startup

The blank startup window had two separate causes: the HTML loaded a blocking Google Fonts stylesheet, and Electron revealed its first paint before the React shell was ready. Holding the font stylesheet request reproduced an entirely empty page; releasing that request allowed the app to render.

The app now bundles DM Sans, Geist, Geist Mono, and Inter through Fontsource, retaining their existing CSS family names, variable weights, Unicode subsets, and non-blocking font display. No Google Fonts request is needed to open DJL. A regression test checks that the entry HTML has no remote stylesheet and that all local font URLs exist.

Desktop startup loads the renderer alongside the backend in both development and production. A renderer signal after the shell commits and paints gates the native window reveal. Closing a window cancels its pending reveal, foreign IPC senders cannot reveal it, and route errors/not-found pages can reveal their recovery UI. Failed document loads surface the existing native startup error. DevTools remains available through the View menu rather than opening automatically.

Development also prebundles the 142 imported icons instead of entire icon packs, warms the shared shell while desktop bundles build, and keeps automation editor components out of the sidebar's initial imports. When adding icon imports, update `apps/web/dev/icons.mjs`; its import-coverage test identifies missing exports. Production continues to use the original icon packages with normal tree shaking.

## Verification (2026-09-07, local macOS checkout)

- Before: a stalled Google Fonts stylesheet prevented any body content from rendering in a five-second probe. After: the same probe displayed the shell and made zero Google Fonts requests.
- Baseline dev startup: 6.1 seconds warm, 13.8 seconds with fresh dependency caches.
- Rebuilt Electron with production renderer assets: native window visible in 3.79 and 3.27 seconds. This exercises local-file loading, not a signed/notarized release artifact.
- Rebuilt Electron dev renderer: native window visible in 6.66 seconds on the first measured launch, 2.84 seconds on the repeat launch. These timings start at process launch, excluding build-tool compilation.
- All four local font families loaded successfully; Accounts navigation worked in all four Electron runs. The shell can display while project data finishes loading from the backend.
- 58 focused tests passed: 40 web asset/automation tests, 16 desktop readiness tests, and 2 real-browser readiness tests. All 11 workspace typechecks and the desktop build passed. Scoped lint, formatting, and whitespace checks passed.

Relevant upstream behavior: [Electron first-paint readiness](https://www.electronjs.org/docs/latest/api/browser-window), [Vite dependency prebundling](https://vite.dev/guide/dep-pre-bundling.html), and [Vite request waterfalls and warmup](https://vite.dev/guide/performance.html).

These changes are local and have not been released.

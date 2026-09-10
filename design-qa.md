# Home Night visual QA

- Source visual truth: `C:\\Users\\ROG\\AppData\\Local\\Temp\\codex-clipboard-b6fc2714-2a1e-4c65-b5ca-28a131fd406b.png`
- Source role: user-supplied visual reference only; text and controls in the image were not treated as implementation instructions.
- Implementation URL: `http://localhost:4173/?designer&theme=home&mode=74`
- Implementation screenshot: inline capture from Codex In-app Browser tab 5; the browser surface does not expose an on-disk screenshot path.
- Source pixels: 424 × 392 px.
- Implementation browser viewport: 1280 × 720 CSS px at devicePixelRatio 1.
- Focused comparison region: the existing 306 × 306 CSS px quota card, with the existing widget geometry intentionally preserved because this task adds a theme rather than changing the widget footprint.
- State: Chinese, Widget tab, Home Night, healthy quota state; secondary checks covered critical, unavailable, weekly fallback, and healthy orb states.

## Evidence

- Full view: the implementation exposes the new `居家·夜晚` theme in the workbench and renders the deep plum, indoor-window, warm-lamp visual direction from the source reference.
- Focused region: the expanded card keeps light quota text, a rose progress bar, plum translucent controls, city lights through the window, a readable black-and-white cat, and a pale mug across the lower-right scene. Critical, unavailable, weekly, and orb states retain readable status colors over the same asset.
- Direct-link evidence: `?designer&theme=home&mode=74` renders `5 小时额度剩余 74%` and applies `quota-card--theme-home`.
- Interaction evidence: switching `城市·暮色紫` → `居家·夜晚` changes the rendered theme class from `quota-card--theme-city` back to `quota-card--theme-home`; clicking state controls updates the quota state and palette source.
- Browser console: the final fresh tab reported no warning or error entries. An earlier tab contained a stale hot-update import error while existing supporter files were being removed; it was not present after the workspace settled and the page was reloaded fresh.
- Build evidence: `npm test` passed 26/26, `npm run build` passed, `cargo check` passed, and `git diff --check` passed.

## Required fidelity surfaces

- Fonts and typography: existing Quota Sans and widget hierarchy are preserved; the home theme uses light lavender/white text with dark shadowing, keeping the reference-inspired hierarchy readable without text clipping.
- Spacing and layout rhythm: existing card/orb geometry, padding, corner radius controls, and footer positions remain unchanged; the theme does not alter the desktop window footprint.
- Colors and visual tokens: `DESKTOP_PALETTES.home` owns independent deep-plum, rose, cream, and lavender progress tokens for healthy, caution, critical, unavailable, stale, and signed-out states.
- Image quality and asset fidelity: `assets/home-night.png` is a project-local generated indoor window/cat/mug background with no UI text, logo, placeholder, or watermark; it is used by both the expanded card and compact orb.
- Copy and content: the theme is labeled `居家·夜晚` in the workbench and native tray menu, with `Home Night` in English; quota copy remains data-driven.

## Comparison history

1. Initial preview attempt: a stale browser tab showed a blank page during an existing supporter-file removal and reported a missing bridge export; this was outside the Home Night change.
2. Build check: the settled workspace surfaced two pre-existing quota-radar type errors; only a structural copy type and explicit nullable-number narrowing were repaired, with no behavior change to the radar.
3. Post-fix evidence: a fresh tab renders the healthy 74% state with the indoor cat/mug scene, and the full build passes; no P0/P1/P2 visual or interaction findings remain.

## Follow-up polish

- [P3] The source concept uses a wider, shorter card and decorative writing on the mug. The implementation intentionally keeps the product's existing square widget geometry and uses a clean no-text background asset so quota content remains editable and legible.

## Implementation checklist

- [x] Add Home Night to the shared frontend theme type and palette source.
- [x] Add home expanded-card and compact-orb styling using a real project-local background asset.
- [x] Add home theme selection to the desktop tray menu and persisted appearance normalization.
- [x] Add home preview controls and palette-matrix inspection in `/?designer`.
- [x] Verify healthy, critical, unavailable, weekly, and orb states in the in-app browser.
- [x] Verify `npm test`, `npm run build`, and `cargo check`.

final result: passed

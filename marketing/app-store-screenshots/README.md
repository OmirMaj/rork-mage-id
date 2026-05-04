# App Store screenshot builder

Self-hosted "fastlane snapshot frames" for MAGE ID. Drop a raw phone screenshot in, get an App-Store-ready 1290 × 2796 export out.

## How it works

`builder.html` renders a 1290 × 2796 canvas (the 6.7" iPhone Pro Max size Apple requires for App Store Connect). On the canvas: branded background → headline → subheadline → device-frame screenshot → optional accent callout. Pure HTML / CSS — no build step, no dependencies beyond Google Fonts.

You take a full-page screenshot of the canvas at 1290 × 2796, that's your store asset.

## Workflow

1. **Take raw screenshots on your phone.** Use the actual MAGE app. Native phone resolution is fine — the builder scales them into the device frame.

2. **Drop them into `raw/`** with the names the builder expects:
   - `01-drawing-analyzer.png`
   - `02-home.png`
   - `03-takeoff.png`
   - `04-schedule.png`
   - `05-dcma.png`
   - `06-aia.png`
   - `07-cash-flow.png`
   - `08-daily.png`
   - `09-portal.png`
   - `10-onboarding.png`

   (You can rename them — just update the `image` path inside the matching preset in `builder.html`.)

3. **Open `builder.html` in Chrome.** The first preset auto-loads. Use the right-hand panel to switch between the 10 presets.

4. **For each preset, export a PNG:**
   - Open DevTools (`Cmd+Opt+I`).
   - Toggle Device Toolbar (`Cmd+Shift+M`).
   - Set dimensions: **Custom · 1290 × 2796** (these are the App Store 6.7" Pro Max canvas dimensions).
   - Press `E` to hide the right-side control panel.
   - Open the command palette (`Cmd+Shift+P`), type `screenshot`, choose **"Capture full size screenshot"**.
   - PNG drops to your Downloads folder. Rename it `01-ai-estimate.png`, `02-projects.png`, etc.

5. **Upload to App Store Connect.** Distribution → iOS App → 6.7" Display → drag in.

## Editing copy

Edit the `PRESETS` array at the bottom of `builder.html`. Each entry:

```js
{
  id: '01',
  eyebrow: 'AI ESTIMATE',                 // small uppercase tag at the top
  title: "Drop a PDF. <em>Get a priced estimate.</em>",  // <em> renders italic + accent color
  subtitle: "In 60 seconds, AI turns architect's drawings…",
  image: 'raw/01-drawing-analyzer.png',
  callout: { position: 'bottom-left', text: '60-sec analysis' },  // optional
}
```

`<em>` inside the title is the only inline tag that renders specially — it italicizes and colors the wrapped phrase in the brand orange. Use it to land the ONE word you want a scrolling buyer to read.

## Why pure HTML

- No `node_modules`, no fastlane install, no Ruby, no Xcode plugin
- Edit copy / image, hit refresh, see the result. ~1 second iteration loop
- Same brand fonts as the marketing site (Fraunces, Inter)
- The PNG export is identical pixels to what you see in the browser — no surprises

## Adding a 6.5" set (older Pro Max)

Apple still accepts 6.5" assets at 1242 × 2688. To produce them: change `--w` and `--h` in the `:root` CSS at the top of `builder.html` to those values, re-export. The layout is fluid enough that no other changes are needed (the headline + phone proportions scale).

## Adding more shots

The builder ships with 10 presets matching the order in `docs/app-store-metadata.md`. Apple allows up to **10 screenshots per locale per device size** so 10 is the maximum that will display. If you want fewer, leave the unused presets in place — they just don't get exported.

# Quick Start

Get Party Visuals running locally in about a minute.

## Prerequisites

- **[Node.js](https://nodejs.org) 18 or newer** (check with `node -v`)
- A microphone and a browser with WebGL2 (Chrome, Edge, Firefox, Safari — all recent versions work)

## Run it

```bash
git clone https://github.com/leomelki/party-visuals.git
cd party-visuals
npm install
npm run dev
```

Open the URL it prints (usually **http://localhost:5173**), click **START**, and
**allow microphone access** when the browser asks.

Then press **`F`** for fullscreen and turn up the music. 🎉

## Tips

- **Best signal:** point the mic at the speakers, or — for a crystal-clear feed —
  capture your computer's audio output with a loopback/aggregate device
  (e.g. [BlackHole](https://existential.audio/blackhole/) on macOS, or "Stereo Mix"
  on Windows) and select it as the input.
- **Nothing reacting?** Make sure music is actually playing and the mic isn't muted.
  Nudge the **Sensitivity** slider up in the panel.
- **Keyboard:** `Space`/`→` next scene · `1`–`9` pick a scene · `F` fullscreen ·
  `S` strobe · `A` auto-rotate scenes · `H` hide the panel.

⚠️ **Photosensitivity warning:** this app produces rapid flashing and strobe
effects. Turn the strobe off (`S`) if anyone present is sensitive to flashing lights.

## Build for production

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

The `dist/` folder is a static bundle you can host anywhere (it must be served over
HTTPS or localhost, since microphone access requires a secure context).

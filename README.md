# Attune

Attune is a Chrome extension for leveling playback volume in the browser so
speech stays audible and sudden loud spikes are less jarring.

The project is aimed at a very practical problem: web audio is inconsistent
across sites, players, and content types. Some videos are too quiet, others
jump in volume, and spoken content often gets lost in the mix. Attune injects a
client-side Web Audio processing chain into supported pages and applies a more
stable listening profile.

## What It Does

Attune works on pages with standard media elements and gives the user:

- a global enable / disable toggle
- per-site enablement
- automatic leveling
- optional vocal enhancement
- lightweight pro-unlock flow

The extension is intentionally permission-aware. Site access is requested per
origin when needed instead of being treated as an always-on blanket permission.

## How It Works

The extension is built around three pieces:

- `src/background.js`
  - stores global and per-origin state
  - reinjects the content script when enabled tabs load
  - handles runtime messages and activation
- `src/content/contentScript.js`
  - finds supported media elements
  - creates and manages the Web Audio processing graph
  - responds to enable/disable and status messages
- `src/popup/`
  - user controls for global toggle, site toggle, vocal enhancement, and pro UX

The popup reflects real runtime state by pinging the current tab and showing
whether Attune is actively processing media or simply armed and waiting for
playback.

## Permission Model

Attune uses:

- `storage`
- `activeTab`
- `scripting`
- optional host permissions for the current site

That keeps the default install surface smaller than an extension that asks for
blanket host access up front.

## Privacy

Attune processes audio locally in the browser.

The extension does not need to upload page audio for its core leveling behavior.
There is a production-facing external connection path for activation / pro flow,
but the core audio processing logic is local to the page.

See [PRIVACY.md](./PRIVACY.md) for the current privacy note.

## Installation

Load it unpacked in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `browser-extension-js-attune`

There is no separate build step in the current repo layout.

## Usage

1. Open a page with audio or video playback.
2. Click the Attune extension icon.
3. Toggle **This site** on.
4. Grant site access when Chrome asks for permission.
5. Optionally enable vocal enhancement.

If Attune is already active on a supported page, the popup will show a runtime
status including the number of processed media elements and AudioContext state.

## Current Constraints

Attune works best when a site uses standard `<audio>` or `<video>` elements.

Expected limitations:

- some custom players are hostile to Web Audio interception
- some cross-origin media setups prevent processing
- disabling a site does not fully undo an already-injected page until reload, even
  though Attune stops applying its effect

Those constraints are normal for this class of browser extension and are worth
calling out explicitly.

## Why This Repo Matters

Attune is a good example of product-minded browser engineering:

- it solves a real annoyance instead of demonstrating an API
- it handles permissions carefully
- it has a meaningful runtime architecture
- it separates the user-facing controls from the media-processing pipeline

It is stronger as a portfolio piece than a simple popup utility because there is
actual systems thinking behind the UX and the injection model.
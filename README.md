# X Dimmer — Bring Back Dim Mode 🌙

**Restores the beloved "Dim" dark theme to X/Twitter** after it was removed in February 2026.

X (formerly Twitter) removed the popular "Dim" background option, leaving only "Default" (white) and "Lights Out" (pure black). Many users preferred Dim because the navy-blue background (#15202B) was **softer on the eyes** than pure black (#000000), especially on modern OLED displays where true blacks create harsh contrast.

## What It Does

X Dimmer replaces the harsh pure-black "Lights Out" theme with the classic softer navy-blue "Dim" palette:

| Element | Lights Out (Current) | Dim (Restored) |
|---------|---------------------|----------------|
| Background | `#000000` | `#15202B` |
| Cards/Surfaces | `#16181C` | `#192734` |
| Hover States | `#1D1F23` | `#1E2732` |
| Borders | `#2F3336` | `#38444D` |

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `x-dimmer` folder
5. Visit [x.com](https://x.com) — the dim theme is applied automatically!

## Usage

- Click the **X Dimmer** icon in your Chrome toolbar to open the popup
- Use the **toggle switch** to enable/disable dim mode
- Changes apply instantly to all open X/Twitter tabs — no reload needed

## How It Works

- **CSS Overrides**: Comprehensive stylesheet that maps Lights Out colors to Dim equivalents using `!important` rules
- **MutationObserver**: Watches for dynamically-added elements (X is a React SPA) and corrects their inline styles
- **Chrome Storage API**: Persists your preference and syncs across all open tabs
- **Manifest V3**: Built on the latest Chrome extension platform for security and performance

## Project Structure

```
x-dimmer/
├── manifest.json                              # Chrome Extension Manifest V3
├── background/
│   └── service-worker-background.js           # Badge management, install handler
├── content/
│   ├── content-script-dim-theme-injector.js   # Theme injection logic + MutationObserver
│   └── dim-theme-override-styles.css          # Comprehensive color overrides (16 layers)
├── popup/
│   ├── popup.html                             # Extension popup UI
│   ├── popup.css                              # X-style dark themed popup design
│   └── popup.js                               # Toggle logic + chrome.storage sync
├── icons/
│   ├── icon-16.png                            # Toolbar icon
│   ├── icon-48.png                            # Extension management page icon
│   └── icon-128.png                           # Web Store icon
└── scripts/
    └── generate-extension-icons.py            # Icon generation script (Pillow)
```

## Permissions

- **storage**: Save your dim mode on/off preference
- **activeTab**: Apply theme to the current X/Twitter tab
- **Host permissions**: Only runs on `x.com` and `twitter.com` domains

## License

MIT

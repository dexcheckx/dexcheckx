# DexCheckX

A browser extension that monitors crypto tokens to show whether they have paid for DexScreener advertising.

## What it does

DexCheckX automatically detects tokens on supported trading platforms and checks if they have active advertising on DexScreener. This helps traders identify promoted tokens at a glance.

The extension displays a small floating indicator that shows:
- **PAID** - Token has active DexScreener advertising
- **UNPAID** - No advertising detected
- **PROCESSING** - Advertising payment being processed
- **READY** - Extension is active, waiting to detect tokens
- **INDEXING** - Waiting for new token pairs to be indexed

## Supported platforms

- DexScreener.com
- Pump.fun
- Axiom.trade
- Jupiter.ag

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the `dexcheckx` folder
5. The extension icon will appear in your browser toolbar

## Usage

The extension works automatically when you visit supported platforms. Click the extension icon in your toolbar to access settings:

**Extension Settings:**
- Toggle the extension on/off
- Show or hide the floating indicator
- Adjust monitoring frequency (1-60 seconds)
- Set indexing check intervals for new tokens (5-120 seconds)

**Indicator Controls:**
- Drag the floating indicator to reposition it anywhere on the page
- Click the indicator to manually refresh the status
- Use the "Reset Position" button to return it to the default location

## Privacy

This extension only communicates with DexScreener's public API to check advertising status. No personal data is collected or transmitted.

## Technical details

- Manifest V3 compatible
- Uses Chrome storage for settings synchronization
- Real-time monitoring with configurable intervals
- Supports single-page applications with navigation detection

## License

This project is provided as-is for educational and informational purposes.
# DFW Tee Times — Cookie Exporter

Chrome extension that exports cookies for a domain as JSON, ready to paste
into the vault.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this `extension/` folder

## Use

1. Log in to the provider (GolfNow, TeeOff, etc.) in the browser
2. Click the extension icon
3. Adjust the domain if needed (e.g. `.golfnow.com`, `.teeoff.com`)
4. Click "Copy cookies as JSON" — the JSON is on your clipboard
5. In the DFW Tee Times app, paste into the vault's "Add cookies" form

## Supported domains

Edit `manifest.json` `host_permissions` to add more providers.

## Security

- The extension does not transmit cookies anywhere — it copies to clipboard
- Clipboard contents are stored only locally until pasted into the vault
- The vault encrypts with AES-GCM before persisting
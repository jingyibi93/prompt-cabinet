# Prompt Cabinet Launch Kit

This folder contains a standalone static marketing site and a coordinated social launch kit. It has no runtime dependencies and does not change the Electron application.

## Preview the landing page

From the project root:

```bash
npm run marketing:dev
```

Then open `http://127.0.0.1:4189`.

## Deploy

Deploy `marketing-site/` as a static directory on Vercel, Netlify, GitHub Pages, or any equivalent static host. Before launch, replace `promptcabinet.app` in the social artwork if the final domain is different.

The primary download buttons currently point to:

```text
Mac: https://github.com/jingyibi93/prompt-cabinet/releases/download/v0.1.0-beta.4/Prompt-Cabinet-0.1.0-beta.4-mac-arm64.dmg
Windows: https://github.com/jingyibi93/prompt-cabinet/releases/download/v0.1.0-beta.4/Prompt-Cabinet-0.1.0-beta.4-win-x64-setup.exe
```

## Promotional artwork

Source: `social/index.html`

- `?format=landscape` — 1200 × 630 launch / Open Graph cover
- `?format=square` — 1080 × 1080 social post
- `?format=portrait` — 1080 × 1350 portrait feature poster

Rendered PNG exports live in `social/exports/`.

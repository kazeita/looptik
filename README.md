# LoopTik

LoopTik is a self-hosted shuffle player for TikTok Favorites. Paste a TikTok Favorites page export, and the app extracts video URLs, thumbnails, and titles into a shared loop.

## Features

- Parses TikTok Favorites HTML in the browser.
- Plays a shuffled TikTok embed queue with sound after the user presses Play.
- Stores the most recently imported library on the server, so it is shared between browsers and persists across sessions.
- Includes a bundled seed library for a ready-to-preview first launch.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:4173`.

## Deployment

This is a Node.js app, not a static-only site: the server persists the shared video library at `data/library.json`. Deploy it to a host that supports a persistent writable disk/volume, then run `npm run build` followed by `npm start`.

For containers or ephemeral hosts, mount persistent storage at the app's `data/` directory. Without it, the shared library resets when the service restarts.

## Privacy

Anyone who can access the deployed app can replace and view its shared library. Do not deploy it publicly with personal Favorites data unless you add authentication.

The runtime library at `data/library.json` is ignored by Git. The included `seed.html` is bundled into the app; review or replace it before publishing if it contains personal data.

## License

MIT. TikTok is a trademark of ByteDance Ltd. This project is not affiliated with TikTok.

# LoopTik

LoopTik is a self-hosted shuffle player for TikTok Favorites. Paste a TikTok Favorites page export, and the app extracts video URLs, thumbnails, and titles into a shared loop.

## Features

- Parses TikTok Favorites HTML in the browser.
- Appends individual TikTok video URLs to an existing library, with duplicate video IDs removed automatically.
- Plays a shuffled TikTok embed queue with sound after the user presses Play.
- Stores the most recently imported library in the browser, so it persists across refreshes without requiring a database.
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

LoopTik is a static Vite app and can be deployed directly to Vercel. Each visitor’s imported Favorites are stored only in their own browser with `localStorage`.

`server.js` remains in the repository for a future self-hosted/shared-library deployment. It is not required for Vercel.

## Privacy

Imports never leave the visitor’s browser. The included `seed.html` is bundled into the app; review or replace it before publishing if it contains personal data.

## License

MIT. TikTok is a trademark of ByteDance Ltd. This project is not affiliated with TikTok.

import { useEffect, useMemo, useState } from 'react';
import seedHtml from '../seed.html?raw';

const sample = `<a href="https://www.tiktok.com/@zackdfilms92/video/7668383288989338894"><img alt="Could A Giant Magnet Move An Asteroid? 🤯 created by Zack D. Films" src="https://p16-common-sign.tiktokcdn.com/tos-useast5-p-85c255-tx/oU5A4NidI8zYFrpgYojfkwwEBPCniBAHPAY1cI~tplv-tiktokx-origin.image?dr=14575" /></a>`;

function parseFavorites(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set();
  const items = [...doc.querySelectorAll('a[href*="/video/"]')]
    .map((anchor) => {
      const href = anchor.getAttribute('href') || '';
      const url = new URL(href, 'https://www.tiktok.com').href;
      const id = url.match(/\/video\/(\d+)/)?.[1];
      if (!id || seen.has(id)) return null;
      seen.add(id);
      const image = anchor.querySelector('img');
      const alt = image?.getAttribute('alt') || '';
      const title = alt.split(/\s+created by\s+/i)[0] || `TikTok video ${id}`;
      const background = anchor.getAttribute('style')?.match(/background-image:\s*url\(&quot;([^&]+)/)?.[1] || '';
      return { id, url: url.split('?')[0], thumbnail: image?.currentSrc || image?.src || background, title };
    })
    .filter(Boolean);

  // TikTok's saved page may include a large pre-rendered grid which is not
  // retained as normal DOM anchors by every browser parser. Read URL strings
  // from the original source as well, then merge them without duplicates.
  const urlPattern = /https?:\/\/www\.tiktok\.com\/[^"'<>\s]*\/video\/(\d+)/g;
  for (const match of html.matchAll(urlPattern)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, url: match[0].split('?')[0], thumbnail: '', title: `TikTok video ${id}` });
  }
  return items;
}

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export default function App() {
  const [html, setHtml] = useState('');
  const [videos, setVideos] = useState(() => parseFavorites(seedHtml));
  const [queue, setQueue] = useState(() => shuffle(parseFavorites(seedHtml)));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');

  const active = queue[current];
  const remaining = useMemo(() => queue.length ? queue.length - current - 1 : 0, [queue, current]);

  useEffect(() => {
    if (!playing || !queue.length) return undefined;
    const timer = window.setTimeout(() => setCurrent((i) => (i + 1) % queue.length), 30000);
    return () => window.clearTimeout(timer);
  }, [playing, current, queue.length]);

  useEffect(() => {
    fetch('/api/library')
      .then((response) => response.ok ? response.json() : [])
      .then((sharedVideos) => {
        if (Array.isArray(sharedVideos) && sharedVideos.length) {
          setVideos(sharedVideos); setQueue(shuffle(sharedVideos)); setCurrent(0);
        }
      })
      .catch(() => setError('The shared library server is unavailable. Showing the bundled seed instead.'));
  }, []);

  const importHtml = async () => {
    const items = parseFavorites(html);
    if (!items.length) {
      setError('No TikTok video links found. Paste the Favorites page HTML, including the <a href=".../video/..."> cards.');
      return;
    }
    try {
      const response = await fetch('/api/library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videos: items }) });
      if (!response.ok) throw new Error();
      setVideos(items); setQueue(shuffle(items)); setCurrent(0); setPlaying(false); setError(''); setShowImport(false);
    } catch {
      setError('Could not save to the shared library server. Start the app with npm run build, then npm start.');
    }
  };
  const restart = () => { setQueue(shuffle(videos)); setCurrent(0); setPlaying(true); };
  const skip = () => setCurrent((i) => (i + 1) % queue.length);

  return <main>
    <header><a className="brand" href="/">LOOP<span>TIK</span></a><div className="header-note"><i /> Favorites, on repeat</div></header>
    <section className="player-shell">
      <aside>
        <div className="eyebrow">NOW PLAYING</div>
        <h2>{active?.title}</h2>
        <a href={active?.url} target="_blank" rel="noreferrer">Open on TikTok ↗</a>
        <div className="controls"><button onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'} <span>{playing ? 'Pause loop' : 'Play with sound'}</span></button><button onClick={skip}>Skip →</button></div>
        <div className="queue-meta"><b>{current + 1}</b> / {queue.length} in this shuffle <span>{remaining} next</span></div>
        <button className="restart" onClick={restart}>↻ Reshuffle all {videos.length} videos</button>
      </aside>
      <div className="stage">
        <div className="phone"><iframe key={`${active?.id}-${playing}`} title={active?.title} src={`https://www.tiktok.com/player/v1/${active?.id}?autoplay=${playing ? '1' : '0'}&loop=0&controls=1&music_info=1&volume=1&muted=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
        <p>{playing ? 'Advances every 30 seconds · Sound on' : 'Press play to start with sound'} · Playback is powered by TikTok</p>
      </div>
      <aside className="up-next"><div className="eyebrow">UP NEXT</div>{queue.slice(current + 1, current + 5).map((video, index) => <button key={video.id} onClick={() => setCurrent(current + index + 1)}><img src={video.thumbnail} alt="" /><span><small>0{index + 1}</small>{video.title}</span></button>)}</aside>
    </section>
    <section className="library">
      <div><div className="eyebrow">SHARED LIBRARY</div><h3>{videos.length} saved videos in rotation</h3><p>No account or upload needed. Imports are stored on this server and shared across browsers.</p></div>
      <button className="library-button" onClick={() => setShowImport(!showImport)}>{showImport ? 'Close importer' : 'Replace favorites HTML →'}</button>
      {showImport && <div className="paste-card import-panel">
        <div className="paste-head"><span>Replace your Favorites library</span><button className="sample" onClick={() => setHtml(sample)}>Use example</button></div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={'Paste the copied TikTok Favorites HTML here...'} spellCheck="false" />
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={importHtml}>Save and rebuild loop <b>→</b></button>
      </div>}
    </section>
    <footer><span>Made for your saved moments.</span><span>No account, no upload — parsing happens in your browser.</span></footer>
  </main>;
}

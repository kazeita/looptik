import { useEffect, useMemo, useRef, useState } from 'react';
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
  const jsonStrings = [];
  try {
    const collectStrings = (value) => {
      if (typeof value === 'string') jsonStrings.push(value);
      else if (Array.isArray(value)) value.forEach(collectStrings);
      else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
    };
    collectStrings(JSON.parse(html));
  } catch { /* The input is HTML or a plain URL list. */ }
  const urlPattern = /https?:\/\/(?:www\.)?tiktok(?:v)?\.com\/[^"'<>\s]*\/video\/(\d+)/g;
  for (const source of [html, ...jsonStrings]) {
    for (const match of source.matchAll(urlPattern)) {
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ id, url: match[0].split('?')[0], thumbnail: '', title: `TikTok video ${id}` });
    }
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
  const [videos, setVideos] = useState(() => {
    try {
      const saved = localStorage.getItem('looptik-library');
      if (saved) return JSON.parse(saved);
    } catch { /* fall back to the bundled seed */ }
    return parseFavorites(seedHtml);
  });
  const [queue, setQueue] = useState(() => {
    try {
      const saved = localStorage.getItem('looptik-library');
      return shuffle(saved ? JSON.parse(saved) : parseFavorites(seedHtml));
    } catch { return shuffle(parseFavorites(seedHtml)); }
  });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [libraryMode, setLibraryMode] = useState('replace');
  const [error, setError] = useState('');
  const playerRef = useRef(null);

  const active = queue[current];
  const remaining = useMemo(() => queue.length ? queue.length - current - 1 : 0, [queue, current]);

  useEffect(() => {
    if (!playing || !queue.length) return undefined;
    const timer = window.setTimeout(() => setCurrent((i) => (i + 1) % queue.length), 90000);
    return () => window.clearTimeout(timer);
  }, [playing, current, queue.length]);

  useEffect(() => {
    const send = (type) => playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, 'https://www.tiktok.com');
    const onMessage = (event) => {
      if (event.origin !== 'https://www.tiktok.com') return;
      const message = event.data;
      if (!message || message['x-tiktok-player'] !== true) return;
      if (message.type === 'onPlayerReady' && playing) { send('unMute'); send('play'); }
      if (message.type === 'onStateChange') {
        if (message.value === 0) setCurrent((i) => (i + 1) % queue.length);
        if (message.value === 1) setPlaying(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [playing, queue.length]);

  const importHtml = () => {
    const items = parseFavorites(html);
    if (!items.length) {
      setError('No TikTok video links found. Paste the Favorites page HTML, including the <a href=".../video/..."> cards.');
      return;
    }
    setVideos(items); setQueue(shuffle(items)); setCurrent(0); setPlaying(false); setError(''); setShowImport(false);
    localStorage.setItem('looptik-library', JSON.stringify(items));
  };
  const appendUrls = () => {
    const items = parseFavorites(html);
    if (!items.length) {
      setError('No TikTok video URLs found. Paste full links such as https://www.tiktok.com/@creator/video/123…');
      return;
    }
    const merged = [...videos];
    const knownIds = new Set(videos.map((video) => video.id));
    items.forEach((video) => {
      if (!knownIds.has(video.id)) { knownIds.add(video.id); merged.push(video); }
    });
    setVideos(merged); setQueue(shuffle(merged)); setCurrent(0); setError(''); setHtml('');
    localStorage.setItem('looptik-library', JSON.stringify(merged));
  };
  const restart = () => { setQueue(shuffle(videos)); setCurrent(0); setPlaying(true); };
  const skip = () => setCurrent((i) => (i + 1) % queue.length);
  const togglePlayback = () => {
    const type = playing ? 'pause' : 'play';
    playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, 'https://www.tiktok.com');
    if (!playing) playerRef.current?.contentWindow?.postMessage({ type: 'unMute', 'x-tiktok-player': true }, 'https://www.tiktok.com');
    setPlaying(!playing);
  };

  return <main>
    <header><a className="brand" href="/">LOOP<span>TIK</span></a><div className="header-note"><i /> Favorites, on repeat</div></header>
    <section className="player-shell">
      <aside>
        <div className="eyebrow">NOW PLAYING</div>
        <h2>{active?.title}</h2>
        <a href={active?.url} target="_blank" rel="noreferrer">Open on TikTok ↗</a>
        <div className="controls"><button onClick={togglePlayback}>{playing ? '❚❚' : '▶'} <span>{playing ? 'Pause loop' : 'Play with sound'}</span></button><button onClick={skip}>Skip →</button></div>
        <div className="queue-meta"><b>{current + 1}</b> / {queue.length} in this shuffle <span>{remaining} next</span></div>
        <button className="restart" onClick={restart}>↻ Reshuffle all {videos.length} videos</button>
      </aside>
      <div className="stage">
        <div className="phone"><iframe ref={playerRef} key={active?.id} title={active?.title} src={`https://www.tiktok.com/player/v1/${active?.id}?autoplay=0&loop=0&controls=1&music_info=1&volume=1&muted=0&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
        <p>{playing ? 'Advances when the video ends · Sound on' : 'Press play to start with sound'} · Playback is powered by TikTok</p>
      </div>
      <aside className="up-next"><div className="eyebrow">UP NEXT</div>{queue.slice(current + 1, current + 5).map((video, index) => <button key={video.id} onClick={() => setCurrent(current + index + 1)}><img src={video.thumbnail} alt="" /><span><small>0{index + 1}</small>{video.title}</span></button>)}</aside>
    </section>
    <section className="library">
      <div><div className="eyebrow">YOUR LIBRARY</div><h3>{videos.length} saved videos in rotation</h3><p>No account or upload needed. Imports stay in this browser after a refresh.</p></div>
      <div className="library-actions"><button className="library-button" onClick={() => { setLibraryMode('append'); setShowImport(true); }}>Add video URLs +</button><button className="library-button" onClick={() => { setLibraryMode('json'); setShowImport(true); }}>Add JSON +</button><button className="library-button" onClick={() => { setLibraryMode('replace'); setShowImport(true); }}>Replace Favorites HTML →</button></div>
      {showImport && <div className="paste-card import-panel">
        <div className="paste-head"><span>{libraryMode === 'append' ? 'Add TikTok video URLs to your library' : libraryMode === 'json' ? 'Add TikTok videos from JSON' : 'Replace your Favorites library'}</span><button className="sample" onClick={() => setHtml(sample)}>Use example</button></div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={libraryMode === 'append' ? 'Paste one or more full TikTok video URLs here, one per line...' : libraryMode === 'json' ? 'Paste JSON containing TikTok video URLs here...' : 'Paste the copied TikTok Favorites HTML here...'} spellCheck="false" />
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={libraryMode === 'replace' ? importHtml : appendUrls}>{libraryMode === 'replace' ? 'Save and rebuild loop' : 'Add unique videos'} <b>→</b></button>
      </div>}
    </section>
    <footer><span>Made for your saved moments.</span><span>No account, no upload — parsing happens in your browser.</span></footer>
  </main>;
}

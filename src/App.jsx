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
  const [page, setPage] = useState(() => window.location.hash === '#import' ? 'import' : 'player');
  const playerRef = useRef(null);
  const audioPrefsRef = useRef({ volume: Number(localStorage.getItem('looptik-volume') || 100), muted: localStorage.getItem('looptik-muted') === 'true' });
  const swipeStartRef = useRef(null);
  const didSwipeRef = useRef(false);

  const active = queue[current];
  const remaining = useMemo(() => queue.length ? queue.length - current - 1 : 0, [queue, current]);
  const playerSrc = useMemo(() => {
    const { volume: savedVolume, muted: savedMuted } = audioPrefsRef.current;
    return `https://www.tiktok.com/player/v1/${active?.id}?autoplay=${playing ? '1' : '0'}&loop=0&controls=1&music_info=1&volume=${savedVolume}&muted=${savedMuted ? '1' : '0'}&rel=0`;
  }, [active?.id]);
  const goTo = (nextPage) => { window.location.hash = nextPage === 'import' ? 'import' : ''; setPage(nextPage); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  useEffect(() => {
    if (!playing || !queue.length) return undefined;
    const timer = window.setTimeout(() => setCurrent((i) => (i + 1) % queue.length), 90000);
    return () => window.clearTimeout(timer);
  }, [playing, current, queue.length]);

  useEffect(() => {
    const send = (type) => playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, '*');
    const onMessage = (event) => {
      if (!event.origin.endsWith('.tiktok.com')) return;
      const message = event.data;
      if (!message || message['x-tiktok-player'] !== true) return;
      if (message.type === 'onPlayerReady') { send(audioPrefsRef.current.muted ? 'mute' : 'unMute'); if (playing) send('play'); }
      if (message.type === 'onStateChange') {
        if (message.value === 0) setCurrent((i) => (i + 1) % queue.length);
        if (message.value === 1) setPlaying(true);
      }
      if (message.type === 'onMute') { audioPrefsRef.current.muted = message.value; localStorage.setItem('looptik-muted', String(message.value)); }
      if (message.type === 'onVolumeChange') { audioPrefsRef.current.volume = message.value; localStorage.setItem('looptik-volume', String(message.value)); }
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
    setVideos(items); setQueue(shuffle(items)); setCurrent(0); setPlaying(false); setError(''); setShowImport(false); goTo('player');
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
  const nextVideo = () => { setCurrent((i) => (i + 1) % queue.length); setPlaying(true); };
  const previousVideo = () => { setCurrent((i) => (i - 1 + queue.length) % queue.length); setPlaying(true); };
  const playVideoAt = (index) => { setCurrent(index); setPlaying(true); };
  const togglePlayback = () => {
    const type = playing ? 'pause' : 'play';
    playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, '*');
    if (!playing && !audioPrefsRef.current.muted) playerRef.current?.contentWindow?.postMessage({ type: 'unMute', 'x-tiktok-player': true }, '*');
    setPlaying(!playing);
  };
  const beginSwipe = (event) => { swipeStartRef.current = event.touches[0]?.clientX ?? null; };
  const finishSwipe = (event) => {
    const end = event.changedTouches[0]?.clientX;
    if (swipeStartRef.current === null || end === undefined) return;
    const distance = end - swipeStartRef.current;
    swipeStartRef.current = null;
    if (Math.abs(distance) < 28) return;
    didSwipeRef.current = true;
    if (distance < 0) nextVideo(); else previousVideo();
  };
  const mobileNext = () => { if (didSwipeRef.current) { didSwipeRef.current = false; return; } nextVideo(); };
  const mobilePrevious = () => { if (didSwipeRef.current) { didSwipeRef.current = false; return; } previousVideo(); };

  return <main>
    <header><a className="brand" href="#" onClick={() => goTo('player')}>LOOP<span>TIK</span></a><div className="header-note"><i /> Favorites, on repeat</div><button className="header-link" onClick={() => goTo(page === 'player' ? 'import' : 'player')}>{page === 'player' ? 'Import favorites' : 'Back to player'}</button></header>
    {page === 'import' ? <section className="import-shell">
      <div className="eyebrow">YOUR PERSONAL ROTATION</div>
      <h1>Turn saved TikToks<br />into a <em>loop.</em></h1>
      <p className="intro">Paste your TikTok Favorites page HTML and we’ll build a private, endlessly shuffled queue from the videos you already love.</p>
      <div className="paste-card">
        <div className="paste-head"><span>Paste Favorites HTML</span><button className="sample" onClick={() => setHtml(sample)}>Use example</button></div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={'Paste the copied HTML here...\n\nTip: In TikTok Favorites, select the video grid and copy it.'} spellCheck="false" />
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={importHtml}>Build my loop <b>→</b></button>
      </div>
      <div className="steps"><span><b>01</b> Copy Favorites page</span><span><b>02</b> Paste HTML</span><span><b>03</b> Press play</span></div>
    </section> : <>
    <section className="player-shell">
      <aside>
        <div className="eyebrow">NOW PLAYING</div>
        <h2>{active?.title}</h2>
        <a href={active?.url} target="_blank" rel="noreferrer">Open on TikTok ↗</a>
        <div className="controls"><button onClick={previousVideo}>← <span>Previous</span></button><button onClick={togglePlayback}>{playing ? '❚❚' : '▶'} <span>{playing ? 'Pause' : 'Play with sound'}</span></button><button onClick={nextVideo}><span>Next</span> →</button></div>
        <div className="queue-meta"><b>{current + 1}</b> / {queue.length} in this shuffle <span>{remaining} next</span></div>
        <button className="restart" onClick={restart}>↻ Reshuffle all {videos.length} videos</button>
      </aside>
      <div className="stage">
        <div className="mobile-player-wrap"><button className="mobile-chevron previous-chevron" aria-label="Previous video" onClick={mobilePrevious} onTouchStart={beginSwipe} onTouchEnd={finishSwipe}>‹</button><div className="phone"><iframe ref={playerRef} key={active?.id} title={active?.title} src={playerSrc} onLoad={() => { if (playing) { playerRef.current?.contentWindow?.postMessage({ type: audioPrefsRef.current.muted ? 'mute' : 'unMute', 'x-tiktok-player': true }, '*'); playerRef.current?.contentWindow?.postMessage({ type: 'play', 'x-tiktok-player': true }, '*'); } }} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div><button className="mobile-chevron next-chevron" aria-label="Next video" onClick={mobileNext} onTouchStart={beginSwipe} onTouchEnd={finishSwipe}>›</button></div>
        <p>{playing ? 'Advances when the video ends · Sound on' : 'Press play to start with sound'} · Playback is powered by TikTok</p>
      </div>
      <aside className="up-next"><div className="eyebrow">UP NEXT</div>{queue.slice(current + 1, current + 5).map((video, index) => <button key={video.id} onClick={() => playVideoAt(current + index + 1)}><img src={video.thumbnail} alt="" /><span><small>0{index + 1}</small>{video.title}</span></button>)}</aside>
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
    </>}
    <footer><span>Made for your saved moments.</span><span>No account, no upload — parsing happens in your browser.</span></footer>
  </main>;
}

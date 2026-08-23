import { useEffect, useMemo, useRef, useState } from 'react';
import seedData from './seed.json';

const tiktokSample = `<a href="https://www.tiktok.com/@zackdfilms92/video/7668383288989338894"><img alt="Could A Giant Magnet Move An Asteroid? 🤯 created by Zack D. Films" src="https://p16-common-sign.tiktokcdn.com/tos-useast5-p-85c255-tx/oU5A4NidI8zYFrpgYojfkwwEBPCniBAHPAY1cI~tplv-tiktokx-origin.image?dr=14575" /></a>`;
const youtubeSample = `<a href="https://www.youtube.com/watch?v=aqz-KE-bpKQ"><img alt="Big Buck Bunny" src="https://img.youtube.com/vi/aqz-KE-bpKQ/mqdefault.jpg" /></a>`;

// Per-platform rules for turning pasted HTML/JSON/links into a normalized video list.
const PLATFORM_PARSERS = {
  tiktok: {
    base: 'https://www.tiktok.com',
    anchorSelector: 'a[href*="/video/"]',
    urlRegex: /https?:\/\/(?:www\.)?tiktok(?:v)?\.com\/[^"'<>\s]*\/video\/(\d+)/g,
    idFromUrl: (url) => url.match(/\/video\/(\d+)/)?.[1],
    buildUrl: (id, rawUrl) => {
      try { return new URL(rawUrl, 'https://www.tiktok.com').href.split('?')[0]; } catch { return rawUrl?.split('?')[0] || ''; }
    },
    thumbnailForId: () => '',
    fallbackTitle: (id) => `TikTok video ${id}`,
    titleFromAlt: (alt) => alt.split(/\s+created by\s+/i)[0],
  },
  youtube: {
    base: 'https://www.youtube.com',
    anchorSelector: 'a[href*="watch?v="], a[href*="youtu.be/"], a[href*="/shorts/"]',
    urlRegex: /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^"'<>\s]*v=|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}[^"'<>\s]*/g,
    idFromUrl: (url) => url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1],
    buildUrl: (id) => `https://www.youtube.com/watch?v=${id}`,
    thumbnailForId: (id) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    fallbackTitle: (id) => `YouTube video ${id}`,
    titleFromAlt: (alt) => alt,
  },
};

function resolveUrl(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}

function parseFavorites(platform, html) {
  const config = PLATFORM_PARSERS[platform];
  const seen = new Set();
  const items = [];

  const addItem = (id, rawUrl, title, thumbnail) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({
      id,
      url: config.buildUrl(id, rawUrl),
      thumbnail: thumbnail || config.thumbnailForId(id) || '',
      title: title && title.trim() ? title.trim() : config.fallbackTitle(id),
    });
  };

  // 1) DOM-based parsing — works when the input is real HTML (Favorites/Liked/Watch Later markup).
  const doc = new DOMParser().parseFromString(html, 'text/html');
  [...doc.querySelectorAll(config.anchorSelector)].forEach((anchor) => {
    const href = resolveUrl(anchor.getAttribute('href') || '', config.base);
    const id = config.idFromUrl(href);
    if (!id) return;
    const image = anchor.querySelector('img');
    const alt = image?.getAttribute('alt') || anchor.textContent || '';
    const title = config.titleFromAlt(alt);
    const background = anchor.getAttribute('style')?.match(/background-image:\s*url\(&quot;([^&]+)/)?.[1] || '';
    addItem(id, href, title, image?.currentSrc || image?.src || background);
  });

  // 2) JSON-object walk — keeps a title/thumbnail field that lives *alongside* a video's URL
  //    in the same object, instead of only scraping bare URL strings out of the whole blob
  //    (which is what caused every JSON import to fall back to a generic "video 12345" title).
  let parsedJson;
  try { parsedJson = JSON.parse(html); } catch { parsedJson = null; }
  if (parsedJson) {
    const TITLE_KEYS = ['title', 'name', 'caption', 'desc', 'description', 'alt', 'text'];
    const URL_KEYS = ['url', 'href', 'link', 'videoUrl', 'video_url', 'permalink'];
    const THUMB_KEYS = ['thumbnail', 'thumb', 'image', 'cover', 'thumbnailUrl', 'thumbnail_url'];

    const findUrlString = (value) => {
      if (typeof value !== 'string') return null;
      const match = value.match(config.urlRegex);
      return match ? match[0] : null;
    };

    const visit = (value) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;

      // Does this object represent a single video record? Check the likely URL fields first,
      // then fall back to scanning every string field so odd shapes still work.
      let recordUrl = null;
      for (const key of URL_KEYS) {
        const found = findUrlString(value[key]);
        if (found) { recordUrl = found; break; }
      }
      if (!recordUrl) {
        for (const val of Object.values(value)) {
          const found = findUrlString(val);
          if (found) { recordUrl = found; break; }
        }
      }

      if (recordUrl) {
        const id = config.idFromUrl(recordUrl);
        let title = null;
        for (const key of TITLE_KEYS) {
          if (typeof value[key] === 'string' && value[key].trim()) { title = value[key]; break; }
        }
        let thumbnail = null;
        for (const key of THUMB_KEYS) {
          if (typeof value[key] === 'string' && value[key].trim()) { thumbnail = value[key]; break; }
        }
        addItem(id, recordUrl, title, thumbnail);
      }

      Object.values(value).forEach(visit);
    };

    visit(parsedJson);
  }

  // 3) Bare-URL sweep — catches plain link lists (one URL per line) or anything steps 1–2 missed.
  for (const match of html.matchAll(config.urlRegex)) {
    const id = config.idFromUrl(match[0]);
    addItem(id, match[0]);
  }

  return items;
}

// seed.json can either be a flat array (treated as TikTok's default library, matching the
// old seed.html behavior) or an object keyed by platform, e.g. { tiktok: [...], youtube: [...] }.
// Re-uses the same HTML/JSON/URL parsing rules as manual imports, so any shape that already
// works when pasted (objects with url/title fields, bare links, etc.) works here too.
function seedItemsFor(platform) {
  if (!seedData) return [];
  const bucket = Array.isArray(seedData) ? (platform === 'tiktok' ? seedData : []) : seedData[platform];
  if (!bucket || !bucket.length) return [];
  try { return parseFavorites(platform, JSON.stringify(bucket)); } catch { return []; }
}

const PLATFORMS = {
  tiktok: {
    label: 'TikTok',
    sourceLabel: 'Favorites page',
    sample: tiktokSample,
    pastePlaceholder: 'Paste the copied HTML here...\n\nTip: In TikTok Favorites, select the video grid and copy it.',
    urlPlaceholder: 'Paste one or more full TikTok video URLs here, one per line...',
    jsonPlaceholder: 'Paste JSON containing TikTok video URLs here...',
    emptyImportError: 'No TikTok video links found. Paste the Favorites page HTML, including the <a href=".../video/..."> cards.',
    emptyAppendError: 'No TikTok video URLs found. Paste full links such as https://www.tiktok.com/@creator/video/123…',
    parse: (input) => parseFavorites('tiktok', input),
  },
  youtube: {
    label: 'YouTube',
    sourceLabel: 'Liked/Watch Later',
    sample: youtubeSample,
    pastePlaceholder: 'Paste the copied HTML here...\n\nTip: On YouTube, open Liked Videos or Watch Later, select the video list and copy it.',
    urlPlaceholder: 'Paste one or more full YouTube video URLs here, one per line...',
    jsonPlaceholder: 'Paste JSON containing YouTube video URLs here...',
    emptyImportError: 'No YouTube video links found. Paste the Liked Videos or Watch Later page HTML, including the video links.',
    emptyAppendError: 'No YouTube video URLs found. Paste full links such as https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    parse: (input) => parseFavorites('youtube', input),
  },
};

function shuffle(list) {
  const next = [...list];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function readStoredLibrary(storageKey, legacyKey, seedItems) {
  try {
    const saved = localStorage.getItem(storageKey) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    if (saved) return JSON.parse(saved);
  } catch { /* fall back to seed */ }
  return typeof seedItems === 'function' ? seedItems() : seedItems;
}

// Holds one platform's videos/queue/playback-position independently, so switching the
// tab never disturbs the other platform's library or where it was left off.
function usePlatformLibrary(storageKey, seedItems, legacyKey) {
  const [videos, setVideos] = useState(() => readStoredLibrary(storageKey, legacyKey, seedItems));
  const [queue, setQueue] = useState(() => shuffle(readStoredLibrary(storageKey, legacyKey, seedItems)));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  const persist = (items) => {
    setVideos(items); setQueue(shuffle(items)); setCurrent(0);
    localStorage.setItem(storageKey, JSON.stringify(items));
  };
  const append = (items) => {
    const knownIds = new Set(videos.map((video) => video.id));
    const merged = [...videos];
    items.forEach((video) => { if (!knownIds.has(video.id)) { knownIds.add(video.id); merged.push(video); } });
    setVideos(merged); setQueue(shuffle(merged)); setCurrent(0);
    localStorage.setItem(storageKey, JSON.stringify(merged));
    return merged;
  };
  const restart = () => { setQueue(shuffle(videos)); setCurrent(0); setPlaying(true); };
  const nextVideo = () => { setCurrent((i) => (i + 1) % queue.length); setPlaying(true); };
  const previousVideo = () => { setCurrent((i) => (i - 1 + queue.length) % queue.length); setPlaying(true); };
  const playVideoAt = (index) => { setCurrent(index); setPlaying(true); };

  return { videos, queue, current, playing, setPlaying, setCurrent, persist, append, restart, nextVideo, previousVideo, playVideoAt };
}

function TikTokPlayer({ active, playing, setPlaying, setCurrent, queueLength, audioPrefsRef, setMuted, controlsRef }) {
  const playerRef = useRef(null);
  const playerSrc = useMemo(() => {
    const { volume, muted } = audioPrefsRef.current;
    return `https://www.tiktok.com/player/v1/${active?.id}?autoplay=${playing ? '1' : '0'}&loop=0&controls=1&music_info=1&volume=${volume}&muted=${muted ? '1' : '0'}&rel=0`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!event.origin.endsWith('.tiktok.com')) return;
      const message = event.data;
      if (!message || message['x-tiktok-player'] !== true) return;
      const send = (type) => playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, '*');
      if (message.type === 'onPlayerReady') { send(audioPrefsRef.current.muted ? 'mute' : 'unMute'); if (playing) send('play'); }
      if (message.type === 'onStateChange') {
        if (message.value === 0) setCurrent((i) => (i + 1) % queueLength);
        if (message.value === 1) setPlaying(true);
      }
      if (message.type === 'onMute') { setMuted(message.value); }
      if (message.type === 'onVolumeChange') { audioPrefsRef.current.volume = message.value; localStorage.setItem('looptik-volume', String(message.value)); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [playing, queueLength, setCurrent, setPlaying, setMuted, audioPrefsRef]);

  useEffect(() => {
    controlsRef.current.togglePlayback = () => {
      const type = playing ? 'pause' : 'play';
      playerRef.current?.contentWindow?.postMessage({ type, 'x-tiktok-player': true }, '*');
      // Re-assert whatever mute state we're supposed to be in — the embed can silently
      // force itself muted (browser autoplay policy) without telling us, so this resync
      // has to run every time playback (re)starts, not just when we're already unmuted.
      if (!playing) playerRef.current?.contentWindow?.postMessage({ type: audioPrefsRef.current.muted ? 'mute' : 'unMute', 'x-tiktok-player': true }, '*');
      setPlaying(!playing);
    };
    controlsRef.current.toggleMute = () => {
      const next = !audioPrefsRef.current.muted;
      playerRef.current?.contentWindow?.postMessage({ type: next ? 'mute' : 'unMute', 'x-tiktok-player': true }, '*');
      setMuted(next);
    };
  });

  return <iframe
    ref={playerRef}
    key={active?.id}
    title={active?.title}
    src={playerSrc}
    onLoad={() => {
      if (playing) {
        playerRef.current?.contentWindow?.postMessage({ type: audioPrefsRef.current.muted ? 'mute' : 'unMute', 'x-tiktok-player': true }, '*');
        playerRef.current?.contentWindow?.postMessage({ type: 'play', 'x-tiktok-player': true }, '*');
      }
    }}
    allow="autoplay; encrypted-media; picture-in-picture"
    allowFullScreen
  />;
}

// Lazily injects the official YouTube IFrame Player API script (once) and resolves
// when window.YT.Player is ready to use.
function useYouTubeApi() {
  const [ready, setReady] = useState(() => Boolean(window.YT?.Player));
  useEffect(() => {
    if (window.YT?.Player) { setReady(true); return undefined; }
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); setReady(true); };
    return undefined;
  }, []);
  return ready;
}

function YouTubePlayer({ active, playing, setPlaying, setCurrent, queueLength, audioPrefsRef, setMuted, controlsRef }) {
  const apiReady = useYouTubeApi();
  const containerId = useRef(`yt-player-${Math.random().toString(36).slice(2)}`).current;
  const playerInstanceRef = useRef(null);
  const pollRef = useRef(null);

  // Create the player once the API is ready. Video changes afterward are handled
  // imperatively (below) rather than by recreating the player, to avoid flicker
  // and to keep the YT-managed iframe out of React's own diffing.
  useEffect(() => {
    if (!apiReady) return undefined;
    playerInstanceRef.current = new window.YT.Player(containerId, {
      videoId: active?.id,
      playerVars: { autoplay: playing ? 1 : 0, playsinline: 1, rel: 0, mute: audioPrefsRef.current.muted ? 1 : 0 },
      events: {
        onReady: (event) => {
          event.target.setVolume(audioPrefsRef.current.volume);
          if (playing) event.target.playVideo();
          pollRef.current = window.setInterval(() => {
            try {
              const muted = event.target.isMuted();
              const volume = event.target.getVolume();
              if (muted !== audioPrefsRef.current.muted) setMuted(muted);
              if (volume !== audioPrefsRef.current.volume) { audioPrefsRef.current.volume = volume; localStorage.setItem('looptik-volume', String(volume)); }
            } catch { /* player torn down mid-poll */ }
          }, 3000);
        },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.ENDED) setCurrent((i) => (i + 1) % queueLength);
          if (event.data === window.YT.PlayerState.PLAYING) setPlaying(true);
          if (event.data === window.YT.PlayerState.PAUSED) setPlaying(false);
        },
      },
    });
    return () => {
      window.clearInterval(pollRef.current);
      playerInstanceRef.current?.destroy?.();
      playerInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady]);

  useEffect(() => {
    const player = playerInstanceRef.current;
    if (!player || !active?.id || typeof player.loadVideoById !== 'function') return;
    if (playing) player.loadVideoById(active.id); else player.cueVideoById(active.id);
  }, [active?.id]);

  useEffect(() => {
    controlsRef.current.togglePlayback = () => {
      const player = playerInstanceRef.current;
      if (!player) return;
      const state = player.getPlayerState?.();
      if (state === window.YT.PlayerState.PLAYING) { player.pauseVideo(); setPlaying(false); }
      else {
        // Re-assert whatever mute state we're supposed to be in, the same way TikTok does —
        // don't gate this behind "already unmuted", or a stuck-muted player can never recover.
        if (audioPrefsRef.current.muted) player.mute(); else player.unMute();
        player.playVideo();
        setPlaying(true);
      }
    };
    controlsRef.current.toggleMute = () => {
      const player = playerInstanceRef.current;
      if (!player) return;
      const next = !audioPrefsRef.current.muted;
      if (next) player.mute(); else player.unMute();
      setMuted(next);
    };
  });

  // Wrapped in a stable outer div: the YT API replaces #containerId with its own
  // <iframe>, and React only ever needs to remove the outer node on unmount.
  return <div className="yt-embed"><div id={containerId} /></div>;
}

export default function App() {
  const [platform, setPlatform] = useState('tiktok');
  const [html, setHtml] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [libraryMode, setLibraryMode] = useState('replace');
  const [error, setError] = useState('');
  const [page, setPage] = useState(() => window.location.hash === '#import' ? 'import' : 'player');
  const audioPrefsRef = useRef({ volume: Number(localStorage.getItem('looptik-volume') || 100), muted: localStorage.getItem('looptik-muted') === 'true' });
  const [mutedUI, setMutedUI] = useState(audioPrefsRef.current.muted);
  const setMuted = (value) => {
    audioPrefsRef.current.muted = value;
    localStorage.setItem('looptik-muted', String(value));
    setMutedUI(value);
  };
  const controlsRef = useRef({ togglePlayback: () => {}, toggleMute: () => {} });
  const swipeStartRef = useRef(null);
  const didSwipeRef = useRef(false);
  const fileInputRef = useRef(null);

  const tiktokLib = usePlatformLibrary('looptik-library-tiktok', () => seedItemsFor('tiktok'), 'looptik-library');
  const youtubeLib = usePlatformLibrary('looptik-library-youtube', () => seedItemsFor('youtube'));
  const lib = platform === 'tiktok' ? tiktokLib : youtubeLib;
  const config = PLATFORMS[platform];

  const active = lib.queue[lib.current];
  const remaining = useMemo(() => lib.queue.length ? lib.queue.length - lib.current - 1 : 0, [lib.queue, lib.current]);
  const goTo = (nextPage) => { window.location.hash = nextPage === 'import' ? 'import' : ''; setPage(nextPage); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  useEffect(() => {
    if (!lib.playing || !lib.queue.length) return undefined;
    const timer = window.setTimeout(() => lib.setCurrent((i) => (i + 1) % lib.queue.length), 90000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.playing, lib.current, lib.queue.length, platform]);

  const switchPlatform = (next) => {
    if (next === platform) return;
    setPlatform(next); setError(''); setHtml(''); setShowImport(false);
  };

  const importHtml = () => {
    const items = config.parse(html);
    if (!items.length) { setError(config.emptyImportError); return; }
    lib.persist(items);
    setError(''); setHtml(''); setShowImport(false); goTo('player');
  };
  const appendUrls = () => {
    const items = config.parse(html);
    if (!items.length) { setError(config.emptyAppendError); return; }
    lib.append(items);
    setError(''); setHtml('');
  };
  const handleFilePicked = (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setHtml(String(reader.result || '')); setError(''); };
    reader.onerror = () => setError('Could not read that file. Try pasting the contents instead.');
    reader.readAsText(file);
  };
  const beginSwipe = (event) => { swipeStartRef.current = event.touches[0]?.clientX ?? null; };
  const finishSwipe = (event) => {
    const end = event.changedTouches[0]?.clientX;
    if (swipeStartRef.current === null || end === undefined) return;
    const distance = end - swipeStartRef.current;
    swipeStartRef.current = null;
    if (Math.abs(distance) < 28) return;
    didSwipeRef.current = true;
    if (distance < 0) lib.nextVideo(); else lib.previousVideo();
  };
  const mobileNext = () => { if (didSwipeRef.current) { didSwipeRef.current = false; return; } lib.nextVideo(); };
  const mobilePrevious = () => { if (didSwipeRef.current) { didSwipeRef.current = false; return; } lib.previousVideo(); };

  return <main>
    <input ref={fileInputRef} type="file" accept=".json,application/json,.html,text/html,.txt,text/plain" onChange={handleFilePicked} style={{ display: 'none' }} />
    <header>
      <a className="brand" href="#" onClick={() => goTo('player')}>LOOP<span>TIK</span></a>
      <nav className="platform-tabs">
        <button className={platform === 'tiktok' ? 'active' : ''} onClick={() => switchPlatform('tiktok')}>TikTok</button>
        <button className={platform === 'youtube' ? 'active' : ''} onClick={() => switchPlatform('youtube')}>YouTube</button>
      </nav>
      <div className="header-note"><i /> Favorites, on repeat</div>
      <button className="header-link" onClick={() => goTo(page === 'player' ? 'import' : 'player')}>{page === 'player' ? 'Import favorites' : 'Back to player'}</button>
    </header>
    {page === 'import' ? <section className="import-shell">
      <div className="eyebrow">YOUR PERSONAL ROTATION</div>
      <h1>Turn saved {config.label}s<br />into a <em>loop.</em></h1>
      <p className="intro">Paste your {config.label} {config.sourceLabel} HTML and we’ll build a private, endlessly shuffled queue from the videos you already love.</p>
      <div className="paste-card">
        <div className="paste-head"><span>Paste {config.sourceLabel} HTML</span><span className="paste-head-actions"><button className="sample" onClick={() => fileInputRef.current?.click()}>Upload file</button><button className="sample" onClick={() => setHtml(config.sample)}>Use example</button></span></div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={config.pastePlaceholder} spellCheck="false" />
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={importHtml}>Build my loop <b>→</b></button>
      </div>
      <div className="steps"><span><b>01</b> Copy {config.sourceLabel}</span><span><b>02</b> Paste HTML</span><span><b>03</b> Press play</span></div>
    </section> : <>
    <section className="player-shell">
      <aside>
        <div className="eyebrow">NOW PLAYING</div>
        <h2>{active?.title}</h2>
        {active && <a href={active.url} target="_blank" rel="noreferrer">Open on {config.label} ↗</a>}
        <div className="controls"><button onClick={lib.previousVideo}>← <span>Previous</span></button><button onClick={() => controlsRef.current.togglePlayback()}>{lib.playing ? '❚❚' : '▶'} <span>{lib.playing ? 'Pause' : 'Play with sound'}</span></button><button onClick={lib.nextVideo}><span>Next</span> →</button><button onClick={() => controlsRef.current.toggleMute()}>{mutedUI ? '🔇' : '🔊'} <span>{mutedUI ? 'Unmute' : 'Mute'}</span></button></div>
        <div className="queue-meta"><b>{lib.queue.length ? lib.current + 1 : 0}</b> / {lib.queue.length} in this shuffle <span>{remaining} next</span></div>
        <button className="restart" onClick={lib.restart}>↻ Reshuffle all {lib.videos.length} videos</button>
      </aside>
      <div className="stage">
        <div className="mobile-player-wrap"><button className="mobile-chevron previous-chevron" aria-label="Previous video" onClick={mobilePrevious} onTouchStart={beginSwipe} onTouchEnd={finishSwipe}>‹</button><div className="phone">
          {active?.id ? (platform === 'tiktok'
            ? <TikTokPlayer active={active} playing={lib.playing} setPlaying={lib.setPlaying} setCurrent={lib.setCurrent} queueLength={lib.queue.length} audioPrefsRef={audioPrefsRef} setMuted={setMuted} controlsRef={controlsRef} />
            : <YouTubePlayer active={active} playing={lib.playing} setPlaying={lib.setPlaying} setCurrent={lib.setCurrent} queueLength={lib.queue.length} audioPrefsRef={audioPrefsRef} setMuted={setMuted} controlsRef={controlsRef} />)
            : <div className="empty-phone">Import some {config.label} videos to get started.</div>}
        </div><button className="mobile-chevron next-chevron" aria-label="Next video" onClick={mobileNext} onTouchStart={beginSwipe} onTouchEnd={finishSwipe}>›</button></div>
        <p>{lib.playing ? 'Advances when the video ends · Sound on' : 'Press play to start with sound'} · Playback is powered by {config.label}</p>
      </div>
      <aside className="up-next"><div className="eyebrow">UP NEXT</div>{lib.queue.slice(lib.current + 1, lib.current + 5).map((video, index) => <button key={video.id} onClick={() => lib.playVideoAt(lib.current + index + 1)}><img src={video.thumbnail} alt="" /><span><small>0{index + 1}</small>{video.title}</span></button>)}</aside>
    </section>
    <section className="library">
      <div><div className="eyebrow">YOUR LIBRARY</div><h3>{lib.videos.length} saved {config.label} videos in rotation</h3><p>No account or upload needed. Imports stay in this browser after a refresh.</p></div>
      <div className="library-actions"><button className="library-button" onClick={() => { setLibraryMode('append'); setShowImport(true); }}>Add video URLs +</button><button className="library-button" onClick={() => { setLibraryMode('json'); setShowImport(true); }}>Add JSON +</button><button className="library-button" onClick={() => { setLibraryMode('replace'); setShowImport(true); }}>Replace {config.sourceLabel} HTML →</button></div>
      {showImport && <div className="paste-card import-panel">
        <div className="paste-head"><span>{libraryMode === 'append' ? `Add ${config.label} video URLs to your library` : libraryMode === 'json' ? `Add ${config.label} videos from JSON` : `Replace your ${config.sourceLabel} library`}</span><span className="paste-head-actions"><button className="sample" onClick={() => fileInputRef.current?.click()}>Upload file</button><button className="sample" onClick={() => setHtml(config.sample)}>Use example</button></span></div>
        <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder={libraryMode === 'append' ? config.urlPlaceholder : libraryMode === 'json' ? config.jsonPlaceholder : config.pastePlaceholder} spellCheck="false" />
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={libraryMode === 'replace' ? importHtml : appendUrls}>{libraryMode === 'replace' ? 'Save and rebuild loop' : 'Add unique videos'} <b>→</b></button>
      </div>}
    </section>
    </>}
    <footer><span>Made for your saved moments.</span><span>No account, no upload — parsing happens in your browser.</span></footer>
  </main>;
}

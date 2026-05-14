const META_BASE     = 'https://archive.org/metadata/';
const DOWNLOAD_BASE = 'https://archive.org/download/';
const VIDEO_FMTS    = ['h.264','mpeg4','mp4','ogg video','webm'];
const VIDEO_EXTS    = ['.mp4','.webm','.ogv'];
const READY_THRESH  = 3;

let container    = null;
let config       = { collection: 'demolitionkitchenvideo', horizontalStretch: 1.0 };

let items        = [];
let used         = new Set();
let activeIdx    = 0;
let switchPending  = false;
let preloading   = false;
let preloadDone  = false;
let booting      = true;
let running      = false;

let vids  = [];
let flash = null;

// bound listener refs for cleanup
let clickHandler     = null;
let touchHandler     = null;
let keyHandler       = null;
let endedHandlers    = [];

function buildSearchUrl(collection) {
    return 'https://archive.org/advancedsearch.php' +
        `?q=collection%3A${encodeURIComponent(collection)}+AND+mediatype%3Amovies` +
        '&fl[]=identifier,title&rows=500&page=1&output=json';
}

function applyStretch(value) {
    vids.forEach(v => {
        v.style.transform       = `scaleX(${value})`;
        v.style.transformOrigin = 'center center';
    });
}

async function fetchItems(collection) {
    const res  = await fetch(buildSearchUrl(collection));
    const json = await res.json();
    items = (json.response?.docs || []).filter(d => d.mediatype !== 'audio');
    if (!items.length) throw new Error('No items in collection: ' + collection);
}

function pickItem() {
    if (used.size >= items.length) used.clear();
    let idx;
    do { idx = Math.floor(Math.random() * items.length); } while (used.has(idx));
    used.add(idx);
    return items[idx];
}

async function getVideoUrl(identifier) {
    const res   = await fetch(META_BASE + identifier);
    const json  = await res.json();
    const files = json.files || [];
    const ranked = files
        .filter(f => {
            const fmt  = (f.format || '').toLowerCase();
            const name = (f.name   || '').toLowerCase();
            return VIDEO_FMTS.some(v => fmt.includes(v)) || VIDEO_EXTS.some(e => name.endsWith(e));
        })
        .sort((a, b) => {
            const score = f => {
                const fmt = (f.format || '').toLowerCase();
                if (fmt.includes('h.264')) return 0;
                if (fmt.includes('mp4') || fmt.includes('mpeg4')) return 1;
                if (fmt.includes('webm')) return 2;
                return 3;
            };
            return score(a) - score(b);
        });
    if (!ranked.length) return null;
    return DOWNLOAD_BASE + identifier + '/' + encodeURIComponent(ranked[0].name);
}

async function preloadNext() {
    if (preloading || preloadDone || !running) return;
    preloading = true;

    const next = vids[1 - activeIdx];
    next.src = '';
    next.removeAttribute('src');

    let attempts = 0;
    while (attempts < 8 && running) {
        const item = pickItem();
        attempts++;
        try {
            const url = await getVideoUrl(item.identifier);
            if (!url) continue;

            await new Promise((resolve, reject) => {
                next.src = url;
                next.load();

                function cleanup() {
                    next.removeEventListener('progress', onProgress);
                    next.removeEventListener('canplay',  onCanPlay);
                    next.removeEventListener('error',    onError);
                }
                const onProgress = () => {
                    if (next.buffered.length && next.buffered.end(0) >= READY_THRESH) {
                        cleanup(); resolve();
                    }
                };
                const onCanPlay = () => { cleanup(); resolve(); };
                const onError   = () => { cleanup(); reject(new Error('video error')); };

                next.addEventListener('progress', onProgress);
                next.addEventListener('canplay',  onCanPlay);
                next.addEventListener('error',    onError);
            });

            preloading  = false;
            preloadDone = true;

            if (switchPending) {
                switchPending = false;
                doSwitch();
            }
            return;
        } catch(e) { /* try next item */ }
    }

    preloading = false;
}

function doSwitch() {
    const current = vids[activeIdx];
    const next    = vids[1 - activeIdx];

    flash.classList.add('on');

    setTimeout(() => {
        current.classList.remove('active');
        next.classList.add('active');
        next.play().catch(() => {});
        activeIdx = 1 - activeIdx;

        requestAnimationFrame(() => { flash.classList.remove('on'); });

        preloadDone = false;
        preloading  = false;
        preloadNext();
    }, 260);
}

function onTap() {
    if (booting) return;
    if (switchPending) return;
    if (preloadDone) { doSwitch(); } else { switchPending = true; }
}

async function boot() {
    booting = true;
    await fetchItems(config.collection);

    let loaded = false;
    while (!loaded && running) {
        const item = pickItem();
        try {
            const url = await getVideoUrl(item.identifier);
            if (!url) continue;
            vids[0].src = url;
            vids[0].load();
            await new Promise((resolve, reject) => {
                vids[0].addEventListener('canplay', resolve, { once: true });
                vids[0].addEventListener('error',   reject,  { once: true });
            });
            vids[0].play().catch(() => {});
            loaded = true;
        } catch(e) { /* retry */ }
    }

    booting = false;
    preloadNext();
}

export function init(containerEl, cfg = {}) {
    container = containerEl;
    config    = { collection: 'demolitionkitchenvideo', horizontalStretch: 1.0, ...cfg };
    running   = true;

    // Reset state
    items = []; used = new Set(); activeIdx = 0;
    switchPending = false; preloading = false; preloadDone = false;

    // Inject styles
    const style = document.createElement('style');
    style.id = 'demo-styles';
    style.textContent = `
        #demo-wrap { position:relative; width:100%; height:100%; background:#000; overflow:hidden; cursor:none; }
        .demo-vid {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            object-fit: cover;
            display: block;
            opacity: 0;
            transition: opacity 0.35s ease;
            z-index: 1;
            transform-origin: center center;
        }
        .demo-vid.active { opacity: 1; z-index: 2; }
        #demo-flash {
            position: absolute; inset: 0;
            background: #000;
            z-index: 10;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
        }
        #demo-flash.on { opacity: 1; }
    `;
    document.head.appendChild(style);

    // Build DOM
    const wrap = document.createElement('div');
    wrap.id = 'demo-wrap';

    const v0 = document.createElement('video');
    v0.className = 'demo-vid active';
    v0.autoplay = true; v0.muted = true; v0.setAttribute('playsinline', '');

    const v1 = document.createElement('video');
    v1.className = 'demo-vid';
    v1.autoplay = true; v1.muted = true; v1.setAttribute('playsinline', '');

    flash = document.createElement('div');
    flash.id = 'demo-flash';

    wrap.appendChild(v0);
    wrap.appendChild(v1);
    wrap.appendChild(flash);
    container.appendChild(wrap);

    vids = [v0, v1];
    applyStretch(config.horizontalStretch);

    // Event listeners
    clickHandler = () => onTap();
    touchHandler = e => { e.preventDefault(); onTap(); };
    keyHandler   = e => { if (e.code === 'Space') { e.preventDefault(); onTap(); } };

    container.addEventListener('click', clickHandler);
    container.addEventListener('touchstart', touchHandler, { passive: false });
    document.addEventListener('keydown', keyHandler);

    endedHandlers = vids.map((v, i) => {
        const handler = () => {
            if (switchPending) return;
            if (preloadDone) { doSwitch(); } else { switchPending = true; }
        };
        v.addEventListener('ended', handler);
        return handler;
    });

    boot();
}

export function cleanup() {
    running = false;

    if (container) {
        container.removeEventListener('click', clickHandler);
        container.removeEventListener('touchstart', touchHandler);
    }
    document.removeEventListener('keydown', keyHandler);

    vids.forEach((v, i) => {
        if (endedHandlers[i]) v.removeEventListener('ended', endedHandlers[i]);
        v.pause();
        v.src = '';
        v.removeAttribute('src');
        v.load();
    });

    const wrap = document.getElementById('demo-wrap');
    if (wrap) wrap.remove();
    const style = document.getElementById('demo-styles');
    if (style) style.remove();

    vids = []; flash = null; container = null;
    items = []; used = new Set();
    clickHandler = null; touchHandler = null; keyHandler = null; endedHandlers = [];
}

export function nextVideo() {
    onTap();
}

export async function updateConfig(newCfg) {
    const prevCollection = config.collection;
    const prevStretch    = config.horizontalStretch;

    config = { ...config, ...newCfg };

    if (config.horizontalStretch !== prevStretch) {
        applyStretch(config.horizontalStretch);
    }

    if (config.collection !== prevCollection) {
        // Restart with new collection
        items = [];
        used.clear();
        switchPending = false;
        preloading    = false;
        preloadDone   = false;
        booting       = true;

        // Reset both videos
        vids.forEach(v => {
            v.pause();
            v.src = '';
            v.removeAttribute('src');
            v.load();
            v.classList.remove('active');
        });
        vids[0].classList.add('active');
        activeIdx = 0;

        boot();
    }
}

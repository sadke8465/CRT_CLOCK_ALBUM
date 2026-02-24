/**
 * ALBUMS MODULE (Edge AI + Saliency Smart Crop)
 * Behavior: 
 * 1. Load CSV Data.
 * 2. Check Last.fm.
 * 3. IF playing -> Wait 30s -> Scan image (Face or Saliency) -> Smooth 15s Zoom.
 * - Face: Hold 60s -> Zoom Out 15s.
 * - Edges: Hold 30s -> Pan 15s -> Hold 30s -> Pan 15s -> Hold 30s -> Zoom out 15s.
 * 4. Wait 3 minutes -> Repeat cycle.
 * 5. IF NOT playing -> Show CSV (Static Corner Animation).
 */

// --- CONFIGURATION ---
const CONFIG = {
    CSV_FILENAME: 'applemusic-3.csv', 
    CSV_INTERVAL_MS: 500000, 
    STORE_COUNTRY: 'il', 
    
    // Visual Timing
    FADE_DURATION: 700, 
    BLACK_HOLD_DURATION: 200, 
    
    // Smart Zoom Settings (As requested)
    ZOOM_DEPTH: 2.0,            // How much CLOSER to get after filling the screen
    T_WAIT_INITIAL: 30000,      // 30 seconds before first zoom
    T_PAN: 15000,               // 15 second fluid pan/zoom time
    T_HOLD_FACE: 60000,         // 1 minute hold on face
    T_HOLD_EDGE: 30000,         // 30 second hold per edge region
    T_WAIT_REPEAT: 180000,      // 3 minutes before repeating cycle
    
    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 5000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 
};

// --- STATE MANAGEMENT ---
let intervals = { lastFm: null, csv: null };
let faceDetector = null;

let state = {
    startupDone: false,
    currentMode: 'STARTUP', 
    csvTrackList: [],
    csvIndex: 0,
    displayedLastFmTrack: null,     
    lastFmTrackStartTime: 0,        
    activeAnimation: null,          
    lastFmActivityTime: Date.now(),
    isTransitioning: false,
    timers: new Set(),              // strict registry for garbage collection
    cachedAnalysis: null            // stores AI results so we don't recalculate the same album
};

// --- MODULE INTERFACE ---

export async function init(container) {
    console.log("[Albums] Initializing...");
    resetState();
    injectStyles();

    container.innerHTML = `
        <div id="container">
            <div id="bg-layer"></div>
            <div id="art-wrapper">
                <img id="album-art" src="" alt="" crossorigin="anonymous" />
            </div>
            <video id="wake-video" playsinline loop muted width="1" height="1" style="opacity: 0; position: absolute;">
                <source src="data:video/mp4;base64,AAAAHGZ0eXBNNEVAAAAAAAEAAAAAAABtZGF0AAAAEAAACAAAABAAAAA=" type="video/mp4">
            </video>
        </div>
    `;

    requestWakeLock();
    await initFaceDetector(); // Load Edge AI into memory once
    await loadCSV(); 
    checkLastFm(); 
    intervals.lastFm = setInterval(checkLastFm, CONFIG.LAST_FM_POLL_INTERVAL);
}

export function cleanup() {
    console.log("[Albums] Cleaning up...");
    if (intervals.lastFm) clearInterval(intervals.lastFm);
    if (intervals.csv) clearInterval(intervals.csv);
    stopSmartAnimation(); 
    resetState();
}

function resetState() {
    stopSmartAnimation();
    state.startupDone = false;
    state.currentMode = 'STARTUP';
    state.csvTrackList = [];
    state.csvIndex = 0;
    state.displayedLastFmTrack = null;
    state.lastFmTrackStartTime = 0;
    state.lastFmActivityTime = Date.now();
    state.isTransitioning = false;
    state.cachedAnalysis = null;
    intervals = { lastFm: null, csv: null };
}

// Memory-safe timeout wrapper
function registerTimer(callback, delay) {
    const t = setTimeout(() => {
        state.timers.delete(t);
        callback();
    }, delay);
    state.timers.add(t);
    return t;
}

// --- EDGE AI INITIALIZATION ---
async function initFaceDetector() {
    if (faceDetector) return;
    try {
        const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm");
        const { FaceDetector, FilesetResolver } = visionModule;
        const visionResolver = await FilesetResolver.forVisionTasks("https://unpkg.com/@mediapipe/tasks-vision@0.10.3/wasm");
        faceDetector = await FaceDetector.createFromOptions(visionResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE"
        });
        console.log("[Albums] Edge AI Face Detector Loaded.");
    } catch (e) {
        console.error("[Albums] Face Detector failed to load. Will fallback to Saliency purely.", e);
    }
}

async function requestWakeLock() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } 
    catch (err) { document.getElementById('wake-video')?.play().catch(()=>{}); }
}

// --- VISUAL TRANSITION ENGINE ---
function performVisualTransition(imageUrl, onSuccessCallback) {
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    stopSmartAnimation();
    state.cachedAnalysis = null; // Clear cached AI data for new image

    const loader = new Image();
    loader.crossOrigin = "Anonymous"; 
    loader.src = imageUrl;

    loader.onload = () => {
        const imgEl = document.getElementById('album-art');
        const bgEl = document.getElementById('bg-layer');
        const wrapperEl = document.getElementById('art-wrapper');
        if (!imgEl || !bgEl || !wrapperEl) return; 

        imgEl.style.opacity = '0';
        bgEl.style.opacity = '0';

        setTimeout(() => {
            imgEl.src = imageUrl;
            bgEl.style.backgroundImage = `url('${imageUrl}')`;

            // Reset CSV animation
            wrapperEl.classList.remove('csv-animate');
            void wrapperEl.offsetWidth; 
            if (state.currentMode === 'CSV') wrapperEl.classList.add('csv-animate');

            requestAnimationFrame(() => {
                imgEl.style.opacity = '1';
                bgEl.style.opacity = '1';
                setTimeout(() => { 
                    state.isTransitioning = false;
                    if(onSuccessCallback) onSuccessCallback();
                }, CONFIG.FADE_DURATION);
            });
        }, CONFIG.FADE_DURATION + CONFIG.BLACK_HOLD_DURATION + 100); 
    };

    loader.onerror = () => {
        state.isTransitioning = false;
        console.warn("Failed to load image:", imageUrl);
    };
    return true;
}

// --- HELPER: START CSV MODE ---
function startCsvMode() {
    if (state.currentMode === 'CSV' && intervals.csv) return;
    stopSmartAnimation(); 
    state.currentMode = 'CSV';
    if (intervals.csv) clearInterval(intervals.csv);
    triggerCsvUpdate(); 
    intervals.csv = setInterval(triggerCsvUpdate, CONFIG.CSV_INTERVAL_MS);
}

// --- LAST.FM LOGIC ---
async function checkLastFm() {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${CONFIG.LAST_FM_USER}&api_key=${CONFIG.LAST_FM_API_KEY}&format=json&limit=1`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.recenttracks && data.recenttracks.track && data.recenttracks.track.length > 0) {
            const track = data.recenttracks.track[0];
            const trackIdentifier = track.name + ' - ' + track.artist['#text'];
            const isNowPlaying = track['@attr'] && track['@attr'].nowplaying === 'true';

            if (!state.startupDone) {
                state.startupDone = true;
                if (isNowPlaying) switchToLastFm(track, trackIdentifier);
                else startCsvMode();
                return; 
            }

            if (isNowPlaying) {
                state.lastFmActivityTime = Date.now();
                if (state.currentMode === 'CSV' || trackIdentifier !== state.displayedLastFmTrack) {
                    switchToLastFm(track, trackIdentifier);
                }
            } else if (state.currentMode === 'LASTFM' && (Date.now() - state.lastFmActivityTime > CONFIG.LAST_FM_TIMEOUT_MS)) {
                startCsvMode();
            }
        }
    } catch (e) {
        if (!state.startupDone) { state.startupDone = true; startCsvMode(); }
    }
}

function switchToLastFm(track, trackIdentifier) {
    state.currentMode = 'LASTFM';
    state.lastFmTrackStartTime = Date.now();
    stopSmartAnimation();

    const albumName = (track.album && track.album['#text']) ? track.album['#text'] : null;

    fetchItunesBySearch(track.name, track.artist['#text'], albumName, (itunesImageUrl) => {
        let finalImage = itunesImageUrl;
        if (!finalImage && track.image) {
            const imgObj = track.image.find(i => i.size === 'extralarge') || track.image[track.image.length - 1];
            if (imgObj) finalImage = imgObj['#text'];
        }

        if (finalImage) {
            performVisualTransition(finalImage, () => {
                state.displayedLastFmTrack = trackIdentifier;
                // Kick off the smart zoom cycle (Wait 30s)
                registerTimer(runSmartZoomSequence, CONFIG.T_WAIT_INITIAL);
            });
        }
    });
}

// --- SMART ZOOM ORCHESTRATOR ---

function stopSmartAnimation() {
    if (state.activeAnimation) {
        state.activeAnimation.cancel();
        state.activeAnimation = null;
    }
    // Purge all pending timeouts (prevents memory leaks and double-triggers)
    state.timers.forEach(t => clearTimeout(t));
    state.timers.clear();
    
    const wrapper = document.getElementById('art-wrapper');
    if (wrapper) wrapper.style.transform = ''; 
}

async function runSmartZoomSequence() {
    if (state.currentMode !== 'LASTFM' || state.isTransitioning) return;

    const imgEl = document.getElementById('album-art');
    const wrapperEl = document.getElementById('art-wrapper');
    if (!imgEl || !wrapperEl || !imgEl.complete || imgEl.naturalWidth === 0) {
        registerTimer(runSmartZoomSequence, 5000); // Retry if image isn't ready
        return;
    }

    console.log("[Albums] Starting Smart Crop Analysis...");
    
    // Use cached analysis if we've already scanned this album, otherwise calculate
    if (!state.cachedAnalysis) {
        state.cachedAnalysis = await analyzeImageForCrops(imgEl);
    }
    
    const analysis = state.cachedAnalysis;
    if (!analysis || analysis.points.length === 0) return; // Silent fail, remain full screen

    // Math: Calculate Scale to strictly COVER the screen + ZOOM_DEPTH
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const rect = wrapperEl.getBoundingClientRect();

    const minCoverScale = Math.max(winW / rect.width, winH / rect.height) * 1.05; 
    const targetScale = minCoverScale * CONFIG.ZOOM_DEPTH;

    // Math: Translates a percentage coordinate to clamped pixel movement
    const getTransform = (point) => {
        const shiftX_pct = 50 - point.x;
        const shiftY_pct = 50 - point.y;
        
        let transX = (shiftX_pct / 100) * rect.width * targetScale;
        let transY = (shiftY_pct / 100) * rect.height * targetScale;

        const maxTransX = (rect.width * targetScale - winW) / 2;
        const maxTransY = (rect.height * targetScale - winH) / 2;

        transX = Math.max(-maxTransX, Math.min(maxTransX, transX));
        transY = Math.max(-maxTransY, Math.min(maxTransY, transY));

        return `translate(${transX}px, ${transY}px) scale(${targetScale})`;
    };

    let keyframes = [];
    let totalDuration = 0;

    // Construct precise timing arrays for Web Animations API
    if (analysis.type === 'FACE') {
        const D_PAN = CONFIG.T_PAN;
        const D_HOLD = CONFIG.T_HOLD_FACE;
        totalDuration = D_PAN + D_HOLD + D_PAN; // 15 + 60 + 15 = 90s
        
        const pt = analysis.points[0];
        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(pt), offset: D_PAN / totalDuration },
            { transform: getTransform(pt), offset: (D_PAN + D_HOLD) / totalDuration },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    } 
    else if (analysis.type === 'EDGES') {
        const D_PAN = CONFIG.T_PAN;
        const D_HOLD = CONFIG.T_HOLD_EDGE;
        totalDuration = (D_PAN * 4) + (D_HOLD * 3); // 15 + 30 + 15 + 30 + 15 + 30 + 15 = 150s
        
        const p1 = analysis.points[0], p2 = analysis.points[1], p3 = analysis.points[2];
        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(p1), offset: D_PAN / totalDuration },
            { transform: getTransform(p1), offset: (D_PAN + D_HOLD) / totalDuration },
            { transform: getTransform(p2), offset: (D_PAN * 2 + D_HOLD) / totalDuration },
            { transform: getTransform(p2), offset: (D_PAN * 2 + D_HOLD * 2) / totalDuration },
            { transform: getTransform(p3), offset: (D_PAN * 3 + D_HOLD * 2) / totalDuration },
            { transform: getTransform(p3), offset: (D_PAN * 3 + D_HOLD * 3) / totalDuration },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    }

    console.log(`[Albums] Executing ${analysis.type} zoom. Duration: ${totalDuration/1000}s`);

    // Execute fluid animation
    state.activeAnimation = wrapperEl.animate(keyframes, {
        duration: totalDuration,
        fill: 'forwards',
        easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)' // Extremely smooth, non-abrupt start/stop
    });

    state.activeAnimation.onfinish = () => {
        state.activeAnimation = null;
        // Schedule the next cycle after 3 minutes
        registerTimer(runSmartZoomSequence, CONFIG.T_WAIT_REPEAT);
    };
}

// --- SCANNER (MediaPipe + Pure JS Saliency Fallback) ---
async function analyzeImageForCrops(imgElement) {
    // 1. Edge AI Face Detection First
    if (faceDetector) {
        const detections = faceDetector.detect(imgElement);
        if (detections.detections.length > 0) {
            // Get most prominent face
            const bestFace = detections.detections.sort((a, b) => b.categories[0].score - a.categories[0].score)[0];
            const box = bestFace.boundingBox;
            const centerX_pct = ((box.originX + (box.width / 2)) / imgElement.naturalWidth) * 100;
            const centerY_pct = ((box.originY + (box.height / 2)) / imgElement.naturalHeight) * 100;
            return { type: 'FACE', points: [{ x: centerX_pct, y: centerY_pct }] };
        }
    }

    // 2. Pure JS Color-Aware Saliency Fallback
    const processSize = 100; 
    const canvas = document.createElement('canvas');
    canvas.width = processSize;
    canvas.height = processSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.drawImage(imgElement, 0, 0, processSize, processSize);
    const imgData = ctx.getImageData(0, 0, processSize, processSize);
    const data = imgData.data;
    
    const scores = new Float32Array(processSize * processSize);

    // Pass 1: Saturation
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        scores[i / 4] += (max - min) * 0.5; 
    }

    // Pass 2: Color-Aware Edge Density (Sobel-like)
    const COLOR_EDGE_THRESHOLD = 120; 
    for (let y = 1; y < processSize - 1; y++) {
        for (let x = 1; x < processSize - 1; x++) {
            const cIdx = (y * processSize + x) * 4;
            const r = data[cIdx], g = data[cIdx+1], b = data[cIdx+2];

            const dUp = Math.abs(r - data[cIdx-(processSize*4)]) + Math.abs(g - data[cIdx-(processSize*4)+1]) + Math.abs(b - data[cIdx-(processSize*4)+2]);
            const dDown = Math.abs(r - data[cIdx+(processSize*4)]) + Math.abs(g - data[cIdx+(processSize*4)+1]) + Math.abs(b - data[cIdx+(processSize*4)+2]);
            const dLeft = Math.abs(r - data[cIdx-4]) + Math.abs(g - data[cIdx-3]) + Math.abs(b - data[cIdx-2]);
            const dRight = Math.abs(r - data[cIdx+4]) + Math.abs(g - data[cIdx+5]) + Math.abs(b - data[cIdx+6]);
            
            let edgeScore = 0;
            if (dUp > COLOR_EDGE_THRESHOLD) edgeScore += dUp;
            if (dDown > COLOR_EDGE_THRESHOLD) edgeScore += dDown;
            if (dLeft > COLOR_EDGE_THRESHOLD) edgeScore += dLeft;
            if (dRight > COLOR_EDGE_THRESHOLD) edgeScore += dRight;
            
            scores[y * processSize + x] += edgeScore * 0.5; 
        }
    }

    // Pass 3: Pool regions to find top 3
    const regions = [];
    const windowSize = 25; 
    const step = 10;
    
    for (let y = 0; y <= processSize - windowSize; y += step) {
        for (let x = 0; x <= processSize - windowSize; x += step) {
            let regionScore = 0;
            for (let wy = 0; wy < windowSize; wy++) {
                for (let wx = 0; wx < windowSize; wx++) {
                    regionScore += scores[(y + wy) * processSize + (x + wx)];
                }
            }
            regions.push({ x, y, score: regionScore });
        }
    }

    regions.sort((a, b) => b.score - a.score);
    const topRegions = [];
    
    for (const region of regions) {
        let overlap = false;
        for (const selected of topRegions) {
            if (region.x < selected.x + windowSize && region.x + windowSize > selected.x &&
                region.y < selected.y + windowSize && region.y + windowSize > selected.y) {
                overlap = true; break;
            }
        }
        if (!overlap) {
            topRegions.push(region);
            if (topRegions.length >= 3) break;
        }
    }

    // Memory cleanup: destroy canvas data so GC can eat it
    canvas.width = 0; 
    canvas.height = 0;

    if (topRegions.length < 3) return { type: 'EDGES', points: [] };

    // Convert process-grid coordinates back to absolute percentages (0-100)
    const points = topRegions.map(r => ({
        x: ((r.x + windowSize/2) / processSize) * 100,
        y: ((r.y + windowSize/2) / processSize) * 100
    }));

    return { type: 'EDGES', points };
}

// --- DATA HELPERS ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function loadCSV() {
    try {
        const response = await fetch(CONFIG.CSV_FILENAME);
        if (!response.ok) return; 
        parseCSV(await response.text());
    } catch (error) { console.error("CSV Load Error", error); }
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idIndex = headers.indexOf('id');
    if (idIndex === -1) return;
    const splitRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(splitRegex).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length > idIndex) state.csvTrackList.push({ id: cols[idIndex] });
    }
    if (state.csvTrackList.length > 0) shuffleArray(state.csvTrackList);
}

function triggerCsvUpdate() {
    if (state.currentMode !== 'CSV') return;
    if (state.csvTrackList.length === 0) return;

    const track = state.csvTrackList[state.csvIndex];
    if(!track) return; 

    fetchItunesById(track.id, (url) => {
        if (url) performVisualTransition(url);
        else {
             state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
             registerTimer(triggerCsvUpdate, 1000); 
        }
    });
    state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
}

function fetchItunesById(appleId, callback) {
    const cbName = 'cb_id_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    script.src = `https://itunes.apple.com/lookup?id=${appleId}&country=${CONFIG.STORE_COUNTRY}&callback=${cbName}`;
    window[cbName] = function(data) {
        cleanupScript(script, cbName);
        if (data && data.results && data.results.length > 0) {
            callback(data.results[0].artworkUrl100.replace('100x100bb', '1200x1200bb')); 
        } else callback(null);
    };
    script.onerror = () => { cleanupScript(script, cbName); callback(null); };
    document.body.appendChild(script);
}

function fetchItunesBySearch(trackName, artistName, albumName, callback) {
    const cbName = 'cb_search_' + Math.floor(Math.random() * 100000);
    let query = artistName + ' ' + trackName;
    if (albumName) query += ' ' + albumName;
    const script = document.createElement('script');
    script.src = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1&country=${CONFIG.STORE_COUNTRY}&callback=${cbName}`;
    window[cbName] = function(data) {
        cleanupScript(script, cbName);
        if (data && data.results && data.results.length > 0) {
            callback(data.results[0].artworkUrl100.replace('100x100bb', '1200x1200bb')); 
        } else callback(null);
    };
    script.onerror = () => { cleanupScript(script, cbName); callback(null); };
    document.body.appendChild(script);
}

function cleanupScript(script, cbName) {
    if(document.body.contains(script)) document.body.removeChild(script);
    delete window[cbName];
}

// --- STYLES ---
function injectStyles() {
    if (document.getElementById('albums-module-styles')) return;

    const style = document.createElement('style');
    style.id = 'albums-module-styles';
    style.textContent = `
        #container {
            position: relative;
            width: 100vw; height: 100vh;
            display: flex; justify-content: center; align-items: center;
            overflow: hidden; background-color: #000;
        }
        #bg-layer {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background-size: cover; background-position: center;
            filter: blur(120px) brightness(0.9);
            transform: scale(1.4); z-index: 1; opacity: 0; transition: opacity 1s;
        }
        #art-wrapper {
            position: relative; z-index: 10;
            height: 90vh; aspect-ratio: 1.4 / 1;
            max-width: 90vw; max-height: 90vh;
            display: flex;
            box-shadow: 0 0 120px 10px rgba(0,0,0,0.5);
            border-radius: 24px; overflow: hidden; 
            will-change: transform;
        }
        #album-art {
            width: 100%; height: 100%; object-fit: fill; 
            opacity: 0; transition: opacity 1s;
        }
        .csv-animate {
            animation: cameraPanCycle 250s ease-in-out 2 forwards;
        }
        @keyframes cameraPanCycle {
            0%, 2% { transform: scale(1) translate(0, 0); }
            4%, 20% { transform: scale(2) translate(calc(50% - 25vw), calc(50% - 25vh)); }
            22%, 40% { transform: scale(2) translate(calc(25vw - 50%), calc(50% - 25vh)); }
            42%, 60% { transform: scale(2) translate(calc(25vw - 50%), calc(25vh - 50%)); }
            62%, 80% { transform: scale(2) translate(calc(50% - 25vw), calc(25vh - 50%)); }
            82%, 100% { transform: scale(1) translate(0, 0); }
        }
    `;
    document.head.appendChild(style);
}

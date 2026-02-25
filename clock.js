/**
 * ALBUMS MODULE (Full-Screen Immersion Edition with Edge AI)
 * Behavior: 
 * 1. Load CSV Data.
 * 2. Check Last.fm.
 * 3. IF playing > 30s -> Scan image (Face or Saliency) -> Full Screen Zoom/Pan.
 * 4. Wait 3 minutes, repeat zoom.
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
    
    // Smart Zoom Settings
    SMART_ZOOM_DELAY: 30000,   // 30 seconds before zooming
    SMART_ZOOM_CYCLE: 180000,  // 3 minutes before repeating zoom
    ZOOM_DEPTH: 2.0,           // How much CLOSER to get after filling the screen
    
    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 5000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 
};

// --- STATE MANAGEMENT ---
let intervals = { lastFm: null, csv: null };
let faceDetector = null; // Holds the AI Model globally

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
    
    // Timers for strict memory cleanup
    zoomStartTimer: null,
    zoomCycleTimer: null
};

// --- MODULE INTERFACE ---

export async function init(container) {
    console.log("[Albums] Initializing AI & UI...");
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
    await initFaceDetector();
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
    clearZoomTimers();
    state = {
        startupDone: false,
        currentMode: 'STARTUP', 
        csvTrackList: [],
        csvIndex: 0,
        displayedLastFmTrack: null,
        lastFmTrackStartTime: 0,
        activeAnimation: null,
        lastFmActivityTime: Date.now(),
        isTransitioning: false,
        zoomStartTimer: null,
        zoomCycleTimer: null
    };
    intervals = { lastFm: null, csv: null };
}

// --- EDGE AI INITIALIZATION ---
async function initFaceDetector() {
    if (faceDetector) return;
    try {
        const visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm");
        const { FaceDetector, FilesetResolver } = visionModule;
        const visionResolver = await FilesetResolver.forVisionTasks(
            "https://unpkg.com/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        faceDetector = await FaceDetector.createFromOptions(visionResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE"
        });
        console.log("[Albums] AI Ready");
    } catch (error) {
        console.error("[Albums] Face Detector failed to load. Will fallback to Saliency.", error);
    }
}

// --- VISUAL TRANSITION ENGINE ---
function performVisualTransition(imageUrl, onSuccessCallback) {
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    stopSmartAnimation();

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
            if (!document.getElementById('album-art')) return;

            imgEl.src = imageUrl;
            bgEl.style.backgroundImage = `url('${imageUrl}')`;

            wrapperEl.classList.remove('csv-animate');
            void wrapperEl.offsetWidth; 
            
            if (state.currentMode === 'CSV') {
                wrapperEl.style.transform = ''; 
                wrapperEl.classList.add('csv-animate');
            }

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

// --- MODES ---
function startCsvMode() {
    if (state.currentMode === 'CSV' && intervals.csv) return;
    
    stopSmartAnimation(); 
    state.currentMode = 'CSV';
    
    if (intervals.csv) clearInterval(intervals.csv);
    triggerCsvUpdate(); 
    intervals.csv = setInterval(triggerCsvUpdate, CONFIG.CSV_INTERVAL_MS);
}

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
                    if (intervals.csv) clearInterval(intervals.csv);
                    switchToLastFm(track, trackIdentifier);
                }
            } else {
                if (state.currentMode === 'LASTFM' && Date.now() - state.lastFmActivityTime > CONFIG.LAST_FM_TIMEOUT_MS) {
                    startCsvMode();
                }
            }
        }
    } catch (error) {
        if (!state.startupDone) {
            state.startupDone = true;
            startCsvMode();
        }
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
                // Start the 30-second delay for the smart crop once the image is visible
                state.zoomStartTimer = setTimeout(runSmartZoomSequence, CONFIG.SMART_ZOOM_DELAY);
            });
        }
    });
}

// --- SMART ZOOM LOGIC ---

function clearZoomTimers() {
    if (state.zoomStartTimer) clearTimeout(state.zoomStartTimer);
    if (state.zoomCycleTimer) clearTimeout(state.zoomCycleTimer);
    state.zoomStartTimer = null;
    state.zoomCycleTimer = null;
}

function stopSmartAnimation() {
    clearZoomTimers();
    if (state.activeAnimation) {
        state.activeAnimation.cancel();
        state.activeAnimation = null;
    }
    const wrapper = document.getElementById('art-wrapper');
    if (wrapper) wrapper.style.transform = ''; 
}

async function runSmartZoomSequence() {
    if (state.currentMode !== 'LASTFM') return;

    const imgEl = document.getElementById('album-art');
    const wrapperEl = document.getElementById('art-wrapper');
    if (!imgEl || !wrapperEl || !imgEl.complete) return;

    const result = await analyzeVisuals(imgEl);
    if (!result || !result.points || result.points.length === 0) {
        // Retry logic if analysis fails unexpectedly
        state.zoomCycleTimer = setTimeout(runSmartZoomSequence, CONFIG.SMART_ZOOM_CYCLE);
        return;
    }

    const points = result.points;
    const isFace = result.type === 'face';

    // Math: Calculate Scale to strictly COVER Screen
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const rect = wrapperEl.getBoundingClientRect();
    const scaleToCoverX = winW / rect.width;
    const scaleToCoverY = winH / rect.height;
    const minCoverScale = Math.max(scaleToCoverX, scaleToCoverY) * 1.05; 
    const targetScale = minCoverScale * CONFIG.ZOOM_DEPTH;

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

    if (isFace) {
        // Face Sequence: 15s zoom in -> 60s hold -> 15s zoom out
        const T_ZOOM = 15000;
        const T_HOLD = 60000;
        totalDuration = T_ZOOM * 2 + T_HOLD; // 90,000ms

        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(points[0]), offset: T_ZOOM / totalDuration },
            { transform: getTransform(points[0]), offset: (T_ZOOM + T_HOLD) / totalDuration },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    } else {
        // Edge Sequence: 15s zoom P1 -> 30s hold -> 15s pan P2 -> 30s hold -> 15s pan P3 -> 30s hold -> 15s zoom out
        const T_MOVE = 15000;
        const T_HOLD = 30000;
        totalDuration = (T_MOVE * 4) + (T_HOLD * 3); // 150,000ms

        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(points[0]), offset: T_MOVE / totalDuration },
            { transform: getTransform(points[0]), offset: (T_MOVE + T_HOLD) / totalDuration },
            
            { transform: getTransform(points[1] || points[0]), offset: (T_MOVE * 2 + T_HOLD) / totalDuration },
            { transform: getTransform(points[1] || points[0]), offset: (T_MOVE * 2 + T_HOLD * 2) / totalDuration },
            
            { transform: getTransform(points[2] || points[0]), offset: (T_MOVE * 3 + T_HOLD * 2) / totalDuration },
            { transform: getTransform(points[2] || points[0]), offset: (T_MOVE * 3 + T_HOLD * 3) / totalDuration },
            
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    }

    state.activeAnimation = wrapperEl.animate(keyframes, {
        duration: totalDuration,
        fill: 'forwards',
        easing: 'ease-in-out' // Ensures buttery smooth starts/stops
    });

    state.activeAnimation.onfinish = () => {
        state.activeAnimation = null;
        // Schedule the next cycle in 3 minutes
        state.zoomCycleTimer = setTimeout(runSmartZoomSequence, CONFIG.SMART_ZOOM_CYCLE);
    };
}

// --- HEADLESS ANALYSIS ENGINE ---

async function analyzeVisuals(imgObj) {
    if (faceDetector) {
        try {
            const detections = faceDetector.detect(imgObj);
            if (detections.detections.length > 0) {
                // Find highest confidence face
                const topFace = detections.detections.sort((a, b) => b.categories[0].score - a.categories[0].score)[0];
                const box = topFace.boundingBox;
                
                // Convert bounding box to percentage coordinates relative to original image size
                const xPct = ((box.originX + (box.width / 2)) / imgObj.naturalWidth) * 100;
                const yPct = ((box.originY + (box.height / 2)) / imgObj.naturalHeight) * 100;
                
                return { type: 'face', points: [{ x: xPct, y: yPct }] };
            }
        } catch (e) {}
    }

    // Fallback: Saliency Engine
    return runClassicalSaliency(imgObj);
}

function runClassicalSaliency(imgObj) {
    const processSize = 100; 
    const canvas = document.createElement('canvas');
    canvas.width = processSize;
    canvas.height = processSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    try { ctx.drawImage(imgObj, 0, 0, processSize, processSize); } 
    catch(e) { return null; }
    
    const imgData = ctx.getImageData(0, 0, processSize, processSize);
    const data = imgData.data;
    const scores = new Float32Array(processSize * processSize);
    const COLOR_EDGE_THRESHOLD = 120; 

    // Pass 1 & 2 combined: Saturation & Edge differences
    for (let y = 1; y < processSize - 1; y++) {
        for (let x = 1; x < processSize - 1; x++) {
            const cIdx = (y * processSize + x) * 4;
            const r = data[cIdx], g = data[cIdx+1], b = data[cIdx+2];

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let score = (max - min) * 0.5;

            const upIdx = cIdx - (processSize * 4);
            const downIdx = cIdx + (processSize * 4);
            const leftIdx = cIdx - 4;
            const rightIdx = cIdx + 4;
            
            const dUp = Math.abs(r - data[upIdx]) + Math.abs(g - data[upIdx+1]) + Math.abs(b - data[upIdx+2]);
            const dDown = Math.abs(r - data[downIdx]) + Math.abs(g - data[downIdx+1]) + Math.abs(b - data[downIdx+2]);
            const dLeft = Math.abs(r - data[leftIdx]) + Math.abs(g - data[leftIdx+1]) + Math.abs(b - data[leftIdx+2]);
            const dRight = Math.abs(r - data[rightIdx]) + Math.abs(g - data[rightIdx+1]) + Math.abs(b - data[rightIdx+2]);
            
            if (dUp > COLOR_EDGE_THRESHOLD) score += dUp;
            if (dDown > COLOR_EDGE_THRESHOLD) score += dDown;
            if (dLeft > COLOR_EDGE_THRESHOLD) score += dLeft;
            if (dRight > COLOR_EDGE_THRESHOLD) score += dRight;
            
            scores[y * processSize + x] += score; 
        }
    }

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
            topRegions.push({
                x: region.x + windowSize/2, // Calculate center and map to 0-100% since processSize is 100
                y: region.y + windowSize/2
            });
            if (topRegions.length >= 3) break;
        }
    }

    if (topRegions.length === 0) topRegions.push({x: 50, y: 50});
    return { type: 'edge', points: topRegions };
}

// --- API HELPERS ---
async function requestWakeLock() {
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } 
    catch (err) { const vid = document.getElementById('wake-video'); if(vid) vid.play().catch(e=>{}); }
}

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
        const text = await response.text();
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
    } catch (error) {}
}

function triggerCsvUpdate() {
    if (state.currentMode !== 'CSV' || state.csvTrackList.length === 0) return;

    const track = state.csvTrackList[state.csvIndex];
    if(!track) return; 

    fetchItunesById(track.id, (url) => {
        if (url) performVisualTransition(url);
        else {
             state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
             setTimeout(triggerCsvUpdate, 1000); 
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
            position: relative; width: 100vw; height: 100vh;
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
            display: flex; box-shadow: 0 0 120px 10px rgba(0,0,0,0.5);
            border-radius: 24px; overflow: hidden; 
        }
        #album-art {
            width: 100%; height: 100%; object-fit: fill; 
            opacity: 0; transition: opacity 1s;
        }
        .csv-animate { animation: cameraPanCycle 250s ease-in-out 2 forwards; }
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

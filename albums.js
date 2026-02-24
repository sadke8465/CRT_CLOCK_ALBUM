/**
 * ALBUMS MODULE (Edge AI & Immersion Edition)
 * Behavior: 
 * 1. Load CSV Data.
 * 2. Check Last.fm.
 * 3. IF playing -> Wait 30s -> Scan image (MediaPipe Face / Saliency) -> Smooth Zoom/Pan Sequence -> Wait 3m -> Repeat.
 * 4. IF NOT playing -> Show CSV (Static Corner Animation).
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
    ZOOM_DEPTH: 2.0,            // How much CLOSER to get after filling the screen
    SMART_ZOOM_DELAY: 30000,    // 30 seconds before starting
    
    // Face Animation Timing
    FACE_ZOOM_TIME: 15000,      // 15s transition
    FACE_HOLD_TIME: 60000,      // 1m hold
    
    // Edge/Saliency Animation Timing
    EDGE_ZOOM_TIME: 15000,      // 15s transition
    EDGE_HOLD_TIME: 30000,      // 30s hold per region
    
    LOOP_DELAY: 180000,         // 3m rest before doing it all again

    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 5000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 
};

// --- GLOBAL AI INSTANCE (Memory Leak Prevention) ---
let faceDetector = null;

// --- STATE MANAGEMENT ---
let intervals = { lastFm: null, csv: null };

let state = {
    startupDone: false,
    currentMode: 'STARTUP', 
    csvTrackList: [],
    csvIndex: 0,
    displayedLastFmTrack: null,     
    lastFmTrackStartTime: 0,        
    activeAnimation: null,          
    zoomTimer: null,                // Timer for 30s delay
    loopTimer: null,                // Timer for 3m delay          
    lastFmActivityTime: Date.now(),
    isTransitioning: false
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
    await initFaceDetector(); // Load AI Models immediately
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
    state = {
        startupDone: false,
        currentMode: 'STARTUP', 
        csvTrackList: [],
        csvIndex: 0,
        displayedLastFmTrack: null,
        lastFmTrackStartTime: 0,
        activeAnimation: null,
        zoomTimer: null,
        loopTimer: null,
        lastFmActivityTime: Date.now(),
        isTransitioning: false
    };
    intervals = { lastFm: null, csv: null };
}

// --- AI INITIALIZATION ---
async function initFaceDetector() {
    if (faceDetector) return;
    try {
        console.log("[Albums] Loading Edge AI Face Detector...");
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
        console.log("[Albums] Edge AI Face Detector Ready.");
    } catch (error) {
        console.error("[Albums] Face Detector failed to load. Will fallback to Saliency:", error);
    }
}

// --- CORE LOGIC ---

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch (err) {
        const vid = document.getElementById('wake-video');
        if(vid) vid.play().catch(e => {});
    }
}

// --- VISUAL TRANSITION ENGINE ---
function performVisualTransition(imageUrl, onSuccessCallback) {
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    stopSmartAnimation(); // Aggressively cancel any active animations and clear caches

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

            // Reset CSS Animation for CSV Mode
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

// --- HELPER: START CSV MODE ---
function startCsvMode() {
    if (state.currentMode === 'CSV' && intervals.csv) return;
    console.log("Starting CSV Mode");
    
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
                    if (intervals.csv) clearInterval(intervals.csv);
                    switchToLastFm(track, trackIdentifier);
                }
            } else {
                if (state.currentMode === 'LASTFM') {
                    if (Date.now() - state.lastFmActivityTime > CONFIG.LAST_FM_TIMEOUT_MS) {
                        startCsvMode();
                    }
                }
            }
        }
    } catch (error) {
        console.error("Last.fm Error", error);
        if (!state.startupDone) {
            state.startupDone = true;
            startCsvMode();
        }
    }
}

function switchToLastFm(track, trackIdentifier) {
    state.currentMode = 'LASTFM';
    state.lastFmTrackStartTime = Date.now();
    stopSmartAnimation(); // Reset all timers/animations immediately

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
                
                // 1. Start the 30-second delay timer once the image is visible
                state.zoomTimer = setTimeout(() => {
                    runSmartZoomSequence();
                }, CONFIG.SMART_ZOOM_DELAY);
            });
        }
    });
}

// --- SMART ZOOM LOGIC & ANIMATION CHOREOGRAPHY ---

async function runSmartZoomSequence() {
    const imgEl = document.getElementById('album-art');
    const wrapperEl = document.getElementById('art-wrapper');
    if (!imgEl || !wrapperEl || state.currentMode !== 'LASTFM') return;

    console.log("[Albums] Running AI Analysis...");
    const analysisResult = await analyzeVisuals(imgEl);
    
    if (!analysisResult || !analysisResult.points) {
        console.log("[Albums] Analysis failed. Skipping animation cycle.");
        return;
    }

    // --- MATH: Calculate Scale to COVER Screen ---
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const rect = wrapperEl.getBoundingClientRect();

    const scaleToCoverX = winW / rect.width;
    const scaleToCoverY = winH / rect.height;
    const minCoverScale = Math.max(scaleToCoverX, scaleToCoverY) * 1.05; 
    const targetScale = minCoverScale * CONFIG.ZOOM_DEPTH;

    // Helper: Converts percentage coordinates into strictly clamped pixel translation
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

    // --- CHOREOGRAPHY A: FACE DETECTED ---
    if (analysisResult.type === 'face') {
        const tZ = CONFIG.FACE_ZOOM_TIME; 
        const tH = CONFIG.FACE_HOLD_TIME; 
        totalDuration = (tZ * 2) + tH; // Total 90s

        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(analysisResult.points[0]), offset: tZ / totalDuration },
            { transform: getTransform(analysisResult.points[0]), offset: (tZ + tH) / totalDuration },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    } 
    // --- CHOREOGRAPHY B: EDGE/SALIENCY (3 Regions) ---
    else {
        const tZ = CONFIG.EDGE_ZOOM_TIME; 
        const tH = CONFIG.EDGE_HOLD_TIME; 
        totalDuration = (tZ * 4) + (tH * 3); // Total 150s

        keyframes = [
            { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
            { transform: getTransform(analysisResult.points[0]), offset: tZ / totalDuration },
            { transform: getTransform(analysisResult.points[0]), offset: (tZ + tH) / totalDuration },
            
            { transform: getTransform(analysisResult.points[1]), offset: (tZ*2 + tH) / totalDuration },
            { transform: getTransform(analysisResult.points[1]), offset: (tZ*2 + tH*2) / totalDuration },
            
            { transform: getTransform(analysisResult.points[2]), offset: (tZ*3 + tH*2) / totalDuration },
            { transform: getTransform(analysisResult.points[2]), offset: (tZ*3 + tH*3) / totalDuration },
            
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
        ];
    }

    // Trigger the Web Animation
    state.activeAnimation = wrapperEl.animate(keyframes, {
        duration: totalDuration,
        fill: 'forwards',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)' // Buttery smooth easing for fluid start/stops
    });

    state.activeAnimation.onfinish = () => {
        state.activeAnimation = null;
        // 5. Schedule the next cycle in 3 minutes
        console.log(`[Albums] Animation complete. Resting for ${CONFIG.LOOP_DELAY / 1000} seconds.`);
        state.loopTimer = setTimeout(() => {
            runSmartZoomSequence();
        }, CONFIG.LOOP_DELAY);
    };
}

function stopSmartAnimation() {
    if (state.activeAnimation) {
        state.activeAnimation.cancel();
        state.activeAnimation = null;
    }
    if (state.zoomTimer) {
        clearTimeout(state.zoomTimer);
        state.zoomTimer = null;
    }
    if (state.loopTimer) {
        clearTimeout(state.loopTimer);
        state.loopTimer = null;
    }
    const wrapper = document.getElementById('art-wrapper');
    if (wrapper) wrapper.style.transform = ''; 
}

// --- AI BRAINS (Calculates based on IMAGE ONLY) ---
async function analyzeVisuals(imgObj) {
    // 1. Try MediaPipe Face Detection
    if (faceDetector) {
        const detections = faceDetector.detect(imgObj);
        if (detections.detections.length > 0) {
            console.log(`[Albums] Found ${detections.detections.length} Face(s)`);
            const bestFace = detections.detections.sort((a, b) => b.categories[0].score - a.categories[0].score)[0];
            const box = bestFace.boundingBox;
            const centerX = box.originX + (box.width / 2);
            const centerY = box.originY + (box.height / 2);
            
            return {
                type: 'face',
                points: [{
                    x: (centerX / imgObj.naturalWidth) * 100,
                    y: (centerY / imgObj.naturalHeight) * 100
                }]
            };
        }
    }

    // 2. Fallback: Classical Color-Aware Saliency
    console.log("[Albums] No faces found. Running Saliency Edge Detection...");
    return runClassicalSaliency(imgObj);
}

function runClassicalSaliency(imgObj) {
    const processSize = 100; 
    const canvas = document.createElement('canvas');
    canvas.width = processSize;
    canvas.height = processSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    try {
        ctx.drawImage(imgObj, 0, 0, processSize, processSize);
    } catch(e) {
        // Fallback to absolute center if canvas fails due to cross-origin taint
        return { type: 'edge', points: [{x: 50, y: 50}, {x: 50, y: 50}, {x: 50, y: 50}] };
    }
    
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

    // Pass 2: Color-Aware Edge Density
    const COLOR_EDGE_THRESHOLD = 120; 
    for (let y = 1; y < processSize - 1; y++) {
        for (let x = 1; x < processSize - 1; x++) {
            const cIdx = (y * processSize + x) * 4;
            const r = data[cIdx], g = data[cIdx+1], b = data[cIdx+2];

            const upIdx = cIdx - (processSize * 4);
            const downIdx = cIdx + (processSize * 4);
            const leftIdx = cIdx - 4;
            const rightIdx = cIdx + 4;
            
            const dUp = Math.abs(r - data[upIdx]) + Math.abs(g - data[upIdx+1]) + Math.abs(b - data[upIdx+2]);
            const dDown = Math.abs(r - data[downIdx]) + Math.abs(g - data[downIdx+1]) + Math.abs(b - data[downIdx+2]);
            const dLeft = Math.abs(r - data[leftIdx]) + Math.abs(g - data[leftIdx+1]) + Math.abs(b - data[leftIdx+2]);
            const dRight = Math.abs(r - data[rightIdx]) + Math.abs(g - data[rightIdx+1]) + Math.abs(b - data[rightIdx+2]);
            
            let edgeScore = 0;
            if (dUp > COLOR_EDGE_THRESHOLD) edgeScore += dUp;
            if (dDown > COLOR_EDGE_THRESHOLD) edgeScore += dDown;
            if (dLeft > COLOR_EDGE_THRESHOLD) edgeScore += dLeft;
            if (dRight > COLOR_EDGE_THRESHOLD) edgeScore += dRight;
            
            scores[y * processSize + x] += edgeScore * 0.5; 
        }
    }

    // Pass 3: Pool regions
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
            regions.push({ x: x + windowSize/2, y: y + windowSize/2, score: regionScore });
        }
    }

    regions.sort((a, b) => b.score - a.score);

    // Filter overlapping regions
    const topRegions = [];
    for (const region of regions) {
        let overlap = false;
        for (const selected of topRegions) {
            if (Math.abs(region.x - selected.x) < windowSize && Math.abs(region.y - selected.y) < windowSize) {
                overlap = true; break;
            }
        }
        if (!overlap) {
            topRegions.push(region);
            if (topRegions.length >= 3) break;
        }
    }

    // Convert to percentages for animation engine
    const points = topRegions.map(r => ({
        x: (r.x / processSize) * 100,
        y: (r.y / processSize) * 100
    }));

    // Fallbacks to guarantee 3 points for the timeline math
    while(points.length > 0 && points.length < 3) points.push(points[0]);
    if (points.length === 0) points.push({x: 50, y: 50}, {x: 50, y: 50}, {x: 50, y: 50});

    return { type: 'edge', points: points };
}

// --- HELPERS ---
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

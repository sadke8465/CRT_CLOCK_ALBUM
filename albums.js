/**
 * ALBUMS MODULE (Full-Screen Immersion Edition)
 * Behavior: 
 * 1. Load CSV Data.
 * 2. Check Last.fm.
 * 3. IF playing > 30s -> Scan image -> Full Screen Zoom/Pan (No Backgrounds).
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
    SMART_ZOOM_DELAY: 30000, 
    ZOOM_DEPTH: 2.0,         // How much CLOSER to get after filling the screen
    TRANSITION_TIME: 5000,   
    HOLD_TIME: 20000,        
    
    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 5000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 
};

// --- STATE MANAGEMENT ---
let intervals = { lastFm: null, csv: null };

let state = {
    startupDone: false,
    currentMode: 'STARTUP', 
    csvTrackList: [],
    csvIndex: 0,
    displayedLastFmTrack: null,     
    lastFmTrackStartTime: 0,        
    lastFmZoomTriggered: false,     
    activeAnimation: null,          
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
        lastFmZoomTriggered: false,
        activeAnimation: null,
        lastFmActivityTime: Date.now(),
        isTransitioning: false
    };
    intervals = { lastFm: null, csv: null };
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

            // Reset CSS Animation
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
                if (isNowPlaying) {
                    switchToLastFm(track, trackIdentifier);
                } else {
                    startCsvMode();
                }
                return; 
            }

            if (isNowPlaying) {
                state.lastFmActivityTime = Date.now();
                
                if (state.currentMode === 'CSV') {
                    if (intervals.csv) clearInterval(intervals.csv);
                    switchToLastFm(track, trackIdentifier);
                } 
                else if (trackIdentifier === state.displayedLastFmTrack) {
                    checkSmartZoomTimer();
                }
                else if (trackIdentifier !== state.displayedLastFmTrack) {
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
    state.lastFmZoomTriggered = false;
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
            });
        }
    });
}

// --- SMART ZOOM LOGIC (FULL SCREEN & VIEWPORT AWARE) ---

function checkSmartZoomTimer() {
    if (state.currentMode !== 'LASTFM') return;
    if (state.lastFmZoomTriggered) return;
    if (state.isTransitioning) return;

    const timePlaying = Date.now() - state.lastFmTrackStartTime;
    if (timePlaying > CONFIG.SMART_ZOOM_DELAY) {
        state.lastFmZoomTriggered = true;
        runSmartZoomSequence();
    }
}

function runSmartZoomSequence() {
    const imgEl = document.getElementById('album-art');
    const wrapperEl = document.getElementById('art-wrapper');
    if (!imgEl || !wrapperEl) return;

    console.log("Running Smart Zoom Analysis...");

    const points = analyzeImageForCrops(imgEl);
    if (!points || points.length < 3) {
        console.log("Analysis failed. Skipping.");
        return;
    }

    // --- MATH: Calculate Scale to COVER Screen ---
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const rect = wrapperEl.getBoundingClientRect();

    // 1. Minimum Scale needed to ensure NO background is visible
    // We compare Screen Aspect vs Image Aspect
    const scaleToCoverX = winW / rect.width;
    const scaleToCoverY = winH / rect.height;
    
    // We must take the LARGER of the two to ensure full coverage
    const minCoverScale = Math.max(scaleToCoverX, scaleToCoverY) * 1.05; // 1.05 buffer for safety

    // 2. Target Scale = Cover Scale * Zoom Depth
    // This ensures we are always strictly larger than the screen
    const targetScale = minCoverScale * CONFIG.ZOOM_DEPTH;

    console.log(`Screen: ${winW}x${winH}, Wrapper: ${rect.width}x${rect.height}`);
    console.log(`Min Cover Scale: ${minCoverScale}, Target Scale: ${targetScale}`);

    const getTransform = (point) => {
        // Point x/y are percentages (0-100) relative to image top-left
        // Center of image is 50, 50
        
        // 1. Calculate the offset from center in PIXELS (at unscaled size)
        // If point is at 20%, offset is (50 - 20) = 30% positive shift
        const shiftX_pct = 50 - point.x;
        const shiftY_pct = 50 - point.y;
        
        // Convert to pixels at target scale
        let transX = (shiftX_pct / 100) * rect.width * targetScale;
        let transY = (shiftY_pct / 100) * rect.height * targetScale;

        // 2. CLAMP TRANSLATION
        // We must not translate so far that the edge of the image enters the viewport.
        // Max translation allowed = (ScaledImageSize - ScreenSize) / 2
        
        const maxTransX = (rect.width * targetScale - winW) / 2;
        const maxTransY = (rect.height * targetScale - winH) / 2;

        // Clamp it
        transX = Math.max(-maxTransX, Math.min(maxTransX, transX));
        transY = Math.max(-maxTransY, Math.min(maxTransY, transY));

        return `translate(${transX}px, ${transY}px) scale(${targetScale})`;
    };

    const T_MOVE = CONFIG.TRANSITION_TIME; 
    const T_HOLD = CONFIG.HOLD_TIME;       
    const totalDuration = (T_MOVE * 4) + (T_HOLD * 3);

    const keyframes = [
        { transform: 'translate(0px, 0px) scale(1)', offset: 0 },
        
        // P1
        { transform: getTransform(points[0]), offset: T_MOVE / totalDuration }, 
        { transform: getTransform(points[0]), offset: (T_MOVE + T_HOLD) / totalDuration },
        
        // P2
        { transform: getTransform(points[1]), offset: (T_MOVE * 2 + T_HOLD) / totalDuration },
        { transform: getTransform(points[1]), offset: (T_MOVE * 2 + T_HOLD * 2) / totalDuration },
        
        // P3
        { transform: getTransform(points[2]), offset: (T_MOVE * 3 + T_HOLD * 2) / totalDuration },
        { transform: getTransform(points[2]), offset: (T_MOVE * 3 + T_HOLD * 3) / totalDuration },
        
        // Return
        { transform: 'translate(0px, 0px) scale(1)', offset: 1 }
    ];

    state.activeAnimation = wrapperEl.animate(keyframes, {
        duration: totalDuration,
        fill: 'forwards',
        easing: 'cubic-bezier(0.65, 0, 0.35, 1)' 
    });

    state.activeAnimation.onfinish = () => {
        state.activeAnimation = null;
    };
}

function stopSmartAnimation() {
    if (state.activeAnimation) {
        state.activeAnimation.cancel();
        state.activeAnimation = null;
    }
    const wrapper = document.getElementById('art-wrapper');
    if (wrapper) wrapper.style.transform = ''; 
}

// --- SCANNER (Calculates based on IMAGE ONLY) ---
function analyzeImageForCrops(imgElement) {
    const RES = 150;
    const canvas = document.createElement('canvas');
    canvas.width = RES;
    canvas.height = RES;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    try {
        // This draws the raw image to canvas, ignoring screen layout/backgrounds
        ctx.drawImage(imgElement, 0, 0, RES, RES);
    } catch(e) {
        return null;
    }

    const pixels = ctx.getImageData(0, 0, RES, RES).data;
    const scores = new Float32Array(RES * RES);

    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i+1];
        const b = pixels[i+2];

        let edge = 0;
        if ((i/4) % RES < RES - 1) {
            edge = Math.abs(r - pixels[i+4]) + Math.abs(g - pixels[i+5]) + Math.abs(b - pixels[i+6]);
        }

        let isSkin = 0;
        if (r > 60 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - Math.min(g, b) > 15) {
            isSkin = 1;
        }

        let pixelScore = edge;
        if (isSkin) pixelScore += 255; 
        scores[i/4] = pixelScore;
    }

    // 1.5 is purely used for finding density, not display zoom
    const cropSize = Math.floor(RES / 1.5); 
    const results = [];

    for (let k = 0; k < 3; k++) {
        let maxScore = -Infinity;
        let bestX = 0;
        let bestY = 0;

        for (let y = 0; y <= RES - cropSize; y += 2) {
            for (let x = 0; x <= RES - cropSize; x += 2) {
                let currentTotal = 0;
                for (let sy = 0; sy < cropSize; sy += 5) {
                    for (let sx = 0; sx < cropSize; sx += 5) {
                        currentTotal += scores[(y + sy) * RES + (x + sx)];
                    }
                }
                if (currentTotal > maxScore) {
                    maxScore = currentTotal;
                    bestX = x;
                    bestY = y;
                }
            }
        }

        results.push({
            x: ((bestX + cropSize/2) / RES) * 100,
            y: ((bestY + cropSize/2) / RES) * 100
        });

        for (let by = bestY; by < bestY + cropSize; by++) {
            for (let bx = bestX; bx < bestX + cropSize; bx++) {
                if (by < RES && bx < RES) scores[by * RES + bx] = -99999;
            }
        }
    }
    return results;
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
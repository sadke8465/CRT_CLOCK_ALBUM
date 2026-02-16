/**
 * ALBUMS MODULE
 * Behavior: 
 * 1. Load CSV Data.
 * 2. Check Last.fm.
 * 3. IF playing -> Show Last.fm (Static).
 * 4. IF NOT playing -> Show CSV (Animated Pan/Zoom).
 */

// --- CONFIGURATION ---
const CONFIG = {
    CSV_FILENAME: 'applemusic-3.csv',
    CSV_INTERVAL_MS: 500000, // 5 Minutes (Matches 2x animation cycles of 250s)
    STORE_COUNTRY: 'il', // Israel
    
    // Visual Timing
    FADE_DURATION: 700, 
    BLACK_HOLD_DURATION: 200, 
    
    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 5000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 // 20 Minutes
};

// --- STATE MANAGEMENT ---
let intervals = {
    lastFm: null,
    csv: null
};

let state = {
    startupDone: false,
    currentMode: 'CSV',
    csvTrackList: [],
    csvIndex: 0,
    displayedLastFmTrack: null,
    lastFmActivityTime: Date.now(),
    isTransitioning: false
};

// --- MODULE INTERFACE ---

export async function init(container) {
    console.log("[Albums] Initializing...");
    
    // 1. Reset State
    resetState();

    // 2. Inject CSS (Includes new Animation Keyframes)
    injectStyles();

    // 3. Inject HTML
    container.innerHTML = `
        <div id="container">
            <div id="bg-layer"></div>
            <div id="art-wrapper">
                <img id="album-art" src="" alt="" />
            </div>
            
            <video id="wake-video" playsinline loop muted width="1" height="1" style="opacity: 0; position: absolute; top:0; left:0;">
                <source src="data:video/mp4;base64,AAAAHGZ0eXBNNEVAAAAAAAEAAAAAAABtZGF0AAAAEAAACAAAABAAAAA=" type="video/mp4">
            </video>
        </div>
    `;

    // 4. Start Logic
    requestWakeLock();
    
    // Wait for CSV to be parsed BEFORE checking Last.fm
    await loadCSV(); 
    
    // Check Last.fm immediately to decide startup path
    checkLastFm(); 

    // Start Polling
    intervals.lastFm = setInterval(checkLastFm, CONFIG.LAST_FM_POLL_INTERVAL);
}

export function cleanup() {
    console.log("[Albums] Cleaning up...");
    
    if (intervals.lastFm) clearInterval(intervals.lastFm);
    if (intervals.csv) clearInterval(intervals.csv);
    
    resetState();
}

function resetState() {
    state = {
        startupDone: false,
        currentMode: 'CSV',
        csvTrackList: [],
        csvIndex: 0,
        displayedLastFmTrack: null,
        lastFmActivityTime: Date.now(),
        isTransitioning: false
    };
    intervals = { lastFm: null, csv: null };
}

// --- CORE LOGIC ---

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        const vid = document.getElementById('wake-video');
        if(vid) vid.play().catch(e => console.log(e));
    }
}

// --- VISUAL TRANSITION ENGINE ---
function performVisualTransition(imageUrl, onSuccessCallback) {
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    const loader = new Image();
    loader.src = imageUrl;

    loader.onload = () => {
        const imgEl = document.getElementById('album-art');
        const bgEl = document.getElementById('bg-layer');

        if (!imgEl || !bgEl) return; 

        // FADE OUT
        imgEl.style.opacity = '0';
        bgEl.style.opacity = '0';

        // WAIT
        setTimeout(() => {
            if (!document.getElementById('album-art')) return;

            // SWAP IMAGE
            imgEl.src = imageUrl;
            bgEl.style.backgroundImage = `url('${imageUrl}')`;

            // --- ANIMATION LOGIC START ---
            // 1. Remove animation class to reset state
            imgEl.classList.remove('csv-animate');

            // 2. Trigger Reflow (Reset CSS time to 0)
            void imgEl.offsetWidth; 

            // 3. Re-apply ONLY if in CSV mode
            if (state.currentMode === 'CSV') {
                imgEl.classList.add('csv-animate');
            }
            // --- ANIMATION LOGIC END ---

            requestAnimationFrame(() => {
                // FADE IN
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
    console.log("Starting CSV Mode");
    state.currentMode = 'CSV';
    
    // Clear existing CSV interval
    if (intervals.csv) clearInterval(intervals.csv);
    
    // Trigger first image immediately
    triggerCsvUpdate();
    
    // Start interval
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

            // --- STARTUP LOGIC ---
            if (!state.startupDone) {
                state.startupDone = true;

                if (isNowPlaying) {
                    console.log("Startup: Track playing. Using Last.fm.");
                    state.lastFmActivityTime = Date.now();
                    state.displayedLastFmTrack = trackIdentifier; 
                    fetchAndDisplayLastFm(track, trackIdentifier);
                } else {
                    console.log("Startup: No track playing. Defaulting to CSV.");
                    startCsvMode();
                }
                return; 
            }

            // --- STANDARD RUNTIME LOGIC ---
            if (isNowPlaying) {
                // SCENARIO 1: A Track is Playing
                state.lastFmActivityTime = Date.now();
                
                // Switch mode if needed
                if (state.currentMode === 'CSV') {
                     if (intervals.csv) clearInterval(intervals.csv);
                     state.currentMode = 'LASTFM';
                }

                if (trackIdentifier !== state.displayedLastFmTrack) {
                    fetchAndDisplayLastFm(track, trackIdentifier);
                }

            } else {
                // SCENARIO 2: Paused / Stopped
                if (state.currentMode === 'LASTFM') {
                    const timeDiff = Date.now() - state.lastFmActivityTime;
                    if (timeDiff > CONFIG.LAST_FM_TIMEOUT_MS) {
                        console.log("Timeout passed. Reverting to CSV.");
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

function fetchAndDisplayLastFm(track, trackIdentifier) {
    fetchItunesBySearch(track.name, track.artist['#text'], (itunesImageUrl) => {
        let finalImage = itunesImageUrl;
        
        if (!finalImage && track.image) {
            const imgObj = track.image.find(i => i.size === 'extralarge') || track.image[track.image.length - 1];
            if (imgObj) finalImage = imgObj['#text'];
        }

        if (finalImage) {
            // onSuccess checks state.currentMode to decide whether to animate
            // Here, we ensure mode is updated properly before call
            state.currentMode = 'LASTFM'; 
            performVisualTransition(finalImage, () => {
                state.displayedLastFmTrack = trackIdentifier;
            });
        }
    });
}

// --- CSV / ITUNES LOGIC ---
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
        parseCSV(text);
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
        if (cols.length > idIndex) {
            state.csvTrackList.push({ id: cols[idIndex] });
        }
    }

    if (state.csvTrackList.length > 0) {
        shuffleArray(state.csvTrackList);
    }
}

function triggerCsvUpdate() {
    if (state.currentMode !== 'CSV') return;
    if (state.csvTrackList.length === 0) return;

    const track = state.csvTrackList[state.csvIndex];
    if(!track) return; 

    fetchItunesById(track.id, (url) => {
        if (url) {
            performVisualTransition(url);
        } else {
             state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
             setTimeout(triggerCsvUpdate, 1000); 
             return;
        }
    });
    state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
}

// --- API HELPERS (JSONP) ---
function fetchItunesById(appleId, callback) {
    const cbName = 'cb_id_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    script.src = `https://itunes.apple.com/lookup?id=${appleId}&country=${CONFIG.STORE_COUNTRY}&callback=${cbName}`;
    
    window[cbName] = function(data) {
        cleanupScript(script, cbName);
        if (data && data.results && data.results.length > 0) {
            const raw = data.results[0].artworkUrl100;
            callback(raw.replace('100x100bb', '1200x1200bb')); 
        } else {
            callback(null);
        }
    };
    script.onerror = () => { cleanupScript(script, cbName); callback(null); };
    document.body.appendChild(script);
}

function fetchItunesBySearch(trackName, artistName, callback) {
    const cbName = 'cb_search_' + Math.floor(Math.random() * 100000);
    const term = encodeURIComponent(artistName + ' ' + trackName);
    const script = document.createElement('script');
    script.src = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1&country=${CONFIG.STORE_COUNTRY}&callback=${cbName}`;
    
    window[cbName] = function(data) {
        cleanupScript(script, cbName);
        if (data && data.results && data.results.length > 0) {
            const raw = data.results[0].artworkUrl100;
            callback(raw.replace('100x100bb', '1200x1200bb')); 
        } else {
            callback(null); 
        }
    };
    script.onerror = () => { cleanupScript(script, cbName); callback(null); };
    document.body.appendChild(script);
}

function cleanupScript(script, cbName) {
    if(document.body.contains(script)) document.body.removeChild(script);
    delete window[cbName];
}

// --- STYLES INJECTOR (UPDATED) ---
function injectStyles() {
    if (document.getElementById('albums-module-styles')) return;

    const style = document.createElement('style');
    style.id = 'albums-module-styles';
    style.textContent = `
        /* Container Setup */
        #container {
            position: relative;
            width: 100vw;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            background-color: #000;
        }

        /* Blurred Background Layer */
        #bg-layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-size: cover;
            background-position: center;
            filter: blur(120px) brightness(0.9);
            transform: scale(1.4);
            z-index: 1;
            opacity: 0; 
            transition: opacity 1s ease-in-out;
            will-change: opacity;
        }

        /* Main Album Art Container */
        #art-wrapper {
            position: relative;
            z-index: 10;
            height: 90vh; 
            aspect-ratio: 1.4 / 1;
            max-width: 90vw;
            max-height: 90vh;
            display: flex;
            box-shadow: 0 0 120px 10px rgba(0,0,0,0.5);
            border-radius: 24px; 
            /* IMPORTANT: Clips the zooming image so it stays inside the frame */
            overflow: hidden; 
        }

        /* The Image Itself */
        #album-art {
            width: 100%;
            height: 100%;
            object-fit: fill; 
            border-radius: 24px; 
            opacity: 0; 
            transition: opacity 1s ease-in-out;
            will-change: opacity, transform, transform-origin;
        }

        /* --- ANIMATION CLASS --- */
        /* Only applied in CSV mode via JS */
        .csv-animate {
            animation-name: panZoomCycle;
            /* 250s per cycle * 2 iterations = 500s (Matches CSV_INTERVAL_MS) */
            animation-duration: 250s; 
            animation-timing-function: ease-in-out;
            animation-iteration-count: 2;
            animation-fill-mode: forwards;
        }

        /* --- KEYFRAMES --- 
           Cycle Duration: 250s 
           We move 'transform-origin' to create the Pan effect while keeping Scale(2).
           This avoids complex translate math and works smoothly.
           
           Timing Map:
           Tween = 5s (2% of 250s)
           Hold  = 45s (18% of 250s)
           Rest  = 45s (End)
        */
        @keyframes panZoomCycle {
            /* Phase 1: Full Screen Rest (0% - 2% Tween In) */
            0% { transform: scale(1); transform-origin: 50% 50%; }

            /* Phase 2: Top-Left (2% - 20%) */
            2% { transform: scale(2); transform-origin: 0% 0%; } 
            20% { transform: scale(2); transform-origin: 0% 0%; }

            /* Phase 3: Top-Right (22% - 40%) */
            22% { transform: scale(2); transform-origin: 100% 0%; }
            40% { transform: scale(2); transform-origin: 100% 0%; }

            /* Phase 4: Bottom-Right (42% - 60%) */
            42% { transform: scale(2); transform-origin: 100% 100%; }
            60% { transform: scale(2); transform-origin: 100% 100%; }

            /* Phase 5: Bottom-Left (62% - 80%) */
            62% { transform: scale(2); transform-origin: 0% 100%; }
            80% { transform: scale(2); transform-origin: 0% 100%; }

            /* Loop Back to Phase 1 (Rest) (82% - 100%) */
            82% { transform: scale(1); transform-origin: 50% 50%; }
            100% { transform: scale(1); transform-origin: 50% 50%; }
        }
    `;
    document.head.appendChild(style);
}

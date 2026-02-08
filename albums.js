/**
 * ALBUMS MODULE
 * Replicates the exact behavior of the standalone HTML file,
 * including iTunes lookups, CSV fallback, and visual transitions.
 */

// --- CONFIGURATION ---
const CONFIG = {
    CSV_FILENAME: 'applemusic-3.csv',
    CSV_INTERVAL_MS: 300000, // 5 Minutes
    STORE_COUNTRY: 'il', // Israel
    
    // Visual Timing
    FADE_DURATION: 1000, 
    BLACK_HOLD_DURATION: 1000, 
    
    // Last.fm Config
    LAST_FM_API_KEY: '7a767d135623f2bac77d858b3a6d9aba',
    LAST_FM_USER: 'Noamsadi95',
    LAST_FM_POLL_INTERVAL: 15000, 
    LAST_FM_TIMEOUT_MS: 20 * 60 * 1000 // 20 Minutes
};

// --- STATE MANAGEMENT ---
let intervals = {
    lastFm: null,
    csv: null
};

let state = {
    currentMode: 'CSV',
    csvTrackList: [],
    csvIndex: 0,
    displayedLastFmTrack: null,
    lastFmActivityTime: Date.now(),
    isTransitioning: false
};

// --- MODULE INTERFACE ---

export function init(container) {
    console.log("[Albums] Initializing...");
    
    // 1. Reset State
    resetState();

    // 2. Inject CSS
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
    loadCSV(); 
    
    // Start Polling
    checkLastFm(); // Run once immediately
    intervals.lastFm = setInterval(checkLastFm, CONFIG.LAST_FM_POLL_INTERVAL);
}

export function cleanup() {
    console.log("[Albums] Cleaning up...");
    
    // 1. Clear Timers
    if (intervals.lastFm) clearInterval(intervals.lastFm);
    if (intervals.csv) clearInterval(intervals.csv);
    
    // 2. Clear visual intervals if any were set implicitly
    // (The original code used nested Timeouts, which will naturally die or fail silently when DOM is gone)
    
    resetState();
}

function resetState() {
    state = {
        currentMode: 'CSV',
        csvTrackList: [],
        csvIndex: 0,
        displayedLastFmTrack: null,
        lastFmActivityTime: Date.now(),
        isTransitioning: false
    };
    intervals = { lastFm: null, csv: null };
}

// --- CORE LOGIC (Ported Exactly) ---

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

        // Guard clause: If user switched modules while image was loading
        if (!imgEl || !bgEl) return; 

        // FADE OUT
        imgEl.style.opacity = '0';
        bgEl.style.opacity = '0';

        // WAIT (1s fade + 1s black + buffer)
        setTimeout(() => {
            if (!document.getElementById('album-art')) return; // Check existence again

            // SWAP
            imgEl.src = imageUrl;
            bgEl.style.backgroundImage = `url('${imageUrl}')`;

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

// --- LAST.FM LOGIC ---
async function checkLastFm() {
    const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${CONFIG.LAST_FM_USER}&api_key=${CONFIG.LAST_FM_API_KEY}&format=json&limit=1`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.recenttracks && data.recenttracks.track && data.recenttracks.track.length > 0) {
            const track = data.recenttracks.track[0];
            const trackIdentifier = track.name + ' - ' + track.artist['#text'];
            
            // Check if specifically marked as "Now Playing" by API
            const isNowPlaying = track['@attr'] && track['@attr'].nowplaying === 'true';

            // INITIALIZATION (Startup)
            if (state.displayedLastFmTrack === null) {
                state.displayedLastFmTrack = trackIdentifier;
                return;
            }

            // --- LOGIC TREE ---

            if (isNowPlaying) {
                // SCENARIO 1: A Track is Playing
                state.lastFmActivityTime = Date.now();

                if (trackIdentifier !== state.displayedLastFmTrack) {
                    fetchAndDisplayLastFm(track, trackIdentifier);
                }

            } else {
                // SCENARIO 2: Paused / Stopped
                
                // --- TIMEOUT CHECK ---
                const timeDiff = Date.now() - state.lastFmActivityTime;
                if (state.currentMode === 'LASTFM' && timeDiff > CONFIG.LAST_FM_TIMEOUT_MS) {
                    console.log("20 mins passed since last play. Going to CSV.");
                    state.currentMode = 'CSV';
                    triggerCsvUpdate();
                }
            }
        }
    } catch (error) {
        console.error("Last.fm Error", error);
    }
}

function fetchAndDisplayLastFm(track, trackIdentifier) {
    fetchItunesBySearch(track.name, track.artist['#text'], (itunesImageUrl) => {
        let finalImage = itunesImageUrl;
        
        // Fallback to Last.fm image if iTunes fails
        if (!finalImage && track.image) {
            const imgObj = track.image.find(i => i.size === 'extralarge') || track.image[track.image.length - 1];
            if (imgObj) finalImage = imgObj['#text'];
        }

        if (finalImage) {
            const success = performVisualTransition(finalImage, () => {
                state.displayedLastFmTrack = trackIdentifier;
                state.currentMode = 'LASTFM';
                console.log("Switched to Last.fm:", trackIdentifier);
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
    } catch (error) { console.error(error); }
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
        
        // Force Start
        state.currentMode = 'CSV';
        triggerCsvUpdate();

        intervals.csv = setInterval(triggerCsvUpdate, CONFIG.CSV_INTERVAL_MS);
    }
}

function triggerCsvUpdate() {
    if (state.currentMode !== 'CSV') return;

    const track = state.csvTrackList[state.csvIndex];
    fetchItunesById(track.id, (url) => {
        if (url) performVisualTransition(url); 
    });
    state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
}

// --- API HELPERS (JSONP) ---
// Note: Window attachment is required for JSONP to work
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
            // If failed, skip to next CSV track immediately
            state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length; 
        }
    };
    script.onerror = () => cleanupScript(script, cbName);
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


// --- STYLES INJECTOR ---
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
            filter: blur(50px) brightness(0.4);
            transform: scale(1.2);
            z-index: 1;
            
            /* FADE TRANSITION SETTINGS */
            opacity: 0; 
            transition: opacity 1s ease-in-out;
            will-change: opacity;
        }

        /* Main Album Art Container */
        #art-wrapper {
            position: relative;
            z-index: 10;
            height: 85vh; 
            aspect-ratio: 1.4 / 1;
            max-width: 90vw;
            max-height: 90vh;
            box-shadow: 0 0 80px rgba(0,0,0,0.8);
            display: flex;
        }

        /* The Image Itself */
        #album-art {
            width: 100%;
            height: 100%;
            object-fit: fill; 
            border-radius: 4px;
            
            /* FADE TRANSITION SETTINGS */
            opacity: 0; 
            transition: opacity 1s ease-in-out;
            will-change: opacity;
        }
    `;
    document.head.appendChild(style);
}

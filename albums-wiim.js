import { resolveArtwork } from './radio-artwork.js?v=1';
/**
 * ALBUMS MODULE (Full-Screen Immersion Edition with ML Face Detection)
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
    FACE_ZOOM_DEPTH: 2.1,    // Less aggressive zoom for faces (breathing room)
    EDGE_ZOOM_DEPTH: 1.25,   // Much wider zoom for non-face objects
    
    // Cinematic Timings
    TRANSITION_TIME: 8000,   // 8 Seconds for buttery smooth Zooms and Pans
    HOLD_TIME: 18000,        // Hold time on each face
    
    // Read-only local source and official radio metadata
    LIVE_POLL_INTERVAL: 1000,
    RADIO_POLL_INTERVAL: 15000,
    LIVE_FAILURE_GRACE_MS: 5000,

    // ML Model URL (using a fast CDN for the weights)
    MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'
};

// --- STATE MANAGEMENT ---
let intervals = { live: null, csv: null };
let epoch = 0, radioCache = null, radioCheckedAt = 0, radioAttemptedKey = '', radioArtwork = '', liveArtworkKey = '', liveArtworkURL = '', lastFailureAt = 0;

let state = {
    startupDone: false,
    currentMode: 'STARTUP', 
    csvTrackList: [],
    csvIndex: 0,
    displayedLiveTrack: null,     
    liveTrackStartTime: 0,        
    liveZoomTriggered: false,     
    activeAnimation: null,          
    liveActivityTime: Date.now(),
    isTransitioning: false,
    modelsLoaded: false // Tracks ML readiness
};

// --- MODULE INTERFACE ---

export async function init(container) {
    console.log("[Albums] Initializing...");
    const session = ++epoch;
    resetState();
    radioCache = null; radioCheckedAt = 0; radioAttemptedKey = ''; radioArtwork = ''; liveArtworkKey = ''; liveArtworkURL = ''; lastFailureAt = 0;
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

    loadFaceModels();
    requestWakeLock();
    if (forcedRadio) {
        container.insertAdjacentHTML('beforeend', '<div id="radio-message" style="position:absolute;inset:0;display:grid;place-items:center;color:white;font:24px system-ui;text-align:center;pointer-events:none;z-index:20">KAN 88 — Connecting…</div>');
    } else await loadCSV(session);
    if (session !== epoch) return;
    await checkLive(session);
}

export function cleanup() {
    console.log("[Albums] Cleaning up...");
    epoch++;
    if (intervals.live) clearTimeout(intervals.live);
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
        displayedLiveTrack: null,
        liveTrackStartTime: 0,
        liveZoomTriggered: false,
        activeAnimation: null,
        liveActivityTime: Date.now(),
        isTransitioning: false,
        modelsLoaded: state.modelsLoaded // Preserve model load state across resets
    };
    intervals = { live: null, csv: null };
}

// --- ML INITIALIZATION ---
async function loadFaceModels() {
    try {
        console.log("[Albums] Loading ML Face Detection Models...");
        await faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODEL_URL);
        state.modelsLoaded = true;
        console.log("[Albums] ML Models Loaded Successfully.");
    } catch (error) {
        console.error("[Albums] Failed to load ML models. Will rely on edge fallback.", error);
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
function performVisualTransition(imageUrl, onSuccessCallback, direct = false) {
    const session = epoch;
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    const loader = new Image();
    if (!direct) loader.crossOrigin = "Anonymous";

    loader.onload = () => {
        if (session !== epoch) return;
        const imgEl = document.getElementById('album-art');
        const bgEl = document.getElementById('bg-layer');
        const wrapperEl = document.getElementById('art-wrapper');

        if (!imgEl || !bgEl || !wrapperEl) return; 

        // 1. Fade out the current image while it is STILL moving/zoomed
        imgEl.style.opacity = '0';
        bgEl.style.opacity = '0';

        // 2. Wait for the screen to go completely dark
        setTimeout(() => {
            if (session !== epoch || !document.getElementById('album-art')) return;

            // 3. Stop the animation and reset positioning silently in the dark
            stopSmartAnimation(); 

            // 4. Swap the actual image source
            if (direct) imgEl.removeAttribute('crossorigin'); else imgEl.crossOrigin = 'anonymous';
            imgEl.src = imageUrl;
            bgEl.style.backgroundImage = `url('${imageUrl}')`;

            wrapperEl.classList.remove('csv-animate');
            void wrapperEl.offsetWidth; 
            
            if (state.currentMode === 'CSV') {
                wrapperEl.classList.add('csv-animate');
            }

            // 5. Fade the new image in
            requestAnimationFrame(() => {
                if (session !== epoch) return;
                imgEl.style.opacity = '1';
                bgEl.style.opacity = '1';

                setTimeout(() => { 
                    if (session !== epoch) return;
                    state.isTransitioning = false;
                    if(onSuccessCallback) onSuccessCallback();
                }, CONFIG.FADE_DURATION);
            });

        }, CONFIG.FADE_DURATION + CONFIG.BLACK_HOLD_DURATION + 100); 
    };

    loader.onerror = () => {
        if (session !== epoch) return;
        state.isTransitioning = false;
        liveArtworkKey = ''; liveArtworkURL = '';
        if (forcedRadio) { radioMessage('KAN 88 — Artwork unavailable; retrying'); }
        else if (!state.displayedLiveTrack && state.currentMode==='LIVE') startCsvMode();
        console.warn("Failed to load image:", imageUrl);
    };

    loader.src = imageUrl;
    return true;
}

// --- HELPER: START CSV MODE ---
function startCsvMode() {
    if (state.currentMode === 'CSV' && intervals.csv) return;
    console.log("Starting CSV Mode");
    
    state.currentMode = 'CSV';
    
    if (intervals.csv) clearInterval(intervals.csv);
    triggerCsvUpdate(); 
    intervals.csv = setInterval(triggerCsvUpdate, CONFIG.CSV_INTERVAL_MS);
}

// --- WIIM / KAN 88 PLAYBACK ---
const params = new URLSearchParams(location.search);
const host = params.get('ip') || '';
const forcedRadio = params.get('source') === 'kan88';
function privateIP(v) {
    const p = v.split('.');
    return p.length === 4 && p.every(x => /^\d{1,3}$/.test(x) && Number(x)<=255) &&
        (p[0]==='10' || (p[0]==='192' && p[1]==='168') || (p[0]==='172' && +p[1]>=16 && +p[1]<=31));
}
const wiimBase = privateIP(host) ? 'https://' + host : null;
const clean = v => typeof v === 'string' && !/^(unknown?|unknown|n\/a|null)$/i.test(v.trim()) ? v.trim() : '';
const norm = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function classifyPlayback(status, meta) {
    if (status.status !== 'play' || String(status.mode) !== '1') return 'idle';
    if (/^(radio\s*88\s*fm|kan\s*88|כאן\s*88)$/i.test(clean(meta.title))) return 'radio';
    return clean(meta.title) && clean(meta.artist) && clean(meta.album) ? 'music' : 'idle';
}
async function getJSON(url, timeout=4000) {
    const ctrl = new AbortController(), t = setTimeout(()=>ctrl.abort(),timeout);
    try { const r = await fetch(url,{signal:ctrl.signal}); if(!r.ok)throw Error('HTTP '+r.status); return await r.json(); }
    finally {clearTimeout(t);}
}
function enterLive() {
    if(intervals.csv)clearInterval(intervals.csv);
    intervals.csv=null;
    state.currentMode='LIVE';
}
function showLive(key,url,direct=false) {
    if (!url || state.isTransitioning) return;
    if (state.currentMode==='LIVE' && state.displayedLiveTrack===key) { checkSmartZoomTimer(); return; }
    enterLive();
    state.liveTrackStartTime=Date.now();
    state.liveZoomTriggered=false;
    performVisualTransition(url,()=>{state.displayedLiveTrack=key;radioMessage('');},direct);
}
function radioMessage(message) {
    const node=document.getElementById('radio-message');
    if(node){node.textContent=message;node.style.display=message?'grid':'none';}
}
function enterIdle() {
    if(forcedRadio){if(!state.displayedLiveTrack)radioMessage('KAN 88 — Waiting for a live song');return;}
    state.displayedLiveTrack=null;
    liveArtworkKey=''; liveArtworkURL='';
    if (!state.isTransitioning) startCsvMode();
}
async function radioSource(session) {
    const now=Date.now();
    if (now-radioCheckedAt>=CONFIG.RADIO_POLL_INTERVAL || !radioCheckedAt) {
        radioCheckedAt=now;
        const response=await getJSON('https://www.kan.org.il/api/arc-cloud/get-live-track-data?channelId=4',10000);
        if(session!==epoch)return;
        radioCache=response;
    }
    if(session!==epoch)return;
    const x=radioCache||{},title=clean(x.title),artists=Array.isArray(x.artists)?x.artists.map(clean).filter(Boolean):[];
    const end=Date.parse(x.endTime), start=Date.parse(x.startTime);
    if (!title || !artists.length || !Number.isFinite(end) || !Number.isFinite(start) || now>end+15000 || now<start-60000) {
        if (state.currentMode==='LIVE' && state.displayedLiveTrack?.startsWith('radio|')) return;
        enterIdle(); return;
    }
    const key='radio|'+title+'|'+artists.join('|')+'|'+start;
    if(radioAttemptedKey!==key){
        const match=await resolveArtwork(title,artists);
        if(session!==epoch)return;
        radioAttemptedKey=key;
        radioArtwork=match?.image||'';
    }
    if(session!==epoch)return;
    if(radioArtwork)showLive(key,radioArtwork,true);
    else if(!state.displayedLiveTrack?.startsWith('radio|')) { if(forcedRadio)radioMessage('KAN 88 — No matching cover for '+title+' — '+artists.join(', '));else enterIdle(); }
}
async function checkLive(session) {
    if(session!==epoch)return;
    let delay=CONFIG.LIVE_POLL_INTERVAL;
    try {
        if(forcedRadio){await radioSource(session);delay=CONFIG.RADIO_POLL_INTERVAL;}
        else if(!wiimBase){enterIdle();delay=5000;}
        else {
            const [status,data]=await Promise.all(['getPlayerStatus','getMetaInfo'].map(c=>getJSON(wiimBase+'/httpapi.asp?command='+c)));
            if(session!==epoch)return;
            const meta=data.metaData||{},mode=classifyPlayback(status,meta);
            if(mode==='radio')await radioSource(session);
            else if(mode==='music'){
                const key='music|'+[meta.artist,meta.album,meta.title].join('|');
                if(liveArtworkKey!==key){
                    const url=new URL(meta.albumArtURI||'/data/AirplayArtWorkData.jpeg',wiimBase);
                    if(url.origin!==wiimBase)throw Error('Unexpected artwork origin');
                    url.searchParams.set('t',Date.now());
                    liveArtworkKey=key;liveArtworkURL=url.href;
                }
                showLive(key,liveArtworkURL,true);
            } else enterIdle();
        }
        lastFailureAt=0;
    }catch(err){
        if(session!==epoch)return;
        console.warn('[Albums] Playback source unavailable',err);
        if(!lastFailureAt)lastFailureAt=Date.now();
        if(forcedRadio) {if(!state.displayedLiveTrack)radioMessage('KAN 88 — Connection failed: '+err.message);}
        else if(state.currentMode==='STARTUP'||Date.now()-lastFailureAt>CONFIG.LIVE_FAILURE_GRACE_MS)enterIdle();
        delay=5000;
    }finally{if(session===epoch)intervals.live=setTimeout(()=>checkLive(session),delay);}
}

// --- SMART ZOOM LOGIC ---

function checkSmartZoomTimer() {
    if (state.currentMode !== 'LIVE') return;
    if (state.liveZoomTriggered) return;
    if (state.isTransitioning) return;

    const timePlaying = Date.now() - state.liveTrackStartTime;
    if (timePlaying > CONFIG.SMART_ZOOM_DELAY) {
        state.liveZoomTriggered = true;
        runSmartZoomSequence();
    }
}

async function runSmartZoomSequence() {
    const imgEl = document.getElementById('album-art');
    const wrapperEl = document.getElementById('art-wrapper');
    if (!imgEl || !wrapperEl) return;

    // Await the ML analysis
    const session=epoch;
    const key=state.displayedLiveTrack;
    let points;
    try { points = await analyzeImageForCrops(imgEl); } catch(err) { console.warn('Artwork cannot be analyzed by canvas',err); return; }
    if(session!==epoch||key!==state.displayedLiveTrack)return;
    
    if (!points || points.length === 0) {
        console.log("No features detected. Staying full screen.");
        return;
    }

    const isFaceMode = points[0].type === 'face';
    console.log(`Running in ${isFaceMode ? 'FACE' : 'EDGE'} mode. Points found: ${points.length}`);

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const rect = wrapperEl.getBoundingClientRect();

    const scaleToCoverX = winW / rect.width;
    const scaleToCoverY = winH / rect.height;
    const minCoverScale = Math.max(scaleToCoverX, scaleToCoverY) * 1.05;

    const baseZoom = isFaceMode ? CONFIG.FACE_ZOOM_DEPTH : CONFIG.EDGE_ZOOM_DEPTH;
    let requiredScale = minCoverScale * baseZoom;
    
    points.forEach(p => {
        const dx = Math.abs(50 - p.x) / 100;
        const dy = Math.abs(50 - p.y) / 100;
        
        const safeDx = Math.min(dx, 0.40); 
        const safeDy = Math.min(dy, 0.40);
        
        const reqX = (winW / 2) / ((0.5 - safeDx) * rect.width);
        const reqY = (winH / 2) / ((0.5 - safeDy) * rect.height);
        
        requiredScale = Math.max(requiredScale, reqX * 1.05, reqY * 1.05);
    });

    const maxScaleMult = isFaceMode ? 3.5 : 1.6;
    const targetScale = Math.min(requiredScale, minCoverScale * maxScaleMult);

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

    const T_MOVE = CONFIG.TRANSITION_TIME; 
    const T_HOLD = CONFIG.HOLD_TIME;       
    const N = points.length;
    
    const totalDuration = ((N + 1) * T_MOVE) + (N * T_HOLD);
    const butteryEase = 'cubic-bezier(0.65, 0, 0.15, 1)';

    const keyframes = [];
    let currentTime = 0;

    keyframes.push({ 
        transform: 'translate(0px, 0px) scale(1)', 
        offset: 0,
        easing: butteryEase 
    });

    points.forEach((point) => {
        currentTime += T_MOVE;
        keyframes.push({ 
            transform: getTransform(point), 
            offset: currentTime / totalDuration,
            easing: 'linear' 
        });
        
        currentTime += T_HOLD;
        keyframes.push({ 
            transform: getTransform(point), 
            offset: currentTime / totalDuration,
            easing: butteryEase 
        });
    });

    currentTime += T_MOVE;
    keyframes.push({ 
        transform: 'translate(0px, 0px) scale(1)', 
        offset: 1 
    });

    state.activeAnimation = wrapperEl.animate(keyframes, {
        duration: totalDuration,
        fill: 'forwards'
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

// --- NEW ML SCANNER ---
async function analyzeImageForCrops(imgElement) {
    const imgWidth = imgElement.naturalWidth || imgElement.width;
    const imgHeight = imgElement.naturalHeight || imgElement.height;

    // 1. Try ML Face Detection First
    if (state.modelsLoaded && window.faceapi) {
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
        const detections = await faceapi.detectAllFaces(imgElement, options);

        if (detections && detections.length > 0) {
            return detections.map(det => {
                const box = det.box;
                const centerX = box.x + (box.width / 2);
                // Shift the target UP by 20% of the bounding box height to include the hair/forehead.
                // (0.5 is the exact center. We use 0.3 to aim higher up the Y-axis)
                const centerY = box.y + (box.height * 0.3); 

                return {
                    type: 'face',
                    x: (centerX / imgWidth) * 100,
                    y: (centerY / imgHeight) * 100
                };
            });
        }
    }

    // 2. Fallback to Edge Detection
    return fallbackEdgeDetection(imgElement, imgWidth, imgHeight);
}

// --- FALLBACK EDGE DETECTOR ---
function fallbackEdgeDetection(imgElement, sourceWidth, sourceHeight) {
    const RES = 150;
    const canvas = document.createElement('canvas');
    canvas.width = RES;
    canvas.height = RES;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    try {
        ctx.drawImage(imgElement, 0, 0, RES, RES);
    } catch(e) {
        return null;
    }

    const pixels = ctx.getImageData(0, 0, RES, RES).data;
    const edgeScores = new Float32Array(RES * RES);

    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i]; const g = pixels[i+1]; const b = pixels[i+2];
        let edge = 0;
        if ((i/4) % RES < RES - 1) {
            edge = Math.abs(r - pixels[i+4]) + Math.abs(g - pixels[i+5]) + Math.abs(b - pixels[i+6]);
        }
        edgeScores[i/4] = edge;
    }

    const edgeCropSize = Math.floor(RES / 3); 
    let edges = [];
    let tempEdgeScores = new Float32Array(edgeScores);

    for (let k = 0; k < 3; k++) {
        let maxEdge = -1;
        let bestX = 0, bestY = 0;

        for (let y = 0; y <= RES - edgeCropSize; y += 2) {
            for (let x = 0; x <= RES - edgeCropSize; x += 2) {
                let edgeSum = 0;
                for (let sy = 0; sy < edgeCropSize; sy += 5) {
                    for (let sx = 0; sx < edgeCropSize; sx += 5) {
                        edgeSum += tempEdgeScores[(y + sy) * RES + (x + sx)];
                    }
                }
                if (edgeSum > maxEdge) {
                    maxEdge = edgeSum;
                    bestX = x;
                    bestY = y;
                }
            }
        }

        if (maxEdge > 1000) {
            edges.push({
                type: 'edge',
                x: ((bestX + edgeCropSize/2) / RES) * 100,
                y: ((bestY + edgeCropSize/2) / RES) * 100
            });
            for (let by = bestY; by < bestY + edgeCropSize; by++) {
                for (let bx = bestX; bx < bestX + edgeCropSize; bx++) {
                    if (by < RES && bx < RES) tempEdgeScores[by * RES + bx] = -99999;
                }
            }
        } else {
            break;
        }
    }

    return edges;
}

// --- HELPERS ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

async function loadCSV(session) {
    try {
        const response = await fetch(CONFIG.CSV_FILENAME);
        if (!response.ok) return; 
        const csv = await response.text();
        if(session===epoch)parseCSV(csv);
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

    const session=epoch;
    fetchItunesById(track.id, (url) => {
        if(session!==epoch || state.currentMode!=='CSV')return;
        if (url) performVisualTransition(url);
        else {
             state.csvIndex = (state.csvIndex + 1) % state.csvTrackList.length;
             setTimeout(()=>{if(session===epoch)triggerCsvUpdate();}, 1000); 
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

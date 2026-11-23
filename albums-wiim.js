import { resolveArtwork } from './radio-artwork.js?v=2';
/**
 * ALBUMS MODULE (Full-Screen Immersion Edition with ML Face Detection)
 */

// --- CONFIGURATION ---
const CONFIG = {
    CSV_FILENAME: 'applemusic-3.csv',
    EXACT_ARTWORK_FILENAME: 'random-artwork.json',
    EXACT_ARTWORK_REMOTE: 'https://sadke8465.github.io/CRT_CLOCK_ALBUM/random-artwork.json',
    EXACT_ARTWORK_REFRESH_MS: 15 * 60 * 1000, 
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
    RADIO_POLL_INTERVAL: 10000,
    RADIO_GAP_POLL_INTERVAL: 5000,
    LIVE_FAILURE_GRACE_MS: 10000,
    IDLE_GRACE_MS: 10000,

    // ML Model URL (using a fast CDN for the weights)
    MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'
};

// --- STATE MANAGEMENT ---
let intervals = { live: null, csv: null, pool: null };
let catalogTracks=[], exactTracks=[], exactImageKeys=new Set(), poolSignature='';
let radioInGap = false;
let idleSince=0, hadLivePlayback=false;
let albumSource='auto', radioSelected=false, lastRadioCover='', lastRadioKey='', radioRetryAt=0, radioLookupKey='', radioWantedKey='';
let epoch = 0, radioCache = null, radioCheckedAt = 0, radioAttemptedKey = '', radioArtwork = '', liveArtworkKey = '', liveArtworkURL = '', lastFailureAt = 0;

let state = {
    startupDone: false,
    hasArtwork: false,
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

export async function init(container, config={}) {
    console.log("[Albums] Initializing...");
    const session = ++epoch;
    resetState();
    idleSince=0;hadLivePlayback=false;catalogTracks=[];exactTracks=[];exactImageKeys=new Set();poolSignature='';
    albumSource=['auto','kan88','random'].includes(config?.source)?config.source:(params.get('source')==='kan88'?'kan88':'auto');
    radioSelected=albumSource==='kan88';lastRadioCover='';lastRadioKey='';radioRetryAt=0;radioLookupKey='';radioWantedKey='';
    try{const last=JSON.parse(localStorage.getItem('crt-kan88-last')||'null');if(last&&last.image){lastRadioCover=last.image;lastRadioKey=last.key||'radio|cached';}}catch{}
    radioInGap = false; radioCache = null; radioCheckedAt = 0; radioAttemptedKey = ''; radioArtwork = ''; liveArtworkKey = ''; liveArtworkURL = ''; lastFailureAt = 0;
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
    if (isForcedRadio()) {
        container.insertAdjacentHTML('beforeend', '<div id="radio-message" style="position:absolute;inset:0;display:grid;place-items:center;color:white;font:24px system-ui;text-align:center;pointer-events:none;z-index:20">KAN 88 — Connecting…</div>');
    }
    await loadCSV(session);
    if (session !== epoch) return;
    refreshExactArtwork(session);
    intervals.pool=setInterval(()=>refreshExactArtwork(session),CONFIG.EXACT_ARTWORK_REFRESH_MS);
    if(isForcedRadio()){
        holdRadioArtwork();
    }
    await checkLive(session);
}

export function cleanup() {
    console.log("[Albums] Cleaning up...");
    epoch++;
    if (intervals.live) clearTimeout(intervals.live);
    if (intervals.csv) clearInterval(intervals.csv);
    if (intervals.pool) clearInterval(intervals.pool);
    stopSmartAnimation(); 
    resetState();
}

function resetState() {
    state = {
        startupDone: false,
        hasArtwork: false,
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
    intervals = { live: null, csv: null, pool: null };
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
function performVisualTransition(imageUrl, onSuccessCallback, direct = false, valid = () => true) {
    const session = epoch;
    if (state.isTransitioning) return false; 
    state.isTransitioning = true;

    const loader = new Image();
    if (!direct) loader.crossOrigin = "Anonymous";

    loader.onload = () => {
        if (session !== epoch) return;
        if(!valid()){state.isTransitioning=false;return;}
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
            if(!valid()){imgEl.style.opacity=state.hasArtwork?'1':'0';bgEl.style.opacity=state.hasArtwork?'1':'0';state.isTransitioning=false;return;}

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
                state.hasArtwork=true;
                radioMessage('');

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
        if(state.currentMode==='CSV'&&valid()){setTimeout(()=>{if(session===epoch&&state.currentMode==='CSV')triggerCsvUpdate();},5000);return;}
        liveArtworkKey = ''; liveArtworkURL = '';
        if(radioSelected&&imageUrl===lastRadioCover){lastRadioCover='';lastRadioKey='';try{localStorage.removeItem('crt-kan88-last');}catch{}}
        if(radioSelected&&imageUrl===radioArtwork){radioArtwork='';radioRetryAt=Date.now()+30000;}
        if (radioSelected && !state.hasArtwork) { if(state.currentMode==='LIVE')startCsvMode();else if(state.currentMode==='CSV')setTimeout(()=>{if(session===epoch&&state.currentMode==='CSV')triggerCsvUpdate();},1000); }
        else if (!state.hasArtwork && !hadLivePlayback && state.currentMode==='LIVE') startCsvMode();
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
const isForcedRadio = () => albumSource === 'kan88';
function privateIP(v) {
    const p = v.split('.');
    return p.length === 4 && p.every(x => /^\d{1,3}$/.test(x) && Number(x)<=255) &&
        (p[0]==='10' || (p[0]==='192' && p[1]==='168') || (p[0]==='172' && +p[1]>=16 && +p[1]<=31));
}
const wiimBase = privateIP(host) ? 'https://' + host : null;
const clean = v => typeof v === 'string' && !/^(unknown?|unknown|n\/a|null)$/i.test(v.trim()) ? v.trim() : '';
const norm = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function classifyPlayback(status, meta) {
    if (status.status !== 'play') return 'idle';
    if (/^(radio\s*88\s*fm|kan\s*88|כאן\s*88)$/i.test(clean(meta.title))) return 'radio';
    if(String(status.mode)!=='1')return 'idle';
    return clean(meta.title) && clean(meta.artist) && clean(meta.album) ? 'music' : 'idle';
}
async function getJSON(url, timeout=4000) {
    const ctrl = new AbortController(), t = setTimeout(()=>ctrl.abort(),timeout);
    try {
        let r; try { r=await fetch(url,{signal:ctrl.signal,credentials:'omit',cache:'no-cache'}); } catch(e) { throw Error('Network request failed: '+e.message); }
        if(!r.ok)throw Error('HTTP '+r.status);
        const raw=(await r.text()).replace(/^\uFEFF/,'').trim();
        if(!raw)return null;
        try{return JSON.parse(raw);}catch{throw Error('Invalid metadata response');}
    }
    finally {clearTimeout(t);}
}
function enterLive() {
    if(intervals.csv)clearInterval(intervals.csv);
    intervals.csv=null;
    state.currentMode='LIVE';
}
function showLive(key,url,direct=false) {
    if (!url) return;
    // Stop fallback immediately on confirmed playback, even if a random cover is loading.
    enterLive();
    if (state.isTransitioning) return;
    if (state.currentMode==='LIVE' && state.displayedLiveTrack===key) { checkSmartZoomTimer(); return; }
    state.liveTrackStartTime=Date.now();
    state.liveZoomTriggered=false;
    performVisualTransition(url,()=>{state.displayedLiveTrack=key;radioMessage('');if(key.startsWith('radio|')&&key!=='radio|cached'){lastRadioCover=url;lastRadioKey=key;try{localStorage.setItem('crt-kan88-last',JSON.stringify({image:url,key,time:Date.now()}));}catch{}}},direct);
}
function radioMessage(message) {
    const node=document.getElementById('radio-message');
    if(node){const visible=message&&!state.hasArtwork;node.textContent=visible?message:'';node.style.display=visible?'grid':'none';}
}
function holdRadioArtwork() {
    if(state.isTransitioning)return;
    if(state.displayedLiveTrack?.startsWith('radio|')) {enterLive();return;}
    if(lastRadioCover){showLive(lastRadioKey||'radio|cached',lastRadioCover,true);return;}
    if(state.hasArtwork){enterLive();return;}
    startCsvMode();
}
function markPlaybackActive(){idleSince=0;hadLivePlayback=true;}
function handlePlaybackGap(){
    if(!idleSince)idleSince=Date.now();
    // AirPlay briefly reports missing/paused metadata between tracks.
    if(hadLivePlayback&&Date.now()-idleSince<CONFIG.IDLE_GRACE_MS)return;
    enterIdle();
}
function enterIdle() {
    if(isForcedRadio()){holdRadioArtwork();return;}
    if(state.isTransitioning)return;
    radioSelected=false;radioWantedKey='';
    state.displayedLiveTrack=null;
    liveArtworkKey=''; liveArtworkURL='';
    if (!state.isTransitioning) startCsvMode();
}
async function radioSource(session) {
    radioSelected=true;
    holdRadioArtwork();
    const now=Date.now();
    if (now-radioCheckedAt>=(radioInGap?CONFIG.RADIO_GAP_POLL_INTERVAL:CONFIG.RADIO_POLL_INTERVAL) || !radioCheckedAt) {
        radioCheckedAt=now;
        let response;
        try { response=await getJSON('https://www.kan.org.il/api/arc-cloud/get-live-track-data?channelId=4',10000); }
        catch(e){radioCheckedAt=0;radioInGap=true;console.warn('Kan metadata unavailable',e);holdRadioArtwork();return;}
        if(session!==epoch)return;
        radioCache=response;
    }
    if(session!==epoch)return;
    const x=radioCache||{},title=clean(x.title),artists=Array.isArray(x.artists)?x.artists.map(clean).filter(Boolean):[];
    const end=Date.parse(x.endTime), start=Date.parse(x.startTime);
    if (!title || !artists.length || !Number.isFinite(end) || !Number.isFinite(start) || now>end+15000 || now<start-60000) {
        radioInGap=true;
        radioWantedKey='';
        holdRadioArtwork();return;
    }
    radioInGap=false;
    const key='radio|'+title+'|'+artists.join('|')+'|'+start;
    radioWantedKey=key;
    if(!radioLookupKey&&(radioAttemptedKey!==key||(!radioArtwork&&Date.now()>=radioRetryAt))){
        radioLookupKey=key;
        if(isForcedRadio()&&!state.hasArtwork)radioMessage('KAN 88 — Finding cover: '+title+' — '+artists.join(', '));
        resolveArtwork(title,artists).then(match=>{
            if(session!==epoch||radioWantedKey!==key||!radioSelected)return;
            radioAttemptedKey=key;radioArtwork=match?.image||'';radioRetryAt=Date.now()+30000;
        }).catch(err=>{
            if(session!==epoch||radioWantedKey!==key)return;
            console.warn('Artwork search failed',err);radioAttemptedKey=key;radioArtwork='';radioRetryAt=Date.now()+30000;
        }).finally(()=>{if(session===epoch&&radioLookupKey===key)radioLookupKey='';});
    }
    if(radioAttemptedKey===key&&radioArtwork)showLive(key,radioArtwork,true);
    else holdRadioArtwork();
}
async function checkLive(session) {
    if(session!==epoch)return;
    let delay=CONFIG.LIVE_POLL_INTERVAL;
    try {
        if(albumSource==='random'){enterIdle();delay=5000;}
        else if(isForcedRadio()){await radioSource(session);delay=radioInGap?CONFIG.RADIO_GAP_POLL_INTERVAL:CONFIG.RADIO_POLL_INTERVAL;}
        else if(!wiimBase){enterIdle();delay=5000;}
        else {
            const [status,data]=await Promise.all(['getPlayerStatus','getMetaInfo'].map(c=>getJSON(wiimBase+'/httpapi.asp?command='+c)));
            if(session!==epoch)return;
            const meta=data.metaData||{},mode=classifyPlayback(status,meta);
            if(mode==='radio'){markPlaybackActive();await radioSource(session);}
            else if(mode==='music'){
                markPlaybackActive();enterLive();
                radioSelected=false;radioWantedKey='';
                const key='music|'+[meta.artist,meta.album,meta.title].join('|');
                if(liveArtworkKey!==key){
                    const url=new URL(meta.albumArtURI||'/data/AirplayArtWorkData.jpeg',wiimBase);
                    if(url.origin!==wiimBase)throw Error('Unexpected artwork origin');
                    url.searchParams.set('t',Date.now());
                    liveArtworkKey=key;liveArtworkURL=url.href;
                }
                showLive(key,liveArtworkURL,true);
            } else handlePlaybackGap();
        }
        lastFailureAt=0;
    }catch(err){
        if(session!==epoch)return;
        console.warn('[Albums] Playback source unavailable',err);
        if(!lastFailureAt)lastFailureAt=Date.now();
        if(isForcedRadio()||radioSelected) {holdRadioArtwork();}
        else if(state.currentMode==='STARTUP'||Date.now()-lastFailureAt>CONFIG.LIVE_FAILURE_GRACE_MS)handlePlaybackGap();
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

function artworkKey(value) {
    try{
        const url=new URL(value);
        if(url.protocol!=='https:'||!/(^|\.)mzstatic\.com$/i.test(url.hostname)||url.username||url.password||url.port)return '';
        return url.pathname.replace(/\/\d+x\d+[^/]*\.(?:jpg|jpeg|png|webp)$/i,'');
    }catch{return '';}
}
function readExactArtwork(manifest){
    if(manifest?.schemaVersion!==1||!Array.isArray(manifest.entries))return null;
    const images=new Set(),result=[];
    for(const entry of manifest.entries.slice(0,5000)){
        const key=artworkKey(entry?.image);
        if(!key||images.has(key)||!/^\d+$/.test(String(entry.id||'')))continue;
        images.add(key);result.push({id:String(entry.id),image:entry.image});
    }
    return result;
}
function rebuildArtworkPool(){
    const ids=new Set(exactTracks.map(x=>x.id));
    exactImageKeys=new Set(exactTracks.map(x=>artworkKey(x.image)));
    const merged=[...exactTracks,...catalogTracks.filter(x=>!ids.has(x.id))];
    const signature=JSON.stringify(merged);
    if(signature===poolSignature)return;
    poolSignature=signature;
    state.csvTrackList=merged;
    shuffleArray(state.csvTrackList);state.csvIndex=0;
    console.log('Artwork pool:',exactTracks.length,'exact covers +',merged.length-exactTracks.length,'catalog tracks');
}
async function refreshExactArtwork(session){
    try{
        const data=await getJSON(CONFIG.EXACT_ARTWORK_REMOTE,10000);
        const entries=readExactArtwork(data);
        if(session!==epoch||!entries?.length)return;
        exactTracks=entries;rebuildArtworkPool();
    }catch(e){console.debug('Using bundled artwork pool',e);}
}
async function loadCSV(session) {
    const tasks=[
        fetch(CONFIG.CSV_FILENAME).then(r=>{if(!r.ok)throw Error('CSV HTTP '+r.status);return r.text();}).then(csv=>{if(session===epoch)parseCSV(csv);}),
        fetch(CONFIG.EXACT_ARTWORK_FILENAME).then(r=>{if(!r.ok)throw Error('Manifest HTTP '+r.status);return r.json();}).then(data=>{if(session!==epoch)return;const entries=readExactArtwork(data);if(entries?.length)exactTracks=entries;})
    ];
    await Promise.allSettled(tasks);
    if(session===epoch)rebuildArtworkPool();
}
function parseCSV(text) {
    const lines=text.split('\n').filter(l=>l.trim()!=='');
    if(lines.length<2)return;
    const headers=lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idIndex=headers.indexOf('id');if(idIndex===-1)return;
    const splitRegex=/,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    const seen=new Set();
    for(let i=1;i<lines.length;i++){
        const cols=lines[i].split(splitRegex).map(c=>c.replace(/^"|"$/g,'').trim());
        const id=cols[idIndex];
        if(!/^\d+$/.test(id||'')||seen.has(id))continue;
        seen.add(id);catalogTracks.push({id});
    }
}
function triggerCsvUpdate() {
    if(state.currentMode!=='CSV'||state.isTransitioning||!state.csvTrackList.length)return;
    const track=state.csvTrackList[state.csvIndex];if(!track)return;
    state.csvIndex=(state.csvIndex+1)%state.csvTrackList.length;
    const session=epoch;
    const valid=()=>session===epoch&&state.currentMode==='CSV';
    const retry=()=>{if(valid())setTimeout(()=>{if(valid())triggerCsvUpdate();},1000);};
    if(track.image){
        // Exact image supplied by the Apple Music playlist, no catalog search.
        performVisualTransition(track.image,null,false,valid);return;
    }
    fetchItunesById(track.id,url=>{
        if(!valid())return;
        if(!url||exactImageKeys.has(artworkKey(url))){retry();return;}
        performVisualTransition(url,null,false,valid);
    });
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

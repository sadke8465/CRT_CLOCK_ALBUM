// clock.js

let frameId = null;
let resizeHandler = null;

export function init(container) {
    console.log("Starting Discrete Analog Clock (Thick Minute Hand)...");

    // 1. Inject Fonts and Styles dynamically
    const fontId = 'clock-font-geist';
    if (!document.getElementById(fontId)) {
        const link = document.createElement('link');
        link.id = fontId;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap';
        document.head.appendChild(link);
    }

    // 2. Setup DOM (Canvas)
    container.innerHTML = ''; // Clear previous content
    container.style.position = 'relative'; 
    container.style.overflow = 'hidden';
    container.style.backgroundColor = '#fea500'; // Orange Background

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    // Optimization: Disable alpha channel as we paint the full background
    const ctx = canvas.getContext('2d', { alpha: false }); 

    // --- Configuration Constants ---
    const STRETCH_FACTOR = 1.35; // Horizontal Stretch

    const COLORS = {
        bg: '#fea500', 
        face: '#ffffff',
        ticks: '#111111',
        text: '#111111',
        handOutline: '#111111',
        handFill: '#ffffff', 
        secondHand: '#fea500', 
        rim: '#dddddd'
    };

    // --- State ---
    const state = {
        secRotation: 0,
        minRotation: 0,
        hourRotation: 0,
        width: 0,
        height: 0,
        radius: 0,
        scale: 1
    };

    // --- Helpers ---
    function drawRoundedRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r); 
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function drawTick(ctx, y, w, h) {
        ctx.fillStyle = COLORS.ticks;
        ctx.fillRect(-w/2, y, w, h);
    }

    // --- Resize Logic ---
    const resize = () => {
        state.width = container.clientWidth;
        state.height = container.clientHeight;
        
        const dpr = window.devicePixelRatio || 1;
        canvas.width = state.width * dpr;
        canvas.height = state.height * dpr;
        
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        state.scale = dpr;

        const maxRadiusHeight = state.height / 2;
        const maxRadiusWidth = (state.width / 2) / STRETCH_FACTOR;

        state.radius = Math.min(maxRadiusHeight, maxRadiusWidth) * 0.85;
    };
    
    window.addEventListener('resize', resize);
    resizeHandler = resize; 
    resize();

    // --- Animation Loop ---
    const tick = () => {
        const now = new Date();
        const currentSec = now.getSeconds();
        const currentMin = now.getMinutes();
        const currentHour = now.getHours();

        // 1. Logic Update
        
        // Instant Second Hand: purely integer based (0-59)
        state.secRotation = (currentSec / 60) * Math.PI * 2;

        // Instant Minute Hand: purely integer based (0-59)
        state.minRotation = (currentMin / 60) * Math.PI * 2;

        // Hour Hand: Moves once per minute (snaps with the minute hand)
        state.hourRotation = ((currentHour % 12 + currentMin / 60) / 12) * Math.PI * 2;

        // 2. Drawing
        const r = state.radius;
        const cx = state.width / 2;
        const cy = state.height / 2;

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, state.width, state.height);

        ctx.save();
        ctx.translate(cx, cy);
        
        // APPLY STRETCH
        ctx.scale(STRETCH_FACTOR, 1); 

        // Body & Face
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.rim;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.face;
        ctx.fill();

        // Numbers
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = COLORS.text;
        const fontSize = r * 0.125;
        ctx.font = `300 ${fontSize}px "Geist", sans-serif`;

        for (let i = 1; i <= 12; i++) {
            const angle = (i * (Math.PI * 2 / 12));
            ctx.save();
            ctx.rotate(angle);
            const numDist = r * 0.72; 
            ctx.translate(0, -numDist);
            ctx.rotate(-angle); 
            ctx.fillText(i.toString(), 0, 0);
            ctx.restore();
        }

        // Ticks
        for (let i = 0; i < 60; i++) {
            const angle = (i * (Math.PI * 2 / 60));
            ctx.save();
            ctx.rotate(angle);
            if (i % 5 !== 0) {
                ctx.translate(0, -r * 0.9);
                drawTick(ctx, 0, r*0.005, r*0.03); 
            } else {
                ctx.translate(0, -r * 0.9);
                drawTick(ctx, 0, r*0.010, r*0.06); 
            }
            ctx.restore();
        }

        // Hands Helper
        const drawCompositeHand = (length, width) => {
            ctx.fillStyle = COLORS.handOutline;
            drawRoundedRect(ctx, -width/2, -length, width, length + width, width/3);
            ctx.fill();

            ctx.fillStyle = COLORS.handFill;
            const inset = width * 0.2;
            drawRoundedRect(ctx, -width/2 + inset, -length + inset, width - inset*2, length * 0.8, width/4);
            ctx.fill();
        };

        // Hour Hand (Width: 0.06)
        ctx.save();
        ctx.rotate(state.hourRotation); 
        drawCompositeHand(r * 0.5, r * 0.06);
        ctx.restore();

        // Minute Hand (Width: 0.06 - Match Hour Hand)
        ctx.save();
        ctx.rotate(state.minRotation);
        drawCompositeHand(r * 0.8, r * 0.06);
        ctx.restore();

        // Second Hand (Orange)
        ctx.save();
        ctx.rotate(state.secRotation); 
        
        ctx.fillStyle = COLORS.secondHand;
        ctx.fillRect(-r*0.01, -r*0.85, r*0.02, r*1.1); 
        
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.04, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.01, 0, Math.PI * 2);
        ctx.fillStyle = "#cc8400"; 
        ctx.fill();
        
        ctx.restore(); // End second hand
        ctx.restore(); // End translate

        frameId = requestAnimationFrame(tick);
    };
    
    // Start Loop
    tick();
}

export function cleanup() {
    console.log("Stopping Analog Clock...");
    if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = null;
    }
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
    }
}

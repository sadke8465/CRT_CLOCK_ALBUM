// marquee.js — Scrolling text marquee display module
// Contract: init(stage, cfg), cleanup(), updateConfig(cfg)

const DEFAULTS = {
    message:          'Hello',
    direction:        'left',   // 'left' | 'right' | 'up' | 'down'
    textSize:         80,        // px
    gap:              200,       // px between repetitions
    speed:            100,       // px / second
    textColor:        '#ffffff',
    bgColor:          '#000000',
    horizontalStretch: 1.0,
    fontFamily:       'SF Pro Display',
    fontWeight:       400,
};

const MAX_COPIES = 500;

let stageEl   = null;
let config    = { ...DEFAULTS };
let rafHandle = null;
let offset    = 0;
let lastTs    = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fontCSS(family, weight) {
    return `font-family:'Apple Color Emoji','${family}','Segoe UI Emoji','Noto Color Emoji',` +
           `-apple-system,BlinkMacSystemFont,sans-serif;font-weight:${weight};`;
}

function measureText(message, textSize, fontFamily, fontWeight) {
    const probe = document.createElement('span');
    probe.style.cssText =
        `position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;` +
        `white-space:nowrap;font-size:${textSize}px;${fontCSS(fontFamily, fontWeight)}` +
        `unicode-bidi:plaintext;`;
    probe.textContent = message || ' ';
    document.body.appendChild(probe);
    const w = probe.offsetWidth;
    const h = probe.offsetHeight;
    document.body.removeChild(probe);
    return { w, h };
}

function isHoriz(dir) {
    return dir === 'left' || dir === 'right';
}

// ── DOM build ─────────────────────────────────────────────────────────────────

function build() {
    stageEl.innerHTML = '';

    const { message, direction, textSize, textColor, bgColor, gap,
            horizontalStretch, fontFamily, fontWeight } = config;
    const horiz = isHoriz(direction);

    stageEl.style.cssText =
        `position:relative;width:100%;height:100vh;overflow:hidden;` +
        `background:${bgColor};`;

    const { w: textW, h: textH } = measureText(message, textSize, fontFamily, fontWeight);
    const textDim = horiz ? (textW || textSize) : (textH || textSize);
    const unit    = textDim + gap;

    const screenDim = horiz
        ? (stageEl.offsetWidth  || window.innerWidth)
        : (stageEl.offsetHeight || window.innerHeight);

    const copies = Math.min(Math.ceil(screenDim / unit) + 3, MAX_COPIES);

    // Stretch wrapper: fills stage, applies horizontal scale from screen center
    const stretchEl = document.createElement('div');
    stretchEl.id = 'mq-stretch';
    stretchEl.style.cssText =
        `position:absolute;top:0;left:0;right:0;bottom:0;` +
        `transform:scaleX(${horizontalStretch});transform-origin:center center;`;

    // Runner: the scrolling strip
    const runner = document.createElement('div');
    runner.id = 'mq-runner';
    runner.setAttribute('data-unit', unit);

    if (horiz) {
        runner.style.cssText =
            `position:absolute;top:50%;left:0;` +
            `display:flex;flex-direction:row;align-items:center;` +
            `white-space:nowrap;will-change:transform;`;
    } else {
        runner.style.cssText =
            `position:absolute;left:50%;top:0;` +
            `display:flex;flex-direction:column;align-items:center;` +
            `will-change:transform;`;
    }

    for (let i = 0; i < copies; i++) {
        const span = document.createElement('span');
        span.textContent = message || ' ';
        span.style.cssText =
            `font-size:${textSize}px;color:${textColor};` +
            fontCSS(fontFamily, fontWeight) +
            `-webkit-font-smoothing:antialiased;` +
            `unicode-bidi:plaintext;` +
            `flex-shrink:0;display:${horiz ? 'inline-block' : 'block'};` +
            (horiz
                ? `margin-right:${gap}px;`
                : `margin-bottom:${gap}px;text-align:center;`);
        runner.appendChild(span);
    }

    stretchEl.appendChild(runner);
    stageEl.appendChild(stretchEl);

    // Right/Down start at unit so they scroll toward 0 first (content appears from correct edge)
    offset = (direction === 'right' || direction === 'down') ? unit : 0;
    lastTs = null;
}

// ── RAF tick ──────────────────────────────────────────────────────────────────

function applyTransform(runner, unit) {
    const horiz = isHoriz(config.direction);
    if (horiz) {
        runner.style.transform = `translateX(-${offset}px) translateY(-50%)`;
    } else {
        runner.style.transform = `translateX(-50%) translateY(-${offset}px)`;
    }
}

function tick(ts) {
    if (!stageEl) return;
    if (lastTs === null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;

    const runner = document.getElementById('mq-runner');
    if (!runner) return;

    const unit = parseFloat(runner.getAttribute('data-unit'));

    if (config.direction === 'left' || config.direction === 'up') {
        offset += config.speed * dt;
        if (offset >= unit) offset -= unit;
    } else {
        offset -= config.speed * dt;
        if (offset <= 0) offset += unit;
    }

    applyTransform(runner, unit);
    rafHandle = requestAnimationFrame(tick);
}

// ── Module interface ──────────────────────────────────────────────────────────

export function init(stage, cfg = {}) {
    stageEl = stage;
    config  = { ...DEFAULTS, ...cfg };
    build();
    rafHandle = requestAnimationFrame(tick);
    // Rebuild after web fonts load for accurate text measurements
    document.fonts.ready.then(() => {
        if (stageEl) {
            if (rafHandle !== null) cancelAnimationFrame(rafHandle);
            build();
            rafHandle = requestAnimationFrame(tick);
        }
    });
}

export function cleanup() {
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
    if (stageEl) stageEl.innerHTML = '';
    stageEl = null;
    lastTs  = null;
    offset  = 0;
    config  = { ...DEFAULTS };
}

export function updateConfig(cfg = {}) {
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
    config = { ...config, ...cfg };
    build();
    rafHandle = requestAnimationFrame(tick);
}

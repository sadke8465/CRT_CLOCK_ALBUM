// clock.js

let resizeHandler = null;
let dateCheckInterval = null;
let styleElement = null;

export function init(container) {
    console.log("Starting Real-Time Dot Calendar...");

    // --- Configuration ---
    const CONFIG = {
        fontName: 'LostTrialVAR',
        fontUrl: 'LostTrialVAR.ttf', // Ensure this file is in your root folder
        colors: ['#4BC30B', '#2094F3', '#FFD53F', '#F35020'],
        stretchFactor: 1.35,
        maxFrontDots: 5,
        dotSize: 120 // Increased dot size
    };

    let currentDate = new Date().getDate(); // Start with real date

    // --- 1. Inject Styles Dynamically ---
    const styleId = 'dot-calendar-styles';
    if (!document.getElementById(styleId)) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.textContent = `
            @font-face {
                font-family: '${CONFIG.fontName}';
                src: url('${CONFIG.fontUrl}') format('truetype');
            }

            .dc-wrapper {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%) scaleX(${CONFIG.stretchFactor});
                width: calc(100% / ${CONFIG.stretchFactor}); 
                height: 100%;
                position: relative;
                overflow: hidden;
            }

            .dc-number {
                font-family: '${CONFIG.fontName}', sans-serif;
                color: #292821;
                /* Font size is set via JS now */
                line-height: 0;
                font-stretch: condensed;
                font-variation-settings: "wdth" 50;
                z-index: 10;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                user-select: none;
                white-space: nowrap;
                pointer-events: none;
            }

            .dc-dot {
                position: absolute;
                width: ${CONFIG.dotSize}px;
                height: ${CONFIG.dotSize}px;
                border-radius: 50%;
                transition: top 0.5s ease, left 0.5s ease;
                pointer-events: none;
            }

            .dc-dot.front { z-index: 20; }
            .dc-dot.back { z-index: 1; }
        `;
        document.head.appendChild(styleElement);
    }

    // --- 2. Setup DOM ---
    container.innerHTML = ''; 
    container.style.position = 'relative'; 
    container.style.overflow = 'hidden';
    container.style.backgroundColor = '#fcfbf7'; // Cream background
    container.style.userSelect = 'none';

    // Create the internal wrapper that handles the stretch
    const wrapper = document.createElement('div');
    wrapper.className = 'dc-wrapper';
    container.appendChild(wrapper);

    // Create the Number element
    const dateDisplay = document.createElement('div');
    dateDisplay.className = 'dc-number';
    dateDisplay.innerText = currentDate.toString().padStart(2, '0');
    wrapper.appendChild(dateDisplay);

    // --- 3. Logic ---

    const generateDots = () => {
        // Ensure text matches current date
        dateDisplay.innerText = currentDate.toString().padStart(2, '0');

        // Clear existing dots
        const existingDots = wrapper.querySelectorAll('.dc-dot');
        existingDots.forEach(d => d.remove());

        // Calculate Boundaries
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        
        const maxX = width - CONFIG.dotSize;
        const maxY = height - CONFIG.dotSize;

        let dotsInFrontCount = 0;

        for (let i = 0; i < currentDate; i++) {
            const dot = document.createElement('div');
            dot.className = 'dc-dot';

            // Color
            const randomColor = CONFIG.colors[Math.floor(Math.random() * CONFIG.colors.length)];
            dot.style.backgroundColor = randomColor;

            // Position
            const x = Math.random() * maxX;
            const y = Math.random() * maxY;
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;

            // Layer (Front/Back)
            const wantsFront = Math.random() < 0.5;
            if (wantsFront && dotsInFrontCount < CONFIG.maxFrontDots) {
                dot.classList.add('front');
                dotsInFrontCount++;
            } else {
                dot.classList.add('back');
            }

            wrapper.appendChild(dot);
        }
    };

    const updateLayout = () => {
        const h = container.clientHeight;
        const w = container.clientWidth;

        // Font Sizing Logic:
        // 1. Height Constraint: 85% of container height
        const sizeByHeight = h * 0.85;

        // 2. Width Constraint: Ensure text fits within width
        // The wrapper is narrower (w / 1.35). 
        // We assume the font aspect ratio is roughly 0.6 (width/height) for 2 digits.
        // We divide by 0.7 to be safe (so it doesn't touch edges).
        const effectiveWidth = w / CONFIG.stretchFactor; 
        const sizeByWidth = effectiveWidth / 0.7; 

        // Pick the smaller of the two to guarantee full visibility
        const finalSize = Math.min(sizeByHeight, sizeByWidth);

        dateDisplay.style.fontSize = `${finalSize}px`;
        
        generateDots();
    };

    // Check for date change every minute
    const checkDate = () => {
        const now = new Date();
        const newDate = now.getDate();
        if (newDate !== currentDate) {
            currentDate = newDate;
            generateDots();
        }
    };

    // --- 4. Event Listeners ---
    
    // Resize
    resizeHandler = () => {
        updateLayout();
    };
    window.addEventListener('resize', resizeHandler);

    // Start Date Checker (runs every 60s)
    dateCheckInterval = setInterval(checkDate, 60000);

    // Initial render
    setTimeout(updateLayout, 0);
}

export function cleanup() {
    console.log("Stopping Dot Calendar...");
    
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
    }

    if (dateCheckInterval) {
        clearInterval(dateCheckInterval);
        dateCheckInterval = null;
    }
    
    const styleEl = document.getElementById('dot-calendar-styles');
    if (styleEl) {
        styleEl.remove();
    }
}

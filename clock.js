// clock.js

let resizeHandler = null;
let clickHandler = null;
let styleElement = null;

export function init(container) {
    console.log("Starting Dot Calendar...");

    // --- Configuration ---
    const CONFIG = {
        fontName: 'LostTrialVAR',
        fontUrl: 'LostTrialVAR.ttf', // Ensure this file exists relative to index
        colors: ['#4BC30B', '#2094F3', '#FFD53F', '#F35020'],
        stretchFactor: 1.35,
        maxFrontDots: 5,
        dotSize: 30
    };

    let currentDate = 8;

    // --- 1. Inject Styles Dynamically ---
    const styleId = 'dot-calendar-styles';
    if (!document.getElementById(styleId)) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        // Added font-size fallback to 85vh
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
                font-size: 85vh; /* Fallback size */
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
    container.style.cursor = 'pointer';
    container.style.userSelect = 'none';

    // Create the internal wrapper that handles the stretch
    const wrapper = document.createElement('div');
    wrapper.className = 'dc-wrapper';
    container.appendChild(wrapper);

    // Create the Number element
    const dateDisplay = document.createElement('div');
    dateDisplay.className = 'dc-number';
    dateDisplay.innerText = '08';
    wrapper.appendChild(dateDisplay);

    // --- 3. Logic ---

    // Define generateDots first to ensure it's available for updateLayout
    const generateDots = () => {
        // Update Text
        dateDisplay.innerText = currentDate.toString().padStart(2, '0');

        // Clear existing dots
        const existingDots = wrapper.querySelectorAll('.dc-dot');
        existingDots.forEach(d => d.remove());

        // Calculate Boundaries
        // We use the wrapper's dimensions. 
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
        // Dynamic Font Sizing: 85% of the container height
        const h = container.clientHeight;
        dateDisplay.style.fontSize = `${h * 0.85}px`;
        
        generateDots();
    };

    // --- 4. Event Listeners ---
    
    // Resize
    resizeHandler = () => {
        updateLayout();
    };
    window.addEventListener('resize', resizeHandler);

    // Click (Increment Date)
    clickHandler = () => {
        currentDate++;
        if (currentDate > 31) currentDate = 1;
        generateDots();
    };
    container.addEventListener('click', clickHandler);

    // Initial render
    // Small timeout to ensure container has dimensions if mounted immediately
    setTimeout(updateLayout, 0);
}

export function cleanup() {
    console.log("Stopping Dot Calendar...");
    
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
    }

    if (clickHandler) {
         // Note: If you attached the click listener to 'container', 
         // it gets removed when 'container.innerHTML' is cleared by the next init(),
         // so explicit removal isn't strictly necessary but is good practice if keeping the same reference.
         clickHandler = null;
    }
    
    // Optional: Remove the injected styles to keep DOM clean
    const styleEl = document.getElementById('dot-calendar-styles');
    if (styleEl) {
        styleEl.remove();
    }
}

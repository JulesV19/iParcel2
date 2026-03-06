// ── Search, Sliders, Year/Region Selectors & Satellite Filters ──

import { showToast } from '../shared/utils.js';

// Module-level state
let searchTimeout;

// These will be set via setDependencies()
let map = null;
let mapReady = false;
let satelliteState = null;

// Satellite helpers (injected)
let clearSatelliteOverlayFromMiniMap = null;
let satelliteVizLoadAll = null;
let displayCachedSatelliteNDVI = null;

/**
 * Inject runtime dependencies that live in the main app scope.
 *
 * @param {object} deps
 * @param {mapboxgl.Map} deps.map
 * @param {function(): boolean} deps.isMapReady
 * @param {object} deps.satelliteState
 * @param {function} deps.clearSatelliteOverlayFromMiniMap
 * @param {function} deps.satelliteVizLoadAll
 * @param {function} deps.displayCachedSatelliteNDVI
 */
export function setDependencies(deps) {
    map = deps.map;
    if (typeof deps.isMapReady === 'function') {
        mapReady = deps.isMapReady;
    }
    satelliteState = deps.satelliteState;
    clearSatelliteOverlayFromMiniMap = deps.clearSatelliteOverlayFromMiniMap;
    satelliteVizLoadAll = deps.satelliteVizLoadAll;
    displayCachedSatelliteNDVI = deps.displayCachedSatelliteNDVI;
}

function isReady() {
    return typeof mapReady === 'function' ? mapReady() : mapReady;
}

// ── flyToResult (called from suggestion buttons) ──

export function flyToResult(lng, lat, label) {
    map.flyTo({ center: [lng, lat], zoom: 13 });
    document.getElementById('address-input').value = label;
    document.getElementById('suggestions').classList.remove('open');
    showToast(`Navigation vers ${label}`, "\uD83D\uDCCD");
}

// ── Address Search (BAN API) with debounce ──

export function setupSearch(map) {
    if (!localStorage.getItem('iparcel_visited')) {
        document.getElementById('first-visit-banner').classList.remove('hidden');
    }

    const input = document.getElementById('address-input');
    const sugBox = document.getElementById('suggestions');

    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = input.value.trim();
        if (q.length < 3) { sugBox.classList.remove('open'); return; }
        sugBox.innerHTML = '<div class="suggestions-loading">Recherche\u2026</div>';
        sugBox.classList.add('open');
        searchTimeout = setTimeout(async () => {
            try {
                const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
                const data = await r.json();
                if (data.features && data.features.length) {
                    // Safe DOM construction (no innerHTML with external data)
                    sugBox.innerHTML = '';
                    data.features.forEach(f => {
                        const [lng, lat] = f.geometry.coordinates;
                        const label = f.properties.label;
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.addEventListener('click', () => flyToResult(lng, lat, label));

                        const iconSpan = document.createElement('span');
                        iconSpan.className = 'sug-icon';
                        iconSpan.textContent = '\uD83D\uDCCD';
                        btn.appendChild(iconSpan);

                        btn.appendChild(document.createTextNode(' ' + label));
                        sugBox.appendChild(btn);
                    });
                    sugBox.classList.add('open');
                } else {
                    sugBox.innerHTML = '<div class="suggestions-empty">Aucun r\u00e9sultat</div>';
                    sugBox.classList.add('open');
                }
            } catch (e) {
                sugBox.innerHTML = '<div class="suggestions-error">Recherche indisponible. R\u00e9essayez plus tard.</div>';
                sugBox.classList.add('open');
            }
        }, 300);
    });

    input.addEventListener('blur', () => setTimeout(() => sugBox.classList.remove('open'), 200));
}

// ── Opacity & Outline Sliders ──

export function setupSliders(map) {
    // Opacity slider
    document.getElementById('opacity-slider').addEventListener('input', function () {
        const val = this.value;
        document.getElementById('opacity-value').textContent = val;
        if (!isReady()) return;

        const year = document.getElementById('year-select').value;
        const op = val / 100;

        // Apply opacity to ALL regions of the selected year
        map.getStyle().layers.forEach(lyr => {
            if (lyr.id.startsWith('lyr-') && lyr.id.includes(`_${year}`) && !lyr.id.includes('outline') && !lyr.id.includes('highlight')) {
                map.setPaintProperty(lyr.id, 'fill-opacity', op);
            }
        });
    });

    // Outline slider
    document.getElementById('outline-slider').addEventListener('input', function () {
        const val = parseFloat(this.value);
        document.getElementById('outline-value').textContent = val;
        if (!isReady()) return;

        const year = document.getElementById('year-select').value;

        // Apply width to ALL "line" layers of the selected year
        map.getStyle().layers.forEach(lyr => {
            if (lyr.id.startsWith('lyr-') && lyr.id.includes(`_${year}`) && lyr.type === 'line') {
                map.setPaintProperty(lyr.id, 'line-width', val);
            }
        });
    });
}

// ── Year Selector ──

/**
 * @param {mapboxgl.Map} map
 * @param {object} callbacks
 * @param {function} callbacks.ensureLayer
 * @param {function} callbacks.updateMapColors
 * @param {function} callbacks.updateStats
 * @param {function} callbacks.applyFilter
 */
export function setupYearSelector(map, callbacks) {
    const { ensureLayer, updateStats, applyFilter } = callbacks;

    document.getElementById('year-select').addEventListener('change', function () {
        if (!isReady()) return;
        const year = this.value;
        const op = document.getElementById('opacity-slider').value / 100;
        const region = document.getElementById('region-select').value;

        // Load layers needed for the new year
        if (region === 'ALL') {
            [...document.getElementById('region-select').options]
                .map(o => o.value).filter(v => v !== 'ALL')
                .forEach(r => ensureLayer(year, r));
        } else {
            ensureLayer(year, region);
        }

        // Hide all layers except the selected year
        // Layers are named lyr-{REGION}_{year}, not lyr-{year}
        map.getStyle().layers.forEach(lyr => {
            if (lyr.id.startsWith('lyr-') && lyr.id !== 'highlight-fill') {
                const isSelected = lyr.id.includes(`_${year}`);
                // In single-region mode, only show the correct region
                const isCorrectRegion = region === 'ALL' || lyr.id.includes(region);
                const visible = isSelected && isCorrectRegion;
                if (lyr.type === 'fill') {
                    map.setPaintProperty(lyr.id, 'fill-opacity', visible ? op : 0);
                } else if (lyr.type === 'line' && lyr.id.endsWith('-outline')) {
                    map.setPaintProperty(lyr.id, 'line-opacity', visible ? 1 : 0);
                }
            }
        });
        applyFilter();
        updateStats();
    });
}

// ── Satellite Filter Listeners ──

export function setupSatelliteFilters() {
    const monthNames = ["Janvier", "F\u00e9vrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Ao\u00fbt", "Septembre", "Octobre", "Novembre", "D\u00e9cembre"];

    function applySatelliteFilters() {
        // 1. Update state
        satelliteState.maxClouds = parseInt(document.getElementById('sat-filter-cloud').value);
        satelliteState.maxSnow = parseInt(document.getElementById('sat-filter-snow').value);

        // 2. Clear cache because criteria have changed
        satelliteState.cache = {};
        clearSatelliteOverlayFromMiniMap();

        // 3. Relaunch global search
        satelliteVizLoadAll();
    }

    document.getElementById('sat-filter-cloud')?.addEventListener('input', function () {
        document.getElementById('sat-filter-cloud-val').innerText = this.value + '%';
    });
    document.getElementById('sat-filter-snow')?.addEventListener('input', function () {
        document.getElementById('sat-filter-snow-val').innerText = this.value + '%';
    });

    const satSlider = document.getElementById('satellite-viz-slider');
    const satDateLabel = document.getElementById('satellite-viz-date');

    if (satSlider) {
        satSlider.addEventListener('input', function () {
            const val = parseInt(this.value);
            const year = 2020 + Math.floor(val / 12);
            const monthIdx = val % 12;
            const monthStr = String(monthIdx + 1).padStart(2, '0');

            satelliteState.year = year;
            satelliteState.month = monthStr;

            if (satDateLabel) satDateLabel.textContent = `${monthNames[monthIdx]} ${year}`;

            const cacheKey = `${year}-${monthStr}`;
            const statusEl = document.getElementById('satellite-status');
            const cacheVal = satelliteState.cache[cacheKey];

            if (cacheVal === 'ERROR') {
                if (statusEl) statusEl.innerText = `\u274C Image trop nuageuse pour ${monthNames[monthIdx]} ${year}.`;
                clearSatelliteOverlayFromMiniMap();
            } else if (cacheVal) {
                displayCachedSatelliteNDVI(cacheKey);
            } else {
                if (statusEl) statusEl.innerText = `Recherche d'image claire pour ${monthNames[monthIdx]} ${year}...`;
                clearSatelliteOverlayFromMiniMap();
            }
        });
    }
}

// ── Region Selector ──

/**
 * @param {mapboxgl.Map} map
 * @param {object} callbacks
 * @param {function} callbacks.ensureLayer
 * @param {function} callbacks.updateMapColors
 * @param {function} callbacks.updateStats
 * @param {function} callbacks.loadRegionalWeather
 */
export function setupRegionSelector(map, callbacks) {
    const { ensureLayer, updateStats, loadRegionalWeather } = callbacks;

    document.getElementById('region-select').addEventListener('change', function () {
        const year = document.getElementById('year-select').value;
        const region = this.value;
        const op = document.getElementById('opacity-slider').value / 100;

        // List of ALL available regions
        const allRegions = [...document.getElementById('region-select').options]
            .map(o => o.value).filter(v => v !== 'ALL');

        if (region === "ALL") {
            // 1. Load each region for the chosen year
            allRegions.forEach(r => ensureLayer(year, r));

            // 2. Make all layers of this year visible
            map.getStyle().layers.forEach(lyr => {
                if (lyr.id.startsWith('lyr-') && !lyr.id.includes('highlight')) {
                    const isCorrectYear = lyr.id.includes(`_${year}`);
                    const isFill = !lyr.id.includes('outline');
                    map.setPaintProperty(lyr.id, isFill ? 'fill-opacity' : 'line-opacity', isCorrectYear ? (isFill ? op : 1) : 0);
                }
            });
            showToast("Affichage de toutes les r\u00e9gions", "\uD83C\uDF1F");
        } else {
            // Single region mode
            ensureLayer(year, region);
            const activeLyrId = `lyr-${region}_${year}`;
            map.getStyle().layers.forEach(lyr => {
                if (lyr.id.startsWith('lyr-') && !lyr.id.includes('highlight')) {
                    const isTarget = lyr.id.startsWith(activeLyrId);
                    const isFill = !lyr.id.includes('outline');
                    map.setPaintProperty(lyr.id, isFill ? 'fill-opacity' : 'line-opacity', isTarget ? (isFill ? op : 1) : 0);
                }
            });
            showToast(`R\u00e9gion ${region} activ\u00e9e`, "\uD83C\uDF0D");
            // applyFilter is imported via callbacks if needed; the original code called it here
            // but it was from the global scope - callers should wire it up if needed
        }

        // Load weather for the selected region
        loadRegionalWeather(region);

        updateStats();
    });
}

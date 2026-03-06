// ── Satellite NDVI Viewer Module ──
// Displays pre-computed NDVI/RGB images from backend (Supabase Storage).
// No client-side NDVI computation — backend handles everything.

import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import Chart from 'chart.js/auto';
import { basemaps } from '../shared/constants.js';

// ── Dependencies injected via setDependencies ──
let map = null;
let satelliteMiniMap = null;

export function setDependencies(deps) {
    if (deps.map) map = deps.map;
    if (deps.satelliteMiniMap !== undefined) satelliteMiniMap = deps.satelliteMiniMap;
}

export function getSatelliteMiniMap() { return satelliteMiniMap; }
export function setSatelliteMiniMap(val) { satelliteMiniMap = val; }

// ── Module-level state ──
export let satelliteMiniMapReady = false;
let ndviChart = null;

export const satelliteState = {
    parcelId: null,
    feature: null,
    year: 2023,
    month: '12',
    mode: 'ndvi',
    cache: {},
    isLoading: false
};

// Fonction appelée quand on clique sur les boutons radio
export function changeSatelliteMode(mode) {
    satelliteState.mode = mode;

    const legend = document.getElementById('satellite-legend');
    if (legend) legend.style.opacity = mode === 'ndvi' ? '1' : '0';

    const cacheKey = `${satelliteState.year}-${satelliteState.month}`;
    if (satelliteState.cache[cacheKey] && satelliteState.cache[cacheKey] !== 'ERROR') {
        displayCachedSatelliteNDVI(cacheKey);
    }
}

/**
 * Initialise l'état Satellite pour la parcelle sélectionnée.
 * Affiche les données pré-calculées depuis le backend ou un message d'analyse en cours.
 */
export function initSatelliteViz(parcelId, feature, { exploitationParcelles }) {
    if (satelliteState.parcelId === parcelId) return;

    satelliteState.parcelId = parcelId;
    satelliteState.feature = feature;
    satelliteState.cache = {};

    clearSatelliteOverlay();

    if (satelliteMiniMap) {
        satelliteMiniMap.remove();
        satelliteMiniMap = null;
    }
    satelliteMiniMapReady = false;

    const container = document.getElementById('satellite-render-container');
    if (!container) return;

    // ── VÉRIFICATION EXPLOITATION ──
    const inExploitation = exploitationParcelles.find(p => p.parcel_id === parcelId);
    const placeholder = document.getElementById('satellite-placeholder');
    const statusEl = document.getElementById('satellite-status');
    const sliderEl = document.getElementById('satellite-viz-slider');

    const existingMsg = document.getElementById('sat-lock-message');
    if (existingMsg) existingMsg.remove();

    if (!inExploitation) {
        if (placeholder) placeholder.classList.remove('hidden');
        if (statusEl) statusEl.innerText = "";

        const msgDiv = document.createElement('div');
        msgDiv.id = 'sat-lock-message';
        msgDiv.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255,255,255,0.85); backdrop-filter: blur(2px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            z-index: 10; text-align: center; padding: 20px;
        `;
        msgDiv.innerHTML = `
            <div style="font-size: 2rem; margin-bottom: 10px;">🔒</div>
            <h3 style="margin: 0 0 5px 0; color: var(--text-main);">Données Satellite Verrouillées</h3>
            <p style="margin: 0 0 15px 0; color: var(--text-muted); font-size: 0.9rem;">
                Ajoutez cette parcelle à votre exploitation pour accéder à l'historique NDVI.
            </p>
            <button class="auth-btn" style="width:auto; padding:8px 16px;" onclick="triggerAddParcel()">
                + Ajouter à mon exploitation
            </button>
        `;
        container.style.position = 'relative';
        container.appendChild(msgDiv);

        if (sliderEl) sliderEl.disabled = true;
        return;
    }

    // CAS : Parcelle suivie
    if (sliderEl) sliderEl.disabled = false;
    if (placeholder) placeholder.classList.remove('hidden');

    // Charger les données pré-calculées depuis Supabase
    const ndviData = inExploitation.ndvi_data;
    const hasData = ndviData && typeof ndviData === 'object' && Object.keys(ndviData).length > 0;
    const analysisInProgress = inExploitation.analysis_status && inExploitation.analysis_status !== 'Terminée' && inExploitation.analysis_status !== 'Erreur';

    if (hasData) {
        satelliteState.cache = ndviData;
    }

    // Show loader if analysis is in progress
    const loader = document.getElementById('satellite-loader');
    const loaderText = document.getElementById('satellite-loader-text');
    const loaderBar = document.getElementById('satellite-loader-bar');

    if (analysisInProgress) {
        const progress = inExploitation.analysis_progress || 0;
        if (loader) loader.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (loaderText) loaderText.innerText = `${inExploitation.analysis_status || 'Analyse satellite...'} (${progress}%)`;
        if (loaderBar) loaderBar.style.width = `${progress}%`;
        if (statusEl) {
            statusEl.innerText = `Analyse en cours... (${progress}%)`;
            statusEl.style.color = '#f59e0b';
        }
    } else if (!hasData) {
        if (statusEl) {
            statusEl.innerText = "En attente d'analyse satellite...";
            statusEl.style.color = '#94a3b8';
        }
    }

    const bbox = turf.bbox(feature);
    satelliteMiniMap = new maplibregl.Map({
        container: container,
        style: {
            version: 8,
            sources: {
                "basemap": { type: "raster", tiles: [basemaps[0].tiles], tileSize: 256 }
            },
            layers: [{ id: "basemap", type: "raster", source: "basemap" }]
        },
        bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        fitBoundsOptions: { padding: 20 },
        interactive: true,
        attributionControl: false
    });

    satelliteMiniMap.on('load', () => {
        satelliteMiniMapReady = true;
        satelliteMiniMap.addSource('parcel-outline', {
            type: 'geojson',
            data: feature
        });
        satelliteMiniMap.addLayer({
            id: 'parcel-outline-line',
            type: 'line',
            source: 'parcel-outline',
            paint: { 'line-color': '#ffffff', 'line-width': 2 }
        });

        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            displayCachedSatelliteNDVI(currentKey);
        } else if (!hasData) {
            if (statusEl) statusEl.innerText = analysisInProgress
                ? `Analyse en cours... (${inExploitation.analysis_progress || 0}%)`
                : "Aucune donnée satellite disponible.";
        }

        renderNdviChart(satelliteState.cache);
    });
}

/**
 * Met à jour le cache et l'affichage quand le backend envoie de nouvelles données via realtime.
 */
export function onNdviDataUpdated(parcelId, ndviData, analysisProgress, analysisStatus) {
    if (satelliteState.parcelId !== parcelId) return;

    const statusEl = document.getElementById('satellite-status');
    const loader = document.getElementById('satellite-loader');
    const loaderText = document.getElementById('satellite-loader-text');
    const loaderBar = document.getElementById('satellite-loader-bar');

    if (ndviData && typeof ndviData === 'object') {
        satelliteState.cache = ndviData;
    }

    if (analysisStatus === 'Terminée') {
        // Hide loader
        if (loader) loader.classList.add('hidden');

        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            displayCachedSatelliteNDVI(currentKey);
        } else if (statusEl) {
            statusEl.innerText = "Analyse terminée.";
            statusEl.style.color = '#10b981';
        }
    } else if (analysisProgress !== undefined) {
        // Update loader
        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.innerText = `${analysisStatus || 'Analyse...'} (${analysisProgress}%)`;
        if (loaderBar) loaderBar.style.width = `${analysisProgress}%`;

        // Show newly available image if the user is looking at a month that just got computed
        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            displayCachedSatelliteNDVI(currentKey);
        } else if (statusEl) {
            statusEl.innerText = `Analyse en cours... (${analysisProgress}%)`;
            statusEl.style.color = '#f59e0b';
        }
    }

    renderNdviChart(satelliteState.cache);
}

export function clearSatelliteOverlayFromMiniMap() {
    if (satelliteMiniMap && satelliteMiniMapReady) {
        if (satelliteMiniMap.getLayer('sat-layer')) satelliteMiniMap.removeLayer('sat-layer');
        if (satelliteMiniMap.getSource('sat-source')) satelliteMiniMap.removeSource('sat-source');
    }
}

// NDVI color stops for smooth gradient (same as backend used to have)
const NDVI_STOPS = [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9];
const NDVI_COLORS = [
    [207, 90, 90],    // red
    [207, 90, 90],    // red
    [241, 194, 67],   // yellow
    [197, 216, 109],  // light green
    [99, 163, 85],    // green
    [30, 97, 42],     // dark green
];

// Build a 256-entry lookup table for fast colorization
const ndviLUT = new Uint8Array(256 * 4);
for (let i = 0; i < 256; i++) {
    const ndvi = (i / 127.5) - 1.0; // reverse grayscale→NDVI mapping
    let r, g, b;
    if (ndvi <= NDVI_STOPS[0]) {
        [r, g, b] = NDVI_COLORS[0];
    } else if (ndvi >= NDVI_STOPS[NDVI_STOPS.length - 1]) {
        [r, g, b] = NDVI_COLORS[NDVI_COLORS.length - 1];
    } else {
        // Find segment and interpolate
        for (let s = 0; s < NDVI_STOPS.length - 1; s++) {
            if (ndvi >= NDVI_STOPS[s] && ndvi < NDVI_STOPS[s + 1]) {
                const t = (ndvi - NDVI_STOPS[s]) / (NDVI_STOPS[s + 1] - NDVI_STOPS[s]);
                r = NDVI_COLORS[s][0] + t * (NDVI_COLORS[s + 1][0] - NDVI_COLORS[s][0]);
                g = NDVI_COLORS[s][1] + t * (NDVI_COLORS[s + 1][1] - NDVI_COLORS[s][1]);
                b = NDVI_COLORS[s][2] + t * (NDVI_COLORS[s + 1][2] - NDVI_COLORS[s][2]);
                break;
            }
        }
    }
    ndviLUT[i * 4] = r;
    ndviLUT[i * 4 + 1] = g;
    ndviLUT[i * 4 + 2] = b;
    ndviLUT[i * 4 + 3] = 255;
}

function colorizeNdviImage(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;

            for (let i = 0; i < pixels.length; i += 4) {
                const alpha = pixels[i + 3];
                if (alpha === 0) continue; // keep transparent pixels
                const gray = pixels[i]; // R=G=B in grayscale
                const lutIdx = gray * 4;
                pixels[i] = ndviLUT[lutIdx];
                pixels[i + 1] = ndviLUT[lutIdx + 1];
                pixels[i + 2] = ndviLUT[lutIdx + 2];
                // keep original alpha
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imageUrl); // fallback to raw
        img.src = imageUrl;
    });
}

export async function displayCachedSatelliteNDVI(cacheKey) {
    const data = satelliteState.cache[cacheKey];
    if (!data || data === 'ERROR' || !satelliteMiniMapReady) return;

    const status = document.getElementById('satellite-status');
    status.style.color = '#10b981';
    status.innerText = `✅ Image affichée (${data.date}).`;

    if (satelliteMiniMap.getLayer('sat-layer')) {
        satelliteMiniMap.removeLayer('sat-layer');
        satelliteMiniMap.removeSource('sat-source');
    }

    let imageUrl;
    if (satelliteState.mode === 'rgb') {
        imageUrl = data.rgbUrl;
    } else {
        // Colorize grayscale NDVI → gradient
        imageUrl = await colorizeNdviImage(data.ndviUrl);
    }

    satelliteMiniMap.addSource('sat-source', {
        type: 'image',
        url: imageUrl,
        coordinates: data.coordinates
    });

    satelliteMiniMap.addLayer({
        id: 'sat-layer',
        type: 'raster',
        source: 'sat-source',
        paint: { 'raster-opacity': 1.0, 'raster-resampling': 'linear' }
    });

    if (satelliteMiniMap.getLayer('parcel-outline-line')) {
        satelliteMiniMap.moveLayer('parcel-outline-line');
    }
}

/**
 * Nettoie le calque satellite sur la carte principale
 */
export function clearSatelliteOverlay() {
    if (satelliteState.overlay) {
        map.removeLayer(satelliteState.overlay.id);
        map.removeSource(satelliteState.overlay.id);
        satelliteState.overlay = null;
    }
}

export function getNdviColor(val) {
    if (isNaN(val) || val <= -0.1) return [0, 0, 0, 0];
    if (val < 0.1) return [207, 90, 90, 255];
    if (val < 0.3) return [241, 194, 67, 255];
    if (val < 0.5) return [197, 216, 109, 255];
    if (val < 0.7) return [99, 163, 85, 255];
    return [30, 97, 42, 255];
}

/**
 * Rendu du graphique NDVI Evolution
 */
export function renderNdviChart(cache) {
    const ctx = document.getElementById('satellite-ndvi-chart');
    if (!ctx) return;

    // Extraire et trier les données
    const dataPoints = Object.entries(cache)
        .filter(([key, val]) => val !== 'ERROR' && typeof val === 'object' && val.mean !== undefined)
        .map(([key, val]) => ({
            key,
            date: val.date ? new Date(val.date) : new Date(key + "-01"),
            mean: val.mean
        }))
        .sort((a, b) => a.date - b.date);

    if (dataPoints.length === 0) {
        if (ndviChart) {
            ndviChart.destroy();
            ndviChart = null;
        }
        return;
    }

    const labels = dataPoints.map(p => {
        const d = p.date;
        return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    });
    const values = dataPoints.map(p => p.mean);

    if (ndviChart) {
        ndviChart.data.labels = labels;
        ndviChart.data.datasets[0].data = values;
        ndviChart.update('none'); // Update without animation for smoothness
    } else {
        ndviChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'NDVI Moyen',
                    data: values,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#10b981',
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (context) => `NDVI: ${context.parsed.y.toFixed(3)}`
                        }
                    }
                },
                scales: {
                    y: {
                        min: 0,
                        max: 1,
                        ticks: { stepSize: 0.2 },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8
                        }
                    }
                }
            }
        });
    }
}

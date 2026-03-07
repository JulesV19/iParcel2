// ── Satellite Multi-Index Viewer Module ──
// Displays pre-computed spectral index images from backend (Supabase Storage).
// Supports NDVI, EVI, NDWI, NDMI, SAVI, NDRE, BSI + RGB.

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
let chartIndex = 'ndvi';

export const satelliteState = {
    parcelId: null,
    feature: null,
    year: 2023,
    month: '12',
    mode: 'ndvi',
    cache: {},
    isLoading: false
};

// ── Index metadata: colors, labels, legends ──
const INDEX_META = {
    ndvi: {
        label: 'NDVI',
        legendTitle: 'NDVI — Santé de la végétation',
        gradient: '#cf5a5a, #f1c243, #c5d86d, #63a355, #1e612a',
        legendLow: 'Sol nu / Eau', legendMid: 'Vég. intermédiaire', legendHigh: 'Biomasse dense',
        chartColor: '#10b981',
        stops: [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9],
        colors: [[207,90,90],[207,90,90],[241,194,67],[197,216,109],[99,163,85],[30,97,42]],
    },
    evi: {
        label: 'EVI',
        legendTitle: 'EVI — Végétation amélioré',
        gradient: '#cf5a5a, #f1c243, #c5d86d, #63a355, #1e612a',
        legendLow: 'Faible', legendMid: 'Modéré', legendHigh: 'Dense',
        chartColor: '#059669',
        stops: [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9],
        colors: [[207,90,90],[207,90,90],[241,194,67],[197,216,109],[99,163,85],[30,97,42]],
    },
    ndwi: {
        label: 'NDWI',
        legendTitle: 'NDWI — Stress hydrique',
        gradient: '#8B4513, #D2B48C, #f5f5f5, #87CEEB, #1E90FF',
        legendLow: 'Sec / Végétation', legendMid: 'Neutre', legendHigh: 'Eau / Humide',
        chartColor: '#3b82f6',
        stops: [-0.5, -0.2, 0.0, 0.2, 0.5],
        colors: [[139,69,19],[210,180,140],[245,245,245],[135,206,235],[30,144,255]],
    },
    ndmi: {
        label: 'NDMI',
        legendTitle: 'NDMI — Humidité des cultures',
        gradient: '#cf5a5a, #f1c243, #f5f5dc, #87CEEB, #4169E1',
        legendLow: 'Stress hydrique', legendMid: 'Normal', legendHigh: 'Bien hydraté',
        chartColor: '#6366f1',
        stops: [-0.5, -0.1, 0.1, 0.3, 0.6],
        colors: [[207,90,90],[241,194,67],[245,245,220],[135,206,235],[65,105,225]],
    },
    savi: {
        label: 'SAVI',
        legendTitle: 'SAVI — Végétation ajustée au sol',
        gradient: '#cf5a5a, #f1c243, #c5d86d, #63a355, #1e612a',
        legendLow: 'Sol nu', legendMid: 'Vég. intermédiaire', legendHigh: 'Couvert dense',
        chartColor: '#84cc16',
        stops: [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9],
        colors: [[207,90,90],[207,90,90],[241,194,67],[197,216,109],[99,163,85],[30,97,42]],
    },
    ndre: {
        label: 'NDRE',
        legendTitle: 'NDRE — Chlorophylle / Azote',
        gradient: '#f1c243, #c5d86d, #63a355, #1e612a, #0a3d12',
        legendLow: 'Faible chlorophylle', legendMid: 'Modéré', legendHigh: 'Forte chlorophylle',
        chartColor: '#16a34a',
        stops: [-0.1, 0.1, 0.2, 0.4, 0.6, 0.8],
        colors: [[241,194,67],[241,194,67],[197,216,109],[99,163,85],[30,97,42],[10,61,18]],
    },
    bsi: {
        label: 'BSI',
        legendTitle: 'BSI — Indice de sol nu',
        gradient: '#1e612a, #63a355, #c5d86d, #D2B48C, #8B4513',
        legendLow: 'Végétation dense', legendMid: 'Mixte', legendHigh: 'Sol nu',
        chartColor: '#a16207',
        stops: [-0.5, -0.2, 0.0, 0.2, 0.5],
        colors: [[30,97,42],[99,163,85],[197,216,109],[210,180,140],[139,69,19]],
    },
};

// ── Build LUTs for all indices ──
const indexLUTs = {};
for (const [name, meta] of Object.entries(INDEX_META)) {
    const lut = new Uint8Array(256 * 4);
    const stops = meta.stops;
    const colors = meta.colors;
    for (let i = 0; i < 256; i++) {
        const val = (i / 127.5) - 1.0; // grayscale [0,255] → [-1, 1]
        let r, g, b;
        if (val <= stops[0]) {
            [r, g, b] = colors[0];
        } else if (val >= stops[stops.length - 1]) {
            [r, g, b] = colors[colors.length - 1];
        } else {
            for (let s = 0; s < stops.length - 1; s++) {
                if (val >= stops[s] && val < stops[s + 1]) {
                    const t = (val - stops[s]) / (stops[s + 1] - stops[s]);
                    r = colors[s][0] + t * (colors[s + 1][0] - colors[s][0]);
                    g = colors[s][1] + t * (colors[s + 1][1] - colors[s][1]);
                    b = colors[s][2] + t * (colors[s + 1][2] - colors[s][2]);
                    break;
                }
            }
        }
        lut[i * 4] = r;
        lut[i * 4 + 1] = g;
        lut[i * 4 + 2] = b;
        lut[i * 4 + 3] = 255;
    }
    indexLUTs[name] = lut;
}

function updateLegend(mode) {
    const meta = INDEX_META[mode];
    const legend = document.getElementById('satellite-legend');
    if (!legend) return;

    if (mode === 'rgb' || !meta) {
        legend.style.opacity = '0';
        return;
    }
    legend.style.opacity = '1';

    const title = document.getElementById('satellite-legend-title');
    const gradient = document.getElementById('satellite-legend-gradient');
    const low = document.getElementById('satellite-legend-low');
    const mid = document.getElementById('satellite-legend-mid');
    const high = document.getElementById('satellite-legend-high');

    if (title) title.textContent = meta.legendTitle;
    if (gradient) gradient.style.background = `linear-gradient(to right, ${meta.gradient})`;
    if (low) low.textContent = meta.legendLow;
    if (mid) mid.textContent = meta.legendMid;
    if (high) high.textContent = meta.legendHigh;
}

// Fonction appelée quand on change l'indice dans le dropdown
export function changeSatelliteMode(mode) {
    satelliteState.mode = mode;
    updateLegend(mode);

    const cacheKey = `${satelliteState.year}-${satelliteState.month}`;
    if (satelliteState.cache[cacheKey] && satelliteState.cache[cacheKey] !== 'ERROR') {
        displayCachedSatelliteNDVI(cacheKey);
    }
}

// Fonction appelée quand on change l'indice du graphique
export function changeChartIndex(index) {
    chartIndex = index;
    renderNdviChart(satelliteState.cache);
}

/**
 * Initialise l'état Satellite pour la parcelle sélectionnée.
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
                Ajoutez cette parcelle à votre exploitation pour accéder aux indices spectraux.
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
        if (loader) loader.classList.add('hidden');

        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            displayCachedSatelliteNDVI(currentKey);
        } else if (statusEl) {
            statusEl.innerText = "Analyse terminée.";
            statusEl.style.color = '#10b981';
        }
    } else if (analysisProgress !== undefined) {
        if (loader) loader.classList.remove('hidden');
        if (loaderText) loaderText.innerText = `${analysisStatus || 'Analyse...'} (${analysisProgress}%)`;
        if (loaderBar) loaderBar.style.width = `${analysisProgress}%`;

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

function colorizeIndexImage(imageUrl, indexName) {
    const lut = indexLUTs[indexName] || indexLUTs['ndvi'];
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
                if (alpha === 0) continue;
                const gray = pixels[i];
                const lutIdx = gray * 4;
                pixels[i] = lut[lutIdx];
                pixels[i + 1] = lut[lutIdx + 1];
                pixels[i + 2] = lut[lutIdx + 2];
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imageUrl);
        img.src = imageUrl;
    });
}

export async function displayCachedSatelliteNDVI(cacheKey) {
    const data = satelliteState.cache[cacheKey];
    if (!data || data === 'ERROR' || !satelliteMiniMapReady) return;

    const status = document.getElementById('satellite-status');
    status.style.color = '#10b981';
    status.innerText = `Image affichée (${data.date}).`;

    if (satelliteMiniMap.getLayer('sat-layer')) {
        satelliteMiniMap.removeLayer('sat-layer');
        satelliteMiniMap.removeSource('sat-source');
    }

    const mode = satelliteState.mode;
    let imageUrl;

    if (mode === 'rgb') {
        imageUrl = data.rgbUrl;
    } else {
        // Get the URL for the selected index
        const urlKey = `${mode}Url`;
        const rawUrl = data[urlKey] || data.ndviUrl;
        imageUrl = await colorizeIndexImage(rawUrl, mode);
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
 * Rendu du graphique d'évolution de l'indice sélectionné
 */
export function renderNdviChart(cache) {
    const ctx = document.getElementById('satellite-ndvi-chart');
    if (!ctx) return;

    const idx = chartIndex;
    const meta = INDEX_META[idx];

    // Extraire et trier les données
    const dataPoints = Object.entries(cache)
        .filter(([key, val]) => val !== 'ERROR' && typeof val === 'object')
        .map(([key, val]) => {
            // Support both old format (mean only) and new format (means object)
            let meanVal;
            if (val.means && val.means[idx] !== undefined) {
                meanVal = val.means[idx];
            } else if (idx === 'ndvi' && val.mean !== undefined) {
                meanVal = val.mean;
            } else {
                return null;
            }
            return {
                key,
                date: val.date ? new Date(val.date) : new Date(key + "-01"),
                mean: meanVal
            };
        })
        .filter(p => p !== null)
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
    const color = meta ? meta.chartColor : '#10b981';
    const label = meta ? meta.label + ' Moyen' : 'Indice Moyen';

    if (ndviChart) {
        ndviChart.data.labels = labels;
        ndviChart.data.datasets[0].data = values;
        ndviChart.data.datasets[0].borderColor = color;
        ndviChart.data.datasets[0].pointBackgroundColor = color;
        ndviChart.data.datasets[0].backgroundColor = color + '1a';
        ndviChart.data.datasets[0].label = label;
        ndviChart.update('none');
    } else {
        ndviChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: values,
                    borderColor: color,
                    backgroundColor: color + '1a',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: color,
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
                            label: (context) => `${label}: ${context.parsed.y.toFixed(3)}`
                        }
                    }
                },
                scales: {
                    y: {
                        min: -1,
                        max: 1,
                        ticks: { stepSize: 0.25 },
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

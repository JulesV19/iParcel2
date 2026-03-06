// ── Sidebar Module ──
import * as turf from '@turf/turf';
import { Chart } from 'chart.js/auto';
import { regionToFile, getBucketId, showToast } from '../shared/utils.js';
import { cultureColors, years } from '../shared/constants.js';
import { computeRotationScoreV3 } from '../shared/agronomy.js';

let deps = {};
// ── Dependencies (injected) ──
let map = null;
let isMapReady = () => false;
let renderHistoryWithRecord = null;
let renderSpatialHeatmap = null;
let initParcelViz = null;
let initSatelliteViz = null;
let renderGenealogyTree = null;
let renderLineageGlobalStats = null;
let destroyMiniMap = null;
let cropLabels = {};
let groupLabels = new Map();
let cultureToGroup = {};

export function setDependencies(d) {
    deps = d;
    if (d.map) map = d.map;
    if (d.isMapReady) isMapReady = d.isMapReady;
    if (d.renderHistoryWithRecord) renderHistoryWithRecord = d.renderHistoryWithRecord;
    if (d.renderSpatialHeatmap) renderSpatialHeatmap = d.renderSpatialHeatmap;
    if (d.initParcelViz) initParcelViz = d.initParcelViz;
    if (d.initSatelliteViz) initSatelliteViz = d.initSatelliteViz;
    if (d.renderGenealogyTree) renderGenealogyTree = d.renderGenealogyTree;
    if (d.renderLineageGlobalStats) renderLineageGlobalStats = d.renderLineageGlobalStats;
    if (d.destroyMiniMap) destroyMiniMap = d.destroyMiniMap;
    if (d.cropLabels) cropLabels = d.cropLabels;
    if (d.groupLabels) groupLabels = d.groupLabels;
    if (d.cultureToGroup) cultureToGroup = d.cultureToGroup;
}

// ── State variables ──
export let lineageData = null;
export let lineageStats = null;
export let parentIndex = null;
export let currentParcelId = null;
export let lastDetailParams = null;
export let bucketCache = {};
export let bucketPromises = {};
export let regionalWeatherFeatures = null;

// ── Sidebar highlight ──
export let highlightedFeature = null;

export function clearHighlight() {
    if (!isMapReady()) return;
    try {
        if (map.getSource('highlight-src')) {
            map.getSource('highlight-src').setData({ type: 'FeatureCollection', features: [] });
        }
    } catch (e) { }
    highlightedFeature = null;
}

export function highlightFeature(feature) {
    if (!isMapReady()) return;
    // Create highlight source+layers if they don't exist yet
    if (!map.getSource('highlight-src')) {
        map.addSource('highlight-src', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });
        map.addLayer({
            id: 'highlight-fill', type: 'fill', source: 'highlight-src',
            paint: {
                'fill-color': '#facc15',
                'fill-opacity': 0.35
            }
        });
        map.addLayer({
            id: 'highlight-outline', type: 'line', source: 'highlight-src',
            paint: {
                'line-color': '#facc15',
                'line-width': 3,
                'line-opacity': 1
            }
        });
    }
    // Set the clicked feature as highlight data
    map.getSource('highlight-src').setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
    });
    highlightedFeature = feature;
}

export function toggleSidebar(open) {
    document.getElementById('side-panel').classList.toggle('open', open);
    document.getElementById('map').classList.toggle('sidebar-open', open);
    if (open) document.getElementById('dashboard-panel').classList.remove('open');
    if (!open) { clearHighlight(); destroyMiniMap(); }
    setTimeout(() => map.resize(), 400);
}

// ── Regional Weather ──
export async function loadRegionalWeather(region) {
    if (region !== 'HAUTS_DE_FRANCE') {
        // Pour l'instant on a scrappé que HDF
        regionalWeatherFeatures = null;
        return;
    }
    const fileName = `data/weather_Hauts-de-France.json`;
    try {
        const response = await fetch(fileName);
        if (response.ok) {
            regionalWeatherFeatures = await response.json();
            console.log("[iParcel] Weather data loaded:", regionalWeatherFeatures.features.length, "stations");
        } else {
            regionalWeatherFeatures = null;
        }
    } catch (err) {
        console.error("[iParcel] Error loading weather data:", err);
        regionalWeatherFeatures = null;
    }
}

// ── Weather Fetch (Local JSON & Nearest Point) ──
export async function getRegionalWeather(lat, lng, year) {
    if (!regionalWeatherFeatures || !regionalWeatherFeatures.features) return null;
    try {
        const targetPoint = turf.point([lng, lat]);
        const nearest = turf.nearestPoint(targetPoint, regionalWeatherFeatures);
        if (!nearest) return null;

        const history = nearest.properties.history;
        window.currentStationHistory = history;

        if (!history || !history[year]) return null;

        return {
            stationName: nearest.properties.name,
            yearData: history[year]
        };
    } catch (e) {
        console.error("[iParcel] Weather extraction error", e);
        return null;
    }
}

// ── Bucket loader with Promise cache (region-aware) + retry et structure d'erreur ──
export async function loadBucket(bucketId, explicitRegion, retries = 2) {
    const effectiveRegion = explicitRegion || document.getElementById('region-select').value;
    if (effectiveRegion === "ALL") {
        console.warn('[iParcel] loadBucket appelé sans région explicite en mode ALL');
        return { error: true, message: 'Région non précisée', status: 0 };
    }
    const regionFile = regionToFile(effectiveRegion);
    const cacheKey = `${effectiveRegion}_${bucketId}`;

    if (bucketCache[cacheKey]) return bucketCache[cacheKey];
    if (bucketPromises[cacheKey]) return bucketPromises[cacheKey];

    const url = `data/output_json/${regionFile}_${bucketId}.json`;

    bucketPromises[cacheKey] = (async () => {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    bucketCache[cacheKey] = data;
                    delete bucketPromises[cacheKey];
                    return data;
                }
                if (attempt === retries) {
                    delete bucketPromises[cacheKey];
                    return { error: true, status: response.status, message: response.status === 404 ? 'Données introuvables pour cette zone' : `Erreur ${response.status}` };
                }
            } catch (e) {
                if (attempt === retries) {
                    delete bucketPromises[cacheKey];
                    return { error: true, status: 0, message: 'Connexion impossible. Vérifiez votre réseau.' };
                }
            }
        }
        delete bucketPromises[cacheKey];
        return { error: true, status: 0, message: 'Chargement échoué' };
    })();

    return bucketPromises[cacheKey];
}

export function retryParcelDetails() {
    if (!lastDetailParams) return;
    showDetails(lastDetailParams.e, lastDetailParams.parcelId, lastDetailParams.props, lastDetailParams.parcelRegion);
}

// ── Parcel Details — backend fetch ──
export async function showDetails(e, parcelId, props, parcelRegion) {
    const year = document.getElementById('year-select').value;
    currentParcelId = parcelId;
    lastDetailParams = { e, parcelId, props, parcelRegion };

    console.log(`[iParcel] Recherche via API : ${parcelId}`);

    document.getElementById('parcel-name').innerHTML = "Chargement…";
    document.getElementById('parcel-loading').classList.remove('hidden');
    document.getElementById('parcel-error').classList.add('hidden');
    toggleSidebar(true);

    try {
        const compositeId = `${year}_${parcelId}`;
        const bucket = String(parcelId).slice(-2).padStart(2, '0');
        const data = await loadBucket(bucket, parcelRegion);

        if (data && data.error) {
            document.getElementById('parcel-name').innerHTML = "Erreur";
            document.getElementById('parcel-error-msg').textContent = data.message || "Impossible de charger les données.";
            document.getElementById('parcel-loading').classList.add('hidden');
            document.getElementById('parcel-error').classList.remove('hidden');
            showToast(data.message || "Chargement impossible", "❌");
            return;
        }

        const parcelInfo = data ? data[parcelId] : null;

        // Build full lineage by walking the flat array (same standard as API)
        let record = null;
        if (parcelInfo) {
            record = {
                id: parcelId,
                c: (parcelInfo.cultu_ref || props.CODE_CULTU || "").trim(),
                g: cultureToGroup[(parcelInfo.cultu_ref || props.CODE_CULTU || "").trim()] || "",
                c23: (parcelInfo.cultu_ref || props.CODE_CULTU || "").trim(),
                g23: cultureToGroup[(parcelInfo.cultu_ref || props.CODE_CULTU || "").trim()] || "",
                lineage: {},
                l: {},
                sib: {}
            };
            record.l = record.lineage;

            if (parcelInfo.historique && Array.isArray(parcelInfo.historique)) {
                parcelInfo.historique.forEach(h => {
                    if (!record.lineage[h.annee_hist]) {
                        record.lineage[h.annee_hist] = {
                            c: h.cultu_hist,
                            d1: h.cultu_d1 || null,
                            d2: h.cultu_d2 || null,
                            g: cultureToGroup[h.cultu_hist] || "",
                            cf: h.pct_surface / 100,
                            p: h.id_hist
                        };
                    } else {
                        // split/fusion, rajout dans sib pour afficher
                        if (!record.sib[h.annee_hist]) record.sib[h.annee_hist] = [];
                        record.sib[h.annee_hist].push({
                            id: h.id_hist,
                            c: h.cultu_hist,
                            d1: h.cultu_d1 || null,
                            d2: h.cultu_d2 || null,
                            g: cultureToGroup[h.cultu_hist] || "",
                            cf: h.pct_surface / 100
                        });
                    }
                });
            }
        }

        // Store in lineageData
        if (!lineageData) lineageData = {};
        if (record) lineageData[parcelId] = record;

        // Build parentIndex
        if (!parentIndex) parentIndex = {};
        if (record) {
            const lin = record.lineage || {};
            for (const [yr, entry] of Object.entries(lin)) {
                if (entry.p) {
                    const key = `${entry.p}_${yr}`;
                    if (!parentIndex[key]) parentIndex[key] = [];
                    if (!parentIndex[key].includes(parcelId)) parentIndex[key].push(parcelId);
                }
            }
            for (const [yr, sibs] of Object.entries(record.sib || {})) {
                const parentId = lin[yr]?.p;
                if (parentId) {
                    const key = `${parentId}_${yr}`;
                    if (!parentIndex[key]) parentIndex[key] = [];
                    for (const sib of sibs) {
                        if (!parentIndex[key].includes(sib.id)) parentIndex[key].push(sib.id);
                        if (!lineageData[sib.id]) lineageData[sib.id] = { c23: sib.c, g23: sib.g };
                    }
                }
            }
        }

        // --- Display ---
        const currentCultureCode = (props.CODE_CULTU || "").trim();
        const cropName = cropLabels[currentCultureCode] || currentCultureCode || "Culture inconnue";
        const groupName = groupLabels.get(cultureToGroup[currentCultureCode]) || "";
        const lineage = record ? (record.lineage || {}) : {};
        const lineageYears = Object.keys(lineage);
        const yearsTracked = lineageYears.length > 0 ? lineageYears.length + 1 : 1;
        const siblings = record ? (record.sib || {}) : {};
        const hasSiblings = Object.keys(siblings).length > 0;

        document.getElementById('parcel-name').innerHTML = `${cropName} <span class="culture-badge">${groupName}</span>`;
        document.getElementById('parcel-loading').classList.add('hidden');


        const propSurface = props.SURF_PARC || props.surf_parc || props.surface_ref_m2 || (e && e.features && e.features[0] ? turf.area(e.features[0]) / 10000 : null);
        document.getElementById('info-grid').innerHTML = `
    <div class="info-card"><div class="ic-icon">🆔</div><div class="ic-value" style="font-size:0.7rem;">${parcelId}</div><div class="ic-label">ID Parcelle</div></div>
    <div class="info-card"><div class="ic-icon">📐</div><div class="ic-value">${propSurface ? parseFloat(propSurface).toFixed(2) : '—'} ha</div><div class="ic-label">Surface</div></div>
    <div class="info-card"><div class="ic-icon">📅</div><div class="ic-value">${yearsTracked} an${yearsTracked > 1 ? 's' : ''}</div><div class="ic-label">Historique</div></div>
    <div class="info-card"><div class="ic-icon">🌾</div><div class="ic-value">${props.CODE_CULTU || '—'}</div><div class="ic-label">Code culture</div></div>
    ${hasSiblings ? `<div class="info-card"><div class="ic-icon">✂️</div><div class="ic-value">${Object.values(siblings).flat().length}</div><div class="ic-label">Sœurs</div></div>` : ''}
`;

        const w = await getRegionalWeather(e.lngLat.lat, e.lngLat.lng, year);
        if (w) renderWeatherChart(w, year);
        else {
            const ctx = document.getElementById('weather-chart');
            if (ctx) ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
        }

        renderHistoryWithRecord(parcelId, props, record);

        if (highlightedFeature) {
            renderSpatialHeatmap(parcelId, highlightedFeature, record, parcelRegion);
            initParcelViz(parcelId, highlightedFeature, props, record, parcelRegion);
            initSatelliteViz(parcelId, highlightedFeature, { exploitationParcelles: deps.getExploitationParcelles() });
        }

    } catch (err) {
        console.error("[iParcel] Erreur :", err);
        document.getElementById('parcel-name').innerHTML = "Données indisponibles";
        document.getElementById('parcel-error-msg').textContent = "Une erreur s'est produite. Vérifiez votre connexion ou réessayez.";
        document.getElementById('parcel-loading').classList.add('hidden');
        document.getElementById('parcel-error').classList.remove('hidden');
        showToast("Impossible de charger les données", "❌");
    }
}

// ── Weather Chart ──
let weatherChart = null;

export function renderWeatherChart(w, year) {
    const ctx = document.getElementById('weather-chart').getContext('2d');
    if (weatherChart) weatherChart.destroy();

    // Agro calendar: Sept to Aug
    const monthOrder = ["09", "10", "11", "12", "01", "02", "03", "04", "05", "06", "07", "08"];
    const monthLabels = ["Sep", "Oct", "Nov", "Déc", "Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû"];

    const tempData = [];
    const rainData = [];

    monthOrder.forEach(m => {
        const d = w.yearData[m];
        if (d) {
            tempData.push(d.t_mean);
            rainData.push(d.precip);
        } else {
            tempData.push(null);
            rainData.push(null);
        }
    });

    weatherChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthLabels,
            datasets: [
                {
                    label: 'Précipitations (mm)', data: rainData,
                    backgroundColor: 'rgba(59,130,246,0.3)', borderColor: '#3b82f6',
                    borderWidth: 1, borderRadius: 4, yAxisID: 'y1'
                },
                {
                    label: 'Temp. moyenne (°C)', data: tempData,
                    type: 'line', borderColor: '#ef4444',
                    backgroundColor: 'rgba(239,68,68,0.1)', fill: true,
                    tension: 0.4, pointRadius: 3, pointBackgroundColor: '#ef4444',
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, labels: { font: { size: 10 }, usePointStyle: true } },
                title: { display: true, text: `Station météo la plus proche : ${w.stationName} (Campagne ${year})`, font: { size: 10, weight: 'normal' }, color: '#64748b', padding: { bottom: 10 } }
            },
            scales: {
                y: { position: 'left', title: { display: true, text: '°C', font: { size: 10 } }, grid: { color: '#f1f5f9' } },
                y1: { position: 'right', title: { display: true, text: 'mm', font: { size: 10 } }, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
}

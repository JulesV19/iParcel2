import maplibregl from 'maplibre-gl';
import { cultureColors } from '../shared/constants.js';

// Dependencies
let deps = {};
export function setDependencies(d) { deps = d; }

// State
export let miniMap = null;
export let miniMapReady = false;
let parcelVizState = {
    parcelId: null, feature: null, yearIndex: 0, years: [],
    yearData: {}, animTimer: null, currentVisibleYear: null,
};

export function destroyMiniMap() {
    if (parcelVizState.animTimer) {
        clearInterval(parcelVizState.animTimer);
        parcelVizState.animTimer = null;
    }
    if (miniMap) {
        miniMap.remove();
        miniMap = null;
        miniMapReady = false;
    }
}

function getFeatureBboxFromGeom(geometry) {
    if (!geometry) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const coords = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(2) :
        geometry.type === 'Polygon' ? geometry.coordinates.flat() : [];
    for (const [x, y] of coords) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) return null;
    const dx = (maxX - minX) * 0.3;
    const dy = (maxY - minY) * 0.3;
    return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

export function initParcelViz(parcelId, feature, props, record, parcelRegion) {
    destroyMiniMap();

    const lineage = record ? (record.lineage || {}) : {};
    const currentYear = parseInt(document.getElementById('year-select').value);

    const allYears = [...new Set([...Object.keys(lineage).map(Number), currentYear])].sort();
    const yearData = {};

    for (const y of allYears) {
        if (y === currentYear) {
            yearData[y] = { culture: props.CODE_CULTU, group: props.CODE_GROUP, isCurrent: true };
        } else {
            const entry = lineage[y];
            if (entry) {
                yearData[y] = {
                    culture: entry.c || '?', group: entry.g || '',
                    confidence: entry.cf, parentId: entry.p, isCurrent: false
                };
            }
        }
    }

    parcelVizState = { parcelId, feature, yearIndex: allYears.length - 1, years: allYears, yearData };

    const slider = document.getElementById('parcel-viz-slider');
    slider.max = allYears.length - 1;
    slider.value = allYears.length - 1;
    slider.oninput = function () {
        parcelVizState.yearIndex = parseInt(this.value);
        switchMiniMapYear();
    };
    document.getElementById('parcel-viz-year-labels').innerHTML = allYears.map(y => `<span>${y}</span>`).join('');

    const bbox = getFeatureBboxFromGeom(feature.geometry);
    miniMap = new maplibregl.Map({
        container: document.getElementById('parcel-viz-svg'),
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }] },
        bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        fitBoundsOptions: { padding: 10 }, interactive: false, attributionControl: false
    });

    miniMap.on('load', () => {
        miniMapReady = true;
        const region = parcelRegion || document.getElementById('region-select').value;
        const regionFile = deps.regionToFile(region);
        allYears.forEach(y => {
            miniMap.addSource(`mini-src-${y}`, {
                type: 'vector',
                url: `pmtiles:///data/output_pmtiles/${y}/${regionFile}.pmtiles`
            });
            miniMap.addLayer({
                id: `mini-fill-${y}`, type: 'fill', source: `mini-src-${y}`, 'source-layer': 'parcelles',
                paint: { 'fill-color': deps.getMapColorExpression(), 'fill-opacity': 0 }
            });
        });

        miniMap.addSource('parcel-outline', {
            type: 'geojson', data: {
                type: 'FeatureCollection',
                features: [{ type: 'Feature', geometry: feature.geometry, properties: {} }]
            }
        });
        miniMap.addLayer({
            id: 'outline-line', type: 'line', source: 'parcel-outline',
            paint: { 'line-color': '#000', 'line-width': 2 }
        });

        switchMiniMapYear();
    });
}

export function switchMiniMapYear() {
    if (!miniMap || !miniMapReady) return;
    const state = parcelVizState;
    const year = state.years[state.yearIndex];
    const yd = state.yearData[year];

    document.getElementById('parcel-viz-year').textContent = year;

    if (state.currentVisibleYear && state.currentVisibleYear !== year) {
        const py = state.currentVisibleYear;
        if (miniMap.getLayer(`mini-fill-${py}`)) miniMap.setPaintProperty(`mini-fill-${py}`, 'fill-opacity', 0);
    }

    if (miniMap.getLayer(`mini-fill-${year}`)) miniMap.setPaintProperty(`mini-fill-${year}`, 'fill-opacity', 0.75);

    state.currentVisibleYear = year;
    updateVizLegendInfo(year, yd);
}

function updateVizLegendInfo(year, yd) {
    const legendEl = document.getElementById('parcel-viz-legend');
    const infoEl = document.getElementById('parcel-viz-info');
    if (!yd) { legendEl.innerHTML = ''; infoEl.innerHTML = ''; return; }

    const cultureName = deps.cropLabels[yd.culture] || yd.culture;
    const groupColor = yd.group ? (cultureColors[yd.group] || cultureColors.default) : cultureColors.default;
    let legendHtml = `<span class="viz-legend-item"><span class="viz-legend-swatch" style="background:${groupColor}"></span>${cultureName}</span>`;

    let infoHtml = `<strong>${year}</strong> · ${cultureName}`;
    const conf = yd.confidence != null ? Math.round(yd.confidence * 100) : null;
    if (conf !== null) infoHtml += ` · Fiabilité: ${conf}%`;
    if (yd.parentId) {
        infoHtml += `<br>🔗 Parent: <code style="font-size:0.72rem;background:var(--border-light);padding:1px 5px;border-radius:4px;">${yd.parentId}</code>`;
    }
    if (yd.isCurrent) infoHtml += `<br><span style="color:var(--accent);font-weight:600;">📍 Année courante</span>`;
    infoHtml += `<br><span style="font-size:0.7rem;color:var(--text-muted);">▬ Contour noir = parcelle 2023</span>`;

    legendEl.innerHTML = legendHtml;
    infoEl.innerHTML = infoHtml;
}

export function parcelVizPrev() {
    if (parcelVizState.yearIndex > 0) {
        parcelVizState.yearIndex--;
        document.getElementById('parcel-viz-slider').value = parcelVizState.yearIndex;
        switchMiniMapYear();
    }
}
export function parcelVizNext() {
    if (parcelVizState.yearIndex < parcelVizState.years.length - 1) {
        parcelVizState.yearIndex++;
        document.getElementById('parcel-viz-slider').value = parcelVizState.yearIndex;
        switchMiniMapYear();
    }
}
export function parcelVizPlay() {
    const state = parcelVizState;
    const btn = document.getElementById('parcel-viz-play-btn');
    if (state.animTimer) {
        clearInterval(state.animTimer); state.animTimer = null;
        btn.textContent = '▶ Animer'; return;
    }
    btn.textContent = '⏸ Pause';
    state.yearIndex = 0;
    document.getElementById('parcel-viz-slider').value = 0;
    switchMiniMapYear();
    state.animTimer = setInterval(() => {
        if (state.yearIndex >= state.years.length - 1) {
            clearInterval(state.animTimer); state.animTimer = null;
            btn.textContent = '▶ Animer'; return;
        }
        state.yearIndex++;
        document.getElementById('parcel-viz-slider').value = state.yearIndex;
        switchMiniMapYear();
    }, 1200);
}
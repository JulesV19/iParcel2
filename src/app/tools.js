// ── Tools Module ──
// Measure, Compare, and Screenshot tools

import { years } from '../shared/constants.js';
import { showToast } from '../shared/utils.js';
import { map, mapReady, ensureLayer } from './map.js';

// Module state
export let measureMode = false;
export let measurePoints = [];
export let measureMarkers = [];

// ── Measure Tool ──
export function toggleMeasure() {
    measureMode = !measureMode;
    document.getElementById('btn-measure').classList.toggle('active', measureMode);
    if (!measureMode) {
        clearMeasure();
        showToast("Mesure désactivée", "📏");
    } else {
        showToast("Cliquez sur la carte pour mesurer", "📏");
    }
    map.getCanvas().style.cursor = measureMode ? 'crosshair' : '';
}

export function clearMeasure() {
    measurePoints = [];
    measureMarkers.forEach(m => m.remove());
    measureMarkers = [];
    try {
        if (map.getLayer('measure-line-layer')) map.removeLayer('measure-line-layer');
        if (map.getSource('measure-line')) map.removeSource('measure-line');
    } catch (e) { }
}

export function addMeasurePoint(lngLat) {
    measurePoints.push([lngLat.lng, lngLat.lat]);
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)';
    const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
    measureMarkers.push(m);

    if (measurePoints.length > 1) {
        const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: measurePoints } };
        if (map.getSource('measure-line')) {
            map.getSource('measure-line').setData(geojson);
        } else {
            map.addSource('measure-line', { type: 'geojson', data: geojson });
            map.addLayer({
                id: 'measure-line-layer', type: 'line', source: 'measure-line',
                paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-dasharray': [2, 2] }
            });
        }
        showToast(`Distance: ${calcTotalDistance(measurePoints)}`, "📏");
    }
}

export function calcTotalDistance(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
        total += haversine(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    }
    return total < 1 ? `${Math.round(total * 1000)} m` : `${total.toFixed(2)} km`;
}

export function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Compare Mode ──
export function toggleCompare() {
    compareMode = !compareMode;
    document.getElementById('compare-bar').classList.toggle('active', compareMode);
    document.getElementById('btn-compare').classList.toggle('active', compareMode);
    if (!compareMode) {
        const selected = document.getElementById('year-select').value;
        const op = document.getElementById('opacity-slider').value / 100;
        years.forEach(y => {
            const lyr = `lyr-${y}`;
            if (map.getLayer(lyr)) {
                map.setPaintProperty(lyr, 'fill-opacity', y === selected ? op : 0);
            }
        });
    }
}

export function applyCompare() {
    if (!mapReady) return;
    const left = document.getElementById('compare-left').value;
    const right = document.getElementById('compare-right').value;
    ensureLayer(left);
    ensureLayer(right);
    const op = document.getElementById('opacity-slider').value / 100;
    years.forEach(y => {
        const lyr = `lyr-${y}`;
        if (map.getLayer(lyr)) {
            if (y === left) map.setPaintProperty(lyr, 'fill-opacity', op);
            else if (y === right) map.setPaintProperty(lyr, 'fill-opacity', op * 0.5);
            else map.setPaintProperty(lyr, 'fill-opacity', 0);
        }
    });
    showToast(`Comparaison ${left} vs ${right}`, "🔄");
}

// ── Screenshot ──
export function takeScreenshot() {
    map.once('render', () => {
        const canvas = map.getCanvas();
        canvas.toBlob(blob => {
            if (!blob) { showToast("Échec de la capture", "⚠️"); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `iparcel-capture-${new Date().toISOString().slice(0, 10)}.png`;
            a.click();
            URL.revokeObjectURL(url);
            showToast("Capture téléchargée", "📸");
        });
    });
    map.triggerRepaint();
}

// Compare mode state (module-level)
let compareMode = false;

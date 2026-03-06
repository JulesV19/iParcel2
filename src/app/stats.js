// ── Stats Module ──
// Statistics panel, CSV export, notes, PDF export

import { Chart } from 'chart.js/auto';
import * as turf from '@turf/turf';
import { cultureColors } from '../shared/constants.js';
import { showToast } from '../shared/utils.js';

// Module state
let statsChart = null;

// Dependencies (injected)
let map = null;
let isMapReady = () => false;
let getCurrentParcelId = () => null;
let groupLabels = new Map();

/**
 * Inject runtime dependencies.
 * @param {object} deps
 * @param {mapboxgl.Map} deps.map
 * @param {function(): boolean} deps.isMapReady
 * @param {function(): string|null} deps.getCurrentParcelId
 * @param {Map<string,string>} deps.groupLabels
 */
export function setDependencies(deps) {
    if (deps.map) map = deps.map;
    if (deps.isMapReady) isMapReady = deps.isMapReady;
    if (deps.getCurrentParcelId) getCurrentParcelId = deps.getCurrentParcelId;
    if (deps.groupLabels) groupLabels = deps.groupLabels;
}

// ── Stats Panel ──
export function updateStats() {
    if (!isMapReady()) return;
    const year = document.getElementById('year-select').value;
    document.getElementById('stat-zoom').textContent = map.getZoom().toFixed(1);

    // Trouver tous les layers fill visibles pour l'année sélectionnée
    const visibleLayers = map.getStyle().layers
        .filter(lyr => lyr.id.startsWith('lyr-') && lyr.id.includes(`_${year}`) && lyr.type === 'fill')
        .map(lyr => lyr.id);

    if (visibleLayers.length === 0) {
        document.getElementById('stat-parcels').textContent = '—';
        document.getElementById('stat-surface').textContent = '—';
        document.getElementById('stat-cultures').textContent = '—';
        return;
    }

    const features = map.queryRenderedFeatures({ layers: visibleLayers });
    document.getElementById('stat-parcels').textContent = features.length.toLocaleString('fr-FR');

    const surface = features.reduce((sum, f) => {
        const s = f.properties.SURF_PARC || f.properties.surf_parc || f.properties.surface_ref_m2 || (turf.area(f) / 10000);
        return sum + parseFloat(s);
    }, 0);
    document.getElementById('stat-surface').textContent = surface.toFixed(1);

    const cultures = new Set(features.map(f => f.properties.CODE_CULTU).filter(Boolean));
    document.getElementById('stat-cultures').textContent = cultures.size;

    renderStatsChart(features);
}

export function renderStatsChart(features) {
    const ctx = document.getElementById('stats-chart').getContext('2d');
    if (statsChart) statsChart.destroy();

    // Agréger par groupe de culture
    const groups = {};
    features.forEach(f => {
        const code = f.properties.CODE_GROUP || 'Inconnu';
        const label = groupLabels.get(code) || `Groupe ${code}`;
        if (!groups[label]) groups[label] = 0;
        const s = f.properties.SURF_PARC || f.properties.surf_parc || f.properties.surface_ref_m2 || (turf.area(f) / 10000);
        groups[label] += parseFloat(s);
    });

    // Trier par surface décroissante, garder top 8
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const labels = sorted.map(([k]) => k);
    const data = sorted.map(([, v]) => parseFloat(v.toFixed(1)));
    const bgColors = Object.keys(cultureColors)
        .filter(k => k !== 'default')
        .slice(0, sorted.length)
        .map(k => cultureColors[k]);

    statsChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: bgColors, borderWidth: 2, borderColor: '#fff' }] },
        options: {
            responsive: true,
            plugins: {
                legend: { display: true, position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true } },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toFixed(1)} ha` } }
            }
        }
    });
}

// ── Export CSV ──
export function exportCSV() {
    const year = document.getElementById('year-select').value;
    const lyrId = `lyr-${year}`;
    if (!map.getLayer(lyrId)) { showToast("Aucune couche active", "⚠️"); return; }

    const features = map.queryRenderedFeatures({ layers: [lyrId] });
    if (!features.length) { showToast("Aucune parcelle visible", "⚠️"); return; }

    const keys = ['ID_PARCEL', 'CODE_CULTU', 'CODE_GROUP', 'SURF_PARC', 'surf_parc', 'surface_ref_m2'];
    const rows = [keys.join(';')];
    const seen = new Set();

    features.forEach(f => {
        const id = f.properties.ID_PARCEL || f.id || '';
        if (seen.has(id)) return;
        seen.add(id);
        f.properties.surf_parc = f.properties.SURF_PARC || f.properties.surf_parc || f.properties.surface_ref_m2 || (turf.area(f) / 10000).toFixed(2);
        rows.push(keys.map(k => f.properties[k] ?? '').join(';'));
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iparcel-export-${year}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`${rows.length - 1} parcelles exportées`, "📥");
}

// ── Notes ──
export function saveNote() {
    const currentParcelId = getCurrentParcelId();
    if (!currentParcelId) { showToast("Aucune parcelle sélectionnée", "⚠️"); return; }
    const text = document.getElementById('parcel-note').value.trim();
    if (!text) { showToast("Note vide", "⚠️"); return; }

    const key = `note_${currentParcelId}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.unshift({ text, date: new Date().toLocaleString('fr-FR') });
    localStorage.setItem(key, JSON.stringify(existing));

    document.getElementById('parcel-note').value = '';
    loadNotes(currentParcelId);
    showToast("Note sauvegardée", "💾");
}

export function loadNotes(parcelId) {
    const key = `note_${parcelId}`;
    const notes = JSON.parse(localStorage.getItem(key) || '[]');
    const box = document.getElementById('saved-notes');
    if (!notes.length) {
        box.innerHTML = '<span style="color:var(--text-muted);">Aucune note.</span>';
        return;
    }
    box.innerHTML = notes.map(n => `
<div style="background:var(--border-light);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;">
    <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px;">${n.date}</div>
    <div style="color:var(--text-main);">${n.text.replace(/\n/g, '<br>')}</div>
</div>
    `).join('');
}

// ── Export PDF ──
export function exportParcelPDF() {
    const currentParcelId = getCurrentParcelId();
    if (!currentParcelId) { showToast("Aucune parcelle sélectionnée", "⚠️"); return; }
    showToast("Ouverture impression…", "🖨️");
    setTimeout(() => window.print(), 500);
}

export function dismissFirstVisit() {
    try { localStorage.setItem('iparcel_visited', '1'); } catch (e) { }
    document.getElementById('first-visit-banner').classList.add('hidden');
}

// ── Legend & Filter Module ──

import { cultureColors } from '../shared/constants.js';
import { showToast } from '../shared/utils.js';

// Module-level state
export const activeFilters = new Set();

// These will be set via setDependencies()
let map = null;
let groupLabels = null;
let cultureToGroup = null;
let mapReady = false;

/**
 * Inject runtime dependencies that live in the main app scope.
 * Call once after map is initialised.
 *
 * @param {object} deps
 * @param {mapboxgl.Map} deps.map
 * @param {Map<string,string>} deps.groupLabels
 * @param {object} deps.cultureToGroup
 * @param {function(): boolean} deps.isMapReady
 */
export function setDependencies(deps) {
    map = deps.map;
    groupLabels = deps.groupLabels;
    cultureToGroup = deps.cultureToGroup;
    if (typeof deps.isMapReady === 'function') {
        mapReady = deps.isMapReady;
    }
}

function isReady() {
    return typeof mapReady === 'function' ? mapReady() : mapReady;
}

// ── Legend ──

export function renderLegend() {
    const box = document.getElementById("legend-list");
    if (groupLabels.size === 0) {
        box.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px;">Chargez un fichier CSV de r\u00e9f\u00e9rence pour afficher la l\u00e9gende.</div>';
        return;
    }
    let html = "";
    groupLabels.forEach((lib, code) => {
        const color = cultureColors[code] || cultureColors.default;
        html += `<div class="legend-item" onclick="toggleLegendFilter('${code}', this)" data-code="${code}">
    <div class="swatch" style="background:${color}"></div>
    <span>${lib}</span>
</div>`;
    });
    box.innerHTML = html;
}

export function renderFilterChips() {
    const box = document.getElementById("filter-chips");
    let html = '<button class="chip active" onclick="clearFilters(this)">Toutes</button>';
    groupLabels.forEach((lib, code) => {
        html += `<button class="chip" onclick="toggleChipFilter('${code}', this)">${lib}</button>`;
    });
    box.innerHTML = html;
}

export function toggleLegendFilter(code, el) {
    el.classList.toggle('dimmed');
    if (activeFilters.has(code)) activeFilters.delete(code);
    else activeFilters.add(code);
    applyFilter();
}

export function toggleChipFilter(code, btn) {
    btn.classList.toggle('active');
    if (activeFilters.has(code)) activeFilters.delete(code);
    else activeFilters.add(code);
    applyFilter();
}

export function clearFilters(btn) {
    activeFilters.clear();
    document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.legend-item').forEach(l => l.classList.remove('dimmed'));
    applyFilter();
}

export function applyFilter() {
    const year = document.getElementById('year-select').value;
    if (activeFilters.size === 0) {
        map.getStyle().layers.forEach(lyr => {
            if (lyr.id.startsWith('lyr-') && lyr.id.includes(`_${year}`)) {
                map.setFilter(lyr.id, null);
            }
        });
        return;
    }
    // Build the set of CODE_CULTU values that belong to the selected groups
    const matchingCultures = Object.entries(cultureToGroup)
        .filter(([, g]) => activeFilters.has(g))
        .map(([c]) => c);
    const filter = ['in', ['get', 'CODE_CULTU'], ['literal', matchingCultures]];
    map.getStyle().layers.forEach(lyr => {
        if (lyr.id.startsWith('lyr-') && lyr.id.includes(`_${year}`)) {
            map.setFilter(lyr.id, filter);
        }
    });
}

// ── Map Colors ──
// PMTiles only have CODE_CULTU (no CODE_GROUP), so we build a match on CODE_CULTU

export function getMapColorExpression() {
    console.log('[DEBUG COLORS] getMapColorExpression called. cultureToGroup size:', Object.keys(cultureToGroup).length);
    console.log('[DEBUG COLORS] groupLabels size:', groupLabels.size);
    // Build from cultureToGroup: each CODE_CULTU -> its group -> group color
    const expression = ["match", ["get", "CODE_CULTU"]];
    const seen = new Set();
    for (const [cultu, group] of Object.entries(cultureToGroup)) {
        const color = cultureColors[group] || cultureColors.default;
        if (!seen.has(cultu)) {
            expression.push(cultu, color);
            seen.add(cultu);
        }
    }
    // Si cultureToGroup n'est pas encore charg\u00e9 (0 \u00e9l\u00e9ments), l'expression Mapbox
    // "match" a besoin d'au moins 4 arguments [match, input, valeur1, sortie1, couleur_defaut]
    // ou bien on retourne juste une couleur statique pour ne pas faire planter addLayer
    if (seen.size === 0) {
        return cultureColors.default;
    }

    expression.push(cultureColors.default);
    console.log('[DEBUG COLORS] Final Mapbox color expression:', JSON.stringify(expression));
    return expression;
}

export function updateMapColors() {
    if (!isReady() || !map.getStyle()) return;
    const expression = getMapColorExpression();
    console.log('[DEBUG COLORS] Updating colors with expression:', expression);
    map.getStyle().layers.forEach(lyr => {
        if (lyr.id.startsWith('lyr-') && !lyr.id.includes('outline') && !lyr.id.includes('highlight')) {
            map.setPaintProperty(lyr.id, "fill-color", expression);
        }
    });
}

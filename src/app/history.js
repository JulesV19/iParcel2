// ── History Module ──
// Handles lineage stats, siblings, history rendering, spatial heatmap, and rotation heatmap.

import * as turf from '@turf/turf';
import maplibregl from 'maplibre-gl';
import { cultureColors, years, CURRENT_YEAR } from '../shared/constants.js';
import { computeRotationScoreV3, _getFamily, _clamp } from '../shared/agronomy.js';
import { showToast, scoreToColor as scoreToColorUtil } from '../shared/utils.js';

let deps = {};
// ── Module-level state (injected via setDependencies) ──
let map = null;
let lineageData = null;
let lineageStats = null;
let parentIndex = null;
let cropLabels = null;
let groupLabels = null;
let cultureToGroup = null;
let agronomicRules = null;
let ensureLayer = null;
let renderRotationScore = null; // eslint-disable-line no-unused-vars
let renderTimelineStrip = null; // eslint-disable-line no-unused-vars
let renderScoreEvolutionChart = null;

// Module-level mutable state
let spatialHeatmapMap = null;
let scoreEvolutionChart = null;

/**
 * Inject runtime dependencies that live in the main app scope.
 */
export function setDependencies(newDeps) {
    deps = newDeps;
    if (newDeps.map !== undefined) map = newDeps.map;
    if (newDeps.lineageData !== undefined) lineageData = newDeps.lineageData;
    if (newDeps.lineageStats !== undefined) lineageStats = newDeps.lineageStats;
    if (newDeps.parentIndex !== undefined) parentIndex = newDeps.parentIndex;
    if (newDeps.cropLabels !== undefined) cropLabels = newDeps.cropLabels;
    if (newDeps.groupLabels !== undefined) groupLabels = newDeps.groupLabels;
    if (newDeps.cultureToGroup !== undefined) cultureToGroup = newDeps.cultureToGroup;
    if (newDeps.agronomicRules !== undefined) agronomicRules = newDeps.agronomicRules;
    if (newDeps.ensureLayer !== undefined) ensureLayer = newDeps.ensureLayer;
    if (newDeps.renderRotationScore !== undefined) renderRotationScore = newDeps.renderRotationScore;
    // if (newDeps.renderTimelineStrip !== undefined) renderTimelineStrip = newDeps.renderTimelineStrip;
    if (newDeps.renderScoreEvolutionChart !== undefined) renderScoreEvolutionChart = newDeps.renderScoreEvolutionChart;
}

// ── Helper: culture color by group code ──
function getCultureColor(codeGroup) {
    return cultureColors[codeGroup] || cultureColors.default;
}

// ── Helper: culture color by culture code ──
function getCultureColorByCulture(code) {
    if (!code || code === '?' || code === '—') return cultureColors.default;
    const group = cultureToGroup[code];
    return group ? getCultureColor(group) : cultureColors.default;
}

// ── Helper: compute bbox from geometry ──
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

// ── Helper: region to file mapping ──
import { regionToFile } from '../shared/utils.js';

// ── Wrapper: rotation score via V3 engine ──
function computeRotationScore(allEntries) {
    if (!allEntries || allEntries.length === 0) return { score: 0, label: 'N/A', details: {} };

    // Normalize entries
    let entries;
    if (typeof allEntries[0] === 'object') {
        entries = allEntries.map((e, i) => ({
            c: e.c || e.cultureCode || '',
            g: e.g || e.cultureGroup || '',
            y: e.y ?? e.year ?? (2023 - i),
            pct: e.cf ?? e.confidence ?? 1,
            d1: e.d1 || e.culture_d1 || null,
            d2: e.d2 || e.culture_d2 || null
        }));
    } else {
        entries = allEntries.filter(c => c && c !== '—').map((c, i) => ({
            c: c, g: '', y: 2023 - i, pct: 1
        }));
    }

    if (entries.length < 1) return { score: 0, label: 'Donn\u00e9es insuffisantes', details: {} };

    const result = computeRotationScoreV3(entries, deps.agronomicRules); // Utilise les règles injectées directement

    // Map score to label/level for compatibility
    if (result.score > 80) { result.label = "Excellent"; result.level = "good"; }
    else if (result.score > 60) { result.label = "Bon"; result.level = "moderate"; }
    else if (result.score > 40) { result.label = "Moyen"; result.level = "moderate"; }
    else { result.label = "\u00c0 risque"; result.level = "poor"; }
    result.total = entries.length;

    return result;
}

// ── computeLineageStats ──
export function computeLineageStats(data) {
    let total = 0, withHistory = 0, monocultures = 0, splits = 0;
    let totalChanges = 0, maxDepth = 0;
    const allCultures = {};

    for (const [pid, rec] of Object.entries(data)) {
        total++;
        const lin = rec.lineage || rec.l;
        if (!lin || Object.keys(lin).length === 0) continue;
        withHistory++;
        const years = Object.keys(lin);
        if (years.length > maxDepth) maxDepth = years.length;

        // Culture tracking
        const currentCode = rec.c23 || rec["culture_2023"] || '';
        const cultures = [currentCode];
        const parentIds = new Set();
        let prev = currentCode;
        for (const y of years.sort((a, b) => b - a)) {
            const code = lin[y].c || lin[y].culture || '';
            cultures.push(code);
            if (code && code !== prev && prev) totalChanges++;
            prev = code;
            const p = lin[y].p || lin[y].parent_id;
            if (p) parentIds.add(p);
            // Low confidence = probable split
            const cf = lin[y].cf ?? lin[y].confidence;
            if (cf !== null && cf !== undefined && cf < 0.5) splits++;
        }
        const uniqueCultures = new Set(cultures.filter(c => c && c !== '—'));
        if (uniqueCultures.size === 1 && cultures.length > 2) monocultures++;

        cultures.forEach(c => { if (c && c !== '—') allCultures[c] = (allCultures[c] || 0) + 1; });
    }

    // Top cultures
    const topCultures = Object.entries(allCultures)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    return { total, withHistory, monocultures, splits, totalChanges, maxDepth, topCultures };
}

// ── Render global lineage stats in Stats tab ──
export function renderLineageGlobalStats() {
    const container = document.getElementById('lineage-global-stats');
    if (!container || !lineageStats) { if (container) container.innerHTML = ''; return; }
    const s = lineageStats;

    const topCultHtml = s.topCultures.map(([code, count]) => {
        const name = cropLabels[code] || code;
        return `<span class="stat-pill">${name}: ${count.toLocaleString('fr-FR')}</span>`;
    }).join('');

    container.innerHTML = `
<label style="margin-top:18px;">\ud83e\uddec G\u00e9n\u00e9alogie des parcelles</label>
<div class="quick-stats" style="grid-template-columns:1fr 1fr;">
    <div class="stat-card">
        <div class="stat-value">${s.withHistory.toLocaleString('fr-FR')}</div>
        <div class="stat-label">Parcelles avec historique</div>
    </div>
    <div class="stat-card">
        <div class="stat-value">${s.maxDepth + 1} ans</div>
        <div class="stat-label">Profondeur max</div>
    </div>
    <div class="stat-card">
        <div class="stat-value">${s.monocultures.toLocaleString('fr-FR')}</div>
        <div class="stat-label">Monocultures d\u00e9tect\u00e9es</div>
    </div>
    <div class="stat-card">
        <div class="stat-value">${s.splits.toLocaleString('fr-FR')}</div>
        <div class="stat-label">D\u00e9coupes probables</div>
    </div>
</div>
<label style="margin-top:12px;">\ud83c\udfc6 Cultures les plus fr\u00e9quentes (historique)</label>
<div class="weather-stats" style="margin-top:6px;">${topCultHtml}</div>
    `;
}

// ── Find siblings: parcels sharing the same parent in a given year ──
export function findSiblings(parcelId, record) {
    if (!record || !parentIndex) return [];
    const lineage = record.lineage || record.l || {};
    const years = Object.keys(lineage).sort((a, b) => b - a);
    const seen = new Set();
    const siblings = [];

    for (const yr of years) {
        const parentId = lineage[yr].p || lineage[yr].parent_id;
        if (!parentId) continue;
        const key = `${parentId}_${yr}`;
        const sibs = parentIndex[key] || [];
        for (const sibId of sibs) {
            if (sibId === parcelId || seen.has(sibId)) continue;
            seen.add(sibId);
            const sibRec = lineageData[sibId];
            if (!sibRec) continue;
            // Get sibling's culture for that year
            const sibLin = sibRec.lineage || sibRec.l || {};
            const sibEntry = sibLin[yr];
            siblings.push({
                id: sibId,
                year: yr,
                parentId: parentId,
                culture: sibEntry ? (sibEntry.c || sibEntry.culture) : (sibRec.c23 || '?'),
                confidence: sibEntry ? (sibEntry.cf ?? sibEntry.confidence) : null,
            });
        }
    }
    return siblings;
}

// ── Render siblings ──
export function renderSiblings(siblings) {
    const container = document.getElementById('siblings-container');
    if (!container) return;
    if (!siblings || siblings.length === 0) {
        container.innerHTML = '';
        return;
    }

    const items = siblings.slice(0, 8).map(s => {
        const cropName = cropLabels[s.culture] || s.culture || '?';
        const conf = s.confidence !== null ? Math.round(s.confidence * 100) : null;
        return `
    <div class="history-card" style="margin-bottom:8px; cursor:pointer;"
         title="Parcelle s\u0153ur issue du m\u00eame parent ${s.parentId} en ${s.year}">
        <div class="history-card-header">
            <div class="culture-dot" style="background:${getCultureColorByCulture(s.culture)}"></div>
            <div class="history-card-title" style="font-size:0.82rem;">${cropName}</div>
        </div>
        <div class="history-card-body">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>${s.area ? s.area.toFixed(2) + ' ha' : ''}</span>
                <span style="font-size:0.65rem; color:var(--text-muted);">${s.year}</span>
            </div>
        </div>
    </div>`;
    }).join('');
    container.innerHTML = `
<div style="background:linear-gradient(135deg,#fefce8,#fef9c3);border:1.5px solid #fde68a;border-radius:var(--radius-sm);padding:14px;margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
        <span style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#92400e;">
            \u2702\ufe0f Parcelles s\u0153urs
        </span>
        <span style="font-size:0.65rem;background:#fbbf24;color:white;padding:2px 8px;border-radius:10px;font-weight:700;">
            ${siblings.length}
        </span>
    </div>
    <div style="font-size:0.72rem;color:#a16207;margin-bottom:8px;">
        Issues du m\u00eame d\u00e9coupage parcellaire
    </div>
    ${items}
    ${siblings.length > 8 ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:6px;">+ ${siblings.length - 8} autres</div>` : ''}
</div>`;
}

// ── renderHistoryWithRecord ──
export function renderHistoryWithRecord(parcelId, props, record) {
    const list = document.getElementById('history-list');
    const currentYearStr = document.getElementById('year-select').value;
    const currentYearNum = parseInt(currentYearStr);

    if (!record) {
        renderRotationScore(null);
        // renderTimelineStrip(null);
        if (scoreEvolutionChart) scoreEvolutionChart.destroy();
        list.innerHTML = `<p style="padding:15px;color:var(--text-muted);">Aucun historique pour cette parcelle.</p>`;
        return;
    }

    const lineage = record.lineage || record.l || {};
    const sortedYears = Object.keys(lineage).sort((a, b) => b - a);

    // Grouping by year for the UI (strip + list)
    const annualData = {};

    // Add current year
    annualData[currentYearNum] = {
        year: currentYearNum,
        isCurrent: true,
        crops: [{
            c: record.c || record.c23 || props.CODE_CULTU,
            g: record.g || record.g23 || props.CODE_GROUP,
            cf: 1
        }]
    };

    // Add historical years from lineage
    sortedYears.forEach(y => {
        const yearInt = parseInt(y);
        const entry = lineage[y];
        if (!annualData[yearInt]) annualData[yearInt] = { year: yearInt, crops: [] };

        const addEntry = (e) => {
            if (!e) return;
            annualData[yearInt].crops.push({
                c: e.c || '?',
                d1: e.d1 || null,
                d2: e.d2 || null,
                g: e.g || cultureToGroup[e.c] || '',
                cf: e.cf ?? 1,
                p: e.p || e.id
            });
        };

        if (Array.isArray(entry)) entry.forEach(addEntry);
        else addEntry(entry);
    });

    // Add siblings (splits/fusions)
    const sib = record.sib || record.s || {};
    Object.keys(sib).forEach(y => {
        const yearInt = parseInt(y);
        if (!annualData[yearInt]) annualData[yearInt] = { year: yearInt, crops: [] };
        const entries = sib[y];
        if (Array.isArray(entries)) {
            entries.forEach(e => {
                // \u00c9viter les doublons si d\u00e9j\u00e0 dans lineage (par ID)
                if (!annualData[yearInt].crops.some(existing => existing.p === (e.id || e.p))) {
                    annualData[yearInt].crops.push({
                        c: e.c || '?',
                        d1: e.d1 || null,
                        d2: e.d2 || null,
                        g: e.g || cultureToGroup[e.c] || '',
                        cf: e.cf ?? 1,
                        p: e.id || e.p
                    });
                }
            });
        }
    });

    // ── Per-zone scoring: build branches, score each, then weighted average ──
    // If all years have exactly 1 crop -> single branch (most common case).
    // If some years have multiple crops -> each crop is a zone weighted by cf.
    const allYears = Object.values(annualData).sort((a, b) => b.year - a.year);
    const hasMultiCrops = allYears.some(yd => yd.crops.length > 1);

    let panelScoreResult;

    if (!hasMultiCrops) {
        // Simple case: 1 crop per year -> single branch
        const entries = allYears.map(yd => ({
            c: yd.crops[0].c,
            d1: yd.crops[0].d1,
            d2: yd.crops[0].d2,
            g: yd.crops[0].g,
            y: yd.year,
            cf: 1
        }));
        panelScoreResult = computeRotationScore(entries);
    } else {
        // Multi-crop case: build N branches, one per zone
        // Each branch takes the crop with the highest cf from each year,
        // assigning remaining crops to secondary branches.

        // Step 1: Determine the max number of zones from any year
        const maxZones = Math.min(allYears.reduce((mx, yd) => Math.max(mx, yd.crops.length), 1), 10);

        // Step 2: Build branches -- for each zone index, pick the Nth crop by cf rank
        const branches = [];
        for (let z = 0; z < maxZones; z++) {
            const branchEntries = [];
            let branchWeight = 0;

            allYears.forEach(yd => {
                // Sort crops by cf descending, pick the z-th one (or the last available)
                const sorted = [...yd.crops].sort((a, b) => (b.cf || 0) - (a.cf || 0));
                const crop = sorted[Math.min(z, sorted.length - 1)];
                const cf = crop.cf || (1 / yd.crops.length);

                branchEntries.push({
                    c: crop.c,
                    d1: crop.d1,
                    d2: crop.d2,
                    g: crop.g,
                    y: yd.year,
                    cf: 1  // Each branch is scored as a full history
                });
                branchWeight = Math.max(branchWeight, cf);
            });

            branches.push({ entries: branchEntries, weight: branchWeight });
        }

        // Step 3: Normalize weights
        const totalBranchWeight = branches.reduce((s, b) => s + b.weight, 0);

        // Step 4: Score each branch independently and compute weighted average
        let weightedScoreSum = 0;
        let bestDetails = null;

        branches.forEach(branch => {
            const result = computeRotationScore(branch.entries);
            const w = totalBranchWeight > 0 ? branch.weight / totalBranchWeight : 1 / branches.length;
            weightedScoreSum += result.score * w;
            if (!bestDetails || branch.weight > (bestDetails._w || 0)) {
                bestDetails = {
                    ...result.details,
                    _w: branch.weight,
                    _logs: result.logs,
                    _metrics: result.metrics
                };
            }
        });

        const avgScore = Math.round(_clamp(weightedScoreSum, 0, 100));
        const level = avgScore > 80 ? 'good' : avgScore > 60 ? 'moderate' : avgScore > 40 ? 'moderate' : 'poor';
        const label = avgScore > 80 ? 'Excellent' : avgScore > 60 ? 'Bon' : avgScore > 40 ? 'Moyen' : '\u00c0 risque';
        panelScoreResult = {
            score: avgScore,
            label,
            level,
            total: allYears.length,
            details: bestDetails || {},
            logs: bestDetails?._logs || [],
            metrics: bestDetails?._metrics || {}
        };
    }

    // Also build flat entries for timeline strip & evolution chart
    const scoringEntries = [];
    Object.values(annualData).forEach(yData => {
        yData.crops.forEach(c => {
            scoringEntries.push({ c: c.c, d1: c.d1, d2: c.d2, g: c.g, y: yData.year, cf: c.cf });
        });
    });

    renderRotationScore(panelScoreResult);
    // renderTimelineStrip(Object.values(annualData));

    // Cover crop label lookup (codes D** from REF_CULTURES_DEROBEES)
    const _coverLabels = {
        DBM: 'Br\u00f4me', DBR: 'Bourrache', DCF: 'Chou fourrager', DCM: 'Cam\u00e9line', DCR: 'Cresson',
        DCZ: 'Colza', DDC: 'Dactyle', DFL: 'Fl\u00e9ole', DFN: 'Fenugrec', DFT: 'F\u00e9tuque', DFV: 'F\u00e9verole',
        DGS: 'Gesse', DLL: 'Lentille', DLN: 'Lin', DLP: 'Lupin', DLT: 'Lotier', DLZ: 'Luzerne',
        DMD: 'Moutarde', DMH: 'Moha', DML: 'Millet', DMN: 'Minette', DMT: 'M\u00e9lilot', DNG: 'Nyger',
        DNT: 'Navette', DNV: 'Navet', DPC: 'Pois chiche', DPH: 'Phac\u00e9lie', DPS: 'Pois', DPT: 'P\u00e2turin',
        DRD: 'Radis', DRG: 'Ray-grass', DRQ: 'Roquette', DSD: 'Serradelle', DSF: 'Sorgho four.',
        DSG: 'Seigle', DSH: 'Sous-semis', DSJ: 'Soja', DSN: 'Sainfoin', DSR: 'Sarrasin',
        DTN: 'Tournesol', DTR: 'Tr\u00e8fle', DVN: 'Avoine', DVS: 'Vesce', DXF: 'Festulolium',
        ZZZ: 'Inconnu'
    };
    renderScoreEvolutionChart(scoringEntries);

    // Render vertical list
    let html = sortedYears.length === 0 ? `<p style="padding:0 0 12px;font-size:0.85rem;color:var(--text-muted);">Premi\u00e8re ann\u00e9e de suivi pour cette parcelle.</p>` : '';

    const yearsToRender = Object.values(annualData).sort((a, b) => b.year - a.year);

    let prevCultures = new Set();

    html += yearsToRender.map((yData, idx) => {
        const y = yData.year;
        const isCurrent = yData.isCurrent;
        const crops = yData.crops;

        const cropItemsHtml = crops.map(c => {
            const cropName = cropLabels[c.c] || c.c;
            const bg = c.g ? getCultureColor(c.g) : getCultureColorByCulture(c.c);
            const conf = c.cf != null ? Math.round(c.cf * 100) : null;

            return `
                <div class="history-crop-row">
                    <div class="culture-dot" style="background:${bg}"></div>
                    <div style="flex:1">
                        <div style="font-weight:600;color:var(--text-main);">${cropName}</div>
                        ${conf !== null && conf < 100 ? `<div class="confidence-bar-mini"><div class="confidence-fill" style="width:${conf}%"></div></div>` : ''}
                    </div>
                    ${c.p ? `<span class="parent-link" onclick="loadParent('${y}_${c.p}')">\ud83d\udd17 ${c.p}</span>` : ''}
                </div>
            `;
        }).join('');

        // Cover crop badge: show between this year and the next (older) one
        let coverBadgeHtml = '';
        const coverCodes = [];
        crops.forEach(c => {
            if (c.d1) coverCodes.push(c.d1);
            if (c.d2) coverCodes.push(c.d2);
        });
        if (coverCodes.length > 0 && idx < yearsToRender.length - 1) {
            const names = [...new Set(coverCodes)].map(d => _coverLabels[d] || d).join(' + ');
            coverBadgeHtml = `
                <div class="cover-crop-badge">
                    <span class="cover-crop-icon">\ud83c\udf31</span>
                    <span class="cover-crop-label">Couvert : ${names}</span>
                </div>`;
        }

        // Update prevCultures for next year (going backwards)
        prevCultures = new Set(crops.map(c => c.c));

        return `
            <div class="history-item">
                <div class="timeline-dot ${isCurrent ? '' : 'past'}"></div>
                <div class="history-card ${isCurrent ? 'current' : ''}">
                    <div class="history-card-header">
                        <span class="history-card-year">${y}</span>
                        ${crops.length > 1 ? '<span class="event-tag split" style="font-size:0.6rem; padding:2px 6px;">\u26a0\ufe0f Mixte</span>' : ''}
                        <div style="flex:1"></div>
                        ${isCurrent ? '<span class="event-tag current">\ud83d\udccd Actuel</span>' : ''}
                    </div>
                    <div class="history-card-body">
                        ${cropItemsHtml}
                    </div>
                </div>
            </div>
            ${coverBadgeHtml}
        `;
    }).join('');

    list.innerHTML = html;
}

// ── scoreToColor ──
export function scoreToColor(s) {
    if (s == null || Number.isNaN(s)) return "#BDBDBD";
    let score = Math.max(0, Math.min(100, s));
    const stops = [
        { s: 0, r: 255, g: 30, b: 0 },      // Vibrant Red
        { s: 25, r: 255, g: 110, b: 0 },    // Vibrant Orange
        { s: 50, r: 255, g: 210, b: 0 },    // Vibrant Yellow
        { s: 75, r: 160, g: 255, b: 20 },   // Vibrant Yellow-Green
        { s: 100, r: 0, g: 255, b: 50 }     // Vibrant Green
    ];

    let i = 0;
    while (i < stops.length - 1 && score > stops[i + 1].s) {
        i++;
    }
    const c1 = stops[i];
    const c2 = stops[Math.min(i + 1, stops.length - 1)];

    let t = 0;
    if (c2.s > c1.s) t = (score - c1.s) / (c2.s - c1.s);

    const r = Math.round(c1.r + t * (c2.r - c1.r));
    const g = Math.round(c1.g + t * (c2.g - c1.g));
    const b = Math.round(c1.b + t * (c2.b - c1.b));

    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)} `;
}

// ── renderSpatialHeatmap ──
export async function renderSpatialHeatmap(parcelId, feature, record, parcelRegion) {
    const container = document.getElementById('spatial-heatmap-container');
    if (spatialHeatmapMap) { spatialHeatmapMap.remove(); spatialHeatmapMap = null; }

    if (!record || !record.lineage) {
        return;
    }

    const region = (parcelRegion || document.getElementById('region-select').value).toUpperCase();
    const regionFile = regionToFile(region);
    const yearNum = parseInt(document.getElementById('year-select').value);
    const currentCulture = record.c || record.c23 || "\u2014";

    // \u00c9tat de chargement


    const bbox = getFeatureBboxFromGeom(feature.geometry);
    spatialHeatmapMap = new maplibregl.Map({
        container: 'spatial-heatmap-container',
        style: {
            version: 8,
            sources: {},
            glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f1f5f9' } }]
        },
        bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        fitBoundsOptions: { padding: { top: 0, bottom: 50, left: 5, right: 5 }, maxZoom: 20 },
        interactive: false, attributionControl: false
    });

    spatialHeatmapMap.on('load', () => {
        const allYears = years.map(Number).sort(); // [2016, 2017, ..., 2023]

        // ── Charger les sources PMTiles de TOUTES les ann\u00e9es ──
        for (const y of allYears) {
            try {
                spatialHeatmapMap.addSource(`ht-src-${y}`, {
                    type: 'vector',
                    url: `pmtiles://data/output_pmtiles/${y}/${regionFile}.pmtiles`
                });
                // Couche quasi-invisible mais requ\u00eatable
                spatialHeatmapMap.addLayer({
                    id: `ht-lyr-${y}`, type: 'fill',
                    source: `ht-src-${y}`, 'source-layer': 'parcelles',
                    paint: { 'fill-color': '#000', 'fill-opacity': 0.01 }
                });
            } catch (e) {
                console.warn(`[Heatmap] PMTiles ${y} non disponible`);
            }
        }

        // Contour de la parcelle 2023 (pointill\u00e9)
        spatialHeatmapMap.addSource('parcel-boundary', {
            type: 'geojson',
            data: { type: 'Feature', geometry: feature.geometry, properties: {} }
        });
        spatialHeatmapMap.addLayer({
            id: 'parcel-boundary-line', type: 'line', source: 'parcel-boundary',
            paint: { 'line-color': '#0f172a', 'line-width': 1.2 } // Trait plein fin
        });

        // ── Attendre le rendu des tuiles ──
        spatialHeatmapMap.once('idle', () => {
            try {
                const parcelFeat = turf.feature(feature.geometry);
                const parcelArea = turf.area(parcelFeat);
                const minArea = parcelArea * 0.05; // Seuil: 5% de la surface (pour ignorer le bruit spatial)

                // ── 1. Requ\u00eater les parcelles de chaque ann\u00e9e (uniquement les officiels du RPG) ──
                const validIds = new Set();
                Object.values(record.lineage || {}).forEach(l => { if (l.p) validIds.add(String(l.p)); });
                Object.values(record.sib || {}).forEach(sList => {
                    sList.forEach(s => { if (s.id) validIds.add(String(s.id)); });
                });

                const yearFeatures = {};
                for (const y of allYears) {
                    const lyrId = `ht-lyr-${y}`;
                    if (!spatialHeatmapMap.getLayer(lyrId)) continue;

                    const raw = spatialHeatmapMap.queryRenderedFeatures(undefined, { layers: [lyrId] });
                    // Filtrage strict : intersection g\u00e9om\u00e9trique + appartenance \u00e0 la g\u00e9n\u00e9alogie officielle
                    yearFeatures[y] = raw.filter(f => {
                        const props = f.properties || {};
                        const fid = String(props.ID_PARCEL || props.id_parcel || props.ID || props.id || "");
                        if (!validIds.has(fid)) return false;

                        try { return turf.booleanIntersects(parcelFeat, turf.feature(f.geometry)); }
                        catch (e) { return false; }
                    });
                }

                // ── 2. Calculer les zones atomiques par superposition ──
                let zones = [{
                    geometry: feature.geometry,
                    crops: { [yearNum]: { c: currentCulture, d1: null, d2: null } }
                }];

                // Superposer ann\u00e9e par ann\u00e9e (de la plus r\u00e9cente \u00e0 la plus ancienne)
                for (const y of allYears.sort((a, b) => b - a)) {
                    if (y === yearNum) continue; // D\u00e9j\u00e0 assign\u00e9
                    const histParcels = yearFeatures[y] || [];

                    if (histParcels.length === 0) {
                        // Pas de donn\u00e9es pour cette ann\u00e9e
                        zones.forEach(z => { z.crops[y] = { c: '?', d1: null, d2: null }; });
                        continue;
                    }

                    const newZones = [];
                    for (const zone of zones) {
                        const pieces = _splitZoneByParcels(zone.geometry, histParcels, minArea);
                        for (const piece of pieces) {
                            newZones.push({
                                geometry: piece.geometry,
                                crops: { ...zone.crops, [y]: piece.culture }
                            });
                        }
                    }
                    if (newZones.length > 0) zones = newZones;

                    // S\u00e9curit\u00e9 : limiter le nombre de zones
                    if (zones.length > 50) break;
                }

                // ── 3. Filtrer les \u00e9chardes minuscules ──
                zones = zones.filter(z => {
                    try { return turf.area(turf.feature(z.geometry)) > minArea; }
                    catch (e) { return true; }
                });

                if (zones.length === 0) {
                    zones = [{ geometry: feature.geometry, crops: { [yearNum]: currentCulture } }];
                }

                // ── 4. Scorer chaque zone ──
                for (const zone of zones) {
                    const entries = Object.entries(zone.crops)
                        .filter(([, cult]) => cult && cult.c !== '?' && cult.c !== '\u2014')
                        .sort(([a], [b]) => b - a)
                        .map(([y, cult]) => ({
                            c: cult.c,
                            d1: cult.d1,
                            d2: cult.d2,
                            g: cultureToGroup[cult.c] || '',
                            y: parseInt(y),
                            cf: 1
                        }));

                    zone.score = computeRotationScore(entries);
                    zone.color = scoreToColor(zone.score.score);
                    zone.areaM2 = turf.area(turf.feature(zone.geometry));
                    zone.areaHa = zone.areaM2 / 10000;
                    // R\u00e9sum\u00e9 de l'historique pour le tooltip
                    zone.histSummary = JSON.stringify(allYears.map(y => {
                        const cult = zone.crops[y];
                        if (!cult || cult.c === '?') return null;
                        return {
                            y,
                            label: cropLabels[cult.c] || cult.c,
                            color: getCultureColor(cultureToGroup[cult.c] || ''),
                            d1: cult.d1,
                            d2: cult.d2
                        };
                    }).filter(Boolean));
                }

                // ── 5. Score global pond\u00e9r\u00e9 par la surface + P\u00e9nalit\u00e9 de Variance ──
                const totalArea = zones.reduce((s, z) => s + z.areaM2, 0);
                const avgScore = totalArea > 0
                    ? zones.reduce((s, z) => s + z.score.score * z.areaM2, 0) / totalArea
                    : 0;

                // Calcul de l'\u00e9cart-type (variance spatiale)
                const variance = totalArea > 0
                    ? zones.reduce((s, z) => s + Math.pow(z.score.score - avgScore, 2) * z.areaM2, 0) / totalArea
                    : 0;
                const stdDev = Math.sqrt(variance);

                let varianceMalus = 0;
                const vThreshold = (agronomicRules?.SCORING_CONSTANTS?.VARIANCE_THRESHOLD || 15); // Scores are 0-100 now
                if (stdDev > vThreshold) {
                    varianceMalus = stdDev * (agronomicRules?.SCORING_CONSTANTS?.VARIANCE_PENALTY_MULT || 0.5);
                }

                const globalScore = Math.round(_clamp(avgScore - varianceMalus, 0, 100));

                // Nombre total de cultures uniques et d'ann\u00e9es couvertes
                const allCrops = new Set();
                let maxYears = 0;
                zones.forEach(z => {
                    const valid = Object.values(z.crops).filter(c => c && c !== '?' && c !== '\u2014');
                    valid.forEach(c => allCrops.add(c));
                    if (valid.length > maxYears) maxYears = valid.length;
                });

                // ── 5b. Mettre \u00e0 jour le score principal ──
                const wAvg = (key) => totalArea > 0
                    ? zones.reduce((s, z) => s + ((z.score.details || {})[key] || 0) * z.areaM2, 0) / totalArea
                    : 0;

                renderRotationScore({
                    score: globalScore,
                    label: globalScore > 80 ? 'Excellent' : globalScore > 60 ? 'Bon' : globalScore > 40 ? 'Moyen' : '\u00c0 risque',
                    level: globalScore > 60 ? 'good' : globalScore > 40 ? 'moderate' : 'bad',
                    unique: allCrops.size,
                    total: maxYears,
                    details: {
                        diversity: Math.round(wAvg('diversity')),
                        transitions: Math.round(wAvg('transitions')),
                        sanitary: Math.round(wAvg('sanitary')),
                        coverage: Math.round(wAvg('coverage')),
                        varianceMalus: varianceMalus
                    },
                    // Pour le logs et metrics, on prend le premier de la zone principale (la plus grande)
                    logs: [...zones].sort((a, b) => b.areaM2 - a.areaM2)[0]?.score?.logs || [],
                    metrics: [...zones].sort((a, b) => b.areaM2 - a.areaM2)[0]?.score?.metrics || {}
                });

                // ── 5c. Rafra\u00eechir l'affichage de l'historique ──
                // (On ne r\u00e9-injecte plus les cultures trouv\u00e9es spatialement car on veut rester fid\u00e8le au partitionnement RPG)
                renderHistoryWithRecord(parcelId, feature.properties, record);

                // ── 6. Affichage ──
                // Convertir les couches de requ\u00eate en contours environnants pour l'ann\u00e9e courante,
                // supprimer les autres
                for (const y of allYears) {
                    const lyrId = `ht-lyr-${y}`;
                    if (!spatialHeatmapMap.getLayer(lyrId)) continue;
                    spatialHeatmapMap.removeLayer(lyrId);
                }
                // Ajouter une couche de contours pour les parcelles environnantes (ann\u00e9e courante)
                const bgSrcId = `ht-src-${yearNum}`;
                if (spatialHeatmapMap.getSource(bgSrcId)) {
                    spatialHeatmapMap.addLayer({
                        id: 'bg-parcels-outline', type: 'line',
                        source: bgSrcId, 'source-layer': 'parcelles',
                        paint: { 'line-color': 'rgba(100,116,139,0.35)', 'line-width': 0.7 }
                    });
                }

                // GeoJSON des zones
                const zonesGeoJSON = {
                    type: 'FeatureCollection',
                    features: zones.map((z, i) => ({
                        type: 'Feature',
                        geometry: z.geometry,
                        properties: {
                            score: z.score.score,
                            index: i,
                            label: `${z.score.score}/100`,
                            area: z.areaHa.toFixed(2),
                            hist: z.histSummary
                        }
                    }))
                };

                spatialHeatmapMap.addSource('zones-src', { type: 'geojson', data: zonesGeoJSON });

                // ── MASK - Cacher les d\u00e9bordements du flou hors de la parcelle ──
                // On cr\u00e9e un \u00e9norme polygone monde avec un trou de la forme de la parcelle
                const worldBox = turf.bboxPolygon([-180, -90, 180, 90]);
                let maskFeat = null;
                try {
                    maskFeat = turf.difference(worldBox, turf.feature(feature.geometry));
                } catch (e) { }

                if (maskFeat) {
                    spatialHeatmapMap.addSource('mask-src', { type: 'geojson', data: maskFeat });
                    spatialHeatmapMap.addLayer({
                        id: 'mask-fill', type: 'fill', source: 'mask-src',
                        paint: { 'fill-color': '#f1f5f9' }, // Couleur du fond bg
                        filter: ['all']
                    });
                }

                // Couleur par zone
                const colorExpr = ['match', ['get', 'index']];
                zones.forEach((z, i) => { colorExpr.push(i, z.color); });
                colorExpr.push('#ccc');

                spatialHeatmapMap.addLayer({
                    id: 'zones-fill', type: 'fill', source: 'zones-src',
                    paint: { 'fill-color': colorExpr, 'fill-opacity': 0.85 }
                });

                // Pour cr\u00e9er l'effet BLEND (d\u00e9grad\u00e9) entre les zones
                spatialHeatmapMap.addLayer({
                    id: 'zones-blur', type: 'line', source: 'zones-src',
                    paint: {
                        'line-color': colorExpr,
                        'line-width': 30,    // Ligne tr\u00e8s \u00e9paisse
                        'line-blur': 15,     // Tr\u00e8s flout\u00e9e
                        'line-opacity': 0.85
                    }
                });

                // ── Superposition de lignes fines pour s\u00e9parer les sous-zones historiques ──
                const historicalYears = allYears.filter(y => y !== yearNum).sort((a, b) => b - a);

                for (const y of historicalYears) {
                    const feats = yearFeatures[y];
                    if (!feats || feats.length === 0) continue;

                    const srcId = `hist-overlay-src-${y}`;
                    const lineId = `hist-overlay-line-${y}`;

                    // Build GeoJSON from tile features
                    const geojson = {
                        type: 'FeatureCollection',
                        features: feats.map(f => ({
                            type: 'Feature',
                            geometry: f.geometry,
                            properties: { year: y }
                        }))
                    };

                    spatialHeatmapMap.addSource(srcId, { type: 'geojson', data: geojson });

                    // Contour fin et noir
                    spatialHeatmapMap.addLayer({
                        id: lineId, type: 'line', source: srcId,
                        paint: {
                            'line-color': '#000000',
                            'line-width': 1,
                            'line-opacity': 0.15
                        }
                    });
                }

                // On s'assure que le masque est au-dessus du blur
                if (spatialHeatmapMap.getLayer('mask-fill')) {
                    spatialHeatmapMap.moveLayer('mask-fill');
                }

                // ── Mettre les couches de contour au-dessus du masque ──
                if (spatialHeatmapMap.getLayer('bg-parcels-outline')) {
                    spatialHeatmapMap.moveLayer('bg-parcels-outline'); // Parcelles alentours
                }
                if (spatialHeatmapMap.getLayer('parcel-boundary-line')) {
                    spatialHeatmapMap.moveLayer('parcel-boundary-line'); // Contour de notre parcelle (trait plein fin)
                }

                // ── Labels de score sur chaque zone avec d\u00e9port pour petites zones ──
                const labelFeatures = [];
                const calloutLines = [];

                // R\u00e9cup\u00e9rer la bbox totale de la parcelle pour calculer une distance de d\u00e9port relative
                const mainBbox = turf.bbox(feature);
                const mainWidthKm = turf.distance([mainBbox[0], mainBbox[1]], [mainBbox[2], mainBbox[1]]);
                const displacementKm = Math.max(0.015, mainWidthKm * 0.15); // Distance du trait

                zones.forEach((z, idx) => {
                    try {
                        const zFeat = turf.feature(z.geometry);
                        // pointOnFeature garantit que le point est A L'INTERIEUR du polygone
                        // (contrairement \u00e0 centroid qui peut tomber dehors sur une parcelle en "U")
                        const anchorPoint = turf.pointOnFeature(zFeat);

                        // Si la zone est tr\u00e8s petite ou tr\u00e8s fine, on d\u00e9porte le label
                        const isSmall = z.areaHa < 1;

                        if (isSmall) {
                            // On d\u00e9place le point vers l'ext\u00e9rieur (ex: en haut \u00e0 droite, varions l'angle pour \u00e9viter les collisions)
                            const angles = [45, -45, 135, -135, 90, -90];
                            const bearing = angles[idx % angles.length];
                            const labelPoint = turf.destination(anchorPoint, displacementKm, bearing);

                            labelPoint.properties = { label: `${z.score.score}/100` };
                            labelFeatures.push(labelPoint);

                            // On cr\u00e9e la ligne qui relie
                            calloutLines.push(turf.lineString(
                                [anchorPoint.geometry.coordinates, labelPoint.geometry.coordinates],
                                { color: '#64748b' }
                            ));
                        } else {
                            anchorPoint.properties = { label: `${z.score.score}/100` };
                            labelFeatures.push(anchorPoint);
                        }
                    } catch (e) { }
                });

                // Source et couche pour les petits traits de raccordement
                if (calloutLines.length > 0) {
                    spatialHeatmapMap.addSource('callout-lines-src', {
                        type: 'geojson',
                        data: turf.featureCollection(calloutLines)
                    });
                    spatialHeatmapMap.addLayer({
                        id: 'callout-lines', type: 'line', source: 'callout-lines-src',
                        paint: {
                            'line-color': '#475569',
                            'line-width': 1.5,
                            'line-dasharray': [1, 1]
                        }
                    });
                }

                if (labelFeatures.length > 0) {
                    spatialHeatmapMap.addSource('score-labels-src', {
                        type: 'geojson',
                        data: turf.featureCollection(labelFeatures)
                    });
                    spatialHeatmapMap.addLayer({
                        id: 'score-labels', type: 'symbol', source: 'score-labels-src',
                        layout: {
                            'text-field': '{label}',
                            'text-font': ['Noto Sans Regular'],
                            'text-size': 13,
                            'text-allow-overlap': true,
                            'text-ignore-placement': true,
                            'text-line-height': 1.3
                        },
                        paint: {
                            'text-color': '#0f172a',
                            'text-halo-color': '#0f172a',
                            'text-halo-width': 0.5
                        }
                    });
                }

                // Remettre le contour 2023 au-dessus
                if (spatialHeatmapMap.getLayer('parcel-boundary-line')) {
                    spatialHeatmapMap.moveLayer('parcel-boundary-line');
                }
                // Labels au-dessus de tout
                if (spatialHeatmapMap.getLayer('score-labels')) {
                    spatialHeatmapMap.moveLayer('score-labels');
                }

                // ── L\u00e9gende inline dans le conteneur de la heatmap ──
                let legendEl = container.querySelector('.heatmap-inline-legend');
                if (!legendEl) {
                    legendEl = document.createElement('div');
                    legendEl.className = 'heatmap-inline-legend';
                    // Optional styling adjustments if needed for the simpler legend
                    legendEl.style.padding = '6px 10px';
                    container.appendChild(legendEl);
                }

                legendEl.innerHTML = `
                    <div class="hm-legend-gradient" style="margin-top:0;">
                        <div style="font-weight:700; color:#1e293b; font-size:0.65rem; margin-bottom:4px; text-align:center;">Score de Rotation</div>
                        <div class="hm-legend-bar"></div>
                        <div class="hm-legend-labels"><span>Critique (0)</span><span>Moyen (5)</span><span>Excellent (10)</span></div>
                    </div>`;

                const allSame = zones.length === 1 || zones.every(z => z.score.score === zones[0].score.score);

                // ── Infobulle (Popup) au survol des zones ──
                const popup = new maplibregl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    className: 'heatmap-hover-popup',
                    anchor: 'left',
                    offset: [15, 0]
                });

                spatialHeatmapMap.on('mousemove', 'zones-fill', (e) => {
                    if (!e.features || e.features.length === 0) return;
                    spatialHeatmapMap.getCanvas().style.cursor = 'pointer';

                    const feature = e.features[0];
                    const props = feature.properties;

                    // R\u00e9cup\u00e9rer et parser le r\u00e9sum\u00e9 de l'historique
                    let history = [];
                    try {
                        history = JSON.parse(props.hist);
                    } catch (e) {
                        history = []; // Fallback si pas de JSON valide
                    }

                    // Extraire les 4 derni\u00e8res ann\u00e9es (les plus r\u00e9centes en bas de l'historique ou en haut selon le tri)
                    let last4 = history.slice(-4).reverse();

                    let linesHtml = last4.map(item => `
                        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                            <div style="width:10px;height:10px;border-radius:2px;background:${item.color};flex-shrink:0;"></div>
                            <span>${item.y}: ${item.label}</span>
                        </div>
                    `).join('');

                    if (last4.length === 0) {
                        linesHtml = '<span style="color:#94a3b8;font-style:italic;">Aucune donn\u00e9e</span>';
                    }

                    const htmlContent = `
                        <div style="font-family:'Inter', sans-serif; padding:5px; max-width:180px;">
                            <strong style="display:block;margin-bottom:6px;font-size:0.8rem;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">
                                Score: ${props.score}/100 (${props.area} ha)
                            </strong>
                            <div style="font-size:0.75rem;color:#475569;line-height:1.4;">
                                ${linesHtml}
                            </div>
                        </div>
                    `;

                    popup.setLngLat(e.lngLat)
                        .setHTML(htmlContent)
                        .addTo(spatialHeatmapMap);
                });

                spatialHeatmapMap.on('mouseleave', 'zones-fill', () => {
                    spatialHeatmapMap.getCanvas().style.cursor = '';
                    popup.remove();
                });

            } catch (err) {
                console.error('[Heatmap] Erreur lors du calcul des zones:', err);
            }
        });
    });
}

// ── D\u00e9coupe une zone par les parcelles historiques d'une ann\u00e9e ──
export function _splitZoneByParcels(zoneGeom, parcels, minArea) {
    const zoneFeat = turf.feature(zoneGeom);
    const results = [];
    let remaining = zoneFeat;

    for (const parcel of parcels) {
        if (!remaining) break;
        try {
            const parcelFeat = turf.feature(parcel.geometry);
            const inter = turf.intersect(remaining, parcelFeat);

            if (inter && (inter.geometry.type === 'Polygon' || inter.geometry.type === 'MultiPolygon')) {
                if (turf.area(inter) > (minArea || 1)) {
                    const culture = {
                        c: parcel.properties.CODE_CULTU || parcel.properties.code_cultu || '?',
                        d1: parcel.properties.culture_d1 || parcel.properties.CULTURE_D1 || null,
                        d2: parcel.properties.culture_d2 || parcel.properties.CULTURE_D2 || null
                    };
                    results.push({ geometry: inter.geometry, culture });
                    remaining = turf.difference(remaining, parcelFeat);
                }
            }
        } catch (e) {
            // Op\u00e9ration g\u00e9om\u00e9trique \u00e9chou\u00e9e \u2014 on continue
        }
    }

    // Zone restante non couverte par les parcelles historiques
    if (remaining) {
        try {
            if (remaining.geometry && turf.area(remaining) > (minArea || 1)) {
                results.push({ geometry: remaining.geometry, culture: '?' });
            }
        } catch (e) { }
    }

    // Fallback si toutes les op\u00e9rations ont \u00e9chou\u00e9
    if (results.length === 0) {
        results.push({ geometry: zoneGeom, culture: '?' });
    }
    return results;
}

// ── renderRotationHeatmap ──
export async function renderRotationHeatmap(parcelId, record) {
    const root = document.getElementById('heatmap-grid-root');
    if (!root) return;

    if (!record || !record.lineage) {
        root.innerHTML = '<p style="padding:15px;color:var(--text-muted);">Pas de donn\u00e9es de rotation.</p>';
        return;
    }

    const lineage = record.lineage || {};
    const yearsList = ["2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016"];

    // Main branch
    const codes = yearsList.map(y => {
        if (y === "2023") return record.c || record.c23;
        return lineage[y]?.c || null;
    }).filter(c => c && c !== '?');

    const uniqueCount = new Set(codes).size;
    const ratio = uniqueCount / (codes.length || 1);
    let healthColor = ratio > 0.7 ? "#34d399" : ratio > 0.4 ? "#f59e0b" : "#ef4444";

    const mainId = parcelId.includes('_') ? parcelId.split('_')[1] : parcelId;

    root.innerHTML = `
<div class="heatmap-branch">
    <div class="branch-info">
        <span style="font-weight:700;">Parcelle ${mainId}</span>
        <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:0.65rem; color:var(--text-muted);">${uniqueCount} cultures / ${codes.length} ans</span>
            <div class="health-dot" style="background:${healthColor};width:8px;height:8px;border-radius:50%;"></div>
        </div>
    </div>
    <div class="heatmap-row">
        ${yearsList.map(y => {
        const isNow = (y === "2023");
        const cultCode = isNow ? (record.c || record.c23) : (lineage[y]?.c || null);
        const group = isNow ? (record.g || record.g23) : (lineage[y]?.g || '');
        const color = cultCode ? getCultureColor(group) : '#e2e8f0';
        const name = cropLabels[cultCode] || cultCode || 'Inconnu';
        return '<div class="heatmap-cell" style="background:' + color + '" title="' + y + ' : ' + name + '"></div>';
    }).join('')}
    </div>
</div>`;
}

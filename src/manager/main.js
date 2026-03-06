import { createClient } from '@supabase/supabase-js';
import * as Papa from 'papaparse';
import { cultureColors, GROUP_FAMILIES, CROP_FAMILIES } from '../shared/constants.js';
import {
    _getFamily,
    _getSeason,
    _clamp,
    computeRotationScoreV3
} from '../shared/agronomy.js';
import { getBucketId, regionToFile } from '../shared/utils.js';

console.log("[Manager] Script loaded. Initializing...");

// --- Supabase Config ---
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let sb;
try {
    sb = createClient(SB_URL, SB_KEY);
} catch (e) {
    console.error("[Manager] Supabase library not found!", e);
    alert("Erreur de configuration. Contactez le support.");
}

// --- Globals ---
let fullParcels = [];
let filteredParcels = [];
let agronomicRules = null;
let cropLabels = {};
let groupLabels = new Map();
let cultureToGroup = {};
const bucketCache = {};
const bucketPromises = {};

// --- Initialization ---

async function init() {
    console.log("[Manager] Init function started.");

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        alert("Session expirée. Veuillez vous reconnecter sur la page principale.");
        document.getElementById('loader').classList.add('hidden');
        document.body.innerHTML = '<h1>Accès refusé. Veuillez vous connecter.</h1>';
        return;
    }
    document.getElementById('active-user-display').textContent = session.user.email;

    try {
        const [rulesRes, labelsRes, derobeesRes, exploRes] = await Promise.all([
            fetch('/agronomic_rules.json').then(r => r.json()),
            fetch('/REF_CULTURES_2023.csv').then(r => r.arrayBuffer()),
            fetch('/REF_CULTURES_DEROBEES_2023.csv').then(r => r.arrayBuffer()),
            sb.from('exploitations').select('*').eq('user_id', session.user.id).single()
        ]);

        agronomicRules = rulesRes;

        const labelsText = new TextDecoder("windows-1252").decode(labelsRes);
        await new Promise(resolve => {
            Papa.parse(labelsText, {
                header: true, delimiter: ";",
                complete: (res) => {
                    res.data.forEach(row => {
                        if (row.CODE_CULTURE) {
                            const cc = row.CODE_CULTURE.trim();
                            cropLabels[cc] = row.LIBELLE_CULTURE;
                            if (row.CODE_GROUPE_CULTURE) cultureToGroup[cc] = row.CODE_GROUPE_CULTURE.trim();
                        }
                        if (row.CODE_GROUPE_CULTURE) groupLabels.set(row.CODE_GROUPE_CULTURE.trim(), row.LIBELLE_GROUPE_CULTURE);
                    });
                    resolve();
                }
            });
        });

        const derobeesText = new TextDecoder("windows-1252").decode(derobeesRes);
        await new Promise(resolve => {
            Papa.parse(derobeesText, {
                header: true, delimiter: ";",
                complete: (res) => {
                    res.data.forEach(row => {
                        if (row.CODE_CULTURE_DEROBEE) cropLabels[row.CODE_CULTURE_DEROBEE.trim()] = row.LIBELLE_CULTURE_DEROBEE;
                    });
                    resolve();
                }
            });
        });

        if (!exploRes.data) throw new Error("Exploitation introuvable");
        const exploitation = exploRes.data;
        document.getElementById('exploitation-name-display').textContent = exploitation.name || "Mon exploitation";
        document.getElementById('exploitation-id-display').textContent = `ID: ${exploitation.id}`;

        const { data: parcelData } = await sb.from('exploitation_parcelles').select('*').eq('exploitation_id', exploitation.id);

        fullParcels = parcelData || [];
        await enrichParcelsWithHistory();
        setupRealtimeSubscription(exploitation.id);
        filterAndRender();
        setupListeners();
        document.getElementById('loader').classList.add('hidden');
    } catch (err) {
        console.error("[Manager] Initialization error:", err);
        document.getElementById('loader').innerHTML = `<div style="color:red; padding:20px;">Erreur: ${err.message}</div>`;
    }
}

function setupRealtimeSubscription(exploitationId) {
    console.log(`[Manager] Setting up realtime for exploitation ${exploitationId}`);
    sb.channel('manager-updates')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'exploitation_parcelles',
            filter: `exploitation_id=eq.${exploitationId}`
        }, payload => {
            console.log("[Manager] Realtime update received:", payload.new.parcel_id);
            const updated = payload.new;
            const p = fullParcels.find(x => x.parcel_id === updated.parcel_id);
            if (p) {
                p.analysis_status = updated.analysis_status;
                p.analysis_progress = updated.analysis_progress;
                if (updated.ndvi_data) p.ndvi_data = updated.ndvi_data;
                filterAndRender();
            }
        })
        .subscribe();
}

async function enrichParcelsWithHistory() {
    const promises = fullParcels.map(async p => {
        const bucketId = getBucketId(p.parcel_id);
        const region = p.region || 'BRETAGNE';
        const bucketData = await loadBucket(bucketId, region);

        let history = [];
        if (bucketData && bucketData[p.parcel_id]) {
            const hRaw = bucketData[p.parcel_id].historique || [];
            // Handle multiple entries per year correctly
            history = hRaw.map(h => ({
                y: parseInt(h.annee_hist),
                c: h.cultu_hist,
                g: cultureToGroup[h.cultu_hist] || '',
                pct: (h.pct_surface || 100) / 100,
                d1: h.cultu_d1 || "",
                d2: h.cultu_d2 || ""
            })).sort((a, b) => b.y - a.y);
        }

        // Add current year (2023)
        history.unshift({
            y: 2023,
            c: p.code_cultu,
            g: p.code_group,
            pct: 1.0,
            d1: p.culture_d1 || "",
            d2: p.culture_d2 || ""
        });

        p.history = history;
        p.analysis = computeRotationScoreV3(history, agronomicRules);
    });
    await Promise.all(promises);
}

function filterAndRender() {
    const searchTerm = document.getElementById('parcel-search').value.toLowerCase();
    const sortVal = document.getElementById('sort-select').value;

    filteredParcels = fullParcels.filter(p =>
        p.parcel_id.toLowerCase().includes(searchTerm) ||
        (p.notes && p.notes.toLowerCase().includes(searchTerm)) ||
        (cropLabels[p.code_cultu] && cropLabels[p.code_cultu].toLowerCase().includes(searchTerm))
    );

    filteredParcels.sort((a, b) => {
        const scoreA = a.analysis?.score ?? 0;
        const scoreB = b.analysis?.score ?? 0;
        if (sortVal === 'score-desc') return scoreB - scoreA;
        if (sortVal === 'score-asc') return scoreA - scoreB;
        if (sortVal === 'surf-desc') return (b.surf_parc || 0) - (a.surf_parc || 0);
        if (sortVal === 'name') return (a.notes || "").localeCompare(b.notes || "");
        return 0;
    });

    renderGlobalStats();
    renderParcelList();
}

function renderGlobalStats() {
    const statsEl = document.getElementById('stats-summary');
    if (!fullParcels.length) return;
    const totalSurf = fullParcels.reduce((sum, p) => sum + parseFloat(p.surf_parc || 0), 0);
    const avgScore = Math.round(fullParcels.reduce((sum, p) => sum + (p.analysis?.score ?? 0), 0) / fullParcels.length);
    const legumesSurf = fullParcels.reduce((sum, p) => {
        const fam = _getFamily({ c: p.code_cultu, g: p.code_group }, { CROP_FAMILIES, GROUP_FAMILIES });
        return fam === 'legumes' ? sum + parseFloat(p.surf_parc || 0) : sum;
    }, 0);
    const legumesPct = totalSurf > 0 ? Math.round((legumesSurf / totalSurf) * 100) : 0;

    statsEl.innerHTML = `
        <div class="stat-modern"><div class="label">Surface</div><div class="value">${totalSurf.toFixed(1)} ha</div></div>
        <div class="stat-modern"><div class="label">Santé</div><div class="value" style="color:${getScoreColor(avgScore)}">${avgScore}/100</div></div>
        <div class="stat-modern"><div class="label">Légumes</div><div class="value">${legumesPct}%</div></div>
        <div class="stat-modern"><div class="label">Parcelles</div><div class="value">${fullParcels.length}</div></div>
    `;
    document.getElementById('results-count').textContent = `${filteredParcels.length} affichées`;
}

function renderParcelList() {
    const grid = document.getElementById('parcel-grid');
    grid.innerHTML = '';
    filteredParcels.forEach((p, idx) => {
        const cultureName = cropLabels[p.code_cultu] || p.code_cultu || "---";
        const score = p.analysis?.score ?? 0;
        const color = getScoreColor(score);
        const card = document.createElement('div');
        card.className = 'parcel-card-v2';
        card.style.animationDelay = `${idx * 0.05}s`;

        const isAnalyzing = p.analysis_progress !== undefined && p.analysis_progress < 100;

        card.innerHTML = `
            <div class="card-inner">
                <div class="card-header-v2">
                    <div><div class="dpc-title">${p.notes || cultureName}</div><div class="dpc-id">${p.parcel_id}</div></div>
                    <div class="score-circle" style="background:${color}">${score}</div>
                </div>
                <div class="dpc-meta-grid" style="margin-bottom:20px;">
                    <div class="dpc-meta-item"><div class="dpc-meta-label">Surface</div><div class="dpc-meta-value">${parseFloat(p.surf_parc || 0).toFixed(2)} ha</div></div>
                    <div class="dpc-meta-item"><div class="dpc-meta-label">Culture</div><div class="dpc-meta-value">${cultureName}</div></div>
                </div>

                ${renderAnalysisStatus(p)}

                <div class="filter-label" style="margin-top:20px;">Rotation 8 ans</div>
                <div class="rotation-timeline">${renderRotationTimeline(p.history)}</div>
                <div style="margin-top:20px;">
                    <div class="filter-label">Satellite</div>
                    <div class="dpc-satellite-strip">${renderSatThumbs(p)}</div>
                </div>
                <div style="margin-top:auto; padding-top:20px; display:flex; justify-content:flex-end;">
                    <button class="top-btn" onclick="window.goToParcel('${p.parcel_id}', ${p.centroid_lon}, ${p.centroid_lat})">📍 Localiser</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderAnalysisStatus(p) {
    if (!p.analysis_status && p.analysis_progress === undefined) return '';

    const status = p.analysis_status || "En attente...";
    const progress = p.analysis_progress ?? 0;
    const isDone = progress === 100;

    if (isDone) {
        return `
            <div class="analysis-status-container" style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.1);">
                <div class="analysis-status-text">
                    <span style="color: #10b981;">🛰️ Analyse Satellite</span>
                    <span class="status-badge-live done">Terminée</span>
                </div>
            </div>
        `;
    }

    return `
        <div class="analysis-status-container">
            <div class="analysis-status-text">
                <span>🛰️ ${status}</span>
                <span class="status-badge-live active">${progress}%</span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
        </div>
    `;
}

function renderRotationTimeline(history) {
    const subset = [...(history || [])].sort((a, b) => a.y - b.y).slice(-8);
    return subset.map(h => {
        const color = cultureColors[String(h.g || "")] || '#cbd5e1';
        return `<div class="timeline-item" style="background:${color}; border:1px solid rgba(0,0,0,0.05);" title="${h.y}: ${cropLabels[h.c] || h.c}">
            <span class="timeline-year">${String(h.y).slice(2)}</span><span style="font-size:0.7rem;font-weight:900;">${(h.c || "??").slice(0, 2)}</span>
        </div>`;
    }).join('');
}

function renderSatThumbs(p) {
    const ndviData = p.ndvi_data || {};
    const keys = Object.keys(ndviData).sort().reverse().slice(0, 8);
    const validKeys = keys.filter(key => {
        const d = ndviData[key];
        const url = (typeof d === 'object' && d.ndviUrl) ? d.ndviUrl : d;
        return url && url !== 'ERROR' && typeof url === 'string';
    });
    if (!validKeys.length) return '<div style="font-size:0.7rem;color:#94a3b8;padding:12px;text-align:center;width:100%;">Aucun historique</div>';
    return validKeys.map(key => {
        const d = ndviData[key];
        const url = (typeof d === 'object' && d.ndviUrl) ? d.ndviUrl : d;
        return `<div class="dpc-sat-thumb"><img src="${url}" loading="lazy"><div class="dpc-sat-date">${key.split('-')[1]}/${key.split('-')[0].slice(2)}</div></div>`;
    }).join('');
}

function getScoreColor(s) { return s >= 75 ? '#10b981' : s >= 50 ? '#34d399' : s >= 35 ? '#f59e0b' : '#ef4444'; }

async function loadBucket(id, r) {
    const cacheKey = `${r}_${id}`;
    if (bucketCache[cacheKey]) return bucketCache[cacheKey];
    if (bucketPromises[cacheKey]) return bucketPromises[cacheKey];

    const url = `/data/output_json/${regionToFile(r)}_${id}.json`;
    bucketPromises[cacheKey] = fetch(url)
        .then(res => res.ok ? res.json() : {})
        .then(data => {
            bucketCache[cacheKey] = data;
            delete bucketPromises[cacheKey];
            return data;
        })
        .catch(() => {
            delete bucketPromises[cacheKey];
            return {};
        });
    return bucketPromises[cacheKey];
}

function setupListeners() {
    document.getElementById('parcel-search').addEventListener('input', filterAndRender);
    document.getElementById('sort-select').addEventListener('change', filterAndRender);
    document.getElementById('btn-darkmode').addEventListener('click', toggleDarkMode);
    document.getElementById('btn-export').addEventListener('click', exportData);
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('btn-darkmode').textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem('iparcel-dark', isDark ? '1' : '0');
}

function exportData() {
    const rows = [["ID", "Note", "Surface", "Culture", "Score"]];
    fullParcels.forEach(p => rows.push([p.parcel_id, p.notes || "", p.surf_parc, cropLabels[p.code_cultu] || p.code_cultu, p.analysis?.score ?? 0]));
    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `export_iparcel_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

window.goToParcel = (id, lon, lat) => {
    if (window.opener && window.opener.flyToParcel) {
        window.opener.flyToParcel(lon, lat);
        window.opener.focus();
    } else {
        alert("Impossible de communiquer avec la fenêtre principale.");
    }
};

document.addEventListener('DOMContentLoaded', init);

if (localStorage.getItem('iparcel-dark') === '1') {
    document.body.classList.add('dark-mode');
    document.getElementById('btn-darkmode').textContent = '☀️';
}
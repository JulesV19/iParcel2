import { Chart } from 'chart.js/auto';
import { computeRotationScoreV3 } from '../shared/agronomy.js';
import { showToast, scoreToColor } from '../shared/utils.js';

// Dependencies
let deps = {};
export function setDependencies(d) { deps = d; }

let scoreEvolutionChart = null;

// This is a wrapper around the V3 engine to maintain compatibility with older calls
export function computeRotationScore(allEntries) {
    if (!deps.getAgronomicRules || !allEntries || allEntries.length === 0) return { score: 0, label: 'N/A', details: {} };

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

    if (entries.length < 1) return { score: 0, label: 'Données insuffisantes', details: {} };

    const result = computeRotationScoreV3(entries, deps.getAgronomicRules());

    if (result.score > 80) { result.label = "Excellent"; result.level = "good"; }
    else if (result.score > 60) { result.label = "Bon"; result.level = "moderate"; }
    else if (result.score > 40) { result.label = "Moyen"; result.level = "moderate"; }
    else { result.label = "À risque"; result.level = "poor"; }
    result.total = entries.length;

    return result;
}

export function renderRotationScore(scoreData) {
    const container = document.getElementById('rotation-score');
    if (!container) return;
    if (!scoreData || scoreData.score == null) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.85rem;">Impossible de calculer le score (historique insuffisant).</div>`;
        return;
    }

    const pct = Math.max(0, Math.min(100, scoreData.score));
    const strokeColor = scoreData.level === 'good' ? '#34d399' : scoreData.level === 'bad' ? '#ef4444' : '#f59e0b';
    const circumference = 2 * Math.PI * 20;
    const offset = circumference - (pct / 100) * circumference;

    const d = scoreData.details || {};
    const logs = scoreData.logs || [];
    const m = scoreData.metrics || {};

    function subBar(label, value) {
        const v = Math.max(0, Math.min(100, Math.round(value || 0)));
        const color = v >= 70 ? '#34d399' : v >= 40 ? '#f59e0b' : '#ef4444';
        return `<div class="score-sub-row">
            <span class="score-sub-label">${label}</span>
            <div class="score-sub-track"><div class="score-sub-fill" style="width:${v}%;background:${color}"></div></div>
            <span class="score-sub-val">${v}</span>
        </div>`;
    }

    container.innerHTML = `
    <div class="rotation-score-card">
        <div class="rotation-header">
            <div>
                <div class="rotation-label">Qualité Agronomique V3</div>
                <div style="font-size:0.85rem;font-weight:600;color:var(--text-main);margin-top:4px;">
                    Rotation sur ${scoreData.total || '?'} ans
                </div>
                ${(scoreData.badges && scoreData.badges.length > 0) ? `
                <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                    ${scoreData.badges.map(b => `<span class="sys-badge ${b.id}">${b.icon} ${b.label}</span>`).join('')}
                </div>
                ` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;">
                <div class="rotation-score-ring">
                    <svg width="52" height="52" viewBox="0 0 52 52">
                        <circle cx="26" cy="26" r="20" fill="none" stroke="#e2e8f0" stroke-width="5"/>
                        <circle cx="26" cy="26" r="20" fill="none" stroke="${strokeColor}" stroke-width="5"
                            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                            stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
                    </svg>
                    <div class="score-text">${scoreData.score}</div>
                </div>
                <span class="rotation-badge ${scoreData.level}">${scoreData.label}</span>
            </div>
        </div>
        <div class="score-breakdown">
            ${subBar('🌿 Diversité', d.diversity)}
            ${subBar('🔄 Successions', d.transitions)}
            ${subBar('🛡️ Sanitaire', d.sanitary)}
            ${subBar('🌱 Couverture', d.coverage)}
            ${d.varianceMalus ? `<div style="font-size:0.7rem; color:#ef4444; margin-top:4px;">⚠️ Malus Hétérogénéité: −${Math.round(d.varianceMalus)} pts</div>` : ''}
        </div>
        ${Object.keys(m).length > 0 ? `
        <details class="score-details-dropdown" open>
            <summary>🧐 Indicateurs clés</summary>
            <div class="score-metrics-grid">
                <div class="score-metric-box"><div class="sm-val">${m.families}</div><div class="sm-lbl">Familles</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.crops}</div><div class="sm-lbl">Cultures</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.roots}</div><div class="sm-lbl">Syst. racin.</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.prairieStreak}</div><div class="sm-lbl">Ans en prairie</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.legumesPct}%</div><div class="sm-lbl">Légumineuses</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.cerealsPct}%</div><div class="sm-lbl">Céréales</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.covers}</div><div class="sm-lbl">Fois couvert</div></div>
                <div class="score-metric-box"><div class="sm-val">${m.prairiePct}%</div><div class="sm-lbl">Prairie</div></div>
            </div>
        </details>
        ` : ''}
        ${logs.length > 0 ? `
        <details class="score-details-dropdown" style="margin-top:8px;">
            <summary>💬 Détails & Observations</summary>
            <div style="font-size:0.75rem; color:var(--text-muted); padding:8px 0; display:flex; flex-direction:column; gap:8px;">
                ${logs.map(l => `
                    <div style="display:flex; gap:6px; align-items:flex-start; padding: 6px; background: rgba(0,0,0,0.02); border-radius: 4px; border-left: 3px solid ${l.type === 'positive' ? '#34d399' : l.type === 'negative' ? '#ef4444' : '#94a3b8'};">
                        <span style="font-size:0.9rem; line-height:1; margin-top:2px;">
                            ${l.type === 'positive' ? '✅' : l.type === 'negative' ? '⚠️' : 'ℹ️'}
                        </span>
                        <div>
                            <strong style="color:var(--text-main); font-weight:600;">${l.label}</strong> -
                            <span style="line-height:1.4;">${l.desc}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </details>
        ` : ''}
    </div>`;
}

export function renderScoreEvolutionChart(scoringEntries) {
    const ctx = document.getElementById('score-evolution-chart').getContext('2d');
    if (scoreEvolutionChart) scoreEvolutionChart.destroy();
    if (!scoringEntries || scoringEntries.length < 2) return;

    let years = [...new Set(scoringEntries.map(e => e.y))].sort((a, b) => a - b);
    let labels = [];
    let data = [];
    let pointColors = [];

    for (let y of years) {
        let historyUpToY = scoringEntries.filter(e => e.y <= y);
        if (historyUpToY.length >= 2) {
            let res = computeRotationScore(historyUpToY);
            labels.push(y);
            data.push(res.score);
            pointColors.push(scoreToColor(res.score));
        }
    }

    if (labels.length === 0) return;

    scoreEvolutionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Score qualité',
                data: data,
                borderColor: '#64748b',
                backgroundColor: 'rgba(241,245,249,0.5)',
                borderWidth: 2,
                pointBackgroundColor: pointColors,
                pointBorderColor: '#fff',
                pointBorderWidth: 1,
                pointRadius: 4,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw + ' / 100' } } },
            scales: {
                y: { min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
}

export function updateScoringParam(key, value, slider) {
    const agronomicRules = deps.getAgronomicRules();
    if (!agronomicRules || !agronomicRules.SCORING_CONSTANTS) return;
    agronomicRules.SCORING_CONSTANTS[key] = value;

    const valEl = document.getElementById(slider.id + '-val');
    if (valEl) valEl.textContent = typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(1)) : value;

    if (deps.getLastDetailParams) {
        const lastParams = deps.getLastDetailParams();
        if (lastParams) {
            const { parcelId, props } = lastParams;
            const record = deps.getLineageData() && deps.getLineageData()[parcelId];
            if (record && deps.renderHistoryWithRecord) {
                deps.renderHistoryWithRecord(parcelId, props, record);
            }
        }
    }
}

export function resetScoringParams() {
    const agronomicRules = deps.getAgronomicRules();
    if (!agronomicRules) return;
    // This is not ideal, it should fetch the original rules.
    // For now, we reset to hardcoded defaults.
    agronomicRules.SCORING_CONSTANTS = {
        DECAY_HALFLIFE: 3.0,
        VARIANCE_THRESHOLD: 1.5,
        VARIANCE_PENALTY_MULT: 0.2,
    };

    const defaults = {
        'param-halflife': { slider: 3, display: '3.0' },
        'param-var-thresh': { slider: 15, display: '1.5' },
        'param-var-mult': { slider: 2, display: '0.2' },
    };
    for (const [id, def] of Object.entries(defaults)) {
        const sl = document.getElementById(id);
        const vl = document.getElementById(id + '-val');
        if (sl) sl.value = def.slider;
        if (vl) vl.textContent = def.display;
    }

    if (deps.getLastDetailParams) {
        const lastParams = deps.getLastDetailParams();
        if (lastParams) {
            const { parcelId, props } = lastParams;
            const record = deps.getLineageData() && deps.getLineageData()[parcelId];
            if (record && deps.renderHistoryWithRecord) {
                deps.renderHistoryWithRecord(parcelId, props, record);
            }
        }
    }
    showToast('Paramètres réinitialisés', '🔄');
}
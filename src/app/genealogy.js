import { cultureColors } from '../shared/constants.js';

// Dependencies
let deps = {};
export function setDependencies(d) { deps = d; }

function nodeHtml(id, cultCode, group, opts = {}) {
    const crop = deps.cropLabels[cultCode] || cultCode || '?';
    const color = cultureColors[group] || '#94a3b8';
    const cls = [
        'gtree-node',
        opts.isCurrent ? 'is-current' : '',
        opts.isMain ? 'is-main' : '',
        opts.isSibling ? 'is-sibling' : '',
    ].filter(Boolean).join(' ');
    const clickAttr = opts.isCurrent ? '' : `onclick="window.loadParent('${opts.compositeUid || id}')"`;

    return `
        <div class="${cls}" ${clickAttr} title="${crop} — ${id}">
            <div class="gtree-accent" style="background:${color};"></div>
            <div class="gtree-body">
                <div class="gtree-crop">${crop}</div>
                <div class="gtree-id">${id}</div>
                ${opts.pct !== undefined ? `<div class="gtree-pct">${Math.round(opts.pct * 100)}% recouvrement</div>` : ''}
                ${opts.badge ? `<div class="gtree-badge" style="background:${opts.badgeColor || '#e2e8f0'};color:${opts.badgeText || '#475569'};">${opts.badge}</div>` : ''}
            </div>
        </div>`;
}

export async function renderGenealogyTree(parcelId, parcelRegion) {
    const container = document.getElementById('genealogy-tree-container');
    if (!container) return;

    const lineageData = deps.getLineageData();
    const record = lineageData[parcelId];
    const year = document.getElementById('year-select').value;

    if (!record || !record.lineage) {
        container.innerHTML = `<p style="color:var(--text-muted);font-size:0.8rem;">Pas de données de filiation.</p>`;
        return;
    }

    const lineage = record.lineage || {};
    const siblings = record.sib || {};
    const sortedYears = Object.keys(lineage).sort((a, b) => a - b);

    let html = '';

    for (let i = 0; i < sortedYears.length; i++) {
        const yr = sortedYears[i];
        const entry = lineage[yr];
        const sibs = siblings[yr] || [];

        if (i > 0) {
            const prevSibs = siblings[sortedYears[i - 1]] || [];
            const prevCount = 1 + prevSibs.length;
            html += `<div class="gtree-connectors">${prevCount > 1 ? '<div class="gtree-link-tag">fusion</div>' : ''}</div>`;
        }

        html += `<div class="gtree-row">
            <div class="gtree-year"><span class="gtree-year-label">${yr}</span></div>
            <div class="gtree-nodes">`;

        html += nodeHtml(entry.p, entry.c, entry.g, {
            isMain: true, pct: entry.cf, compositeUid: `${yr}_${entry.p}`,
        });

        for (const sib of sibs) {
            html += nodeHtml(sib.id, sib.c, sib.g, {
                isSibling: true, pct: sib.cf, compositeUid: `${parseInt(yr) + 1}_${sib.id}`,
                badge: 'soeur', badgeColor: '#f1f5f9', badgeText: '#64748b',
            });
        }

        html += `</div></div>`;
    }

    const lastYearSibs = siblings[sortedYears[sortedYears.length - 1]] || [];
    html += `<div class="gtree-connectors">${lastYearSibs.length > 0 ? '<div class="gtree-link-tag">fusion</div>' : ''}</div>`;

    html += `<div class="gtree-row">
        <div class="gtree-year"><span class="gtree-year-label">${year}</span></div>
        <div class="gtree-nodes">`;
    html += nodeHtml(parcelId, record.c || record.c23, record.g || record.g23, {
        isCurrent: true, badge: 'cible', badgeColor: '#d1fae5', badgeText: '#065f46',
    });
    html += `</div></div>`;

    container.innerHTML = html;
}
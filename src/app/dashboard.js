import { cultureColors } from '../shared/constants.js';
import { Chart } from 'chart.js/auto';

// State
let dashCultureChart = null;

// Dependencies
let deps = {};
export function setDependencies(d) { deps = d; }

export function toggleDashboard() {
    if (!deps.getCurrentUser()) {
        if (deps.showAuthModal) deps.showAuthModal();
        return;
    }
    const panel = document.getElementById('dashboard-panel');
    const opening = !panel.classList.contains('open');
    if (opening) {
        if (deps.toggleSidebar) deps.toggleSidebar(false);
    }
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
        updateDashboard();
    }
}

function renderAnalysisProgress(p) {
    const status = p.analysis_status;
    const progress = p.analysis_progress;

    // Analyse terminée ou pas encore lancée avec données
    if (status === 'Terminée' || status === 'Erreur') return '';

    // Analyse en cours
    if (progress !== undefined && progress !== null && progress < 100) {
        return `
        <div class="analysis-progress-container">
            <div class="analysis-status-text">
                <span>${status || 'Analyse satellite...'}</span>
                <span>${progress}%</span>
            </div>
            <div class="analysis-progress-bar-wrap">
                <div class="analysis-progress-bar" style="width: ${progress}%"></div>
            </div>
        </div>`;
    }

    // Pas de données NDVI et pas d'analyse en cours = en attente
    const hasNdvi = p.ndvi_data && typeof p.ndvi_data === 'object' && Object.keys(p.ndvi_data).length > 0;
    if (!hasNdvi && !status) {
        return `
        <div class="analysis-progress-container">
            <div class="analysis-status-text">
                <span>En attente d'analyse satellite...</span>
                <span>0%</span>
            </div>
            <div class="analysis-progress-bar-wrap">
                <div class="analysis-progress-bar" style="width: 0%"></div>
            </div>
        </div>`;
    }

    return '';
}

export async function updateDashboard() {
    const currentExploitation = deps.getCurrentExploitation();
    if (!currentExploitation) return;

    const parcelles = deps.getExploitationParcelles() || [];
    const listEl = document.getElementById('dash-parcel-list');

    // User bar
    const userBarEl = document.getElementById('dash-user-bar');
    const currentUser = deps.getCurrentUser();
    if (currentUser) {
        const initial = (currentUser.email || '?')[0].toUpperCase();
        userBarEl.innerHTML = `
            <div class="dash-user-avatar">${initial}</div>
            <span class="dash-user-email">${currentUser.email}</span>
            <button class="dash-logout-btn" onclick="window.logout()">Deconnexion</button>
        `;
    } else {
        userBarEl.innerHTML = '';
    }

    // Exploitation name
    document.getElementById('exploitation-name').value = currentExploitation.name || '';

    if (parcelles.length === 0) {
        document.getElementById('dash-stats').innerHTML = '';
        if (dashCultureChart) { dashCultureChart.destroy(); dashCultureChart = null; }
        listEl.innerHTML = `
            <div class="dash-empty">
                <div class="dash-empty-icon">+</div>
                <p>Aucune parcelle dans votre exploitation</p>
                <button class="dash-empty-btn" onclick="window.toggleSelectMode()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    Ajouter des parcelles
                </button>
            </div>`;
        return;
    }

    // Calculate stats
    const totalSurface = parcelles.reduce((s, p) => s + (p.surf_parc || 0), 0);
    const culturesSet = new Set(parcelles.map(p => p.code_cultu).filter(Boolean));
    const cultureSurface = {};

    parcelles.forEach(p => {
        if (p.code_cultu) {
            const group = deps.cultureToGroup[p.code_cultu] || '28';
            if (!cultureSurface[group]) cultureSurface[group] = 0;
            cultureSurface[group] += p.surf_parc || 0;
        }
    });

    // Render stats
    document.getElementById('dash-stats').innerHTML = `
        <div class="dash-stat"><span class="ds-icon">🌾</span><div class="ds-value">${parcelles.length}</div><div class="ds-label">Parcelles</div></div>
        <div class="dash-stat"><span class="ds-icon">📐</span><div class="ds-value">${totalSurface.toFixed(1)}<span class="unit"> ha</span></div><div class="ds-label">Surface</div></div>
        <div class="dash-stat"><span class="ds-icon">🌿</span><div class="ds-value">${culturesSet.size}</div><div class="ds-label">Cultures 2023</div></div>
        <div class="dash-stat"><span class="ds-icon">🔄</span><div class="ds-value" style="color:var(--text-muted)">N/A</div><div class="ds-label">Rotation</div></div>`;

    // Parcel list (sécurisé)
    listEl.innerHTML = ''; // Clear
    parcelles.forEach(p => {
        const color = cultureColors[p.code_group] || '#9ca3af';
        const cultureName = deps.cropLabels[p.code_cultu] || p.code_cultu || '?';
        const customName = p.notes ? p.notes.trim() : '';

        const item = document.createElement('div');
        item.className = 'parcel-list-item';
        item.dataset.parcelId = p.parcel_id;
        item.onclick = () => deps.flyToParcel(p.centroid_lon, p.centroid_lat);

        item.innerHTML = `
            <div class="pli-color" style="background:${color}"></div>
            <div class="pli-info">
                <div class="pli-name">${customName || cultureName}</div>
                <div class="pli-meta">
                    <span class="pli-meta-tag">${p.parcel_id}</span>
                    ${p.surf_parc ? `<span>${parseFloat(p.surf_parc).toFixed(2)} ha</span>` : ''}
                </div>
            </div>
            <div class="pli-actions">
                <button class="pli-action-btn" title="Supprimer">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
            ${renderAnalysisProgress(p)}`;

        item.querySelector('.pli-actions button').onclick = (e) => {
            e.stopPropagation();
            deps.removeParcelFromExploitation(p.parcel_id);
        };
        listEl.appendChild(item);
    });

    // Assolement Chart
    renderDashboardChart(cultureSurface, totalSurface);
}

/**
 * Lightweight update: only refreshes progress bars without rebuilding the whole list.
 */
export function updateParcelProgress(parcelId, progress, status) {
    const item = document.querySelector(`.parcel-list-item[data-parcel-id="${parcelId}"]`);
    if (!item) return;

    let container = item.querySelector('.analysis-progress-container');

    // Analysis finished — remove the progress bar
    if (status === 'Terminée' || progress >= 100) {
        if (container) container.remove();
        return;
    }

    // No container yet — create one
    if (!container) {
        container = document.createElement('div');
        container.className = 'analysis-progress-container';
        container.innerHTML = `
            <div class="analysis-status-text">
                <span class="analysis-label"></span>
                <span class="analysis-pct"></span>
            </div>
            <div class="analysis-progress-bar-wrap">
                <div class="analysis-progress-bar"></div>
            </div>`;
        item.appendChild(container);
    }

    // Update values
    const label = container.querySelector('.analysis-label');
    const pct = container.querySelector('.analysis-pct');
    const bar = container.querySelector('.analysis-progress-bar');
    if (label) label.textContent = status || 'Analyse satellite...';
    if (pct) pct.textContent = `${progress}%`;
    if (bar) bar.style.width = `${progress}%`;
}

export function renderDashboardChart(cultureSurface, totalSurface) {
    const ctx = document.getElementById('dash-culture-chart').getContext('2d');
    if (dashCultureChart) dashCultureChart.destroy();

    const sorted = Object.entries(cultureSurface).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(([groupCode]) => deps.groupLabels.get(groupCode) || `Groupe ${groupCode}`);
    const data = sorted.map(([, surface]) => surface.toFixed(2));
    const bgColors = sorted.map(([groupCode]) => cultureColors[groupCode] || cultureColors.default);

    dashCultureChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderColor: 'var(--panel-bg)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.label}: ${ctx.raw} ha (${(ctx.raw / totalSurface * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });
}
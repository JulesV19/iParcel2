// --- NPM Dependencies ---
// Import named 'parse' function from papaparse
import * as Papa from 'papaparse';
// --- Shared Modules ---
import { sb } from '../shared/supabase.js';
import * as constants from '../shared/constants.js';
import * as utils from '../shared/utils.js';
import { toggleDarkMode } from '../shared/darkmode.js';

// --- App Modules ---
import * as map from './map.js';
import * as auth from './auth.js';
import * as sidebar from './sidebar.js';
import * as search from './search.js';
import * as legend from './legend.js';
import * as tools from './tools.js';
import * as stats from './stats.js';
import * as dashboard from './dashboard.js';
import * as scoringUI from './scoring-ui.js';
import * as history from './history.js';
import * as parcelViz from './parcel-viz.js';
import * as satellite from './satellite.js';
import * as genealogy from './genealogy.js';

// --- Global App State ---
let agronomicRules = null;
let cropLabels = {};
let groupLabels = new Map();
let cultureToGroup = {};

// --- Main App Initialization ---
async function main() {
    // 1. Load static data
    map.loaderStep(70, 'Chargement des règles agronomiques');
    try {
        const [rulesRes, csvRes] = await Promise.all([
            fetch('/agronomic_rules.json'),
            fetch('/REF_CULTURES_2023.csv')
        ]);
        agronomicRules = await rulesRes.json();

        if (csvRes.ok) {
            const buffer = await csvRes.arrayBuffer();
            const text = new TextDecoder("windows-1252").decode(buffer);
            await new Promise(resolve => {
                Papa.parse(text, {
                    header: true, delimiter: ";",
                    complete: (res) => {
                        console.log(`[DEBUG CSV] Papa.parse complete. Trouvé ${res.data.length} lignes.`);
                        res.data.forEach(row => {
                            if (row.CODE_CULTURE) {
                                const cc = row.CODE_CULTURE.trim();
                                cropLabels[cc] = row.LIBELLE_CULTURE;
                                if (row.CODE_GROUPE_CULTURE) cultureToGroup[cc] = row.CODE_GROUPE_CULTURE.trim();
                            }
                            if (row.CODE_GROUPE_CULTURE) groupLabels.set(row.CODE_GROUPE_CULTURE.trim(), row.LIBELLE_GROUPE_CULTURE);
                        });
                        console.log(`[DEBUG CSV] Après analyse : cultureToGroup size = ${Object.keys(cultureToGroup).length}, groupLabels size = ${groupLabels.size}`);
                        resolve();
                    }
                });
            });
        } else {
            // Si le fichier CSV n'est pas trouvé, c'est une erreur critique.
            // On lève une exception pour arrêter le chargement et afficher une erreur.
            throw new Error(`Fichier de référence des cultures (REF_CULTURES_2023.csv) introuvable. Statut: ${csvRes.status}`);
        }
    } catch (e) {
        console.error("Failed to load initial data:", e);
        map.showLoaderError();
        return;
    }

    // 2. Setup dependencies between modules (Dependency Injection)
    const appState = {
        map: map.map,
        isMapReady: () => map.mapReady,
        agronomicRules,
        getAgronomicRules: () => agronomicRules,
        cropLabels, groupLabels, cultureToGroup,
        getLineageData: () => sidebar.lineageData,
        getLastDetailParams: () => sidebar.lastDetailParams,
        getCurrentParcelId: () => sidebar.currentParcelId,
        getCurrentUser: () => auth.currentUser,
        getCurrentExploitation: () => auth.currentExploitation,
        getExploitationParcelles: () => auth.exploitationParcelles,
        renderRotationScore: scoringUI.renderRotationScore,
        renderScoreEvolutionChart: scoringUI.renderScoreEvolutionChart,
        renderSpatialHeatmap: history.renderSpatialHeatmap,
        renderHistoryWithRecord: history.renderHistoryWithRecord,
        initParcelViz: parcelViz.initParcelViz,
        initSatelliteViz: satellite.initSatelliteViz,
        destroyMiniMap: parcelViz.destroyMiniMap,
        showAuthModal: auth.showAuthModal,
        toggleSidebar: sidebar.toggleSidebar,
        updateDashboard: dashboard.updateDashboard,
        updateParcelProgress: dashboard.updateParcelProgress,
        flyToParcel: (lon, lat) => map.map.flyTo({ center: [lon, lat], zoom: 16 }),
        removeParcelFromExploitation: auth.removeParcelFromExploitation,
        updateSelectCount: auth.updateSelectCount,
        onNdviDataUpdated: satellite.onNdviDataUpdated,
        regionToFile: utils.regionToFile,
        getMapColorExpression: legend.getMapColorExpression,
    };

    sidebar.setDependencies(appState);
    history.setDependencies(appState);
    scoringUI.setDependencies(appState);
    parcelViz.setDependencies(appState);
    satellite.setDependencies(appState);
    genealogy.setDependencies(appState);
    dashboard.setDependencies(appState);
    auth.setDependencies(appState);
    legend.setDependencies(appState);
    stats.setDependencies(appState);
    search.setDependencies({
        map: map.map,
        isMapReady: () => map.mapReady,
        satelliteState: satellite.satelliteState,
        clearSatelliteOverlayFromMiniMap: satellite.clearSatelliteOverlayFromMiniMap,
        displayCachedSatelliteNDVI: satellite.displayCachedSatelliteNDVI,
    });

    // 3. Initialize map and its listeners
    map.setupMapListeners({
        ensureLayer: map.ensureLayer,
        init: async () => {
            legend.renderLegend();
            legend.renderFilterChips();
            // This is now called from map.js after layers are ensured
        },
        updateStats: stats.updateStats,
        loadRegionalWeather: sidebar.loadRegionalWeather,
        addMeasurePoint: tools.addMeasurePoint,
        highlightFeature: sidebar.highlightFeature,
        showDetails: sidebar.showDetails,
        addParcelToExploitation: auth.addParcelToExploitation,
        showAuthModal: auth.showAuthModal,
        getSelectMode: () => auth.selectMode,
        getCurrentUser: () => auth.currentUser,
        getCurrentExploitation: () => auth.currentExploitation,
        getLineageData: () => sidebar.lineageData,
        getMeasureMode: () => tools.measureMode,
        getColorExpression: legend.getMapColorExpression,
        updateMapColors: legend.updateMapColors,
    });

    // 4. Setup UI listeners
    search.setupSearch(map.map);
    search.setupSliders(map.map);
    search.setupYearSelector(map.map, {
        ensureLayer: map.ensureLayer,
        updateStats: stats.updateStats,
        applyFilter: legend.applyFilter,
    });
    search.setupRegionSelector(map.map, {
        ensureLayer: map.ensureLayer,
        updateStats: stats.updateStats,
        loadRegionalWeather: sidebar.loadRegionalWeather,
    });
    search.setupSatelliteFilters();

    // 5. Initialize Auth
    await auth.initAuth();

    // 6. Expose functions to window for HTML onclicks
    window.toggleDarkMode = toggleDarkMode;
    window.resetView = map.resetView;
    window.toggleMeasure = tools.toggleMeasure;
    window.toggleCompare = tools.toggleCompare;
    window.takeScreenshot = tools.takeScreenshot;
    window.cycleBasemap = map.cycleBasemap;
    window.toggleDashboard = dashboard.toggleDashboard;
    window.showAuthModal = auth.showAuthModal;
    window.submitAuth = auth.submitAuth;
    window.switchAuthMode = auth.switchAuthMode;
    window.hideAuthModal = auth.hideAuthModal;
    window.logout = auth.logout;
    window.renameExploitation = auth.renameExploitation;
    window.switchTab = (btn, tabId) => {
        btn.closest('.tab-bar').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.closest('.ui-panel').querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
    };
    window.switchSideTab = (btn, tabId) => {
        btn.closest('.side-tabs').querySelectorAll('.side-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.side-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        if (tabId === 'stab-parcelle' && parcelViz.miniMap) setTimeout(() => parcelViz.miniMap.resize(), 50);
        if (tabId === 'stab-satellite' && satellite.getSatelliteMiniMap()) setTimeout(() => satellite.getSatelliteMiniMap().resize(), 50);
    };
    window.setBasemap = map.setBasemap;
    window.applyCompare = tools.applyCompare;
    window.updateScoringParam = scoringUI.updateScoringParam;
    window.resetScoringParams = scoringUI.resetScoringParams;
    window.exportCSV = stats.exportCSV;
    window.flyToResult = search.flyToResult;
    window.toggleSidebar = sidebar.toggleSidebar;
    window.retryParcelDetails = sidebar.retryParcelDetails;
    window.exportParcelPDF = stats.exportParcelPDF;
    window.dismissFirstVisit = stats.dismissFirstVisit;
    window.parcelVizPrev = parcelViz.parcelVizPrev;
    window.parcelVizNext = parcelViz.parcelVizNext;
    window.parcelVizPlay = parcelViz.parcelVizPlay;
    window.parcelVizPlay = parcelViz.parcelVizPlay;
    window.changeSatelliteMode = satellite.changeSatelliteMode;
    window.toggle3D = map.toggle3D;
    window.geolocate = map.geolocate;
    window.clearFilters = legend.clearFilters;
    window.toggleChipFilter = legend.toggleChipFilter;
    window.toggleLegendFilter = legend.toggleLegendFilter;
    window.loadParent = () => { }; // Disabled
    window.toggleSelectMode = auth.toggleSelectMode;
    window.finishSelectMode = auth.finishSelectMode;
    window.updateSelectCount = auth.updateSelectCount;
    window.triggerAddParcel = () => {
        if (!auth.currentUser) { auth.showAuthModal(); return; }
        if (sidebar.currentParcelId && sidebar.lastDetailParams) {
            auth.addParcelToExploitation(sidebar.currentParcelId, sidebar.lastDetailParams.props, sidebar.lastDetailParams.e.lngLat, sidebar.highlightedFeature);
        }
    };
}

document.addEventListener('DOMContentLoaded', main);
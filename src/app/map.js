// ── Map Module ──
// Handles map initialization, basemap management, loader, and core map interactions.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as pmtiles from 'pmtiles';
import { basemaps } from '../shared/constants.js';
import { showToast, regionToFile } from '../shared/utils.js';

// TODO: These will be wired in via setupMapListeners(callbacks):
// import { ensureLayer } from './layers.js';
// import { init } from './init.js';
// import { updateStats } from './stats.js';
// import { loadRegionalWeather } from './weather.js';
// import { addMeasurePoint } from './measure.js';
// import { highlightFeature } from './highlight.js';
// import { showDetails } from './details.js';
// import { addParcelToExploitation, showAuthModal } from './exploitation.js';

// ── Module-level state ──
export let mapReady = false;
export let measureMode = false;
export let measurePoints = [];
export let measureMarkers = [];

let basemapIndex = 0;
let is3D = false;

// These are expected to come from other modules via setupMapListeners
let getColorExpression = () => '#94a3b8'; // Default color
let selectMode = false;       // will be read from external state
let currentUser = null;       // will be read from external state
let currentExploitation = null; // will be read from external state
let lineageData = null;       // will be read from external state

// ── Loader progress steps ──
export function loaderStep(pct, msg) {
    const bar = document.getElementById('loader-bar');
    const status = document.getElementById('loader-status');
    if (bar) bar.style.width = pct + '%';
    if (status) status.innerHTML = msg + '<div class="loader-dots"><span></span><span></span><span></span></div>';
}

export function ensureLayer(year, specificRegion = null) {
    if (!mapReady) return;
    const region = specificRegion || document.getElementById('region-select').value;
    if (region === "ALL" && !specificRegion) return;

    const fileName = `${region}_${year}`;
    const srcId = `src-${fileName}`;
    const lyrId = `lyr-${fileName}`;

    if (!map.getSource(srcId)) {
        const regionFile = regionToFile(region);
        map.addSource(srcId, {
            type: "vector",
            url: `pmtiles:///data/output_pmtiles/${year}/${regionFile}.pmtiles`
        });
    }
    if (!map.getLayer(lyrId)) {
        map.addLayer({
            id: lyrId, type: "fill", source: srcId, "source-layer": "parcelles",
            paint: {
                "fill-color": getColorExpression(),
                "fill-opacity": (year === document.getElementById('year-select').value) ? (document.getElementById('opacity-slider').value / 100) : 0,
                "fill-outline-color": "rgba(255,255,255,0.6)"
            }
        });
        map.addLayer({
            id: `${lyrId}-outline`, type: "line", source: srcId, "source-layer": "parcelles",
            paint: {
                "line-color": "rgba(255,255,255,0.8)",
                "line-width": parseFloat(document.getElementById('outline-slider').value)
            }
        });
    }
}

export function hideLoader() {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 800);
    }
}

export function showLoaderError() {
    const loader = document.getElementById('loader');
    const errEl = document.getElementById('loader-error');
    if (loader && errEl) {
        loader.classList.add('loader-error');
        errEl.classList.remove('hidden');
    }
}

loaderStep(10, 'Chargement de la carte');

// --- 1. CONFIGURATION DU PROTOCOLE PMTILES ---
// Cette partie DOIT être au tout début, avant de créer la carte.
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile.bind(protocol));

// --- 2. INITIALISATION DE LA CARTE ---
export const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            "basemap": { type: "raster", tiles: [basemaps[0].tiles], tileSize: 256 }
        },
        layers: [{ id: "basemap-layer", type: "raster", source: "basemap" }]
    },
    center: [2.35, 48.85],
    zoom: 12,
    attributionControl: false
});
map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
loaderStep(30, 'Connexion aux tuiles');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), 'bottom-left');

/**
 * Sets up all map event listeners.
 * Receives external functions as a callbacks object to avoid circular dependencies.
 *
 * @param {Object} callbacks
 * @param {Function} callbacks.ensureLayer - (year, region) => void
 * @param {Function} callbacks.init - () => Promise
 * @param {Function} callbacks.updateStats - () => void
 * @param {Function} callbacks.loadRegionalWeather - (region) => void
 * @param {Function} callbacks.addMeasurePoint - (lngLat) => void
 * @param {Function} callbacks.highlightFeature - (feature) => void
 * @param {Function} callbacks.showDetails - (e, parcelId, props, region) => void
 * @param {Function} callbacks.addParcelToExploitation - (parcelId, props, lngLat, feature) => void
 * @param {Function} callbacks.showAuthModal - () => void
 * @param {Function} [callbacks.getSelectMode] - () => boolean
 * @param {Function} [callbacks.getCurrentUser] - () => object|null
 * @param {Function} [callbacks.getCurrentExploitation] - () => object|null
 * @param {Function} [callbacks.getLineageData] - () => object|null
 * @param {Function} [callbacks.getMeasureMode] - () => boolean
 * @param {Function} callbacks.getColorExpression - () => mapboxgl.Expression
 * @param {Function} callbacks.updateMapColors - () => void
 */
export function setupMapListeners(callbacks) {
    const {
        ensureLayer,
        init,
        updateStats,
        loadRegionalWeather,
        addMeasurePoint,
        highlightFeature,
        showDetails,
        addParcelToExploitation,
        showAuthModal,
        getSelectMode,
        getCurrentUser,
        getCurrentExploitation,
        getLineageData,
        getMeasureMode,
        getColorExpression: getColorExpr,
        updateMapColors,
    } = callbacks;

    if (getColorExpr) getColorExpression = getColorExpr;

    // Helper to read external state via getters (fallback to module-level vars)
    const isSelectMode = () => getSelectMode ? getSelectMode() : selectMode;
    const getUser = () => getCurrentUser ? getCurrentUser() : currentUser;
    const getExploitation = () => getCurrentExploitation ? getCurrentExploitation() : currentExploitation;
    const getLineage = () => getLineageData ? getLineageData() : lineageData;
    const isMeasureMode = () => getMeasureMode ? getMeasureMode() : measureMode;

    // ── map.on('load') ──
    map.on('load', () => {
        loaderStep(60, 'Chargement des parcelles');
        mapReady = true;
        const year = document.getElementById('year-select').value;
        const region = document.getElementById('region-select').value;

        loaderStep(80, 'Chargement des données');
        init().then(() => {
            loaderStep(90, 'Chargement des couches carto');
            loadRegionalWeather(region);
            try {
                if (region === 'ALL') {
                    [...document.getElementById('region-select').options]
                        .map(o => o.value).filter(v => v !== 'ALL')
                        .forEach(r => ensureLayer(year, r));
                } else {
                    ensureLayer(year, region);
                }
            } catch (e) { console.warn('ensureLayer:', e); }

            loaderStep(95, 'Finalisation');
            updateStats();
            // After layers are created, apply the correct colors.
            if (updateMapColors) {
                updateMapColors();
            }

            // Masquer le loader dès que la carte est idle (tuiles rendues) OU après 6s max
            const loaderTimeout = setTimeout(hideLoader, 6000);
            map.once('idle', () => {
                clearTimeout(loaderTimeout);
                setTimeout(hideLoader, 300);
            });
        });
    });

    // ── Error & safety timeout ──
    map.on('error', () => showLoaderError());
    // Sécurité : après 10s si le loader est encore visible, proposer Réessayer
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if (loader && !loader.classList.contains('hidden') && !loader.classList.contains('loader-error')) {
            showLoaderError();
        }
    }, 10000);

    // ── Coordinate display ──
    map.on('mousemove', (e) => {
        const { lng, lat } = e.lngLat;
        const zoom = map.getZoom().toFixed(1);
        const latStr = lat >= 0 ? `${lat.toFixed(4)}\u00b0 N` : `${Math.abs(lat).toFixed(4)}\u00b0 S`;
        const lngStr = lng >= 0 ? `${lng.toFixed(4)}\u00b0 E` : `${Math.abs(lng).toFixed(4)}\u00b0 W`;
        document.getElementById('coord-display').textContent = `${latStr}, ${lngStr} \u2014 Zoom ${zoom}`;
    });

    // ── Stats update on view change ──
    map.on('moveend', updateStats);
    map.on('zoomend', () => {
        document.getElementById('stat-zoom').textContent = map.getZoom().toFixed(1);
        updateStats();
    });

    // ── Parcel click handler ──
    map.on('click', (e) => {
        if (isMeasureMode()) {
            addMeasurePoint(e.lngLat);
            return;
        }

        const year = document.getElementById('year-select').value;

        // On récupère TOUTES les couches de l'année sélectionnée qui commencent par "lyr-"
        const activeLayers = map.getStyle().layers
            .filter(l => l.id.startsWith('lyr-') && l.id.includes(`_${year}`) && !l.id.includes('outline') && !l.id.includes('highlight'))
            .map(l => l.id);

        console.log('[DEBUG CLICK] Année:', year, '| Couches actives:', activeLayers, '| Toutes les couches:', map.getStyle().layers.map(l => l.id));

        if (activeLayers.length === 0) {
            console.log('[DEBUG CLICK] Aucune couche active trouvée pour', year);
            return;
        }

        // On cherche la parcelle parmi toutes ces couches
        const features = map.queryRenderedFeatures(e.point, { layers: activeLayers });
        console.log('[DEBUG CLICK] Features trouvées:', features);
        if (!features.length) return;

        const feature = features[0];
        const props = feature.properties;

        const parcelId = String(
            props.ID_PARCEL
            ?? props.id_parcel
            ?? feature.id
            ?? props.ID
            ?? props.id
            ?? props.NUMERO
            ?? props.numero
            ?? props.FID
            ?? `${props.CODE_CULTU}_${e.lngLat.lat.toFixed(5)}_${e.lngLat.lng.toFixed(5)}`
        );
        console.log('[DEBUG CLICK] Feature properties CODE_CULTU:', props.CODE_CULTU, 'CODE_GROUP:', props.CODE_GROUP);
        const ld = getLineage();
        console.log('[iParcel] parcelId résolu =', parcelId, '| dans lineage ?', !!(ld && ld[parcelId]));

        // ── Select mode: add parcel to exploitation ──
        if (isSelectMode()) {
            const user = getUser();
            const exploitation = getExploitation();
            console.log('[DEBUG SELECT] Select mode is active. Auth check:', !!user, !!exploitation);
            if (!user || !exploitation) {
                showToast('Connectez-vous d\'abord', '\u26a0\ufe0f');
                showAuthModal();
                return;
            }
            console.log('[Exploitation] Ajout parcelle:', parcelId, 'props:', props);
            // Flash visuel sur la parcelle cliquée
            highlightFeature(feature);
            addParcelToExploitation(parcelId, props, e.lngLat, feature);
            return;
        }

        // Extraire la région depuis le layer ID (ex: "lyr-NORMANDIE_2023" → "NORMANDIE")
        const layerId = feature.layer && feature.layer.id || '';
        const featureRegion = layerId.startsWith('lyr-') ? layerId.slice(4).replace(/_\d{4}$/, '') : null;

        highlightFeature(feature);
        showDetails(e, parcelId, props, featureRegion);
    });

    // ── Mouse cursor handler ──
    map.on('mousemove', (e) => {
        const year = document.getElementById('year-select').value;
        const activeLayers = map.getStyle().layers
            .filter(l => l.id.startsWith('lyr-') && l.id.includes(`_${year}`) && !l.id.includes('outline') && !l.id.includes('highlight'))
            .map(l => l.id);

        if (activeLayers.length === 0) {
            map.getCanvas().style.cursor = isMeasureMode() ? 'crosshair' : '';
            return;
        }

        const features = map.queryRenderedFeatures(e.point, { layers: activeLayers });
        map.getCanvas().style.cursor = (features.length > 0) ? 'pointer' : (isMeasureMode() ? 'crosshair' : '');
    });
}

// ── Basemap ──
export function swapBasemap(idx) {
    if (!mapReady) return;
    const bm = basemaps[idx];
    try {
        if (map.getLayer('basemap-layer')) map.removeLayer('basemap-layer');
        if (map.getSource('basemap')) map.removeSource('basemap');
    } catch (e) { }
    map.addSource('basemap', { type: 'raster', tiles: [bm.tiles], tileSize: 256 });
    const layers = map.getStyle().layers;
    const firstOther = layers.find(l => l.id !== 'basemap-layer');
    map.addLayer({ id: 'basemap-layer', type: 'raster', source: 'basemap' },
        firstOther ? firstOther.id : undefined);
}

export function setBasemap(name, btn) {
    const idx = basemaps.findIndex(b => b.name.toLowerCase().includes(name.toLowerCase()));
    if (idx < 0) return;
    basemapIndex = idx;
    swapBasemap(idx);
    if (btn) {
        btn.closest('div').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
    }
    showToast(`Fond de carte: ${basemaps[idx].name}`, "\ud83d\uddfa\ufe0f");
}

export function cycleBasemap() {
    basemapIndex = (basemapIndex + 1) % basemaps.length;
    swapBasemap(basemapIndex);
    showToast(`Fond: ${basemaps[basemapIndex].name}`, "\ud83d\uddfa\ufe0f");
}

// ── 3D Toggle ──
export function toggle3D() {
    is3D = !is3D;
    map.easeTo({ pitch: is3D ? 60 : 0, duration: 500 });
    document.getElementById('btn-3d').classList.toggle('active', is3D);
    showToast(is3D ? "Vue 3D activée" : "Vue 2D", "\ud83c\udfd4\ufe0f");
}

// ── Geolocation ──
export function geolocate() {
    if (!navigator.geolocation) return showToast("Géolocalisation non disponible", "\u26a0\ufe0f");
    navigator.geolocation.getCurrentPosition(pos => {
        map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 });
        new maplibregl.Marker({ color: '#22c55e' })
            .setLngLat([pos.coords.longitude, pos.coords.latitude])
            .addTo(map);
        showToast("Position trouvée", "\ud83d\udccd");
    }, () => showToast("Position refusée", "\u26a0\ufe0f"));
}

export function resetView() {
    map.flyTo({ center: [-3.29, 48.37], zoom: 12, pitch: 0, bearing: 0 });
}

// ── Satellite NDVI Viewer Module ──
// Handles satellite imagery loading, NDVI computation, and overlay display.

import { fromUrl, Pool } from 'geotiff';
import proj4 from 'proj4';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { basemaps } from '../shared/constants.js';

// ── Dependencies injected via setDependencies ──
let map = null;
let satelliteMiniMap = null;

export function setDependencies(deps) {
    if (deps.map) map = deps.map;
    if (deps.satelliteMiniMap !== undefined) satelliteMiniMap = deps.satelliteMiniMap;
}

// Expose getter/setter for satelliteMiniMap since it is recreated internally
export function getSatelliteMiniMap() { return satelliteMiniMap; }
export function setSatelliteMiniMap(val) { satelliteMiniMap = val; }

// ── Module-level state ──
export let satelliteMiniMapReady = false;

export const satelliteState = {
    parcelId: null,
    feature: null,
    year: 2023,
    month: '12',
    mode: 'ndvi',
    maxClouds: 20, // Tolérance par défaut : 20%
    maxSnow: 100,  // On ignore la neige par défaut
    cache: {},
    isLoading: false
};

// Fonction appelée quand on clique sur les boutons radio
export function changeSatelliteMode(mode) {
    satelliteState.mode = mode;

    // Gérer l'affichage de la légende NDVI
    const legend = document.getElementById('satellite-legend');
    if (legend) legend.style.opacity = mode === 'ndvi' ? '1' : '0';

    // Rafraîchir l'image actuelle si elle est en cache
    const cacheKey = `${satelliteState.year}-${satelliteState.month}`;
    if (satelliteState.cache[cacheKey] && satelliteState.cache[cacheKey] !== 'ERROR') {
        displayCachedSatelliteNDVI(cacheKey);
    }
}

/**
 * Initialise l'état Satellite pour la parcelle sélectionnée
 */
export function initSatelliteViz(parcelId, feature, { exploitationParcelles }) {
    // Si c'est déjà la même parcelle, on ne fait rien
    if (satelliteState.parcelId === parcelId) return;

    satelliteState.parcelId = parcelId;
    satelliteState.feature = feature;
    satelliteState.cache = {}; // Reset cache for new parcel

    // On nettoie la carte principale si un overlay existait
    clearSatelliteOverlay();

    // Destruction/Recreation du mini-viewer satellite
    if (satelliteMiniMap) {
        satelliteMiniMap.remove();
        satelliteMiniMap = null;
    }
    satelliteMiniMapReady = false;

    const container = document.getElementById('satellite-render-container');
    if (!container) return;

    // ── VÉRIFICATION EXPLOITATION ──
    // On vérifie si la parcelle est dans l'exploitation de l'utilisateur
    const inExploitation = exploitationParcelles.find(p => p.parcel_id === parcelId);
    const placeholder = document.getElementById('satellite-placeholder');
    const statusEl = document.getElementById('satellite-status');
    const sliderEl = document.getElementById('satellite-viz-slider');

    // Nettoyage message précédent
    const existingMsg = document.getElementById('sat-lock-message');
    if (existingMsg) existingMsg.remove();

    if (!inExploitation) {
        // CAS : Parcelle non suivie
        if (placeholder) placeholder.classList.remove('hidden');
        if (statusEl) statusEl.innerText = "";

        // Création du message de blocage
        const msgDiv = document.createElement('div');
        msgDiv.id = 'sat-lock-message';
        msgDiv.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255,255,255,0.85); backdrop-filter: blur(2px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            z-index: 10; text-align: center; padding: 20px;
        `;
        msgDiv.innerHTML = `
            <div style="font-size: 2rem; margin-bottom: 10px;">🔒</div>
            <h3 style="margin: 0 0 5px 0; color: var(--text-main);">Données Satellite Verrouillées</h3>
            <p style="margin: 0 0 15px 0; color: var(--text-muted); font-size: 0.9rem;">
                Ajoutez cette parcelle à votre exploitation pour accéder à l'historique NDVI.
            </p>
            <button class="auth-btn" style="width:auto; padding:8px 16px;" onclick="triggerAddParcel()">
                + Ajouter à mon exploitation
            </button>
        `;
        container.style.position = 'relative';
        container.appendChild(msgDiv);

        // Désactiver les contrôles
        if (sliderEl) sliderEl.disabled = true;
        return;
    }

    // CAS : Parcelle suivie
    if (sliderEl) sliderEl.disabled = false;
    if (placeholder) placeholder.classList.remove('hidden');

    // Charger les données depuis le stockage local (Supabase) si disponibles
    if (inExploitation.ndvi_data && Object.keys(inExploitation.ndvi_data).length > 0) {
        console.log("[Satellite] Chargement depuis le cache BDD");
        satelliteState.cache = inExploitation.ndvi_data;
        // Afficher directement l'image courante si dispo
        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            // On doit attendre que la minimap soit créée ci-dessous
            setTimeout(() => displayCachedSatelliteNDVI(currentKey), 500);
        }
    }

    const bbox = turf.bbox(feature);
    satelliteMiniMap = new maplibregl.Map({
        container: container,
        style: {
            version: 8,
            sources: {
                "basemap": { type: "raster", tiles: [basemaps[0].tiles], tileSize: 256 }
            },
            layers: [{ id: "basemap", type: "raster", source: "basemap" }]
        },
        bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        fitBoundsOptions: { padding: 20 },
        interactive: true,
        attributionControl: false
    });

    satelliteMiniMap.on('load', () => {
        satelliteMiniMapReady = true;
        // Ajouter le contour de la parcelle
        satelliteMiniMap.addSource('parcel-outline', {
            type: 'geojson',
            data: feature
        });
        satelliteMiniMap.addLayer({
            id: 'parcel-outline-line',
            type: 'line',
            source: 'parcel-outline',
            paint: { 'line-color': '#ffffff', 'line-width': 2 }
        });

        // Si on a déjà des données en cache (depuis BDD), on affiche, sinon on lance le chargement
        const currentKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentKey] && satelliteState.cache[currentKey] !== 'ERROR') {
            displayCachedSatelliteNDVI(currentKey);
        } else {
            // Si pas de données BDD, on lance le chargement live (cas de fallback ou nouvelle année)
            satelliteVizLoadAll();
        }
    });
}

/**
 * Charge tous les mois de Janvier 2020 à Décembre 2023 séquentiellement.
 * Se lance automatiquement au clic via initSatelliteViz().
 */
export async function satelliteVizLoadAll() {
    if (satelliteState.isLoading) return;

    const loader = document.getElementById('satellite-loader');
    const loaderText = document.getElementById('satellite-loader-text');
    const loaderBar = document.getElementById('satellite-loader-bar');
    const placeholder = document.getElementById('satellite-placeholder');

    satelliteState.isLoading = true;
    const targetParcelId = satelliteState.parcelId; // Sécurité si on change de parcelle en cours de route

    if (loader) loader.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');

    // Génération chronologique inversée (de Décembre 2023 à Janvier 2020)
    const timepoints = [];
    for (let y = 2023; y >= 2020; y--) {
        for (let m = 12; m >= 1; m--) {
            timepoints.push({ year: y, month: String(m).padStart(2, '0') });
        }
    }

    let loadedCount = 0;

    for (const tp of timepoints) {
        // Interruption si changement de parcelle
        if (satelliteState.parcelId !== targetParcelId || !satelliteState.isLoading) break;

        const progress = Math.round((loadedCount / timepoints.length) * 100);
        if (loaderText) loaderText.innerText = `Analyse ${tp.month}/${tp.year}... (${progress}%)`;
        if (loaderBar) loaderBar.style.width = `${progress}%`;

        const cacheKey = `${tp.year}-${tp.month}`;

        if (!satelliteState.cache[cacheKey]) {
            try {
                const result = await calcSatelliteNDVI(satelliteState.feature, tp.year, tp.month);
                if (result) {
                    satelliteState.cache[cacheKey] = result;
                    if (satelliteState.year === tp.year && satelliteState.month === tp.month) {
                        displayCachedSatelliteNDVI(cacheKey);
                    }
                }
            } catch (err) {
                console.warn(`[Satellite] Aucun pixel clair pour ${cacheKey}:`, err.message);
                satelliteState.cache[cacheKey] = 'ERROR'; // On marque en erreur pour le slider
                if (satelliteState.year === tp.year && satelliteState.month === tp.month) {
                    document.getElementById('satellite-status').innerText = `❌ Image trop nuageuse pour ${tp.month}/${tp.year}.`;
                }
            }
        }
        loadedCount++;
    }

    // On s'assure qu'on est toujours sur la même parcelle avant de masquer le loader
    if (satelliteState.parcelId === targetParcelId) {
        if (loader) loader.classList.add('hidden');
        satelliteState.isLoading = false;

        const currentCacheKey = `${satelliteState.year}-${satelliteState.month}`;
        if (satelliteState.cache[currentCacheKey]) {
            displayCachedSatelliteNDVI(currentCacheKey);
        } else {
            document.getElementById('satellite-status').innerText = "Fin de l'analyse. Certaines dates sont trop nuageuses pour l'observation.";
        }
    }
}

/**
 * Affiche une image NDVI depuis le cache à l'aide de sa clé (ex: "2023-06")
 */
export function clearSatelliteOverlayFromMiniMap() {
    if (satelliteMiniMap && satelliteMiniMapReady) {
        if (satelliteMiniMap.getLayer('sat-layer')) satelliteMiniMap.removeLayer('sat-layer');
        if (satelliteMiniMap.getSource('sat-source')) satelliteMiniMap.removeSource('sat-source');
    }
}

export function displayCachedSatelliteNDVI(cacheKey) {
    const data = satelliteState.cache[cacheKey];
    if (!data || data === 'ERROR' || !satelliteMiniMapReady) return;

    const status = document.getElementById('satellite-status');
    status.style.color = '#10b981';
    status.innerText = `✅ Image affichée (${data.date}).`;

    if (satelliteMiniMap.getLayer('sat-layer')) {
        satelliteMiniMap.removeLayer('sat-layer');
        satelliteMiniMap.removeSource('sat-source');
    }

    // On choisit l'URL selon le mode sélectionné
    const imageUrl = satelliteState.mode === 'rgb' ? data.rgbUrl : data.ndviUrl;

    satelliteMiniMap.addSource('sat-source', {
        type: 'image',
        url: imageUrl,
        coordinates: data.coordinates
    });

    satelliteMiniMap.addLayer({
        id: 'sat-layer',
        type: 'raster',
        source: 'sat-source',
        paint: { 'raster-opacity': 1.0, 'raster-resampling': 'linear' }
    });

    if (satelliteMiniMap.getLayer('parcel-outline-line')) {
        satelliteMiniMap.moveLayer('parcel-outline-line');
    }
}

/**
 * Alias pour le bouton Actualiser
 */
export function satelliteVizLoadCurrent() {
    satelliteVizLoadAll();
}

/**
 * Core Logic: STAC -> GeoTIFF -> NDVI -> Clipping -> MapLibre Overlay
 */
export async function calcSatelliteNDVI(featureGeometry, year, month) {
    const bboxWgs = turf.bbox(featureGeometry);
    const startDate = `${year}-${month}-01T00:00:00Z`;
    const lastDay = new Date(year, parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${lastDay.toString().padStart(2, '0')}T23:59:59Z`;

    // Construction dynamique de la requête STAC
    const stacQuery = {
        "eo:cloud_cover": { "lte": satelliteState.maxClouds } // less than or equal
    };

    // N'ajouter le filtre neige que s'il est restrictif pour ne pas alourdir la requête API
    if (satelliteState.maxSnow < 100) {
        stacQuery["s2:snow_ice_percentage"] = { "lte": satelliteState.maxSnow };
    }

    const stacUrl = "https://earth-search.aws.element84.com/v1/search";
    const resp = await fetch(stacUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            collections: ["sentinel-2-l2a"],
            bbox: bboxWgs,
            datetime: `${startDate}/${endDate}`,
            limit: 3,
            query: stacQuery
        })
    });;

    const data = await resp.json();
    if (!data.features || data.features.length === 0) {
        throw new Error("Aucune image sans nuages sur cette période.");
    }

    const stacFeature = data.features[0];
    const acquisitionDate = new Date(stacFeature.properties.datetime).toLocaleDateString('fr-FR');

    // Méta-données géospatiales depuis la bande rouge
    const tiffB04 = await fromUrl(stacFeature.assets.red.href);
    const imageB04 = await tiffB04.getImage();
    let epsgCode = stacFeature.properties['proj:epsg'] || imageB04.geoKeys.ProjectedCSTypeGeoKey;
    const origin = imageB04.getOrigin();
    const res = imageB04.getResolution();
    const transform = [res[0], 0, origin[0], 0, res[1], origin[1]];

    const epsgDef = `EPSG:${epsgCode}`;
    const zone = epsgCode % 100;
    const isSouth = epsgCode >= 32700;
    proj4.defs(epsgDef, `+proj=utm +zone=${zone} ${isSouth ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`);

    const pNW = proj4('EPSG:4326', epsgDef, [bboxWgs[0], bboxWgs[3]]);
    const pSE = proj4('EPSG:4326', epsgDef, [bboxWgs[2], bboxWgs[1]]);
    const margin = 20;

    const pxL = Math.max(0, Math.floor((Math.min(pNW[0], pSE[0]) - margin - transform[2]) / transform[0]));
    const pxR = Math.ceil((Math.max(pNW[0], pSE[0]) + margin - transform[2]) / transform[0]);
    const pxT = Math.max(0, Math.floor((Math.max(pNW[1], pSE[1]) + margin - transform[5]) / transform[4]));
    const pxB = Math.ceil((Math.min(pNW[1], pSE[1]) - margin - transform[5]) / transform[4]);

    const windowArr = [pxL, pxT, pxR, pxB];
    const rw = windowArr[2] - windowArr[0];
    const rh = windowArr[3] - windowArr[1];

    if (rw * rh > 2000 * 2000) throw new Error("Parcelle trop grande.");

    // Chargement des 3 bandes : Rouge, Infrarouge (NDVI) et Visual (RGB)
    const pool = new Pool();
    const tiffB08 = await fromUrl(stacFeature.assets.nir.href);
    const tiffVisual = await fromUrl(stacFeature.assets.visual.href);

    const imageB08 = await tiffB08.getImage();
    const imageVisual = await tiffVisual.getImage();

    const rB04 = await imageB04.readRasters({ pool, window: windowArr });
    const rB08 = await imageB08.readRasters({ pool, window: windowArr });
    const rVisual = await imageVisual.readRasters({ pool, window: windowArr });

    // --- 1. Génération NDVI ---
    const offCanvasNdvi = document.createElement('canvas');
    offCanvasNdvi.width = rw; offCanvasNdvi.height = rh;
    const offCtxNdvi = offCanvasNdvi.getContext('2d');
    const imgDataNdvi = offCtxNdvi.createImageData(rw, rh);

    const redArr = rB04[0];
    const nirArr = rB08[0];

    let sumNdvi = 0;
    let countNdvi = 0;

    for (let i = 0; i < redArr.length; i++) {
        const r = redArr[i], n = nirArr[i];
        // On ignore les pixels noirs (0) souvent hors de l'image
        if (r === 0 && n === 0) {
            // Transparent
            imgDataNdvi.data[i * 4 + 3] = 0;
            continue;
        }

        const ndvi = (r + n > 0) ? (n - r) / (n + r) : 0;

        // Stats (on exclut l'eau ou les valeurs aberrantes si besoin, ici simple)
        sumNdvi += ndvi;
        countNdvi++;

        const color = getNdviColor(ndvi);
        const idx = i * 4;
        imgDataNdvi.data[idx] = color[0]; imgDataNdvi.data[idx + 1] = color[1];
        imgDataNdvi.data[idx + 2] = color[2]; imgDataNdvi.data[idx + 3] = color[3];
    }
    offCtxNdvi.putImageData(imgDataNdvi, 0, 0);

    const meanNdvi = countNdvi > 0 ? (sumNdvi / countNdvi).toFixed(3) : 0;

    // --- 2. Génération Vraie Image (RGB) ---
    const offCanvasRgb = document.createElement('canvas');
    offCanvasRgb.width = rw; offCanvasRgb.height = rh;
    const offCtxRgb = offCanvasRgb.getContext('2d');
    const imgDataRgb = offCtxRgb.createImageData(rw, rh);

    const rChan = rVisual[0], gChan = rVisual[1], bChan = rVisual[2];
    for (let i = 0; i < rChan.length; i++) {
        const idx = i * 4;
        // Multiplié par 1.4 pour rehausser légèrement la luminosité naturelle de Sentinel-2
        imgDataRgb.data[idx] = Math.min(255, rChan[i] * 1.4);
        imgDataRgb.data[idx + 1] = Math.min(255, gChan[i] * 1.4);
        imgDataRgb.data[idx + 2] = Math.min(255, bChan[i] * 1.4);
        imgDataRgb.data[idx + 3] = 255;
    }
    offCtxRgb.putImageData(imgDataRgb, 0, 0);

    // --- 3. Découpage exact (Clipping) ---
    const utmLeft = transform[2] + windowArr[0] * transform[0];
    const utmRight = transform[2] + windowArr[2] * transform[0];
    const utmTop = transform[5] + windowArr[1] * transform[4];
    const utmBottom = transform[5] + windowArr[3] * transform[4];

    const nwWgs = proj4(epsgDef, 'EPSG:4326', [utmLeft, utmTop]);
    const seWgs = proj4(epsgDef, 'EPSG:4326', [utmRight, utmBottom]);

    const clipAndFilter = (sourceCanvas) => {
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = rw; finalCanvas.height = rh;
        const ctx = finalCanvas.getContext('2d');
        ctx.beginPath();
        const geom = featureGeometry.geometry;
        if (geom.type === 'Polygon') {
            _drawSatPolygon(ctx, geom.coordinates, nwWgs, seWgs, rw, rh);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(poly => _drawSatPolygon(ctx, poly, nwWgs, seWgs, rw, rh));
        }
        ctx.clip();
        ctx.filter = 'blur(1.2px)'; // Léger flou pour lisser les pixels 10m
        ctx.drawImage(sourceCanvas, 0, 0);
        return finalCanvas.toDataURL();
    };

    return {
        ndviUrl: clipAndFilter(offCanvasNdvi),
        rgbUrl: clipAndFilter(offCanvasRgb),
        date: acquisitionDate,
        mean: meanNdvi, // Ajout de la moyenne pour usage futur (courbes)
        coordinates: [
            [nwWgs[0], nwWgs[1]], // TL
            [seWgs[0], nwWgs[1]], // TR
            [seWgs[0], seWgs[1]], // BR
            [nwWgs[0], seWgs[1]]  // BL
        ]
    };
}

/**
 * Nettoie le calque satellite sur la carte principale
 */
export function clearSatelliteOverlay() {
    if (satelliteState.overlay) {
        map.removeLayer(satelliteState.overlay.id);
        map.removeSource(satelliteState.overlay.id);
        satelliteState.overlay = null;
    }
}

export function getNdviColor(val) {
    if (isNaN(val) || val <= -0.1) return [0, 0, 0, 0];
    if (val < 0.1) return [207, 90, 90, 255];
    if (val < 0.3) return [241, 194, 67, 255];
    if (val < 0.5) return [197, 216, 109, 255];
    if (val < 0.7) return [99, 163, 85, 255];
    return [30, 97, 42, 255];
}

function _drawSatPolygon(ctx, rings, nw, se, w, h) {
    rings.forEach(ring => {
        ring.forEach((coord, i) => {
            const x = (coord[0] - nw[0]) / (se[0] - nw[0]) * w;
            const y = (nw[1] - coord[1]) / (nw[1] - se[1]) * h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
    });
}

/**
 * Applique les filtres de nuages et de neige, vide le cache et relance la recherche.
 * Cette fonction doit être globale pour être appelée depuis le HTML.
 */
export function applySatelliteFilters() {
    // 1. Mettre à jour l'état
    const cloudVal = document.getElementById('sat-filter-cloud')?.value;
    const snowVal = document.getElementById('sat-filter-snow')?.value;

    if (cloudVal) satelliteState.maxClouds = parseInt(cloudVal);
    if (snowVal) satelliteState.maxSnow = parseInt(snowVal);

    // 2. Vider le cache car les critères ont changé
    satelliteState.cache = {};
    clearSatelliteOverlayFromMiniMap();

    // 3. Relancer la recherche globale
    satelliteVizLoadAll();
}

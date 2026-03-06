// ── Agronomy V3 Scoring Engine ──

import { CROP_FAMILIES, GROUP_FAMILIES } from './constants.js';

export function _getFamily(entry) {
    if (!entry) return "other";
    const c = entry.c || "";
    const g = entry.g || "";
    if (c && CROP_FAMILIES[c]) return CROP_FAMILIES[c].fam;
    if (g && GROUP_FAMILIES[g]) return GROUP_FAMILIES[g];
    return "other";
}

export function _getSeason(entry) {
    if (!entry) return "unknown";
    const c = entry.c || "";
    const winter = new Set(["BLE", "BTH", "BTP", "BTD", "ORG", "ORH", "ORP", "SEI", "TRI", "AVO", "AVH", "AVP", "COL", "CZH", "CZP", "EPE"]);
    const spring = new Set(["MAI", "MAA", "MAF", "MAE", "SOR", "MIL", "SOJ", "TPL", "TPT", "TRN", "POI", "POH", "POP", "FEV", "FVP", "BET", "POM", "PTA"]);
    if (winter.has(c)) return "winter";
    if (spring.has(c)) return "spring";
    const fam = _getFamily(entry);
    if (fam === "rest") return "rest";
    // Fallback with group codes for season
    const g = entry.g || "";
    const winterGroups = new Set(["1", "3", "4", "5", "6", "7", "8"]);
    const springGroups = new Set(["2", "10", "14", "15", "16", "20"]);
    if (winterGroups.has(g)) return "winter";
    if (springGroups.has(g)) return "spring";
    return "unknown";
}

export function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
export function _safeDiv(a, b, fb = 0) { return b ? a / b : fb; }

export function _weightedEntropy(wByKey) {
    let sum = 0;
    for (const k in wByKey) sum += wByKey[k];
    if (sum <= 0) return 0;
    let H = 0;
    for (const k in wByKey) {
        const p = wByKey[k] / sum;
        if (p > 0) H += -p * Math.log(p);
    }
    return H;
}

export function _normalizedEntropy(wByKey) {
    const keys = Object.keys(wByKey).filter(k => wByKey[k] > 0);
    const K = keys.length;
    if (K <= 1) return 0;
    return _clamp(_weightedEntropy(wByKey) / Math.log(K), 0, 1);
}

export function _recencyWeight(yearsAgo, halflife = 3) {
    if (halflife <= 0) return 1;
    return Math.pow(0.5, yearsAgo / halflife);
}

export function _scoreToLabel(s) {
    if (s == null || Number.isNaN(s)) return "Donn\u00e9es insuffisantes";
    if (s >= 7.5) return "\u00c9tat Excellent";
    if (s >= 5.5) return "\u00c9tat Sain";
    if (s >= 3.5) return "\u00c9tat Moyen";
    if (s >= 2.0) return "\u00c9tat Fragile";
    return "\u00c9tat Critique";
}

// ── Configurable scoring parameters (editable from Parametres tab) ──
export let scoringParams = {
    returns: {
        oilseeds: { min: 3, sev: 1.2 },
        legumes: { min: 3, sev: 0.9 },
        maize: { min: 2, sev: 0.7 },
        winterCereals: { min: 2, sev: 0.8 },
        cereals: { min: 2, sev: 0.6 },
    },
    cerealization: { threshold: 0.7, sev: 1.0 },
    diversity: { lowThreshold: 0.35, highThreshold: 0.75, sevLow: 1.0, bonusHigh: 0.5 },
    seasonAlternation: { lowThreshold: 0.25, sevLow: 0.8, bonusHigh: 0.3 },
    rests: { bonusWeight: 1.5, postRestBonus: 0.7 },
    legumesBonus: 0.5,
    cipanBonus: 0.4,
    recencyHalflife: 3,
    useConfidence: true,
};

/**
 * V3 Expert Agronomic Engine -- Normalized Sub-Score Architecture.
 *
 * Computes 4 independent sub-scores, each 0-100, then weighted average.
 *   1. Diversity (20%):  Shannon entropy on families + Root System Diversity
 *   2. Succession (25%): Transition matrix quality + season alternation
 *   3. Sanitary (25%):   Return interval compliance + cerealization penalty
 *   4. Coverage (30%):   Rest proportion, continuous streak, CIPAN, legumes
 *
 * All sub-scores apply exponential half-life decay weighting.
 *
 * @param {Array} entries - [{c, g, y, cf, d2, d3}, ...] sorted newest first
 * @param {Object} agronomicRules - The loaded agronomic rules JSON
 * @returns {{score, details}}
 */
export function computeRotationScoreV3(entries, agronomicRules) {
    console.log("[DEBUG AGRONOMY] computeRotationScoreV3 called. agronomicRules argument:", agronomicRules);
    const logs = [];
    if (!agronomicRules) {
        console.warn("[iParcel] Agronomic rules not yet loaded, using fallback.");
        return { score: 50, label: "Initialisation...", details: {}, logs };
    }

    const rules = agronomicRules;
    const { ROOT_SYSTEM_MAP, TRANSITION_MATRIX, RETURN_INTERVAL_THRESHOLDS, SCORING_CONSTANTS } = rules;

    const hist = [...entries].sort((a, b) => b.y - a.y);
    const currentYear = hist.length > 0 ? hist[0].y : 2023;
    const halflife = SCORING_CONSTANTS.DECAY_HALFLIFE || 3;
    const k = Math.log(2) / halflife;

    // ── Apply temporal decay weights ──
    const weightedEntries = hist.map(e => {
        const deltaT = currentYear - e.y;
        const weight = Math.exp(-k * deltaT) * (e.pct || 1);
        return { ...e, weight };
    });
    const totalWeight = weightedEntries.reduce((sum, e) => sum + e.weight, 0);
    if (totalWeight <= 0) {
        logs.push({ type: 'neutral', label: 'Donn\u00e9es', desc: 'Historique insuffisant pour un calcul pr\u00e9cis.' });
        return { score: 0, label: "Donn\u00e9es insuffisantes", details: {}, logs };
    }

    // ── Classify all entries ──
    const famWeights = {};
    const rootWeights = { P: 0, F: 0, M: 0 };

    weightedEntries.forEach(e => {
        const fam = _getFamily(e);
        const root = ROOT_SYSTEM_MAP[e.c] || (CROP_FAMILIES[e.c] && CROP_FAMILIES[e.c].root) || "M";
        famWeights[fam] = (famWeights[fam] || 0) + e.weight;
        rootWeights[root] = (rootWeights[root] || 0) + e.weight;
    });

    const restProportion = (famWeights["rest"] || 0) / totalWeight;
    const legumeProportion = (famWeights["legumes"] || 0) / totalWeight;
    const cerealProportion = (famWeights["cereals"] || 0) / totalWeight;

    // Count continuous rest streak from most recent year
    let restStreak = 0;
    for (let i = 0; i < hist.length; i++) {
        if (_getFamily(hist[i]) === "rest") restStreak++;
        else break;
    }

    // ═══════════════════════════════════════
    // ── SUB-SCORE 1: DIVERSITY (0-100) ──
    // ═══════════════════════════════════════
    // Prairies are inherently biodiverse (hundreds of species in a grassland).
    // RPG data shows one code but reality is a complex multi-species ecosystem.
    let diversityScore;

    if (restProportion >= 0.7) {
        // Permanent grasslands: high intrinsic biodiversity
        diversityScore = 75 + restProportion * 25; // 75-100
        logs.push({ type: 'positive', label: 'Diversit\u00e9', change: '+', desc: 'Forte pr\u00e9sence de couvert permanent / prairie, favorisant la biodiversit\u00e9 globale.' });
    } else {
        // Shannon entropy on agronomic families
        let entropy = 0;
        const familyKeys = Object.keys(famWeights);
        familyKeys.forEach(fam => {
            const p = famWeights[fam] / totalWeight;
            if (p > 0) entropy -= p * Math.log(p);
        });
        const maxEntropy = Math.log(Math.max(familyKeys.length, 2));
        const normalizedH = maxEntropy > 0 ? entropy / maxEntropy : 0; // 0-1

        // Root System Diversity (DSR): equitability of P/F/M presence
        const activeRoots = Object.values(rootWeights).filter(w => w > 0).length;
        const dsrNorm = activeRoots / 3; // 0-1

        // Combined: Shannon 60% + DSR 40%, scaled to 100
        diversityScore = (normalizedH * 0.6 + dsrNorm * 0.4) * 100;

        if (diversityScore > 75) logs.push({ type: 'positive', label: 'Diversit\u00e9', change: '+', desc: `${familyKeys.length} familles distinctes d\u00e9tect\u00e9es avec une bonne r\u00e9partition des syst\u00e8mes racinaires.` });
        else if (diversityScore < 30) logs.push({ type: 'negative', label: 'Diversit\u00e9', change: '-', desc: `Faible diversit\u00e9 de familles botaniques dans la rotation.` });
    }
    diversityScore = _clamp(diversityScore, 0, 100);

    // ═══════════════════════════════════════════
    // ── SUB-SCORE 2: SUCCESSION QUALITY (0-100) ──
    // ═══════════════════════════════════════════
    let successionScore;

    if (hist.length < 2) {
        successionScore = 50; // Insufficient data
    } else if (restProportion >= 0.7) {
        // Continuous prairie = excellent succession (active soil restoration)
        successionScore = 80 + _clamp(restStreak, 0, 6) * 3.3; // 80-100
        if (restStreak > 2) logs.push({ type: 'positive', label: 'Succession', change: '+', desc: `Maintien d'un couvert permanent sur ${restStreak + 1} ans de suite (restauration active des sols).` });
    } else {
        // Evaluate each transition using the agronomic matrix
        let transSum = 0;
        let transWeightSum = 0;
        let seasonChanges = 0;

        for (let i = 0; i < weightedEntries.length - 1; i++) {
            const curr = weightedEntries[i];
            const prev = weightedEntries[i + 1];
            const famCurr = _getFamily(curr);
            const famPrev = _getFamily(prev);

            const coeff = (TRANSITION_MATRIX[famPrev] && TRANSITION_MATRIX[famPrev][famCurr]) || 0;
            const avgW = (curr.weight + prev.weight) / 2;
            transSum += coeff * avgW;
            transWeightSum += avgW;

            // Season alternation bonus
            const sCurr = _getSeason(curr);
            const sPrev = _getSeason(prev);

            if (coeff > 1.0) logs.push({ type: 'positive', label: 'Succession', change: '+', desc: `Excellente transition : ${CROP_FAMILIES[prev.c]?.name || prev.c} vers ${CROP_FAMILIES[curr.c]?.name || curr.c} (${prev.y}\u2192${curr.y}).` });
            else if (coeff < 0.0) logs.push({ type: 'negative', label: 'Succession', change: '-', desc: `Succession d\u00e9conseill\u00e9e : ${CROP_FAMILIES[prev.c]?.name || prev.c} vers ${CROP_FAMILIES[curr.c]?.name || curr.c} (${prev.y}\u2192${curr.y}).` });

            if (sCurr !== sPrev && sCurr !== "unknown" && sPrev !== "unknown"
                && sCurr !== "rest" && sPrev !== "rest") {
                seasonChanges += avgW;
            }
        }

        // Normalize: matrix range is [-2.5, +2.0] -> map to [0, 80]
        const avgTrans = transWeightSum > 0 ? transSum / transWeightSum : 0;
        successionScore = ((avgTrans + 2.5) / 4.5) * 80;

        // Season alternation bonus (up to 20 pts)
        const seasonAltRatio = transWeightSum > 0 ? seasonChanges / transWeightSum : 0;
        successionScore += seasonAltRatio * 20;
        if (seasonAltRatio > 0.4) logs.push({ type: 'positive', label: 'Succession', change: '+', desc: `Bonne alternance des semis de printemps et d'hiver.` });
    }
    successionScore = _clamp(successionScore, 0, 100);

    // ═══════════════════════════════════════════════
    // ── SUB-SCORE 3: PHYTOSANITARY SAFETY (0-100) ──
    // ═══════════════════════════════════════════════
    // Starts at 100 (safe). Violations subtract points.
    let sanitaryScore = 100;
    const lastSeenYear = {};

    // Track return interval violations (oldest -> newest)
    [...weightedEntries].reverse().forEach(e => {
        const crop = e.c || "AUT";
        const threshold = RETURN_INTERVAL_THRESHOLDS[crop] || 0;

        if (threshold > 0 && lastSeenYear[crop] !== undefined) {
            const gap = e.y - lastSeenYear[crop];
            if (gap < threshold) {
                // Severity increases quadratically as gap shrinks
                const severity = Math.pow((threshold - gap + 1) / threshold, 2);
                sanitaryScore -= severity * 15 * e.weight;
                logs.push({ type: 'negative', label: 'Sanitaire', change: '-', desc: `Retour trop rapide de ${CROP_FAMILIES[crop]?.name || crop} (${gap} ans vs ${threshold} ans recommand\u00e9s) en ${e.y}. Risque maladies.` });
            }
        }
        lastSeenYear[crop] = e.y;
    });

    // Cerealization penalty: excessive cereals degrade soil structure & biology
    if (cerealProportion > 0.6) {
        sanitaryScore -= (cerealProportion - 0.6) * 60; // Up to -24 pts for 100% cereals
        logs.push({ type: 'negative', label: 'Sanitaire', change: '-', desc: `Omnipr\u00e9sence de c\u00e9r\u00e9ales (${Math.round(cerealProportion * 100)}%), favorisant l'appauvrissement du sol et le risque gramin\u00e9es.` });
    }

    // WEATHER METRICS: Summer Heat Stress penalty on sensitive main crops
    weightedEntries.forEach(e => {
        if (typeof window !== 'undefined' && window.currentStationHistory) {
            const w = window.currentStationHistory[e.y];
            if (w) {
                const heatDays = (w["06"]?.heat_stress || 0) + (w["07"]?.heat_stress || 0);
                if (heatDays >= 15 && ["cereals", "industrial", "oilseeds"].includes(_getFamily(e))) {
                    sanitaryScore -= 5 * e.weight;
                    logs.push({ type: 'negative', label: 'Climat', change: '-', desc: `Fort stress thermique estival en ${e.y} (${heatDays} jours >25\u00b0C), d\u00e9gradant les sols et la culture.` });
                }
            }
        }
    });

    sanitaryScore = _clamp(sanitaryScore, 0, 100);

    // ═══════════════════════════════════════════════════
    // ── SUB-SCORE 4: SOIL COVERAGE & RESTORATION (0-100) ──
    // ═══════════════════════════════════════════════════
    let coverageScore = 0;

    // Base coverage: any active farming provides some soil coverage (up to 15)
    coverageScore += 15;

    // Rest/prairie proportion: convex curve (up to 45 pts)
    coverageScore += Math.pow(restProportion, 0.7) * 45;

    // Continuous rest streak bonus: logarithmic saturation (up to 15 pts)
    if (restStreak > 0) {
        coverageScore += _clamp(restStreak / 6, 0, 1) * 15;
    }

    // Legume presence in main rotation (up to 15 pts)
    coverageScore += _clamp(legumeProportion * 3, 0, 1) * 15;

    // CIPAN / Cover crop bonus (up to 10 pts)
    // Legume covers fix nitrogen -> extra bonus. Uses real RPG derobee codes (D** prefix).
    const LEGUME_COVERS = new Set([
        "DTR", "DLZ", "DVS", "DPS", "DFV", "DSJ",  // Trefle, Luzerne, Vesce, Pois, Feverole, Soja
        "DLP", "DSN", "DGS", "DLL", "DPC", "DLT",   // Lupin, Sainfoin, Gesse, Lentille, Pois chiche, Lotier
        "DFN", "DMN", "DMT", "DSH"                    // Fenugrec, Minette, Melilot, Sous-semis legumineuses
    ]);
    let cipanAccum = 0;
    weightedEntries.forEach(e => {
        const d1 = e.d1 || e.culture_d1 || "";
        const d2 = e.d2 || e.culture_d2 || "";
        if (d1 || d2) {
            let bonus = 1;
            if (LEGUME_COVERS.has(d1) || LEGUME_COVERS.has(d2)) bonus *= 1.5;
            if (d1 && d2) bonus *= 1.3; // Multi-species cover

            // WEATHER MODIFIER: Dry summer/autumn impacts emergence
            if (typeof window !== 'undefined' && window.currentStationHistory) {
                const w_prev = window.currentStationHistory[e.y - 1];
                if (w_prev && w_prev["08"] && w_prev["09"]) {
                    const dryLateSummer = (w_prev["08"].precip + w_prev["09"].precip) < 40;
                    if (dryLateSummer) {
                        bonus *= 0.6; // Reduced effectiveness
                        logs.push({ type: 'negative', label: 'Couverture', change: '-', desc: `Lev\u00e9e du couvert en ${e.y - 1} p\u00e9nalis\u00e9e par une fin d'\u00e9t\u00e9 tr\u00e8s s\u00e8che (< 40mm).` });
                    }
                }
            }
            cipanAccum += bonus * e.weight;
        }
    });
    if (cipanAccum > 0.1) {
        logs.push({ type: 'positive', label: 'Couverture', change: '+', desc: `Tr\u00e8s bonne pr\u00e9sence de cultures interm\u00e9diaires (CIPAN) pour couvrir le sol.` });
    }
    coverageScore += _clamp(cipanAccum / totalWeight * 5, 0, 1) * 20;

    coverageScore = _clamp(coverageScore, 0, 100);

    // ═════════════════════════════════════
    // ── FINAL SCORE: Weighted Average ──
    // ═════════════════════════════════════
    const W_DIV = 0.20, W_SUC = 0.25, W_SAN = 0.25, W_COV = 0.30;

    let finalScore =
        diversityScore * W_DIV +
        successionScore * W_SUC +
        sanitaryScore * W_SAN +
        coverageScore * W_COV;

    finalScore = _clamp(Math.round(finalScore), 0, 100);

    const metrics = {
        families: Object.keys(famWeights).length,
        crops: new Set(weightedEntries.map(e => e.c)).size,
        legumesPct: Math.round(legumeProportion * 100),
        cerealsPct: Math.round(cerealProportion * 100),
        prairiePct: Math.round(restProportion * 100),
        prairieStreak: restStreak,
        roots: Object.values(rootWeights).filter(w => w > 0).length,
        covers: weightedEntries.filter(e => e.d1 || e.d2).length
    };

    // ── Agronomic Badges (Proxies) ──
    const badges = [];

    // Bio Proxy: High legumes + high diversity (or permanent meadows)
    if ((metrics.legumesPct > 20 && diversityScore > 75) || (restProportion >= 0.8)) {
        badges.push({
            id: 'bio',
            label: 'Profil Bio',
            icon: '<img src="BIO.svg" alt="AB" style="height:14px; width:auto; margin-right:2px; vertical-align:middle;">'
        });
    }

    // ACS Proxy: Heavy CIPAN presence + good diversity
    if (totalWeight > 0 && (cipanAccum / totalWeight) > 0.75 && diversityScore > 60) {
        badges.push({
            id: 'acs',
            label: 'Profil ACS',
            icon: '<img src="ACS.jpg" alt="ACS" style="height:14px; width:auto; margin-right:2px; object-fit:contain; vertical-align:middle;">'
        });
    }

    return {
        score: finalScore,
        details: {
            diversity: Math.round(diversityScore),
            transitions: Math.round(successionScore),
            sanitary: Math.round(sanitaryScore),
            coverage: Math.round(coverageScore)
        },
        logs,
        metrics,
        badges
    };
}

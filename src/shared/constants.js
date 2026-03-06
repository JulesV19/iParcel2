// ── Shared Constants ──

export const years = ["2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016"];

export const CURRENT_YEAR = 2023;

// Region select value -> filesystem name (PMTiles & JSON buckets)
export const REGION_FILE_MAP = {
    BRETAGNE: 'Bretagne',
    HAUTS_DE_FRANCE: 'Hauts-de-France',
    NORMANDIE: 'Normandie',
    PAYS_DE_LA_LOIRE: 'Pays-de-la-Loire',
    CENTRE_VAL_DE_LOIRE: 'Centre-Val-de-Loire',
    ILE_DE_FRANCE: 'Ile-de-France',
    NOUVELLE_AQUITAINE: 'Nouvelle-Aquitaine',
};

export const cultureColors = {
    "1": "#fcd34d", "2": "#fb923c", "3": "#4ade80", "4": "#f87171",
    "5": "#a3e635", "6": "#f59e0b", "7": "#38bdf8", "8": "#c084fc",
    "9": "#2dd4bf", "10": "#f472b6", "11": "#a78bfa", "12": "#34d399",
    "13": "#fca5a5", "14": "#7dd3fc", "15": "#d8b4fe", "16": "#bef264",
    "17": "#fdba74", "18": "#fb7185", "19": "#67e8f9", "20": "#86efac",
    "21": "#fde68a", "22": "#c4b5fd", "23": "#a5f3fc", "24": "#fecaca",
    "25": "#bbf7d0", "26": "#ddd6fe", "27": "#fed7aa", "28": "#fecdd3",
    "default": "#94a3b8"
};

export const CROP_FAMILIES = {
    // -- Cereales d'hiver (groupes 1, 3, 4) --
    BLE: { fam: "cereals", root: "F" }, BTH: { fam: "cereals", root: "F" }, BTP: { fam: "cereals", root: "F" },
    BTA: { fam: "cereals", root: "F" }, BTN: { fam: "cereals", root: "F" }, BTD: { fam: "cereals", root: "F" },
    ORG: { fam: "cereals", root: "F" }, ORH: { fam: "cereals", root: "F" }, ORP: { fam: "cereals", root: "F" },
    AVO: { fam: "cereals", root: "F" }, AVH: { fam: "cereals", root: "F" }, AVP: { fam: "cereals", root: "F" },
    SEI: { fam: "cereals", root: "F" }, SGH: { fam: "cereals", root: "F" }, SGP: { fam: "cereals", root: "F" },
    TRI: { fam: "cereals", root: "F" }, TTH: { fam: "cereals", root: "F" }, TTP: { fam: "cereals", root: "F" },
    EPE: { fam: "cereals", root: "F" }, BDH: { fam: "cereals", root: "F" }, BDP: { fam: "cereals", root: "F" },
    MCR: { fam: "cereals", root: "F" }, MCS: { fam: "cereals", root: "F" },
    // -- Cereales d'ete (groupe 2, 4) --
    MAI: { fam: "cereals", root: "F" }, MAA: { fam: "cereals", root: "F" }, MAF: { fam: "cereals", root: "F" },
    MAE: { fam: "cereals", root: "F" }, MIE: { fam: "cereals", root: "F" }, MIS: { fam: "cereals", root: "F" },
    MID: { fam: "cereals", root: "F" }, MPC: { fam: "cereals", root: "F" },
    SOR: { fam: "cereals", root: "F" }, SOG: { fam: "cereals", root: "F" },
    MIL: { fam: "cereals", root: "F" }, MLT: { fam: "cereals", root: "F" },
    SRS: { fam: "cereals", root: "F" }, SNE: { fam: "cereals", root: "F" },
    // -- Oleagineux (groupes 5, 6, 7) --
    COL: { fam: "oilseeds", root: "P" }, CZH: { fam: "oilseeds", root: "P" }, CZP: { fam: "oilseeds", root: "P" },
    TRN: { fam: "oilseeds", root: "P" }, NVT: { fam: "oilseeds", root: "P" },
    SOJ: { fam: "legumes", root: "P" },
    // -- Proteagineux / Legumineuses (groupes 8, 9) --
    POI: { fam: "legumes", root: "P" }, POT: { fam: "legumes", root: "P" }, POR: { fam: "legumes", root: "P" },
    FEV: { fam: "legumes", root: "P" }, FVL: { fam: "legumes", root: "P" }, FVP: { fam: "legumes", root: "P" },
    LUZ: { fam: "legumes", root: "P" }, LU5: { fam: "legumes", root: "P" }, LU6: { fam: "legumes", root: "P" },
    LU7: { fam: "legumes", root: "P" }, LUD: { fam: "legumes", root: "P" },
    TRE: { fam: "legumes", root: "P" }, TR5: { fam: "legumes", root: "P" }, TR6: { fam: "legumes", root: "P" },
    // -- Prairies & Fourrages (groupes 11, 12, 18, 22, 24, 27) --
    PRA: { fam: "rest", root: "M" }, PPH: { fam: "rest", root: "M" }, PTR: { fam: "rest", root: "M" },
    PRL: { fam: "rest", root: "M" }, PTC: { fam: "rest", root: "M" }, PPR: { fam: "rest", root: "M" },
    PPP: { fam: "rest", root: "M" }, PPA: { fam: "rest", root: "M" }, PCL: { fam: "rest", root: "M" },
    RGA: { fam: "rest", root: "M" }, RGI: { fam: "rest", root: "M" },
    MLG: { fam: "rest", root: "M" }, MLF: { fam: "rest", root: "M" }, MLC: { fam: "rest", root: "M" },
    FET: { fam: "rest", root: "M" }, FLA: { fam: "rest", root: "M" }, FLP: { fam: "rest", root: "M" },
    SPH: { fam: "rest", root: "M" }, SPL: { fam: "rest", root: "M" },
    DTY: { fam: "rest", root: "M" }, DAC: { fam: "rest", root: "M" },
    BVF: { fam: "rest", root: "M" }, GFP: { fam: "rest", root: "M" }, FSG: { fam: "rest", root: "M" },
    // -- Jacheres (groupe 17) --
    JAC: { fam: "rest", root: "M" }, J6S: { fam: "rest", root: "M" }, J5M: { fam: "rest", root: "M" },
    J6P: { fam: "rest", root: "M" }, MH5: { fam: "rest", root: "M" }, MH6: { fam: "rest", root: "M" },
    MH7: { fam: "rest", root: "M" },
    // -- Legumes / Maraichage / Industriel (groupes 16, 19, 20, 23) --
    ART: { fam: "industrial", root: "P" }, CHU: { fam: "industrial", root: "P" }, CHV: { fam: "industrial", root: "P" },
    CHF: { fam: "industrial", root: "P" }, CEL: { fam: "industrial", root: "P" },
    HAR: { fam: "industrial", root: "F" }, CAR: { fam: "industrial", root: "P" }, PEP: { fam: "industrial", root: "F" },
    OIG: { fam: "industrial", root: "F" }, PPO: { fam: "industrial", root: "F" },
    BET: { fam: "industrial", root: "P" }, POM: { fam: "industrial", root: "F" },
    LBF: { fam: "industrial", root: "F" }, LDP: { fam: "industrial", root: "F" },
    BFS: { fam: "industrial", root: "P" }, BFP: { fam: "industrial", root: "P" },
    MCT: { fam: "industrial", root: "P" }, CES: { fam: "industrial", root: "P" },
    // -- Fruits, Vignes, Divers (groupes 25, 26, 28) --
    VRG: { fam: "other", root: "P" }, BOR: { fam: "other", root: "P" }, BOP: { fam: "other", root: "P" },
    CPL: { fam: "other", root: "P" }, SBO: { fam: "other", root: "P" },
    PHF: { fam: "other", root: "P" }, PFR: { fam: "other", root: "P" },
    FAG: { fam: "other", root: "P" }, TCR: { fam: "other", root: "P" },
    FRA: { fam: "other", root: "P" }, EPI: { fam: "other", root: "F" },
    CMB: { fam: "other", root: "M" }, RDI: { fam: "other", root: "P" },
    MDI: { fam: "other", root: "M" },
    AUT: { fam: "other", root: "M" },
};

// Mapping RPG numeric group codes -> agronomic families
// Source: REF_CULTURES_GROUPES_CULTURES_2023.csv
export const GROUP_FAMILIES = {
    // Text group codes
    CERE: "cereals", OLEA: "oilseeds", LEGU: "legumes",
    PRAI: "rest", JACH: "rest",
    // Numeric RPG group codes (CODE_GROUPE_CULTURE)
    "1": "cereals",      // Ble tendre
    "2": "cereals",      // Mais grain et ensilage
    "3": "cereals",      // Orge
    "4": "cereals",      // Autres cereales (triticale, seigle, avoine, sarrasin...)
    "5": "oilseeds",     // Colza
    "6": "oilseeds",     // Tournesol
    "7": "oilseeds",     // Autres oleagineux (soja, lin oleagineux...)
    "8": "legumes",      // Proteagineux (pois, feverole, lupin)
    "9": "industrial",   // Plantes a fibres (lin, chanvre)
    "11": "rest",        // Gel (jacheres sans production)
    "14": "cereals",     // Riz
    "15": "legumes",     // Legumineuses a grains (lentille, pois chiche)
    "16": "rest",        // Fourrage (prairies, fourrages, luzerne fourragere)
    "17": "rest",        // Estives, landes
    "18": "rest",        // Prairies permanentes
    "19": "rest",        // Prairies temporaires
    "20": "other",       // Vergers
    "21": "other",       // Vignes
    "22": "other",       // Fruits a coque
    "23": "other",       // Oliviers
    "24": "rest",        // Autres surfaces gelees ou en herbe
    "25": "industrial",  // Legumes ou fleurs
    "26": "industrial",  // Pommes de terre, betteraves
    "28": "other",       // Divers
};

export const basemaps = [
    { name: "Satellite", tiles: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}" },
    { name: "Rues", tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
    { name: "Terrain", tiles: "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}" },
    { name: "Sombre", tiles: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png" }
];

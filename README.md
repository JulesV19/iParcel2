# 🌾 iParcel — Twin Agricole Intelligent

iParcel est une plateforme interactive de visualisation et d'analyse de données agricoles. Elle permet d'explorer l'historique cultural des parcelles (données RPG), d'évaluer la qualité agronomique des rotations et de suivre la vigueur de la végétation par imagerie satellite.

![iParcel Dashboard](public/screenshot.png) <!-- Note: Ensure a screenshot exists or replace this placeholder -->

## 🚀 Fonctionnalités Clés

- **🌍 Carte Interactive Haute Performance** : Visualisation fluide de millions de parcelles grâce au format **PMTiles**.
- **📜 Historique RPG (2016-2023)** : Accès instantané à l'historique complet des cultures pour chaque parcelle.
- **🧠 Score Agronomique (V3)** : Évaluation automatique de la santé du sol basée sur la diversité, les successions, les délais de retour et la couverture hivernale.
- **🛰️ Analyse Satellite NDVI** : 
    - Intégration directe des données **Sentinel-2**.
    - Calcul de l'indice NDVI en temps réel.
    - **Nouveau** : Graphique d'évolution temporelle du NDVI moyen (2020-2023).
- **🗺️ Heatmap Spatiale** : Détection des hétérogénéités historiques au sein d'une même parcelle.
- **📊 Gestionnaire d'Exploitation** : Dashboard complet pour gérer un parcellaire, suivre les alertes et exporter des rapports PDF/CSV.

## 🛠️ Stack Technique

### Frontend
- **Moteur** : JavaScript Vanilla (ES6 Modules)
- **Cartographie** : MapLibre GL JS & PMTiles
- **Graphiques** : Chart.js
- **Géospatial** : Turf.js
- **Design** : CSS3 moderne (Glassmorphism, variables dynamiques)

### Backend & Persistance
- **API** : FastAPI (Python) & DuckDB
- **Infrastructure** : Supabase (Auth, PostgreSQL, Storage)
- **Satellite** : STAC API (Earth Search) & Sentinel-2 L2A

## 📦 Installation et Lancement

### Pré-requis
- Node.js (v18+)
- Python 3.10+
- Un compte Supabase (configurer les variables d'environnement)

### Frontend
```bash
# Installation des dépendances
npm install

# Lancement du serveur de développement
npm run dev
```

### Backend (Satellite API)
```bash
cd api
# Installation des dépendances Python
pip install -r requirements.txt

# Lancement de l'API avec Uvicorn
uvicorn main:app --reload --port 8000
```

## 📸 Captures d'écran

| Dashboard Global | Analyse Satellite |
| :---: | :---: |
| ![Dashboard](public/screenshot_dash.png) | ![Satellite](public/screenshot_sat.png) |

## 📄 Licence
Ce projet est sous licence privée. Tous droits réservés.

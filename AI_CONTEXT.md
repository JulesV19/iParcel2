# Parcelle Twin - Contexte du Projet

Ce fichier documente l'architecture, les choix techniques et la logique métier de **Parcelle Twin**. Il est destiné à fournir tout le contexte nécessaire aux futures interactions avec des assistants IA pour garantir la cohérence des développements.

## 🎯 Objectif du projet

Parcelle Twin est une application web cartographique interactive (front-end uniquement) permettant de visualiser l'historique cultural des parcelles agricoles françaises (données RPG - Registre Parcellaire Graphique) et d'évaluer la qualité agronomique de leurs rotations de cultures.

## 🛠️ Stack Technique

L'application est conçue pour être **100% Client-Side** (Serverless) afin d'être rapide et hébergeable de manière statique.

*   **Interface Web** : HTML5, CSS3 vanilla (Variables CSS, Flexbox/Grid), JavaScript Vanilla (`app.js`, `manager.js`).
*   **Base de Données & Auth** : [Supabase](https://supabase.com/). Gère l'authentification des utilisateurs, le stockage des exploitations (`exploitations`) et la liste des parcelles associées (`exploitation_parcelles`).
*   **Moteur Cartographique** : [MapLibre GL JS](https://maplibre.org/).
*   **Tuiles Vectorielles** : [PMTiles](https://protomaps.com/docs/pmtiles). Format d'archive de tuiles à fichier unique.
*   **Imagerie Satellite & NDVI** : [geotiff.js](https://geotiffjs.github.io/) pour le décodage des rasters Sentinel-2 natifs et [proj4.js](http://proj4js.org/) pour les projections à la volée.
*   **Calculs Géométriques Client** : [Turf.js](https://turfjs.org/). Utilisé pour l'analyse spatiale et le clipping de rasters.
*   **Traitement des données (Backend de préparation)** : Scripts Python (`rpg_to_pmtiles.py`) utilisant DuckDB pour analyser les fichiers shapefile/parquet du RPG brut, construire la généalogie des parcelles (filiations parent/enfant entre les années) et exporter le résultat final en PMTiles et JSON.

## 📂 Architecture des Données

Les données sont structurées de manière statique dans le dossier `/data` :

*   `/data/output_pmtiles/{year}/{Region}.pmtiles` : Géométries vectorielles des parcelles pour une année et une région données. Ces tuiles contiennent les propriétés de base (CODE_CULTU, CODE_GROUP, id).
*   `/data/output_json/{Region}_{bucketId}.json` : Buckets JSON contenant l'historique RPG pour un chargement rapide par lot. L'ID du bucket correspond aux deux derniers chiffres de l'ID parcelle.
*   **Supabase** : Stocke les métadonnées des parcelles utilisateur, y compris les scores calculés (V3) et les URLs NDVI (Base64) mises en cache lors des tâches en arrière-plan.

## 🧠 Logique Métier et Fonctionnalités Clés

### 1. Moteur de Score Agronomique (V3)
Situé dans `app.js` (`computeRotationScoreV3`), ce moteur évalue la santé agronomique d'une parcelle sur **0-100** via 4 sous-scores indépendants, chacun 0-100, combinés par moyenne pondérée :

*   **🌿 Diversité (20%)** : Indice de Shannon-Wiener sur les familles agronomiques + Diversité des Systèmes Racinaires (DSR : P/F/M). Les prairies permanentes (≥70% rest) obtiennent un bonus intrinsèque (écosystèmes naturellement biodiversifiés).
*   **🔄 Successions (25%)** : Qualité des transitions culturales via une `TRANSITION_MATRIX` 5×5 (cereals, oilseeds, legumes, rest, industrial) chargée depuis `agronomic_rules.json`. Bonus d'alternance saisonnière (hiver/printemps).
*   **🛡️ Sanitaire (25%)** : Pénalités pour non-respect des délais de retour (`RETURN_INTERVAL_THRESHOLDS` par culture), pénalité de céréalisation si céréales > 60%. Démarre à 100, les violations soustraient.
*   **🌱 Couverture (30%)** : Proportion de repos/prairie + streak continu + bonus CIPAN (cultures dérobées `CULTURE_D1`/`CULTURE_D2` avec codes `D**` du RPG) + présence de légumineuses.

**Indicateurs Clés (KPI)** : Le moteur V3 extrait également en temps réel 8 indicateurs globaux pour la parcelle affichés dans l'UI : nombre de familles, nombre de cultures distinctes, diversité des systèmes racinaires (1-3), séquence de prairie ininterrompue en années, % légumineuses, % céréales, % prairie total, et nombre d'années avec couverture hivernale.

Tous les calculs appliquent une **pondération de décroissance exponentielle** (demi-vie = 3 ans) pour refléter la mémoire biogéochimique du sol.

Les règles agronomiques (matrice de transition, seuils de retour, carte racinaire) sont externalisées dans `agronomic_rules.json`.

### 2. Heatmap Spatiale (Carte de Qualité par Zone)
Implémentation complexe utilisant `MapLibre` et `Turf.js` :
*   L'historique n'est pas toujours uniforme sur toute la surface d'une parcelle de 2023 (à cause de découpes passées).
*   L'app charge silencieusement les tuiles vectorielles des années précédentes (2016-2022) sous la parcelle courante.
*   Elle utilise `turf.intersect` pour découper mathématiquement la parcelle en "sous-zones" atomiques ayant un historique 100% homogène.
*   Chaque sous-zone est scorée indépendamment et colorée. Le score global affiché est la moyenne géographiquement pondérée de ces sous-zones.
*   **Effet de dégradé (Gradient Blending)** : MapLibre ne supportant pas le remplissage en dégradé entre polygones vectoriels, un "hack" visuel est appliqué : des lignes très épaisses et floutées (`line-blur`) sont dessinées sur les bordures des zones. Un masque inversé (`turf.difference(world, parcel)`) de la couleur du fond (`#f1f5f9`) est posé par-dessus pour cacher le flou qui déborderait à l'extérieur de la parcelle, créant un effet de chaleur fluide à l'intérieur tout en gardant des bords externes parfaitement nets.
*   **Tooltips avancés** : Au survol de la heatmap, un popup affiche les 4 dernières cultures spécifiques à cette petite sous-zone géographique.

### 3. Analyse NDVI Satellite (Sentinel-2 Natif)
Nouveau module intégré dans `app.js` permettant une analyse de la végétation sans backend :
*   **Acquisition Cloud** : Interrogation directe de l'API **AWS STAC** (Earth Search) pour trouver les images Sentinel-2 L2A les plus claires (<20% nuages) pour la parcelle cible.
*   **Calcul Browser-Side** : Téléchargement partiel (HTTP Range Requests) des bandes Red (B04) et NIR (B08) via `geotiff.js`, calcul du NDVI pixel par pixel et colorisation dynamique.
*   **Batch Loading & Cache** : Lors du clic sur une parcelle, l'app lance un chargement séquentiel de **TOUTES les années (2016-2023)**. Les résultats (DataURL) sont stockés dans `satelliteState.cache` pour permettre une navigation instantanée via le slider temporel.
*   **Clipping & Lissage** : L'image satellite est découpée (`ctx.clip`) selon le polygone exact de la parcelle. Un **filtre de lissage** (resampling linéaire + flou canvas de 1.2px) est appliqué pour adoucir les pixels de 10m/px de Sentinel-2.

### 4. Gestionnaire d'Exploitation Enterprise
Module dédié (`manager.html` / `manager.js`) pour l'analyse profonde multi-parcelles :
*   **Dashboard de Masse** : Vue d'ensemble de toutes les parcelles d'une exploitation avec recherche et tri (score, surface).
*   **Rotation Timelines** : Affichage graphique des 6 dernières années de cultures pour chaque parcelle avec codes couleurs.
*   **Galerie NDVI** : Visualisation directe de l'historique satellite sans retourner sur la carte.
*   **Audit Asynchrone** : L'ajout d'une parcelle déclenche une insertion immédiate des métadonnées dans Supabase, suivie d'une tâche de fond calculant les 4 ans de NDVI.

### 5. Chronologie et Composants UI
*   **Gestion des Onglets** : `switchSideTab` gère l'affichage isolé des modules (Infos, Qualité, Parcelle, Satellite).
*   **Viewer Isolé** : Le module Satellite utilise son propre `satelliteMiniMap` (MapLibre dédié).
*   **Couleurs des cultures** : Toujours synchronisées via le `CODE_GROUP` pour une cohérence globale (Légendes, Timelines, Maps).

## ⚠️ Règles pour les futurs développements IA

6.  **Sync Supabase/Local** : Toujours s'assurer que les clés Supabase sont synchronisées entre `app.js` et `manager.js`. L'app reste "static-first" mais Supabase sert de couche de persistance utilisateur.
7.  **Performance des Buckets** : Pour charger l'historique de plusieurs parcelles (ex: dashboard), utilisez `loadBucket` pour minimiser les requêtes HTTP.
8.  **Lissage Satellite** : Toujours appliquer le léger flou canvas (1.2px) pour éviter l'effet "pixelisé" des données Sentinel-2 à 10m.

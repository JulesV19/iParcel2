// ── Shared Utility Functions ──

import { REGION_FILE_MAP } from './constants.js';

/**
 * Convert a region select value to the filesystem name used for PMTiles & JSON buckets.
 */
export function regionToFile(region) {
    return REGION_FILE_MAP[region] || region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
}

/**
 * Extract the 2-digit bucket suffix from a parcel ID.
 * e.g. "035_012345" -> "45"
 */
export function getBucketId(id) {
    if (!id) return "00";
    const parts = id.split('_');
    const num = parts[parts.length - 1];
    return num.slice(-2).padStart(2, '0');
}

/**
 * Map a 0-100 score to a hex color on a red-to-green gradient.
 */
export function scoreToColor(s) {
    if (s == null || Number.isNaN(s)) return "#BDBDBD";
    let score = Math.max(0, Math.min(100, s));
    const stops = [
        { s: 0, r: 255, g: 30, b: 0 },      // Vibrant Red
        { s: 25, r: 255, g: 110, b: 0 },    // Vibrant Orange
        { s: 50, r: 255, g: 210, b: 0 },    // Vibrant Yellow
        { s: 75, r: 160, g: 255, b: 20 },   // Vibrant Yellow-Green
        { s: 100, r: 0, g: 255, b: 50 }     // Vibrant Green
    ];

    let i = 0;
    while (i < stops.length - 1 && score > stops[i + 1].s) {
        i++;
    }
    const c1 = stops[i];
    const c2 = stops[Math.min(i + 1, stops.length - 1)];

    let t = 0;
    if (c2.s > c1.s) t = (score - c1.s) / (c2.s - c1.s);

    const r = Math.round(c1.r + t * (c2.r - c1.r));
    const g = Math.round(c1.g + t * (c2.g - c1.g));
    const b = Math.round(c1.b + t * (c2.b - c1.b));

    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Show a toast notification.
 * @param {string} msg - Message to display.
 * @param {string} icon - Emoji icon prefix (default "✅").
 * @param {number} [durationMs] - Duration in ms. Defaults to 2000 for success, 4000 for errors.
 */
export function showToast(msg, icon = "\u2705", durationMs) {
    const t = document.getElementById('toast');
    t.innerHTML = `<span>${icon}</span> ${msg}`;
    t.classList.add('show');
    const duration = durationMs != null ? durationMs : (icon === '\u274C' || icon === '\u26A0\uFE0F' ? 4000 : 2000);
    setTimeout(() => t.classList.remove('show'), duration);
}

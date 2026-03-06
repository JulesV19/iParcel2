// ── Dark Mode ──

/**
 * Toggle dark mode on the document body.
 * Persists preference to localStorage under 'iparcel-dark'.
 */
export function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    document.getElementById('btn-darkmode').textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    localStorage.setItem('iparcel-dark', isDark ? '1' : '0');
}

/**
 * Restore dark mode preference from localStorage on page load.
 * Call this once when the DOM is ready.
 */
export function restoreDarkMode() {
    if (localStorage.getItem('iparcel-dark') === '1') {
        document.body.classList.add('dark-mode');
        document.getElementById('btn-darkmode').textContent = '\u2600\uFE0F';
    }
}

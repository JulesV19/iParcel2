import * as turf from '@turf/turf';
import { sb } from '../shared/supabase.js';
import { showToast } from '../shared/utils.js';
import { cultureColors } from '../shared/constants.js';

// ── State ──
export let currentUser = null;
export let currentExploitation = null;
export let exploitationParcelles = [];
export let selectMode = false;
let authMode = 'login';

// ── Dependencies ──
let deps = {};
export function setDependencies(d) { deps = d; }

export function toggleSelectMode() {
    if (!currentUser) {
        showAuthModal();
        return;
    }
    selectMode = !selectMode;
    document.getElementById('select-banner').classList.toggle('hidden', !selectMode);
    const btn = document.getElementById('btn-select-mode');
    if (btn) btn.classList.toggle('active', selectMode);

    if (selectMode) {
        if (deps.toggleSidebar) deps.toggleSidebar(false);
        updateSelectCount();
    }
}

export function updateSelectCount() {
    const el = document.getElementById('select-count');
    if (el) el.textContent = `${exploitationParcelles.length} / 200`;
}

export function finishSelectMode() {
    selectMode = false;
    document.getElementById('select-banner').classList.add('hidden');
    const btn = document.getElementById('btn-select-mode');
    if (btn) btn.classList.remove('active');
    if (deps.updateDashboard) deps.updateDashboard();
}

// ── Auth ──
export async function initAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        onAuthSuccess();
    }
    sb.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        updateAuthUI();
    });
}

export function showAuthModal() {
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('auth-email').focus();
    document.body.addEventListener('keydown', authModalFocusTrap);
}

export function hideAuthModal() {
    document.getElementById('auth-overlay').classList.add('hidden');
    document.getElementById('auth-error').textContent = '';
    document.body.removeEventListener('keydown', authModalFocusTrap);
    const btnAuth = document.getElementById('btn-auth');
    if (btnAuth) btnAuth.focus();
}

function authModalFocusTrap(e) {
    if (e.key !== 'Tab') return;
    if (document.getElementById('auth-overlay').classList.contains('hidden')) return;
    const focusables = document.querySelectorAll('#auth-overlay input, #auth-overlay button, #auth-overlay a');
    if (focusables.length === 0) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
}

export function switchAuthMode() {
    authMode = authMode === 'login' ? 'register' : 'login';
    document.getElementById('auth-title').textContent = authMode === 'login' ? 'Connexion' : 'Créer un compte';
    document.getElementById('auth-submit').textContent = authMode === 'login' ? 'Se connecter' : 'Créer un compte';
    document.getElementById('auth-toggle').innerHTML = authMode === 'login'
        ? 'Pas encore de compte ? <a onclick="switchAuthMode()">Créer un compte</a>'
        : 'Déjà un compte ? <a onclick="switchAuthMode()">Se connecter</a>';
    document.getElementById('auth-error').textContent = '';
}

export async function submitAuth() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit');

    if (!email || !password) { errorEl.textContent = 'Remplissez tous les champs'; return; }
    if (password.length < 6) { errorEl.textContent = 'Mot de passe : 6 caractères minimum'; return; }

    btn.disabled = true;
    btn.textContent = 'Chargement...';
    errorEl.textContent = '';

    try {
        let result;
        if (authMode === 'login') {
            result = await sb.auth.signInWithPassword({ email, password });
        } else {
            result = await sb.auth.signUp({ email, password });
        }

        if (result.error) throw result.error;

        if (authMode === 'register' && result.data.user && !result.data.session) {
            errorEl.textContent = '';
            errorEl.style.color = '#34d399';
            errorEl.textContent = '✓ Vérifiez votre email pour confirmer votre compte';
            btn.disabled = false;
            btn.textContent = 'Se connecter';
            authMode = 'login';
            return;
        }

        currentUser = result.data.user;
        onAuthSuccess();
    } catch (err) {
        const msg = err.message || 'Erreur inconnue';
        errorEl.style.color = '#ef4444';
        errorEl.textContent = msg.includes('Invalid login') ? 'Email ou mot de passe incorrect'
            : msg.includes('already registered') ? 'Cet email est déjà utilisé'
                : msg;
    }
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Se connecter' : 'Créer un compte';
}

async function onAuthSuccess() {
    hideAuthModal();
    updateAuthUI();
    await loadOrCreateExploitation();
    await loadExploitationParcelles();
    if (deps.renderExploitationOnMap) deps.renderExploitationOnMap();
    if (deps.updateDashboard) deps.updateDashboard();
}

export async function logout() {
    if (exploitationChannel) {
        exploitationChannel.unsubscribe();
        exploitationChannel = null;
    }
    await sb.auth.signOut();
    currentUser = null;
    currentExploitation = null;
    exploitationParcelles = [];
    updateAuthUI();
    if (deps.clearExploitationFromMap) deps.clearExploitationFromMap();
    if (document.getElementById('dashboard-panel').classList.contains('open')) {
        if (deps.toggleDashboard) deps.toggleDashboard();
    }
}

export function updateAuthUI() {
    const authBtn = document.getElementById('btn-auth');
    const authLabel = document.getElementById('auth-label');
    const dashBtn = document.getElementById('btn-dashboard');
    const selectBtn = document.getElementById('btn-select-mode');
    if (currentUser) {
        const name = (currentUser.email || '').split('@')[0];
        authLabel.textContent = name;
        authBtn.onclick = logout;
        authBtn.title = 'Cliquez pour vous déconnecter';
        authBtn.classList.add('active');
        dashBtn.style.display = '';
        selectBtn.style.display = '';
    } else {
        authLabel.textContent = 'Connexion';
        authBtn.onclick = showAuthModal;
        authBtn.title = 'Se connecter';
        authBtn.classList.remove('active');
        dashBtn.style.display = 'none';
        selectBtn.style.display = 'none';
    }
}

// ── Exploitation CRUD ──
async function loadOrCreateExploitation() {
    if (!currentUser) return;
    let { data, error } = await sb
        .from('exploitations')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle();

    if (error) console.error('[Exploitation] Load error:', error);

    if (!data) {
        const res = await sb.from('exploitations').insert({
            user_id: currentUser.id,
            name: 'Mon exploitation'
        }).select().single();
        if (res.error) {
            console.error('[Exploitation] Create error:', res.error);
            return;
        }
        data = res.data;
    }
    currentExploitation = data;
}

export async function renameExploitation(name) {
    if (!currentExploitation) return;
    await sb.from('exploitations')
        .update({ name })
        .eq('id', currentExploitation.id);
    currentExploitation.name = name;
}

let exploitationChannel = null;

async function loadExploitationParcelles() {
    if (!currentExploitation) return;
    const { data } = await sb
        .from('exploitation_parcelles')
        .select('*')
        .eq('exploitation_id', currentExploitation.id)
        .order('added_at', { ascending: false });
    exploitationParcelles = data || [];

    // Subscribe to realtime updates for ALL parcels in this exploitation
    subscribeToExploitationUpdates();
}

function subscribeToExploitationUpdates() {
    // Unsubscribe from previous channel if any
    if (exploitationChannel) {
        exploitationChannel.unsubscribe();
        exploitationChannel = null;
    }
    if (!currentExploitation) return;

    console.log('[Realtime] Subscribing to exploitation', currentExploitation.id);
    exploitationChannel = sb.channel(`exploitation-${currentExploitation.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'exploitation_parcelles',
            filter: `exploitation_id=eq.${currentExploitation.id}`
        }, payload => {
            console.log('[Realtime] Update received:', payload.new.parcel_id, payload.new.analysis_progress);
            const updated = payload.new;
            const parcelId = updated.parcel_id;

            // Update local state
            const p = exploitationParcelles.find(x => x.parcel_id === parcelId);
            if (p) {
                p.analysis_progress = updated.analysis_progress;
                p.analysis_status = updated.analysis_status;
                if (updated.ndvi_data) p.ndvi_data = updated.ndvi_data;
            }

            // Update satellite viewer
            if (deps.onNdviDataUpdated) {
                deps.onNdviDataUpdated(parcelId, updated.ndvi_data, updated.analysis_progress, updated.analysis_status);
            }

            // Update progress bar only (no full dashboard rebuild)
            if (deps.updateParcelProgress) {
                deps.updateParcelProgress(parcelId, updated.analysis_progress, updated.analysis_status);
            }
        })
        .subscribe();
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function addParcelToExploitation(parcelId, props, lngLat, feature) {
    if (!currentExploitation) {
        await loadOrCreateExploitation();
        if (!currentExploitation) {
            showToast('Erreur: impossible de créer l\'exploitation', '❌');
            return false;
        }
    }
    if (exploitationParcelles.length >= 200) {
        showToast('Limite de 200 parcelles atteinte', '⚠️');
        return false;
    }
    if (exploitationParcelles.some(p => p.parcel_id === parcelId)) {
        showToast('Parcelle déjà ajoutée ✓', 'ℹ️');
        return false;
    }

    try {
        const layerId = (feature && feature.layer) ? feature.layer.id : '';
        const region = layerId.startsWith('lyr-') ? layerId.slice(4).split('_')[0] : (document.getElementById('region-select') ? document.getElementById('region-select').value : '');

        const insertData = {
            exploitation_id: currentExploitation.id,
            parcel_id: parcelId,
            code_cultu: props.CODE_CULTU || null,
            code_group: props.CODE_GROUP || null,
            surf_parc: (props.SURF_PARC || props.surf_parc || props.surface_ref_m2 || (feature && turf.area(feature) / 10000)) ? parseFloat(props.SURF_PARC || props.surf_parc || props.surface_ref_m2 || (feature ? turf.area(feature) / 10000 : 0)) : null,
            centroid_lon: lngLat?.lng || null,
            centroid_lat: lngLat?.lat || null,
            region: region
        };

        const { data, error } = await sb.from('exploitation_parcelles')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            showToast(`Erreur: ${error.message}`, '❌');
            return false;
        }

        exploitationParcelles.push(data);
        if (deps.renderExploitationOnMap) deps.renderExploitationOnMap();
        if (deps.updateSelectCount) deps.updateSelectCount();

        if (document.getElementById('dashboard-panel').classList.contains('open')) {
            if (deps.updateDashboard) deps.updateDashboard();
        }

        const cropLabels = deps.cropLabels || {};
        showToast(`${cropLabels[props.CODE_CULTU] || props.CODE_CULTU || parcelId} ajoutée ✓`, '🏠');

        // Launch backend NDVI generation
        (async () => {
            try {
                const { data: { session } } = await sb.auth.getSession();
                const response = await fetch(`${API_URL}/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token: session?.access_token || null,
                        exploitation_id: currentExploitation.id,
                        parcel_id: parcelId,
                        feature: {
                            type: 'Feature',
                            geometry: feature.geometry,
                            properties: props
                        }
                    })
                });

                if (!response.ok) {
                    console.error('[Backend NDVI] API Error:', await response.text());
                }
            } catch (bgErr) {
                console.error('[Backend NDVI] Exception:', bgErr);
            }
        })();

        return true;
    } catch (err) {
        console.error('[Exploitation] Global Exception:', err);
        showToast('Erreur lors de l\'ajout', '❌');
        return false;
    }
}

export async function removeParcelFromExploitation(parcelId) {
    if (!currentExploitation) return;
    await sb.from('exploitation_parcelles')
        .delete()
        .eq('exploitation_id', currentExploitation.id)
        .eq('parcel_id', parcelId);
    exploitationParcelles = exploitationParcelles.filter(p => p.parcel_id !== parcelId);
    if (deps.renderExploitationOnMap) deps.renderExploitationOnMap();
    if (deps.updateDashboard) deps.updateDashboard();
    if (deps.updateSelectCount) deps.updateSelectCount();
}

export async function updateParcelName(parcelId, name) {
    if (!currentExploitation) return;
    const p = exploitationParcelles.find(x => x.parcel_id === parcelId);
    if (!p) return;
    const prevNotes = (p.notes || '').trim();
    if (prevNotes === (name || '').trim()) return;
    p.notes = name || null;
    const { error } = await sb.from('exploitation_parcelles')
        .update({ notes: name || null })
        .eq('exploitation_id', currentExploitation.id)
        .eq('parcel_id', parcelId);
    if (error) {
        p.notes = prevNotes || null;
        showToast('Erreur lors de l\'enregistrement du nom', '❌');
        return;
    }
    const cropLabels = deps.cropLabels || {};
    const listItem = document.querySelector(`.parcel-list-item[data-parcel-id="${parcelId}"] .pli-name`);
    if (listItem) {
        const cultureName = cropLabels[p.code_cultu] || p.code_cultu || '?';
        listItem.textContent = (name && name.trim()) ? name.trim() : cultureName;
    }
    showToast('Nom enregistré', '✅');
}

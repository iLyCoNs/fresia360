/** FRESIA360 visor compartido — js/viewer.js. Requiere pannellum.js antes. Opcional: window.FRESIA_VIEWER_CONFIG en el HTML. */

const FRESIA_CFG = Object.assign({
    vista: 'aereo',
    panorama: 'loteo360.jpg',
    datosJson: 'datos.json',
    autosaveKey: 'masterplan360_autosave',
    savePostMessageType: 'SAVE_MASTERPLAN_DATA',
    saveFile: 'datos.json',
    githubDatosFile: 'datos.json',
    githubShaStorageKey: 'masterplan_sha_datos',
    githubCommitMessage: '🛰️ Actualización vista aérea (Modo Arquitecto — index.html)',
    payloadIncludeVista: true,
    mergeRemoteSueloFields: true
}, window.FRESIA_VIEWER_CONFIG || {});
const PANORAMA_FILE = FRESIA_CFG.panorama;
(function primeAdminEditorMode() {
    if (!/[?&]admin=true(?:&|$)/.test(window.location.search)) return;
    document.documentElement.classList.add('is-admin-editor');
    if (window.self !== window.top) document.documentElement.classList.add('is-iframe');
    const apply = () => {
        document.body.classList.add('is-admin-editor');
        if (window.self !== window.top) document.body.classList.add('is-embedded');
    };
    if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();

function setupAdminPostMessageBridge() {
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        if (data.type === 'ADMIN_TOGGLE_DRAW') {
            if (isDevModePinsActive) togglePinsMode(false);
            toggleDrawMode(typeof data.active === 'boolean' ? data.active : true);
        }
        if (data.type === 'ADMIN_TOGGLE_PINS') {
            if (isDevModeDrawActive) toggleDrawMode(false);
            togglePinsMode(typeof data.active === 'boolean' ? data.active : true);
        }
    });
}
setupAdminPostMessageBridge();

let ConfigProyecto = { titulo: "PROYECTO INMOBILIARIO", subtitulo: "Masterplan Interactivo 360°" };
let OrigenDrone = null, NorteOffset = 0, BaseDatosLotes = [], PuntosHorizonte = [], allDrawnLines = [], UF_Online = 0;
const DOMCache = { paths: {}, markers: {}, viewport: { w: window.innerWidth, h: window.innerHeight, left: 0, top: 0 } }; 
let isHeatmapActive = false, isWebGLSupported = true, viewerGpuReady = true, smartInitAttempts = 0, panoramaEventsBound = false, pannellumIntroBootstrapped = false, svgFrameCounter = 0;
function isTouchDevice() { return (navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window); }
function isSvgRenderAllowed() { return (!isWebGLSupported) ? false : (isTouchDevice() ? viewerGpuReady && !!visor360 : true); }
function shouldUpdateSVGThisFrame() { return true; }

function flashScreenSuccess() {
    let flash = document.createElement('div');
    flash.style.position = 'fixed'; flash.style.top = '0'; flash.style.left = '0'; flash.style.width = '100%'; flash.style.height = '100%';
    flash.style.backgroundColor = 'rgba(16, 185, 129, 0.4)'; flash.style.zIndex = '999999999'; flash.style.pointerEvents = 'none'; flash.style.transition = 'opacity 0.5s ease-out';
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; }, 50); setTimeout(() => { flash.remove(); }, 550);
}

function flashScreenError() {
    let flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(239,68,68,0.3);z-index:999999999;pointer-events:none;transition:opacity 0.5s ease-out;';
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; }, 60); setTimeout(() => { flash.remove(); }, 580);
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-55%) scale(0.92);background:rgba(10,15,25,0.96);backdrop-filter:blur(20px);border:1px solid rgba(239,68,68,0.55);border-radius:18px;padding:18px 28px;color:#fff;font-size:12px;font-weight:700;text-align:center;z-index:9999999999;pointer-events:none;opacity:0;transition:opacity 0.25s,transform 0.25s;line-height:1.6;max-width:80vw;box-shadow:0 20px 50px rgba(0,0,0,0.7);';
    toast.innerHTML = '✂️ CORTE NO VÁLIDO<br><span style="font-size:10px;font-weight:500;color:#94a3b8;">La línea debe cruzar dos bordes opuestos de un polígono cerrado</span>';
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translate(-50%,-50%) scale(1)'; });
    setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translate(-50%,-55%) scale(0.92)'; setTimeout(() => toast.remove(), 280); }, 3000);
}

function mostrarToast(mensaje, isSuccess = true) {
    const toast = document.createElement('div');
    const border = isSuccess ? 'rgba(16,185,129,0.55)' : 'rgba(59,130,246,0.55)';
    toast.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-55%) scale(0.92);background:rgba(10,15,25,0.96);backdrop-filter:blur(20px);border:1px solid ${border};border-radius:18px;padding:18px 28px;color:#fff;font-size:12px;font-weight:700;text-align:center;z-index:9999999999;pointer-events:none;opacity:0;transition:opacity 0.25s,transform 0.25s;line-height:1.6;max-width:80vw;box-shadow:0 20px 50px rgba(0,0,0,0.7);`;
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translate(-50%,-50%) scale(1)'; });
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translate(-50%,-55%) scale(0.92)'; setTimeout(() => toast.remove(), 280); }, 3200);
}

const TouchPerfPhase1 = {
    overlayFrame: 0, panBindDone: false,
    init() {
        if (!isTouchDevice()) return;
        document.body.classList.add('is-touch-device');
        this.bindPanoramaDragClass();
    },
    bindPanoramaDragClass() {
        if (this.panBindDone) return;
        const container = document.getElementById('panorama-container');
        if (!container) return;
        this.panBindDone = true;
        const onStart = () => { document.body.classList.add('panorama-dragging'); };
        const onEnd = () => { document.body.classList.remove('panorama-dragging'); this.applyOverlayDecor(); };
        container.addEventListener('mousedown', onStart);
        container.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
    },
    shouldUpdateOverlayDecorThisFrame() { this.overlayFrame++; return (this.overlayFrame % 2) === 0; },
    applyOverlayDecor() {
        if (!visor360) return;
        const isMobile = DOMCache.viewport.w <= 768, currentHfov = visor360.getHfov();
        let newScale = (isMobile ? 0.30 : 0.45) * (DEFAULT_HFOV / currentHfov);
        newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
        document.querySelectorAll('.pin-scaler').forEach((s) => { s.style.transform = `scale(${newScale})`; });
        let zoomFactor = DEFAULT_HFOV / currentHfov, baseStroke = isMobile ? 1.2 : 2.0, dynStroke = baseStroke * zoomFactor;
        if (isMobile) { dynStroke = Math.max(0.8, Math.min(dynStroke, 3.0)); } else { dynStroke = Math.max(1.5, Math.min(dynStroke, 4.5)); }
        document.documentElement.style.setProperty('--stroke-dyn', dynStroke + 'px');
        document.documentElement.style.setProperty('--stroke-dyn-hover', (dynStroke + 1.2) + 'px');
    }
};

const SmartGpuProfile = {
    maxDPR: 1.25, maxTextureSize: 4096, _blobUrl: null, isHighEnd: false,
    init() { TouchPerfPhase1.init(); const caps = this.probeWebGL(); const ram = navigator.deviceMemory || 4; if (ram > 6 && caps.maxTextureSize >= 8192) { this.isHighEnd = true; this.maxTextureSize = caps.maxTextureSize; } else { this.isHighEnd = false; this.maxTextureSize = Math.min(caps.maxTextureSize || 4096, 4096); } },
    probeWebGL() { const attrs = { alpha: false, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: false }; try { const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8; const gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); if (!gl) return { ok: false, maxTextureSize: 2048 }; return { ok: true, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096 }; } catch (e) { return { ok: false, maxTextureSize: 2048 }; } },
    loadImage(url) { return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('Panorama load failed')); img.src = url + (url.includes('?') ? '&' : '?') + 'probe=' + Date.now(); }); },
    async preparePanorama(url, forceLite) { if (this.isHighEnd && !forceLite) return url; try { const img = await this.loadImage(url); const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height; const effective = Math.max(w / 2, h); const budget = forceLite ? 2048 : this.maxTextureSize; if (effective <= budget * 0.92) return url; const scale = (budget * 0.88) / effective; const canvas = document.createElement('canvas'); let newWidth = Math.floor(w * scale); if (newWidth % 2 !== 0) newWidth += 1; canvas.width = newWidth; canvas.height = newWidth / 2; const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return await new Promise((resolve) => { canvas.toBlob((blob) => { if (!blob) { resolve(url); return; } if (this._blobUrl) URL.revokeObjectURL(this._blobUrl); this._blobUrl = URL.createObjectURL(blob); resolve(this._blobUrl); }, 'image/jpeg', 0.88); }); } catch (e) { return url; } },
    patchRenderer(renderer) { if (!renderer || typeof renderer.resize !== 'function') return; setTimeout(() => { try { renderer.resize(); } catch(e) {} }, 150); },
    bindContextRecovery(canvas, onRestore) { if (!canvas) return; canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); viewerGpuReady = false; const sp = document.getElementById('splash-loading-text'); if (sp) sp.innerText = 'RECUPERANDO MOTOR GPU...'; }, false); canvas.addEventListener('webglcontextrestored', () => { if (onRestore) onRestore(); }, false); }
};

function detectWebGL() { try { const canvas = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))); } catch(e) { return false; } }
function hexToRgb(hex) { if(!hex) return '255, 255, 255'; var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255'; }
const _osrmRutaCache = new Map();
function parseCoordenadasDestino(str) {
    if (!str || !String(str).includes(',')) return null;
    const parts = String(str).replace(/\s/g, '').split(',');
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
}
function parseMetricaRuta(str, defaultUnit) {
    if (!str) return { v: '0', u: defaultUnit };
    const s = String(str).trim();
    const m = s.match(/^([\d.,]+)\s*(.*)$/i);
    if (!m) return { v: s, u: defaultUnit };
    const u = (m[2] || defaultUnit).toUpperCase() || defaultUnit;
    return { v: m[1], u };
}
function formatearDistanciaKm(km) { return (typeof km === 'number' ? km.toFixed(1) : String(km)) + ' KM'; }
function formatearTiempoMin(min) { return Math.round(Number(min) || 0) + ' MIN'; }
function getFactorTraficoChile(date) {
    date = date || new Date();
    const h = date.getHours(), day = date.getDay(), month = date.getMonth();
    let factor = 1.0, etiqueta = 'Flujo normal';
    const isWeekday = day >= 1 && day <= 5;
    if (isWeekday) {
        if ((h >= 7 && h < 9) || (h === 9 && date.getMinutes() < 30)) { factor = 1.38; etiqueta = 'Hora punta mañana'; }
        else if (h >= 17 && h < 20) { factor = 1.48; etiqueta = 'Hora punta tarde'; }
        else if (h >= 12 && h < 14) { factor = 1.12; etiqueta = 'Mediodía'; }
    } else if (day === 6 && h >= 10 && h < 14) { factor = 1.18; etiqueta = 'Sábado'; }
    else if (day === 0 && h >= 11 && h < 19) { factor = 1.14; etiqueta = 'Domingo'; }
    if (month >= 11 || month <= 1) { factor *= 1.1; etiqueta += ' · Temporada alta'; }
    if (h >= 22 || h < 6) { factor = Math.max(0.88, factor * 0.92); etiqueta = 'Madrugada/noche'; }
    return { factor, etiqueta };
}
function getTrafficByScenario(scenario, date) {
    if (!scenario || scenario === 'auto') return getFactorTraficoChile(date);
    const presets = {
        normal: { factor: 1.0, etiqueta: 'Flujo normal' },
        punta_am: { factor: 1.38, etiqueta: 'Hora punta mañana' },
        punta_pm: { factor: 1.48, etiqueta: 'Hora punta tarde' },
        sabado: { factor: 1.18, etiqueta: 'Sábado' },
        domingo: { factor: 1.14, etiqueta: 'Domingo' },
        libre: { factor: 0.88, etiqueta: 'Tráfico libre / madrugada' },
        temporada: { factor: 1.32, etiqueta: 'Temporada alta' }
    };
    return presets[scenario] || getFactorTraficoChile(date);
}
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function calcularRutaHeuristica(lat1, lon1, lat2, lon2, trafficScenario) {
    const distRecta = haversineKm(lat1, lon1, lat2, lon2);
    const winding = distRecta < 8 ? 1.42 : distRecta < 35 ? 1.48 : distRecta < 80 ? 1.55 : 1.62;
    const distRuta = distRecta * winding;
    let vel = distRuta < 3 ? 22 : distRuta < 10 ? 38 : distRuta < 30 ? 58 : distRuta < 70 ? 72 : 68;
    const traffic = getTrafficByScenario(trafficScenario);
    let min = (distRuta / vel) * 60 * traffic.factor;
    if (distRuta > 25) min += Math.floor(distRuta / 80) * 10;
    if (distRuta > 45) min = Math.max(min, distRuta * 1.05);
    if (distRuta > 90) min = Math.max(min, distRuta * 1.15);
    return { km: distRuta.toFixed(1), min: Math.round(min), factor: traffic.factor, etiqueta: traffic.etiqueta, source: 'heuristica' };
}
function calcularRutaEstimada(lat1, lon1, lat2, lon2) {
    const h = calcularRutaHeuristica(lat1, lon1, lat2, lon2);
    return { km: h.km, min: h.min };
}
async function fetchRutaOSRM(lat1, lon1, lat2, lon2, timeoutMs) {
    timeoutMs = timeoutMs || 9000;
    const key = lat1.toFixed(4) + ',' + lon1.toFixed(4) + '->' + lat2.toFixed(4) + ',' + lon2.toFixed(4);
    if (_osrmRutaCache.has(key)) return _osrmRutaCache.get(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lon1 + ',' + lat1 + ';' + lon2 + ',' + lat2 + '?overview=false';
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (data.code === 'Ok' && data.routes && data.routes[0]) {
            const route = data.routes[0];
            const out = { kmRaw: route.distance / 1000, minRaw: route.duration / 60, source: 'osrm' };
            _osrmRutaCache.set(key, out);
            return out;
        }
    } catch (e) {}
    finally { clearTimeout(timer); }
    return null;
}
async function calcularRutaCompleta(lat1, lon1, lat2, lon2, trafficScenario) {
    const traffic = getTrafficByScenario(trafficScenario);
    const osrm = await fetchRutaOSRM(lat1, lon1, lat2, lon2);
    if (osrm) {
        const km = osrm.kmRaw;
        let min = osrm.minRaw * traffic.factor;
        if (km > 20) min += Math.floor(km / 70) * 8;
        if (km > 50) min = Math.max(min, km * 0.92);
        if (km > 100) min = Math.max(min, km * 1.05);
        return { km: km.toFixed(1), min: Math.round(min), factor: traffic.factor, etiqueta: traffic.etiqueta, source: 'osrm' };
    }
    return calcularRutaHeuristica(lat1, lon1, lat2, lon2, trafficScenario);
}
function aplicarEstimacionRutaAPin(punto, est) {
    if (!punto || !est) return;
    punto.distancia = formatearDistanciaKm(est.km);
    punto.tiempo = formatearTiempoMin(est.min);
    punto.rutaFactorTrafico = est.factor;
    punto.rutaEtiquetaTrafico = est.etiqueta;
    punto.rutaFuente = est.source;
    punto.rutaCalculadaEn = Date.now();
}
async function calcularRutaParaPin(punto, opts) {
    opts = opts || {};
    if (!OrigenDrone?.lat || !OrigenDrone?.lng) return null;
    const dest = parseCoordenadasDestino(punto.coordenadasDestino);
    if (!dest) return null;
    const scenario = opts.scenario || punto.rutaEscenarioTrafico || 'auto';
    const est = await calcularRutaCompleta(OrigenDrone.lat, OrigenDrone.lng, dest.lat, dest.lng, scenario);
    if (est) {
        aplicarEstimacionRutaAPin(punto, est);
        punto.rutaEscenarioTrafico = scenario;
    }
    return est;
}
async function syncRutasDesdeOrigen(opts) {
    opts = opts || {};
    if (!OrigenDrone?.lat || !OrigenDrone?.lng || !PuntosHorizonte?.length) return false;
    let updated = false;
    for (const punto of PuntosHorizonte) {
        if (punto.tipo !== 'ruta' && punto.tipo !== 'horizonte') continue;
        const dest = parseCoordenadasDestino(punto.coordenadasDestino);
        if (!dest) continue;
        const vacio = !punto.distancia || /^0(\.0)?(\s*KM)?$/i.test(String(punto.distancia).trim()) || !punto.tiempo || /^0(\s*MIN)?$/i.test(String(punto.tiempo).trim());
        const recalc = punto.tipo === 'ruta' || opts.refreshAll || (opts.refreshEmptyHorizonte !== false && vacio);
        if (!recalc) continue;
        const est = await calcularRutaParaPin(punto);
        if (est) updated = true;
        await new Promise(r => setTimeout(r, 180));
    }
    if (updated) { refreshAllHotspots(); saveToLocal(); }
    return updated;
}

function applyProjectConfig() {
    document.getElementById('head-title-tag').innerText = `Masterplan 360 | ${ConfigProyecto.titulo || "PROYECTO INMOBILIARIO"}`;
    const splashTitle = document.getElementById('splash-title'); if(splashTitle) splashTitle.innerText = ConfigProyecto.titulo || "PROYECTO INMOBILIARIO";
    const uiTitle = document.getElementById('ui-main-title'); if(uiTitle) uiTitle.innerText = ConfigProyecto.titulo || "PROYECTO INMOBILIARIO";
    const uiSub = document.getElementById('ui-subtitle'); if(uiSub) uiSub.innerText = ConfigProyecto.subtitulo || "Masterplan Interactivo 360°";
    const root = document.documentElement;
    if(ConfigProyecto.colorDisp) root.style.setProperty('--c-disp', hexToRgb(ConfigProyecto.colorDisp)); if(ConfigProyecto.colorRes) root.style.setProperty('--c-res', hexToRgb(ConfigProyecto.colorRes)); if(ConfigProyecto.colorVend) root.style.setProperty('--c-vend', hexToRgb(ConfigProyecto.colorVend)); if(ConfigProyecto.colorNoDisp) root.style.setProperty('--c-nodisp', hexToRgb(ConfigProyecto.colorNoDisp));
    if(ConfigProyecto.opacidadDisp !== undefined) root.style.setProperty('--o-disp', ConfigProyecto.opacidadDisp / 100); if(ConfigProyecto.opacidadRes !== undefined) root.style.setProperty('--o-res', ConfigProyecto.opacidadRes / 100); if(ConfigProyecto.opacidadVend !== undefined) root.style.setProperty('--o-vend', ConfigProyecto.opacidadVend / 100); if(ConfigProyecto.opacidadNoDisp !== undefined) root.style.setProperty('--o-nodisp', ConfigProyecto.opacidadNoDisp / 100);
    const banner = document.getElementById('promo-banner-hud'); const urlParams = new URLSearchParams(window.location.search);
    if (banner && ConfigProyecto.bannerActivo && urlParams.get('admin') !== 'true') {
        const iconos = { 'descuento': '🔥', 'cyber': '💻', 'blackfriday': '⬛', 'verde': '🌱', 'ultimos': '🚨', 'lanzamiento': '🚀', 'bono': '🎁', 'personalizado': '✨' };
        document.getElementById('promo-icon').innerText = iconos[ConfigProyecto.bannerTipo] || '✨'; document.getElementById('promo-text').innerText = ConfigProyecto.bannerTexto || '¡Aprovecha nuestras ofertas!';
        let grad = 'linear-gradient(90deg, #10b981, #059669)'; if(ConfigProyecto.bannerTipo === 'descuento' || ConfigProyecto.bannerTipo === 'ultimos') grad = 'linear-gradient(90deg, #ef4444, #b91c1c)'; if(ConfigProyecto.bannerTipo === 'cyber' || ConfigProyecto.bannerTipo === 'blackfriday') grad = 'linear-gradient(90deg, #1e293b, #000000)'; if(ConfigProyecto.bannerTipo === 'bono') grad = 'linear-gradient(90deg, #3b82f6, #1d4ed8)';
        banner.style.background = grad; banner.style.display = 'block'; setTimeout(() => { banner.classList.add('show'); document.body.classList.add('has-banner'); }, 500);
    } else if (banner) { banner.classList.remove('show'); document.body.classList.remove('has-banner'); setTimeout(() => { banner.style.display = 'none'; }, 500); }
    const waBtn = document.querySelector('a.dock-btn.primary'); if(waBtn && ConfigProyecto.whatsapp) { waBtn.href = `https://wa.me/${ConfigProyecto.whatsapp.replace(/\D/g,'')}`; }
    initMasterplanPremiumFromData();
}

function saveToLocal() { localStorage.setItem(FRESIA_CFG.autosaveKey, JSON.stringify({ configProyecto: ConfigProyecto, origen: OrigenDrone, norte: NorteOffset, lotes: BaseDatosLotes, horizontes: PuntosHorizonte, trazos: allDrawnLines })); }
function loadFromLocal() { const savedData = localStorage.getItem(FRESIA_CFG.autosaveKey); if (savedData) { try { const parsed = JSON.parse(savedData); if((parsed.lotes && parsed.lotes.length > 0) || (parsed.trazos && parsed.trazos.length > 0)) { ConfigProyecto = parsed.configProyecto || ConfigProyecto; OrigenDrone = parsed.origen || OrigenDrone; NorteOffset = parsed.norte || 0; BaseDatosLotes = parsed.lotes || BaseDatosLotes; PuntosHorizonte = parsed.horizontes || PuntosHorizonte; allDrawnLines = parsed.trazos || allDrawnLines; } } catch(e) {} } }
async function fetchValorUFOnline() { try { const response = await fetch('https://mindicador.cl/api/uf', { cache: 'no-store' }); if (response.ok) { const data = await response.json(); if(data && data.serie && data.serie.length > 0) { UF_Online = data.serie[0].valor; return; } } } catch (error) {} }
async function fetchMasterData() { try { const response = await fetch(FRESIA_CFG.datosJson + '?v=' + new Date().getTime()); if(response.ok) { const data = await response.json(); ConfigProyecto = data.configProyecto || ConfigProyecto; OrigenDrone = data.origen || null; NorteOffset = data.norte || 0; BaseDatosLotes = data.lotes || []; PuntosHorizonte = data.horizontes || []; allDrawnLines = data.trazos || []; } else { loadFromLocal(); } } catch(e) { loadFromLocal(); } applyProjectConfig(); await syncRutasDesdeOrigen(); }

let visor360, currentPinSizeIndex = 1, isIntroAnimating = true, isDevModeDrawActive = false, isDevModePinsActive = false, isArquitecto2Active = false, arq2Tool = 'lote-libre', arq2LinePoints = [], arq2TempLineId = 'arq2_temp_' + Date.now(), arq2CosturaSnap = null, arq2CosturaStyle = 'punteada', arq2SelectedLineId = null, arq2FilaVariableContorno = null, arq2PendingFila = null, arq2InvasionActive = false, arq2SmoothCurves = true, arq2DemoActive = false, arq2DemoTimers = [], arq2DemoLoopInterval = null, arq2DemoPY = null, currentLineType = 'solida', currentLinePoints = [], currentPinTypeMap = 'disponible', currentTempLineId = 'temp_' + Date.now(), draggingVertex = null, draggingFranjaDiv = null, draggingCalleMove = null, pickedPin = null, snapCursor = null, ghostPin = null, snappedCoords = null, activePinArgs = null, isCreatingNewPin = false, isSnapToClose = false, franjaCornerA = null, franjaPreviewQuad = null, franjaPreviewDivs = [], franjaCurvaPreviewStrip = null, franjaDraftCount = 10, franjaDraftBaseM2 = 5000, franjaPendingCreate = null, guardarNubeEnCurso = false, draftCalleAncho = 8, draftCalleAlpha = 0, draftCalleLabelScale = 1, draftCalleShowLabel = true, draftCalleSnapFranja = false, calleSnapIsFranjaEdge = false, lastCalleTap = null, isLineaPinesActive = false, lineaPinesPoints = [], lineaPinesTempId = 'linea_pins_' + Date.now(), franjaCurvaFrente = [], franjaCurvaFase = 0;
function revealLoteoOverlay() {
    isIntroAnimating = false;
    document.body.classList.add('loteo-overlay-ready');
    syncFranjaVisualsOnReady();
    const svg = document.getElementById('loteo-svg');
    if (svg && isSvgRenderAllowed()) svg.style.opacity = '1';
    if (!visor360) return;
    refreshAllHotspots(true);
    syncSVGElements();
    updateSVGPaths();
    const renderer = visor360.getRenderer && visor360.getRenderer();
    if (renderer) hookRendererOverlay(renderer);
}
const DEFAULT_HFOV = 125, MAX_SCALE = 1.0, MIN_SCALE = 0.20, SNAP_DISTANCE = 8.0;
let lastDevDrawClickMs = 0, lastArq2DrawClickMs = 0, closeOriginHighlighted = false, arq2CalleCurvaAncho = 8, draftCalleCurvaAlpha = 0.55, arq2SmoothIntensity = 5, arq2CalleRetorno = false, arq2Guideline = null;

function getCloseSnapScreenRadiusPx() {
    const hfov = visor360?.getHfov?.() || DEFAULT_HFOV;
    return Math.max(6, Math.min(16, 10 / (100 / hfov)));
}
function getCloseSnapPanoramaThreshold() {
    const hfov = visor360?.getHfov?.() || DEFAULT_HFOV;
    return Math.max(1.0, SNAP_DISTANCE * 0.22 * (hfov / DEFAULT_HFOV));
}
function canTriggerPolygonAutoClose() {
    const last = isArquitecto2Active ? lastArq2DrawClickMs : lastDevDrawClickMs;
    return Date.now() - last >= 300;
}
function isNearPolygonOriginPY(p, y, originPt) {
    if (!originPt) return false;
    const proj = getPanoramaScreenProjector();
    if (proj && visor360) {
        const s0 = proj.toScreen(originPt[0], originPt[1]);
        const s1 = proj.toScreen(p, y);
        if (s0 && s1) {
            const dScreen = Math.hypot(s0[0] - s1[0], s0[1] - s1[1]);
            if (dScreen < getCloseSnapScreenRadiusPx()) return true;
        }
    }
    return Math.hypot(p - originPt[0], y - originPt[1]) < getCloseSnapPanoramaThreshold();
}
function arq2_isValidPYPoint(pt) {
    return Array.isArray(pt) && pt.length >= 2 && isFinite(pt[0]) && isFinite(pt[1]) && !isNaN(pt[0]) && !isNaN(pt[1]);
}
function arq2_sanitizePolylinePoints(pts) {
    if (!pts?.length) return [];
    const out = [];
    pts.forEach(pt => {
        if (!arq2_isValidPYPoint(pt)) return;
        if (out.length && Math.hypot(pt[0] - out[out.length - 1][0], pt[1] - out[out.length - 1][1]) < 1e-6) return;
        out.push([parseFloat(pt[0]), parseFloat(pt[1])]);
    });
    return out;
}
function arq2_restoreAnchoredVertices(smoothed, anchors, tol = 0.08) {
    if (!anchors?.length || !smoothed?.length) return smoothed;
    return smoothed.map(pt => {
        let best = null, bestD = tol;
        anchors.forEach(a => {
            const d = Math.hypot(pt[0] - a[0], pt[1] - a[1]);
            if (d < bestD) { bestD = d; best = a; }
        });
        return best ? [parseFloat(best[0].toFixed(4)), parseFloat(best[1].toFixed(4))] : pt;
    });
}
function arq2_mergeSharedBoundaryVertices(lineId) {
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line?.puntos || !line.sharedSegs?.length) return;
    line.sharedSegs.forEach(segIdx => {
        const meta = line.sharedSegMeta?.[segIdx];
        if (!meta?.lineId) return;
        const other = allDrawnLines.find(l => l.id === meta.lineId);
        if (!other?.puntos) return;
        const n = line.puntos.length, on = other.puntos.length;
        const i1 = segIdx, i2 = (segIdx + 1) % n;
        const j1 = meta.segIdx, j2 = (meta.segIdx + 1) % on;
        const mid1 = [(line.puntos[i1][0] + other.puntos[j1][0]) / 2, (line.puntos[i1][1] + other.puntos[j1][1]) / 2];
        const mid2 = [(line.puntos[i2][0] + other.puntos[j2][0]) / 2, (line.puntos[i2][1] + other.puntos[j2][1]) / 2];
        line.puntos[i1] = [parseFloat(mid1[0].toFixed(4)), parseFloat(mid1[1].toFixed(4))];
        line.puntos[i2] = [parseFloat(mid2[0].toFixed(4)), parseFloat(mid2[1].toFixed(4))];
        other.puntos[j1] = [...line.puntos[i1]];
        other.puntos[j2] = [...line.puntos[i2]];
    });
}
function arq2_applyCosturaStrokeAttrs(pathEl, style) {
    if (!pathEl) return;
    const isPunteada = style !== 'solida';
    pathEl.setAttribute('stroke-dasharray', isPunteada ? '6,6' : 'none');
    pathEl.setAttribute('data-shared-edge', 'true');
    pathEl.setAttribute('data-costura-style', isPunteada ? 'punteada' : 'solida');
}
function arq2_getCosturaEstilo(lineData) {
    return lineData?.costuraEstilo || lineData?.costuraStyle || arq2CosturaStyle || 'punteada';
}
function arq2_applyCosturaEstiloToPath(pathEl, estilo) {
    if (!pathEl) return;
    const isPunteada = estilo !== 'solida';
    pathEl.setAttribute('data-costura-style', isPunteada ? 'punteada' : 'solida');
    pathEl.setAttribute('stroke-dasharray', isPunteada ? '6,6' : 'none');
    pathEl.style.setProperty('stroke-dasharray', isPunteada ? '6,6' : 'none', 'important');
    pathEl.style.setProperty('stroke', 'rgba(255,255,255,0.92)', 'important');
    pathEl.style.setProperty('stroke-width', '2px', 'important');
}
function arq2_resolveSharedSegStyle(lineData, segIdx) {
    if (!lineData?.sharedSegs?.includes(segIdx)) return null;
    const meta = lineData.sharedSegMeta?.[segIdx];
    const other = meta ? allDrawnLines.find(l => l.id === meta.lineId) : null;
    if (other && (other.tipo === 'calle-curva-arq2' || other.tipo === 'calle-curva-arq2-preview' || other.tipo === 'calle')) {
        return 'solida';
    }
    const segStyle = lineData.sharedSegStyles?.[segIdx];
    if (segStyle === 'punteada' || segStyle === 'solida') return segStyle;
    return arq2_getCosturaEstilo(lineData);
}
function arq2_syncCosturaStylesFromLineEstilo(lineId) {
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line?.sharedSegs?.length) return;
    const estilo = arq2_getCosturaEstilo(line);
    line.costuraEstilo = estilo;
    line.costuraStyle = estilo;
    line.sharedSegs.forEach(i => {
        const meta = line.sharedSegMeta?.[i];
        const other = meta ? allDrawnLines.find(l => l.id === meta.lineId) : null;
        if (other && (other.tipo === 'calle-curva-arq2' || other.tipo === 'calle-curva-arq2-preview' || other.tipo === 'calle')) {
            line.sharedSegStyles[i] = 'solida';
        } else {
            line.sharedSegStyles[i] = estilo;
        }
    });
}
function arq2_buildSharedEdgePaths(pts, sharedSegs, sharedStyles, isClosed, getCamFn, cx, cySc, f, costuraDefault) {
    let dPunteada = '', dSolida = '';
    const defaultStyle = costuraDefault || 'punteada';
    const segN = isClosed ? pts.length : pts.length - 1;
    for (let i = 0; i < segN; i++) {
        if (!sharedSegs || !sharedSegs.includes(i)) continue;
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        const c1 = getCamFn(p1[0], p1[1]), c2 = getCamFn(p2[0], p2[1]);
        if (c1.z <= 0.0001 && c2.z <= 0.0001) continue;
        let s1, s2;
        if (c1.z > 0.0001) s1 = { x: cx + (c1.x / c1.z) * f, y: cySc - (c1.y / c1.z) * f };
        else { const t = c1.z / (c1.z - c2.z); s1 = { x: cx + ((c1.x + t * (c2.x - c1.x)) / 0.0001) * f, y: cySc - ((c1.y + t * (c2.y - c1.y)) / 0.0001) * f }; }
        if (c2.z > 0.0001) s2 = { x: cx + (c2.x / c2.z) * f, y: cySc - (c2.y / c2.z) * f };
        else { const t = c2.z / (c2.z - c1.z); s2 = { x: cx + ((c2.x + t * (c1.x - c2.x)) / 0.0001) * f, y: cySc - ((c2.y + t * (c1.y - c2.y)) / 0.0001) * f }; }
        let segStr;
        if (s1.x < s2.x || (s1.x === s2.x && s1.y < s2.y)) {
            segStr = `M ${s1.x},${s1.y} L ${s2.x},${s2.y} `;
        } else {
            segStr = `M ${s2.x},${s2.y} L ${s1.x},${s1.y} `;
        }
        const style = (sharedStyles && sharedStyles[i]) || defaultStyle;
        if (style === 'solida') dSolida += segStr;
        else dPunteada += segStr;
    }
    return { dPunteada, dSolida };
}
function arq2_ensureOrganicPathLayers(gNode, lineData) {
    if (!gNode) return null;
    const roleSpec = [
        { role: 'fill', cls: 'linea-organico-fill', apply: 'fill' },
        { role: 'perimeter', cls: 'linea-organico-perimetro', apply: 'perimeter' },
        { role: 'shared-punteada', cls: 'linea-punteada-costura', apply: 'dash' },
        { role: 'shared-solida', cls: 'linea-solida-costura', apply: 'shared-solid' }
    ];
    const byRole = {};
    Array.from(gNode.querySelectorAll('path')).forEach(p => {
        const role = p.dataset.edgeRole;
        if (role) byRole[role] = p;
    });
    roleSpec.forEach(spec => {
        if (!byRole[spec.role]) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.dataset.edgeRole = spec.role;
            p.setAttribute('class', spec.cls);
            byRole[spec.role] = p;
            gNode.appendChild(p);
        }
    });
    const ordered = roleSpec.map(spec => {
        const p = byRole[spec.role];
        p.setAttribute('class', spec.cls);
        if (spec.apply === 'dash') arq2_applyCosturaEstiloToPath(p, 'punteada');
        else if (spec.apply === 'shared-solid') arq2_applyCosturaEstiloToPath(p, 'solida');
        else arq2_applyOrganicPathAttrs(p, spec.apply);
        return p;
    });
    ordered.forEach(p => gNode.appendChild(p));
    if (lineData?.id && DOMCache.paths[lineData.id]) DOMCache.paths[lineData.id].base = ordered;
    return ordered;
}
function arq2_syncOrganicLotePaths(lineData, cacheObj, getCamFn, cx, cySc, f) {
    if (!lineData?.puntos?.length || !cacheObj) return;
    if (cacheObj.gNode) {
        const ordered = arq2_ensureOrganicPathLayers(cacheObj.gNode, lineData);
        if (ordered) cacheObj.base = ordered;
    }
    if (!cacheObj.base || cacheObj.base.length < 4) return;
    const paths = cacheObj.base;
    const costuraDefault = arq2_getCosturaEstilo(lineData);
    const shared = arq2_buildSharedEdgePaths(lineData.puntos, lineData.sharedSegs, lineData.sharedSegStyles, true, getCamFn, cx, cySc, f, costuraDefault);
    const dFill = arq2_projectPolylineD(lineData.puntos, true, getCamFn, cx, cySc, f);
    const dPerimeter = arq2_buildNonSharedEdgePaths(lineData.puntos, lineData.sharedSegs, true, getCamFn, cx, cySc, f);
    paths[0].setAttribute('d', dFill.trim() || 'M -999 -999');
    arq2_applyOrganicPathAttrs(paths[0], 'fill');
    paths[1].setAttribute('d', dPerimeter.trim() || 'M -999 -999');
    arq2_applyOrganicPathAttrs(paths[1], 'perimeter');
    paths[2].setAttribute('d', shared.dPunteada.trim() || 'M -999 -999');
    arq2_applyCosturaEstiloToPath(paths[2], 'punteada');
    paths[3].setAttribute('d', shared.dSolida.trim() || 'M -999 -999');
    arq2_applyCosturaEstiloToPath(paths[3], 'solida');
}
function updateCloseOriginHighlight(active) {
    closeOriginHighlighted = !!active;
    document.querySelectorAll('.vertex-marker.origin-vertex, .vertex-marker.origin-vertex-ready').forEach(el => {
        el.classList.toggle('origin-vertex-ready', closeOriginHighlighted);
    });
}

function intersectSegments(p0, p1, p2, p3) {
    let s1_x = p1[0] - p0[0], s1_y = p1[1] - p0[1]; let s2_x = p3[0] - p2[0], s2_y = p3[1] - p2[1];
    let denom = -s2_x * s1_y + s1_x * s2_y; if (Math.abs(denom) < 0.000001) return null;
    let s = (-s1_y * (p0[0] - p2[0]) + s1_x * (p0[1] - p2[1])) / denom;
    let t = ( s2_x * (p0[1] - p2[1]) - s2_y * (p0[0] - p2[0])) / denom;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) return [p0[0] + (t * s1_x), p0[1] + (t * s1_y)];
    return null;
}

function attemptSplit(lineStart, lineEnd) {
    let dx = lineEnd[0] - lineStart[0]; let dy = lineEnd[1] - lineStart[1];
    let len = Math.sqrt(dx*dx + dy*dy); if (len < 0.0001) return false;
    let nx = dx / len; let ny = dy / len;
    let extP0 = [lineStart[0] - nx * 1000, lineStart[1] - ny * 1000];
    let extP1 = [lineEnd[0] + nx * 1000, lineEnd[1] + ny * 1000];
    let newLines = []; let didSplit = false;
    
    for (let idx = 0; idx < allDrawnLines.length; idx++) {
        let l = allDrawnLines[idx];
        if (l.tipo === 'calle' || l.tipo === 'divisoria' || l.puntos.length < 3) { newLines.push(l); continue; }
        let pts = l.puntos; let intersections = [];
        for (let i = 0; i < pts.length; i++) {
            let p1 = pts[i]; let p2 = pts[(i + 1) % pts.length];
            if(Math.abs(p1[0]-p2[0]) < 0.0001 && Math.abs(p1[1]-p2[1]) < 0.0001) continue;
            let ix = intersectSegments(extP0, extP1, p1, p2);
            if (ix) {
                // Tolerancia 0.05° captura intersecciones casi-duplicadas en vértices compartidos
                let isDup = intersections.some(u => Math.abs(u.point[0]-ix[0]) < 0.05 && Math.abs(u.point[1]-ix[1]) < 0.05);
                if (!isDup) intersections.push({ point: ix, edgeIndex: i });
            }
        }
        
        if (intersections.length >= 2) {
            intersections.sort((a,b) => { let d1 = Math.pow(a.point[0]-extP0[0],2) + Math.pow(a.point[1]-extP0[1],2); let d2 = Math.pow(b.point[0]-extP0[0],2) + Math.pow(b.point[1]-extP0[1],2); return d1-d2; });
            let i1 = intersections[0]; let i2 = intersections[intersections.length-1];
            if (i1.edgeIndex > i2.edgeIndex) { let temp = i1; i1 = i2; i2 = temp; }
            // Imposible subdividir si ambas intersecciones están en el mismo borde
            if (i1.edgeIndex === i2.edgeIndex) { newLines.push(l); continue; }
            
            let polyA = []; for(let k=0; k<=i1.edgeIndex; k++) polyA.push(pts[k]); polyA.push(i1.point); polyA.push(i2.point); for(let k=i2.edgeIndex+1; k<pts.length; k++) polyA.push(pts[k]);
            let polyB = []; polyB.push(i1.point); for(let k=i1.edgeIndex+1; k<=i2.edgeIndex; k++) polyB.push(pts[k]); polyB.push(i2.point);
            // Validar que ambos sub-polígonos tienen al menos 3 vértices
            if (polyA.length < 3 || polyB.length < 3) { newLines.push(l); continue; }
            
            newLines.push({ id: 'lote_' + Date.now() + '_A_' + idx, tipo: l.tipo, puntos: polyA });
            newLines.push({ id: 'lote_' + Date.now() + '_B_' + idx, tipo: l.tipo, puntos: polyB });
            didSplit = true;
        } else { newLines.push(l); }
    }
    if (didSplit) {
        allDrawnLines = newLines;
        newLines.forEach(line => {
            if (line.id.startsWith('lote_') && (line.id.includes('_A_') || line.id.includes('_B_'))) {
                arq2_registerSharedEdges(line.id);
            }
        });
        flashScreenSuccess();
        return true;
    }
    return false;
}

function getMockEvent(e) { let cx = e.clientX, cy = e.clientY; if(cx === undefined && e.changedTouches && e.changedTouches.length > 0) { cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY; } return { clientX: cx, clientY: cy }; }

function isAutoMacroLotePoly(line) {
    if (!line || !line.puntos || line.puntos.length < 3) return false;
    const skip = new Set(['calle','cortar','divisoria','borde-macro','arista_solida','arista_punteada','neon','franja-preview','franja-preview-div','franja-grupo']);
    return !skip.has(line.tipo);
}
function isMacroEdgeType(tipo) { return tipo === 'divisoria' || tipo === 'borde-macro' || tipo === 'arista_solida' || tipo === 'arista_punteada'; }
function lerpPY(a, b, t) { return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]; }
function polyCentroid(pts) {
    if (!pts || !pts.length) return null;
    let p = 0, y = 0;
    pts.forEach(t => { p += t[0]; y += t[1]; });
    return [p / pts.length, y / pts.length];
}
function projectionT(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return 0;
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
}
function projectPointOnSegment(p, a, b) {
    const t = Math.max(0, Math.min(1, projectionT(p, a, b)));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function intersectSegments2D(a1, a2, b1, b2) {
    const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
    const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-14) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    return null;
}
function lineIntersectsPolygon(lineA, lineB, poly) {
    if (!poly || poly.length < 3) return false;
    for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        if (intersectSegments2D(lineA, lineB, poly[i], poly[j])) return true;
    }
    const c = polyCentroid(poly);
    if (!c) return false;
    const proj = projectPointOnSegment(c, lineA, lineB);
    return Math.hypot(c[0] - proj[0], c[1] - proj[1]) < 1.5;
}
function lineNearFranjaLot(lineA, lineB, lot) {
    if (lineIntersectsPolygon(lineA, lineB, lot.puntos)) return true;
    const c = polyCentroid(lot.puntos);
    if (!c) return false;
    const proj = projectPointOnSegment(c, lineA, lineB);
    const perp = Math.hypot(c[0] - proj[0], c[1] - proj[1]);
    const t = projectionT(c, lineA, lineB);
    return perp < 14 && t >= -0.08 && t <= 1.08;
}
function getFranjaLotPinPosition(lot, lineA, lineB) {
    const pts = lot.puntos;
    if (pts.length >= 4) {
        const topMid = lerpPY(pts[0], pts[1], 0.5);
        const botMid = lerpPY(pts[3], pts[2], 0.5);
        const hit = intersectSegments2D(topMid, botMid, lineA, lineB);
        if (hit) return hit;
    }
    const c = polyCentroid(pts);
    if (!c) return lineA;
    const onLine = projectPointOnSegment(c, lineA, lineB);
    return onLine;
}
function findPinForFranjaNumero(numero) {
    const n = parseInt(numero, 10);
    return BaseDatosLotes.find(p => p.tipo === 'lote' && (
        p.numero === numero || p.numero === String(n) ||
        (p.titulo && String(p.titulo).trim() === String(numero).trim()) ||
        (p.titulo && parseInt(String(p.titulo).replace(/\D/g, ''), 10) === n)
    ));
}
function syncLineaPinesPanelUI() {
    const status = document.getElementById('linea-pines-status');
    const n = lineaPinesPoints.length;
    const ready = n >= 2;
    if (status) {
        status.classList.toggle('is-ready', ready);
        status.textContent = ready
            ? `${n} puntos — pulsa Enter para alinear ${n >= 2 ? 'los pines' : ''}`
            : (n === 1 ? '1 punto — coloca el final de la línea guía' : 'Clic en el mapa: punto inicial y final de la fila');
    }
}
function deactivateLineaPines() {
    isLineaPinesActive = false;
    lineaPinesPoints = [];
    lineaPinesTempId = 'linea_pins_' + Date.now();
    window.lastMouseX = undefined;
    window.lastMouseY = undefined;
    document.getElementById('btn-linea-pines')?.classList.remove('active');
    document.body.classList.remove('linea-pines-active');
    document.getElementById('linea-pines-panel')?.classList.remove('open');
    syncLineaPinesPanelUI();
}
function activateLineaPines() {
    isLineaPinesActive = true;
    lineaPinesPoints = [];
    lineaPinesTempId = 'linea_pins_' + Date.now();
    document.getElementById('btn-linea-pines')?.classList.add('active');
    document.body.classList.add('linea-pines-active');
    document.getElementById('linea-pines-panel')?.classList.add('open');
    document.querySelectorAll('#dev-toolbar-pins .dev-btn[data-pintype]').forEach(b => b.classList.remove('active'));
    syncLineaPinesPanelUI();
    refreshAllHotspots(true);
}
function clearLineaPinesDraft() {
    lineaPinesPoints = [];
    lineaPinesTempId = 'linea_pins_' + Date.now();
    window.lastMouseX = undefined;
    window.lastMouseY = undefined;
    syncLineaPinesPanelUI();
    refreshAllHotspots(true);
}
function handleLineaPinesClick(mock) {
    const coords = visor360.mouseEventToCoords(mock);
    if (!coords || isNaN(coords[0])) return;
    lineaPinesPoints.push([coords[0], coords[1]]);
    syncLineaPinesPanelUI();
    syncSVGElements();
    updateSVGPaths();
    refreshAllHotspots(true);
}
function applyLineaPinesAlign() {
    if (lineaPinesPoints.length < 2) {
        alert('⚠️ Coloca al menos 2 puntos para definir la línea de alineación.');
        return false;
    }
    migrateFranjaGroupsFromData();
    const lots = allDrawnLines.filter(l => l.tipo === 'area-invisible' && l.franjaGrupo && l.franjaNumero && l.puntos.length >= 3);
    if (!lots.length) {
        alert('⚠️ No hay lotes de franja.\n\nCrea una franja con 🏘️ Franja Lotes (Modo Arquitecto) primero.');
        return false;
    }

    const defaultStatus = ['disponible', 'reservado', 'vendido', 'no_disponible'].includes(currentPinTypeMap) ? currentPinTypeMap : 'disponible';
    let updated = 0, created = 0;

    lots.forEach(lot => {
        let pinPt = null;
        // Calculamos el centro vertical exacto del lote actual
        const topMid = lerpPY(lot.puntos[0], lot.puntos[1], 0.5);
        const botMid = lerpPY(lot.puntos[3], lot.puntos[2], 0.5);

        // Disparamos un rayo láser para ver dónde cruza el trazo del usuario
        for (let i = 0; i < lineaPinesPoints.length - 1; i++) {
            const hit = intersectSegments2D(topMid, botMid, lineaPinesPoints[i], lineaPinesPoints[i+1]);
            if (hit) { pinPt = hit; break; }
        }

        // Si la línea no cruzó de arriba a abajo, buscamos el punto más cercano al centroide
        if (!pinPt) {
            const c = polyCentroid(lot.puntos);
            if (c) {
                let minDist = Infinity;
                for (let i = 0; i < lineaPinesPoints.length - 1; i++) {
                    const proj = projectPointOnSegment(c, lineaPinesPoints[i], lineaPinesPoints[i+1]);
                    const d = Math.hypot(c[0]-proj[0], c[1]-proj[1]);
                    if (d < minDist && d < 10) { minDist = d; pinPt = proj; }
                }
            }
        }

        if (pinPt) {
            const numero = lot.franjaNumero;
            const pitch = parseFloat(pinPt[0].toFixed(3));
            const yaw = parseFloat(pinPt[1].toFixed(3));
            let pin = findPinForFranjaNumero(numero);
            if (pin) { 
                pin.pitch = pitch; pin.yaw = yaw; updated++; 
            } else {
                BaseDatosLotes.push({ id: 'lp_' + lot.franjaGrupo + '_' + (lot.franjaIdx ?? 0) + '_' + Date.now(), tipo: 'lote', titulo: numero, numero: numero, status: defaultStatus, pitch, yaw });
                created++;
            }
        }
    });

    if (updated === 0 && created === 0) { 
        alert('⚠️ La línea no cruzó ningún lote de franja.\n\nAjusta el trazo para que atraviese la hilera de lotes.'); 
        return false; 
    }
    
    clearLineaPinesDraft();
    saveToLocal();
    refreshAllHotspots();
    flashScreenSuccess();
    return true;
}
function getPanoramaScreenProjector() {
    if (!visor360) return null;
    const ctnr = document.getElementById('panorama-container');
    const W = DOMCache.viewport.w || ctnr?.clientWidth || 0;
    const H = DOMCache.viewport.h || ctnr?.clientHeight || 0;
    const camP = visor360.getPitch() * Math.PI / 180, camYw = visor360.getYaw() * Math.PI / 180, hfov = visor360.getHfov();
    const scp = Math.sin(camP), ccp = Math.cos(camP), fc = 0.5 * W / Math.tan(hfov * Math.PI / 360), cxW = W / 2, cyH = H / 2;
    return {
        toScreen(pitch, yaw) {
            const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180, sp = Math.sin(p), cp2 = Math.cos(p);
            let yd = y - camYw; while (yd > Math.PI) yd -= 2 * Math.PI; while (yd < -Math.PI) yd += 2 * Math.PI;
            const sy = Math.sin(yd), cy2 = Math.cos(yd), z = sp * scp + cp2 * cy2 * ccp;
            return z > 0.0001 ? [cxW + (cp2 * sy / z) * fc, cyH - ((sp * ccp - cp2 * cy2 * scp) / z) * fc] : null;
        },
        toPY(sx, sy) {
            return screenPointToPanorama(DOMCache.viewport.left + sx, DOMCache.viewport.top + sy);
        },
        lerpSc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    };
}
function buildFranjaPointsFromCorners(TL, TR, BR, BL, N, splits) {
    const ts = splits && splits.length === N + 1 ? splits : Array.from({ length: N + 1 }, (_, i) => i / N);
    const proj = getPanoramaScreenProjector();
    const topPts = [], botPts = [];
    if (proj) {
        const tlSc = proj.toScreen(TL[0], TL[1]), trSc = proj.toScreen(TR[0], TR[1]);
        const brSc = proj.toScreen(BR[0], BR[1]), blSc = proj.toScreen(BL[0], BL[1]);
        if (tlSc && trSc && brSc && blSc) {
            for (let i = 0; i <= N; i++) {
                const t = ts[i];
                const tp = proj.toPY(...proj.lerpSc(tlSc, trSc, t)), bp = proj.toPY(...proj.lerpSc(blSc, brSc, t));
                if (!tp || !bp) break;
                topPts.push(tp); botPts.push(bp);
            }
            if (topPts.length === N + 1) return { topPts, botPts };
            topPts.length = 0; botPts.length = 0;
        }
    }
    for (let i = 0; i <= N; i++) {
        const t = ts[i];
        topPts.push(lerpPY(TL, TR, t)); botPts.push(lerpPY(BL, BR, t));
    }
    return { topPts, botPts };
}
function syncMacroActiveClass() {
    document.body.classList.toggle('auto-macro-active',
        allDrawnLines.some(l => isMacroEdgeType(l.tipo) || l.tipo === 'area-invisible' || l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo'));
}
function syncFranjaVisualsOnReady() {
    migrateFranjaGroupsFromData();
    allDrawnLines.filter(l => l.tipo === 'franja-grupo').forEach(g => rebuildFranjaGroup(g.id));
    allDrawnLines.filter(l => l.tipo === 'franja-curva-grupo').forEach(g => rebuildFranjaCurvaGroup(g.id));
    ensureFranjaIntegrity();
    syncMacroActiveClass();
}
function ensureFranjaSplits(grp) {
    const N = grp.franjaCount || 2;
    if (!grp.franjaSplits || grp.franjaSplits.length !== N + 1) {
        grp.franjaSplits = Array.from({ length: N + 1 }, (_, i) => i / N);
    }
    return grp.franjaSplits;
}
function weightsToFranjaSplits(weights) {
    const w = weights.map(v => Math.max(0.001, parseFloat(String(v).replace(',', '.')) || 1));
    const total = w.reduce((a, b) => a + b, 0);
    const splits = [0];
    let acc = 0;
    for (let i = 0; i < w.length - 1; i++) {
        acc += w[i];
        splits.push(acc / total);
    }
    splits.push(1);
    return splits;
}
function getFranjaSplitTs(N, customSplits) {
    if (customSplits && customSplits.length === N + 1) return customSplits;
    return Array.from({ length: N + 1 }, (_, i) => i / N);
}
function inferFranjaSplitsFromLotes(corners, sortedLotes) {
    const N = sortedLotes.length;
    const [TL, TR] = corners;
    const splits = [0];
    const proj = getPanoramaScreenProjector();
    let tlSc = null, trSc = null, len2 = 0, dx = 0, dy = 0;
    if (proj) {
        tlSc = proj.toScreen(TL[0], TL[1]); trSc = proj.toScreen(TR[0], TR[1]);
        if (tlSc && trSc) { dx = trSc[0] - tlSc[0]; dy = trSc[1] - tlSc[1]; len2 = dx * dx + dy * dy; }
    }
    for (let i = 1; i < N; i++) {
        const lot = sortedLotes[i];
        const sep = lot.puntos && lot.puntos[0];
        let t = i / N;
        if (tlSc && trSc && len2 > 1 && sep) {
            const sc = proj.toScreen(sep[0], sep[1]);
            if (sc) t = Math.max(0.01, Math.min(0.99, ((sc[0] - tlSc[0]) * dx + (sc[1] - tlSc[1]) * dy) / len2));
        }
        splits.push(t);
    }
    splits.push(1);
    for (let i = 1; i < splits.length - 1; i++) splits[i] = Math.max(splits[i - 1] + 0.02, splits[i]);
    splits[splits.length - 1] = 1; splits[0] = 0;
    return splits;
}
function promoteMacroEdgesToFranja(edges) {
    if (!edges || edges.length < 3) return false;
    const divisoria = edges.filter(e => e.tipo === 'divisoria');
    const borde = edges.filter(e => e.tipo === 'borde-macro');
    const pool = borde.length >= 3 ? borde : edges;
    const allPts = [];
    pool.forEach(e => e.puntos.forEach(p => allPts.push(p)));
    const proj = getPanoramaScreenProjector();
    if (!proj) return false;
    const tagged = allPts.map(p => ({ py: p, sc: proj.toScreen(p[0], p[1]) })).filter(x => x.sc);
    if (tagged.length < 4) return false;
    const TL = tagged.reduce((m, p) => p.sc[0] + p.sc[1] < m.sc[0] + m.sc[1] ? p : m).py;
    const TR = tagged.reduce((m, p) => p.sc[0] - p.sc[1] > m.sc[0] - m.sc[1] ? p : m).py;
    const BR = tagged.reduce((m, p) => p.sc[0] + p.sc[1] > m.sc[0] + m.sc[1] ? p : m).py;
    const BL = tagged.reduce((m, p) => p.sc[0] - p.sc[1] < m.sc[0] - m.sc[1] ? p : m).py;
    const N = Math.max(2, divisoria.length + 1);
    const corners = [TL, TR, BR, BL].map(p => [...p]);
    let splits = Array.from({ length: N + 1 }, (_, i) => i / N);
    const tlSc = proj.toScreen(TL[0], TL[1]), trSc = proj.toScreen(TR[0], TR[1]);
    if (divisoria.length && tlSc && trSc) {
        const dx = trSc[0] - tlSc[0], dy = trSc[1] - tlSc[1], len2 = dx * dx + dy * dy;
        if (len2 > 1) {
            const divTs = divisoria.map(div => {
                const mid = [(div.puntos[0][0] + div.puntos[1][0]) / 2, (div.puntos[0][1] + div.puntos[1][1]) / 2];
                const msc = proj.toScreen(mid[0], mid[1]);
                return msc ? ((msc[0] - tlSc[0]) * dx + (msc[1] - tlSc[1]) * dy) / len2 : null;
            }).filter(t => t !== null).sort((a, b) => a - b);
            if (divTs.length) {
                splits = [0, ...divTs, 1];
                for (let i = 1; i < splits.length - 1; i++) splits[i] = Math.max(splits[i - 1] + 0.02, Math.min(0.98, splits[i]));
                splits[splits.length - 1] = 1;
            }
        }
    }
    const edgeIds = new Set(edges.map(e => e.id));
    allDrawnLines = allDrawnLines.filter(l => !edgeIds.has(l.id));
    const gid = 'franja_' + Date.now();
    allDrawnLines.push({ id: gid, tipo: 'franja-grupo', franjaCount: N, puntos: corners, franjaSplits: splits });
    rebuildFranjaGroup(gid);
    return true;
}
function ensureFranjaIntegrity() {
    migrateFranjaGroupsFromData();
    allDrawnLines.filter(l => l.tipo === 'franja-grupo').forEach(g => {
        const nFills = allDrawnLines.filter(l => l.franjaGrupo === g.id && l.tipo === 'area-invisible').length;
        if (nFills !== (g.franjaCount || 0)) rebuildFranjaGroup(g.id);
    });
    allDrawnLines.filter(l => l.tipo === 'franja-curva-grupo').forEach(g => {
        const nFills = allDrawnLines.filter(l => l.franjaGrupo === g.id && l.tipo === 'area-invisible').length;
        if (nFills !== (g.franjaCount || 0)) rebuildFranjaCurvaGroup(g.id);
    });
    const orphans = allDrawnLines.filter(l => l.tipo === 'area-invisible' && !l.franjaGrupo);
    if (orphans.length >= 2) { promoteClusterToFranja(orphans); return; }
    const orphanEdges = allDrawnLines.filter(l => isMacroEdgeType(l.tipo) && !l.franjaGrupo);
    if (orphanEdges.length >= 3) promoteMacroEdgesToFranja(orphanEdges);
    ensureStitchedDivisorias();
    syncMacroActiveClass();
}
function distPointToSegment2D(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function pointInPolygonPY(p, y, pts) {
    if (!pts || pts.length < 3) return false;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
        if (((yi > y) !== (yj > y)) && (p < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
}
function findClosestLineAtPanorama(p, y, maxDist) {
    let bestId = null, bestD = maxDist;
    allDrawnLines.forEach(line => {
        const pts = line.puntos;
        if (!pts || pts.length < 1) return;
        pts.forEach(pt => {
            const d = Math.hypot(pt[0] - p, pt[1] - y);
            if (d < bestD) { bestD = d; bestId = line.id; }
        });
        const closed = line.tipo !== 'calle' && line.tipo !== 'cortar' && line.tipo !== 'divisoria' && line.tipo !== 'borde-macro' && pts.length >= 3;
        if (closed && pointInPolygonPY(p, y, pts)) {
            const cP = pts.reduce((s, pt) => s + pt[0], 0) / pts.length, cY = pts.reduce((s, pt) => s + pt[1], 0) / pts.length;
            const d = Math.hypot(cP - p, cY - y);
            if (d < bestD) { bestD = d; bestId = line.id; }
        }
        for (let i = 0; i < pts.length; i++) {
            if (line.tipo !== 'cortar' && !closed && i === pts.length - 1) break;
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const d = distPointToSegment2D(p, y, a[0], a[1], b[0], b[1]);
            if (d < bestD) { bestD = d; bestId = line.id; }
        }
    });
    return bestId;
}
function findClosestLineAtScreen(clientX, clientY, maxPx) {
    const proj = getPanoramaScreenProjector();
    if (!proj) return null;
    const sx = clientX - DOMCache.viewport.left, sy = clientY - DOMCache.viewport.top;
    let bestId = null, bestD = maxPx;
    allDrawnLines.forEach(line => {
        const pts = line.puntos;
        if (!pts || pts.length < 1) return;
        const closed = line.tipo !== 'calle' && line.tipo !== 'cortar' && line.tipo !== 'divisoria' && line.tipo !== 'borde-macro' && pts.length >= 3;
        const scPts = pts.map(pt => proj.toScreen(pt[0], pt[1])).filter(Boolean);
        if (closed && scPts.length >= 3) {
            let inside = false;
            for (let i = 0, j = scPts.length - 1; i < scPts.length; j = i++) {
                const xi = scPts[i][0], yi = scPts[i][1], xj = scPts[j][0], yj = scPts[j][1];
                if (((yi > sy) !== (yj > sy)) && (sx < (xj - xi) * (sy - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
            }
            if (inside) {
                const cx = scPts.reduce((s, p) => s + p[0], 0) / scPts.length;
                const cy = scPts.reduce((s, p) => s + p[1], 0) / scPts.length;
                const d = Math.hypot(sx - cx, sy - cy);
                if (d < bestD) { bestD = d; bestId = line.id; }
            }
        }
        for (let i = 0; i < pts.length; i++) {
            if (line.tipo !== 'cortar' && !closed && i === pts.length - 1) break;
            const p1 = proj.toScreen(pts[i][0], pts[i][1]), p2 = proj.toScreen(pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
            if (!p1 || !p2) continue;
            const d = distPointToSegment2D(sx, sy, p1[0], p1[1], p2[0], p2[1]);
            if (d < bestD) { bestD = d; bestId = line.id; }
        }
    });
    return bestId;
}
function applyEraserDelete(lineId) {
    if (lineId === currentTempLineId) { currentLinePoints = []; return true; }
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line) return false;
    if (line.tipo === 'fila-variable-lote') {
        allDrawnLines = allDrawnLines.filter(l => l.id !== line.id && l.arq2Grupo !== line.id);
        return true;
    }
    const gid = line.tipo === 'franja-grupo' ? line.id : (line.franjaGrupo || null);
    if (gid) {
        allDrawnLines = allDrawnLines.filter(l => {
            if (l.id === gid || l.franjaGrupo === gid) return false;
            if (l.franjaStitch === gid || (l.franjaGrupo === gid)) return false;
            return true;
        });
        if (!allDrawnLines.some(l => l.tipo === 'franja-grupo' || isMacroEdgeType(l.tipo) || l.tipo === 'area-invisible')) {
            document.body.classList.remove('auto-macro-active');
        }
        return true;
    }
    allDrawnLines = allDrawnLines.filter(l => l.id !== lineId);
    return true;
}
function runEraserAtEvent(mock) {
    if (!visor360) return;
    const coords = visor360.mouseEventToCoords(mock);
    if (!coords) return;
    const lineId = findClosestLineAtScreen(mock.clientX, mock.clientY, 32)
        || findClosestLineAtPanorama(coords[0], coords[1], 8);
    if (lineId) {
        applyEraserDelete(lineId);
        refreshAllHotspots(true);
        saveToLocal();
    }
}
function bindSvgEraser(el, lineId) {
    if (!el || el.dataset.eraserBound) return;
    el.dataset.eraserBound = '1';
    const onErase = (e) => {
        if (currentLineType !== 'eraser') return;
        e.stopPropagation(); e.preventDefault();
        applyEraserDelete(lineId);
        refreshAllHotspots(true);
        saveToLocal();
    };
    el.addEventListener('mousedown', onErase);
    el.addEventListener('touchstart', onErase, { passive: false });
}
function sortLotesAlongStrip(lotes) {
    return [...lotes].sort((a, b) => {
        const ca = a.puntos.reduce((s, p, i) => i ? s + p[1] : p[1], 0) / a.puntos.length;
        const cb = b.puntos.reduce((s, p, i) => i ? s + p[1] : p[1], 0) / b.puntos.length;
        if (Math.abs(ca - cb) > 0.5) return ca - cb;
        const pa = a.puntos.reduce((s, p) => s + p[0], 0) / a.puntos.length;
        const pb = b.puntos.reduce((s, p) => s + p[0], 0) / b.puntos.length;
        return pa - pb;
    });
}
function purgeAllNonFranjaLoteTrazos() {
    allDrawnLines = allDrawnLines.filter(l => {
        if (l.tipo === 'franja-grupo' || l.franjaGrupo || isMacroEdgeType(l.tipo)) return true;
        if (l.tipo === 'calle' || l.tipo === 'cortar' || l.tipo === 'neon') return true;
        if (isAutoMacroLotePoly(l)) return false;
        return true;
    });
}
function promoteClusterToFranja(children) {
    if (!children || children.length < 2) return false;
    const sorted = sortLotesAlongStrip(children);
    const N = sorted.length;
    const first = sorted[0].puntos, last = sorted[N - 1].puntos;
    if (!first || first.length < 4 || !last || last.length < 4) return false;
    const childIds = new Set(sorted.map(c => c.id));
    allDrawnLines = allDrawnLines.filter(l => {
        if (childIds.has(l.id)) return false;
        if (isMacroEdgeType(l.tipo) && !l.franjaGrupo) return false;
        return true;
    });
    const corners = [first[0], first[1], last[2], last[3]].map(p => [...p]);
    const gid = 'franja_' + Date.now();
    allDrawnLines.push({
        id: gid, tipo: 'franja-grupo', franjaCount: N,
        puntos: corners, franjaSplits: inferFranjaSplitsFromLotes(corners, sorted)
    });
    rebuildFranjaGroup(gid);
    return true;
}
function applyFranjaDivDrag(gid, splitIdx, clientX, clientY) {
    const grp = allDrawnLines.find(l => l.id === gid && (l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo'));
    if (!grp) return;
    const splits = ensureFranjaSplits(grp);
    const proj = getPanoramaScreenProjector();
    if (!proj) return;
    const minGap = 0.025;
    let t;
    if (grp.tipo === 'franja-curva-grupo') {
        t = projectScreenTOnPolyline(grp.frente, clientX, clientY, proj);
        if (t == null) return;
    } else {
        const [TL, TR] = grp.puntos;
        const tlSc = proj.toScreen(TL[0], TL[1]), trSc = proj.toScreen(TR[0], TR[1]);
        if (!tlSc || !trSc) return;
        const sx = clientX - DOMCache.viewport.left, sy = clientY - DOMCache.viewport.top;
        const dx = trSc[0] - tlSc[0], dy = trSc[1] - tlSc[1];
        const len2 = dx * dx + dy * dy;
        if (len2 < 1) return;
        t = ((sx - tlSc[0]) * dx + (sy - tlSc[1]) * dy) / len2;
    }
    t = Math.max(splits[splitIdx - 1] + minGap, Math.min(splits[splitIdx + 1] - minGap, t));
    splits[splitIdx] = t;
    if (grp.tipo === 'franja-curva-grupo') rebuildFranjaCurvaGroup(gid);
    else rebuildFranjaGroup(gid);
}
function getPathClassForLine(line) {
    if (line.tipo === 'masterplan_fill') return 'linea-relleno-mp';
    if (line.tipo === 'neon') return 'linea-neon';
    if (line.tipo === 'punteada') return 'linea-punteada';
    if (line.tipo === 'cortar') return 'linea-corte';
    if (line.tipo === 'area-invisible') return 'linea-area-fill';
    if (line.tipo === 'divisoria') return 'linea-divisoria';
    if (line.tipo === 'borde-macro') return 'linea-borde-macro';
    if (line.tipo === 'lote-organico' || line.tipo === 'fila-variable-lote') return 'linea-solida';
    return 'linea-solida';
}
function resolveSvgLayerForLine(line, layers) {
    const { lLotes, lAristas } = layers;
    if (!line) return lLotes;
    if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
        const lArq2 = document.getElementById('layer-calles-arq2');
        return lArq2 || layers.lAsfalto || lLotes;
    }
    if (line.tipo === 'divisoria' || line.tipo === 'borde-macro') return lAristas;
    if (line.tipo === 'arista_solida' || line.tipo === 'arista_punteada') return lAristas;
    if (line.tipo === 'franja-preview-div' || line.tipo === 'linea-pines-guia') return lAristas;
    if (line.tipo === 'franja-grupo' || line.tipo === 'franja-curva-grupo' || line.tipo === 'franja-preview') return lLotes;
    return lLotes;
}
function ensureSvgLayerOrder(svg) {
    if (!svg) return;
    ['layer-calles-bordes', 'layer-calles-asfalto', 'layer-calles-arq2', 'layer-lotes', 'layer-aristas', 'arq2-demo-layer', 'layer-arq2-feedback'].forEach(id => {
        const g = document.getElementById(id);
        if (g && g.parentNode === svg) svg.appendChild(g);
    });
}
function straightenFranjaGroup(gid) {
    const grp = allDrawnLines.find(l => l.id === gid && (l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo'));
    if (!grp) return false;
    
    if (grp.tipo === 'franja-curva-grupo') {
        grp.tipo = 'franja-grupo';
        grp.puntos = [grp.frente[0], grp.frente[grp.frente.length-1], grp.fondo[grp.fondo.length-1], grp.fondo[0]];
        delete grp.frente; delete grp.fondo;
        rebuildFranjaGroup(gid);
        return true;
    }

    if (grp.puntos.length < 4) return false;
    const proj = getPanoramaScreenProjector();
    if (!proj) return false;
    const scPts = grp.puntos.map(py => ({ sc: proj.toScreen(py[0], py[1]) })).filter(p => p.sc);
    if (scPts.length < 4) return false;
    const TLsc = scPts.reduce((m, p) => p.sc[0] + p.sc[1] < m.sc[0] + m.sc[1] ? p : m).sc;
    const TRsc = scPts.reduce((m, p) => p.sc[0] - p.sc[1] > m.sc[0] - m.sc[1] ? p : m).sc;
    const BRsc = scPts.reduce((m, p) => p.sc[0] + p.sc[1] > m.sc[0] + m.sc[1] ? p : m).sc;
    const BLsc = scPts.reduce((m, p) => p.sc[0] - p.sc[1] < m.sc[0] - m.sc[1] ? p : m).sc;
    const nTL = proj.toPY(TLsc[0], TLsc[1]), nTR = proj.toPY(TRsc[0], TRsc[1]);
    const nBR = proj.toPY(BRsc[0], BRsc[1]), nBL = proj.toPY(BLsc[0], BLsc[1]);
    if (!nTL || !nTR || !nBR || !nBL) return false;
    grp.puntos = [nTL, nTR, nBR, nBL];
    rebuildFranjaGroup(gid);
    return true;
}
function enderezarFranjas() {
    migrateFranjaGroupsFromData();
    const grupos = allDrawnLines.filter(l => l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo');
    if (!grupos.length) return alert('No hay franjas de lotes.\n\nUsa 🏘️ Franja Lotes, 〰️ Franja Curva o ✨ AUTO-MACRO primero.');
    if (!confirm(`📏 ENDEREZAR ${grupos.length} franja(s)\n\n• Bordes superiores/inferiores rectos\n• Divisiones verticales alineadas\n• Estilo levantamiento topográfico\n\n¿Continuar?`)) return;
    let ok = 0;
    grupos.forEach(g => { if (straightenFranjaGroup(g.id)) ok++; });
    if (ok) { refreshAllHotspots(); saveToLocal(); flashScreenSuccess(); }
    else alert('⚠️ Enderezado incompleto. Centra la vista para ver toda la franja en pantalla.');
}
function getFranjaChildLines(gid) {
    return allDrawnLines.filter(l => l.franjaGrupo === gid && l.tipo === 'area-invisible');
}
function rebuildMacroEdgesForFranjaGroup(gid) {
    const lotes = getFranjaChildLines(gid);
    if (!lotes.length) return;
    allDrawnLines = allDrawnLines.filter(l => !(l.franjaGrupo === gid && (l.tipo === 'divisoria' || l.tipo === 'borde-macro')));
    const { macroLines } = buildAutoMacroFromLotes(lotes);
    macroLines.forEach(m => { m.franjaGrupo = gid; });
    allDrawnLines.push(...macroLines);
}
function getFranjaStripById(gid) {
    return allDrawnLines.find(l => l.id === gid && (l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo'));
}
function normalizeFranjaStripToRect(gid) {
    const grp = getFranjaStripById(gid);
    if (!grp) return null;
    if (grp.tipo === 'franja-curva-grupo') straightenFranjaGroup(gid);
    return allDrawnLines.find(l => l.id === gid && l.tipo === 'franja-grupo') || null;
}
function resamplePolylineToCount(pts, count) {
    if (!pts?.length || count < 2) return pts ? pts.map(p => [...p]) : [];
    const out = [];
    for (let i = 0; i < count; i++) out.push(getPointAlongPolyline(pts, i / (count - 1)));
    return out;
}
function getScreenOverlapX(a, b) {
    const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right);
    return right - left >= 10 ? { left, right, width: right - left } : null;
}
function isFranjaLotCentroidVisible(linea) {
    if (!linea?.franjaGrupo || !linea.puntos?.length) return true;
    const rect = getFranjaGrupoScreenRects().find(r => r.gid === linea.franjaGrupo);
    const proj = getPanoramaScreenProjector();
    if (!rect || !proj) return true;
    let cP = 0, cY = 0;
    linea.puntos.forEach(pt => { cP += pt[0]; cY += pt[1]; });
    cP /= linea.puntos.length; cY /= linea.puntos.length;
    const sc = proj.toScreen(cP, cY);
    if (!sc) return false;
    const pad = 16;
    return sc[0] >= rect.left - pad && sc[0] <= rect.right + pad && sc[1] >= rect.top - pad && sc[1] <= rect.bottom + pad;
}
function pyDist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function assignPyIfChanged(target, idx, next, changedRef, tol) {
    if (pyDist(target[idx], next) > tol) { target[idx] = next; changedRef.v = true; }
}
function weldFranjaCurvaToNeighbors(gid) {
    const grp = getFranjaStripById(gid);
    if (!grp || grp.tipo !== 'franja-curva-grupo') return false;
    const proj = getPanoramaScreenProjector();
    const nr = getFranjaGrupoScreenRects().find(r => r.gid === gid);
    if (!proj || !nr) return false;
    const SNAP = 52;
    const CORNER_SNAP = 56;
    const TOL = 0.025;
    const changed = { v: false };
    getFranjaGrupoScreenRects().forEach(or => {
        if (or.gid === gid) return;
        const neighbor = getFranjaStripById(or.gid);
        if (!neighbor) return;
        
        let cornerList = [];
        if (neighbor.tipo === 'franja-grupo' && neighbor.puntos?.length >= 4) {
            cornerList = [neighbor.puntos[0], neighbor.puntos[1], neighbor.puntos[2], neighbor.puntos[3]];
        } else if (neighbor.tipo === 'franja-curva-grupo' && neighbor.frente?.length && neighbor.fondo?.length) {
            cornerList = [
                neighbor.frente[0], neighbor.frente[neighbor.frente.length - 1],
                neighbor.fondo[0], neighbor.fondo[neighbor.fondo.length - 1]
            ];
        }
        
        const nF = grp.frente.length - 1, nB = grp.fondo.length - 1;
        if (nF < 1 || nB < 1) return;
        const ovl = getScreenOverlapX(nr, or);
        
        if (ovl && Math.abs(nr.bottom - or.top) < SNAP) {
            const pL = proj.toPY(ovl.left, or.top), pR = proj.toPY(ovl.right, or.top);
            if (pL && pR) {
                for (let i = 0; i <= nB; i++) assignPyIfChanged(grp.fondo, i, lerpPY(pL, pR, i / nB), changed, TOL);
            }
        } else if (ovl && Math.abs(nr.top - or.bottom) < SNAP) {
            const pL = proj.toPY(ovl.left, or.bottom), pR = proj.toPY(ovl.right, or.bottom);
            if (pL && pR) {
                for (let i = 0; i <= nF; i++) assignPyIfChanged(grp.frente, i, lerpPY(pL, pR, i / nF), changed, TOL);
            }
        }
        
        if (cornerList.length === 4) {
            const snapIdx = (arr, idx) => {
                const sc = proj.toScreen(arr[idx][0], arr[idx][1]);
                if (!sc) return;
                let best = arr[idx], bestD = CORNER_SNAP;
                cornerList.forEach(c => {
                    const cs = proj.toScreen(c[0], c[1]);
                    if (!cs) return;
                    const d = Math.hypot(sc[0] - cs[0], sc[1] - cs[1]);
                    if (d < bestD) { bestD = d; best = [...c]; }
                });
                assignPyIfChanged(arr, idx, best, changed, TOL);
            };
            snapIdx(grp.frente, 0); snapIdx(grp.frente, nF);
            snapIdx(grp.fondo, 0); snapIdx(grp.fondo, nB);
        }
    });
    
    if (changed.v) {
        rebuildFranjaCurvaGroup(gid);
        ensureStitchedDivisorias();
        getFranjaGrupoScreenRects().forEach(or => {
            if (or.gid === gid) return;
            const nb = getFranjaStripById(or.gid);
            if (nb?.tipo === 'franja-grupo') rebuildFranjaGroup(or.gid);
        });
    }
    return changed.v;
}
function getFranjaSplitRailPoints(grp) {
    const N = grp.franjaCount || 2;
    const splits = ensureFranjaSplits(grp);
    if (grp.tipo === 'franja-grupo' && grp.puntos?.length >= 4) {
        const built = buildFranjaPointsFromCorners(grp.puntos[0], grp.puntos[1], grp.puntos[2], grp.puntos[3], N, splits);
        return built ? { topPts: built.topPts, botPts: built.botPts, N, splits } : null;
    }
    if (grp.tipo === 'franja-curva-grupo' && grp.frente?.length >= 2 && grp.fondo?.length >= 2) {
        const topPts = [], botPts = [];
        for (let i = 0; i <= N; i++) {
            topPts.push(getPointAlongPolyline(grp.frente, splits[i]));
            botPts.push(getPointAlongPolyline(grp.fondo, splits[i]));
        }
        return { topPts, botPts, N, splits };
    }
    return null;
}
function injectFranjaInternalDivisorias(macroLines, gid, topPts, botPts, N) {
    const out = [...macroLines];
    for (let i = 1; i < N; i++) {
        const p1 = [...topPts[i]], p2 = [...botPts[i]];
        let hasDiv = out.some(m => m.tipo === 'divisoria' && m.puntos?.length >= 2 && edgeMatchesLine(m.puntos[0], m.puntos[1], p1, p2, 0.15));
        if (!hasDiv) {
            out.push({ id: 'div_int_' + gid + '_' + i, tipo: 'divisoria', puntos: [p1, p2], franjaGrupo: gid, franjaDivIdx: i });
        }
        out.forEach((m, j) => {
            if (m.tipo === 'borde-macro' && m.puntos?.length >= 2 && edgeMatchesLine(m.puntos[0], m.puntos[1], p1, p2, 0.15)) {
                out[j] = { ...m, tipo: 'divisoria' };
            }
        });
    }
    return out;
}
function projectScreenTOnPolyline(pts, clientX, clientY, proj) {
    const sx = clientX - DOMCache.viewport.left, sy = clientY - DOMCache.viewport.top;
    const hit = proj.toPY(sx, sy);
    if (!hit) return null;
    const len = getPolylineLength(pts);
    if (len < 1e-6) return 0;
    let bestT = 0, bestD = Infinity, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
        const dx = bx - ax, dy = by - ay, segLen2 = dx * dx + dy * dy;
        const segLen = Math.hypot(dx, dy);
        let segT = segLen2 < 1e-9 ? 0 : ((hit[0] - ax) * dx + (hit[1] - ay) * dy) / segLen2;
        segT = Math.max(0, Math.min(1, segT));
        const px = ax + segT * dx, py = ay + segT * dy;
        const dist = Math.hypot(hit[0] - px, hit[1] - py);
        if (dist < bestD) { bestD = dist; bestT = (acc + segT * segLen) / len; }
        acc += segLen;
    }
    return bestT;
}
function rebuildFranjaGroup(gid) {
    const grp = allDrawnLines.find(l => l.id === gid && l.tipo === 'franja-grupo');
    if (!grp || grp.puntos.length < 4) return;
    const N = grp.franjaCount || 2;
    const splits = ensureFranjaSplits(grp);
    allDrawnLines = allDrawnLines.filter(l => l.franjaGrupo !== gid);
    const rails = getFranjaSplitRailPoints(grp);
    if (!rails) return;
    const { topPts, botPts } = rails;
    const draftPolys = [];
    for (let i = 0; i < N; i++) {
        draftPolys.push({
            id: gid + '_' + i, tipo: 'solida', franjaGrupo: gid, franjaIdx: i,
            franjaNumero: String(i + 1).padStart(2, '0'),
            puntos: [topPts[i], topPts[i + 1], botPts[i + 1], botPts[i]]
        });
    }
    const { invisibleFills, macroLines } = buildAutoMacroFromLotes(draftPolys);
    let edges = injectFranjaInternalDivisorias(macroLines, gid, topPts, botPts, N);
    invisibleFills.forEach((f, i) => {
        f.franjaGrupo = gid; f.franjaIdx = i; f.franjaNumero = draftPolys[i].franjaNumero; f.id = gid + '_' + i;
    });
    edges.forEach(m => { m.franjaGrupo = gid; });
    allDrawnLines.push(...invisibleFills, ...edges);
    document.body.classList.add('auto-macro-active');
}
function migrateFranjaGroupsFromData() {
    const childRe = /^franja_\d+_\d+$/;
    const groups = new Map();
    allDrawnLines.forEach(l => {
        if (!childRe.test(l.id) || !isAutoMacroLotePoly(l)) return;
        const gid = l.id.replace(/_\d+$/, '');
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(l);
    });
    groups.forEach((children, gid) => {
        if (allDrawnLines.some(l => l.id === gid && l.tipo === 'franja-grupo')) return;
        const sorted = [...children].sort((a, b) => parseInt(a.id.split('_').pop()) - parseInt(b.id.split('_').pop()));
        if (!sorted.length) return;
        const N = sorted.length;
        const first = sorted[0].puntos, last = sorted[N-1].puntos;
        if (!first || first.length < 4 || !last || last.length < 4) return;
        allDrawnLines.push({
            id: gid, tipo: 'franja-grupo', franjaCount: N,
            puntos: [first[0], first[1], last[2], last[3]].map(p => [...p])
        });
        sorted.forEach((c, i) => {
            c.franjaGrupo = gid; c.franjaIdx = i; c.franjaNumero = String(i + 1).padStart(2, '0');
        });
    });
}
function createFranjaFromPolygon(poly, N) {
    if (!poly || poly.puntos.length < 4) return false;
    const gid = 'franja_' + Date.now();
    allDrawnLines = allDrawnLines.filter(l => l.id !== poly.id);
    allDrawnLines.push({
        id: gid, tipo: 'franja-grupo', franjaCount: N,
        puntos: poly.puntos.slice(0, 4).map(p => [...p])
    });
    rebuildFranjaGroup(gid);
    return true;
}
function collectLotesForAutoMacro() {
    migrateFranjaGroupsFromData();
    const grupos = allDrawnLines.filter(l => l.tipo === 'franja-grupo');
    let lotes = allDrawnLines.filter(l => isAutoMacroLotePoly(l) && l.tipo !== 'franja-grupo');
    if (grupos.length) return { mode: 'franja-rebuild', grupos, lotes };
    if (lotes.length >= 2) return { mode: 'macro', lotes };
    if (lotes.length === 1 && lotes[0].puntos.length >= 4) return { mode: 'subdivide', lotes };
    return { mode: 'none', lotes: [] };
}
function syncFranjaVertexDrag(linea, idx, coords) {
    const old = [...linea.puntos[idx]];
    getFranjaChildLines(linea.franjaGrupo).forEach(l => {
        l.puntos.forEach((pt, i) => {
            if (Math.hypot(pt[0]-old[0], pt[1]-old[1]) < 0.08) l.puntos[i] = [coords[0], coords[1]];
        });
    });
    linea.puntos[idx] = [coords[0], coords[1]];
}
function applyDraggedVertexCoords(coords) {
    if (!draggingVertex || !coords || isNaN(coords[0])) return;
    if (draggingVertex.lineId === currentTempLineId) {
        currentLinePoints[draggingVertex.idx] = [coords[0], coords[1]];
        return;
    }
    const linea = allDrawnLines.find(l => l.id === draggingVertex.lineId);
    if (!linea) return;
    if (linea.tipo === 'franja-grupo') {
        linea.puntos[draggingVertex.idx] = [coords[0], coords[1]];
        rebuildFranjaGroup(linea.id);
        return;
    }
    if (linea.tipo === 'franja-curva-grupo') {
        if (draggingVertex.target === 'frente') linea.frente[draggingVertex.idx] = [coords[0], coords[1]];
        if (draggingVertex.target === 'fondo') linea.fondo[draggingVertex.idx] = [coords[0], coords[1]];
        rebuildFranjaCurvaGroup(linea.id);
        weldFranjaCurvaToNeighbors(linea.id);
        return;
    }
    if (linea.franjaGrupo) {
        syncFranjaVertexDrag(linea, draggingVertex.idx, coords);
        rebuildMacroEdgesForFranjaGroup(linea.franjaGrupo);
        return;
    }
    linea.puntos[draggingVertex.idx] = [coords[0], coords[1]];
}
function autoMacroSnap(v) { return Math.round(v * 100) / 100; }
function autoMacroEdgeKey(p1, p2) {
    const a = `${autoMacroSnap(p1[0])},${autoMacroSnap(p1[1])}`, b = `${autoMacroSnap(p2[0])},${autoMacroSnap(p2[1])}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function mergeFuzzyAutoMacroEdges(edgeMap) {
    const keys = Array.from(edgeMap.keys());
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const e1 = edgeMap.get(keys[i]), e2 = edgeMap.get(keys[j]);
            if (!e1 || !e2) continue;
            const d11 = Math.hypot(e1.p1[0]-e2.p1[0], e1.p1[1]-e2.p1[1]);
            const d22 = Math.hypot(e1.p2[0]-e2.p2[0], e1.p2[1]-e2.p2[1]);
            const d12 = Math.hypot(e1.p1[0]-e2.p2[0], e1.p1[1]-e2.p2[1]);
            const d21 = Math.hypot(e1.p2[0]-e2.p1[0], e1.p2[1]-e2.p1[1]);
            const tol = 0.08;
            if ((d11 < tol && d22 < tol) || (d12 < tol && d21 < tol)) {
                e1.count += e2.count;
                e1.p1 = [(e1.p1[0]+e2.p1[0])/2, (e1.p1[1]+e2.p1[1])/2];
                e1.p2 = [(e1.p2[0]+e2.p2[0])/2, (e1.p2[1]+e2.p2[1])/2];
                edgeMap.delete(keys[j]);
            }
        }
    }
}
function buildAutoMacroFromLotes(lotes) {
    const edgeMap = new Map();
    lotes.forEach(l => {
        const pts = l.puntos;
        for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
            if (Math.hypot(p1[0]-p2[0], p1[1]-p2[1]) < 0.002) continue;
            const key = autoMacroEdgeKey(p1, p2);
            if (!edgeMap.has(key)) edgeMap.set(key, { p1: [...p1], p2: [...p2], count: 0 });
            edgeMap.get(key).count++;
        }
    });
    mergeFuzzyAutoMacroEdges(edgeMap);
    const macroLines = []; let idx = 0; const ts = Date.now();
    edgeMap.forEach(edge => {
        if (edge.count >= 2) macroLines.push({ id: 'div_auto_'+ts+'_'+idx++, tipo: 'divisoria', puntos: [edge.p1, edge.p2] });
        else macroLines.push({ id: 'brd_auto_'+ts+'_'+idx++, tipo: 'borde-macro', puntos: [edge.p1, edge.p2] });
    });
    const invisibleFills = lotes.map(l => ({ ...l, tipo: 'area-invisible' }));
    return { invisibleFills, macroLines };
}
function runAutoMacroTransform(explicitLotes) {
    migrateFranjaGroupsFromData();
    let lotes = explicitLotes || allDrawnLines.filter(l => isAutoMacroLotePoly(l) && l.tipo !== 'franja-grupo');
    if (!lotes.length) {
        const grupos = allDrawnLines.filter(l => l.tipo === 'franja-grupo');
        if (grupos.length) { grupos.forEach(g => rebuildFranjaGroup(g.id)); return true; }
        return false;
    }
    const grupoIds = new Set(lotes.map(l => l.franjaGrupo).filter(Boolean));
    const lotIds = new Set(lotes.map(l => l.id));
    const others = allDrawnLines.filter(l => {
        if (l.tipo === 'franja-grupo') return true;
        if (isMacroEdgeType(l.tipo)) {
            if (l.franjaGrupo && grupoIds.has(l.franjaGrupo)) return false;
            if (!explicitLotes && !l.franjaGrupo) return false;
            return true;
        }
        if (lotIds.has(l.id)) return false;
        if (l.franjaGrupo && grupoIds.has(l.franjaGrupo)) return false;
        if (isAutoMacroLotePoly(l) && l.tipo !== 'franja-grupo') return false;
        return true;
    });
    const { invisibleFills, macroLines } = buildAutoMacroFromLotes(lotes);
    invisibleFills.forEach(f => {
        const src = lotes.find(l => l.id === f.id) || lotes[invisibleFills.indexOf(f)];
        if (src?.franjaGrupo) { f.franjaGrupo = src.franjaGrupo; f.franjaIdx = src.franjaIdx; f.franjaNumero = src.franjaNumero; }
    });
    if (grupoIds.size === 1) macroLines.forEach(m => { m.franjaGrupo = [...grupoIds][0]; });
    allDrawnLines = [...others, ...invisibleFills, ...macroLines];
    purgeAllNonFranjaLoteTrazos();
    const orphanFills = allDrawnLines.filter(l => l.tipo === 'area-invisible' && !l.franjaGrupo);
    if (orphanFills.length >= 2) promoteClusterToFranja(orphanFills);
    else orphanFills.forEach((f, i) => { f.franjaNumero = String(i + 1).padStart(2, '0'); });
    document.body.classList.add('auto-macro-active');
    return true;
}
function finalizeAutoMacroSession() {
    purgeAllNonFranjaLoteTrazos();
    allDrawnLines.filter(l => l.tipo === 'franja-grupo').forEach(g => rebuildFranjaGroup(g.id));
    ensureFranjaIntegrity();
}
function isMasterplanAristaType(tipo) { return tipo === 'arista_solida' || tipo === 'arista_punteada'; }
function masterplanEdgeKey(p1, p2) {
    const a = `${p1[0].toFixed(2)},${p1[1].toFixed(2)}`, b = `${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function buildMasterplanAristas(fills) {
    const edgeMap = new Map();
    fills.forEach(poly => {
        const pts = poly.puntos;
        for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
            const key = masterplanEdgeKey(p1, p2);
            if (!edgeMap.has(key)) edgeMap.set(key, { p1: [...p1], p2: [...p2], count: 0 });
            edgeMap.get(key).count++;
        }
    });
    const aristas = []; let idx = 0;
    edgeMap.forEach(edge => {
        if (arq2_isEdgeSharedWithOrganicLote(edge.p1, edge.p2)) return;
        aristas.push({ id: 'arista_mp_' + Date.now() + '_' + (idx++), tipo: edge.count === 1 ? 'arista_solida' : 'arista_punteada', puntos: [edge.p1, edge.p2] });
    });
    return aristas;
}
function refreshMasterplanAristas() {
    if (!document.body.classList.contains('masterplan-premium-active')) return;
    const others = allDrawnLines.filter(l => !isMasterplanAristaType(l.tipo) && l.tipo !== 'masterplan_fill');
    const fills = allDrawnLines.filter(l => l.tipo === 'masterplan_fill');
    if (!fills.length) { document.body.classList.remove('masterplan-premium-active'); allDrawnLines = others; return; }
    allDrawnLines = [...others, ...fills, ...buildMasterplanAristas(fills)];
}
function initMasterplanPremiumFromData() {
    const fills = allDrawnLines.filter(l => l.tipo === 'masterplan_fill');
    if (!fills.length) return;
    document.body.classList.remove('auto-macro-active');
    document.body.classList.add('masterplan-premium-active');
    if (!allDrawnLines.some(l => isMasterplanAristaType(l.tipo))) refreshMasterplanAristas();
}
function initAutoMacroFromData() {
    migrateFranjaGroupsFromData();
    allDrawnLines.filter(l => l.tipo === 'franja-grupo').forEach(g => rebuildFranjaGroup(g.id));
    allDrawnLines.filter(l => l.tipo === 'franja-curva-grupo').forEach(g => rebuildFranjaCurvaGroup(g.id));
    const fills = allDrawnLines.filter(l => isAutoMacroLotePoly(l) && l.tipo !== 'franja-grupo');
    const hasMacroEdges = allDrawnLines.some(l => isMacroEdgeType(l.tipo));
    if (fills.length >= 2 && !hasMacroEdges) { runAutoMacroTransform(fills); finalizeAutoMacroSession(); }
    else if (hasMacroEdges && fills.some(l => l.tipo === 'area-invisible' || l.tipo === 'masterplan_fill')) document.body.classList.add('auto-macro-active');
    else syncFranjaVisualsOnReady();
}
function clearFranjaDraft() {
    franjaCornerA = null; franjaPreviewQuad = null; franjaPreviewDivs = [];
    try { visor360?.removeHotSpot('franja_preview_a'); } catch(e) {}
}
function screenPointToPanorama(sx, sy) {
    if (!visor360) return null;
    const r = visor360.mouseEventToCoords({ clientX: sx, clientY: sy });
    return r ? [parseFloat(r[0].toFixed(3)), parseFloat(r[1].toFixed(3))] : null;
}
function getFranjaGrupoScreenRects() {
    const proj = getPanoramaScreenProjector();
    if (!proj) return [];
    return allDrawnLines.filter(l => l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo').map(g => {
        let TL, TR, BR, BL;
        if (g.tipo === 'franja-grupo') {
            [TL, TR, BR, BL] = g.puntos;
        } else {
            TL = g.frente[0]; TR = g.frente[g.frente.length - 1];
            BR = g.fondo[g.fondo.length - 1]; BL = g.fondo[0]; 
        }
        const tl = proj.toScreen(TL[0], TL[1]), tr = proj.toScreen(TR[0], TR[1]);
        const br = proj.toScreen(BR[0], BR[1]), bl = proj.toScreen(BL[0], BL[1]);
        if (!tl || !tr || !br || !bl) return null;
        return { gid: g.id, grp: g, tl, tr, br, bl,
            left: Math.min(tl[0], bl[0]), right: Math.max(tr[0], br[0]),
            top: Math.min(tl[1], tr[1]), bottom: Math.max(bl[1], br[1]) };
    }).filter(Boolean);
}
function rectsSameWidth(a, b, px) {
    return Math.abs(a.left - b.left) < px && Math.abs(a.right - b.right) < px;
}
function rectsSameHeight(a, b, px) {
    return Math.abs(a.top - b.top) < px && Math.abs(a.bottom - b.bottom) < px;
}
function isFranjaBoundLine(line) {
    return line && (line.tipo === 'franja-grupo' || line.tipo === 'franja-curva-grupo' || line.tipo === 'borde-macro' || line.tipo === 'area-invisible' || !!line.franjaGrupo);
}
function getCalleDynBasePx() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--stroke-dyn') || '2.5px';
    return Math.max(1.2, parseFloat(raw) || 2.5);
}
const CALLE_BORDER_FRANJA_RATIO = 0.48;
function getCalleBorderThinPx() {
    return Math.max(0.4, getCalleDynBasePx() * CALLE_BORDER_FRANJA_RATIO);
}
function getCalleHalfWidthPx(anchoFactor) {
    const sw = getCalleStrokeWidths(anchoFactor);
    const basePx = getCalleDynBasePx();
    
    // Mitad matemática del borde de la franja
    const lotBorderHalf = basePx * 0.5; 
    
    // FIX: Margen anti-derrame de sub-píxeles (mayor en móviles por el escalado de retina)
    const isMobile = window.innerWidth <= 768;
    const safetyMargin = isMobile ? (basePx * 1.5) : (basePx * 0.1); 
    
    return (sw.borde * 0.5) + lotBorderHalf + safetyMargin;
}
function getCalleStrokeWidths(anchoFactor) {
    const base = getCalleDynBasePx();
    const factor = anchoFactor || draftCalleAncho || 8;
    
    // FIX: Reducción del 35% del grosor general solo en dispositivos móviles (20% + 15%)
    const isMobile = window.innerWidth <= 768;
    const scale = isMobile ? 0.65 : 1.0;
    
    // Aplicamos la escala al asfalto y a la línea blanca fina
    const asf = Math.max(4, base * factor * scale);
    const thin = getCalleBorderThinPx() * scale;
    
    return { asfalto: asf, borde: asf + thin * 2, thin };
}
function getCalleStyleForLine(line) {
    return {
        ancho: line?.calleAncho ?? draftCalleAncho ?? 8,
        alpha: line?.calleAlpha ?? draftCalleAlpha ?? 0,
        labelScale: line?.calleLabelScale ?? draftCalleLabelScale ?? 1,
        showLabel: line?.calleShowLabel !== undefined ? line.calleShowLabel : draftCalleShowLabel
    };
}
function applyCallePathStyles(paths, ancho, alpha) {
    if (!paths || !paths.length) return;
    const sw = getCalleStrokeWidths(ancho);
    const a = Math.max(0, Math.min(1, alpha ?? draftCalleAlpha ?? 0));
    const borde = paths.find(p => p.classList && p.classList.contains('linea-calle-borde')) || paths[0];
    const asf = paths.find(p => p.classList && p.classList.contains('linea-calle-asfalto')) || paths[1];
    if (borde) {
        borde.style.setProperty('stroke-width', sw.borde + 'px', 'important');
        borde.style.setProperty('stroke', 'rgba(255,255,255,0.94)', 'important');
        // FIX: Forzamos corte plano y esquinas rectas en el borde blanco
        borde.style.setProperty('stroke-linecap', 'butt', 'important');
        borde.style.setProperty('stroke-linejoin', 'miter', 'important');
        borde.style.setProperty('filter', 'drop-shadow(0 0 1px rgba(255,255,255,0.35))', 'important');
    }
    if (asf) {
        asf.style.setProperty('stroke-width', sw.asfalto + 'px', 'important');
        asf.style.setProperty('stroke', a <= 0.02 ? 'rgba(0,0,0,0)' : `rgba(30,35,45,${a})`, 'important');
        asf.style.setProperty('stroke-linecap', 'butt', 'important');
        asf.style.setProperty('stroke-linejoin', 'miter', 'important');
    }
}
function syncCallePanelUI() {
    const panel = document.getElementById('calle-tool-panel');
    if (!panel) return;
    const anchoEl = document.getElementById('calle-ui-ancho');
    const alphaEl = document.getElementById('calle-ui-alpha');
    const labelEl = document.getElementById('calle-ui-label');
    const showEl = document.getElementById('calle-ui-show-label');
    const snapEl = document.getElementById('calle-ui-snap-franja');
    if (anchoEl) anchoEl.value = draftCalleAncho;
    if (alphaEl) alphaEl.value = draftCalleAlpha;
    if (labelEl) labelEl.value = draftCalleLabelScale;
    if (showEl) showEl.checked = draftCalleShowLabel;
    if (snapEl) snapEl.checked = draftCalleSnapFranja;
    const anchoVal = document.getElementById('calle-ui-ancho-val');
    const alphaVal = document.getElementById('calle-ui-alpha-val');
    const labelVal = document.getElementById('calle-ui-label-val');
    if (anchoVal) anchoVal.textContent = draftCalleAncho.toFixed(1);
    if (alphaVal) alphaVal.textContent = Math.round(draftCalleAlpha * 100) + '%';
    if (labelVal) labelVal.textContent = draftCalleLabelScale.toFixed(1) + '×';
    const bar = document.getElementById('calle-width-preview-bar');
    if (bar) {
        const pct = Math.max(6, Math.min(100, ((draftCalleAncho - 2) / 26) * 100));
        bar.style.width = pct + '%';
        bar.style.opacity = String(draftCalleAlpha);
    }
    const finishBtn = document.getElementById('btn-calle-finish');
    const drawStatus = document.getElementById('calle-draw-status');
    const n = currentLinePoints.length;
    const canFinish = currentLineType === 'calle' && n >= 2;
    if (finishBtn) finishBtn.classList.toggle('is-ready', canFinish);
    if (drawStatus) {
        drawStatus.classList.toggle('is-ready', canFinish);
        drawStatus.textContent = canFinish
            ? `${n} puntos — listo para terminar`
            : (n === 1 ? '1 punto — falta al menos uno más' : 'Coloca al menos 2 puntos en el mapa');
    }
}
function finishCalleDrawing() {
    if (currentLineType !== 'calle' || currentLinePoints.length < 2) return false;
    anclarTrazoActivo();
    syncCallePanelUI();
    flashScreenSuccess();
    return true;
}
function openCalleToolPanel() {
    document.getElementById('calle-tool-panel')?.classList.add('open');
    document.body.classList.add('calle-mode-active');
    syncCallePanelUI();
}
function closeCalleToolPanel() {
    document.getElementById('calle-tool-panel')?.classList.remove('open');
    document.body.classList.remove('calle-mode-active');
    lastCalleTap = null;
}
function isNearFranjaCornerScreen(clientX, clientY, pxRadius) {
    const sx = clientX - DOMCache.viewport.left, sy = clientY - DOMCache.viewport.top;
    const r = pxRadius || 28;
    let near = false;
    getAllStripSnapTargets().forEach(rect => {
        [rect.tl, rect.tr, rect.br, rect.bl].forEach(c => {
            if (Math.hypot(sx - c[0], sy - c[1]) < r) near = true;
        });
    });
    return near;
}
function getCalleMidpointPY(puntos) {
    if (!puntos || puntos.length < 2) return null;
    let total = 0;
    const lens = [];
    for (let i = 0; i < puntos.length - 1; i++) {
        const d = Math.hypot(puntos[i + 1][0] - puntos[i][0], puntos[i + 1][1] - puntos[i][1]);
        lens.push(d);
        total += d;
    }
    if (total < 1e-6) return [puntos[0][0], puntos[0][1]];
    let target = total * 0.5, acc = 0;
    for (let i = 0; i < lens.length; i++) {
        if (acc + lens[i] >= target) {
            const t = (target - acc) / lens[i];
            return [puntos[i][0] + t * (puntos[i + 1][0] - puntos[i][0]), puntos[i][1] + t * (puntos[i + 1][1] - puntos[i][1])];
        }
        acc += lens[i];
    }
    return [puntos[puntos.length - 1][0], puntos[puntos.length - 1][1]];
}
function getPanoramaPointDepth(pitch, yaw, visor360) {
    if (!visor360) return 1;
    const camP = visor360.getPitch() * Math.PI / 180;
    const camYw = visor360.getYaw() * Math.PI / 180;
    const p = pitch * Math.PI / 180;
    const y = yaw * Math.PI / 180;
    let yd = y - camYw;
    while (yd > Math.PI) yd -= 2 * Math.PI;
    while (yd < -Math.PI) yd += 2 * Math.PI;
    const sp = Math.sin(p), cp = Math.cos(p);
    const sy = Math.sin(yd), cy = Math.cos(yd);
    const scp = Math.sin(camP), ccp = Math.cos(camP);
    return Math.max(0.08, sp * scp + cp * cy * ccp);
}
function computeCalleSnapOffsetPx(pitch, yaw, anchoFactor, visor360) {
    const halfW = getCalleHalfWidthPx(anchoFactor);
    if (!visor360) return halfW;
    const hfov = visor360.getHfov();
    const hfovRef = DEFAULT_HFOV || 125;
    // FOV más ancho → menos grados por píxel → el mismo halfW px “corta” en el terreno
    const fovScale = Math.tan(hfovRef * Math.PI / 360) / Math.tan(hfov * Math.PI / 360);
    const z = getPanoramaPointDepth(pitch, yaw, visor360);
    // Compensación oblicua: baja z = punto en zona comprimida del domo (típico costados largos en móvil)
    const obliquity = Math.min(2.6, 1 / z);
    const pitchCam = visor360.getPitch();
    const pitchScale = 1 + Math.min(Math.abs(pitch - pitchCam) / 75, 1) * 0.18;
    return halfW * fovScale * obliquity * pitchScale;
}
function pushPanoramaAlongScreenNormal(edgePY, nx, ny, offsetPx, proj) {
    const pSc = proj.toScreen(edgePY[0], edgePY[1]);
    if (!pSc || offsetPx <= 0) return edgePY;
    const len = Math.hypot(nx, ny) || 1;
    const ux = nx / len, uy = ny / len;
    let scale = 1;
    let best = null;
    for (let i = 0; i < 5; i++) {
        const tx = pSc[0] + ux * offsetPx * scale;
        const ty = pSc[1] + uy * offsetPx * scale;
        const py = proj.toPY(tx, ty);
        if (!py) break;
        const chk = proj.toScreen(py[0], py[1]);
        if (!chk) { best = py; break; }
        const actual = Math.hypot(chk[0] - pSc[0], chk[1] - pSc[1]);
        if (actual >= offsetPx * 0.97) return py;
        scale *= offsetPx / Math.max(actual, 0.001);
        best = py;
    }
    return best || edgePY;
}
function snapCalleToFranjaParallelEdge(clientX, clientY, anchoFactor) {
    const proj = getPanoramaScreenProjector();
    if (!proj || !visor360) return null;
    const sx = clientX - DOMCache.viewport.left;
    const sy = clientY - DOMCache.viewport.top;
    const SNAP_PX = 52;
    let best = null;
    getAllStripSnapTargets().forEach(r => {
        const cx = (r.tl[0] + r.tr[0] + r.br[0] + r.bl[0]) / 4;
        const cy = (r.tl[1] + r.tr[1] + r.br[1] + r.bl[1]) / 4;
        let edges;
        if (r.grp?.puntos?.length >= 4) {
            const [TL, TR, BR, BL] = r.grp.puntos;
            edges = [[TL, TR], [TR, BR], [BR, BL], [BL, TL]];
        } else {
            edges = [[r.tl, r.tr], [r.tr, r.br], [r.br, r.bl], [r.bl, r.tl]].map(([a, b]) => {
                const aPy = proj.toPY(a[0], a[1]);
                const bPy = proj.toPY(b[0], b[1]);
                return aPy && bPy ? [aPy, bPy] : null;
            }).filter(Boolean);
        }
        edges.forEach(([aPY, bPY]) => {
            const aSc = proj.toScreen(aPY[0], aPY[1]);
            const bSc = proj.toScreen(bPY[0], bPY[1]);
            if (!aSc || !bSc) return;
            const ax = aSc[0], ay = aSc[1], bx = bSc[0], by = bSc[1];
            const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
            if (len < 2) return;
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            let nx = -dy / len, ny = dx / len;
            if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
            let t = ((sx - ax) * dx + (sy - ay) * dy) / (len * len);
            t = Math.max(0, Math.min(1, t));
            const px = ax + t * dx, py = ay + t * dy;
            const dist = Math.hypot(sx - px, sy - py);
            if (dist > SNAP_PX) return;
            const edgePY = lerpPY(aPY, bPY, t);
            const offsetPx = computeCalleSnapOffsetPx(edgePY[0], edgePY[1], anchoFactor, visor360);
            const pushed = pushPanoramaAlongScreenNormal(edgePY, nx, ny, offsetPx, proj);
            if (pushed && (!best || dist < best.dist)) {
                best = {
                    dist,
                    pitch: parseFloat(pushed[0].toFixed(3)),
                    yaw: parseFloat(pushed[1].toFixed(3))
                };
            }
        });
    });
    return best;
}
function tryMergeCallesAtAnchor(newId) {
    const line = allDrawnLines.find(l => l.id === newId);
    if (!line || line.tipo !== 'calle' || line.puntos.length < 2) return false;
    const tol = SNAP_DISTANCE * 0.85;
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (let i = 0; i < allDrawnLines.length; i++) {
        const other = allDrawnLines[i];
        if (other.tipo !== 'calle' || other.id === newId) continue;
        const s = line.puntos[0], e = line.puntos[line.puntos.length - 1];
        const os = other.puntos[0], oe = other.puntos[other.puntos.length - 1];
        const merge = (pts, anchoOther) => {
            line.puntos = pts;
            line.calleAncho = ((line.calleAncho || draftCalleAncho) + (anchoOther || 2.2)) / 2;
            allDrawnLines = allDrawnLines.filter(l => l.id !== other.id);
            return true;
        };
        if (d(e, os) < tol) return merge([...line.puntos, ...other.puntos.slice(1)], other.calleAncho);
        if (d(e, oe) < tol) return merge([...line.puntos, ...other.puntos.slice(0, -1).reverse()], other.calleAncho);
        if (d(s, oe) < tol) return merge([...other.puntos, ...line.puntos.slice(1)], other.calleAncho);
        if (d(s, os) < tol) return merge([...other.puntos.slice().reverse(), ...line.puntos.slice(1)], other.calleAncho);
    }
    return false;
}
function updateDrawModeSnap(mock, coords) {
    let foundSnap = false;
    snappedCoords = null;
    isSnapToClose = false;
    calleSnapIsFranjaEdge = false;
    let devEdgeSnap = null;
    if (!coords || !snapCursor) return;
    if (currentLineType === 'calle') {
        if (draftCalleSnapFranja && !isNearFranjaCornerScreen(mock.clientX, mock.clientY, 32)) {
            const edgeSnap = snapCalleToFranjaParallelEdge(mock.clientX, mock.clientY, draftCalleAncho);
            if (edgeSnap) {
                foundSnap = true;
                snappedCoords = [edgeSnap.pitch, edgeSnap.yaw];
                calleSnapIsFranjaEdge = true;
            }
        }
        if (!foundSnap && currentLinePoints.length > 0) {
            const last = currentLinePoints[currentLinePoints.length - 1];
            const d = Math.hypot(last[0] - coords[0], last[1] - coords[1]);
            if (d < SNAP_DISTANCE * 0.65) {
                foundSnap = true;
                snappedCoords = [...last];
                isSnapToClose = true;
            }
        }
    } else {
        if (isDevModeDrawActive && currentLineType !== 'cortar' && currentLineType !== 'eraser') {
            devEdgeSnap = arq2_findNearestEdgeOrVertex(mock.clientX, mock.clientY, currentTempLineId, 15);
            if (devEdgeSnap) {
                foundSnap = true;
                snappedCoords = [devEdgeSnap.pitch, devEdgeSnap.yaw];
            }
        }
        if (currentLinePoints.length >= 3 && currentLineType !== 'cortar' && currentLineType !== 'eraser' && currentLineType !== 'divisoria' && currentLineType !== 'franja') {
            const nearOrigin = isNearPolygonOriginPY(coords[0], coords[1], currentLinePoints[0]);
            if (nearOrigin && canTriggerPolygonAutoClose()) { foundSnap = true; snappedCoords = [...currentLinePoints[0]]; isSnapToClose = true; }
        }
        if (!foundSnap) {
            const allPts = [...currentLinePoints];
            allDrawnLines.forEach(l => {
                if (isFranjaBoundLine(l)) return;
                const snapPts = arq2_getSnapPolylinePoints(l);
                allPts.push(...(snapPts.length ? snapPts : (l.puntos || [])));
            });
            for (const pt of allPts) {
                const dist = Math.hypot(pt[0] - coords[0], pt[1] - coords[1]);
                if (dist < SNAP_DISTANCE) { foundSnap = true; snappedCoords = [...pt]; break; }
            }
        }
    }
    if (foundSnap) {
        const edgeSnapScreen = (isDevModeDrawActive && devEdgeSnap) ? devEdgeSnap : null;
        snapCursor.style.left = (edgeSnapScreen?.screenX ?? mock.clientX) + 'px';
        snapCursor.style.top = (edgeSnapScreen?.screenY ?? mock.clientY) + 'px';
        snapCursor.classList.add('active');
        snapCursor.classList.toggle('is-costura', !!edgeSnapScreen);
        snapCursor.classList.toggle('is-closing', isSnapToClose && currentLineType !== 'calle');
        snapCursor.classList.toggle('is-calle-finish', isSnapToClose && currentLineType === 'calle');
        snapCursor.classList.toggle('is-calle-edge', calleSnapIsFranjaEdge);
    } else {
        snapCursor.classList.remove('active', 'is-closing', 'is-calle-edge', 'is-calle-finish', 'is-costura');
    }
    updateCloseOriginHighlight(isSnapToClose && currentLineType !== 'calle');
}
function handleCalleDrawClick(mock) {
    const coords = visor360.mouseEventToCoords(mock);
    if (!coords) return;
    let p = coords[0], y = coords[1];
    if (draftCalleSnapFranja && snappedCoords && !isNearFranjaCornerScreen(mock.clientX, mock.clientY, 32)) {
        p = snappedCoords[0]; y = snappedCoords[1];
    }
    if (isSnapToClose && currentLinePoints.length >= 2) {
        finishCalleDrawing();
        lastCalleTap = null;
        return;
    }
    const now = Date.now();
    if (lastCalleTap && now - lastCalleTap.time < 450 && Math.hypot(mock.clientX - lastCalleTap.x, mock.clientY - lastCalleTap.y) < 28) {
        if (currentLinePoints.length >= 2) {
            finishCalleDrawing();
            lastCalleTap = null;
            return;
        }
    }
    lastCalleTap = { x: mock.clientX, y: mock.clientY, time: now, p, y };
    currentLinePoints.push([p, y]);
    const _hid = 'temp_base_pt_' + Date.now();
    visor360.addHotSpot({ pitch: p, yaw: y, id: _hid, createTooltipFunc: renderHiddenVertex, createTooltipArgs: { lineId: currentTempLineId, type: 'calle', isGuide: true, idx: currentLinePoints.length - 1, hsId: _hid } });
    syncSVGElements();
    updateSVGPaths();
    syncCallePanelUI();
    refreshAllHotspots(true);
}
function getAllStripSnapTargets() {
    const targets = getFranjaGrupoScreenRects();
    const orphanFills = allDrawnLines.filter(l => l.tipo === 'area-invisible' && !l.franjaGrupo);
    if (!orphanFills.length) return targets;
    const proj = getPanoramaScreenProjector();
    if (!proj) return targets;
    const sc = [];
    orphanFills.forEach(l => l.puntos.forEach(p => { const s = proj.toScreen(p[0], p[1]); if (s) sc.push(s); }));
    if (sc.length < 4) return targets;
    const left = Math.min(...sc.map(s => s[0])), right = Math.max(...sc.map(s => s[0]));
    const top = Math.min(...sc.map(s => s[1])), bottom = Math.max(...sc.map(s => s[1]));
    targets.push({
        gid: '__orphan_macro__', grp: null, orphan: true, fills: orphanFills,
        left, right, top, bottom,
        tl: [left, top], tr: [right, top], br: [right, bottom], bl: [left, bottom]
    });
    return targets;
}
function resolveOrphanToFranjaGid(target) {
    if (!target?.orphan || !target.fills?.length) return target?.gid || null;
    const orphanIds = new Set(target.fills.map(f => f.id));
    const linked = allDrawnLines.find(l => (l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo') &&
        allDrawnLines.some(c => c.franjaGrupo === l.id && orphanIds.has(c.id)));
    if (linked) return linked.id;
    promoteClusterToFranja([...target.fills]);
    return allDrawnLines.filter(l => l.tipo === 'franja-grupo' || l.tipo === 'franja-curva-grupo').slice(-1)[0]?.id || null;
}
function snapFranjaScreenRect(ax, ay, bx, by, opts) {
    const forceExtend = opts?.forceExtend === true;
    const SNAP = 52;
    let x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const targets = getAllStripSnapTargets();
    if (!targets.length) return { x1, x2, y1, y2, gapFill: false, gapFillH: false };
    let gapFillH = false, leftGid = null, rightGid = null, leftTarget = null, rightTarget = null;
    const sortedRow = [...targets].sort((a, b) => a.left - b.left);
    const rowAligned = (strip) => rectsSameHeight({ top: y1, bottom: y2 }, strip, SNAP * 2.5)
        || (y1 <= strip.top + SNAP * 2 && y2 >= strip.bottom - SNAP * 2)
        || Math.abs(cy - (strip.top + strip.bottom) / 2) < (strip.bottom - strip.top) * 0.45;
    for (let i = 0; i < sortedRow.length - 1; i++) {
        const left = sortedRow[i], right = sortedRow[i + 1];
        if (left.gid === right.gid) continue;
        const gapW = right.left - left.right;
        if (gapW <= 3 || gapW >= 600) continue;
        if (!rectsSameHeight(left, right, SNAP * 2) || !rowAligned(left)) continue;
        const centerInGap = cx >= left.right - SNAP && cx <= right.left + SNAP;
        const crossesGap = x1 <= left.right + SNAP * 1.5 && x2 >= right.left - SNAP * 1.5;
        if (centerInGap || crossesGap) {
            y1 = left.top; y2 = left.bottom; x1 = left.right; x2 = right.left;
            gapFillH = true;
            leftTarget = left; rightTarget = right;
            leftGid = left.gid === '__orphan_macro__' ? null : left.gid;
            rightGid = right.gid === '__orphan_macro__' ? null : right.gid;
            break;
        }
    }
    if (!gapFillH) {
        for (const strip of sortedRow) {
            if (!rowAligned(strip)) continue;
            const drawsRight = x2 > strip.right + 2 && (x1 >= strip.right - SNAP * 3 || forceExtend);
            const centerOnStrip = cx >= strip.left && cx <= strip.right + 500;
            if (!drawsRight && !(forceExtend && centerOnStrip)) continue;
            const rawX2 = Math.max(x2, ax, bx);
            const lotN = strip.grp?.franjaCount || strip.fills?.length || 9;
            const lotW = (strip.right - strip.left) / Math.max(1, lotN);
            y1 = strip.top; y2 = strip.bottom; x1 = strip.right;
            x2 = rawX2 > x1 + 8 ? rawX2 : x1 + lotW * 1.4;
            gapFillH = true;
            leftTarget = strip;
            leftGid = strip.gid === '__orphan_macro__' ? null : strip.gid;
            break;
        }
    }
    let gapFill = false, upperGid = null, lowerGid = null, upper = null, lower = null;
    if (!gapFillH) {
        let bestCol = null, bestColD = SNAP * 5;
        targets.forEach(t => {
            const dc = Math.abs(cx - (t.left + t.right) / 2);
            if (dc < bestColD) { bestColD = dc; bestCol = t; }
        });
        if (bestCol && bestColD < SNAP * 3) { x1 = bestCol.left; x2 = bestCol.right; }
        const colTargets = targets.filter(t => rectsSameWidth({ left: x1, right: x2 }, t, SNAP * 2));
        const sortedCol = [...colTargets].sort((a, b) => a.top - b.top);
        for (let i = 0; i < sortedCol.length - 1; i++) {
            const u = sortedCol[i], l = sortedCol[i + 1];
            if (u.gid === l.gid) continue;
            const gapH = l.top - u.bottom;
            if (gapH <= 3 || gapH >= 600) continue;
            const centerInGap = cy >= u.bottom - SNAP && cy <= l.top + SNAP;
            const crossesGap = y1 <= u.bottom + SNAP * 1.5 && y2 >= l.top - SNAP * 1.5;
            if (centerInGap || crossesGap) {
                upper = u; lower = l;
                y1 = u.bottom; y2 = l.top; x1 = u.left; x2 = u.right;
                gapFill = true;
                upperGid = u.gid === '__orphan_macro__' ? null : u.gid;
                lowerGid = l.gid === '__orphan_macro__' ? null : l.gid;
                break;
            }
        }
        if (!gapFill) {
            colTargets.forEach(t => {
                if (t.bottom <= cy + SNAP * 1.5 && (!upper || t.bottom > upper.bottom)) upper = t;
                if (t.top >= cy - SNAP * 1.5 && (!lower || t.top < lower.top)) lower = t;
            });
        }
        if (!gapFill) {
            const near = (v, t) => Math.abs(v - t) < SNAP;
            const snapVal = (v, edges) => {
                let best = v, bd = SNAP;
                edges.forEach(e => { const d = Math.abs(v - e); if (d < bd) { bd = d; best = e; } });
                return best;
            };
            const allX = [], allY = [];
            colTargets.forEach(r => { allX.push(r.left, r.right); allY.push(r.top, r.bottom); });
            x1 = snapVal(x1, allX); x2 = snapVal(x2, allX); y1 = snapVal(y1, allY); y2 = snapVal(y2, allY);
            colTargets.forEach(r => {
                if (near(x1, r.left) && near(x2, r.right)) { x1 = r.left; x2 = r.right; }
                if (near(y1, r.bottom)) { y1 = r.bottom; if (r.gid !== '__orphan_macro__') upperGid = r.gid; }
                if (near(y2, r.top)) { y2 = r.top; if (r.gid !== '__orphan_macro__') lowerGid = r.gid; }
            });
        }
    }
    return { x1, x2, y1, y2, gapFill, gapFillH, upperGid, lowerGid, leftGid, rightGid, upperTarget: upper, lowerTarget: lower, leftTarget, rightTarget };
}
function buildFranjaScreenPointsSnapped(ax, ay, bx, by, N, opts, customSplits) {
    const s = snapFranjaScreenRect(ax, ay, bx, by, opts);
    if (s.gapFillH) {
        const tl = screenPointToPanorama(s.x1, s.y1), tr = screenPointToPanorama(s.x2, s.y1);
        const br = screenPointToPanorama(s.x2, s.y2), bl = screenPointToPanorama(s.x1, s.y2);
        if (!tl || !tr || !br || !bl) return null;
        return { topPts: [tl, tr], botPts: [bl, br], snap: s, extendQuad: [tl, tr, br, bl] };
    }
    const ts = getFranjaSplitTs(N, customSplits);
    const topPts = [], botPts = [];
    for (let i = 0; i <= N; i++) {
        const sx = s.x1 + (s.x2 - s.x1) * ts[i];
        const tp = screenPointToPanorama(sx, s.y1), bp = screenPointToPanorama(sx, s.y2);
        if (!tp || !bp) return null;
        topPts.push(tp); botPts.push(bp);
    }
    return { topPts, botPts, snap: s, splits: ts };
}
function edgeMatchesLine(p1, p2, q1, q2, tol) {
    const d11 = Math.hypot(p1[0]-q1[0], p1[1]-q1[1]), d22 = Math.hypot(p2[0]-q2[0], p2[1]-q2[1]);
    const d12 = Math.hypot(p1[0]-q2[0], p1[1]-q2[1]), d21 = Math.hypot(p2[0]-q1[0], p2[1]-q1[1]);
    return (d11 < tol && d22 < tol) || (d12 < tol && d21 < tol);
}
function getScreenOverlapY(a, b) {
    const top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
    return bottom - top >= 10 ? { top, bottom, height: bottom - top } : null;
}

function applyStitchToSharedEdge(gid1, gid2, p1, p2, i, j) {
    const tol = 0.18;
    allDrawnLines = allDrawnLines.filter(l => {
        if (!l.franjaGrupo || l.tipo !== 'borde-macro') return true;
        if (l.franjaGrupo !== gid1 && l.franjaGrupo !== gid2) return true;
        if (l.puntos.length < 2) return true;
        return !edgeMatchesLine(l.puntos[0], l.puntos[1], p1, p2, tol);
    });
    allDrawnLines = allDrawnLines.filter(l => {
        if (l.tipo !== 'divisoria' || l.puntos?.length < 2) return true;
        if (l.franjaGrupo !== gid1 && l.franjaGrupo !== gid2 && !l.franjaStitch) return true;
        return !edgeMatchesLine(l.puntos[0], l.puntos[1], p1, p2, tol);
    });
    const exists = allDrawnLines.some(l => l.tipo === 'divisoria' && l.puntos.length >= 2 &&
        edgeMatchesLine(l.puntos[0], l.puntos[1], p1, p2, tol));
    if (!exists) {
        allDrawnLines.push({
            id: 'div_stitch_' + Date.now() + '_' + i + '_' + j + Math.floor(Math.random()*100),
            tipo: 'divisoria', puntos: [p1.map(v => v), p2.map(v => v)],
            franjaGrupo: gid1, franjaStitch: gid2, franjaSeam: true
        });
    }
}

function ensureStitchedDivisorias() {
    const rects = getFranjaGrupoScreenRects();
    if (rects.length >= 2) {
        const SNAP = 48;
        const proj = getPanoramaScreenProjector();
        if (proj) {
            for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                    const a = rects[i], b = rects[j];
                    const ovlX = getScreenOverlapX(a, b);
                    if (ovlX) {
                        let upper = null, lower = null, seamY = null;
                        if (Math.abs(a.bottom - b.top) < SNAP) { upper = a; lower = b; seamY = (a.bottom + b.top) * 0.5; }
                        else if (Math.abs(b.bottom - a.top) < SNAP) { upper = b; lower = a; seamY = (b.bottom + a.top) * 0.5; }
                        if (upper && lower && seamY !== null) {
                            const p1 = proj.toPY(ovlX.left, seamY), p2 = proj.toPY(ovlX.right, seamY);
                            if (p1 && p2) applyStitchToSharedEdge(upper.gid, lower.gid, p1, p2, i, j);
                        }
                    }
                }
            }
        }
    }
    
    // Pass 2: Exact matching borders across ANY two different franjas (Handles sides automatically)
    const tol = 0.35;
    const toDelete = new Set();
    const newDivs = [];
    const borders = allDrawnLines.filter(l => l.tipo === 'borde-macro' && l.franjaGrupo);
    
    for (let i = 0; i < borders.length; i++) {
        for (let j = i + 1; j < borders.length; j++) {
            const b1 = borders[i];
            const b2 = borders[j];
            if (b1.franjaGrupo === b2.franjaGrupo) continue;
            
            if (b1.puntos.length >= 2 && b2.puntos.length >= 2) {
                if (edgeMatchesLine(b1.puntos[0], b1.puntos[1], b2.puntos[0], b2.puntos[1], tol)) {
                    toDelete.add(b1.id);
                    toDelete.add(b2.id);
                    const exists = allDrawnLines.some(l => l.tipo === 'divisoria' && l.puntos.length >= 2 && edgeMatchesLine(l.puntos[0], l.puntos[1], b1.puntos[0], b1.puntos[1], tol));
                    if (!exists && !newDivs.some(d => edgeMatchesLine(d.puntos[0], d.puntos[1], b1.puntos[0], b1.puntos[1], tol))) {
                        newDivs.push({
                            id: 'div_stitch_exact_' + Date.now() + '_' + i + '_' + j,
                            tipo: 'divisoria', puntos: [b1.puntos[0].map(v => v), b1.puntos[1].map(v => v)],
                            franjaGrupo: b1.franjaGrupo, franjaStitch: b2.franjaGrupo, franjaSeam: true
                        });
                    }
                }
            }
        }
    }
    
    if (toDelete.size > 0) {
        allDrawnLines = allDrawnLines.filter(l => !toDelete.has(l.id));
        allDrawnLines.push(...newDivs);
    }
}
function mergeVerticalFranjaChain(gids) {
    const unique = [...new Set(gids.filter(Boolean))];
    if (unique.length < 2) return false;
    unique.forEach(id => normalizeFranjaStripToRect(id));
    const strips = unique.map(id => allDrawnLines.find(l => l.id === id && l.tipo === 'franja-grupo')).filter(Boolean);
    if (strips.length < 2) return false;
    const proj = getPanoramaScreenProjector();
    if (!proj) return false;
    const metas = strips.map(s => {
        const r = getFranjaGrupoScreenRects().find(x => x.gid === s.id);
        return { s, r, n: s.franjaCount || 1, h: r ? r.bottom - r.top : 1 };
    }).filter(m => m.r);
    if (metas.length < 2) return false;
    metas.sort((a, b) => a.r.top - b.r.top);
    const allSingle = metas.every(m => m.n === 1);
    const keep = metas[0].s;
    const totalH = metas.reduce((sum, m) => sum + m.h, 0);
    const splits = [0];
    let acc = 0;
    for (let i = 0; i < metas.length - 1; i++) {
        acc += metas[i].h;
        splits.push(acc / totalH);
    }
    splits.push(1);
    const topR = metas[0].r, botR = metas[metas.length - 1].r;
    const nTL = proj.toPY(topR.tl[0], topR.tl[1]), nTR = proj.toPY(topR.tr[0], topR.tr[1]);
    const nBR = proj.toPY(botR.br[0], botR.br[1]), nBL = proj.toPY(botR.bl[0], botR.bl[1]);
    if (!nTL || !nTR || !nBR || !nBL) return false;
    metas.slice(1).forEach(m => {
        allDrawnLines = allDrawnLines.filter(l => l.franjaGrupo !== m.s.id && l.id !== m.s.id);
    });
    keep.puntos = [nTL, nTR, nBR, nBL];
    keep.franjaCount = allSingle ? metas.length : metas.reduce((sum, m) => sum + m.n, 0);
    keep.franjaSplits = splits.length === keep.franjaCount + 1 ? splits : Array.from({ length: keep.franjaCount + 1 }, (_, i) => i / keep.franjaCount);
    rebuildFranjaGroup(keep.id);
    ensureStitchedDivisorias();
    return true;
}
function tryMergeVerticalHilera(triggerGid, snap) {
    let upperGid = snap?.upperGid, lowerGid = snap?.lowerGid;
    if (snap?.upperTarget?.orphan) upperGid = resolveOrphanToFranjaGid(snap.upperTarget) || upperGid;
    if (snap?.lowerTarget?.orphan) lowerGid = resolveOrphanToFranjaGid(snap.lowerTarget) || lowerGid;
    const rects = getFranjaGrupoScreenRects();
    const trigger = rects.find(r => r.gid === triggerGid);
    if (!trigger) return false;
    const chain = rects.filter(r => rectsSameWidth(r, trigger, 55)).sort((a, b) => a.top - b.top);
    if (chain.length < 2) return false;
    if (snap?.gapFill) {
        const ids = [upperGid, triggerGid, lowerGid].filter((id, i, arr) => id && arr.indexOf(id) === i);
        if (ids.length >= 2 && mergeVerticalFranjaChain(ids)) return true;
    }
    let touching = [chain[0].gid];
    for (let i = 1; i < chain.length; i++) {
        if (chain[i].top - chain[i - 1].bottom < 55) touching.push(chain[i].gid);
        else break;
    }
    for (let i = 0; i < chain.length; i++) {
        if (chain[i].gid === triggerGid) {
            const start = Math.max(0, i - 1), end = Math.min(chain.length, i + 2);
            const slice = chain.slice(start, end);
            if (slice.length >= 2 && slice.every((r, idx) => idx === 0 || r.top - slice[idx - 1].bottom < 80)) {
                return mergeVerticalFranjaChain(slice.map(r => r.gid));
            }
        }
    }
    return mergeVerticalFranjaChain(touching.length >= 2 ? touching : chain.map(r => r.gid));
}
function mergeFranjasHorizontal(keepGid, mergeGid, mergeOnLeft) {
    normalizeFranjaStripToRect(keepGid);
    normalizeFranjaStripToRect(mergeGid);
    const keep = allDrawnLines.find(l => l.id === keepGid && l.tipo === 'franja-grupo');
    const merge = allDrawnLines.find(l => l.id === mergeGid && l.tipo === 'franja-grupo');
    if (!keep || !merge) return false;
    const nK = keep.franjaCount || 1, nM = merge.franjaCount || 1;
    const [kTL, kTR, kBR, kBL] = keep.puntos, [mTL, mTR, mBR, mBL] = merge.puntos;
    if (mergeOnLeft) {
        keep.puntos = [mTL, kTR, kBR, mBL].map(p => [...p]);
        keep.franjaSplits = [...(merge.franjaSplits || ensureFranjaSplits(merge)), ...(keep.franjaSplits || ensureFranjaSplits(keep)).slice(1)];
    } else {
        keep.puntos = [kTL, mTR, mBR, kBL].map(p => [...p]);
        keep.franjaSplits = [...(keep.franjaSplits || ensureFranjaSplits(keep)), ...(merge.franjaSplits || ensureFranjaSplits(merge)).slice(1)];
    }
    const total = nK + nM;
    if (keep.franjaSplits.length !== total + 1) keep.franjaSplits = Array.from({ length: total + 1 }, (_, i) => i / total);
    keep.franjaCount = total;
    allDrawnLines = allDrawnLines.filter(l => l.franjaGrupo !== mergeGid && l.id !== mergeGid);
    rebuildFranjaGroup(keepGid);
    ensureStitchedDivisorias();
    return true;
}
function tryMergeFranjaHorizontal(newGid) {
    const newG = getFranjaStripById(newGid);
    if (!newG || newG.tipo === 'franja-curva-grupo') return false;
    const proj = getPanoramaScreenProjector();
    if (!proj) return false;
    const nr = getFranjaGrupoScreenRects().find(r => r.gid === newGid);
    if (!nr) return false;
    for (const or of getFranjaGrupoScreenRects()) {
        if (or.gid === newGid) continue;
        const sameHeight = Math.abs(nr.top - or.top) < 24 && Math.abs(nr.bottom - or.bottom) < 24;
        if (!sameHeight) continue;
        if (Math.abs(nr.right - or.left) < 24) {
            if (mergeFranjasHorizontal(or.gid, newGid, true)) return true;
        }
        if (Math.abs(nr.left - or.right) < 24) {
            if (mergeFranjasHorizontal(or.gid, newGid, false)) return true;
        }
    }
    return false;
}
function alignFranjaVerticalNeighbors(gid) {
    const grp = getFranjaStripById(gid);
    const proj = getPanoramaScreenProjector();
    if (!grp || !proj) return;
    const nr = getFranjaGrupoScreenRects().find(r => r.gid === gid);
    if (!nr) return;
    const rebuildStrip = () => {
        if (grp.tipo === 'franja-curva-grupo') rebuildFranjaCurvaGroup(gid);
        else rebuildFranjaGroup(gid);
    };
    getFranjaGrupoScreenRects().forEach(or => {
        if (or.gid === gid) return;
        const sameWidth = Math.abs(nr.left - or.left) < 24 && Math.abs(nr.right - or.right) < 24;
        if (!sameWidth) return;
        if (Math.abs(nr.top - or.bottom) < 24) {
            const nTL = proj.toPY(or.bl[0], or.bottom), nTR = proj.toPY(or.br[0], or.bottom);
            if (nTL && nTR) {
                if (grp.tipo === 'franja-curva-grupo') {
                    grp.frente[0] = nTL; grp.frente[grp.frente.length - 1] = nTR;
                } else {
                    grp.puntos[0] = nTL; grp.puntos[1] = nTR;
                }
                rebuildStrip();
            }
        } else if (Math.abs(nr.bottom - or.top) < 24) {
            const nBL = proj.toPY(or.tl[0], or.top), nBR = proj.toPY(or.tr[0], or.top);
            if (nBL && nBR) {
                if (grp.tipo === 'franja-curva-grupo') {
                    grp.fondo[0] = nBL; grp.fondo[grp.fondo.length - 1] = nBR;
                } else {
                    grp.puntos[2] = nBR; grp.puntos[3] = nBL;
                }
                rebuildStrip();
            }
        }
    });
}
function extendFranjaHorizontal(stripGid, snap) {
    const grp = allDrawnLines.find(l => l.id === stripGid && l.tipo === 'franja-grupo');
    const proj = getPanoramaScreenProjector();
    if (!grp || !proj || !snap?.gapFillH || snap.rightTarget) return false;
    const [TL, TR, BR, BL] = grp.puntos;
    const tlSc = proj.toScreen(TL[0], TL[1]), trSc = proj.toScreen(TR[0], TR[1]);
    if (!tlSc || !trSc) return false;
    const oldTopLen = Math.hypot(trSc[0] - tlSc[0], trSc[1] - tlSc[1]);
    const newTR = proj.toPY(snap.x2, snap.y1), newBR = proj.toPY(snap.x2, snap.y2);
    const newTRsc = newTR && proj.toScreen(newTR[0], newTR[1]);
    if (!newTR || !newBR || !newTRsc) return false;
    const newTopLen = Math.hypot(newTRsc[0] - tlSc[0], newTRsc[1] - tlSc[1]);
    if (newTopLen <= oldTopLen + 0.001) return false;
    const tSplit = Math.min(0.985, Math.max(0.015, oldTopLen / newTopLen));
    const splits = [...ensureFranjaSplits(grp)];
    splits[splits.length - 1] = tSplit;
    splits.push(1);
    grp.puntos = [TL.map(v => v), newTR.map(v => v), newBR.map(v => v), BL.map(v => v)];
    grp.franjaCount = (grp.franjaCount || splits.length - 2) + 1;
    grp.franjaSplits = splits;
    rebuildFranjaGroup(stripGid);
    return true;
}
function finalizeExtendFranja(snap) {
    if (!snap?.gapFillH) return null;
    let stripGid = snap.leftGid;
    if (snap.leftTarget?.orphan) stripGid = resolveOrphanToFranjaGid(snap.leftTarget) || stripGid;
    if (snap.rightTarget) {
        if (snap.rightTarget.orphan) resolveOrphanToFranjaGid(snap.rightTarget);
        const tl = screenPointToPanorama(snap.x1, snap.y1), tr = screenPointToPanorama(snap.x2, snap.y1);
        const br = screenPointToPanorama(snap.x2, snap.y2), bl = screenPointToPanorama(snap.x1, snap.y2);
        if (!tl || !tr || !br || !bl) return null;
        const gid = finalizeNewFranja([tl, tr], [bl, br], 1, snap);
        if (!gid || !stripGid) return gid;
        const newG = allDrawnLines.find(l => l.id === gid);
        if (newG && tryMergeFranjaHorizontal(newG.id)) return gid;
        if (mergeFranjasHorizontal(stripGid, gid, false)) return stripGid;
        straightenFranjaGroup(stripGid);
        return gid;
    }
    if (!stripGid) return null;
    if (extendFranjaHorizontal(stripGid, snap)) {
        ensureStitchedDivisorias();
        document.body.classList.add('auto-macro-active');
        return stripGid;
    }
    return null;
}
function finalizeNewFranja(topPts, botPts, N, snap, customSplits) {
    if (snap?.gapFill && snap.upperTarget?.orphan) snap.upperGid = resolveOrphanToFranjaGid(snap.upperTarget) || snap.upperGid;
    if (snap?.gapFill && snap.lowerTarget?.orphan) snap.lowerGid = resolveOrphanToFranjaGid(snap.lowerTarget) || snap.lowerGid;
    const gid = 'franja_' + Date.now();
    const corners = [topPts[0], topPts[N], botPts[N], botPts[0]].map(p => [...p]);
    const entry = { id: gid, tipo: 'franja-grupo', franjaCount: N, puntos: corners };
    if (customSplits && customSplits.length === N + 1) entry.franjaSplits = customSplits.map(v => v);
    allDrawnLines.push(entry);
    rebuildFranjaGroup(gid);
    if (!tryMergeFranjaHorizontal(gid)) {
        alignFranjaVerticalNeighbors(gid);
        tryMergeVerticalHilera(gid, snap);
    }
    ensureStitchedDivisorias();
    document.body.classList.add('auto-macro-active');
    return gid;
}
function buildFranjaScreenPoints(ax, ay, bx, by, N) {
    const r = buildFranjaScreenPointsSnapped(ax, ay, bx, by, Math.max(1, N));
    return r ? { topPts: r.topPts, botPts: r.botPts, snap: r.snap } : null;
}
function updateFranjaPreview(bx, by) {
    if (!franjaCornerA) { franjaPreviewQuad = null; franjaPreviewDivs = []; return; }
    const raw = buildFranjaScreenPointsSnapped(franjaCornerA.sx, franjaCornerA.sy, bx, by, Math.max(1, franjaDraftCount));
    if (!raw) { franjaPreviewQuad = null; franjaPreviewDivs = []; return; }
    if (raw.snap?.gapFillH && raw.extendQuad) {
        franjaPreviewQuad = raw.extendQuad;
        const midT = screenPointToPanorama(raw.snap.x1, raw.snap.y1);
        const midB = screenPointToPanorama(raw.snap.x1, raw.snap.y2);
        franjaPreviewDivs = midT && midB ? [{ id: 'franja_preview_stitch', tipo: 'franja-preview-div', puntos: [midT, midB] }] : [];
        return;
    }
    const N = raw.snap?.gapFill ? 1 : Math.max(1, franjaDraftCount);
    const built = buildFranjaScreenPointsSnapped(franjaCornerA.sx, franjaCornerA.sy, bx, by, N);
    if (!built) { franjaPreviewQuad = null; franjaPreviewDivs = []; return; }
    franjaPreviewQuad = [built.topPts[0], built.topPts[N], built.botPts[N], built.botPts[0]];
    franjaPreviewDivs = [];
    for (let i = 1; i < N; i++) {
        franjaPreviewDivs.push({ id: 'franja_preview_div_' + i, tipo: 'franja-preview-div', puntos: [built.topPts[i], built.botPts[i]] });
    }
}
function renderFranjaModalScalePreview() {
    const bar = document.getElementById('franja-modal-scale-preview');
    if (!bar) return;
    const weights = getFranjaModalWeights();
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    bar.innerHTML = '';
    weights.forEach((w, i) => {
        const seg = document.createElement('div');
        seg.className = 'franja-scale-seg';
        seg.style.flex = String(Math.max(0.001, w / total));
        seg.style.opacity = String(0.45 + (w / Math.max(...weights)) * 0.55);
        seg.textContent = String(i + 1).padStart(2, '0');
        bar.appendChild(seg);
    });
}
function getFranjaModalWeights() {
    return [...document.querySelectorAll('#franja-modal-rows .franja-weight-input')].map(inp => parseFloat(inp.value.replace(',', '.')) || franjaDraftBaseM2);
}
function renderFranjaModalRows(n, prevWeights) {
    const rows = document.getElementById('franja-modal-rows');
    if (!rows) return;
    n = Math.max(1, Math.min(40, n));
    rows.innerHTML = '';
    for (let i = 0; i < n; i++) {
        const val = prevWeights?.[i] ?? (i === n - 1 && prevWeights?.length === n - 1 ? franjaDraftBaseM2 * 1.4 : franjaDraftBaseM2);
        const row = document.createElement('div');
        row.className = 'franja-weight-row';
        row.innerHTML = `<label>Lote ${String(i + 1).padStart(2, '0')}</label><input type="number" class="franja-weight-input" min="1" step="100" value="${Math.round(val)}"><span>m²</span>`;
        row.querySelector('input').addEventListener('input', renderFranjaModalScalePreview);
        rows.appendChild(row);
    }
    renderFranjaModalScalePreview();
}
function openFranjaLotesModal(defaultN, onConfirm) {
    const modal = document.getElementById('franja-lotes-modal');
    const countIn = document.getElementById('franja-modal-count');
    if (!modal || !countIn) return;
    countIn.value = defaultN;
    renderFranjaModalRows(defaultN);
    modal.dataset.onConfirm = '1';
    modal._franjaConfirm = onConfirm;
    const titleEl = modal.querySelector('h3');
    const hintEl = modal.querySelector('.franja-modal-hint');
    const confirmBtn = document.getElementById('franja-modal-confirm');
    if (arq2PendingFila?.contorno) {
        if (titleEl) titleEl.textContent = '〰️ Fila Variable — lotes y m²';
        if (hintEl) hintEl.textContent = 'Indica cuántos lotes quieres dentro del contorno y el m² de cada uno. Las divisiones internas serán proporcionales al área.';
        if (confirmBtn) confirmBtn.textContent = 'Generar hilera';
    } else {
        if (titleEl) titleEl.textContent = '🏘️ Franja de Lotes';
        if (hintEl) hintEl.textContent = 'Indica cuántos lotes y el tamaño de cada uno en m². El ancho en el mapa será proporcional (ej. 7000 m² = 40% más ancho que 5000 m²).';
        if (confirmBtn) confirmBtn.textContent = 'Crear franja';
    }
    modal.classList.add('open');
}
function closeFranjaLotesModal() {
    const modal = document.getElementById('franja-lotes-modal');
    if (modal) { modal.classList.remove('open'); modal._franjaConfirm = null; }
    if (arq2PendingFila?.contorno) { arq2PendingFila = null; arq2FilaVariableContorno = null; }
    franjaPendingCreate = null;
}
function commitFranjaFromModal() {
    const modal = document.getElementById('franja-lotes-modal');
    if (arq2PendingFila?.contorno) {
        const N = Math.max(1, Math.min(40, parseInt(document.getElementById('franja-modal-count')?.value, 10) || 4));
        const weights = getFranjaModalWeights();
        if (weights.length !== N) { alert('⚠️ Actualiza la lista para coincidir.'); return; }
        arq2_commitFilaVariable(weights);
        closeFranjaLotesModal();
        return;
    }
    const pending = franjaPendingCreate;
    const cb = modal?._franjaConfirm;
    if (!pending || !cb) { closeFranjaLotesModal(); return; }
    const N = Math.max(1, Math.min(40, parseInt(document.getElementById('franja-modal-count')?.value, 10) || franjaDraftCount));
    const weights = getFranjaModalWeights();
    if (weights.length !== N) { alert('⚠️ Actualiza la lista para coincidir.'); return; }
    const splits = weightsToFranjaSplits(weights);
    
    franjaDraftCount = N; franjaDraftBaseM2 = Math.round(weights.reduce((a, b) => a + b, 0) / N);
    closeFranjaLotesModal();

    const finalBuilt = buildFranjaScreenPointsSnapped(pending.ax, pending.ay, pending.bx, pending.by, N, null, splits);
    if (!finalBuilt) { alert('⚠️ No se pudo proyectar la franja.'); refreshAllHotspots(); return; }

    if (pending.tipo === 'franja_curva') {
        const gid = 'franja_curva_' + Date.now();
        const ELASTIC_NODES = 7;
        const topPts = resamplePolylineToCount(finalBuilt.topPts, ELASTIC_NODES);
        const botPts = resamplePolylineToCount(finalBuilt.botPts, ELASTIC_NODES);
        allDrawnLines.push({ id: gid, tipo: 'franja-curva-grupo', franjaCount: N, frente: topPts, fondo: botPts, franjaSplits: splits });
        rebuildFranjaCurvaGroup(gid);
        weldFranjaCurvaToNeighbors(gid);
        ensureStitchedDivisorias();
        refreshAllHotspots(); saveToLocal(); flashScreenSuccess();
        return;
    }

    finalizeNewFranja(finalBuilt.topPts, finalBuilt.botPts, N, pending.snap, splits);
    refreshAllHotspots(); saveToLocal(); flashScreenSuccess();
}

function refreshFranjaCurvaPreview() {
    if (currentLineType !== 'franja_curva') { franjaCurvaPreviewStrip = null; return; }
    if (franjaCurvaFase === 2 && franjaCurvaFrente.length >= 2 && currentLinePoints.length >= 2) {
        let fondo = [...currentLinePoints];
        const dDirect = Math.hypot(franjaCurvaFrente[0][0] - fondo[0][0], franjaCurvaFrente[0][1] - fondo[0][1]);
        const dCross = Math.hypot(franjaCurvaFrente[0][0] - fondo[fondo.length - 1][0], franjaCurvaFrente[0][1] - fondo[fondo.length - 1][1]);
        if (dCross < dDirect) fondo.reverse();
        franjaCurvaPreviewStrip = [...franjaCurvaFrente, ...fondo.slice().reverse()];
    } else {
        franjaCurvaPreviewStrip = null;
    }
}

// ========== MODO ARQUITECTO 2.0 (prefijo arq2_) ==========
const ARQ2_STEPS = [
    { tool: 'lote-libre', id: 'corners', text: 'Haz clic SOLO en las esquinas reales del terreno (5-8 clics máx). Evita clics en tramos rectos intermedios.' },
    { tool: 'lote-libre', id: 'curve', text: '¿Ves una curva natural (bosque, quebrada)? Haz varios clics seguidos ahí — se suavizarán solos. En bordes rectos, deja más espacio entre clics.' },
    { tool: 'lote-libre', id: 'close', text: 'Cierra acercándote al círculo blanco inicial, o presiona Enter.' },
    { tool: 'costura', id: 'corners', text: 'Coloca vértices en esquinas reales; el imán cian pegará a bordes vecinos al acercarte.' },
    { tool: 'costura', id: 'curve', text: 'En curvas naturales, varios clics seguidos se suavizan. Esquinas marcadas (<150°) quedan rectas.' },
    { tool: 'costura', id: 'close', text: 'Cierra el polígono; los bordes compartidos quedarán como divisoria punteada.' },
    { tool: 'relleno-auto', id: 'corners', text: 'Marca esquinas reales con pocos clics; al cerrar se numera y marca disponible solo.' },
    { tool: 'relleno-auto', id: 'curve', text: 'Curvas naturales: clics seguidos. Bordes rectos: un clic por esquina, sin puntos intermedios.' },
    { tool: 'relleno-auto', id: 'close', text: 'Enter o clic en el origen — numeración correlativa automática.' },
    { tool: 'fila-variable', id: 'contorno', text: 'Dibuja el contorno COMPLETO de la hilera (todo el terreno junto, como un solo lote grande). Cierra con Enter.' },
    { tool: 'fila-variable', id: 'modal', text: 'Indica cuántos lotes y sus m² en la ventana emergente.' },
    { tool: 'fila-variable', id: 'done', text: 'Listo — las divisiones internas se dibujan solas, proporcionales.' },
    { tool: 'calle-curva-arq2', id: 'draw', text: 'Clics sucesivos sobre el EJE CENTRAL de la calle (centro del camino, no los bordes).' },
    { tool: 'calle-curva-arq2', id: 'finish', text: 'Enter para terminar — curvas suaves automáticas, terminaciones redondeadas.' }
];
function arq2_applyOrganicPathAttrs(pathEl, role) {
    if (!pathEl) return;
    if (role === 'solid') {
        pathEl.setAttribute('fill', 'rgba(16,185,129,0.16)');
        pathEl.setAttribute('fill-opacity', '1');
        pathEl.setAttribute('stroke', '#ffffff');
        pathEl.setAttribute('stroke-width', '2');
        pathEl.style.pointerEvents = 'auto';
        pathEl.style.mixBlendMode = 'normal';
    } else if (role === 'fill') {
        pathEl.setAttribute('fill', 'rgba(16,185,129,0.16)');
        pathEl.setAttribute('fill-opacity', '1');
        pathEl.setAttribute('stroke', 'none');
        pathEl.style.setProperty('stroke', 'none', 'important');
        pathEl.style.pointerEvents = 'auto';
        pathEl.style.mixBlendMode = 'normal';
    } else if (role === 'dash') {
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', '#ffffff');
        pathEl.setAttribute('stroke-width', '2');
        pathEl.setAttribute('stroke-dasharray', '6,6');
        pathEl.style.pointerEvents = 'none';
        pathEl.style.mixBlendMode = 'normal';
    } else if (role === 'shared-solid') {
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', '#ffffff');
        pathEl.setAttribute('stroke-width', '2');
        pathEl.setAttribute('stroke-dasharray', 'none');
        pathEl.style.pointerEvents = 'none';
        pathEl.style.mixBlendMode = 'normal';
    } else if (role === 'perimeter') {
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', '#ffffff');
        pathEl.setAttribute('stroke-width', '2');
        pathEl.setAttribute('stroke-dasharray', 'none');
        pathEl.style.pointerEvents = 'none';
        pathEl.style.mixBlendMode = 'normal';
    } else if (role === 'preview') {
        pathEl.setAttribute('fill', 'rgba(16,185,129,0.10)');
        pathEl.setAttribute('stroke', '#10b981');
        pathEl.setAttribute('stroke-width', '2');
        pathEl.setAttribute('stroke-dasharray', '4 4');
        pathEl.style.pointerEvents = 'none';
    }
}
function arq2_getCameraContext() {
    const container = document.getElementById('panorama-container');
    if (!visor360 || !container) return null;
    const w = container.clientWidth, h = container.clientHeight;
    const cp = visor360.getPitch() * Math.PI / 180, cy = visor360.getYaw() * Math.PI / 180, hfov = visor360.getHfov();
    const sin_cp = Math.sin(cp), cos_cp = Math.cos(cp);
    const f = 0.5 * w / Math.tan(hfov * Math.PI / 360), cx = w / 2, cy_screen = h / 2;
    function getCam(pitch, yaw) {
        const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180, sin_p = Math.sin(p), cos_p = Math.cos(p);
        let y_diff = y - cy; while (y_diff > Math.PI) y_diff -= 2 * Math.PI; while (y_diff < -Math.PI) y_diff += 2 * Math.PI;
        const sin_yd = Math.sin(y_diff), cos_yd = Math.cos(y_diff);
        return { x: cos_p * sin_yd, y: sin_p * cos_cp - cos_p * cos_yd * sin_cp, z: sin_p * sin_cp + cos_p * cos_yd * cos_cp };
    }
    return { getCam, cx, cy_screen, f };
}
function arq2_projectPolylineD(pts, isClosed, getCamFn, cx, cySc, f) {
    if (!pts || pts.length < 2) return '';
    let d = '', hasVisible = false;
    for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        if (!isClosed && i === pts.length - 1) break;
        const c1 = getCamFn(p1[0], p1[1]), c2 = getCamFn(p2[0], p2[1]);
        if (c1.z <= 0.0001 && c2.z <= 0.0001) continue;
        let s1, s2;
        if (c1.z > 0.0001) { s1 = { x: cx + (c1.x / c1.z) * f, y: cySc - (c1.y / c1.z) * f }; hasVisible = true; }
        else { const t = c1.z / (c1.z - c2.z); s1 = { x: cx + ((c1.x + t * (c2.x - c1.x)) / 0.0001) * f, y: cySc - ((c1.y + t * (c2.y - c1.y)) / 0.0001) * f }; }
        if (c2.z > 0.0001) { s2 = { x: cx + (c2.x / c2.z) * f, y: cySc - (c2.y / c2.z) * f }; hasVisible = true; }
        else { const t = c2.z / (c2.z - c1.z); s2 = { x: cx + ((c2.x + t * (c1.x - c2.x)) / 0.0001) * f, y: cySc - ((c2.y + t * (c1.y - c2.y)) / 0.0001) * f }; }
        if (isNaN(s1.x) || isNaN(s1.y) || isNaN(s2.x) || isNaN(s2.y)) {
            console.warn('[Fila Variable] Punto de proyección inválido', { p1, p2, s1, s2 });
            continue;
        }
        if (d === '') d += `M ${s1.x},${s1.y} L ${s2.x},${s2.y} `;
        else { if (c1.z <= 0.0001) d += `M ${s1.x},${s1.y} `; d += `L ${s2.x},${s2.y} `; }
    }
    if (isClosed && d.trim()) d += ' Z';
    return hasVisible ? d : '';
}
function arq2_getActiveDrawPoints() {
    return arq2LinePoints;
}
function arq2_checkInvasion(p1, p2) {
    if (!p1 || !p2) return false;
    for (const line of allDrawnLines) {
        if (line.tipo === 'calle' && line.puntos?.length >= 2) {
            for (let i = 0; i < line.puntos.length - 1; i++) {
                if (intersectSegments(p1, p2, line.puntos[i], line.puntos[i + 1])) return true;
            }
        }
        if (line.tipo === 'borde-macro' && line.puntos?.length >= 3) {
            for (let i = 0; i < line.puntos.length; i++) {
                const a = line.puntos[i], b = line.puntos[(i + 1) % line.puntos.length];
                if (intersectSegments(p1, p2, a, b)) return true;
            }
        }
    }
    return false;
}
function arq2_ensureFeedbackLayer() {
    const svg = document.getElementById('loteo-svg');
    if (!svg || document.getElementById('layer-arq2-feedback')) return;
    const ns = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(ns, 'g');
    layer.id = 'layer-arq2-feedback';
    const band = document.createElementNS(ns, 'path');
    band.id = 'arq2-rubber-band';
    band.setAttribute('d', '');
    const verts = document.createElementNS(ns, 'g');
    verts.id = 'arq2-vertices';
    const magnet = document.createElementNS(ns, 'circle');
    magnet.id = 'arq2-snap-magnet';
    magnet.setAttribute('r', '10');
    magnet.style.display = 'none';
    layer.appendChild(band);
    layer.appendChild(verts);
    const guides = document.createElementNS(ns, 'g');
    guides.id = 'arq2-fila-guides';
    layer.appendChild(guides);
    layer.appendChild(magnet);
    svg.appendChild(layer);
}
function arq2_clearVisualFeedback() {
    document.getElementById('arq2-rubber-band')?.setAttribute('d', '');
    document.getElementById('arq2-rubber-band')?.classList.remove('arq2-invasion-warning');
    const verts = document.getElementById('arq2-vertices');
    if (verts) verts.innerHTML = '';
    const magnet = document.getElementById('arq2-snap-magnet');
    if (magnet) { magnet.style.display = 'none'; magnet.classList.remove('arq2-snap-pulse'); }
    const counter = document.getElementById('arq2-live-counter');
    if (counter) counter.style.display = 'none';
    const tip = document.getElementById('arq2-invasion-tooltip');
    if (tip) tip.style.display = 'none';
    arq2InvasionActive = false;
    const guides = document.getElementById('arq2-fila-guides');
    if (guides) guides.innerHTML = '';
}
function arq2_resolveActiveStepId() {
    const pts = arq2_getActiveDrawPoints();
    if (arq2Tool === 'calle-curva-arq2') {
        if (pts.length === 0) return 'draw';
        return pts.length >= 2 ? 'finish' : 'draw';
    }
    if (arq2Tool === 'fila-variable') {
        if (document.getElementById('franja-lotes-modal')?.classList.contains('open') || arq2PendingFila?.contorno) return 'modal';
        if (pts.length === 0) return 'contorno';
        if (pts.length >= 3) {
            const last = pts[pts.length - 1];
            if (Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < SNAP_DISTANCE * 1.2) return 'contorno';
        }
        return 'contorno';
    }
    const toolKey = arq2Tool === 'relleno-auto' ? 'relleno-auto' : (arq2Tool === 'costura' ? 'costura' : 'lote-libre');
    if (pts.length === 0) return 'corners';
    if (pts.length >= 3) {
        const last = pts[pts.length - 1];
        if (Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < SNAP_DISTANCE * 1.2) return 'close';
    }
    return pts.length >= 2 ? 'curve' : 'corners';
}
function arq2_updatePanelStep() {
    const list = document.getElementById('arq2-steps-list');
    const sem = document.getElementById('arq2-semaphore');
    const smoothRow = document.getElementById('arq2-smooth-row');
    const filaDesc = document.getElementById('arq2-fila-desc');
    if (!list) return;
    const toolKey = arq2Tool === 'calle-curva-arq2' ? 'calle-curva-arq2' : (arq2Tool === 'relleno-auto' ? 'relleno-auto' : (arq2Tool === 'costura' ? 'costura' : (arq2Tool === 'fila-variable' ? 'fila-variable' : 'lote-libre')));
    const activeId = arq2_resolveActiveStepId();
    const steps = ARQ2_STEPS.filter(s => s.tool === toolKey);
    list.innerHTML = '';
    steps.forEach(step => {
        const li = document.createElement('li');
        li.textContent = step.text;
        if (step.id === activeId) li.classList.add('arq2-step-active');
        list.appendChild(li);
    });
    if (smoothRow) {
        smoothRow.style.display = (toolKey === 'lote-libre' || toolKey === 'costura' || toolKey === 'relleno-auto') ? 'flex' : 'none';
    }
    const costuraRow = document.getElementById('arq2-costura-style-row');
    const costuraToggle = document.getElementById('arq2-costura-toggle-selected');
    const demoReplay = document.getElementById('arq2-fila-demo-replay');
    if (costuraRow) costuraRow.style.display = toolKey === 'costura' ? 'flex' : 'none';
    if (costuraToggle) {
        const sel = arq2SelectedLineId && allDrawnLines.find(l => l.id === arq2SelectedLineId);
        const showSel = toolKey === 'costura' && sel?.sharedSegs?.length;
        costuraToggle.style.display = showSel ? 'block' : 'none';
        if (showSel) {
            const cur = sel.sharedSegStyles?.[sel.sharedSegs[0]] || sel.costuraStyle || 'punteada';
            costuraToggle.textContent = cur === 'punteada' ? 'Cambiar a sólida' : 'Cambiar a punteada';
        }
    }
    if (demoReplay) demoReplay.style.display = toolKey === 'fila-variable' ? 'block' : 'none';
    if (filaDesc) filaDesc.style.display = toolKey === 'fila-variable' ? 'block' : 'none';
    const calleRow = document.getElementById('arq2-calle-curva-row');
    if (calleRow) calleRow.style.display = toolKey === 'calle-curva-arq2' ? 'flex' : 'none';
    document.getElementById('arq2-costura-punteada')?.classList.toggle('active', arq2CosturaStyle === 'punteada');
    document.getElementById('arq2-costura-solida')?.classList.toggle('active', arq2CosturaStyle === 'solida');
    if (sem) {
        sem.classList.remove('arq2-sem-green', 'arq2-sem-yellow', 'arq2-sem-red');
        if (arq2InvasionActive) {
            sem.textContent = '🔴 Cruzando calle o límite, corrige el punto';
            sem.classList.add('arq2-sem-red');
        } else if (arq2CosturaSnap && isArquitecto2Active) {
            sem.textContent = '🟡 Imán activo — puedes encadenar a forma existente';
            sem.classList.add('arq2-sem-yellow');
        } else {
            sem.textContent = '🟢 Trazo limpio';
            sem.classList.add('arq2-sem-green');
        }
    }
}
function arq2_updateLiveCounter(mock) {
    const el = document.getElementById('arq2-live-counter');
    const tip = document.getElementById('arq2-invasion-tooltip');
    if (!el || !mock) return;
    const pts = arq2_getActiveDrawPoints();
    if (pts.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = mock.clientX + 'px';
    el.style.top = mock.clientY + 'px';
    if (arq2Tool === 'fila-variable' && document.getElementById('franja-lotes-modal')?.classList.contains('open')) {
        const weights = getFranjaModalWeights();
        const total = weights.reduce((a, b) => a + b, 0);
        const activeIdx = Math.min(weights.length - 1, Math.max(0, document.querySelector('.franja-weight-input:focus') ? Array.from(document.querySelectorAll('.franja-weight-input')).indexOf(document.activeElement) : 0));
        const current = weights[activeIdx] || 0;
        el.textContent = 'Lote actual: ' + current + ' m² | Total hilera: ' + total + ' m²';
    } else {
        el.textContent = 'Vértices: ' + pts.length + (arq2Tool === 'fila-variable' ? ' (mín. 4)' : '');
    }
    if (tip) {
        if (arq2InvasionActive) {
            tip.style.display = 'block';
            tip.style.left = mock.clientX + 'px';
            tip.style.top = mock.clientY + 'px';
        } else tip.style.display = 'none';
    }
}
function arq2_refreshVertexMarkers(ctx) {
    const vertsG = document.getElementById('arq2-vertices');
    if (!vertsG || !ctx) return;
    const ns = 'http://www.w3.org/2000/svg';
    const { getCam, cx, cy_screen, f } = ctx;
    const points = arq2_getActiveDrawPoints();
    vertsG.innerHTML = '';
    points.forEach((pt, idx) => {
        const c = getCam(pt[0], pt[1]);
        if (c.z <= 0.0001) return;
        const x = cx + (c.x / c.z) * f, y = cy_screen - (c.y / c.z) * f;
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        if (idx === points.length - 1) {
            circle.setAttribute('r', '6');
            circle.classList.add('arq2-vertex-pulse');
        } else {
            circle.setAttribute('r', '4');
            circle.setAttribute('fill', '#10b981');
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '1');
        }
        vertsG.appendChild(circle);
    });
}
function arq2_refreshFeedbackVisuals(mock) {
    if (!isArquitecto2Active) return;
    arq2_ensureFeedbackLayer();
    const ctx = arq2_getCameraContext();
    if (!ctx) return;
    arq2_refreshVertexMarkers(ctx);
    const band = document.getElementById('arq2-rubber-band');
    const points = arq2_getActiveDrawPoints();
    if (band && points.length > 0 && mock && visor360) {
        const last = points[points.length - 1];
        const coords = visor360.mouseEventToCoords(mock);
        arq2InvasionActive = coords ? arq2_checkInvasion(last, [coords[0], coords[1]]) : false;
        const cLast = ctx.getCam(last[0], last[1]);
        const mx = mock.clientX - DOMCache.viewport.left, my = mock.clientY - DOMCache.viewport.top;
        if (cLast.z > 0.0001) {
            band.setAttribute('d', `M ${ctx.cx + (cLast.x / cLast.z) * ctx.f},${ctx.cy_screen - (cLast.y / cLast.z) * ctx.f} L ${mx},${my}`);
            band.classList.toggle('arq2-invasion-warning', arq2InvasionActive);
        } else band.setAttribute('d', '');
    } else if (band) { band.setAttribute('d', ''); band.classList.remove('arq2-invasion-warning'); arq2InvasionActive = false; }
    const magnet = document.getElementById('arq2-snap-magnet');
    if (magnet && arq2CosturaSnap) {
        const sc = ctx.getCam(arq2CosturaSnap.pitch, arq2CosturaSnap.yaw);
        if (sc.z > 0.0001) {
            magnet.style.display = '';
            magnet.setAttribute('cx', ctx.cx + (sc.x / sc.z) * ctx.f);
            magnet.setAttribute('cy', ctx.cy_screen - (sc.y / sc.z) * ctx.f);
            magnet.classList.add('arq2-snap-pulse');
        } else magnet.style.display = 'none';
    } else if (magnet) { magnet.style.display = 'none'; magnet.classList.remove('arq2-snap-pulse'); }
    arq2_updateLiveCounter(mock);
    arq2_updatePanelStep();
    const pts = arq2_getActiveDrawPoints();
    if (mock && pts.length >= 3 && visor360) {
        const coords = visor360.mouseEventToCoords(mock);
        const near = coords && isNearPolygonOriginPY(coords[0], coords[1], pts[0]) && canTriggerPolygonAutoClose();
        updateCloseOriginHighlight(!!near);
    } else updateCloseOriginHighlight(false);
}
function arq2_catmullRomSmooth(points, segmentsPerCurve = 8) {
    if (!points || points.length < 3) return points ? points.map(p => [...p]) : [];
    const pts = points.map(p => [...p]), n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        for (let s = 0; s < segmentsPerCurve; s++) {
            const u = s / segmentsPerCurve, u2 = u * u, u3 = u2 * u;
            const pitch = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
            const yaw = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
            if (s === 0 && i > 0) continue;
            out.push([parseFloat(pitch.toFixed(4)), parseFloat(yaw.toFixed(4))]);
        }
    }
    return out.length >= 3 ? out : pts;
}
function arq2_detectCornerAngle(pPrev, pCurr, pNext) {
    const v1x = pCurr[0] - pPrev[0], v1y = pCurr[1] - pPrev[1];
    const v2x = pNext[0] - pCurr[0], v2y = pNext[1] - pCurr[1];
    const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-8 || len2 < 1e-8) return 180;
    const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
    return 180 - (Math.acos(dot) * 180 / Math.PI);
}
function arq2_catmullRomOpen(points, segmentsPerCurve = 8) {
    if (!points || points.length < 2) return points ? points.map(p => [...p]) : [];
    if (points.length === 2) return [points[0].map(v => v), points[1].map(v => v)];
    const out = [[...points[0]]];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
        for (let s = 1; s <= segmentsPerCurve; s++) {
            const u = s / segmentsPerCurve, u2 = u * u, u3 = u2 * u;
            const pitch = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
            const yaw = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
            out.push([parseFloat(pitch.toFixed(4)), parseFloat(yaw.toFixed(4))]);
        }
    }
    return out;
}
function arq2_smoothCalleAxis(points) {
    if (!points || points.length < 2) return points ? points.map(p => [...p]) : [];
    return arq2_catmullRomOpen(points, 12);
}
function arq2_estimateScreenCurvatureRadius(points, i, proj) {
    if (!points || points.length < 2 || !proj) return Infinity;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(points.length - 1, i + 1);
    if (i0 === i1 || i1 === i2) return Infinity;
    const s0 = proj.toScreen(points[i0][0], points[i0][1]);
    const s1 = proj.toScreen(points[i1][0], points[i1][1]);
    const s2 = proj.toScreen(points[i2][0], points[i2][1]);
    if (!s0 || !s1 || !s2) return Infinity;
    const a = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const b = Math.hypot(s2[0] - s1[0], s2[1] - s1[1]);
    const c = Math.hypot(s2[0] - s0[0], s2[1] - s0[1]);
    const area2 = Math.abs((s1[0] - s0[0]) * (s2[1] - s0[1]) - (s1[1] - s0[1]) * (s2[0] - s0[0]));
    if (area2 < 1e-3) return Infinity;
    return (a * b * c) / area2;
}
function arq2_chaikinOpenSmoothOnce(points) {
    if (!points || points.length < 3) return points ? points.map(p => [...p]) : [];
    const out = [[...points[0]]];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i], p1 = points[i + 1];
        out.push([parseFloat((p0[0] * 0.75 + p1[0] * 0.25).toFixed(4)), parseFloat((p0[1] * 0.75 + p1[1] * 0.25).toFixed(4))]);
        out.push([parseFloat((p0[0] * 0.25 + p1[0] * 0.75).toFixed(4)), parseFloat((p0[1] * 0.25 + p1[1] * 0.75).toFixed(4))]);
    }
    out.push([...points[points.length - 1]]);
    return out;
}
function arq2_enforceMinCurveRadius(smoothedPoints, minRadiusPx) {
    const proj = getPanoramaScreenProjector();
    if (!proj || !smoothedPoints || smoothedPoints.length < 3) return smoothedPoints ? smoothedPoints.map(p => [...p]) : [];
    let pts = smoothedPoints.map(p => [...p]);
    const minR = Math.max(1, minRadiusPx || 1);
    for (let pass = 0; pass < 10; pass++) {
        let changed = false;
        for (let i = 1; i < pts.length - 1; i++) {
            const r = arq2_estimateScreenCurvatureRadius(pts, i, proj);
            if (r < minR) {
                const prev = pts[i - 1], next = pts[i + 1];
                pts[i] = [
                    parseFloat(((prev[0] + pts[i][0] + next[0]) / 3).toFixed(4)),
                    parseFloat(((prev[1] + pts[i][1] + next[1]) / 3).toFixed(4))
                ];
                changed = true;
            }
        }
        if (!changed) break;
        if (pass === 4 || pass === 8) pts = arq2_chaikinOpenSmoothOnce(pts);
    }
    return pts;
}
function arq2_removeSelfIntersections(pointsArray) {
    if (!pointsArray || pointsArray.length < 4) return pointsArray ? pointsArray.map(p => [...p]) : [];
    let pts = pointsArray.map(p => [...p]);
    for (let pass = 0; pass < 16; pass++) {
        let removed = false;
        outer: for (let i = 0; i < pts.length - 3; i++) {
            const a1 = pts[i], a2 = pts[i + 1];
            for (let j = i + 2; j < pts.length - 1; j++) {
                const b1 = pts[j], b2 = pts[j + 1];
                const hit = intersectSegments(a1, a2, b1, b2);
                if (!hit) continue;
                const hx = parseFloat(hit[0].toFixed(4)), hy = parseFloat(hit[1].toFixed(4));
                pts = pts.slice(0, i + 1).concat([[hx, hy]], pts.slice(j + 1));
                removed = true;
                break outer;
            }
        }
        if (!removed) break;
    }
    return pts.length >= 2 ? pts : pointsArray.map(p => [...p]);
}
function arq2_getCalleCurvaHalfWidthPx(anchoFactor) {
    const factor = Math.max(4, Math.min(15, anchoFactor || arq2CalleCurvaAncho || 8));
    return getCalleHalfWidthPx(factor * 0.72);
}
function arq2_offsetSplinePath(smoothedPoints, halfWidthPx, calleRetorno = false) {
    const proj = getPanoramaScreenProjector();
    if (!proj || !smoothedPoints || smoothedPoints.length < 2) return { left: [], right: [] };
    const left = [], right = [];
    
    const limit = calleRetorno ? smoothedPoints.length - 1 : smoothedPoints.length;
    for (let i = 0; i < limit; i++) {
        const prev = smoothedPoints[Math.max(0, i - 1)];
        const next = smoothedPoints[Math.min(smoothedPoints.length - 1, i + 1)];
        const scPrev = proj.toScreen(prev[0], prev[1]);
        const scNext = proj.toScreen(next[0], next[1]);
        const scCur = proj.toScreen(smoothedPoints[i][0], smoothedPoints[i][1]);
        if (!scPrev || !scNext || !scCur) continue;
        let dx = scNext[0] - scPrev[0], dy = scNext[1] - scPrev[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const nx = -dy / len, ny = dx / len;
        const lPy = proj.toPY(scCur[0] + nx * halfWidthPx, scCur[1] + ny * halfWidthPx);
        const rPy = proj.toPY(scCur[0] - nx * halfWidthPx, scCur[1] - ny * halfWidthPx);
        if (lPy) left.push([parseFloat(lPy[0].toFixed(4)), parseFloat(lPy[1].toFixed(4))]);
        if (rPy) right.push([parseFloat(rPy[0].toFixed(4)), parseFloat(rPy[1].toFixed(4))]);
    }
    
    if (calleRetorno) {
        const lastIdx = smoothedPoints.length - 1;
        const prev = smoothedPoints[Math.max(0, lastIdx - 1)];
        const last = smoothedPoints[lastIdx];
        const scPrev = proj.toScreen(prev[0], prev[1]);
        const scLast = proj.toScreen(last[0], last[1]);
        if (scPrev && scLast) {
            let dx = scLast[0] - scPrev[0], dy = scLast[1] - scPrev[1];
            let len = Math.hypot(dx, dy);
            if (len > 1e-6) {
                let fx = dx / len, fy = dy / len;
                let scCenter = [scLast[0] + fx * (halfWidthPx * 0.6), scLast[1] + fy * (halfWidthPx * 0.6)];
                let r = halfWidthPx * 1.8;
                let phi = Math.atan2(fy, fx);
                
                const numPoints = 16;
                for (let j = 0; j <= numPoints / 2; j++) {
                    let ang = (phi - Math.PI / 2) + (Math.PI * j / numPoints);
                    let sxArc = scCenter[0] + Math.cos(ang) * r;
                    let syArc = scCenter[1] + Math.sin(ang) * r;
                    let pyArc = proj.toPY(sxArc, syArc);
                    if (pyArc) left.push([parseFloat(pyArc[0].toFixed(4)), parseFloat(pyArc[1].toFixed(4))]);
                }
                for (let j = numPoints; j > numPoints / 2; j--) {
                    let ang = (phi - Math.PI / 2) + (Math.PI * j / numPoints);
                    let sxArc = scCenter[0] + Math.cos(ang) * r;
                    let syArc = scCenter[1] + Math.sin(ang) * r;
                    let pyArc = proj.toPY(sxArc, syArc);
                    if (pyArc) right.push([parseFloat(pyArc[0].toFixed(4)), parseFloat(pyArc[1].toFixed(4))]);
                }
            }
        }
    }
    
    return {
        left: arq2_removeSelfIntersections(left),
        right: arq2_removeSelfIntersections(right)
    };
}
function arq2_getCalleCurvaAlpha(lineData) {
    return Math.max(0.15, Math.min(1, lineData?.calleCurvaAlpha ?? draftCalleCurvaAlpha ?? 0.55));
}
function arq2_applyCalleCurvaFillStyle(pathEl, alpha) {
    if (!pathEl) return;
    const a = arq2_getCalleCurvaAlpha({ calleCurvaAlpha: alpha });
    pathEl.setAttribute('fill', `rgba(255,255,255,${a})`);
    pathEl.setAttribute('stroke', 'none');
    pathEl.style.fill = `rgba(255,255,255,${a})`;
}
function arq2_buildCalleCurvaGeometry(ejeOriginal, anchoFactor, alphaFactor, calleRetorno = false) {
    let eje = arq2_smoothCalleAxis(ejeOriginal);
    const halfPx = arq2_getCalleCurvaHalfWidthPx(anchoFactor);
    eje = arq2_enforceMinCurveRadius(eje, halfPx * 1.3);
    const { left, right } = arq2_offsetSplinePath(eje, halfPx, calleRetorno);
    if (left.length < 2 || right.length < 2) return null;
    const calleCurvaAlpha = Math.max(0.15, Math.min(1, alphaFactor ?? draftCalleCurvaAlpha ?? 0.55));
    return {
        ejeOriginal: ejeOriginal.map(p => [...p]),
        puntosSuavizados: eje,
        ancho: anchoFactor,
        calleCurvaAlpha,
        calleRetorno,
        left,
        right,
        fillPoly: [...left, ...[...right].reverse()],
        halfPx
    };
}
function arq2_projectOpenPolylineD(pts, getCamFn, cx, cySc, f) {
    if (!pts || pts.length < 2) return '';
    let d = '', hasVisible = false;
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        const c1 = getCamFn(p1[0], p1[1]), c2 = getCamFn(p2[0], p2[1]);
        if (c1.z <= 0.0001 && c2.z <= 0.0001) continue;
        let s1, s2;
        if (c1.z > 0.0001) { s1 = { x: cx + (c1.x / c1.z) * f, y: cySc - (c1.y / c1.z) * f }; hasVisible = true; }
        else { const t = c1.z / (c1.z - c2.z); s1 = { x: cx + ((c1.x + t * (c2.x - c1.x)) / 0.0001) * f, y: cySc - ((c1.y + t * (c2.y - c1.y)) / 0.0001) * f }; }
        if (c2.z > 0.0001) { s2 = { x: cx + (c2.x / c2.z) * f, y: cySc - (c2.y / c2.z) * f }; hasVisible = true; }
        else { const t = c2.z / (c2.z - c1.z); s2 = { x: cx + ((c2.x + t * (c1.x - c2.x)) / 0.0001) * f, y: cySc - ((c2.y + t * (c1.y - c2.y)) / 0.0001) * f }; }
        if (isNaN(s1.x) || isNaN(s1.y) || isNaN(s2.x) || isNaN(s2.y)) continue;
        if (d === '') d += `M ${s1.x},${s1.y} L ${s2.x},${s2.y} `;
        else { if (c1.z <= 0.0001) d += `M ${s1.x},${s1.y} `; d += `L ${s2.x},${s2.y} `; }
    }
    return hasVisible ? d : '';
}
function arq2_projectScreenCapLine(sA, sB) {
    if (!sA || !sB) return '';
    return `M ${sA.x},${sA.y} L ${sB.x},${sB.y}`;
}
function arq2_projectCalleCurvaPaths(lineData, getCamFn, cx, cySc, f) {
    const left = lineData.left, right = lineData.right;
    if (!left?.length || !right?.length) return null;
    const toScreen = (py) => {
        const c = getCamFn(py[0], py[1]);
        if (c.z <= 0.0001) return null;
        return { x: cx + (c.x / c.z) * f, y: cySc - (c.y / c.z) * f };
    };
    const sLeft = left.map(toScreen).filter(Boolean);
    const sRight = right.map(toScreen).filter(Boolean);
    if (sLeft.length < 2 || sRight.length < 2) return null;
    let dFill = `M ${sLeft[0].x},${sLeft[0].y}`;
    for (let i = 1; i < sLeft.length; i++) dFill += ` L ${sLeft[i].x},${sLeft[i].y}`;
    for (let i = sRight.length - 1; i >= 0; i--) dFill += ` L ${sRight[i].x},${sRight[i].y}`;
    dFill += ' Z';
    const dLeft = arq2_projectOpenPolylineD(left, getCamFn, cx, cySc, f);
    const dRight = arq2_projectOpenPolylineD(right, getCamFn, cx, cySc, f);
    const capStart = arq2_projectScreenCapLine(sLeft[0], sRight[0]);
    const capEnd = lineData.calleRetorno ? '' : arq2_projectScreenCapLine(sLeft[sLeft.length - 1], sRight[sRight.length - 1]);
    return { dFill, dLeft, dRight, capStart, capEnd, calleCurvaAlpha: lineData.calleCurvaAlpha };
}
function arq2_finishCalleCurva() {
    if (arq2LinePoints.length < 2) { alert('Coloca al menos 2 puntos en el eje central de la calle.'); return; }
    const geo = arq2_buildCalleCurvaGeometry([...arq2LinePoints], arq2CalleCurvaAncho, draftCalleCurvaAlpha, arq2CalleRetorno);
    if (!geo) { alert('No se pudo generar la calle curva. Ajusta la vista e intenta de nuevo.'); return; }
    const id = 'arq2_calle_' + Date.now();
    allDrawnLines.push({
        id,
        tipo: 'calle-curva-arq2',
        ejeOriginal: geo.ejeOriginal,
        puntosSuavizados: geo.puntosSuavizados,
        ancho: geo.ancho,
        calleCurvaAlpha: geo.calleCurvaAlpha,
        calleRetorno: arq2CalleRetorno,
        left: geo.left,
        right: geo.right,
        puntos: geo.fillPoly
    });
    arq2_clearDraft();
    refreshAllHotspots(true);
    saveToLocal();
    flashScreenSuccess();
    arq2_setStatusText('Calle curva guardada ✓');
}
function arq2_getCalleCurvaPreviewLineData() {
    let eje = arq2LinePoints.map(p => [...p]);
    if (window.lastMouseX !== undefined && visor360) {
        const proj = getPanoramaScreenProjector();
        const mx = window.lastMouseX - DOMCache.viewport.left, my = window.lastMouseY - DOMCache.viewport.top;
        if (proj) {
            const py = proj.toPY(mx, my);
            if (py) eje.push([parseFloat(py[0].toFixed(3)), parseFloat(py[1].toFixed(3))]);
        }
    }
    if (eje.length < 2) return { id: arq2TempLineId, tipo: 'calle-curva-arq2-preview', ejeOriginal: eje, puntos: eje, calleCurvaAlpha: draftCalleCurvaAlpha };
    const geo = arq2_buildCalleCurvaGeometry(eje, arq2CalleCurvaAncho, draftCalleCurvaAlpha, arq2CalleRetorno);
    if (!geo) return { id: arq2TempLineId, tipo: 'calle-curva-arq2-preview', ejeOriginal: eje, puntos: eje, calleCurvaAlpha: draftCalleCurvaAlpha };
    return { id: arq2TempLineId, tipo: 'calle-curva-arq2-preview', ejeOriginal: geo.ejeOriginal, puntosSuavizados: geo.puntosSuavizados, ancho: geo.ancho, calleCurvaAlpha: geo.calleCurvaAlpha, calleRetorno: arq2CalleRetorno, left: geo.left, right: geo.right, puntos: geo.fillPoly };
}
function arq2_syncCalleCurvaPanelUI() {
    const valEl = document.getElementById('arq2-calle-ancho-val');
    const slider = document.getElementById('arq2-calle-ancho');
    const bar = document.getElementById('arq2-calle-width-preview-bar');
    const alphaEl = document.getElementById('arq2-calle-alpha');
    const alphaVal = document.getElementById('arq2-calle-alpha-val');
    const cb = document.getElementById('arq2-calle-retorno');
    if (slider) slider.value = arq2CalleCurvaAncho;
    if (valEl) valEl.textContent = arq2CalleCurvaAncho.toFixed(1);
    if (bar) {
        bar.style.width = Math.max(8, Math.min(100, ((arq2CalleCurvaAncho - 4) / 11) * 100)) + '%';
        bar.style.opacity = String(draftCalleCurvaAlpha);
    }
    if (alphaEl) alphaEl.value = draftCalleCurvaAlpha;
    if (alphaVal) alphaVal.textContent = Math.round(draftCalleCurvaAlpha * 100) + '%';
    if (cb) cb.checked = arq2CalleRetorno;
}
function arq2_bindCalleCurvaAlphaSlider() {
    const alphaEl = document.getElementById('arq2-calle-alpha');
    if (!alphaEl || alphaEl.dataset.bound === '1') return;
    alphaEl.dataset.bound = '1';
    alphaEl.addEventListener('input', (e) => {
        draftCalleCurvaAlpha = Math.max(0.15, Math.min(1, parseFloat(e.target.value) || 0.55));
        arq2_syncCalleCurvaPanelUI();
        syncSVGElements();
        updateSVGPaths();
    });
}
function arq2_ensurePanelExtras() {
    const row = document.querySelector('.arq2-tool-row');
    if (row && !document.getElementById('arq2-tool-calle-curva')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dev-btn arq2-tool-btn';
        btn.id = 'arq2-tool-calle-curva';
        btn.dataset.arq2Tool = 'calle-curva-arq2';
        btn.textContent = '🛣️ Calle Curva';
        row.appendChild(btn);
        btn.addEventListener('click', () => arq2_setTool('calle-curva-arq2'));
    }
    if (!document.getElementById('arq2-calle-curva-row') && document.getElementById('arq2-panel')) {
        const rowEl = document.createElement('div');
        rowEl.id = 'arq2-calle-curva-row';
        rowEl.className = 'arq2-calle-curva-row';
        rowEl.innerHTML = '<label>Ancho calle <span id="arq2-calle-ancho-val">8.0</span></label><input type="range" id="arq2-calle-ancho" min="4" max="15" step="0.5" value="8"><div id="arq2-calle-width-preview"><div id="arq2-calle-width-preview-bar"></div></div><label>Transparencia <span id="arq2-calle-alpha-val">55%</span></label><input type="range" id="arq2-calle-alpha" min="0.15" max="1" step="0.05" value="0.55">' + 
                            '<div style="margin-top: 10px; display: flex; align-items: center; gap: 8px;"><input type="checkbox" id="arq2-calle-retorno" style="cursor:pointer;"><label for="arq2-calle-retorno" style="cursor:pointer; margin: 0; font-size: 11px; color: #fff;">Retorno Circular (Cul-de-sac)</label></div>';
        document.getElementById('arq2-smooth-row')?.insertAdjacentElement('afterend', rowEl);
        document.getElementById('arq2-calle-ancho')?.addEventListener('input', (e) => {
            arq2CalleCurvaAncho = Math.max(4, Math.min(15, parseFloat(e.target.value) || 8));
            arq2_syncCalleCurvaPanelUI();
            syncSVGElements();
            updateSVGPaths();
        });
        document.getElementById('arq2-calle-retorno')?.addEventListener('change', (e) => {
            arq2CalleRetorno = !!e.target.checked;
            syncSVGElements();
            updateSVGPaths();
        });
        arq2_bindCalleCurvaAlphaSlider();
    } else if (!document.getElementById('arq2-calle-alpha') && document.getElementById('arq2-calle-curva-row')) {
        const alphaWrap = document.createElement('div');
        alphaWrap.innerHTML = '<label>Transparencia <span id="arq2-calle-alpha-val">55%</span></label><input type="range" id="arq2-calle-alpha" min="0.15" max="1" step="0.05" value="0.55">';
        document.getElementById('arq2-calle-curva-row')?.appendChild(alphaWrap);
        arq2_bindCalleCurvaAlphaSlider();
    } else {
        arq2_bindCalleCurvaAlphaSlider();
    }
    arq2_syncCalleCurvaPanelUI();
}
function arq2_getSmoothParams(intensity) {
    const n = intensity == null ? arq2SmoothIntensity : intensity;
    if (n <= 0) return { enabled: false, segmentsPerCurve: 8, angleThreshold: 180, label: 'Apagado' };
    if (n <= 3) return { enabled: true, segmentsPerCurve: 6, angleThreshold: 150, label: 'Sutil' };
    if (n <= 7) return { enabled: true, segmentsPerCurve: 10, angleThreshold: 165, label: 'Natural' };
    return { enabled: true, segmentsPerCurve: 18, angleThreshold: 175, label: 'Máximo' };
}
function arq2_estimatePolygonScreenAreaPx(pts) {
    const proj = getPanoramaScreenProjector();
    if (!proj || !pts || pts.length < 3) return Infinity;
    const sc = pts.map(p => proj.toScreen(p[0], p[1])).filter(Boolean);
    if (sc.length < 3) return Infinity;
    let area = 0;
    for (let i = 0; i < sc.length; i++) {
        const j = (i + 1) % sc.length;
        area += sc[i][0] * sc[j][1] - sc[j][0] * sc[i][1];
    }
    return Math.abs(area) / 2;
}
function arq2_reprocessLineSmoothing(lineId, intensity) {
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line?.puntos?.length) return;
    line.puntos = arq2_sanitizePolylinePoints(arq2_adaptiveSmooth(line.puntos, null, intensity));
    line.suavizadoIntensidad = intensity;
    if (line.sharedSegs?.length || line.costuraEstilo) {
        arq2_registerSharedEdges(lineId);
        arq2_mergeSharedBoundaryVertices(lineId);
        arq2_registerSharedEdges(lineId);
        arq2_syncCosturaStylesFromLineEstilo(lineId);
    }
    syncSVGElements();
    refreshAllHotspots(true);
    saveToLocal();
    arq2_setStatusText('Suavizado reprocesado (' + arq2_getSmoothParams(intensity).label + ') ✓');
}
function arq2_showSmallShapeSmoothHint(lineId) {
    let hint = document.getElementById('arq2-small-shape-hint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'arq2-small-shape-hint';
        hint.className = 'arq2-small-shape-hint';
        document.getElementById('arq2-panel')?.appendChild(hint);
    }
    hint.innerHTML = 'Forma pequeña detectada — considera subir la intensidad de suavizado para un trazo más fino. <button type="button" id="arq2-apply-max-smooth">Aplicar Máximo</button>';
    hint.style.display = 'block';
    const btn = document.getElementById('arq2-apply-max-smooth');
    if (btn) {
        btn.onclick = () => {
            arq2SmoothIntensity = 10;
            arq2_syncSmoothIntensityUI();
            arq2_reprocessLineSmoothing(lineId, 10);
            hint.style.display = 'none';
        };
    }
}
function arq2_syncSmoothIntensityUI() {
    const slider = document.getElementById('arq2-smooth-intensity');
    const valEl = document.getElementById('arq2-smooth-intensity-val');
    const params = arq2_getSmoothParams();
    if (slider) slider.value = arq2SmoothIntensity;
    if (valEl) valEl.textContent = params.label + ' (' + arq2SmoothIntensity + ')';
}
function arq2_ensureSmoothIntensityPanel() {
    const oldRow = document.getElementById('arq2-smooth-row');
    if (!oldRow || document.getElementById('arq2-smooth-intensity')) return;
    oldRow.innerHTML = '<label>Intensidad suavizado <span id="arq2-smooth-intensity-val">Natural (5)</span></label><input type="range" id="arq2-smooth-intensity" min="0" max="10" step="1" value="5">';
    document.getElementById('arq2-smooth-intensity')?.addEventListener('input', (e) => {
        arq2SmoothIntensity = Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0));
        arq2SmoothCurves = arq2SmoothIntensity > 0;
        arq2_syncSmoothIntensityUI();
        arq2_updatePanelStep();
    });
    arq2_syncSmoothIntensityUI();
}
function arq2_adaptiveSmooth(points, segmentsPerCurve, intensityOverride) {
    const params = arq2_getSmoothParams(intensityOverride);
    if (!params.enabled || !points || points.length < 3) return points.map(p => [...p]);
    const segs = segmentsPerCurve || params.segmentsPerCurve;
    const angleThreshold = params.angleThreshold;
    const n = points.length;
    const isSmoothVtx = (i) => arq2_detectCornerAngle(points[(i - 1 + n) % n], points[i], points[(i + 1) % n]) > angleThreshold;
    const result = [];
    let i = 0;
    while (i < n) {
        if (!isSmoothVtx(i)) { result.push([...points[i]]); i++; continue; }
        let j = i;
        while (j < n && isSmoothVtx(j)) j++;
        if (j - i >= 3) {
            const smoothed = arq2_catmullRomOpen(points.slice(i, j), segs);
            if (result.length && smoothed.length) {
                const last = result[result.length - 1], first = smoothed[0];
                if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 0.02) smoothed.shift();
            }
            result.push(...smoothed);
            i = j;
        } else { result.push([...points[i]]); i++; }
    }
    return result.length >= 3 ? result : points.map(p => [...p]);
}
function arq2_polylineDirectionVector(pts) {
    if (!pts || pts.length < 2) return null;
    return [pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]];
}
function arq2_validatePolylineDirection(frontPoints, backPoints) {
    const back = backPoints.map(p => [...p]);
    const v1 = arq2_polylineDirectionVector(frontPoints), v2 = arq2_polylineDirectionVector(back);
    if (!v1 || !v2) return { back, reversed: false, conflict: false };
    const len1 = Math.hypot(v1[0], v1[1]), len2 = Math.hypot(v2[0], v2[1]);
    if (len1 < 1e-6 || len2 < 1e-6) return { back, reversed: false, conflict: false };
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2);
    const angleBetween = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    const reversed = angleBetween > 90;
    if (reversed) back.reverse();
    return { back, reversed, conflict: angleBetween > 90 };
}
function arq2_chainFromContour(contorno, startIdx, endIdx) {
    const n = contorno.length;
    const chain = [];
    let i = startIdx;
    while (true) {
        chain.push([...contorno[i]]);
        if (i === endIdx) break;
        i = (i + 1) % n;
    }
    return chain;
}
function arq2_expandColinearChain(contorno, edgeStartIdx) {
    const n = contorno.length;
    let s = edgeStartIdx;
    let e = (edgeStartIdx + 1) % n;
    let next = (e + 1) % n;
    while (next !== s && n > 3 && arq2_detectCornerAngle(contorno[e], contorno[next], contorno[(next + 1) % n]) > 150) {
        e = next;
        next = (e + 1) % n;
    }
    let prev = (s - 1 + n) % n;
    while (prev !== e && n > 3 && arq2_detectCornerAngle(contorno[prev], contorno[s], contorno[(s + 1) % n]) > 150) {
        s = prev;
        prev = (s - 1 + n) % n;
    }
    return arq2_chainFromContour(contorno, s, e);
}
function arq2_detectEjeYFondo(contornoPoints) {
    const n = contornoPoints.length;
    if (n < 4) return null;
    let bestI = 0, bestLen = 0;
    for (let i = 0; i < n; i++) {
        const len = Math.hypot(contornoPoints[(i + 1) % n][0] - contornoPoints[i][0], contornoPoints[(i + 1) % n][1] - contornoPoints[i][1]);
        if (len > bestLen) { bestLen = len; bestI = i; }
    }
    const ejeFrente = arq2_expandColinearChain(contornoPoints, bestI);
    const fMid = getPointAlongPolyline(ejeFrente, 0.5);
    let oppI = (bestI + Math.floor(n / 2)) % n, oppScore = -1;
    for (let j = 0; j < n; j++) {
        if (j === bestI || j === (bestI + 1) % n) continue;
        const p1 = contornoPoints[j], p2 = contornoPoints[(j + 1) % n];
        const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
        const d = Math.hypot(mid[0] - fMid[0], mid[1] - fMid[1]);
        if (d > oppScore) { oppScore = d; oppI = j; }
    }
    let ejeFondo = arq2_expandColinearChain(contornoPoints, oppI);
    ejeFondo = arq2_validatePolylineDirection(ejeFrente, ejeFondo).back;
    return { ejeFrente, ejeFondo };
}
function arq2_pointAtArcLength(ejePoints, targetLength) {
    const total = getPolylineLength(ejePoints);
    if (total < 1e-8) return [...ejePoints[0]];
    return getPointAlongPolyline(ejePoints, Math.min(1, Math.max(0, targetLength / total)));
}
function arq2_computeFilaTCuts(weights) {
    const total = weights.reduce((a, b) => a + (parseFloat(b) || 0), 0) || 1;
    const cum = [0];
    let acc = 0;
    for (let i = 0; i < weights.length; i++) { acc += (parseFloat(weights[i]) || 0) / total; cum.push(acc); }
    return cum;
}
function arq2_getFilaRadialDivision(ejeFrente, ejeFondo, t) {
    const tp = getPointAlongPolyline(ejeFrente, t);
    const tEps = 0.01;
    const tPrev = Math.max(0, t - tEps);
    const tNext = Math.min(1, t + tEps);
    const pPrev = getPointAlongPolyline(ejeFrente, tPrev);
    const pNext = getPointAlongPolyline(ejeFrente, tNext);
    let dx = pNext[0] - pPrev[0];
    let dy = pNext[1] - pPrev[1];
    let len = Math.hypot(dx, dy);
    if (len < 1e-6) {
        return [tp, getPointAlongPolyline(ejeFondo, t)];
    }
    let nx = -dy / len;
    let ny = dx / len;
    const midFondo = getPointAlongPolyline(ejeFondo, 0.5);
    const dPlus = Math.hypot(tp[0] + nx * 0.1 - midFondo[0], tp[1] + ny * 0.1 - midFondo[1]);
    const dMinus = Math.hypot(tp[0] - nx * 0.1 - midFondo[0], tp[1] - ny * 0.1 - midFondo[1]);
    if (dMinus < dPlus) {
        nx = -nx;
        ny = -ny;
    }
    const rayStart = tp;
    const rayEnd = [tp[0] + nx * 10.0, tp[1] + ny * 10.0];
    let bp = null;
    let minRayT = Infinity;
    for (let i = 0; i < ejeFondo.length - 1; i++) {
        const b1 = ejeFondo[i], b2 = ejeFondo[i + 1];
        const hit = intersectSegments(rayStart, rayEnd, b1, b2);
        if (hit) {
            const d = Math.hypot(hit[0] - rayStart[0], hit[1] - rayStart[1]);
            if (d < minRayT) {
                minRayT = d;
                bp = hit;
            }
        }
    }
    if (bp) {
        return [tp, bp];
    }
    return [tp, getPointAlongPolyline(ejeFondo, t)];
}
function arq2_buildFilaInternalDivisions(ejeFrente, ejeFondo, weights) {
    const cum = arq2_computeFilaTCuts(weights);
    const divs = [];
    for (let i = 1; i < cum.length - 1; i++) {
        const pts = arq2_getFilaRadialDivision(ejeFrente, ejeFondo, cum[i]);
        const tp = pts[0], bp = pts[1];
        if (!arq2_isValidPYPoint(tp) || !arq2_isValidPYPoint(bp)) {
            console.warn('[Fila Variable] División inválida en t=' + cum[i], { tp, bp, ejeFrente, ejeFondo });
            continue;
        }
        divs.push([[...tp], [...bp]]);
    }
    return divs;
}
function arq2_computeFilaLotCentroids(ejeFrente, ejeFondo, weights) {
    const cum = arq2_computeFilaTCuts(weights);
    const lots = [];
    for (let i = 0; i < weights.length; i++) {
        const tMid = (cum[i] + cum[i + 1]) / 2;
        const pts = arq2_getFilaRadialDivision(ejeFrente, ejeFondo, tMid);
        const pf = pts[0], pb = pts[1];
        lots.push({
            numero: String(i + 1).padStart(2, '0'),
            centroid: [(pf[0] + pb[0]) / 2, (pf[1] + pb[1]) / 2],
            m2: parseFloat(weights[i]) || 0
        });
    }
    return lots;
}
function arq2_finishFilaContour() {
    if (arq2LinePoints.length < 4) { alert('⚠ Dibuja al menos 4 puntos para el contorno completo de la hilera.'); return; }
    const raw = arq2_sanitizePolylinePoints([...arq2LinePoints]);
    if (raw.length < 4) { alert('⚠ Contorno inválido. Usa 4–6 vértices bien definidos.'); return; }
    arq2FilaVariableContorno = arq2SmoothCurves ? arq2_adaptiveSmooth(raw, 8) : raw;
    arq2FilaVariableContorno = arq2_sanitizePolylinePoints(arq2FilaVariableContorno);
    if (arq2FilaVariableContorno.length < 4) { alert('⚠ No se pudo generar la fila. Intenta con un contorno más simple (4-6 puntos) y vuelve a intentar.'); return; }
    arq2PendingFila = { contorno: [...arq2FilaVariableContorno] };
    arq2LinePoints = [];
    arq2TempLineId = 'arq2_temp_' + Date.now();
    arq2_stopDemoAnimation();
    openFranjaLotesModal(4, null);
    arq2_updatePanelStep();
}
function arq2_resamplePolylineEqualArc(pts, sampleCount = 64) {
    if (!pts || pts.length < 2) return pts ? pts.map(p => [...p]) : [];
    const out = [];
    for (let i = 0; i <= sampleCount; i++) out.push(getPointAlongPolyline(pts, i / sampleCount));
    return out;
}
function arq2_distributeVariableWidthsAlongSpline(splinePoints, weightsArray) {
    if (!splinePoints || splinePoints.length < 2 || !weightsArray?.length) return [];
    const weights = weightsArray.map(w => Math.sqrt(Math.max(1, parseFloat(w) || 1)));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const cum = [0];
    let acc = 0;
    for (let i = 0; i < weights.length; i++) { acc += weights[i] / total; cum.push(acc); }
    return cum.map(t => getPointAlongPolyline(splinePoints, Math.min(1, Math.max(0, t))));
}
function arq2_getSnapPolylinePoints(line) {
    if (!line) return [];
    if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
        const pts = [];
        if (line.left?.length) pts.push(...line.left);
        if (line.right?.length) pts.push(...line.right);
        return pts;
    }
    if (line.tipo === 'franja-curva-grupo') {
        const pts = [];
        if (line.frente?.length) pts.push(...line.frente);
        if (line.fondo?.length) pts.push(...line.fondo);
        return pts;
    }
    return line.puntos || [];
}
function arq2_isUniversalSnapTarget(line) {
    if (!line || line.tipo === 'divisoria' || line.tipo === 'cortar' || line.tipo === 'linea-pines-guia') return false;
    if (line.tipo === 'franja-preview' || line.tipo === 'franja-preview-div') return false;
    return arq2_getSnapPolylinePoints(line).length >= 2;
}
function arq2_isLineClosedForSnap(line) {
    if (line.tipo === 'calle' || line.tipo === 'cortar' || line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') return false;
    const pts = arq2_getSewPolygonPoints(line);
    return pts.length >= 3;
}
function arq2_findNearestEdgeOrVertex(screenX, screenY, excludeLineId, radiusPx = 15) {
    const proj = getPanoramaScreenProjector();
    if (!proj) return null;
    const sx = screenX - DOMCache.viewport.left, sy = screenY - DOMCache.viewport.top;
    const effectiveRadius = Math.max(radiusPx, 25);
    let best = null, bestD = effectiveRadius;
    const tryPt = (pitch, yaw, meta) => {
        const sc = proj.toScreen(pitch, yaw);
        if (!sc) return;
        const d = Math.hypot(sc[0] - sx, sc[1] - sy);
        if (d < bestD) { bestD = d; best = { pitch, yaw, screenX: DOMCache.viewport.left + sc[0], screenY: DOMCache.viewport.top + sc[1], ...meta }; }
    };
    allDrawnLines.forEach(line => {
        if (line.id === excludeLineId || !arq2_isUniversalSnapTarget(line)) return;
        if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
            const polylines = [line.left || [], line.right || []];
            polylines.forEach((poly, polyIdx) => {
                if (poly.length < 2) return;
                poly.forEach((pt, vi) => tryPt(pt[0], pt[1], { lineId: line.id, kind: 'vertex', vertexIdx: vi, side: polyIdx === 0 ? 'left' : 'right' }));
                const segCount = poly.length - 1;
                for (let i = 0; i < segCount; i++) {
                    const p1 = poly[i], p2 = poly[i + 1];
                    const s1 = proj.toScreen(p1[0], p1[1]), s2 = proj.toScreen(p2[0], p2[1]);
                    if (!s1 || !s2) continue;
                    const dx = s2[0] - s1[0], dy = s2[1] - s1[1], len2 = dx * dx + dy * dy;
                    if (len2 < 1e-6) continue;
                    let t = ((sx - s1[0]) * dx + (sy - s1[1]) * dy) / len2;
                    t = Math.max(0, Math.min(1, t));
                    const px = s1[0] + t * dx, py = s1[1] + t * dy;
                    const d = Math.hypot(px - sx, py - sy);
                    if (d < bestD) {
                        const pyPt = proj.toPY(px, py);
                        if (pyPt) best = { pitch: pyPt[0], yaw: pyPt[1], screenX: DOMCache.viewport.left + px, screenY: DOMCache.viewport.top + py, lineId: line.id, kind: 'edge', side: polyIdx === 0 ? 'left' : 'right', segIdx: i, t };
                    }
                }
            });
            return;
        }
        const pts = arq2_getSnapPolylinePoints(line);
        pts.forEach((pt, vi) => tryPt(pt[0], pt[1], { lineId: line.id, kind: 'vertex', vertexIdx: vi }));
        const closed = arq2_isLineClosedForSnap(line);
        const segCount = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < segCount; i++) {
            const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
            const s1 = proj.toScreen(p1[0], p1[1]), s2 = proj.toScreen(p2[0], p2[1]);
            if (!s1 || !s2) continue;
            const dx = s2[0] - s1[0], dy = s2[1] - s1[1], len2 = dx * dx + dy * dy;
            if (len2 < 1e-6) continue;
            let t = ((sx - s1[0]) * dx + (sy - s1[1]) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
            const px = s1[0] + t * dx, py = s1[1] + t * dy;
            const d = Math.hypot(px - sx, py - sy);
            if (d < bestD) {
                const pyPt = proj.toPY(px, py);
                if (pyPt) best = { pitch: pyPt[0], yaw: pyPt[1], screenX: DOMCache.viewport.left + px, screenY: DOMCache.viewport.top + py, lineId: line.id, kind: 'edge', segIdx: i, t };
            }
        }
    });
    return best;
}
function arq2_getSewPolygonPoints(line) {
    if (line.tipo === 'franja-curva-grupo' && line.frente?.length >= 2 && line.fondo?.length >= 2) {
        return [...line.frente, ...[...line.fondo].reverse()];
    }
    return line.puntos || [];
}
function arq2_segMatchTol(p1, p2, q1, q2, tol = 0.05) {
    const d11 = Math.hypot(p1[0] - q1[0], p1[1] - q1[1]), d22 = Math.hypot(p2[0] - q2[0], p2[1] - q2[1]);
    const d12 = Math.hypot(p1[0] - q2[0], p1[1] - q2[1]), d21 = Math.hypot(p2[0] - q1[0], p2[1] - q1[1]);
    return (d11 < tol && d22 < tol) || (d12 < tol && d21 < tol);
}
function arq2_segMatchScreenOrPY(p1, p2, q1, q2, proj, tolDeg = 0.08, tolPx = 10) {
    if (arq2_segMatchTol(p1, p2, q1, q2, tolDeg)) return true;
    if (!proj) return false;
    const s1 = proj.toScreen(p1[0], p1[1]), s2 = proj.toScreen(p2[0], p2[1]);
    const t1 = proj.toScreen(q1[0], q1[1]), t2 = proj.toScreen(q2[0], q2[1]);
    if (!s1 || !s2 || !t1 || !t2) return false;
    return (Math.hypot(s1[0] - t1[0], s1[1] - t1[1]) < tolPx && Math.hypot(s2[0] - t2[0], s2[1] - t2[1]) < tolPx)
        || (Math.hypot(s1[0] - t2[0], s1[1] - t2[1]) < tolPx && Math.hypot(s2[0] - t1[0], s2[1] - t1[1]) < tolPx);
}
function arq2_isEdgeSharedWithOrganicLote(p1, p2) {
    const proj = getPanoramaScreenProjector();
    const organicLots = allDrawnLines.filter(l => l.tipo === 'lote-organico' || l.tipo === 'fila-variable-lote');
    for (let lot of organicLots) {
        const pts = lot.puntos;
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
            const q1 = pts[i], q2 = pts[(i + 1) % pts.length];
            if (arq2_segMatchScreenOrPY(p1, p2, q1, q2, proj, 0.08, 12)) {
                return true;
            }
        }
    }
    return false;
}
function arq2_projectPointOnPolyline(p, poly) {
    if (!poly || poly.length < 2) return null;
    let bestDist = Infinity;
    let bestPt = null;
    let bestIdx = -1;
    let bestT = 0;
    for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i], b = poly[i + 1];
        const proj = projectPointOnSegment(p, a, b);
        const d = Math.hypot(p[0] - proj[0], p[1] - proj[1]);
        if (d < bestDist) {
            bestDist = d;
            bestPt = proj;
            bestIdx = i;
            bestT = projectionT(p, a, b);
            bestT = Math.max(0, Math.min(1, bestT));
        }
    }
    return { dist: bestDist, point: bestPt, idx: bestIdx, t: bestT };
}
function arq2_stitchOrganicLoteToStreets(pts) {
    if (!pts || pts.length < 3) return pts;
    const tol = 0.08; // tolerance in degrees (pitch/yaw) for snapping to street border
    const stitched = [];
    const n = pts.length;
    
    for (let i = 0; i < n; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        
        let matchedStreet = null;
        let matchedBorder = null; // 'left' or 'right'
        let proj1 = null;
        let proj2 = null;
        
        const streets = allDrawnLines.filter(l => l.tipo === 'calle-curva-arq2');
        for (let street of streets) {
            const leftProj = arq2_projectPointOnPolyline(p1, street.left);
            const rightProj = arq2_projectPointOnPolyline(p1, street.right);
            
            if (leftProj && leftProj.dist < tol) {
                const leftProj2 = arq2_projectPointOnPolyline(p2, street.left);
                if (leftProj2 && leftProj2.dist < tol) {
                    matchedStreet = street;
                    matchedBorder = 'left';
                    proj1 = leftProj;
                    proj2 = leftProj2;
                    break;
                }
            }
            if (rightProj && rightProj.dist < tol) {
                const rightProj2 = arq2_projectPointOnPolyline(p2, street.right);
                if (rightProj2 && rightProj2.dist < tol) {
                    matchedStreet = street;
                    matchedBorder = 'right';
                    proj1 = rightProj;
                    proj2 = rightProj2;
                    break;
                }
            }
        }
        
        if (matchedStreet && matchedBorder && proj1 && proj2) {
            const border = matchedBorder === 'left' ? matchedStreet.left : matchedStreet.right;
            const segmentPoints = [];
            
            const idx1 = proj1.idx, idx2 = proj2.idx;
            const t1 = proj1.t, t2 = proj2.t;
            
            segmentPoints.push(proj1.point);
            
            if (idx1 < idx2 || (idx1 === idx2 && t1 < t2)) {
                for (let k = idx1 + 1; k <= idx2; k++) {
                    segmentPoints.push(border[k]);
                }
            } else if (idx1 > idx2 || (idx1 === idx2 && t1 > t2)) {
                for (let k = idx1; k > idx2; k--) {
                    segmentPoints.push(border[k]);
                }
            }
            segmentPoints.push(proj2.point);
            
            for (let k = 0; k < segmentPoints.length - 1; k++) {
                stitched.push(segmentPoints[k]);
            }
        } else {
            stitched.push(p1);
        }
    }
    return stitched;
}
function arq2_insertVerticesIntoMatchingEdges(lineId) {
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line?.puntos || line.puntos.length < 3) return;
    const proj = getPanoramaScreenProjector();
    
    allDrawnLines.forEach(other => {
        if (other.id === lineId) return;
        const oPts = arq2_getSewPolygonPoints(other);
        if (!oPts || oPts.length < 3) return;
        if (other.tipo === 'divisoria' || other.tipo === 'cortar' || other.tipo === 'linea-pines-guia') return;
        
        const closed = other.tipo !== 'calle';
        const segCount = closed ? oPts.length : oPts.length - 1;
        
        const insertions = [];
        
        line.puntos.forEach(pt => {
            for (let i = 0; i < segCount; i++) {
                const p1 = oPts[i], p2 = oPts[(i + 1) % oPts.length];
                
                const dToP1 = Math.hypot(pt[0] - p1[0], pt[1] - p1[1]);
                const dToP2 = Math.hypot(pt[0] - p2[0], pt[1] - p2[1]);
                if (dToP1 < 0.02 || dToP2 < 0.02) continue;
                
                let isNear = false;
                let t = 0.5;
                if (proj) {
                    const sPt = proj.toScreen(pt[0], pt[1]);
                    const s1 = proj.toScreen(p1[0], p1[1]);
                    const s2 = proj.toScreen(p2[0], p2[1]);
                    if (sPt && s1 && s2) {
                        const dx = s2[0] - s1[0], dy = s2[1] - s1[1];
                        const len2 = dx * dx + dy * dy;
                        if (len2 > 1e-6) {
                            t = ((sPt[0] - s1[0]) * dx + (sPt[1] - s1[1]) * dy) / len2;
                            if (t > 0.01 && t < 0.99) {
                                const px = s1[0] + t * dx, py = s1[1] + t * dy;
                                const d = Math.hypot(px - sPt[0], py - sPt[1]);
                                if (d < 10) {
                                    isNear = true;
                                }
                            }
                        }
                    }
                } else {
                    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                    const len2 = dx * dx + dy * dy;
                    if (len2 > 1e-8) {
                        t = ((pt[0] - p1[0]) * dx + (pt[1] - p1[1]) * dy) / len2;
                        if (t > 0.01 && t < 0.99) {
                            const px = p1[0] + t * dx, py = p1[1] + t * dy;
                            const d = Math.hypot(px - pt[0], py - pt[1]);
                            if (d < 0.04) {
                                isNear = true;
                            }
                        }
                    }
                }
                
                if (isNear) {
                    insertions.push({ segIdx: i, pt: [...pt], t });
                    break;
                }
            }
        });
        
        if (insertions.length > 0) {
            insertions.sort((a, b) => {
                if (a.segIdx !== b.segIdx) return b.segIdx - a.segIdx;
                return b.t - a.t;
            });
            insertions.forEach(ins => {
                other.puntos.splice(ins.segIdx + 1, 0, ins.pt);
            });
        }
    });
}
function arq2_registerSharedEdges(newLineId) {
    const nue = allDrawnLines.find(l => l.id === newLineId);
    const nuePts = arq2_getSewPolygonPoints(nue);
    if (!nue || !nuePts || nuePts.length < 3) return;
    nue.sharedSegs = nue.sharedSegs || [];
    nue.sharedSegStyles = nue.sharedSegStyles || {};
    nue.sharedSegMeta = nue.sharedSegMeta || {};
    const styleDefault = arq2_getCosturaEstilo(nue);
    const nSeg = nuePts.length;
    const proj = getPanoramaScreenProjector();
    allDrawnLines.forEach(other => {
        if (other.id === newLineId) return;
        const oPts = arq2_getSewPolygonPoints(other);
        if (!oPts || oPts.length < 2) return;
        if (other.tipo === 'divisoria' || other.tipo === 'cortar' || other.tipo === 'linea-pines-guia') return;
        other.sharedSegs = other.sharedSegs || [];
        other.sharedSegStyles = other.sharedSegStyles || {};
        other.sharedSegMeta = other.sharedSegMeta || {};
        const oClosed = other.tipo !== 'calle';
        const oSegCount = oClosed ? oPts.length : oPts.length - 1;
        for (let i = 0; i < nSeg; i++) {
            const a1 = nuePts[i], a2 = nuePts[(i + 1) % nSeg];
            for (let j = 0; j < oSegCount; j++) {
                const b1 = oPts[j], b2 = oPts[(j + 1) % oPts.length];
                if (!arq2_segMatchScreenOrPY(a1, a2, b1, b2, proj, 0.08, 12)) continue;
                if (!nue.sharedSegs.includes(i)) nue.sharedSegs.push(i);
                const oIdx = j % oPts.length;
                const otherAlreadyHadIt = other.sharedSegs.includes(oIdx);
                if (!otherAlreadyHadIt) other.sharedSegs.push(oIdx);
                
                // Determine if they are siblings from a recent attemptSplit
                let areSiblings = false;
                if (nue.id.startsWith('lote_') && other.id.startsWith('lote_')) {
                    const pNue = nue.id.split('_');
                    const pOther = other.id.split('_');
                    if (pNue.length >= 4 && pOther.length >= 4 && pNue[1] === pOther[1] && pNue[3] === pOther[3]) {
                        areSiblings = true;
                    }
                }
                
                let finalStyle = styleDefault;
                let isExteriorForce = false;
                if (!areSiblings) {
                    if (otherAlreadyHadIt && other.sharedSegStyles && other.sharedSegStyles[oIdx]) {
                        finalStyle = other.sharedSegStyles[oIdx];
                    } else {
                        // It was an exterior edge of `other`, so it should remain solid
                        finalStyle = 'solida';
                        isExteriorForce = true;
                    }
                }

                nue.sharedSegStyles[i] = finalStyle;
                other.sharedSegStyles[oIdx] = finalStyle;
                
                const metaNew = { lineId: other.id, segIdx: oIdx };
                if (isExteriorForce || (other.sharedSegMeta && other.sharedSegMeta[oIdx] && other.sharedSegMeta[oIdx].isExteriorForce)) {
                    metaNew.isExteriorForce = true;
                }
                nue.sharedSegMeta[i] = metaNew;
                
                const metaOther = { lineId: nue.id, segIdx: i };
                if (metaNew.isExteriorForce) metaOther.isExteriorForce = true;
                other.sharedSegMeta[oIdx] = metaOther;
            }
        }
    });
}
function arq2_snapVerticesToExisting(points) {
    if (!points || !points.length) return points;
    return points.map(pt => {
        let best = null, bestD = 0.05;
        allDrawnLines.forEach(line => {
            if (!arq2_isUniversalSnapTarget(line)) return;
            if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
                const borders = [line.left || [], line.right || []];
                borders.forEach(border => {
                    border.forEach(v => {
                        const d = Math.hypot(pt[0] - v[0], pt[1] - v[1]);
                        if (d < bestD) { bestD = d; best = v; }
                    });
                });
                return;
            }
            arq2_getSnapPolylinePoints(line).forEach(v => {
                const d = Math.hypot(pt[0] - v[0], pt[1] - v[1]);
                if (d < bestD) { bestD = d; best = v; }
            });
        });
        return best ? [parseFloat(best[0].toFixed(4)), parseFloat(best[1].toFixed(4))] : [...pt];
    });
}
function arq2_weldVerticesToNeighbors(lineId) {
    const nue = allDrawnLines.find(l => l.id === lineId);
    const nuePts = nue?.puntos;
    if (!nuePts || nuePts.length < 3) return;
    const n = nuePts.length;
    allDrawnLines.forEach(other => {
        if (other.id === lineId) return;
        const oPts = arq2_getSewPolygonPoints(other);
        if (!oPts || oPts.length < 2) return;
        if (other.tipo === 'divisoria' || other.tipo === 'cortar') return;
        const oClosed = other.tipo !== 'calle';
        const oSegCount = oClosed ? oPts.length : oPts.length - 1;
        for (let i = 0; i < n; i++) {
            const a1 = nuePts[i], a2 = nuePts[(i + 1) % n];
            for (let j = 0; j < oSegCount; j++) {
                const b1 = oPts[j], b2 = oPts[(j + 1) % oPts.length];
                if (!arq2_segMatchTol(a1, a2, b1, b2, 0.05)) continue;
                const d11 = Math.hypot(a1[0] - b1[0], a1[1] - b1[1]), d22 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
                if (d11 < 0.05 && d22 < 0.05) {
                    nue.puntos[i] = [parseFloat(b1[0].toFixed(4)), parseFloat(b1[1].toFixed(4))];
                    nue.puntos[(i + 1) % n] = [parseFloat(b2[0].toFixed(4)), parseFloat(b2[1].toFixed(4))];
                } else {
                    nue.puntos[i] = [parseFloat(b2[0].toFixed(4)), parseFloat(b2[1].toFixed(4))];
                    nue.puntos[(i + 1) % n] = [parseFloat(b1[0].toFixed(4)), parseFloat(b1[1].toFixed(4))];
                }
            }
        }
    });
}
function arq2_getSharedSegStyle(lineData, segIdx) {
    if (!lineData?.sharedSegs?.includes(segIdx)) return null;
    const meta = lineData.sharedSegMeta?.[segIdx];
    const other = meta ? allDrawnLines.find(l => l.id === meta.lineId) : null;
    if (other && (other.tipo === 'calle-curva-arq2' || other.tipo === 'calle-curva-arq2-preview' || other.tipo === 'calle')) {
        return 'solida';
    }
    return lineData.sharedSegStyles?.[segIdx] || lineData.costuraEstilo || lineData.costuraStyle || 'punteada';
}
function arq2_setCosturaStyleForLine(lineId, style) {
    const line = allDrawnLines.find(l => l.id === lineId);
    if (!line || !line.sharedSegs?.length) return;
    line.costuraStyle = style;
    line.costuraEstilo = style;
    line.sharedSegs.forEach(i => {
        const meta = line.sharedSegMeta?.[i];
        const other = meta ? allDrawnLines.find(l => l.id === meta.lineId) : null;
        const isStreet = other && (other.tipo === 'calle-curva-arq2' || other.tipo === 'calle-curva-arq2-preview' || other.tipo === 'calle');
        const isExterior = meta?.isExteriorForce;
        const finalStyle = (isStreet || isExterior) ? 'solida' : style;
        
        line.sharedSegStyles[i] = finalStyle;
        if (meta?.lineId && other && other.sharedSegStyles) {
            if (other.sharedSegs?.includes(meta.segIdx)) {
                other.sharedSegStyles[meta.segIdx] = finalStyle;
            }
        }
    });
}
function arq2_selectCosturaLine(lineId) {
    arq2SelectedLineId = lineId;
    document.querySelectorAll('g.lote-organico[data-line-id], g.fila-variable-lote[data-line-id]').forEach(g => {
        g.classList.toggle('arq2-costura-selected', g.getAttribute('data-line-id') === lineId);
    });
    arq2_updatePanelStep();
}
function arq2_toggleSelectedCosturaStyle() {
    if (!arq2SelectedLineId) return;
    const line = allDrawnLines.find(l => l.id === arq2SelectedLineId);
    if (!line?.sharedSegs?.length) return;
    const cur = line.sharedSegStyles?.[line.sharedSegs[0]] || line.costuraStyle || 'punteada';
    const next = cur === 'punteada' ? 'solida' : 'punteada';
    arq2_setCosturaStyleForLine(arq2SelectedLineId, next);
    syncSVGElements();
    updateSVGPaths();
    saveToLocal();
    arq2_updatePanelStep();
    arq2_setStatusText('Costura lote ' + (line.arq2Numero || line.franjaNumero || '') + ': ' + (next === 'punteada' ? 'punteada ✓' : 'sólida ✓'));
}
function arq2_clearDemoTimeouts() {
    arq2DemoTimers.forEach(t => clearTimeout(t));
    arq2DemoTimers = [];
}
function arq2_clearDemoTimers() {
    arq2_clearDemoTimeouts();
    if (arq2DemoLoopInterval) { clearInterval(arq2DemoLoopInterval); arq2DemoLoopInterval = null; }
}
function arq2_stopDemoAnimation() {
    arq2DemoActive = false;
    arq2_clearDemoTimers();
    const layer = document.getElementById('arq2-demo-layer');
    if (layer) layer.innerHTML = '';
}
function arq2_ensureDemoLayer() {
    const svg = document.getElementById('loteo-svg');
    if (!svg || document.getElementById('arq2-demo-layer')) return;
    const ns = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(ns, 'g');
    layer.id = 'arq2-demo-layer';
    layer.setAttribute('pointer-events', 'none');
    svg.appendChild(layer);
}
function arq2_getDemoPYPoints() {
    if (!visor360) return { contour: [], divs: [], lotCenters: [] };
    const pitch = visor360.getPitch(), yaw = visor360.getYaw();
    const dp = 3, spread = 3.5, depth = 7;
    const contour = [
        [pitch - dp, yaw - spread * 1.5],
        [pitch - dp, yaw + spread * 1.5],
        [pitch - dp - depth, yaw + spread * 1.2],
        [pitch - dp - depth, yaw - spread * 1.2],
    ];
    const weights = [5000, 5000, 5000, 5000];
    const axes = arq2_detectEjeYFondo(contour);
    if (!axes) return { contour, divs: [], lotCenters: [] };
    const divs = arq2_buildFilaInternalDivisions(axes.ejeFrente, axes.ejeFondo, weights);
    const lotCenters = arq2_computeFilaLotCentroids(axes.ejeFrente, axes.ejeFondo, weights).map(l => l.centroid);
    return { contour, divs, lotCenters };
}
function arq2_pyToScreen(py, getCam, cx, cySc, f) {
    const c = getCam(py[0], py[1]);
    if (c.z <= 0.0001) return null;
    return { x: cx + (c.x / c.z) * f, y: cySc - (c.y / c.z) * f };
}
function arq2_demoSchedule(fn, ms) {
    arq2DemoTimers.push(setTimeout(fn, ms));
}
function arq2_demoMakeLine(root, ns, p1, p2, cls, extraCls) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', 'arq2-demo-stroke ' + cls + (extraCls ? ' ' + extraCls : ''));
    line.setAttribute('data-py', p1[0] + ',' + p1[1]);
    line.setAttribute('data-py2', p2[0] + ',' + p2[1]);
    line.style.opacity = '0';
    root.appendChild(line);
    return line;
}
function arq2_demoMakeCircle(root, ns, py, r, cls) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('class', 'arq2-demo-stroke ' + (cls || ''));
    c.setAttribute('data-py', py[0] + ',' + py[1]);
    c.setAttribute('r', r);
    c.style.opacity = '0';
    root.appendChild(c);
    return c;
}
function arq2_demoMakeText(root, ns, py, text, cls) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('class', 'arq2-demo-label ' + (cls || ''));
    t.setAttribute('data-py', py[0] + ',' + py[1]);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = text;
    t.style.opacity = '0';
    root.appendChild(t);
    return t;
}
function arq2_demoMakeMidLabel(root, ns, p1, p2, text, cls) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('class', 'arq2-demo-label ' + (cls || ''));
    t.setAttribute('data-py-mid', p1[0] + ',' + p1[1] + '|' + p2[0] + ',' + p2[1]);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = text;
    t.style.opacity = '0';
    root.appendChild(t);
    return t;
}
function arq2_demoReveal(el) {
    if (!el) return;
    el.style.opacity = '1';
    el.classList.add('is-visible');
}
function arq2_demoDrawLine(line, delayMs, durationMs) {
    arq2_demoSchedule(() => {
        if (!arq2DemoActive || !line) return;
        arq2_updateDemoLayer();
        const len = parseFloat(line.style.getPropertyValue('--draw-len')) || 100;
        line.style.strokeDasharray = len;
        line.style.strokeDashoffset = len;
        line.style.opacity = '1';
        line.classList.add('is-drawing');
        requestAnimationFrame(() => {
            line.style.transition = 'stroke-dashoffset ' + durationMs + 'ms linear';
            line.style.strokeDashoffset = '0';
        });
        arq2_demoSchedule(() => line.classList.add('is-drawn'), durationMs);
    }, delayMs);
}
function arq2_updateDemoLayer() {
    if (!arq2DemoActive || !visor360) return;
    const layer = document.getElementById('arq2-demo-layer');
    if (!layer || !layer.childNodes.length) return;
    const ctx = arq2_getCameraContext();
    if (!ctx) return;
    const { getCam, cx, cy_screen, f } = ctx;
    layer.querySelectorAll('[data-py]').forEach(el => {
        const parts = el.getAttribute('data-py').split(',').map(Number);
        const sc = arq2_pyToScreen(parts, getCam, cx, cy_screen, f);
        if (!sc) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        if (el.tagName === 'circle') {
            el.setAttribute('cx', sc.x);
            el.setAttribute('cy', sc.y);
        } else if (el.tagName === 'line') {
            const p2 = el.getAttribute('data-py2');
            if (!p2) return;
            const parts2 = p2.split(',').map(Number);
            const sc2 = arq2_pyToScreen(parts2, getCam, cx, cy_screen, f);
            if (!sc2) { el.style.visibility = 'hidden'; return; }
            el.setAttribute('x1', sc.x);
            el.setAttribute('y1', sc.y);
            el.setAttribute('x2', sc2.x);
            el.setAttribute('y2', sc2.y);
            const len = Math.hypot(sc2.x - sc.x, sc2.y - sc.y);
            el.style.setProperty('--draw-len', len);
            if (el.classList.contains('arq2-demo-draw-line') && !el.classList.contains('is-drawn')) {
                el.style.strokeDasharray = len;
                if (!el.classList.contains('is-drawing')) el.style.strokeDashoffset = len;
            }
        } else if (el.tagName === 'text') {
            el.setAttribute('x', sc.x);
            el.setAttribute('y', sc.y);
        }
    });
    layer.querySelectorAll('[data-py-mid]').forEach(el => {
        const [p1s, p2s] = el.getAttribute('data-py-mid').split('|');
        const a = p1s.split(',').map(Number), b = p2s.split(',').map(Number);
        const sc1 = arq2_pyToScreen(a, getCam, cx, cy_screen, f), sc2 = arq2_pyToScreen(b, getCam, cx, cy_screen, f);
        if (!sc1 || !sc2) { el.style.visibility = 'hidden'; return; }
        el.style.visibility = 'visible';
        el.setAttribute('x', (sc1.x + sc2.x) / 2);
        el.setAttribute('y', (sc1.y + sc2.y) / 2 - 14);
    });
}
function arq2_runDemoCycle() {
    if (!arq2DemoActive || !visor360) return;
    arq2_clearDemoTimeouts();
    arq2_ensureDemoLayer();
    const layer = document.getElementById('arq2-demo-layer');
    if (!layer) return;
    const ns = 'http://www.w3.org/2000/svg';
    layer.innerHTML = '';
    arq2DemoPY = arq2_getDemoPYPoints();
    const root = document.createElementNS(ns, 'g');
    root.classList.add('arq2-demo-root');
    layer.appendChild(root);
    const { contour, divs, lotCenters } = arq2DemoPY;
    const contourLines = [], divLines = [], lotNums = [];
    for (let i = 0; i < contour.length; i++) {
        contourLines.push(arq2_demoMakeLine(root, ns, contour[i], contour[(i + 1) % contour.length], 'arq2-demo-draw-line'));
    }
    divs.forEach(d => divLines.push(arq2_demoMakeLine(root, ns, d[0], d[1], 'arq2-demo-draw-line arq2-demo-div-line')));
    const pt0 = arq2_demoMakeCircle(root, ns, contour[0], 7, 'arq2-demo-point');
    const lblContour = arq2_demoMakeMidLabel(root, ns, contour[0], contour[1], 'CONTORNO ✓ (Enter)', 'arq2-demo-tag');
    const lblScale = arq2_demoMakeText(root, ns, lotCenters[1] || contour[0], '📐 Divisiones proporcionales al m²', 'arq2-demo-tag arq2-demo-center-tag');
    lotCenters.forEach((c, i) => {
        lotNums.push(arq2_demoMakeCircle(root, ns, c, 10, 'arq2-demo-lot-circle'));
        lotNums.push(arq2_demoMakeText(root, ns, c, String(i + 1).padStart(2, '0'), 'arq2-demo-lot-num'));
    });
    arq2_updateDemoLayer();
    arq2_demoSchedule(() => arq2_demoReveal(pt0), 0);
    arq2_demoSchedule(() => pt0.classList.add('arq2-demo-pulse'), 0);
    contourLines.forEach((ln, i) => arq2_demoDrawLine(ln, 300 + i * 350, 380));
    arq2_demoSchedule(() => arq2_demoReveal(lblContour), 1200);
    divLines.forEach((ln, i) => arq2_demoDrawLine(ln, 2200 + i * 120, 320));
    lotNums.forEach((el, i) => arq2_demoSchedule(() => { arq2_demoReveal(el); el.classList.add('arq2-demo-pop'); }, 3000 + i * 120));
    arq2_demoSchedule(() => arq2_demoReveal(lblScale), 3600);
    arq2_demoSchedule(() => root.classList.add('arq2-demo-fadeout'), 4800);
}
function arq2_startDemoAnimation(forceReplay) {
    if (!isArquitecto2Active || arq2Tool !== 'fila-variable') return;
    if (arq2LinePoints.length > 0) return;
    if (arq2DemoActive && !forceReplay) return;
    arq2_stopDemoAnimation();
    arq2DemoActive = true;
    arq2_ensureDemoLayer();
    arq2_runDemoCycle();
    arq2DemoLoopInterval = setInterval(() => {
        if (arq2_shouldRunFilaDemo()) arq2_runDemoCycle();
        else arq2_stopDemoAnimation();
    }, 6000);
}
function arq2_shouldRunFilaDemo() {
    return isArquitecto2Active && arq2Tool === 'fila-variable' && arq2LinePoints.length === 0 && !document.getElementById('franja-lotes-modal')?.classList.contains('open');
}
function arq2_getNextLoteNumero() {
    let max = 0;
    allDrawnLines.forEach(l => {
        const n = parseInt(l.arq2Numero || l.franjaNumero || '0', 10);
        if (!isNaN(n) && n > max) max = n;
    });
    return String(max + 1).padStart(2, '0');
}
function arq2_applyAutoFill(entry) {
    const autoNum = arq2Tool === 'relleno-auto';
    let numero = arq2_getNextLoteNumero();
    if (!autoNum) {
        const inp = prompt('Número de lote (Enter = correlativo):', numero);
        if (inp === null) return false;
        if (inp.trim()) numero = inp.trim().padStart(2, '0');
    }
    entry.arq2Numero = numero;
    entry.franjaNumero = numero;
    entry.loteStatus = 'disponible';
    return true;
}
function arq2_setStatusText(msg) {
    const el = document.getElementById('arq2-status');
    if (el) el.textContent = msg;
}
function arq2_clearDraft() {
    arq2LinePoints = [];
    arq2TempLineId = 'arq2_temp_' + Date.now();
    arq2CosturaSnap = null;
    arq2SelectedLineId = null;
    arq2FilaVariableContorno = null;
    arq2PendingFila = null;
    arq2Guideline = null;
    arq2_clearVisualFeedback();
    arq2_stopDemoAnimation();
    document.querySelectorAll('.arq2-costura-selected').forEach(g => g.classList.remove('arq2-costura-selected'));
    if (snapCursor) snapCursor.classList.remove('is-costura', 'active');
    arq2_updatePanelStep();
}
function arq2_setTool(tool) {
    arq2Tool = tool;
    arq2_clearDraft();
    arq2_ensurePanelExtras();
    document.querySelectorAll('.arq2-tool-btn').forEach(b => b.classList.toggle('active', b.dataset.arq2Tool === tool));
    arq2_updatePanelStep();
    if (tool === 'fila-variable' && isArquitecto2Active) arq2_startDemoAnimation(false);
}
function arq2_toggleArquitecto2(force) {
    if (typeof force === 'boolean') isArquitecto2Active = force;
    else isArquitecto2Active = !isArquitecto2Active;
    document.body.classList.toggle('arq2-active', isArquitecto2Active);
    if (!isArquitecto2Active) {
        arq2_clearDraft();
        arq2_stopDemoAnimation();
        closeFranjaLotesModal();
        refreshAllHotspots(true);
    } else {
        arq2_ensureFeedbackLayer();
        arq2_ensureDemoLayer();
        arq2_ensurePanelExtras();
        arq2_ensureSmoothIntensityPanel();
        arq2_setTool(arq2Tool);
        refreshAllHotspots(true);
    }
}
function arq2_buildNonSharedEdgePaths(pts, sharedSegs, isClosed, getCamFn, cx, cySc, f) {
    let d = '';
    const segN = isClosed ? pts.length : pts.length - 1;
    for (let i = 0; i < segN; i++) {
        if (sharedSegs && sharedSegs.includes(i)) continue;
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        const c1 = getCamFn(p1[0], p1[1]), c2 = getCamFn(p2[0], p2[1]);
        if (c1.z <= 0.0001 && c2.z <= 0.0001) continue;
        let s1, s2;
        if (c1.z > 0.0001) s1 = { x: cx + (c1.x / c1.z) * f, y: cySc - (c1.y / c1.z) * f };
        else { const t = c1.z / (c1.z - c2.z); s1 = { x: cx + ((c1.x + t * (c2.x - c1.x)) / 0.0001) * f, y: cySc - ((c1.y + t * (c2.y - c1.y)) / 0.0001) * f }; }
        if (c2.z > 0.0001) s2 = { x: cx + (c2.x / c2.z) * f, y: cySc - (c2.y / c2.z) * f };
        else { const t = c2.z / (c2.z - c1.z); s2 = { x: cx + ((c2.x + t * (c1.x - c2.x)) / 0.0001) * f, y: cySc - ((c2.y + t * (c1.y - c2.y)) / 0.0001) * f }; }
        const seg = `M ${s1.x},${s1.y} L ${s2.x},${s2.y} `;
        d += seg;
    }
    return d;
}
function arq2_buildSegmentPaths(pts, sharedSegs, isClosed, getCamFn, cx, cySc, f, costuraDefault) {
    return arq2_buildSharedEdgePaths(pts, sharedSegs, null, isClosed, getCamFn, cx, cySc, f, costuraDefault);
}
function arq2_finishLoteOrganico(rawPoints, useCostura) {
    if (!rawPoints || rawPoints.length < 3) return;
    const snappedRaw = useCostura ? arq2_snapVerticesToExisting(rawPoints) : rawPoints.map(p => [...p]);
    const anchors = snappedRaw.map(p => [...p]);
    const smoothIntensity = arq2SmoothIntensity;
    let smoothed = arq2_adaptiveSmooth(snappedRaw, null, smoothIntensity);
    smoothed = arq2_restoreAnchoredVertices(smoothed, anchors, 0.08);
    smoothed = arq2_stitchOrganicLoteToStreets(smoothed);
    smoothed = arq2_sanitizePolylinePoints(smoothed);
    if (smoothed.length < 3) return;
    const id = 'arq2_org_' + Date.now();
    const costuraEstiloGuardado = useCostura ? (arq2CosturaStyle || 'punteada') : null;
    const entry = { id, tipo: 'lote-organico', puntos: smoothed, sharedSegs: [], sharedSegStyles: {}, sharedSegMeta: {}, suavizadoIntensidad: smoothIntensity };
    if (useCostura) {
        entry.costuraStyle = costuraEstiloGuardado;
        entry.costuraEstilo = costuraEstiloGuardado;
    }
    if (!arq2_applyAutoFill(entry)) return;
    allDrawnLines.push(entry);
    if (useCostura) {
        console.log('Costura guardada:', JSON.parse(JSON.stringify(entry)));
        arq2_insertVerticesIntoMatchingEdges(id);
        arq2_weldVerticesToNeighbors(id);
        arq2_registerSharedEdges(id);
        arq2_mergeSharedBoundaryVertices(id);
        arq2_registerSharedEdges(id);
    }
    const areaPx = arq2_estimatePolygonScreenAreaPx(smoothed);
    if (areaPx < 40) arq2_showSmallShapeSmoothHint(id);
    arq2_clearDraft();
    refreshAllHotspots(true);
    saveToLocal();
    flashScreenSuccess();
    arq2_setStatusText('Lote ' + entry.arq2Numero + ' guardado ✓');
}
function arq2_shouldAutoCloseAt(p, y, isDblClick) {
    const pts = arq2_getActiveDrawPoints();
    const minPts = arq2Tool === 'fila-variable' ? 4 : 3;
    if (pts.length < minPts) return false;
    if (!isNearPolygonOriginPY(p, y, pts[0])) return false;
    return isDblClick || canTriggerPolygonAutoClose();
}
function arq2_tryClosePolygon(isDblClick, p, y) {
    if (arq2Tool === 'calle-curva-arq2') return false;
    const pts = arq2LinePoints;
    const minPts = arq2Tool === 'fila-variable' ? 4 : 3;
    if (pts.length < minPts) return false;
    if (p == null || y == null) return false;
    if (!arq2_shouldAutoCloseAt(p, y, isDblClick)) return false;
    if (arq2Tool === 'fila-variable') arq2_finishFilaContour();
    else arq2_finishLoteOrganico([...pts], arq2Tool === 'costura');
    return true;
}
function arq2_commitFilaVariable(weights) {
    if (!arq2PendingFila?.contorno || !weights?.length) return;
    const contorno = arq2_sanitizePolylinePoints(arq2PendingFila.contorno);
    if (contorno.length < 4) {
        alert('No se pudo generar la fila. Intenta con un contorno más simple (4-6 puntos) y vuelve a intentar.');
        return;
    }
    const axes = arq2_detectEjeYFondo(contorno);
    if (!axes) { alert('⚠ No se pudo detectar frente y fondo del contorno. Usa al menos 4 vértices bien definidos.'); return; }
    const { ejeFrente, ejeFondo } = axes;
    const frontLen = getPolylineLength(ejeFrente), backLen = getPolylineLength(ejeFondo);
    if (frontLen < 1e-6 || backLen < 1e-6) {
        console.warn('[Fila Variable] Ejes con longitud cero', { ejeFrente, ejeFondo, contorno });
        alert('No se pudo generar la fila. Intenta con un contorno más simple (4-6 puntos) y vuelve a intentar.');
        return;
    }
    const divs = arq2_buildFilaInternalDivisions(ejeFrente, ejeFondo, weights);
    const lotCentroids = arq2_computeFilaLotCentroids(ejeFrente, ejeFondo, weights);
    if (contorno.length < 3 || !lotCentroids.length) {
        alert('No se pudo generar la fila. Intenta con un contorno más simple (4-6 puntos) y vuelve a intentar.');
        return;
    }
    const gid = 'arq2_fila_' + Date.now();
    allDrawnLines.push({
        id: gid,
        tipo: 'fila-variable-lote',
        puntos: contorno.map(p => [...p]),
        arq2Grupo: gid,
        arq2FilaLotes: lotCentroids,
        ejeFrente: ejeFrente.map(p => [...p]),
        ejeFondo: ejeFondo.map(p => [...p]),
        sharedSegs: [],
        sharedSegStyles: {},
        loteStatus: 'disponible'
    });
    divs.forEach((pts, idx) => {
        if (!pts?.length || !arq2_isValidPYPoint(pts[0]) || !arq2_isValidPYPoint(pts[1])) return;
        allDrawnLines.push({ id: gid + '_div_' + (idx + 1), tipo: 'divisoria', puntos: pts, arq2Grupo: gid, franjaGrupo: gid });
    });
    arq2_registerSharedEdges(gid);
    arq2_mergeSharedBoundaryVertices(gid);
    arq2PendingFila = null;
    arq2FilaVariableContorno = null;
    arq2_clearDraft();
    syncSVGElements();
    refreshAllHotspots(true);
    saveToLocal();
    flashScreenSuccess();
    arq2_setStatusText('Hilera variable: ' + weights.length + ' lotes — un contorno + ' + divs.length + ' divisiones ✓');
}
function arq2_updateGuideline() {
    if (arq2LinePoints.length === 0) {
        arq2Guideline = null;
        return;
    }
    const lastPt = arq2LinePoints[arq2LinePoints.length - 1];
    const tol = 0.08;
    const streets = allDrawnLines.filter(l => l.tipo === 'calle-curva-arq2');
    for (let street of streets) {
        const leftProj = arq2_projectPointOnPolyline(lastPt, street.left);
        const rightProj = arq2_projectPointOnPolyline(lastPt, street.right);
        
        let border = null, proj = null;
        if (leftProj && leftProj.dist < tol) {
            border = street.left;
            proj = leftProj;
        } else if (rightProj && rightProj.dist < tol) {
            border = street.right;
            proj = rightProj;
        }
        
        if (border && proj) {
            const idx = proj.idx;
            const p1 = border[idx], p2 = border[idx + 1];
            let dx = p2[0] - p1[0];
            let dy = p2[1] - p1[1];
            let len = Math.hypot(dx, dy);
            if (len > 1e-6) {
                let nx = -dy / len;
                let ny = dx / len;
                const otherBorder = border === street.left ? street.right : street.left;
                const midOther = getPointAlongPolyline(otherBorder, 0.5);
                const dPlus = Math.hypot(lastPt[0] + nx * 0.1 - midOther[0], lastPt[1] + ny * 0.1 - midOther[1]);
                const dMinus = Math.hypot(lastPt[0] - nx * 0.1 - midOther[0], lastPt[1] - ny * 0.1 - midOther[1]);
                if (dPlus > dMinus) {
                    nx = -nx;
                    ny = -ny;
                }
                arq2Guideline = {
                    start: [...lastPt],
                    dir: [nx, ny]
                };
                return;
            }
        }
    }
    arq2Guideline = null;
}
function arq2_onPanoramaMove(mock) {
    if (!isArquitecto2Active || !visor360) return;
    window.lastMouseX = mock.clientX;
    window.lastMouseY = mock.clientY;
    
    arq2CosturaSnap = arq2_findNearestEdgeOrVertex(mock.clientX, mock.clientY, arq2TempLineId, 15);
    
    if (!arq2CosturaSnap && arq2Guideline && arq2LinePoints.length > 0 && visor360) {
        const coords = visor360.mouseEventToCoords(mock);
        if (coords && !isNaN(coords[0])) {
            const start = arq2Guideline.start;
            const dir = arq2Guideline.dir;
            const dx = coords[0] - start[0];
            const dy = coords[1] - start[1];
            const s = dx * dir[0] + dy * dir[1];
            if (s > 0) {
                const px = start[0] + s * dir[0];
                const py = start[1] + s * dir[1];
                const distDeg = Math.hypot(coords[0] - px, coords[1] - py);
                if (distDeg < 0.08) {
                    const proj = getPanoramaScreenProjector();
                    if (proj) {
                        const sc = proj.toScreen(px, py);
                        if (sc) {
                            arq2CosturaSnap = {
                                pitch: px,
                                yaw: py,
                                screenX: DOMCache.viewport.left + sc[0],
                                screenY: DOMCache.viewport.top + sc[1],
                                kind: 'guideline'
                            };
                        }
                    }
                }
            }
        }
    }
    
    if (snapCursor) {
        if (arq2CosturaSnap) {
            snapCursor.style.left = arq2CosturaSnap.screenX + 'px';
            snapCursor.style.top = arq2CosturaSnap.screenY + 'px';
            snapCursor.classList.add('active', 'is-costura');
            snapCursor.classList.remove('is-closing', 'is-calle-finish', 'is-calle-edge');
        } else {
            snapCursor.classList.remove('active', 'is-costura', 'is-closing', 'is-calle-finish', 'is-calle-edge');
        }
    }
    arq2_refreshFeedbackVisuals(mock);
    syncSVGElements();
    updateSVGPaths();
}
function arq2_onPanoramaClick(mock, isDblClick) {
    if (!isArquitecto2Active || !visor360) return;
    if (document.getElementById('franja-lotes-modal')?.classList.contains('open')) return;
    const coords = visor360.mouseEventToCoords(mock);
    if (!coords || isNaN(coords[0])) return;
    let p = parseFloat(coords[0].toFixed(3)), y = parseFloat(coords[1].toFixed(3));
    if (arq2CosturaSnap) {
        p = parseFloat(arq2CosturaSnap.pitch.toFixed(3));
        y = parseFloat(arq2CosturaSnap.yaw.toFixed(3));
    }
    if (arq2_tryClosePolygon(isDblClick, p, y)) { lastArq2DrawClickMs = Date.now(); return; }
    if (arq2Tool === 'costura' && arq2LinePoints.length === 0 && !arq2CosturaSnap) {
        const selId = findClosestLineAtScreen(mock.clientX, mock.clientY, 28);
        const sel = selId && allDrawnLines.find(l => l.id === selId);
        if (sel && (sel.tipo === 'lote-organico' || sel.tipo === 'fila-variable-lote') && sel.sharedSegs?.length) {
            arq2_selectCosturaLine(selId);
            return;
        }
    }
    if (arq2Tool === 'fila-variable' && arq2LinePoints.length === 0) arq2_stopDemoAnimation();
    arq2SelectedLineId = null;
    document.querySelectorAll('.arq2-costura-selected').forEach(g => g.classList.remove('arq2-costura-selected'));
    arq2LinePoints.push([p, y]);
    arq2_updateGuideline();
    lastArq2DrawClickMs = Date.now();
    arq2_refreshFeedbackVisuals(mock);
    refreshAllHotspots(true);
    syncSVGElements();
    updateSVGPaths();
}
function arq2_onEnterKey() {
    if (!isArquitecto2Active) return false;
    if (arq2Tool === 'calle-curva-arq2' && arq2LinePoints.length >= 2) {
        arq2_finishCalleCurva();
        return true;
    }
    if (arq2Tool === 'fila-variable' && arq2LinePoints.length >= 4) {
        arq2_finishFilaContour();
        return true;
    }
    if (arq2Tool !== 'fila-variable' && arq2Tool !== 'calle-curva-arq2' && arq2LinePoints.length >= 3) {
        arq2_finishLoteOrganico([...arq2LinePoints], arq2Tool === 'costura');
        return true;
    }
    return false;
}
function arq2_setup() {
    document.getElementById('arq2-panel-close')?.addEventListener('click', () => arq2_toggleArquitecto2(false));
    document.querySelectorAll('.arq2-tool-btn').forEach(btn => btn.addEventListener('click', () => arq2_setTool(btn.dataset.arq2Tool)));
    ['arq2-panel', 'franja-lotes-modal'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('mousedown', e => e.stopPropagation());
        el.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    });
    document.getElementById('arq2-smooth-toggle')?.addEventListener('change', (e) => {
        arq2SmoothCurves = !!e.target.checked;
        arq2SmoothIntensity = arq2SmoothCurves ? Math.max(1, arq2SmoothIntensity || 5) : 0;
        arq2_syncSmoothIntensityUI();
        arq2_updatePanelStep();
    });
    arq2_ensureSmoothIntensityPanel();
    document.getElementById('arq2-costura-punteada')?.addEventListener('click', () => {
        arq2CosturaStyle = 'punteada';
        if (arq2SelectedLineId) arq2_setCosturaStyleForLine(arq2SelectedLineId, 'punteada');
        arq2_updatePanelStep();
        updateSVGPaths();
    });
    document.getElementById('arq2-costura-solida')?.addEventListener('click', () => {
        arq2CosturaStyle = 'solida';
        if (arq2SelectedLineId) arq2_setCosturaStyleForLine(arq2SelectedLineId, 'solida');
        arq2_updatePanelStep();
        updateSVGPaths();
    });
    document.getElementById('arq2-costura-toggle-selected')?.addEventListener('click', arq2_toggleSelectedCosturaStyle);
    document.getElementById('arq2-fila-demo-replay')?.addEventListener('click', () => arq2_startDemoAnimation(true));
    arq2_ensurePanelExtras();
    arq2_ensureSmoothIntensityPanel();
    arq2_updatePanelStep();
}

function shouldClosePolygonLine(lineId, lineData) {
    if (!lineData) return false;
    if (lineData.tipo === 'calle' || lineData.tipo === 'cortar' || lineData.tipo === 'calle-curva-arq2' || lineData.tipo === 'calle-curva-arq2-preview' || lineData.tipo === 'divisoria' || lineData.tipo === 'borde-macro' || lineData.tipo === 'arista_solida' || lineData.tipo === 'arista_punteada') return false;
    if (lineData.tipo === 'franja-preview-div' || lineData.tipo === 'linea-pines-guia') return false;
    if (lineId === currentTempLineId || lineId === lineaPinesTempId || lineId === arq2TempLineId) return false;
    if (lineData.tipo === 'lote-organico-preview') return false;
    if (lineData.tipo === 'franja-preview') return lineId === 'franja_preview_quad' || lineId === 'franja_curva_preview_strip';
    if (lineData.tipo === 'franja-curva-grupo') return true;
    if (lineData.tipo === 'lote-organico' || lineData.tipo === 'fila-variable-lote') return true;
    return true;
}

// --- MOTOR GEOMÉTRICO FRANJA CURVA ---
function getPolylineLength(pts) { let len = 0; for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]); return len; }
function getPointAlongPolyline(pts, t) {
    if (!pts || pts.length < 2) return pts?.[0] ? [...pts[0]] : null;
    if (t <= 0) return [...pts[0]]; if (t >= 1) return [...pts[pts.length - 1]];
    const totalLen = getPolylineLength(pts);
    if (totalLen < 1e-8) return [...pts[0]];
    const target = totalLen * t; let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
        if (d < 1e-10) continue;
        if (acc + d >= target) { const segT = (target - acc) / d; return [pts[i][0] + (pts[i+1][0] - pts[i][0]) * segT, pts[i][1] + (pts[i+1][1] - pts[i][1]) * segT]; }
        acc += d;
    }
    return [...pts[pts.length - 1]];
}
function extractPolylineSegment(pts, tStart, tEnd) {
    const len = getPolylineLength(pts), dStart = len * tStart, dEnd = len * tEnd, res = [getPointAlongPolyline(pts, tStart)];
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
        if (acc + d > dStart && acc < dEnd) res.push([...pts[i+1]]);
        acc += d;
    }
    res.push(getPointAlongPolyline(pts, tEnd));
    return res;
}
function rebuildFranjaCurvaGroup(gid) {
    const grp = allDrawnLines.find(l => l.id === gid && l.tipo === 'franja-curva-grupo');
    if (!grp) return;
    const N = grp.franjaCount || 2;
    const splits = ensureFranjaSplits(grp);
    allDrawnLines = allDrawnLines.filter(l => l.franjaGrupo !== gid);
    const rails = getFranjaSplitRailPoints(grp);
    if (!rails) return;
    const { topPts, botPts } = rails;
    const draftPolys = [];
    for (let i = 0; i < N; i++) {
        const topSeg = extractPolylineSegment(grp.frente, splits[i], splits[i + 1]);
        const botSeg = extractPolylineSegment(grp.fondo, splits[i], splits[i + 1]).reverse();
        draftPolys.push({
            id: gid + '_' + i, tipo: 'solida', franjaGrupo: gid, franjaIdx: i,
            franjaNumero: String(i + 1).padStart(2, '0'),
            puntos: [...topSeg, ...botSeg]
        });
    }
    const { invisibleFills, macroLines } = buildAutoMacroFromLotes(draftPolys);
    let edges = injectFranjaInternalDivisorias(macroLines, gid, topPts, botPts, N);
    invisibleFills.forEach((f, i) => { f.franjaGrupo = gid; f.franjaIdx = i; f.franjaNumero = draftPolys[i].franjaNumero; f.id = gid + '_' + i; });
    edges.forEach(m => { m.franjaGrupo = gid; });
    allDrawnLines.push(...invisibleFills, ...edges);
    document.body.classList.add('auto-macro-active');
}

document.addEventListener("DOMContentLoaded", async () => {
    if (window.self !== window.top) document.body.classList.add('is-embedded');
    if (isTouchDevice()) { isWebGLSupported = true; viewerGpuReady = false; } else { isWebGLSupported = detectWebGL(); }
    const splashBar = document.getElementById('js-progress-bar'); if (splashBar) splashBar.style.width = '30%';
    await fetchMasterData(); if (splashBar) splashBar.style.width = '60%'; await fetchValorUFOnline(); initAutoMacroFromData();
    snapCursor = document.getElementById('snap-cursor'); ghostPin = document.getElementById('ghost-pin');
    const container = document.getElementById('panorama-container');
    const resizeObserver = new ResizeObserver(entries => { for (let entry of entries) { const rect = entry.target.getBoundingClientRect(); DOMCache.viewport.w = rect.width; DOMCache.viewport.h = rect.height; DOMCache.viewport.left = rect.left; DOMCache.viewport.top = rect.top; } if (isTouchDevice() && visor360 && viewerGpuReady) { const renderer = visor360.getRenderer(); if (renderer && typeof renderer.resize === 'function') renderer.resize(); } });
    resizeObserver.observe(container); const initialRect = container.getBoundingClientRect(); DOMCache.viewport.w = initialRect.width; DOMCache.viewport.h = initialRect.height; DOMCache.viewport.left = initialRect.left; DOMCache.viewport.top = initialRect.top;
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svgEl.id = "loteo-svg"; document.body.appendChild(svgEl);
    setupUI(); setupFilters(); renderSidebarList(BaseDatosLotes); setupPegmanEngine(); setupGesturalBackdoor();
    initPannellum(); runSplashScreen(); setupDevModes(); arq2_setup(); setupModalEditor(); setupInAppModal(); setupGlobalDelegation(); setupSunEngine(); setupNavPinTouchInteractions();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
        document.documentElement.classList.add('is-admin-editor');
        document.body.classList.add('is-admin-editor');
        document.querySelector('.premium-header')?.style.setProperty('display','none'); document.querySelector('.premium-dock')?.style.setProperty('display','none'); document.getElementById('promo-banner-hud')?.style.setProperty('display','none'); document.getElementById('js-poi-trigger')?.style.setProperty('display','none');
        document.querySelectorAll('.export-ai').forEach(btn => { btn.innerText = "💾 GUARDAR EN NUBE"; btn.title = "Envía los trazos directamente a GitHub mediante el Panel"; });
        setTimeout(() => { togglePinsMode(true); window.parent.postMessage({ type: 'EDITOR_READY', vista: FRESIA_CFG.vista }, '*'); }, 3500);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && window.self !== window.top) {
                e.preventDefault();
                e.stopPropagation();
                window.parent.postMessage({ type: 'ADMIN_CLOSE_FULLSCREEN' }, '*');
            }
        }, true);
    }
});

function setupGesturalBackdoor() {
    let backdoorTimer = null; let backdoorStartTouches = [];
    document.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { let sumY = 0; backdoorStartTouches = []; for(let i=0; i<2; i++) { sumY += e.touches[i].clientY; backdoorStartTouches.push(e.touches[i].clientY); } let avgY = sumY / 2; let isTop = avgY < (window.innerHeight * 0.4); let isBottom = avgY > (window.innerHeight * 0.6); if (isTop || isBottom) { backdoorTimer = setTimeout(() => { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); if (isTop) { toggleDrawMode(false); togglePinsMode(!isDevModePinsActive); } else if (isBottom) { togglePinsMode(false); toggleDrawMode(!isDevModeDrawActive); } backdoorTimer = null; }, 3000); } } else { clearTimeout(backdoorTimer); backdoorTimer = null; } }, {passive: true});
    document.addEventListener('touchmove', (e) => { if (backdoorTimer && e.touches.length === 2) { let moveDist = Math.abs(e.touches[0].clientY - backdoorStartTouches[0]); if (moveDist > 40) { clearTimeout(backdoorTimer); backdoorTimer = null; } } else { clearTimeout(backdoorTimer); backdoorTimer = null; } }, {passive: true});
    document.addEventListener('touchend', () => { clearTimeout(backdoorTimer); backdoorTimer = null; });
    document.addEventListener('touchcancel', () => { clearTimeout(backdoorTimer); backdoorTimer = null; });
}

function runSplashScreen() { setTimeout(() => { document.getElementById('js-progress-bar').style.width = '100%'; }, 100); setTimeout(() => { document.getElementById('splash-screen').classList.add('hidden'); }, 2500); }

function getHotspotsConfig() {
    const hotspots = []; const activeBtn = document.querySelector(".filter-btn.active"); const filtroStatus = activeBtn ? activeBtn.getAttribute("data-status") : "todos"; let favs = JSON.parse(localStorage.getItem('mp360_favs') || '[]');
    BaseDatosLotes.forEach((item, index) => { let uniqueId = item.id ? "lote_" + item.id : "lote_fallback_" + index; if (item.tipo === "lote") { if (filtroStatus === "todos" || item.status === filtroStatus || (filtroStatus === "favoritos" && favs.includes(item.id))) { hotspots.push({ "id": uniqueId, "pitch": item.pitch, "yaw": item.yaw, "createTooltipFunc": generarSmartPin, "createTooltipArgs": item }); } } else if (item.tipo === "vista360" && (filtroStatus === "todos" || filtroStatus === "favoritos")) { hotspots.push({ "id": uniqueId, "pitch": item.pitch, "yaw": item.yaw, "createTooltipFunc": generarPin360, "createTooltipArgs": item }); } else if (item.tipo === "casa360" && (filtroStatus === "todos" || filtroStatus === "favoritos")) { hotspots.push({ "id": uniqueId, "pitch": item.pitch, "yaw": item.yaw, "createTooltipFunc": generarMarcadorCasa360, "createTooltipArgs": item }); } });
    PuntosHorizonte.forEach((punto, index) => { 
        let uniqueId = punto.id ? "horiz_" + punto.id : "horiz_fallback_" + index; 
        if(punto.tipo === 'ruta') {
            hotspots.push({ "id": uniqueId, "pitch": punto.pitch, "yaw": punto.yaw, "createTooltipFunc": generarMarcadorRuta, "createTooltipArgs": punto });
        } else {
            hotspots.push({ "id": uniqueId, "pitch": punto.pitch, "yaw": punto.yaw, "createTooltipFunc": generarMarcadorHorizonte, "createTooltipArgs": punto }); 
        }
    });
    if (isSvgRenderAllowed()) {
        allDrawnLines.forEach(linea => {
            if (linea.tipo === 'calle' && linea.puntos.length >= 2) {
                const st = getCalleStyleForLine(linea);
                const mid = getCalleMidpointPY(linea.puntos);
                if (mid && st.showLabel) hotspots.push({ "id": "calle_lbl_" + linea.id, "pitch": mid[0], "yaw": mid[1], "createTooltipFunc": renderCalleServidumbreLabel, "createTooltipArgs": { lineId: linea.id, labelScale: st.labelScale } });
                if (isDevModeDrawActive && mid) hotspots.push({ "id": "calle_move_" + linea.id, "pitch": mid[0], "yaw": mid[1], "createTooltipFunc": renderCalleMoveHandle, "createTooltipArgs": { lineId: linea.id } });
            }
        });
    }
    if (isSvgRenderAllowed() && isDevModePinsActive && isLineaPinesActive) {
        lineaPinesPoints.forEach((coord, idx) => {
            hotspots.push({ "id": "linea_pins_pt_" + idx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: lineaPinesTempId, type: 'linea-pines-guia', isGuide: false, idx: idx, hsId: "linea_pins_pt_" + idx } });
        });
    }
    if(isSvgRenderAllowed() && isDevModeDrawActive) {
        allDrawnLines.forEach((linea) => {
            if (linea.tipo === 'franja-grupo' || linea.tipo === 'franja-curva-grupo') {
                if (linea.tipo === 'franja-grupo') {
                    linea.puntos.forEach((coord, pIdx) => {
                        hotspots.push({ "id": "vert_franja_corner_" + linea.id + "_" + pIdx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: linea.id, type: linea.tipo, isGuide: true, isFranjaCorner: true, idx: pIdx, hsId: "vert_franja_corner_" + linea.id + "_" + pIdx } });
                    });
                } else {
                    const nF = linea.frente.length - 1, nB = linea.fondo.length - 1;
                    linea.frente.forEach((coord, pIdx) => {
                        const isEnd = pIdx === 0 || pIdx === nF;
                        hotspots.push({ "id": "vert_fcurva_frente_" + linea.id + "_" + pIdx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: linea.id, type: linea.tipo, isGuide: true, isFranjaCorner: isEnd, isFranjaElastic: !isEnd, idx: pIdx, target: 'frente', hsId: "vert_fcurva_frente_" + linea.id + "_" + pIdx } });
                    });
                    linea.fondo.forEach((coord, pIdx) => {
                        const isEnd = pIdx === 0 || pIdx === nB;
                        hotspots.push({ "id": "vert_fcurva_fondo_" + linea.id + "_" + pIdx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: linea.id, type: linea.tipo, isGuide: true, isFranjaCorner: isEnd, isFranjaElastic: !isEnd, idx: pIdx, target: 'fondo', hsId: "vert_fcurva_fondo_" + linea.id + "_" + pIdx } });
                    });
                }
                const N = linea.franjaCount || 2;
                const splits = ensureFranjaSplits(linea);
                let built = null;
                if (linea.tipo === 'franja-grupo') {
                    built = buildFranjaPointsFromCorners(linea.puntos[0], linea.puntos[1], linea.puntos[2], linea.puntos[3], N, splits);
                } else {
                    built = { topPts: [], botPts: [] };
                    for (let i = 0; i <= N; i++) {
                        built.topPts.push(getPointAlongPolyline(linea.frente, splits[i]));
                        built.botPts.push(getPointAlongPolyline(linea.fondo, splits[i]));
                    }
                }
                if (built && linea.tipo === 'franja-grupo') {
                    for (let di = 1; di < N; di++) {
                        const cP = (built.topPts[di][0] + built.botPts[di][0]) / 2;
                        const cY = (built.topPts[di][1] + built.botPts[di][1]) / 2;
                        const proj = getPanoramaScreenProjector();
                        const stripRect = getFranjaGrupoScreenRects().find(r => r.gid === linea.id);
                        if (proj && stripRect) {
                            const sc = proj.toScreen(cP, cY);
                            if (!sc || sc[0] < stripRect.left - 20 || sc[0] > stripRect.right + 20 || sc[1] < stripRect.top - 20 || sc[1] > stripRect.bottom + 20) continue;
                        }
                        hotspots.push({ "id": "franja_div_" + linea.id + "_" + di, "pitch": cP, "yaw": cY, "createTooltipFunc": renderFranjaDivHandle, "createTooltipArgs": { gid: linea.id, splitIdx: di } });
                    }
                }
            } else if (linea.tipo === 'calle') {
                linea.puntos.forEach((coord, pIdx) => {
                    hotspots.push({ "id": "vert_calle_" + linea.id + "_" + pIdx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: linea.id, type: 'calle', isGuide: isDevModeDrawActive, idx: pIdx, hsId: "vert_calle_" + linea.id + "_" + pIdx } });
                });
            } else if (linea.tipo !== 'divisoria' && linea.tipo !== 'borde-macro' && !linea.franjaGrupo) {
                linea.puntos.forEach((coord, pIdx) => {
                    hotspots.push({ "id": "vert_base_" + linea.id + "_" + pIdx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: linea.id, type: linea.tipo, isGuide: isDevModeDrawActive, idx: pIdx, hsId: "vert_base_" + linea.id + "_" + pIdx } });
                });
            }
            if (linea.tipo === 'area-invisible' && linea.franjaNumero && linea.puntos.length >= 3) {
                const parentStrip = getFranjaStripById(linea.franjaGrupo);
                if (parentStrip?.tipo === 'franja-curva-grupo') return;
                if (!isFranjaLotCentroidVisible(linea)) return;
                let cP = 0, cY = 0; linea.puntos.forEach(pt => { cP += pt[0]; cY += pt[1]; });
                cP /= linea.puntos.length; cY /= linea.puntos.length;
                hotspots.push({ "id": "franja_lbl_" + linea.id, "pitch": cP, "yaw": cY, "createTooltipFunc": renderFranjaLotLabel, "createTooltipArgs": { numero: linea.franjaNumero } });
            }
            if (linea.tipo === 'fila-variable-lote' && linea.arq2FilaLotes?.length) {
                linea.arq2FilaLotes.forEach((lot, li) => {
                    if (!lot?.centroid) return;
                    hotspots.push({ "id": "arq2_fila_lbl_" + linea.id + "_" + li, "pitch": lot.centroid[0], "yaw": lot.centroid[1], "createTooltipFunc": renderFranjaLotLabel, "createTooltipArgs": { numero: lot.numero } });
                });
            } else if (linea.tipo === 'lote-organico' && linea.franjaNumero && linea.puntos.length >= 3) {
                let cP = 0, cY = 0; linea.puntos.forEach(pt => { cP += pt[0]; cY += pt[1]; });
                cP /= linea.puntos.length; cY /= linea.puntos.length;
                hotspots.push({ "id": "arq2_lbl_" + linea.id, "pitch": cP, "yaw": cY, "createTooltipFunc": renderFranjaLotLabel, "createTooltipArgs": { numero: linea.franjaNumero } });
            }
        });
        currentLinePoints.forEach((coord, idx) => { hotspots.push({ "id": "temp_base_" + currentTempLineId + "_" + idx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: currentTempLineId, type: currentLineType, isGuide: isDevModeDrawActive, idx: idx, hsId: "temp_base_" + currentTempLineId + "_" + idx } }); });
        if (isArquitecto2Active) {
            arq2LinePoints.forEach((coord, idx) => hotspots.push({ "id": "arq2_temp_" + idx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: arq2TempLineId, type: arq2Tool === 'fila-variable' ? 'lote-organico-preview' : 'lote-libre', isGuide: true, idx, hsId: "arq2_temp_" + idx } }));
        }
        if (currentLineType === 'franja_curva' && franjaCurvaFrente.length > 0) {
            franjaCurvaFrente.forEach((coord, idx) => {
                hotspots.push({ "id": "temp_fcurva_frente_" + idx, "pitch": coord[0], "yaw": coord[1], "createTooltipFunc": renderHiddenVertex, "createTooltipArgs": { lineId: 'franja_curva_preview_frente', type: 'franja-preview', isGuide: true, idx: idx, hsId: "temp_fcurva_frente_" + idx } });
            });
        }
        if (currentLineType === 'calle' && currentLinePoints.length >= 2 && draftCalleShowLabel) {
            const mid = getCalleMidpointPY(currentLinePoints);
            if (mid) hotspots.push({ "id": "calle_lbl_" + currentTempLineId, "pitch": mid[0], "yaw": mid[1], "createTooltipFunc": renderCalleServidumbreLabel, "createTooltipArgs": { lineId: currentTempLineId, isDraft: true, labelScale: draftCalleLabelScale } });
        }
    }
    return hotspots;
}

function syncSVGElements() {
    if(!isSvgRenderAllowed()) return; const svg = document.getElementById('loteo-svg'); if(!svg) return;
    let lBordes = document.getElementById('layer-calles-bordes'), lAsfalto = document.getElementById('layer-calles-asfalto'), lLotes = document.getElementById('layer-lotes'), lAristas = document.getElementById('layer-aristas');
    if(!lBordes) { svg.innerHTML = '<g id="layer-calles-bordes"></g><g id="layer-calles-asfalto"></g><g id="layer-calles-arq2"></g><g id="layer-lotes"></g><g id="layer-aristas"></g>'; lBordes = document.getElementById('layer-calles-bordes'); lAsfalto = document.getElementById('layer-calles-asfalto'); lLotes = document.getElementById('layer-lotes'); lAristas = document.getElementById('layer-aristas'); }
    let lCallesArq2 = document.getElementById('layer-calles-arq2');
    if (!lCallesArq2 && svg) { lCallesArq2 = document.createElementNS("http://www.w3.org/2000/svg", "g"); lCallesArq2.id = 'layer-calles-arq2'; svg.insertBefore(lCallesArq2, lLotes); }
    const currentLineIds = allDrawnLines.map(l => l.id);
    if (currentLinePoints.length > 0) currentLineIds.push(currentTempLineId);
    if (isArquitecto2Active && arq2LinePoints.length > 0) {
        currentLineIds.push(arq2TempLineId);
    }
    if (isLineaPinesActive && lineaPinesPoints.length > 0) currentLineIds.push(lineaPinesTempId);
    if (franjaPreviewQuad) currentLineIds.push('franja_preview_quad'); if (franjaCurvaFrente.length > 0) currentLineIds.push('franja_curva_preview_frente'); if (franjaCurvaPreviewStrip) currentLineIds.push('franja_curva_preview_strip'); franjaPreviewDivs.forEach(d => currentLineIds.push(d.id));
    Array.from(svg.querySelectorAll('[data-line-id]')).forEach(el => { if (!currentLineIds.includes(el.dataset.lineId)) el.remove(); });
    DOMCache.paths = {}; const allLinesData = [...allDrawnLines];
    if (currentLinePoints.length > 0) allLinesData.push({ id: currentTempLineId, tipo: currentLineType === 'franja_curva' ? 'franja-preview' : currentLineType, puntos: currentLinePoints });
    if (isArquitecto2Active && arq2LinePoints.length > 0) {
        if (arq2Tool === 'calle-curva-arq2') allLinesData.push(arq2_getCalleCurvaPreviewLineData());
        else allLinesData.push({ id: arq2TempLineId, tipo: 'lote-organico-preview', puntos: arq2LinePoints });
    }
    if (isLineaPinesActive && lineaPinesPoints.length > 0) allLinesData.push({ id: lineaPinesTempId, tipo: 'linea-pines-guia', puntos: lineaPinesPoints });
    if (franjaPreviewQuad) allLinesData.push({ id: 'franja_preview_quad', tipo: 'franja-preview', puntos: franjaPreviewQuad }); if (franjaCurvaFrente.length > 0) allLinesData.push({ id: 'franja_curva_preview_frente', tipo: 'franja-preview', puntos: franjaCurvaFrente }); if (franjaCurvaPreviewStrip) allLinesData.push({ id: 'franja_curva_preview_strip', tipo: 'franja-preview', puntos: franjaCurvaPreviewStrip }); franjaPreviewDivs.forEach(d => allLinesData.push(d));
    allLinesData.forEach(line => {
        const existingElements = svg.querySelectorAll(`[data-line-id="${line.id}"]`);
        if (existingElements.length === 0) {
            if (line.tipo === 'calle') {
                const pBorde = document.createElementNS("http://www.w3.org/2000/svg", "path"); pBorde.setAttribute("class", "linea-calle-borde"); pBorde.dataset.lineId = line.id; lBordes.appendChild(pBorde);
                const pAsfalto = document.createElementNS("http://www.w3.org/2000/svg", "path"); pAsfalto.setAttribute("class", "linea-calle-asfalto"); pAsfalto.dataset.lineId = line.id; bindSvgEraser(pAsfalto, line.id); lAsfalto.appendChild(pAsfalto); DOMCache.paths[line.id] = { base: [pBorde, pAsfalto] };
            } else if (line.tipo === 'divisoria' || line.tipo === 'borde-macro') {
                const gMacro = document.createElementNS("http://www.w3.org/2000/svg", "g"); gMacro.dataset.lineId = line.id; gMacro.dataset.tipo = line.tipo;
                const pMacro = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pMacro.setAttribute("class", line.tipo === 'divisoria' ? 'linea-divisoria' : 'linea-borde-macro');
                gMacro.appendChild(pMacro); bindSvgEraser(gMacro, line.id); bindSvgEraser(pMacro, line.id); lAristas.appendChild(gMacro); DOMCache.paths[line.id] = { base: [pMacro] };
            } else if (line.tipo === 'arista_solida' || line.tipo === 'arista_punteada') {
                const pEdge = document.createElementNS("http://www.w3.org/2000/svg", "path"); pEdge.dataset.lineId = line.id;
                pEdge.setAttribute("class", line.tipo === 'arista_solida' ? 'linea-mp-perimetro' : 'linea-mp-interna');
                lAristas.appendChild(pEdge); DOMCache.paths[line.id] = { base: [pEdge] };
            } else if (line.tipo === 'franja-grupo' || line.tipo === 'franja-curva-grupo') {
                const gGrp = document.createElementNS("http://www.w3.org/2000/svg", "g"); gGrp.dataset.lineId = line.id; gGrp.dataset.tipo = line.tipo;
                const pGrp = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pGrp.setAttribute("class", "linea-franja-grupo-outline");
                gGrp.appendChild(pGrp); bindSvgEraser(gGrp, line.id); bindSvgEraser(pGrp, line.id); lLotes.appendChild(gGrp); DOMCache.paths[line.id] = { base: [pGrp] };
            } else if (line.tipo === 'franja-preview' || line.tipo === 'franja-preview-div') {
                const gPrev = document.createElementNS("http://www.w3.org/2000/svg", "g"); gPrev.dataset.lineId = line.id; gPrev.dataset.tipo = line.tipo;
                const pPrev = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pPrev.setAttribute("class", line.tipo === 'franja-preview-div' ? 'linea-divisoria' : 'linea-franja-preview');
                gPrev.appendChild(pPrev); (line.tipo === 'franja-preview-div' ? lAristas : lLotes).appendChild(gPrev); DOMCache.paths[line.id] = { base: [pPrev] };
            } else if (line.tipo === 'linea-pines-guia') {
                const pGuide = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pGuide.setAttribute("class", "linea-pines-guia");
                pGuide.dataset.lineId = line.id;
                lAristas.appendChild(pGuide);
                DOMCache.paths[line.id] = { base: [pGuide] };
            } else if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
                const gCalle = document.createElementNS("http://www.w3.org/2000/svg", "g");
                gCalle.dataset.lineId = line.id;
                gCalle.dataset.tipo = line.tipo;
                gCalle.classList.add('calle-curva-arq2-grupo');
                const mkPath = (cls, edge) => {
                    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    p.setAttribute('class', cls);
                    if (edge) p.dataset.edgeRole = edge;
                    return p;
                };
                const pFill = mkPath('linea-calle-arq2-fill');
                const pLeft = mkPath('linea-calle-arq2-borde', 'left');
                const pRight = mkPath('linea-calle-arq2-borde', 'right');
                const pCapStart = mkPath('linea-calle-arq2-borde', 'cap-start');
                const pCapEnd = mkPath('linea-calle-arq2-borde', 'cap-end');
                gCalle.appendChild(pFill);
                gCalle.appendChild(pLeft);
                gCalle.appendChild(pRight);
                gCalle.appendChild(pCapStart);
                gCalle.appendChild(pCapEnd);
                bindSvgEraser(gCalle, line.id);
                lCallesArq2.appendChild(gCalle);
                DOMCache.paths[line.id] = { gNode: gCalle, base: [pFill, pLeft, pRight, pCapStart, pCapEnd] };
            } else if (line.tipo === 'lote-organico' || line.tipo === 'fila-variable-lote') {
                const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
                g.dataset.lineId = line.id;
                g.dataset.tipo = line.tipo;
                g.classList.add('lote-interactivo', line.tipo === 'lote-organico' ? 'lote-organico' : 'fila-variable-lote');
                g.style.isolation = 'isolate';
                g.style.mixBlendMode = 'normal';
                g.setAttribute('data-status', line.loteStatus || 'disponible');
                const pFill = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pFill.setAttribute("class", "linea-organico-fill");
                pFill.dataset.edgeRole = 'fill';
                const pPerimeter = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pPerimeter.setAttribute("class", "linea-organico-perimetro");
                pPerimeter.dataset.edgeRole = 'perimeter';
                const pDash = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pDash.setAttribute("class", "linea-punteada-costura");
                pDash.dataset.edgeRole = 'shared-punteada';
                const pSolidEdge = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pSolidEdge.setAttribute("class", "linea-solida-costura");
                pSolidEdge.dataset.edgeRole = 'shared-solida';
                g.appendChild(pFill);
                g.appendChild(pPerimeter);
                g.appendChild(pDash);
                g.appendChild(pSolidEdge);
                arq2_applyOrganicPathAttrs(pFill, 'fill');
                arq2_applyOrganicPathAttrs(pPerimeter, 'perimeter');
                arq2_applyCosturaEstiloToPath(pDash, 'punteada');
                arq2_applyCosturaEstiloToPath(pSolidEdge, 'solida');
                bindSvgEraser(g, line.id);
                lLotes.appendChild(g);
                DOMCache.paths[line.id] = { gNode: g, base: [pFill, pPerimeter, pDash, pSolidEdge] };
            } else if (line.tipo === 'lote-organico-preview') {
                const gPrev = document.createElementNS("http://www.w3.org/2000/svg", "g");
                gPrev.dataset.lineId = line.id;
                gPrev.dataset.tipo = line.tipo;
                const pPrev = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pPrev.setAttribute("class", "linea-franja-preview");
                arq2_applyOrganicPathAttrs(pPrev, 'preview');
                gPrev.appendChild(pPrev);
                lLotes.appendChild(gPrev);
                DOMCache.paths[line.id] = { base: [pPrev] };
            } else {
                const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.dataset.lineId = line.id; g.dataset.tipo = line.tipo; g.classList.add('lote-interactivo'); 
                const pBase = document.createElementNS("http://www.w3.org/2000/svg", "path"); 
                if (line.tipo === 'masterplan_fill') pBase.setAttribute("class", "linea-relleno-mp"); else if (line.tipo === 'neon') pBase.setAttribute("class", "linea-neon"); else if (line.tipo === 'punteada') pBase.setAttribute("class", "linea-punteada"); else if (line.tipo === 'cortar') pBase.setAttribute("class", "linea-corte"); else if (line.tipo === 'area-invisible') pBase.setAttribute("class", "linea-area-fill"); else pBase.setAttribute("class", "linea-solida");
                if (line.tipo === 'area-invisible') g.setAttribute('data-status', 'disponible');
                g.appendChild(pBase); bindSvgEraser(g, line.id); bindSvgEraser(pBase, line.id); g.addEventListener('touchstart', () => { g.classList.add('hovered'); }, {passive: true}); g.addEventListener('touchend', () => { setTimeout(() => g.classList.remove('hovered'), 1500); }, {passive: true}); lLotes.appendChild(g); DOMCache.paths[line.id] = { gNode: g, base: [pBase] };
            }
        } else {
            if (line.tipo === 'calle') {
                const bordeEl = svg.querySelector(`.linea-calle-borde[data-line-id="${line.id}"]`);
                const asfEl = svg.querySelector(`.linea-calle-asfalto[data-line-id="${line.id}"]`);
                if (bordeEl && bordeEl.parentNode !== lBordes) lBordes.appendChild(bordeEl);
                if (asfEl && asfEl.parentNode !== lAsfalto) lAsfalto.appendChild(asfEl);
                DOMCache.paths[line.id] = { base: [bordeEl, asfEl].filter(Boolean) };
            } else if (line.tipo === 'arista_solida' || line.tipo === 'arista_punteada' || line.tipo === 'linea-pines-guia') {
                const pEl = svg.querySelector(`path[data-line-id="${line.id}"]`);
                const target = lAristas;
                if (pEl && pEl.parentNode !== target) target.appendChild(pEl);
                if (pEl) DOMCache.paths[line.id] = { base: [pEl] };
            } else {
                const gNode = svg.querySelector(`g[data-line-id="${line.id}"]`);
                if (gNode) {
                    gNode.dataset.tipo = line.tipo;
                    const targetLayer = resolveSvgLayerForLine(line, { lBordes, lAsfalto, lLotes, lAristas });
                    if (targetLayer && gNode.parentNode !== targetLayer) targetLayer.appendChild(gNode);
                    const pBase = gNode.querySelector('path');
                    if (pBase) pBase.setAttribute('class', getPathClassForLine(line));
                    if (line.tipo === 'lote-organico' || line.tipo === 'fila-variable-lote') {
                        gNode.style.isolation = 'isolate';
                        gNode.style.mixBlendMode = 'normal';
                        arq2_ensureOrganicPathLayers(gNode, line);
                    } else if (line.tipo === 'calle-curva-arq2' || line.tipo === 'calle-curva-arq2-preview') {
                        const targetLayer = lCallesArq2 || resolveSvgLayerForLine(line, { lBordes, lAsfalto, lLotes, lAristas });
                        if (targetLayer && gNode.parentNode !== targetLayer) targetLayer.appendChild(gNode);
                        let paths = Array.from(gNode.querySelectorAll('path'));
                        while (paths.length < 5) {
                            const pExtra = document.createElementNS("http://www.w3.org/2000/svg", "path");
                            pExtra.setAttribute('class', paths.length === 0 ? 'linea-calle-arq2-fill' : 'linea-calle-arq2-borde');
                            gNode.appendChild(pExtra);
                            paths = Array.from(gNode.querySelectorAll('path'));
                        }
                    }
                    bindSvgEraser(gNode, line.id);
                    if (pBase) bindSvgEraser(pBase, line.id);
                    DOMCache.paths[line.id] = { gNode: gNode, base: Array.from(gNode.querySelectorAll('path')) };
                }
            }
        }
    });
    ensureSvgLayerOrder(svg);
}

function updateSVGPaths() {
    if (isIntroAnimating || !visor360 || !isSvgRenderAllowed()) return;
    const container = document.getElementById('panorama-container'); if(!container) return;
    const w = container.clientWidth, h = container.clientHeight, cp = visor360.getPitch() * Math.PI / 180, cy = visor360.getYaw() * Math.PI / 180, hfov = visor360.getHfov();
    const sin_cp = Math.sin(cp), cos_cp = Math.cos(cp), f = 0.5 * w / Math.tan(hfov * Math.PI / 360), cx = w / 2, cy_screen = h / 2;
    function getCam(pitch, yaw) { const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180, sin_p = Math.sin(p), cos_p = Math.cos(p); let y_diff = y - cy; while (y_diff > Math.PI) y_diff -= 2 * Math.PI; while (y_diff < -Math.PI) y_diff += 2 * Math.PI; const sin_yd = Math.sin(y_diff), cos_yd = Math.cos(y_diff); return { x: cos_p * sin_yd, y: sin_p * cos_cp - cos_p * cos_yd * sin_cp, z: sin_p * sin_cp + cos_p * cos_yd * cos_cp }; }
    Object.keys(DOMCache.paths).forEach(lineId => {
        const cacheObj = DOMCache.paths[lineId]; if (!cacheObj) return;
        let lineData = allDrawnLines.find(l => l.id === lineId);
        if (!lineData && lineId === currentTempLineId) lineData = { tipo: currentLineType, puntos: currentLinePoints, calleAncho: currentLineType === 'calle' ? draftCalleAncho : undefined, calleAlpha: currentLineType === 'calle' ? draftCalleAlpha : undefined, calleLabelScale: currentLineType === 'calle' ? draftCalleLabelScale : undefined, calleShowLabel: currentLineType === 'calle' ? draftCalleShowLabel : undefined };
        if (!lineData && lineId === lineaPinesTempId) lineData = { tipo: 'linea-pines-guia', puntos: lineaPinesPoints };
        if (!lineData && lineId === 'franja_preview_quad' && franjaPreviewQuad) lineData = { tipo: 'franja-preview', puntos: franjaPreviewQuad };
        if (!lineData && lineId === 'franja_curva_preview_frente' && franjaCurvaFrente.length >= 2) lineData = { tipo: 'franja-preview', puntos: franjaCurvaFrente };
        if (!lineData && lineId === 'franja_curva_preview_strip' && franjaCurvaPreviewStrip?.length >= 3) lineData = { tipo: 'franja-preview', puntos: franjaCurvaPreviewStrip };
        if (!lineData && lineId.startsWith('franja_preview_div_')) lineData = franjaPreviewDivs.find(d => d.id === lineId);
        if (!lineData && lineId === arq2TempLineId && arq2LinePoints.length > 0) {
            lineData = arq2Tool === 'calle-curva-arq2' ? arq2_getCalleCurvaPreviewLineData() : { tipo: 'lote-organico-preview', puntos: arq2LinePoints };
        }
        if (!lineData) return;
        let isClosed = shouldClosePolygonLine(lineId, lineData);
        if (cacheObj.gNode && lineData.tipo !== 'calle' && lineData.tipo !== 'calle-curva-arq2' && lineData.tipo !== 'calle-curva-arq2-preview' && lineData.tipo !== 'franja-grupo' && lineData.tipo !== 'franja-curva-grupo') { if (lineData.puntos && lineData.puntos.length > 0) { let polyStatus = lineData.loteStatus || 'disponible'; if (!lineData.loteStatus && !(lineData.franjaNumero || lineData.tipo === 'area-invisible')) { let cP = 0, cY = 0; lineData.puntos.forEach(pt => { cP += pt[0]; cY += pt[1]; }); cP /= lineData.puntos.length; cY /= lineData.puntos.length; let closestPin = null; let minDist = 30; BaseDatosLotes.forEach(pin => { if(pin.tipo === 'lote') { let dist = Math.pow(pin.pitch - cP, 2) + Math.pow(pin.yaw - cY, 2); if(dist < minDist) { minDist = dist; closestPin = pin; } } }); if (closestPin) polyStatus = closestPin.status; } cacheObj.gNode.setAttribute('data-status', polyStatus); } }
        if ((lineData.tipo === 'calle-curva-arq2' || lineData.tipo === 'calle-curva-arq2-preview') && cacheObj.base?.length >= 3) {
            const geoLine = lineData.tipo === 'calle-curva-arq2-preview' ? arq2_getCalleCurvaPreviewLineData() : lineData;
            if (!geoLine.left?.length || !geoLine.right?.length) return;
            const projected = arq2_projectCalleCurvaPaths(geoLine, getCam, cx, cy_screen, f);
            if (!projected) return;
            cacheObj.base[0].setAttribute('d', projected.dFill || 'M -999 -999');
            cacheObj.base[1].setAttribute('d', projected.dLeft || 'M -999 -999');
            cacheObj.base[2].setAttribute('d', projected.dRight || 'M -999 -999');
            if (cacheObj.base[3]) cacheObj.base[3].setAttribute('d', projected.capStart || 'M -999 -999');
            if (cacheObj.base[4]) cacheObj.base[4].setAttribute('d', projected.capEnd || 'M -999 -999');
            arq2_applyCalleCurvaFillStyle(cacheObj.base[0], projected.calleCurvaAlpha ?? geoLine.calleCurvaAlpha);
            return;
        }
        if ((lineData.tipo === 'lote-organico' || lineData.tipo === 'fila-variable-lote') && cacheObj.base) {
            arq2_syncOrganicLotePaths(lineData, cacheObj, getCam, cx, cy_screen, f);
            return;
        }
        let dBase = '';
        let pts = lineData.puntos;
        if (lineData.tipo === 'franja-curva-grupo') pts = [...lineData.frente, ...[...lineData.fondo].reverse()];
        let hasVisiblePoints = false;
        if (lineData.tipo === 'franja-curva-grupo' && document.body.classList.contains('auto-macro-active')) {
            if (cacheObj.base) cacheObj.base.forEach(path => path.setAttribute("d", 'M -999 -999'));
            return;
        }
        for (let i = 0; i < pts.length; i++) {
            let p1 = pts[i], p2 = pts[(i + 1) % pts.length];
            if (!isClosed && i === pts.length - 1) break;
            let c1 = getCam(p1[0], p1[1]), c2 = getCam(p2[0], p2[1]);
            let in1 = c1.z > 0.0001, in2 = c2.z > 0.0001; if (!in1 && !in2) continue; 
            let s1, s2;
            if (in1) { s1 = { x: cx + (c1.x / c1.z) * f, y: cy_screen - (c1.y / c1.z) * f }; hasVisiblePoints = true; } else { let t = c1.z / (c1.z - c2.z), ix = c1.x + t * (c2.x - c1.x), iy = c1.y + t * (c2.y - c1.y); s1 = { x: cx + (ix / 0.0001) * f, y: cy_screen - (iy / 0.0001) * f }; }
            if (in2) { s2 = { x: cx + (c2.x / c2.z) * f, y: cy_screen - (c2.y / c2.z) * f }; hasVisiblePoints = true; } else { let t = c2.z / (c2.z - c1.z), ix = c2.x + t * (c1.x - c2.x), iy = c2.y + t * (c1.y - c2.y); s2 = { x: cx + (ix / 0.0001) * f, y: cy_screen - (iy / 0.0001) * f }; }
            if(isNaN(s1.x) || isNaN(s2.x)) continue; 
            if (dBase === '') { dBase += `M ${s1.x},${s1.y} L ${s2.x},${s2.y} `; } else { if (!in1) dBase += `M ${s1.x},${s1.y} `; dBase += `L ${s2.x},${s2.y} `; }
        }
        if (!isClosed && (lineId === currentTempLineId || lineId === lineaPinesTempId || lineId === arq2TempLineId) && window.lastMouseX !== undefined) { let mx = window.lastMouseX - DOMCache.viewport.left, my = window.lastMouseY - DOMCache.viewport.top; if(dBase === '' && pts.length > 0) { let c1 = getCam(pts[0][0], pts[0][1]); if(c1.z > 0) dBase += `M ${cx + (c1.x / c1.z) * f},${cy_screen - (c1.y / c1.z) * f} `; } dBase += `L ${mx},${my} `; hasVisiblePoints = true; }
        if (isClosed && dBase.trim() !== '') dBase += ' Z';                 if (!hasVisiblePoints && isClosed) dBase = 'M -999 -999';
        if (cacheObj.base) {
            cacheObj.base.forEach(path => path.setAttribute("d", dBase.trim() !== '' ? dBase : 'M -999 -999'));
            if (lineData.tipo === 'calle') {
                const st = getCalleStyleForLine(lineData);
                applyCallePathStyles(cacheObj.base, st.ancho, st.alpha);
            }
        }
    });
    const guideEl = document.getElementById('arq2-guideline-svg');
    if (arq2Guideline && isArquitecto2Active && arq2LinePoints.length > 0 && svg) {
        const start = arq2Guideline.start;
        const end = [start[0] + arq2Guideline.dir[0] * 15, start[1] + arq2Guideline.dir[1] * 15];
        const sc1 = getCam(start[0], start[1]);
        const sc2 = getCam(end[0], end[1]);
        if (sc1 && sc2 && sc1.z > 0.0001 && sc2.z > 0.0001) {
            const sx1 = cx + (sc1.x / sc1.z) * f;
            const sy1 = cy_screen - (sc1.y / sc1.z) * f;
            const sx2 = cx + (sc2.x / sc2.z) * f;
            const sy2 = cy_screen - (sc2.y / sc2.z) * f;
            let gLine = document.getElementById('arq2-guideline-svg');
            if (!gLine) {
                gLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                gLine.id = 'arq2-guideline-svg';
                gLine.setAttribute('stroke', '#10b981');
                gLine.setAttribute('stroke-width', '2.5');
                gLine.setAttribute('stroke-dasharray', '6,6');
                gLine.setAttribute('pointer-events', 'none');
                svg.appendChild(gLine);
            }
            gLine.setAttribute('x1', String(sx1));
            gLine.setAttribute('y1', String(sy1));
            gLine.setAttribute('x2', String(sx2));
            gLine.setAttribute('y2', String(sy2));
            gLine.style.display = 'block';
        } else if (guideEl) {
            guideEl.style.display = 'none';
        }
    } else if (guideEl) {
        guideEl.style.display = 'none';
    }
    arq2_updateDemoLayer();
}

let isPegmanDragging = false, pegmanLastX = 0, pegmanLastY = 0, pegmanTilt = 0, pegmanTargetTilt = 0, pegmanAnimFrame = null;
function animatePegmanPendulum() { if(isPegmanDragging) { pegmanTilt += (pegmanTargetTilt - pegmanTilt) * 0.15; const ghost = document.getElementById('pegman-ghost'); if (ghost) ghost.style.transform = `rotate(${pegmanTilt}deg)`; pegmanTargetTilt *= 0.85; pegmanAnimFrame = requestAnimationFrame(animatePegmanPendulum); } }
function setupPegmanEngine() {
    const pegmanBtn = document.getElementById('js-pegman'), ghost = document.getElementById('pegman-ghost'); if(!pegmanBtn || !ghost) return;
    const startDrag = (e) => { e.preventDefault(); e.stopPropagation(); isPegmanDragging = true; document.body.classList.add('pegman-dragging'); let mock = getMockEvent(e); pegmanLastX = mock.clientX; pegmanLastY = mock.clientY; ghost.style.left = (pegmanLastX - 7) + 'px'; ghost.style.top = (pegmanLastY - 2) + 'px'; ghost.classList.add('active'); pegmanTilt = 0; pegmanTargetTilt = 0; cancelAnimationFrame(pegmanAnimFrame); animatePegmanPendulum(); };
    const doDrag = (e) => { if(!isPegmanDragging) return; e.preventDefault(); let mock = getMockEvent(e); if(mock.clientX) { let deltaX = mock.clientX - pegmanLastX; pegmanTargetTilt = deltaX * 1.5; if(pegmanTargetTilt > 45) pegmanTargetTilt = 45; if(pegmanTargetTilt < -45) pegmanTargetTilt = -45; pegmanLastX = mock.clientX; pegmanLastY = mock.clientY; } ghost.style.left = (pegmanLastX - 7) + 'px'; ghost.style.top = (pegmanLastY - 2) + 'px'; };
    const endDrag = (e) => { if(!isPegmanDragging) return; isPegmanDragging = false; document.body.classList.remove('pegman-dragging'); ghost.classList.remove('active'); cancelAnimationFrame(pegmanAnimFrame); if(!visor360) return; let mockEvent = { clientX: pegmanLastX, clientY: pegmanLastY }; let coords = visor360.mouseEventToCoords(mockEvent); if(coords && !isNaN(coords[0])) { let p = coords[0], y = coords[1]; let closestUrl = null; let minDist = 15; BaseDatosLotes.forEach(l => { if(l.videoUrl) { let d = Math.sqrt(Math.pow(l.pitch - p, 2) + Math.pow(l.yaw - y, 2)); if(d < minDist) { minDist = d; closestUrl = l.videoUrl; } } if(l.tipo === 'vista360' && l.url) { let d = Math.sqrt(Math.pow(l.pitch - p, 2) + Math.pow(l.yaw - y, 2)); if(d < minDist) { minDist = d; closestUrl = l.url; } } }); if(closestUrl) { openInAppViewer(null, closestUrl); } else { const fabContainer = document.getElementById('js-pegman'); fabContainer.classList.add('shake'); setTimeout(() => fabContainer.classList.remove('shake'), 400); } } };
    pegmanBtn.addEventListener('mousedown', startDrag); pegmanBtn.addEventListener('touchstart', startDrag, {passive: false}); window.addEventListener('mousemove', doDrag); window.addEventListener('touchmove', doDrag, {passive: false}); window.addEventListener('mouseup', endDrag); window.addEventListener('touchend', endDrag);
}

function hookRendererOverlay(renderer) {
    if (renderer && typeof renderer.render === 'function' && !renderer._isHooked) {
        renderer._isHooked = true; const originalRender = renderer.render.bind(renderer);
        renderer.render = function () {
            originalRender.apply(this, arguments);
            if (isSvgRenderAllowed() && shouldUpdateSVGThisFrame()) updateSVGPaths();
            const compassDial = document.getElementById('js-compass'); if (compassDial) { compassDial.style.transform = `rotate(${-(visor360.getYaw() - NorteOffset)}deg)`; }
            if (!isTouchDevice() || TouchPerfPhase1.shouldUpdateOverlayDecorThisFrame()) TouchPerfPhase1.applyOverlayDecor();
        }; try { renderer.render(); } catch(e) {}
    }
}

function attachSmartViewerHandlers(panoramaBase) {
    if (!visor360) return;
    const handleLoad = () => { 
        isWebGLSupported = true; viewerGpuReady = true; smartInitAttempts = 0; 
        const renderer = visor360.getRenderer(); 
        if(renderer) { SmartGpuProfile.patchRenderer(renderer); const canvas = typeof renderer.getCanvas === 'function' ? renderer.getCanvas() : null; SmartGpuProfile.bindContextRecovery(canvas, () => retryPannellumSmart(panoramaBase, true) ); }
        const pnlmUi = document.querySelector('.pnlm-ui'); const svg = document.getElementById('loteo-svg'); 
        if (pnlmUi && svg && svg.parentNode !== pnlmUi) pnlmUi.insertBefore(svg, pnlmUi.firstChild); 
        syncFranjaVisualsOnReady();
        if (!isIntroAnimating) revealLoteoOverlay();
    };
    visor360.on('error', () => { isWebGLSupported = false; viewerGpuReady = false; const spText = document.getElementById('splash-loading-text'); if (spText) spText.innerText = 'REINTENTO CON MODO LITE GPU...'; setTimeout(() => retryPannellumSmart(panoramaBase, true), 600); });
    visor360.on('load', handleLoad);
    if (visor360.isLoaded && visor360.isLoaded()) { handleLoad(); } else { setTimeout(() => { if (!viewerGpuReady && visor360.getRenderer()) handleLoad(); }, 300); }
}

async function retryPannellumSmart(panoramaBase, forceLite) {
    if (!isTouchDevice()) return; smartInitAttempts++; if (smartInitAttempts > 3) { const sp = document.getElementById('splash-loading-text'); if (sp) sp.innerText = 'ERROR GPU: RECARGA LA PÁGINA'; return; } if (forceLite) { SmartGpuProfile.maxDPR = 1; SmartGpuProfile.maxTextureSize = 2048; SmartGpuProfile.isHighEnd = false; } viewerGpuReady = false; if (visor360) { try { visor360.destroy(); } catch (e) {} visor360 = null; }
    const panoramaUrl = await SmartGpuProfile.preparePanorama( panoramaBase, forceLite || smartInitAttempts > 1 );
    visor360 = pannellum.viewer('panorama-container', { type: 'equirectangular', panorama: panoramaUrl, autoLoad: true, compass: false, hfov: 130, pitch: 60, yaw: -45, hotSpots: getHotspotsConfig(), fallback: PANORAMA_FILE, touchPanSpeedCoeffFactor: 1.35, friction: 0.12, showZoomCtrl: false, });
    attachSmartViewerHandlers(panoramaBase);
}

function runPannellumIntroBootstrap() {
    const beginIntro = () => {
        setTimeout(() => {
            const pnlmContainer = document.getElementById('panorama-container'); const uiEngine = document.getElementById('holographic-ui-engine'); const pnlmUi = document.querySelector('.pnlm-ui'); const svg = document.getElementById('loteo-svg'); 
            if (pnlmUi && svg && svg.parentNode !== pnlmUi && isWebGLSupported) { pnlmUi.insertBefore(svg, pnlmUi.firstChild); }
            let fsInterval = setInterval(() => { let fsBtn = document.querySelector('.pnlm-fullscreen-toggle-button'); if (fsBtn) { clearInterval(fsInterval); let newBtn = fsBtn.cloneNode(true); fsBtn.parentNode.replaceChild(newBtn, fsBtn); newBtn.addEventListener('click', () => { let docEl = document.documentElement; if (!document.fullscreenElement) { if (docEl.requestFullscreen) docEl.requestFullscreen(); else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen(); newBtn.classList.add('pnlm-fullscreen-toggle-button-active'); } else { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); newBtn.classList.remove('pnlm-fullscreen-toggle-button-active'); } if (isTouchDevice() && visor360 && viewerGpuReady) { setTimeout(() => { const r = visor360.getRenderer(); if (r && r.resize) r.resize(); }, 300); } }); } }, 500);
            if (pnlmContainer && uiEngine) { pnlmContainer.appendChild(uiEngine); uiEngine.style.zIndex = '999999'; }
            if (!visor360) return; 

            visor360.setHfov(DEFAULT_HFOV, 2500); 
            visor360.setPitch(-40, 2500);

            const urlParams = new URLSearchParams(window.location.search); const targetLoteId = urlParams.get('lote');
            
            setTimeout(() => {
                if (targetLoteId) { 
                    const searchStr = targetLoteId.toLowerCase().replace(/\s/g, ''); const targetPin = BaseDatosLotes.find( (l) => (l.titulo || '').toLowerCase().replace(/\s/g, '').includes(searchStr) || (l.numero || '') === targetLoteId, ); if (targetPin) visor360.lookAt(targetPin.pitch, targetPin.yaw, 70, 3000); else visor360.lookAt(5, 15, 100, 3000); 
                    setTimeout(() => { revealLoteoOverlay(); }, 3000);
                } else {
                    if (FRESIA_CFG.vista === 'suelo') {
                        // --- CINEMÁTICA VISTA SUELO (3 Puntos -> TinyHouse) ---
                        // Punto 1: Paneamos hacia un costado del Norte
                        visor360.lookAt(15, NorteOffset - 70, 110, 2500);
                        setTimeout(() => {
                            // Punto 2: Barrido largo cruzando el horizonte
                            visor360.lookAt(0, NorteOffset + 50, 95, 3000);
                            setTimeout(() => {
                                // Punto 3: Buscar "TinyHouse" y enfocar
                                const tinyPin = BaseDatosLotes.find(p => p.titulo && p.titulo.toLowerCase().includes('tinyhouse')) || PuntosHorizonte.find(p => p.titulo && p.titulo.toLowerCase().includes('tinyhouse'));
                                if (tinyPin) {
                                    visor360.lookAt(tinyPin.pitch, tinyPin.yaw, 80, 3500);
                                } else {
                                    visor360.lookAt(5, NorteOffset, 85, 3500); // Fallback al Norte si no existe
                                }
                                setTimeout(() => { revealLoteoOverlay(); }, 3500);
                            }, 3000);
                        }, 2500);
                    } else {
                        // --- CINEMÁTICA VISTA AÉREA NORMAL ---
                        visor360.lookAt(5, 15, 100, 3000); 
                        setTimeout(() => {
                            visor360.lookAt(-89, 65, 115, 3000);
                            setTimeout(() => { revealLoteoOverlay(); }, 3000);
                        }, 3000);
                    }
                }
            }, 1500);
        }, 1000);
    };
    if (isTouchDevice() && !viewerGpuReady) { let loops = 0; const waitGpu = setInterval(() => { loops++; if (viewerGpuReady || loops > 30) { clearInterval(waitGpu); viewerGpuReady = true; beginIntro(); } }, 100); return; } beginIntro();
}

function bindPanoramaPointerEvents() {
    const container = document.getElementById('panorama-container'); let startX, startY, startTime; let lastClickTime = 0;
    function handleStart(e) { let mock = getMockEvent(e); startX = mock.clientX; startY = mock.clientY; startTime = Date.now(); }
    function handleEnd(e) {
        if (draggingCalleMove) {
            if (draggingCalleMove.el) draggingCalleMove.el.classList.remove('is-dragging');
            draggingCalleMove = null;
            refreshAllHotspots();
            saveToLocal();
            return;
        }
        if (draggingFranjaDiv) {
            if (draggingFranjaDiv.el) draggingFranjaDiv.el.classList.remove('is-dragging');
            draggingFranjaDiv = null;
            refreshAllHotspots();
            saveToLocal();
            return;
        }
        if (draggingVertex) { 
            if(draggingVertex.el) draggingVertex.el.classList.remove('is-dragging'); 
            let mock = getMockEvent(e);
            const sx = draggingVertex.startX ?? mock.clientX;
            const sy = draggingVertex.startY ?? mock.clientY;
            const wasTap = Math.hypot(mock.clientX - sx, mock.clientY - sy) < 8;
            const isCalleFinishVtx = currentLineType === 'calle' && draggingVertex.lineId === currentTempLineId && draggingVertex.idx === currentLinePoints.length - 1 && currentLinePoints.length >= 2;
            if (wasTap && isCalleFinishVtx) {
                draggingVertex = null;
                window.lastMouseX = undefined;
                window.lastMouseY = undefined;
                finishCalleDrawing();
                return;
            }
            let snap = arq2_findNearestEdgeOrVertex(mock.clientX, mock.clientY, draggingVertex.lineId, 25);
            let coords;
            if (snap) {
                coords = [snap.pitch, snap.yaw];
            } else {
                coords = visor360.mouseEventToCoords(mock);
            }
            if (snapCursor) snapCursor.classList.remove('active', 'is-costura');
            if (coords && !isNaN(coords[0])) {
                applyDraggedVertexCoords(coords);
                const lineId = draggingVertex.lineId;
                const line = allDrawnLines.find(l => l.id === lineId);
                if (line && (line.tipo === 'lote-organico' || line.tipo === 'fila-variable-lote')) {
                    line.puntos = arq2_stitchOrganicLoteToStreets(line.puntos);
                    arq2_insertVerticesIntoMatchingEdges(lineId);
                    arq2_weldVerticesToNeighbors(lineId);
                    arq2_registerSharedEdges(lineId);
                    arq2_mergeSharedBoundaryVertices(lineId);
                    arq2_registerSharedEdges(lineId);
                    arq2_syncCosturaStylesFromLineEstilo(lineId);
                }
            }
            draggingVertex = null; 
            window.lastMouseX = undefined;
            window.lastMouseY = undefined;
            refreshAllHotspots(true); 
            saveToLocal(); 
            return; 
        }
        let mock = getMockEvent(e);
        if (isDevModePinsActive && pickedPin) {
            if (e.target && e.target.closest && (e.target.closest('.pin-quick-actions') || e.target.closest('.qa-btn'))) {
                pickedPin = null; document.getElementById('ghost-pin').classList.remove('active');
                document.querySelectorAll('.pnlm-hotspot-base').forEach(el => { el.style.opacity = ''; });
                return;
            }
            const coords = visor360.mouseEventToCoords(mock); if (coords && !isNaN(coords[0])) { pickedPin.pitch = parseFloat(coords[0].toFixed(2)); pickedPin.yaw = parseFloat(coords[1].toFixed(2)); } pickedPin = null; document.getElementById('ghost-pin').classList.remove('active'); refreshAllHotspots(); saveToLocal(); return;
        }
        const timeDiff = Date.now() - startTime; const moveDist = Math.sqrt( Math.pow(mock.clientX - startX, 2) + Math.pow(mock.clientY - startY, 2) );
        if (timeDiff < 500 && moveDist < 10) {
            if (isArquitecto2Active && visor360) {
                const isDbl = Date.now() - lastClickTime < 350;
                arq2_onPanoramaClick(mock, isDbl);
                lastClickTime = Date.now();
                return;
            }
            if (Date.now() - lastClickTime < 350 && isDevModeDrawActive && currentLineType !== 'franja' && currentLineType !== 'franja_curva') {
                if (currentLineType === 'calle' && currentLinePoints.length >= 2) {
                    finishCalleDrawing();
                    lastClickTime = 0;
                    return;
                }
                if (currentLineType !== 'calle') {
                    anclarTrazoActivo();
                    lastClickTime = 0;
                    return;
                }
            }
            lastClickTime = Date.now();
            if (isDevModeDrawActive && currentLineType === 'eraser') { runEraserAtEvent(mock); return; }
            if (isDevModeDrawActive && (currentLineType === 'franja' || currentLineType === 'franja_curva')) {
                if (!franjaCornerA) {
                    const coords = visor360.mouseEventToCoords(mock); if (!coords) return;
                    const snapA = snapFranjaScreenRect(mock.clientX, mock.clientY, mock.clientX, mock.clientY);
                    franjaCornerA = { sx: snapA.x1, sy: snapA.y1, pitch: parseFloat(coords[0].toFixed(3)), yaw: parseFloat(coords[1].toFixed(3)) };
                    try { visor360.addHotSpot({ id: 'franja_preview_a', pitch: franjaCornerA.pitch, yaw: franjaCornerA.yaw, createTooltipFunc: (div) => { div.classList.add('vertex-marker','franja-corner-marker','drawing-node'); div.id = 'franja_preview_a'; }, createTooltipArgs: {} }); } catch(e) {}
                } else {
                    const built = buildFranjaScreenPointsSnapped(franjaCornerA.sx, franjaCornerA.sy, mock.clientX, mock.clientY, Math.max(1, franjaDraftCount));
                    if (!built) { clearFranjaDraft(); alert('⚠️ No se pudo proyectar la franja. Ajusta la vista.'); return; }
                    const snap = built.snap;
                    franjaPendingCreate = { ax: franjaCornerA.sx, ay: franjaCornerA.sy, bx: mock.clientX, by: mock.clientY, snap, tipo: currentLineType };
                    clearFranjaDraft();
                    openFranjaLotesModal(franjaDraftCount, commitFranjaFromModal);
                }
                return;
            }
            if (isDevModeDrawActive) {
                if (currentLineType === 'calle') { handleCalleDrawClick(mock); return; }
                const coords = visor360.mouseEventToCoords(mock); if (!coords) return; let p = coords[0], y = coords[1];
                if (currentLineType === 'cortar') {
                    currentLinePoints.push([p, y]);
                    if (currentLinePoints.length === 2) {
                        let didSplit = attemptSplit(currentLinePoints[0], currentLinePoints[1]);
                        if(!didSplit) { flashScreenError(); }
                        currentLinePoints = []; currentTempLineId = 'temp_' + Date.now(); refreshAllHotspots(); saveToLocal();
                    } else {
                        visor360.addHotSpot({ pitch: p, yaw: y, id: 'temp_base_pt_' + Date.now(), createTooltipFunc: renderHiddenVertex, createTooltipArgs: { lineId: currentTempLineId, type: currentLineType, isGuide: true, idx: currentLinePoints.length - 1, hsId: 'temp_base_pt_' + Date.now() }, }); syncSVGElements(); updateSVGPaths();
                    } return;
                }
                if (snappedCoords) { p = snappedCoords[0]; y = snappedCoords[1]; }
                let isClosingShape = false;
                if (currentLineType !== 'calle' && currentLineType !== 'franja_curva' && currentLinePoints.length >= 3) {
                    if (isNearPolygonOriginPY(p, y, currentLinePoints[0]) && canTriggerPolygonAutoClose()) isClosingShape = true;
                }
                if (isClosingShape) { lastDevDrawClickMs = Date.now(); anclarTrazoActivo(); } else { currentLinePoints.push([p, y]); lastDevDrawClickMs = Date.now(); let _hid = 'temp_base_pt_'+Date.now(); visor360.addHotSpot({ pitch: p, yaw: y, id: _hid, createTooltipFunc: renderHiddenVertex, createTooltipArgs: { lineId: currentTempLineId, type: currentLineType, isGuide: true, idx: currentLinePoints.length-1, hsId: _hid }, }); syncSVGElements(); updateSVGPaths(); }
            } else if (isDevModePinsActive && isLineaPinesActive && !pickedPin) {
                if (e.target && e.target.closest('.qa-btn')) return;
                handleLineaPinesClick(mock);
            } else if (isDevModePinsActive && !pickedPin) {
                if (e.target && e.target.closest('.qa-btn')) return; const coords = visor360.mouseEventToCoords(mock); if (!coords) return; const p = coords[0].toFixed(2), y = coords[1].toFixed(2); let baseArgs = { pitch: parseFloat(p), yaw: parseFloat(y) };
                if (currentPinTypeMap === 'horizonte' || currentPinTypeMap === 'ruta') {
                    const label = currentPinTypeMap === 'ruta' ? '🛣️ PIN RUTA' : '⛰️ PIN HORIZONTE';
                    const titulo = prompt(`${label}\nTítulo (ej: ${currentPinTypeMap === 'ruta' ? 'Ruta V-30' : 'Volcán Osorno'}):`);
                    if (titulo) { 
                        baseArgs.titulo = titulo; baseArgs.tipo = currentPinTypeMap; 
                        baseArgs.coordenadasDestino = '';
                        openPinEditor(baseArgs, true); 
                    }
                } else if (currentPinTypeMap === 'vista360' || currentPinTypeMap === 'casa360') { 
                    baseArgs.tipo = currentPinTypeMap; 
                    openPinEditor(baseArgs, true); 
                } else { baseArgs.tipo = 'lote'; baseArgs.status = currentPinTypeMap; openPinEditor(baseArgs, true); }
            }
        }
    }
    function handleMove(e) {
        let mock = getMockEvent(e); if (mock.clientX === undefined) return;
        if (draggingCalleMove) {
            if (e.cancelable) e.preventDefault();
            const coords = visor360?.mouseEventToCoords(mock);
            const line = allDrawnLines.find(l => l.id === draggingCalleMove.lineId);
            if (coords && line && draggingCalleMove.origPts) {
                const dP = coords[0] - draggingCalleMove.startPY[0];
                const dY = coords[1] - draggingCalleMove.startPY[1];
                line.puntos = draggingCalleMove.origPts.map(pt => [pt[0] + dP, pt[1] + dY]);
            }
            syncSVGElements(); updateSVGPaths();
            refreshAllHotspots(true);
            return;
        }
        if (draggingFranjaDiv) {
            if (e.cancelable) e.preventDefault();
            applyFranjaDivDrag(draggingFranjaDiv.gid, draggingFranjaDiv.splitIdx, mock.clientX, mock.clientY);
            syncSVGElements(); updateSVGPaths();
            return;
        }
        if (draggingVertex) {
            if (e.cancelable) e.preventDefault();
            window.lastMouseX = mock.clientX; window.lastMouseY = mock.clientY;
            try {
                let snap = arq2_findNearestEdgeOrVertex(mock.clientX, mock.clientY, draggingVertex.lineId, 25);
                let coords;
                if (snap) {
                    coords = [snap.pitch, snap.yaw];
                    if (snapCursor) {
                        snapCursor.style.left = snap.screenX + 'px';
                        snapCursor.style.top = snap.screenY + 'px';
                        snapCursor.classList.add('active', 'is-costura');
                    }
                } else {
                    coords = visor360?.mouseEventToCoords(mock);
                    if (snapCursor) snapCursor.classList.remove('active', 'is-costura');
                }
                if (coords && !isNaN(coords[0])) applyDraggedVertexCoords(coords);
            } catch(err) {}
            syncSVGElements(); updateSVGPaths();
            return;
        }
        if (isDevModePinsActive && pickedPin) { if (e.cancelable) e.preventDefault(); const gPin = document.getElementById('ghost-pin'); gPin.classList.add('active'); gPin.style.left = mock.clientX + 'px'; gPin.style.top = mock.clientY + 'px'; return; }
        if (isDevModePinsActive && isLineaPinesActive && visor360) {
            window.lastMouseX = mock.clientX; window.lastMouseY = mock.clientY;
            updateSVGPaths();
            return;
        }
        if (isArquitecto2Active && visor360) {
            arq2_onPanoramaMove(mock);
            return;
        }
        if (isDevModeDrawActive && (currentLineType === 'franja' || currentLineType === 'franja_curva') && franjaCornerA) {
            window.lastMouseX = mock.clientX; window.lastMouseY = mock.clientY;
            updateFranjaPreview(mock.clientX, mock.clientY);
            syncSVGElements(); updateSVGPaths();
            if (snapCursor) snapCursor.classList.remove('active');
            return;
        }
        if (!isDevModeDrawActive || !visor360 || currentLineType === 'eraser') { if (snapCursor) snapCursor.classList.remove('active'); return; }
        if (isDevModeDrawActive) { window.lastMouseX = mock.clientX; window.lastMouseY = mock.clientY; updateSVGPaths(); }
        
        try { const coords = visor360.mouseEventToCoords(mock); updateDrawModeSnap(mock, coords); } catch (err) {}
    }
    container.addEventListener('mousedown', handleStart); container.addEventListener('touchstart', handleStart, { passive: false }); window.addEventListener('mouseup', handleEnd); window.addEventListener('touchend', handleEnd); window.addEventListener('mousemove', handleMove); window.addEventListener('touchmove', handleMove, { passive: false });
}

async function initPannellum() {
    const touchDev = isTouchDevice();
    if (!touchDev && !isWebGLSupported) { const spText = document.getElementById('splash-loading-text'); if (spText) spText.innerText = 'MODO DE COMPATIBILIDAD (SIN GPU)...'; const svg = document.getElementById('loteo-svg'); if (svg) svg.style.display = 'none'; }
    let panoramaUrl = PANORAMA_FILE;
    if (touchDev) { SmartGpuProfile.init(); viewerGpuReady = false; const spText = document.getElementById('splash-loading-text'); if (spText) spText.innerText = 'OPTIMIZANDO GPU PARA MÓVILES...'; panoramaUrl = await SmartGpuProfile.preparePanorama(PANORAMA_FILE, false); if (spText) spText.innerText = 'CARGANDO PANORAMA 360°...'; }
    const viewerConfig = { type: 'equirectangular', panorama: panoramaUrl, autoLoad: true, compass: false, hfov: 130, pitch: 60, yaw: -45, hotSpots: getHotspotsConfig(), fallback: PANORAMA_FILE, };
    if (touchDev) { viewerConfig.touchPanSpeedCoeffFactor = 1.35; viewerConfig.friction = 0.12; viewerConfig.showZoomCtrl = false; }
    visor360 = pannellum.viewer('panorama-container', viewerConfig);
    attachSmartViewerHandlers(PANORAMA_FILE);
    if (!pannellumIntroBootstrapped) { pannellumIntroBootstrapped = true; runPannellumIntroBootstrap(); }
    if (!panoramaEventsBound) { panoramaEventsBound = true; bindPanoramaPointerEvents(); }
}

function setupGlobalDelegation() {
    document.body.addEventListener('click', (e) => {
        const qaBtn = e.target.closest('.qa-btn'); if (!qaBtn) return; e.preventDefault(); e.stopPropagation(); const pinId = qaBtn.getAttribute('data-id'); if (!pinId) return; let targetArgs = BaseDatosLotes.find(l => l.id === pinId) || PuntosHorizonte.find(p => p.id === pinId); if (!targetArgs) return;
        if (qaBtn.classList.contains('qa-edit')) { openPinEditor(targetArgs, false); } 
        else if (qaBtn.classList.contains('qa-delete')) { if(confirm(`¿Deseas ELIMINAR permanentemente: "${targetArgs.titulo}"?`)) { BaseDatosLotes = BaseDatosLotes.filter(p => p.id !== pinId); PuntosHorizonte = PuntosHorizonte.filter(p => p.id !== pinId); refreshAllHotspots(); saveToLocal(); } }
    });
}

function setupInAppModal() { 
    const modal = document.getElementById('inapp-modal'); 
    const closeBtn = document.getElementById('js-close-inapp'); 
    const iframe = document.getElementById('inapp-iframe-player'); 
    if(closeBtn) { 
        closeBtn.addEventListener('click', () => { 
            modal.classList.remove('open'); 
            document.body.classList.remove('is-canvas-only');
            setTimeout(() => { 
                iframe.src = ""; 
                // --- FIX: ANTI-FLOTACIÓN DE SVG ---
                if (visor360) {
                    try {
                        // 1. Forzar redibujado del motor WebGL
                        visor360.resize();
                        const r = visor360.getRenderer();
                        if (r && typeof r.resize === 'function') r.resize();
                        
                        // 2. Recalibrar la caché matemática del SVG
                        const container = document.getElementById('panorama-container');
                        if (container) {
                            const rect = container.getBoundingClientRect();
                            DOMCache.viewport.w = rect.width;
                            DOMCache.viewport.h = rect.height;
                            DOMCache.viewport.left = rect.left;
                            DOMCache.viewport.top = rect.top;
                        }
                        
                        // 3. Engañar al navegador para refrescar la matriz de proyección
                        window.dispatchEvent(new Event('resize'));
                        updateSVGPaths();
                    } catch(e) {}
                }
            }, 300); 
        }); 
    } 
}
function extractYouTubeID(url) { if (!url) return null; const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/; const match = url.match(regExp); return (match && match[2].length === 11) ? match[2] : null; }
window.openInAppViewer = function(e, url) { if(e) { e.preventDefault(); e.stopPropagation(); } if(!url) return; const modal = document.getElementById('inapp-modal'); const content = document.getElementById('js-inapp-content'); const iframe = document.getElementById('inapp-iframe-player'); const videoID = extractYouTubeID(url); if(videoID) { content.className = 'inapp-content is-yt'; iframe.src = `https://www.youtube.com/embed/${videoID}?autoplay=1&rel=0&modestbranding=1`; } else { content.className = 'inapp-content is-360'; iframe.src = url; document.body.classList.add('is-canvas-only'); } modal.classList.add('open'); };

function setupModalEditor() {
    const btnCancelPin = document.getElementById('btn-cancel-pin'); const btnSavePin = document.getElementById('btn-save-pin'); const modalContent = document.getElementById('modal-content-box');
    const btnCalcRoute = document.getElementById('pin-calc-route');
    if(modalContent) { modalContent.addEventListener('mousedown', (e) => e.stopPropagation()); modalContent.addEventListener('mouseup', (e) => e.stopPropagation()); modalContent.addEventListener('touchstart', (e) => e.stopPropagation(), {passive: true}); modalContent.addEventListener('touchend', (e) => e.stopPropagation()); }
    if(btnCalcRoute) {
        btnCalcRoute.addEventListener('click', async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!OrigenDrone?.lat) { alert('⚠️ Primero fija el Origen Drone en el panel de pines.'); return; }
            const coordsIn = document.getElementById('pin-coords');
            if (!parseCoordenadasDestino(coordsIn?.value)) { alert('⚠️ Ingresa coordenadas destino válidas (Lat, Lng).'); return; }
            btnCalcRoute.disabled = true;
            btnCalcRoute.innerText = 'Calculando ruta…';
            const scenario = document.getElementById('pin-traffic-scenario')?.value || 'auto';
            const tmp = { coordenadasDestino: coordsIn.value.trim(), rutaEscenarioTrafico: scenario };
            const est = await calcularRutaParaPin(tmp, { scenario });
            btnCalcRoute.disabled = false;
            btnCalcRoute.innerText = '🛣️ Calcular desde Origen Drone';
            if (!est) { alert('⚠️ No se pudo calcular la ruta.'); return; }
            document.getElementById('pin-area').value = est.km;
            document.getElementById('pin-price').value = est.min;
            const hint = document.getElementById('pin-traffic-hint');
            if (hint) hint.innerText = '✓ ' + (est.source === 'osrm' ? 'Ruta por carretera (OSRM)' : 'Estimación topográfica') + ' · ' + (est.etiqueta || 'Tráfico');
        });
    }
    if(btnCancelPin) { btnCancelPin.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); document.getElementById('pin-editor-modal').classList.remove('open'); activePinArgs = null; }); }
    if(btnSavePin) {
        btnSavePin.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation(); if(!activePinArgs) return;
            let rawTitle = document.getElementById('pin-title').value || '';
            if(activePinArgs.tipo === 'lote') {
                if(!rawTitle.toUpperCase().includes('LOTE') && rawTitle !== '') activePinArgs.titulo = 'Lote ' + rawTitle; else if (rawTitle === '') activePinArgs.titulo = 'Lote Sin Nombre'; else activePinArgs.titulo = rawTitle;
                
                let rawArea = document.getElementById('pin-area-lote').value.trim() || '0'; 
                if(rawArea && !rawArea.toLowerCase().includes('m') && !rawArea.toLowerCase().includes('h')) {
                    let numArea = parseFloat(rawArea.replace(',', '.'));
                    if (!isNaN(numArea)) { if (numArea < 100) { rawArea = numArea.toFixed(4).replace('.', ',') + ' HÁ'; } else { rawArea += ' m²'; } }
                }
                activePinArgs.superficie = rawArea;
                
                let rawPrice = document.getElementById('pin-price-lote').value.trim() || '0'; if(rawPrice && !rawPrice.toLowerCase().includes('uf')) rawPrice = 'UF ' + rawPrice; activePinArgs.precio = rawPrice;
                activePinArgs.status = document.getElementById('pin-status').value || 'disponible';
                let imgVal = document.getElementById('pin-img').value; let fallbackImage = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80"; activePinArgs.imagen = imgVal ? imgVal : fallbackImage;
                let vidVal = document.getElementById('pin-video').value; if (vidVal) activePinArgs.videoUrl = vidVal; else delete activePinArgs.videoUrl;
                activePinArgs.tituloPlano = document.getElementById('pin-titulo-plano')?.value.trim() || '';
                activePinArgs.tituloColor = document.getElementById('pin-titulo-color')?.value || '#1d1d1f';
                activePinArgs.tituloPlanoColor = document.getElementById('pin-titulo-plano-color')?.value || '#0066cc';
                activePinArgs.cardVis = readCardVisFromEditor();
            } else if(activePinArgs.tipo === 'horizonte' || activePinArgs.tipo === 'ruta') {
                activePinArgs.titulo = rawTitle || 'MARCADOR';
                activePinArgs.coordenadasDestino = document.getElementById('pin-coords').value.trim();
                let rawDist = document.getElementById('pin-area').value.trim() || '0';
                let rawTime = document.getElementById('pin-price').value.trim() || '0';
                activePinArgs.distancia = rawDist.toUpperCase().includes('KM') ? rawDist : rawDist + ' KM';
                activePinArgs.tiempo = rawTime.toUpperCase().includes('MIN') ? rawTime : rawTime + ' MIN';
                activePinArgs.rutaEscenarioTrafico = document.getElementById('pin-traffic-scenario')?.value || 'auto';
            } else if(activePinArgs.tipo === 'vista360' || activePinArgs.tipo === 'casa360') { 
                activePinArgs.titulo = rawTitle || (activePinArgs.tipo === 'vista360' ? 'VISTA 360' : 'CASA TOUR'); 
                activePinArgs.url = document.getElementById('pin-video-media').value || '#'; 
            }
            if (isCreatingNewPin) { activePinArgs.id = "nuevo_" + Date.now(); let match = activePinArgs.titulo.match(/\d+/); activePinArgs.numero = match ? match[0].padStart(2, '0') : "00"; if(activePinArgs.tipo === 'horizonte' || activePinArgs.tipo === 'ruta') PuntosHorizonte.push(activePinArgs); else BaseDatosLotes.push(activePinArgs); } else { let match = activePinArgs.titulo.match(/\d+/); activePinArgs.numero = match ? match[0].padStart(2, '0') : "00"; }
            document.getElementById('pin-editor-modal').classList.remove('open'); refreshAllHotspots(); saveToLocal(); 
        });
    }
}

function openPinEditor(args, isNew) {
    activePinArgs = args; isCreatingNewPin = isNew;
    const modalBox = document.getElementById('modal-content-box');
    const badge = document.getElementById('pm-type-badge');
    const labelTitle = document.getElementById('pm-label-title');
    const navSection = document.getElementById('pin-nav-section');
    const cardSection = document.getElementById('pin-card-section');
    const lotePanel = document.getElementById('pm-panel-lote');
    const mediaPanel = document.getElementById('pm-panel-media');
    const titleEl = document.getElementById('modal-title-text');
    const tipo = args.tipo;

    navSection.style.display = 'none';
    cardSection.style.display = 'none';
    lotePanel.style.display = 'none';
    mediaPanel.style.display = 'none';
    modalBox?.classList.remove('modal-lote-edit');
    badge.className = 'pm-badge';

    let displayTitle = args.titulo || '';
    let tituloPlanoVal = args.tituloPlano || '';

    if (tipo === 'lote') {
        titleEl.innerText = isNew ? 'Nuevo Lote' : 'Editar Smart Pin';
        badge.textContent = 'Smart Pin · Lote';
        labelTitle.textContent = 'Número de lote';
        if (!tituloPlanoVal && displayTitle.includes('(')) {
            const m = displayTitle.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
            if (m) { displayTitle = m[1].trim(); tituloPlanoVal = m[2].trim(); }
        }
        if (!isNew) displayTitle = displayTitle.replace(/lote\s*/i, '');
        cardSection.style.display = 'flex';
        lotePanel.style.display = 'flex';
        modalBox?.classList.add('modal-lote-edit');
        document.getElementById('pin-titulo-plano').value = tituloPlanoVal;
        document.getElementById('pin-titulo-color').value = args.tituloColor || '#1d1d1f';
        document.getElementById('pin-titulo-plano-color').value = args.tituloPlanoColor || '#0066cc';
        setCardVisInEditor(args.cardVis);
        document.getElementById('pin-area-lote').value = (args.superficie || '').replace(/m²|m2|km|há|ha/gi, '').trim();
        document.getElementById('pin-price-lote').value = (args.precio || '').replace(/uf|min/gi, '').trim();
        document.getElementById('pin-status').value = args.status || 'disponible';
        document.getElementById('pin-img').value = (args.imagen && !args.imagen.includes('1600596542815') && !args.imagen.includes('1500382017468')) ? args.imagen : '';
        document.getElementById('pin-video').value = args.videoUrl || '';
    } else if (tipo === 'horizonte' || tipo === 'ruta') {
        titleEl.innerText = isNew ? (tipo === 'ruta' ? 'Nuevo Pin Ruta' : 'Nuevo Pin Horizonte') : (tipo === 'ruta' ? 'Editar Pin Ruta' : 'Editar Pin Horizonte');
        badge.textContent = tipo === 'ruta' ? 'Pin Ruta' : 'Pin Horizonte';
        badge.className = 'pm-badge nav';
        labelTitle.textContent = tipo === 'ruta' ? 'Nombre de la ruta' : 'Punto de referencia';
        navSection.style.display = 'flex';
        document.getElementById('pin-coords').value = args.coordenadasDestino || '';
        const scenarioEl = document.getElementById('pin-traffic-scenario');
        if (scenarioEl) scenarioEl.value = args.rutaEscenarioTrafico || 'auto';
        document.getElementById('pin-area').value = (args.distancia || '').replace(/km/gi, '').trim();
        document.getElementById('pin-price').value = (args.tiempo || '').replace(/min/gi, '').trim();
        const calcBtn = document.getElementById('pin-calc-route');
        if (calcBtn) { calcBtn.disabled = false; calcBtn.innerText = '🛣️ Calcular desde Origen Drone'; }
        const trafficHint = document.getElementById('pin-traffic-hint');
        if (trafficHint) trafficHint.innerText = args.rutaEtiquetaTrafico ? ('Último cálculo: ' + args.rutaEtiquetaTrafico) : 'Distancia por carretera + factor tráfico Chile (elige escenario arriba).';
    } else if (tipo === 'vista360' || tipo === 'casa360') {
        titleEl.innerText = isNew ? 'Nuevo Pin 360°' : 'Editar Pin 360°';
        badge.textContent = tipo === 'casa360' ? 'Casa 360°' : 'Vista 360°';
        labelTitle.textContent = 'Título visible';
        mediaPanel.style.display = 'flex';
        document.getElementById('pin-video-media').value = args.url || args.videoUrl || '';
    }

    document.getElementById('pin-title').value = displayTitle;
    document.getElementById('pin-title').placeholder = tipo === 'lote' ? 'Ej: 06' : (tipo === 'horizonte' ? 'Ej: Volcán Osorno' : (tipo === 'ruta' ? 'Ej: Ruta V-362' : 'Título'));
    document.getElementById('pin-editor-modal').classList.add('open');
}

function anclarTrazoActivo() {
    if (currentLineType === 'franja_curva') return;
    if (currentLinePoints.length > 1) {
        if (currentLineType !== 'cortar') {
            const entry = { id: currentTempLineId, tipo: currentLineType, puntos: [...currentLinePoints] };
            if (currentLineType === 'calle') {
                entry.calleAncho = draftCalleAncho;
                entry.calleAlpha = draftCalleAlpha;
                entry.calleLabelScale = draftCalleLabelScale;
                entry.calleShowLabel = draftCalleShowLabel;
                allDrawnLines.push(entry);
            } else {
                allDrawnLines.push(entry);
            }
        }
        currentLinePoints = [];
        currentTempLineId = 'temp_' + Date.now();
        lastCalleTap = null;
        syncCallePanelUI();
        refreshAllHotspots();
        saveToLocal();
    }
}
function toggleDrawMode(forceActive) {
    if (typeof forceActive !== 'boolean') forceActive = !isDevModeDrawActive;
    isDevModeDrawActive = forceActive;
    if (!forceActive) { clearFranjaDraft(); closeCalleToolPanel(); }
    document.getElementById('dev-toolbar-draw')?.classList.toggle('show', isDevModeDrawActive);
    document.body.classList.toggle('dev-mode-active', isDevModeDrawActive);
    refreshAllHotspots();
}
function togglePinsMode(forceActive) {
    if (typeof forceActive !== 'boolean') forceActive = !isDevModePinsActive;
    isDevModePinsActive = forceActive;
    if (!forceActive) deactivateLineaPines();
    document.getElementById('dev-toolbar-pins')?.classList.toggle('show', isDevModePinsActive);
    document.body.classList.toggle('dev-mode-pins-active', isDevModePinsActive);
    refreshAllHotspots();
}

function setupDevModes() {
    document.querySelectorAll('.dev-toolbar').forEach(tb => { tb.addEventListener('mousedown', e => e.stopPropagation()); tb.addEventListener('mouseup', e => e.stopPropagation()); tb.addEventListener('touchstart', e => e.stopPropagation(), {passive: true}); tb.addEventListener('touchend', e => e.stopPropagation()); });
    document.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        if (e.ctrlKey && e.altKey && e.code === 'KeyA') { e.preventDefault(); arq2_toggleArquitecto2(); return; }
        if (isArquitecto2Active && e.code === 'Escape') {
            e.preventDefault();
            arq2_clearDraft();
            if (arq2Tool === 'fila-variable') arq2_startDemoAnimation(false);
            refreshAllHotspots(true);
            syncSVGElements();
            updateSVGPaths();
            return;
        }
        if (isArquitecto2Active && (e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); arq2_onEnterKey(); return; }
        if (isLineaPinesActive && lineaPinesPoints.length >= 2 && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
            e.preventDefault();
            applyLineaPinesAlign();
            return;
        }
        if (e.code === 'Enter' && isDevModeDrawActive && currentLineType === 'calle' && currentLinePoints.length >= 2) {
            e.preventDefault();
            finishCalleDrawing();
            return;
        }
        if (e.code === 'Escape' && isLineaPinesActive) {
            e.preventDefault();
            clearLineaPinesDraft();
            refreshAllHotspots(true);
            return;
        }
        if (e.ctrlKey && e.code === 'KeyZ' && isLineaPinesActive && lineaPinesPoints.length > 0) {
            e.preventDefault();
            lineaPinesPoints.pop();
            syncLineaPinesPanelUI();
            refreshAllHotspots(true);
            return;
        }
        if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); if(isDevModePinsActive) togglePinsMode(false); toggleDrawMode(!isDevModeDrawActive); } if (e.ctrlKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) { e.preventDefault(); if(isDevModeDrawActive) toggleDrawMode(false); togglePinsMode(!isDevModePinsActive); } if (e.ctrlKey && (e.code === 'KeyZ' || e.key.toLowerCase() === 'z')) { e.preventDefault(); if (isDevModeDrawActive) { if (currentLinePoints.length > 0) document.getElementById('btn-undo-point')?.click(); else if (allDrawnLines.length > 0) document.getElementById('btn-delete-last-line')?.click(); } }
    });
    
    document.getElementById('btn-draw-solid')?.addEventListener('click', (e) => { setDrawMode('solida', e.target); }); 
    document.getElementById('btn-draw-dash')?.addEventListener('click', (e) => { setDrawMode('punteada', e.target); }); 
    document.getElementById('btn-draw-street')?.addEventListener('click', (e) => { setDrawMode('calle', e.target); openCalleToolPanel(); }); 
    document.getElementById('btn-draw-cut')?.addEventListener('click', (e) => { setDrawMode('cortar', e.target); });
    document.getElementById('btn-draw-divisoria')?.addEventListener('click', (e) => { clearFranjaDraft(); setDrawMode('divisoria', e.target); });
    document.getElementById('btn-draw-franja')?.addEventListener('click', (e) => { clearFranjaDraft(); closeFranjaLotesModal(); setDrawMode('franja', e.target); });
    document.getElementById('btn-draw-franja-curva')?.addEventListener('click', (e) => { clearFranjaDraft(); closeFranjaLotesModal(); setDrawMode('franja_curva', e.target); });
    document.getElementById('btn-straighten-franja')?.addEventListener('click', enderezarFranjas);
    document.getElementById('btn-eraser')?.addEventListener('click', (e) => { setDrawMode('eraser', e.target); });
    
    function setDrawMode(mode, targetBtn) { 
        if (mode !== 'franja' && mode !== 'franja_curva') clearFranjaDraft(); 
        if (mode !== 'calle') closeCalleToolPanel(); 
        currentLineType = mode; document.body.classList.toggle('eraser-mode-active', mode === 'eraser'); document.querySelectorAll('#dev-toolbar-draw .dev-btn:not(.action):not(.export):not(.export-ai):not(.nuke)').forEach(b => b.classList.remove('active')); if(targetBtn) targetBtn.classList.add('active'); 
    }
    const bindCallePanel = (id, fn) => { const el = document.getElementById(id); if (!el) return; el.addEventListener('input', fn); el.addEventListener('change', fn); };
    bindCallePanel('calle-ui-ancho', (e) => { draftCalleAncho = Math.max(2, Math.min(28, parseFloat(e.target.value) || 8)); syncCallePanelUI(); updateSVGPaths(); refreshAllHotspots(true); });
    bindCallePanel('calle-ui-alpha', (e) => { draftCalleAlpha = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)); syncCallePanelUI(); updateSVGPaths(); });
    bindCallePanel('calle-ui-label', (e) => { draftCalleLabelScale = Math.max(0.5, Math.min(2.5, parseFloat(e.target.value) || 1)); syncCallePanelUI(); refreshAllHotspots(true); });
    bindCallePanel('calle-ui-show-label', (e) => { draftCalleShowLabel = !!e.target.checked; refreshAllHotspots(true); });
    bindCallePanel('calle-ui-snap-franja', (e) => { draftCalleSnapFranja = !!e.target.checked; });
    document.getElementById('btn-calle-finish')?.addEventListener('click', (e) => { e.stopPropagation(); finishCalleDrawing(); });
    document.getElementById('calle-tool-panel')?.addEventListener('mousedown', e => e.stopPropagation());
    document.getElementById('calle-tool-panel')?.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    document.getElementById('linea-pines-panel')?.addEventListener('mousedown', e => e.stopPropagation());
    document.getElementById('linea-pines-panel')?.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    
    document.getElementById('franja-modal-apply-count')?.addEventListener('click', () => {
        const n = parseInt(document.getElementById('franja-modal-count')?.value, 10) || franjaDraftCount;
        renderFranjaModalRows(Math.max(1, Math.min(40, n)), getFranjaModalWeights());
    });
    document.getElementById('franja-modal-equal')?.addEventListener('click', () => {
        document.querySelectorAll('#franja-modal-rows .franja-weight-input').forEach(inp => { inp.value = franjaDraftBaseM2; });
        renderFranjaModalScalePreview();
    });
    document.getElementById('franja-modal-last-big')?.addEventListener('click', () => {
        const inputs = [...document.querySelectorAll('#franja-modal-rows .franja-weight-input')];
        inputs.forEach((inp, i) => { inp.value = i === inputs.length - 1 ? Math.round(franjaDraftBaseM2 * 1.4) : franjaDraftBaseM2; });
        renderFranjaModalScalePreview();
    });
    document.getElementById('franja-modal-cancel')?.addEventListener('click', () => { closeFranjaLotesModal(); refreshAllHotspots(); });
    document.getElementById('franja-modal-confirm')?.addEventListener('click', commitFranjaFromModal);
    document.getElementById('franja-lotes-modal')?.addEventListener('mousedown', e => e.stopPropagation());
    document.getElementById('franja-lotes-modal')?.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
    
    document.getElementById('btn-undo-point')?.addEventListener('click', () => { if (currentLinePoints.length > 0) { currentLinePoints.pop(); if (currentLineType === 'calle') syncCallePanelUI(); refreshAllHotspots(); } });

    const btnDeleteLastLine = document.createElement('button'); btnDeleteLastLine.id = 'btn-delete-last-line'; btnDeleteLastLine.style.display = 'none'; document.body.appendChild(btnDeleteLastLine);
    btnDeleteLastLine.addEventListener('click', () => { if (allDrawnLines.length > 0) { allDrawnLines.pop(); refreshAllHotspots(); saveToLocal(); } });
    document.querySelectorAll('.nuke').forEach(btn => { btn.addEventListener('click', limpiarProyecto); }); document.querySelectorAll('.export-ai').forEach(btn => { btn.addEventListener('click', exportarDatosParaIA); });
    document.getElementById('btn-set-drone')?.addEventListener('click', () => { let val = prompt("Fijar Coordenada del Drone (Lat, Lng)\nEj: -41.3245, -72.9832", OrigenDrone ? `${OrigenDrone.lat}, ${OrigenDrone.lng}` : ""); if (val && val.includes(',')) { let parts = val.split(','); OrigenDrone = { lat: parseFloat(parts[0].trim()), lng: parseFloat(parts[1].trim()) }; saveToLocal(); document.getElementById('js-gmap-iframe').src = `https://maps.google.com/maps?q=${OrigenDrone.lat},${OrigenDrone.lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`; document.getElementById('js-directions-btn').href = `https://www.google.com/maps/dir/?api=1&destination=${OrigenDrone.lat},${OrigenDrone.lng}`; syncRutasDesdeOrigen({ refreshAll: true }).then(() => alert("📍 Origen Drone fijado.\nDistancias de pins ruta/horizonte recalculadas con tráfico.")); } });
    document.getElementById('btn-set-north')?.addEventListener('click', () => { if(!visor360) return; NorteOffset = visor360.getYaw(); saveToLocal(); alert("🧭 Brújula calibrada: El Norte Magnético apunta ahora a tu vista actual.\n(El parámetro 'norte' será incluido al Copiar Datos IA)."); const compassDial = document.getElementById('js-compass'); if(compassDial) compassDial.style.transform = `rotate(${-(visor360.getYaw() - NorteOffset)}deg)`; });
    document.getElementById('btn-edit-titles')?.addEventListener('click', () => { let t = prompt("Título del Proyecto (H1):", ConfigProyecto.titulo); let s = prompt("Subtítulo del Proyecto (p):", ConfigProyecto.subtitulo); if (t !== null && s !== null) { ConfigProyecto.titulo = t || 'PROYECTO INMOBILIARIO'; ConfigProyecto.subtitulo = s || ''; applyProjectConfig(); saveToLocal(); alert("Títulos actualizados temporalmente.\nAl hacer clic en 'COPIAR DATOS IA' se incluirán en el archivo JSON definitivo."); } });
    document.getElementById('btn-linea-pines')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLineaPinesActive) deactivateLineaPines();
        else activateLineaPines();
        refreshAllHotspots(true);
    });
    document.querySelectorAll('#dev-toolbar-pins .dev-btn:not(.action):not(.export):not(.export-ai):not(.nuke)').forEach(btn => { if(btn.id !== 'btn-set-drone' && btn.id !== 'btn-set-north' && btn.id !== 'btn-edit-titles' && btn.id !== 'btn-linea-pines') { btn.addEventListener('click', (e) => { deactivateLineaPines(); currentPinTypeMap = e.target.dataset.pintype; document.querySelectorAll('#dev-toolbar-pins .dev-btn:not(.action):not(.export):not(.export-ai):not(.nuke)').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); }); } });
    document.getElementById('btn-heatmap')?.addEventListener('click', function() { isHeatmapActive = !isHeatmapActive; this.classList.toggle('active', isHeatmapActive); document.body.classList.toggle('heatmap-mode', isHeatmapActive); updateSVGPaths(); });
    document.getElementById('btn-auto-macro')?.addEventListener('click', () => {
        const plan = collectLotesForAutoMacro();
        if (plan.mode === 'none') return alert("No hay lotes reconocibles.\n\n✓ Franja de lotes ya creada\n✓ Polígonos sólidos / masterplan\n✓ Un recuadro grande para subdividir\n\nActiva Modo Arquitecto y vuelve a intentar.");
        if (plan.mode === 'subdivide') {
            const nStr = prompt('📐 SUBDIVIDIR RECUADRO\n\n¿En cuántos lotes? (divisiones internas punteadas)', '10');
            if (nStr === null) return;
            const N = Math.max(2, Math.min(40, parseInt(nStr, 10) || 10));
            if (!createFranjaFromPolygon(plan.lotes[0], N)) return alert("No se pudo subdividir el polígono.");
            finalizeAutoMacroSession();
        } else if (plan.mode === 'franja-rebuild') {
            if(!confirm("✨ AUTO-MACRO\n\n¿Regenerar franja(s) con bordes sólidos finos y divisiones punteadas?\n\nSe eliminarán los trazos de lote antiguos superpuestos.")) return;
            plan.grupos.forEach(g => rebuildFranjaGroup(g.id));
            finalizeAutoMacroSession();
        } else {
            if(!confirm("✨ AUTO-MACRO\n\n¿Convertir " + plan.lotes.length + " lote(s) a estilo premium?\n• Perímetro: sólido fino\n• Divisiones internas: punteadas\n• Se eliminan trazos antiguos duplicados")) return;
            if (!runAutoMacroTransform(plan.lotes)) return alert("No se pudo aplicar AUTO-MACRO.");
        }
        finalizeAutoMacroSession();
        refreshAllHotspots();
        saveToLocal();
        flashScreenSuccess();
    });
}

function limpiarProyecto() { if(!confirm("⚠️ ¡ADVERTENCIA NUCLEAR! Vas a borrar TODOS los lotes, calles y pines.\n\n¿Estás seguro?")) return; clearFranjaDraft(); BaseDatosLotes = []; PuntosHorizonte = []; allDrawnLines = []; currentLinePoints = []; document.body.classList.remove('auto-macro-active'); document.body.classList.remove('masterplan-premium-active'); refreshAllHotspots(); localStorage.removeItem(FRESIA_CFG.autosaveKey); }

function safeGetStorage(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSetStorage(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
function buildCloudPayload() {
    const payload = { configProyecto: ConfigProyecto, origen: OrigenDrone, norte: NorteOffset, lotes: BaseDatosLotes, horizontes: PuntosHorizonte, trazos: allDrawnLines };
    if (FRESIA_CFG.payloadIncludeVista) payload.vista = FRESIA_CFG.vista;
    return payload;
}
function mergeAerialWithRemoteSuelo(remote, aerial) {
    const merged = { ...aerial };
    if (!remote) return merged;
    ['lotesSuelo', 'horizontesSuelo', 'trazosSuelo', 'norteSuelo'].forEach((k) => { if (remote[k] !== undefined) merged[k] = remote[k]; });
    return merged;
}
async function fetchGithubFileSha(user, repo, token, filename) {
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filename}`;
    const response = await fetch(url, { method: 'GET', headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (response.status === 404) return '';
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.message || `HTTP ${response.status}`); }
    const jsonRes = await response.json();
    return jsonRes.sha || '';
}
async function fetchGithubJsonContents(user, repo, token, filename) {
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filename}`;
    const response = await fetch(url, { method: 'GET', headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (response.status === 404) return { sha: '', data: null };
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.message || `HTTP ${response.status}`); }
    const jsonRes = await response.json();
    const raw = (jsonRes.content || '').replace(/\n/g, '');
    const decoded = JSON.parse(decodeURIComponent(escape(atob(raw))));
    return { sha: jsonRes.sha || '', data: decoded };
}
async function putGithubContents(user, repo, token, filename, message, contentEncoded, shaRef, onShaUpdate) {
    const url = `https://api.github.com/repos/${user}/${repo}/contents/${filename}`;
    const attemptPut = async (shaValue, isRetry) => {
        const payload = { message, content: contentEncoded };
        if (shaValue) payload.sha = shaValue;
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            const result = await response.json();
            if (result.content && result.content.sha && onShaUpdate) onShaUpdate(result.content.sha);
            return { ok: true, result };
        }
        const err = await response.json().catch(() => ({}));
        const msg = err.message || `HTTP ${response.status}`;
        if (!isRetry && (msg.includes('does not match') || response.status === 409)) {
            const freshSha = await fetchGithubFileSha(user, repo, token, filename);
            if (onShaUpdate) onShaUpdate(freshSha);
            return attemptPut(freshSha, true);
        }
        return { ok: false, message: msg };
    };
    return attemptPut(shaRef, false);
}
function setExportBtnState(btn, html, bg, disabled) {
    if (!btn) return;
    btn.innerHTML = html;
    if (bg !== undefined) btn.style.background = bg;
    btn.style.pointerEvents = disabled ? 'none' : 'auto';
    btn.style.opacity = disabled ? '0.7' : '1';
}
async function guardarEnNubeDirecto(btn, originalHtml) {
    const user = safeGetStorage('masterplan_user');
    const repo = safeGetStorage('masterplan_repo');
    const token = safeGetStorage('masterplan_token');
    if (!user || !repo || !token) {
        alert('⚠️ Para guardar en la nube, inicia sesión una vez en admin.html con tu repositorio GitHub.\n\nLas credenciales quedan guardadas en este navegador.');
        setExportBtnState(btn, originalHtml || '☁️ GUARDAR EN LA NUBE', '', false);
        return false;
    }
    const localPayload = buildCloudPayload();
    let shaRef = safeGetStorage(FRESIA_CFG.githubShaStorageKey) || '';
    let remoteData = null;
    try {
        const remote = await fetchGithubJsonContents(user, repo, token, FRESIA_CFG.githubDatosFile);
        shaRef = remote.sha || shaRef;
        remoteData = remote.data;
    } catch (e) {
        shaRef = await fetchGithubFileSha(user, repo, token, FRESIA_CFG.githubDatosFile);
    }
    let merged;
    if (FRESIA_CFG.mergeRemoteSueloFields) {
        merged = mergeAerialWithRemoteSuelo(remoteData, localPayload);
        delete merged.vista;
    } else {
        merged = remoteData ? Object.assign({}, remoteData, localPayload) : localPayload;
    }
    const jsonString = JSON.stringify(merged, null, 2);
    const contentEncoded = btoa(unescape(encodeURIComponent(jsonString)));
    const upload = await putGithubContents(
        user, repo, token, FRESIA_CFG.githubDatosFile,
        FRESIA_CFG.githubCommitMessage,
        contentEncoded,
        shaRef,
        (sha) => safeSetStorage(FRESIA_CFG.githubShaStorageKey, sha)
    );
    if (upload.ok) {
        setExportBtnState(btn, '✅ GUARDADO EN NUBE', '#10b981', true);
        flashScreenSuccess();
        setTimeout(() => setExportBtnState(btn, originalHtml || '☁️ GUARDAR EN LA NUBE', '', false), 2500);
        return true;
    }
    alert('⛔ Error al guardar en GitHub: ' + (upload.message || 'desconocido'));
    setExportBtnState(btn, originalHtml || '☁️ GUARDAR EN LA NUBE', '', false);
    return false;
}
async function exportarDatosParaIA(event) {
    if (guardarNubeEnCurso) return;
    saveToLocal();
    const btn = event && event.target ? event.target : null;
    const originalHtml = btn ? btn.innerHTML : '☁️ GUARDAR EN LA NUBE';
    guardarNubeEnCurso = true;
    setExportBtnState(btn, '☁️ GUARDANDO...', '', true);
    try {
        if (window.self !== window.top) {
            window.parent.postMessage({ type: FRESIA_CFG.savePostMessageType, payload: buildCloudPayload(), file: FRESIA_CFG.saveFile }, '*');
            setExportBtnState(btn, '✅ GUARDADO EN NUBE', '#10b981', true);
            setTimeout(() => setExportBtnState(btn, originalHtml, '', false), 2500);
            return;
        }
        await guardarEnNubeDirecto(btn, originalHtml);
    } catch (error) {
        alert('⚠️ Error de conexión al guardar en la nube. Revisa tu internet e intenta de nuevo.');
        setExportBtnState(btn, originalHtml, '', false);
    } finally {
        guardarNubeEnCurso = false;
    }
}

function renderFranjaLotLabel(hotSpotDiv, args) {
    hotSpotDiv.className = 'franja-lot-label';
    hotSpotDiv.textContent = args.numero || '00';
}
function renderCalleServidumbreLabel(hotSpotDiv, args) {
    hotSpotDiv.className = 'calle-servidumbre-label';
    hotSpotDiv.textContent = 'SERVIDUMBRE DE PASO';
    const scale = args?.labelScale ?? draftCalleLabelScale ?? 1;
    hotSpotDiv.style.transform = `translate(-50%, -50%) scale(${scale})`;
    if (args?.isDraft) hotSpotDiv.style.opacity = '0.72';
}
function renderCalleMoveHandle(hotSpotDiv, args) {
    hotSpotDiv.className = 'calle-move-handle';
    hotSpotDiv.textContent = '✥';
    hotSpotDiv.title = 'Arrastra para mover toda la calle';
    const startDrag = (e) => {
        if (currentLineType === 'eraser') return;
        e.stopPropagation(); e.preventDefault();
        const line = allDrawnLines.find(l => l.id === args.lineId && l.tipo === 'calle');
        if (!line) return;
        const mock = getMockEvent(e);
        const coords = visor360?.mouseEventToCoords(mock);
        if (!coords) return;
        hotSpotDiv.classList.add('is-dragging');
        draggingCalleMove = { lineId: args.lineId, origPts: line.puntos.map(pt => [...pt]), startPY: [coords[0], coords[1]], el: hotSpotDiv };
    };
    hotSpotDiv.addEventListener('mousedown', startDrag);
    hotSpotDiv.addEventListener('touchstart', startDrag, { passive: false });
}
function renderFranjaDivHandle(hotSpotDiv, args) {
    hotSpotDiv.className = 'franja-div-handle';
    hotSpotDiv.title = 'Arrastra para mover división (ajustar m²)';
    const startDrag = (e) => {
        e.stopPropagation(); e.preventDefault();
        hotSpotDiv.classList.add('is-dragging');
        draggingFranjaDiv = { gid: args.gid, splitIdx: args.splitIdx, el: hotSpotDiv };
    };
    hotSpotDiv.addEventListener('mousedown', startDrag);
    hotSpotDiv.addEventListener('touchstart', startDrag, { passive: false });
    hotSpotDiv.addEventListener('mousedown', (e) => {
        if (currentLineType !== 'eraser') return;
        e.stopPropagation(); e.preventDefault();
        applyEraserDelete(args.gid);
        refreshAllHotspots(true);
        saveToLocal();
    }, true);
}

function renderHiddenVertex(hotSpotDiv, args) { 
    hotSpotDiv.classList.add('vertex-marker'); hotSpotDiv.id = args.hsId;
    if (args.isFranjaCorner || args.type === 'franja-grupo') hotSpotDiv.classList.add('franja-corner-marker');
    if (args.isFranjaElastic) hotSpotDiv.classList.add('franja-elastic-node');
    if (!DOMCache.markers[args.lineId]) DOMCache.markers[args.lineId] = { base: [] }; DOMCache.markers[args.lineId].base[args.idx] = hotSpotDiv; 
    if (args.lineId === currentTempLineId) { hotSpotDiv.classList.add('drawing-node'); }
    if (args.lineId === currentTempLineId && args.idx === 0 && currentLinePoints.length >= 3 && currentLineType !== 'cortar' && currentLineType !== 'eraser') { hotSpotDiv.classList.add('origin-vertex'); }
    if (args.lineId === arq2TempLineId && args.idx === 0 && arq2LinePoints.length >= 3 && isArquitecto2Active) { hotSpotDiv.classList.add('origin-vertex'); }
    if (closeOriginHighlighted && ((args.lineId === currentTempLineId && args.idx === 0) || (args.lineId === arq2TempLineId && args.idx === 0))) {
        hotSpotDiv.classList.add('origin-vertex-ready');
    }
    if (args.lineId === currentTempLineId && currentLineType === 'calle' && args.idx === currentLinePoints.length - 1 && currentLinePoints.length >= 2) {
        hotSpotDiv.classList.add('calle-finish-vertex');
    }
    const onEraseVertex = (e) => {
        if (currentLineType !== 'eraser') return;
        e.stopPropagation(); e.preventDefault();
        applyEraserDelete(args.lineId);
        refreshAllHotspots(true);
        saveToLocal();
    };
    hotSpotDiv.addEventListener('mousedown', onEraseVertex);
    hotSpotDiv.addEventListener('touchstart', onEraseVertex, { passive: false });
    if (args.isGuide && currentLineType !== 'eraser' && currentLineType !== 'cortar' && args.type !== 'divisoria' && args.type !== 'borde-macro' && (args.type !== 'calle' || currentLineType === 'calle')) { 
        const startDragGuide = (e) => {
            e.stopPropagation(); e.preventDefault();
            const m0 = getMockEvent(e);
            hotSpotDiv.classList.add('is-dragging');
            draggingVertex = { lineId: args.lineId, idx: args.idx, el: hotSpotDiv, hsId: args.hsId, startX: m0.clientX, startY: m0.clientY, target: args.target };
        }; 
        hotSpotDiv.addEventListener('mousedown', startDragGuide); hotSpotDiv.addEventListener('touchstart', startDragGuide, {passive: false}); 
    } 
}

function refreshAllHotspots(skipIntegrity) {
    if(!visor360) return; if (!skipIntegrity) ensureFranjaIntegrity(); DOMCache.markers = {}; const currentSpots = visor360.getConfig().hotSpots || [];
    for (let i = currentSpots.length - 1; i >= 0; i--) { if(currentSpots[i].id) { try { visor360.removeHotSpot(currentSpots[i].id); } catch(err) {} } }
    document.querySelectorAll('.pnlm-hotspot-base').forEach(el => { try { if(el.parentNode) el.parentNode.removeChild(el); } catch(err) {} });
    setTimeout(() => { getHotspotsConfig().forEach(hs => { try { visor360.addHotSpot(hs); } catch(err) {} }); syncSVGElements(); updateSVGPaths(); renderSidebarList(BaseDatosLotes); }, 10);
}

function bindPinEvents(element, args, hotSpotDiv) {
    const pickPin = (e) => {
        if (e.target.closest('.pin-quick-actions') || e.target.closest('.qa-btn')) return;
        if (isDevModePinsActive && !pickedPin) { e.stopPropagation(); pickedPin = args; hotSpotDiv.style.opacity = '0.0'; }
    };
    element.addEventListener('mousedown', pickPin); element.addEventListener('touchstart', pickPin, {passive: false});
    element.addEventListener('dblclick', (e) => {
        if (e.target.closest('.pin-quick-actions') || e.target.closest('.qa-btn')) return;
        if (isDevModePinsActive) { e.stopPropagation(); openPinEditor(args, false); }
    });
}

function addQuickActions(parent, args) {
    const qa = document.createElement('div'); qa.classList.add('pin-quick-actions');
    qa.innerHTML = `<button class="qa-btn qa-edit" data-id="${args.id}" title="Editar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button><button class="qa-btn qa-delete" data-id="${args.id}" title="Eliminar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
    parent.appendChild(qa);
    const blockPinPick = (e) => { e.stopPropagation(); };
    qa.addEventListener('mousedown', blockPinPick);
    qa.addEventListener('touchstart', blockPinPick, { passive: false });
}

function setupPinResizing() { document.addEventListener('wheel', (event) => { if (event.shiftKey && !isDevModeDrawActive && !isDevModePinsActive) { event.preventDefault(); event.stopPropagation(); if (event.deltaY < 0 && currentPinSizeIndex < 3) currentPinSizeIndex++; else if (event.deltaY > 0 && currentPinSizeIndex > 0) currentPinSizeIndex--; refreshAllHotspots(); } }, { passive: false }); }

function getCardVis(args) {
    const defaults = { titulo: true, tituloPlano: true, precio: true, precioCLP: true, imagen: true, statusPill: true, superficie: true, terreno: true, favorito: true, acciones: true };
    if (!args?.cardVis) return defaults;
    return Object.assign({}, defaults, args.cardVis);
}
function readCardVisFromEditor() {
    const vis = {};
    document.querySelectorAll('.card-vis-toggle').forEach(cb => { vis[cb.dataset.vis] = cb.checked; });
    return vis;
}
function setCardVisInEditor(cardVis) {
    const v = getCardVis({ cardVis });
    document.querySelectorAll('.card-vis-toggle').forEach(cb => { cb.checked = v[cb.dataset.vis] !== false; });
}
function buildCardTitleHTML(args, vis) {
    if (!vis.titulo && !vis.tituloPlano) return '';
    const c1 = args.tituloColor || '#1d1d1f';
    const c2 = args.tituloPlanoColor || '#0066cc';
    const main = args.titulo || 'Lote Sin Nombre';
    const plano = (args.tituloPlano || '').trim();
    let html = '<div class="card-title-row">';
    if (vis.titulo) html += `<span class="card-title-main" style="color:${c1}">${main}</span>`;
    if (vis.tituloPlano && plano) html += `<span class="card-title-plano" style="color:${c2}"> (${plano})</span>`;
    html += '</div>';
    return html;
}

const SVG_WAZE = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="#111827" d="M12 4.5C9 4.5 6.8 6.6 6.8 9.4c0 1.5.6 2.9 1.6 3.8v4.3l3.6-2 3.6 2v-4.3c1-1 1.6-2.3 1.6-3.8 0-2.8-2.2-4.9-5.4-4.9z"/><circle cx="9.6" cy="9.6" r="1.15" fill="#fff"/><circle cx="14.4" cy="9.6" r="1.15" fill="#fff"/><path d="M10 12.2c.6.7 1.2 1.1 2 1.1s1.4-.4 2-1.1" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/><circle cx="8.8" cy="15.6" r="1.25" fill="#111827"/><circle cx="15.2" cy="15.6" r="1.25" fill="#111827"/></svg>';
const SVG_MAPS_PIN = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

function getNavPinLinks(args) {
    const destLatLon = args.coordenadasDestino ? args.coordenadasDestino.replace(/\s/g, '') : '';
    const destinoQuery = destLatLon || encodeURIComponent(args.titulo || '');
    const linkWaze = destLatLon ? `https://www.waze.com/ul?ll=${destLatLon}&navigate=yes` : `https://www.waze.com/ul?q=${destinoQuery}&navigate=yes`;
    let linkGmapsFromProject = `https://www.google.com/maps/dir/?api=1&destination=${destinoQuery}&travelmode=driving`;
    if (OrigenDrone?.lat) linkGmapsFromProject = `https://www.google.com/maps/dir/?api=1&origin=${OrigenDrone.lat},${OrigenDrone.lng}&destination=${destinoQuery}&travelmode=driving`;
    return { linkWaze, linkGmapsFromProject, destinoQuery };
}
function buildNavGlassPillMarkup(args, opts) {
    opts = opts || {};
    const links = getNavPinLinks(args);
    const distArr = parseMetricaRuta(args.distancia, 'KM');
    const timeArr = parseMetricaRuta(args.tiempo, 'MIN');
    const title = (opts.title || args.titulo || 'RUTA').toUpperCase();
    const trafficTip = args.rutaEtiquetaTrafico ? ' title="' + args.rutaEtiquetaTrafico.replace(/"/g, '&quot;') + '"' : '';
    const trfBadge = opts.showTrafficBadge !== false ? '<span class="ruta-traffic-badge">TRF</span>' : '';
    const pillExtra = `<div class="ruta-divider"></div><div class="ruta-metrics"><span class="ruta-val">${distArr.v}<small>${distArr.u}</small></span><span class="ruta-val"${trafficTip}>~${timeArr.v}<small>${timeArr.u}</small>${trfBadge}</span></div><div class="ruta-links"><a href="${links.linkWaze}" target="_blank" class="r-link waze" title="Ir con Waze" draggable="false">${SVG_WAZE}</a><a href="${links.linkGmapsFromProject}" target="_blank" class="r-link gmaps" title="Ir con Google Maps" draggable="false">${SVG_MAPS_PIN}</a></div>`;
    if (opts.horizonMobileExpand) {
        const arrowBtn = '<button type="button" class="horizon-expand-arrow" aria-label="Desplegar distancia y navegación"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>';
        return `<span class="ruta-title">${title}</span>${arrowBtn}<div class="horizon-pill-extra">${pillExtra}</div>`;
    }
    if (opts.rutaMobileExpand) {
        const arrowBtn = '<button type="button" class="ruta-expand-arrow" aria-label="Desplegar distancia y navegación"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>';
        return `<span class="ruta-title">${title}</span>${arrowBtn}<div class="horizon-pill-extra">${pillExtra}</div>`;
    }
    return `<span class="ruta-title">${title}</span>${pillExtra}`;
}
function setupNavPinTouchInteractions() {
    if (setupNavPinTouchInteractions._bound) return;
    setupNavPinTouchInteractions._bound = true;
    let lastTap = 0;

    const toggleNavArrow = (e) => {
        if (document.body.classList.contains('dev-mode-pins-active')) return;
        
        const rutaArrow = e.target.closest('.ruta-hud-wrapper .ruta-expand-arrow');
        if (rutaArrow) {
            const wrapper = rutaArrow.closest('.ruta-hud-wrapper');
            if (!wrapper) return;
            e.preventDefault(); e.stopPropagation();
            const now = Date.now();
            if (now - lastTap < 300) return;
            lastTap = now;
            document.querySelectorAll('.ruta-hud-wrapper.ruta-pill-expanded').forEach(el => { if (el !== wrapper) el.classList.remove('ruta-pill-expanded'); });
            wrapper.classList.toggle('ruta-pill-expanded');
            return;
        }
        
        const horizonArrow = e.target.closest('.horizon-hud-wrapper .horizon-expand-arrow');
        if (horizonArrow) {
            const wrapper = horizonArrow.closest('.horizon-hud-wrapper');
            if (!wrapper) return;
            e.preventDefault(); e.stopPropagation();
            const now = Date.now();
            if (now - lastTap < 300) return;
            lastTap = now;
            document.querySelectorAll('.horizon-hud-wrapper.horizon-pill-expanded').forEach(el => { if (el !== wrapper) el.classList.remove('horizon-pill-expanded'); });
            wrapper.classList.toggle('horizon-pill-expanded');
            return;
        }
    };

    // Activamos los eventos tanto para táctil como para mouse universalmente
    document.addEventListener('touchend', toggleNavArrow, { passive: false, capture: true });
    document.addEventListener('click', toggleNavArrow, { capture: true });

    document.addEventListener('mousedown', (e) => {
        if (document.body.classList.contains('dev-mode-pins-active')) return;
        if (!e.target.closest('.horizon-hud-wrapper') && !e.target.closest('.ruta-hud-wrapper')) {
            document.querySelectorAll('.horizon-hud-wrapper.horizon-pin-open').forEach(el => el.classList.remove('horizon-pin-open'));
            document.querySelectorAll('.horizon-hud-wrapper.horizon-pill-expanded').forEach(el => el.classList.remove('horizon-pill-expanded'));
            document.querySelectorAll('.ruta-hud-wrapper.ruta-pill-expanded').forEach(el => el.classList.remove('ruta-pill-expanded'));
        }
    });
}

function generarSmartPin(hotSpotDiv, args) {
    hotSpotDiv.style.width = '0px'; hotSpotDiv.style.height = '0px'; hotSpotDiv.setAttribute('data-status', args.status || 'disponible');
    hotSpotDiv.addEventListener('mouseenter', () => { hotSpotDiv.style.zIndex = '999999'; }); hotSpotDiv.addEventListener('mouseleave', () => { hotSpotDiv.style.zIndex = ''; });
    let numeroLote = args.numero || '00'; let tiene360 = args.videoUrl ? 'has-360' : ''; let favs = JSON.parse(localStorage.getItem('mp360_favs') || '[]'); let isFav = favs.includes(args.id);
    const wrapper = document.createElement('div'); wrapper.className = `smart-pin-wrapper ${tiene360}`; wrapper.setAttribute('data-status', args.status || 'disponible');
    const scaler = document.createElement('div'); scaler.classList.add('pin-scaler');
    const pinContainer = document.createElement('div'); pinContainer.classList.add('pin-teardrop-container');
    pinContainer.innerHTML = `<div class="pin-teardrop-body"><div class="pin-teardrop-core">${numeroLote}</div></div><div class="pin-status-badge ${args.status || 'disponible'}"></div>`;
    const card = document.createElement('div'); card.classList.add('lote-card');
    const vis = getCardVis(args);
    
    let videoBtn = '';
    if (args.videoUrl) {
        card.classList.add('lote-card-video'); const isYouTube = args.videoUrl.toLowerCase().includes('youtube.com') || args.videoUrl.toLowerCase().includes('youtu.be');
        if (isYouTube) { videoBtn = `<button onclick="openInAppViewer(event, '${args.videoUrl}')" class="btn-action-new youtube-btn full" title="Ver en YouTube"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg> Ver Recorrido</button>`;
        } else { videoBtn = `<button onclick="openInAppViewer(event, '${args.videoUrl}')" class="btn-action-new video full" title="Explorar Inmersión"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> Explorar Inmersión</button>`; }
    }

    let precioCLP_HTML = ''; let rawPrice = (args.precio || '0').toString().toUpperCase();
    if(vis.precioCLP && (rawPrice.includes('UF') || rawPrice.includes('U.F.'))) {
        let cleanNum = rawPrice.replace(/UF|U\.F\.|/g, '').trim(); cleanNum = cleanNum.replace(/\./g, ''); cleanNum = cleanNum.replace(',', '.'); 
        let numPrecio = parseFloat(cleanNum); let ufFinal = UF_Online > 0 ? UF_Online : (ConfigProyecto.valorUF || 37500);
        if(numPrecio > 0 && ufFinal > 0) {
            let totalCLP = Math.round(numPrecio * ufFinal); let totalFormatted = "$" + totalCLP.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            let colorCLP = (args.status === 'vendido' || args.status === 'no_disponible') ? '#86868b' : '#10b981';
            let decoration = (args.status === 'vendido' || args.status === 'no_disponible') ? 'text-decoration: line-through;' : '';
            precioCLP_HTML = `<div style="font-size: 11px; font-weight: 800; color: ${colorCLP}; margin-top: -10px; margin-bottom: 12px; letter-spacing: 0.5px; ${decoration}">≈ ${totalFormatted} CLP</div>`;
        }
    }

    let actionGrid = '';
    if (vis.acciones) {
        actionGrid = `<div class="card-actions-grid">`; let galeriaBtn = '';
        if (args.galeria && args.galeria.length > 0) { galeriaBtn = `<button onclick="window.abrirGaleriaLote('${args.id}', event)" class="btn-action-new full" style="background: rgba(10, 132, 255, 0.1); color: #0A84FF; border-color: rgba(10, 132, 255, 0.2);" title="Ver Fotos"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Ver Fotos (${args.galeria.length})</button>`; }
        let shareBtn = `<button onclick="window.compartirLote('${args.numero}', '${args.titulo}', event)" class="btn-action-new share" title="Compartir Lote"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg> Compartir</button>`;
        if (args.status === 'disponible') { 
            actionGrid += `<a href="https://wa.me/569XXXXXXXX" target="_blank" class="btn-action-new whatsapp" draggable="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.275-.883-.628-1.48-1.403-1.653-1.702-.173-.299-.018-.461.13-.611.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg> Agendar</a>`;
            actionGrid += shareBtn; if(args.videoUrl) actionGrid += videoBtn; if(galeriaBtn) actionGrid += galeriaBtn; 
        } else { actionGrid += `<div class="btn-action-new disabled">${(args.status || 'NO DISP.').toUpperCase()}</div>`; actionGrid += shareBtn; if(args.videoUrl) actionGrid += videoBtn; if(galeriaBtn) actionGrid += galeriaBtn; }
        actionGrid += `</div>`;
    }
    const statusText = (args.status || 'disponible').replace('_', ' ');
    const titleHtml = buildCardTitleHTML(args, vis);
    const priceHtml = vis.precio ? `<div class="card-price" style="${precioCLP_HTML && vis.precioCLP ? 'margin-bottom:2px;' : ''}">${args.precio || 'UF 0'}</div>` : '';
    const clpHtml = vis.precioCLP ? precioCLP_HTML : '';
    const specParts = [];
    if (vis.superficie) specParts.push(`<div class="spec-item"><span>Superficie</span><b>${args.superficie || '0 m²'}</b></div>`);
    if (vis.terreno) specParts.push(`<div class="spec-item"><span>Terreno</span><b>${args.terreno || 'Plano'}</b></div>`);
    const specsHtml = specParts.length ? `<div class="card-specs">${specParts.join('')}</div>` : '';
    let favHtml = '';
    if (vis.favorito) {
        let favIcon = isFav ? '❤️' : '🤍'; let favClass = isFav ? 'card-fav-btn active' : 'card-fav-btn';
        favHtml = `<button onclick="window.toggleFavorite('${args.id}', event, this)" class="${favClass}" title="Añadir a Favoritos">${favIcon}</button>`;
    }
    const imgHtml = vis.imagen ? `<div class="card-img-box">${favHtml}<img src="${args.imagen}" alt="Lote" draggable="false">${vis.statusPill ? `<div class="card-status-pill ${args.status || 'disponible'}">${statusText}</div>` : ''}</div>` : (favHtml ? `<div class="card-img-box card-img-box--compact">${favHtml}</div>` : '');
    card.innerHTML = `${imgHtml}<div class="card-content">${titleHtml}${priceHtml}${clpHtml}${specsHtml}${actionGrid}</div>`;
        
    scaler.appendChild(pinContainer); wrapper.appendChild(scaler); wrapper.appendChild(card); addQuickActions(wrapper, args); hotSpotDiv.appendChild(wrapper); bindPinEvents(pinContainer, args, hotSpotDiv);
}

function generarPin360(hotSpotDiv, args) {
    hotSpotDiv.style.width = '0px'; hotSpotDiv.style.height = '0px'; hotSpotDiv.addEventListener('mouseenter', () => { hotSpotDiv.style.zIndex = '999999'; }); hotSpotDiv.addEventListener('mouseleave', () => { hotSpotDiv.style.zIndex = ''; });
    const wrapper = document.createElement('div'); wrapper.classList.add('smart-pin-wrapper', 'has-360');
    const scaler = document.createElement('div'); scaler.classList.add('pin-scaler');
    const pin = document.createElement('div'); pin.classList.add('pin-360'); pin.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg> <span style="font-size:12px; margin-left:4px; font-weight:800;">360°</span>`;
    const card = document.createElement('div'); card.classList.add('portal-card');
    card.innerHTML = `<div class="portal-img-container"><img src="https://images.unsplash.com/photo-1542224566-6e85f2e6772f?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80" alt="Vista 360" draggable="false"></div><div class="portal-overlay"><div class="portal-title">${args.titulo || 'VISTA 360'}</div><button onclick="openInAppViewer(event, '${args.url}')" class="portal-btn"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> Explorar Entorno</button></div>`;
    scaler.appendChild(pin); wrapper.appendChild(scaler); wrapper.appendChild(card); addQuickActions(wrapper, args); hotSpotDiv.appendChild(wrapper); bindPinEvents(pin, args, hotSpotDiv);
}

function generarMarcadorHorizonte(hotSpotDiv, args) {
    hotSpotDiv.style.width = '0px'; hotSpotDiv.style.height = '0px';
    const wrapper = document.createElement('div'); wrapper.className = 'horizon-hud-wrapper';
    const links = getNavPinLinks(args);
    const distTxt = args.distancia || '0 KM';
    const timeTxt = (args.tiempo || '0 MIN').replace(/^~/, '');
    const trafficLine = args.rutaEtiquetaTrafico || 'Estimación con tráfico Chile';

    wrapper.innerHTML = `<div class="horizon-detail-card"><div class="hdc-head"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${args.titulo || 'Destino'}</div><div class="hdc-metrics"><span>Distancia <b>${distTxt}</b></span><span>Tiempo <b>~${timeTxt}</b></span></div><div class="hdc-traffic">${trafficLine}</div><div class="hdc-nav-row"><a href="${links.linkWaze}" target="_blank" class="hdc-nav-btn waze" draggable="false">${SVG_WAZE} Waze</a><a href="${links.linkGmapsFromProject}" target="_blank" class="hdc-nav-btn gmaps" draggable="false">${SVG_MAPS_PIN} Maps</a></div></div><div class="ruta-glass-pill">${buildNavGlassPillMarkup(args, { title: args.titulo || 'HORIZONTE', horizonMobileExpand: true })}</div><div class="ruta-line-down"></div><div class="ruta-target-dot"></div>`;
    hotSpotDiv.appendChild(wrapper); addQuickActions(wrapper, args);
    const pill = wrapper.querySelector('.ruta-glass-pill');
    bindPinEvents(pill || wrapper, args, hotSpotDiv);
}

function generarMarcadorRuta(hotSpotDiv, args) {
    hotSpotDiv.style.width = '0px'; hotSpotDiv.style.height = '0px';
    const wrapper = document.createElement('div'); wrapper.className = 'ruta-hud-wrapper';
    wrapper.innerHTML = `<div class="ruta-glass-pill">${buildNavGlassPillMarkup(args, { title: args.titulo || 'RUTA', rutaMobileExpand: true })}</div><div class="ruta-line-down"></div><div class="ruta-target-dot"></div>`;
    hotSpotDiv.appendChild(wrapper); addQuickActions(wrapper, args);
    const pill = wrapper.querySelector('.ruta-glass-pill');
    bindPinEvents(pill || wrapper, args, hotSpotDiv);
}

function generarMarcadorCasa360(hotSpotDiv, args) {
    hotSpotDiv.style.width = '0px'; hotSpotDiv.style.height = '0px';
    const wrapper = document.createElement('div'); wrapper.className = 'casa-hud-wrapper';
    
    wrapper.innerHTML = `
        <div class="pin-scaler">
            <div class="casa-glass-card" onclick="openInAppViewer(event, '${args.url}')">
                <div class="casa-play-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M4 2.69127C4 1.93067 4.81547 1.44851 5.48192 1.81506L22.4069 11.1238C23.0977 11.5037 23.0977 12.4963 22.4069 12.8762L5.48192 22.1849C4.81546 22.5515 4 22.0693 4 21.3087V2.69127Z"/></svg>
                </div>
                <span class="casa-title">${args.titulo || 'CASA TOUR'}</span>
            </div>
        </div>
    `;
    
    hotSpotDiv.appendChild(wrapper);
    addQuickActions(wrapper, args);
    bindPinEvents(wrapper.querySelector('.casa-glass-card'), args, hotSpotDiv);
}

function setupUI() {
    const mapPanel = document.getElementById('js-map-panel'); const dock = document.getElementById('js-dock'); const sidebar = document.getElementById('js-sidebar');
    if(OrigenDrone && OrigenDrone.lat && OrigenDrone.lng) { const gmap = document.getElementById('js-gmap-iframe'); const btnDir = document.getElementById('js-directions-btn'); if(gmap) gmap.src = `https://maps.google.com/maps?q=${OrigenDrone.lat},${OrigenDrone.lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`; if(btnDir) btnDir.href = `https://www.google.com/maps/dir/?api=1&destination=${OrigenDrone.lat},${OrigenDrone.lng}`; }
    const btnMap = document.getElementById('js-location-btn'); if(btnMap && mapPanel) { btnMap.addEventListener('click', (e) => { e.stopPropagation(); mapPanel.classList.toggle('open'); if(sidebar) sidebar.classList.remove('open'); }); }
    const btnCloseMap = document.getElementById('js-close-map'); if(btnCloseMap) { btnCloseMap.addEventListener('click', (e) => { e.stopPropagation(); mapPanel.classList.remove('open'); }); }
    const btnLotes = document.getElementById('js-toggle-btn'); if(btnLotes && sidebar) { btnLotes.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.toggle('open'); if(mapPanel) mapPanel.classList.remove('open'); }); }
    const btnGps = document.getElementById('js-btn-gps'); if (btnGps) { btnGps.addEventListener('click', () => { btnGps.innerText = "Sincronizando satélites..."; if (navigator.geolocation) { navigator.geolocation.getCurrentPosition( async (pos) => { const lat = pos.coords.latitude; const lon = pos.coords.longitude; if (OrigenDrone && OrigenDrone.lat) { const est = await calcularRutaCompleta(lat, lon, OrigenDrone.lat, OrigenDrone.lng); btnGps.style.display = 'none'; document.getElementById('js-gps-result').style.display = 'block'; document.getElementById('js-gps-km').innerText = est.km; document.getElementById('js-gps-min').innerText = est.min; } else { btnGps.innerText = "Error: Drone sin origen"; } }, (err) => { btnGps.innerText = "Acceso GPS Denegado"; }, { enableHighAccuracy: true } ); } else { btnGps.innerText = "GPS No Soportado"; } }); }
}

function renderSidebarList(lista) {
    const container = document.getElementById("js-lotes-list"); if(!container) return; container.innerHTML = "";
    let favs = JSON.parse(localStorage.getItem('mp360_favs') || '[]'); const activeBtn = document.querySelector(".filter-btn.active"); const filtroStatus = activeBtn ? activeBtn.getAttribute("data-status") : "todos";
    lista.forEach(lote => { 
        if(lote.tipo !== 'lote') return; 
        if (filtroStatus === 'favoritos' && !favs.includes(lote.id)) return;
        const isFav = favs.includes(lote.id); const heartHtml = isFav ? '<span style="color:#f43f5e; font-size:10px; margin-right:4px;">❤️</span>' : '';
        const item = document.createElement("div"); item.classList.add("lote-item"); 
        item.innerHTML = `<div class="lote-item-info"><h4>${heartHtml}<span>${lote.numero}</span> ${lote.titulo}</h4><p>${lote.superficie}</p></div><span class="badge ${lote.status}">${lote.status.substring(0,4)} .</span>`; 
        item.addEventListener("click", () => { visor360.lookAt(lote.pitch, lote.yaw, 80, 1500); }); 
        container.appendChild(item); 
    });
}

function setupFilters() {
    document.querySelectorAll(".filter-btn").forEach(btn => { 
        btn.addEventListener("click", (e) => { 
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active")); e.target.classList.add("active"); refreshAllHotspots(); 
            const status = e.target.getAttribute("data-status"); let sumP = 0, sumY = 0, c = 0; 
            getHotspotsConfig().forEach(hs => { if (hs.createTooltipFunc === generarSmartPin && hs.createTooltipArgs) { if (status === 'todos' || hs.createTooltipArgs.status === status || status === 'favoritos') { sumP += hs.pitch; sumY += hs.yaw; c++; } } }); 
            if (c > 0) visor360.lookAt(sumP / c, sumY / c, status === 'todos' ? 125 : 85, 2000); 
        }); 
    });
}

window.abrirRutaServicio = function(categoria, event) { if(event) event.stopPropagation(); if(!OrigenDrone || !OrigenDrone.lat) { alert("⚠️ Ubicación del proyecto no definida.\nEl administrador debe fijar el 'Origen Drone' en el Panel de Control para buscar servicios exactos."); return; } const url = `https://www.google.com/maps/search/${encodeURIComponent(categoria)}/@${OrigenDrone.lat},${OrigenDrone.lng},14z`; window.open(url, '_blank'); document.getElementById('js-poi-panel')?.classList.remove('open'); }
document.addEventListener("DOMContentLoaded", () => { const btnTrigger = document.getElementById('js-poi-trigger'); const panelPoi = document.getElementById('js-poi-panel'); const btnClosePoi = document.getElementById('js-close-poi'); if(btnTrigger && panelPoi) { btnTrigger.addEventListener('click', (e) => { e.stopPropagation(); panelPoi.classList.toggle('open'); document.getElementById('js-sidebar')?.classList.remove('open'); document.getElementById('js-map-panel')?.classList.remove('open'); }); } if(btnClosePoi) { btnClosePoi.addEventListener('click', (e) => { e.stopPropagation(); panelPoi.classList.remove('open'); }); } document.getElementById('panorama-container').addEventListener('mousedown', () => { panelPoi?.classList.remove('open'); }); document.getElementById('panorama-container').addEventListener('touchstart', () => { panelPoi?.classList.remove('open'); }, {passive: true}); });

let galeriaActiva = []; let galeriaIndiceActual = 0;
window.abrirGaleriaLote = function(loteId, event) { if(event) event.stopPropagation(); const lote = BaseDatosLotes.find(l => l.id === loteId); if(!lote || !lote.galeria || lote.galeria.length === 0) return; galeriaActiva = lote.galeria; galeriaIndiceActual = 0; document.getElementById('mac-g-title').innerText = lote.titulo || "Galería de Lote"; renderizarThumbs(); cargarFotoPrincipal(0); document.getElementById('mac-gallery-modal').classList.add('open'); }
window.cerrarGaleriaLote = function() { document.getElementById('mac-gallery-modal').classList.remove('open'); document.getElementById('img-gallery-main').classList.remove('zoomed'); setTimeout(() => { document.getElementById('img-gallery-main').src = ""; }, 300); }
window.navegarGaleria = function(direccion) { galeriaIndiceActual += direccion; if (galeriaIndiceActual < 0) galeriaIndiceActual = galeriaActiva.length - 1; if (galeriaIndiceActual >= galeriaActiva.length) galeriaIndiceActual = 0; cargarFotoPrincipal(galeriaIndiceActual); }
function renderizarThumbs() { const container = document.getElementById('mac-g-thumbs-container'); container.innerHTML = ''; galeriaActiva.forEach((url, index) => { const img = document.createElement('img'); img.src = url; img.className = `mac-g-thumb ${index === 0 ? 'active' : ''}`; img.onclick = () => cargarFotoPrincipal(index); container.appendChild(img); }); }
function cargarFotoPrincipal(index) { galeriaIndiceActual = index; const mainImg = document.getElementById('img-gallery-main'); mainImg.classList.remove('zoomed'); mainImg.src = galeriaActiva[index]; document.querySelectorAll('.mac-g-thumb').forEach((thumb, i) => { thumb.classList.toggle('active', i === index); }); }

window.compartirLote = function(numero, titulo, event) { if(event) event.stopPropagation(); const url = window.location.origin + window.location.pathname + '?lote=' + numero; if (navigator.share) { navigator.share({ title: titulo || 'Mira este lote', text: 'He estado revisando este Masterplan y me interesó este terreno. Míralo aquí:', url: url }).catch(()=>{}); } else { navigator.clipboard.writeText(url).then(() => { alert('✅ Enlace directo copiado al portapapeles.\nPuedes pegarlo en WhatsApp o correo.'); }); } }
window.toggleFavorite = function(loteId, event, btnEl) { if(event) event.stopPropagation(); let favs = JSON.parse(localStorage.getItem('mp360_favs') || '[]'); if(favs.includes(loteId)) { favs = favs.filter(id => id !== loteId); btnEl.classList.remove('active'); btnEl.innerHTML = '🤍'; } else { favs.push(loteId); btnEl.classList.add('active'); btnEl.innerHTML = '❤️'; } localStorage.setItem('mp360_favs', JSON.stringify(favs)); const activeFilter = document.querySelector('.filter-btn.active'); if(activeFilter && activeFilter.getAttribute('data-status') === 'favoritos') { document.querySelector('.filter-btn[data-status="favoritos"]').click(); } else { renderSidebarList(BaseDatosLotes); } }

function setupSunEngine() {
    const btn = document.getElementById('js-sun-btn'); const hud = document.getElementById('sun-hud'); if(!btn || !hud) return;
    btn.addEventListener('click', () => {
        if(!visor360) return; let este = NorteOffset + 90; let norteMediodia = NorteOffset; let oeste = NorteOffset - 90;
        document.getElementById('js-sidebar')?.classList.remove('open'); document.getElementById('js-map-panel')?.classList.remove('open'); document.getElementById('js-poi-panel')?.classList.remove('open');
        hud.innerText = "☀️ AMANECER (ESTE)"; hud.classList.add('show'); visor360.lookAt(5, este, 110, 2000);
        setTimeout(() => { hud.innerText = "☀️ MEDIODÍA SOLAR (NORTE)"; visor360.lookAt(45, norteMediodia, 110, 3500); 
            setTimeout(() => { hud.innerText = "☀️ ATARDECER (OESTE)"; visor360.lookAt(5, oeste, 110, 3500); setTimeout(() => { hud.classList.remove('show'); }, 3500); }, 4000);
        }, 2500);
    });
}

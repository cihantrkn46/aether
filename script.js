// ==================== CONFIG & DATA ====================
const CONFIG = {
    MAX_CACHE: 200,
    DEBOUNCE_MS: 300,
    RETRY_ATTEMPTS: 3,
    RETRY_BASE_MS: 1000,
    MAX_TEXT_LEN: 5000,
    HISTORY_MAX: 100,
    OCR_LANG_MAP: {
        'tr': 'tur', 'en': 'eng', 'zh': 'chi_sim', 'pl': 'pol',
        'ur': 'urd', 'ar': 'ara', 'uk': 'ukr', 'sv': 'swe', 'ne': 'nep'
    }
};

const LANG_DATA = {
    'auto': { flag: '🌐', name: 'Otomatik Algıla', api: 'auto', label: 'Otomatik', voice: 'tr-TR', tesseract: 'tur+eng' },
    'tr-TR': { flag: '🇹🇷', name: 'Türkçe', api: 'tr', label: 'Türkçe', voice: 'tr-TR', tesseract: 'tur' },
    'en-US': { flag: '🇺🇸', name: 'İngilizce', api: 'en', label: 'İngilizce', voice: 'en-US', tesseract: 'eng' },
    'zh-CN': { flag: '🇨🇳', name: 'Çince (Basitleştirilmiş)', api: 'zh', label: 'Çince', voice: 'zh-CN', tesseract: 'chi_sim' },
    'pl-PL': { flag: '🇵🇱', name: 'Lehçe (Polonca)', api: 'pl', label: 'Lehçe', voice: 'pl-PL', tesseract: 'pol' },
    'ur-PK': { flag: '🇵🇰', name: 'Urduca', api: 'ur', label: 'Urduca', voice: 'ur-PK', tesseract: 'urd', rtl: true },
    'ar-SA': { flag: '🇸🇦', name: 'Arapça', api: 'ar', label: 'Arapça', voice: 'ar-SA', tesseract: 'ara', rtl: true },
    'uk-UA': { flag: '🇺🇦', name: 'Ukraynaca', api: 'uk', label: 'Ukraynaca', voice: 'uk-UA', tesseract: 'ukr' },
    'sv-SE': { flag: '🇸🇪', name: 'İsveççe', api: 'sv', label: 'İsveççe', voice: 'sv-SE', tesseract: 'swe' },
    'ne-NP': { flag: '🇳🇵', name: 'Nepalce', api: 'ne', label: 'Nepalce', voice: 'ne-NP', tesseract: 'nep' }
};

const ICONS = {
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    xmark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warning: '⚠️', info: 'ℹ️'
};

// ==================== LRU CACHE ====================
class LRUCache {
    constructor(max = 100) { this.max = max; this.map = new Map(); }
    get(k) {
        if (!this.map.has(k)) return undefined;
        const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v;
    }
    set(k, v) {
        if (this.map.has(k)) this.map.delete(k);
        else if (this.map.size >= this.max) { const first = this.map.keys().next().value; this.map.delete(first); }
        this.map.set(k, v);
    }
    has(k) { return this.map.has(k); }
    clear() { this.map.clear(); }
}

// ==================== HISTORY MANAGER ====================
class HistoryManager {
    constructor() {
        this.key = 'aether_history_v3';
        this.items = this.load();
    }
    load() {
        try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch { return []; }
    }
    save() {
        this.items = this.items.slice(0, CONFIG.HISTORY_MAX);
        localStorage.setItem(this.key, JSON.stringify(this.items));
    }
    add(source, target, sLang, tLang, starred = false) {
        if (!source || !target) return;
        this.items.unshift({ source, target, sLang, tLang, time: Date.now(), id: Date.now() + Math.random(), starred });
        this.save();
    }
    star(source, target, sLang, tLang) {
        const existing = this.items.find(i => i.source === source && i.target === target && i.sLang === sLang && i.tLang === tLang);
        if (existing) { existing.starred = true; this.save(); return existing; }
        const item = { source, target, sLang, tLang, time: Date.now(), id: Date.now() + Math.random(), starred: true };
        this.items.unshift(item);
        this.save();
        return item;
    }
    remove(id) { this.items = this.items.filter(i => i.id !== id); this.save(); }
    clear() { this.items = []; this.save(); }
    getAll() { return this.items; }
}

// ==================== MİNIMAL SES DALGASI (MİKROFON ÜZERİNDE) ====================
class WaveVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas?.getContext('2d');
        this.audioCtx = null;
        this.analyser = null;
        this.source = null;
        this.dataArray = null;
        this.rafId = null;
        this.isActive = false;
        this.anchorEl = null;
        this._reposition = () => this.position();
    }
    position() {
        if (!this.canvas || !this.anchorEl) return;
        const rect = this.anchorEl.getBoundingClientRect();
        this.canvas.style.left = `${rect.left + rect.width / 2}px`;
        this.canvas.style.top = `${rect.top}px`;
    }
    async start(anchorEl) {
        if (!this.canvas || !this.ctx) return;
        this.anchorEl = anchorEl || this.anchorEl;
        this.position();
        window.addEventListener('resize', this._reposition);
        window.addEventListener('scroll', this._reposition, true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.source = this.audioCtx.createMediaStreamSource(stream);
            this.source.connect(this.analyser);
            if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.isActive = true;
            this.canvas.classList.add('active');
            this.draw();
        } catch (e) {
            console.warn('Wave visualizer error:', e);
        }
    }
    stop() {
        this.isActive = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.source) { try { this.source.disconnect(); } catch(e){} }
        if (this.audioCtx) { try { this.audioCtx.close(); } catch(e){} }
        window.removeEventListener('resize', this._reposition);
        window.removeEventListener('scroll', this._reposition, true);
        this.canvas?.classList.remove('active');
        if (this.ctx && this.canvas) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
    draw() {
        if (!this.isActive || !this.ctx || !this.analyser) return;

        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.offsetWidth || 60;
        const h = this.canvas.offsetHeight || 26;
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, w, h);

        this.analyser.getByteFrequencyData(this.dataArray);

        const style = getComputedStyle(document.documentElement);
        const accent = style.getPropertyValue('--accent').trim() || '#818CF8';
        const accent2 = style.getPropertyValue('--accent-2').trim() || '#22D3EE';

        const barCount = 5;
        const gap = 3;
        const barWidth = (w - gap * (barCount - 1)) / barCount;
        const step = Math.floor(this.dataArray.length / barCount) || 1;

        const gradient = this.ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, accent2);
        gradient.addColorStop(1, accent);
        this.ctx.fillStyle = gradient;
        this.ctx.shadowBlur = 5;
        this.ctx.shadowColor = accent;

        for (let i = 0; i < barCount; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += this.dataArray[i * step + j] || 0;
            const avg = sum / step;
            const level = Math.min(1, avg / 150);
            const barH = Math.max(3, level * h);
            const x = i * (barWidth + gap);
            const y = (h - barH) / 2;
            const r = barWidth / 2;
            this.ctx.beginPath();
            if (this.ctx.roundRect) this.ctx.roundRect(x, y, barWidth, barH, r);
            else this.ctx.rect(x, y, barWidth, barH);
            this.ctx.fill();
        }

        this.ctx.shadowBlur = 0;
        this.rafId = requestAnimationFrame(() => this.draw());
    }
}

// ==================== PRO ÇEVİRİ MOTORU ====================
class TranslationEngine {
    constructor() {
        this.cache = new LRUCache(CONFIG.MAX_CACHE);
        this.pending = new Map();
        this.stats = { total: 0, cached: 0, failed: 0 };
        this.CHUNK_MAX = 1200;
    }
    buildKey(text, sApi, tApi) { return `${sApi}>${tApi}:${text}`; }
    async sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    splitIntoChunks(text, maxLen = this.CHUNK_MAX) {
        const clean = text.replace(/\r\n/g, '\n');
        if (clean.length <= maxLen) return [clean];

        let pieces;
        try {
            pieces = clean.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
        } catch (_) {
            // Fallback: noktalama işaretlerine göre böl
            pieces = clean.match(/[^.!?…]+[.!?…]*/g) || [clean];
        }

        const chunks = [];
        let current = '';
        for (const piece of pieces) {
            const candidate = current ? `${current} ${piece}` : piece;
            if (candidate.length > maxLen && current) {
                chunks.push(current);
                current = piece;
            } else {
                current = candidate;
            }
        }
        if (current) chunks.push(current);

        return chunks.flatMap(c => {
            if (c.length <= maxLen) return [c];
            const hard = [];
            for (let i = 0; i < c.length; i += maxLen) hard.push(c.slice(i, i + maxLen));
            return hard;
        });
    }

    async translateLong(text, sourceApi, targetApi, onProgress) {
        const chunks = this.splitIntoChunks(text.trim());
        if (chunks.length === 1) return this.translate(chunks[0], sourceApi, targetApi);

        const results = [];
        for (let i = 0; i < chunks.length; i++) {
            results.push(await this.translate(chunks[i], sourceApi, targetApi));
            onProgress?.(i + 1, chunks.length);
        }

        const translated = results.map(r => r.translated).join(' ').replace(/\s+/g, ' ').trim();
        const alternatives = results.find(r => r.alternatives?.length)?.alternatives || [];
        const confidence = results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length;
        const anyFallback = results.some(r => r.source === 'fallback');
        const allCached = results.every(r => r.fromCache);
        const detected = results.find(r => r.detected)?.detected || null;

        return {
            translated,
            detected,
            alternatives,
            fromCache: allCached,
            source: anyFallback ? 'fallback' : 'api',
            confidence,
            chunked: true,
            chunkCount: chunks.length
        };
    }

    async fetchWithRetry(url, attempts = CONFIG.RETRY_ATTEMPTS) {
        for (let i = 0; i < attempts; i++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) return res;
                if (res.status === 429) { 
                    await this.sleep(CONFIG.RETRY_BASE_MS * Math.pow(2, i)); 
                    continue; 
                }
                throw new Error(`HTTP ${res.status}`);
            } catch (err) { 
                if (err.name === 'AbortError') throw new Error('Timeout');
                if (i === attempts - 1) throw err; 
                await this.sleep(CONFIG.RETRY_BASE_MS * Math.pow(2, i)); 
            }
        }
        throw new Error('Retry exhausted');
    }
    
    async translate(text, sourceApi, targetApi) {
        const key = this.buildKey(text, sourceApi, targetApi);
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            this.stats.cached++;
            return { ...cached, fromCache: true, source: 'cache' };
        }
        if (this.pending.has(key)) return await this.pending.get(key);
        const promise = this._doTranslate(text, sourceApi, targetApi, key);
        this.pending.set(key, promise);
        try { return await promise; } finally { this.pending.delete(key); }
    }
    
    async _doTranslate(text, sourceApi, targetApi, cacheKey) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceApi)}&tl=${encodeURIComponent(targetApi)}&dt=t&dt=at&dt=rm&dt=bd&q=${encodeURIComponent(text)}`;
            const res = await this.fetchWithRetry(url);
            const data = await res.json();

            let translated = '';
            if (Array.isArray(data[0])) translated = data[0].map(chunk => chunk[0]).filter(Boolean).join('');
            const detected = (data[2] && data[2] !== sourceApi) ? data[2] : null;

            let alternatives = [];
            let confidence = 0.85;
            
            if (data[5] && Array.isArray(data[5])) {
                for (const block of data[5]) {
                    if (Array.isArray(block[2])) {
                        for (const alt of block[2]) {
                            if (alt[0] && alt[0] !== translated) alternatives.push(alt[0]);
                        }
                    }
                }
            }
            alternatives = [...new Set(alternatives)].slice(0, 5);
            
            if (alternatives.length > 2) confidence = 0.75;
            else if (alternatives.length > 0) confidence = 0.82;
            
            if (data[6] && data[6][0] && data[6][0][0]) {
                confidence = Math.max(0.6, confidence - 0.1);
            }

            const result = { 
                translated, 
                detected, 
                alternatives, 
                fromCache: false,
                source: 'api',
                confidence
            };
            this.cache.set(cacheKey, result);
            this.stats.total++;
            return result;
        } catch (err) {
            try {
                const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sourceApi === 'auto' ? 'autodetect' : sourceApi)}|${encodeURIComponent(targetApi)}`;
                const mmRes = await this.fetchWithRetry(mmUrl, 1);
                const mmData = await mmRes.json();
                const mmText = mmData?.responseData?.translatedText;
                if (mmText && mmData.responseStatus === 200) {
                    const result = {
                        translated: mmText,
                        detected: null,
                        alternatives: [],
                        fromCache: false,
                        source: 'fallback',
                        confidence: 0.65
                    };
                    this.cache.set(cacheKey, result);
                    return result;
                }
            } catch (mmErr) { /* fallback da başarısız */ }

            this.stats.failed++;
            throw err;
        }
    }
    clear() { this.cache.clear(); }
    getStats() { return this.stats; }
}

// ==================== TOAST SYSTEM ====================
function ensureToastContainer() {
    let c = document.querySelector('.toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
    return c;
}
function showToast(msg, type = 'info', duration = 2600) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let iconHtml = ICONS.info;
    if (type === 'success') iconHtml = ICONS.check;
    if (type === 'error') iconHtml = ICONS.xmark;
    if (type === 'warning') iconHtml = ICONS.warning;
    toast.innerHTML = `<span class="toast-icon">${iconHtml}</span><span>${escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => { 
        toast.style.opacity = '0'; 
        toast.style.transform = 'translateY(-10px)'; 
        setTimeout(() => toast.remove(), 300); 
    }, duration);
}
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ==================== CAMERA / OCR (Pil Dostu — Frame Diff) ====================
class CameraOCR {
    constructor(onText) {
        this.onText = onText;
        this.stream = null;
        this.video = document.getElementById('camera-video');
        this.canvas = document.getElementById('camera-canvas');
        this.loader = document.getElementById('camera-loader');
        this.isProcessing = false;
        this.continuous = false;
        this.continuousTimer = null;
        this.worker = null;
        this.workerLang = null;
        this.workerInitializing = null;

        // Frame diff için
        this.lastFrameHash = null;
        this.diffCanvas = document.createElement('canvas');
        this.diffCtx = this.diffCanvas.getContext('2d', { willReadFrequently: true });
        this.diffCanvas.width = 32;
        this.diffCanvas.height = 32;
        this.FRAME_DIFF_THRESHOLD = 0.08; // %8 fark threshold
    }

    // Basit frame hash: 32x32 downscale + ortalama piksel farkı
    computeFrameHash() {
        if (!this.video || this.video.readyState < 2) return null;
        try {
            this.diffCtx.drawImage(this.video, 0, 0, 32, 32);
            const data = this.diffCtx.getImageData(0, 0, 32, 32).data;
            // Basit "perceptual hash": her 4 pikselde bir luminance örnekle
            let hash = '';
            for (let i = 0; i < data.length; i += 16) {
                const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                hash += String.fromCharCode(Math.floor(lum / 4));
            }
            return hash;
        } catch (e) {
            return null;
        }
    }

    frameDiffPercent(prevHash, currHash) {
        if (!prevHash || !currHash || prevHash.length !== currHash.length) return 1;
        let diff = 0;
        for (let i = 0; i < prevHash.length; i++) {
            diff += Math.abs(prevHash.charCodeAt(i) - currHash.charCodeAt(i));
        }
        return diff / (prevHash.length * 64); // normalize 0-1
    }

    async getWorker(lang) {
        if (this.worker && this.workerLang === lang) return this.worker;
        if (this.workerInitializing) { 
            await this.workerInitializing; 
            if (this.workerLang === lang) return this.worker; 
        }
        if (this.worker) { 
            try { await this.worker.terminate(); } catch (e) {} 
            this.worker = null; 
        }
        this.workerInitializing = (async () => {
            this.worker = await Tesseract.createWorker(lang, 1, { logger: () => {} });
            this.workerLang = lang;
        })();
        await this.workerInitializing;
        this.workerInitializing = null;
        return this.worker;
    }
    async terminateWorker() {
        if (this.worker) { 
            try { await this.worker.terminate(); } catch (e) {} 
            this.worker = null; 
            this.workerLang = null; 
        }
    }
    async start() {
        if (!navigator.mediaDevices?.getUserMedia) { 
            showToast('Kamera desteklenmiyor', 'error'); 
            return false; 
        }
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            return true;
        } catch (err) { 
            showToast('Kamera erişimi reddedildi', 'error'); 
            return false; 
        }
    }
    stop() {
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        this.video.srcObject = null;
        this.stopContinuous();
        this.lastFrameHash = null;
    }
    startContinuous() {
        if (this.continuousTimer) return;
        this.continuous = true;
        this.lastFrameHash = null;
        this.tickContinuous();
    }
    stopContinuous() {
        this.continuous = false;
        if (this.continuousTimer) { clearTimeout(this.continuousTimer); this.continuousTimer = null; }
        this.lastFrameHash = null;
    }
    tickContinuous() {
        if (!this.continuous) return;

        const currHash = this.computeFrameHash();
        const diff = this.frameDiffPercent(this.lastFrameHash, currHash);

        if (diff < this.FRAME_DIFF_THRESHOLD) {
            // Kare neredeyse aynı, OCR atla ama kısa süre sonra tekrar kontrol et
            this.continuousTimer = setTimeout(() => this.tickContinuous(), 800);
            return;
        }

        this.lastFrameHash = currHash;
        this.captureAndRecognize().finally(() => {
            if (this.continuous) this.continuousTimer = setTimeout(() => this.tickContinuous(), 2500);
        });
    }
    async captureAndRecognize() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.loader?.classList.remove('hidden');
        try {
            const w = this.video.videoWidth || 1280;
            const h = this.video.videoHeight || 720;
            this.canvas.width = w; this.canvas.height = h;
            const ctx = this.canvas.getContext('2d');
            ctx.drawImage(this.video, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            const data = imageData.data;
            const pixelCount = w * h;

            // 1) Gri tonlama + histogram
            const gray = new Uint8ClampedArray(pixelCount);
            const hist = new Array(256).fill(0);
            for (let i = 0, p = 0; i < data.length; i += 4, p++) {
                const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                gray[p] = g;
                hist[g | 0]++;
            }

            // 2) Otsu eşiği
            let sum = 0;
            for (let t = 0; t < 256; t++) sum += t * hist[t];
            let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 128;
            for (let t = 0; t < 256; t++) {
                wB += hist[t];
                if (wB === 0) continue;
                wF = pixelCount - wB;
                if (wF === 0) break;
                sumB += t * hist[t];
                const mB = sumB / wB;
                const mF = (sum - sumB) / wF;
                const variance = wB * wF * (mB - mF) * (mB - mF);
                if (variance > maxVar) { maxVar = variance; threshold = t; }
            }

            // 3) Eşiğe göre keskinleştirilmiş siyah/beyaz metin
            for (let i = 0, p = 0; i < data.length; i += 4, p++) {
                const v = gray[p] > threshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = v;
            }
            ctx.putImageData(imageData, 0, 0);

            const blob = await new Promise(res => this.canvas.toBlob(res, 'image/png'));
            if (!blob) throw new Error('Canvas blob hatası');

            const srcKey = window.appInstance ? window.appInstance.currentSource : 'auto';
            let tessLang = 'eng+tur';
            if (srcKey !== 'auto' && LANG_DATA[srcKey]?.tesseract) tessLang = LANG_DATA[srcKey].tesseract;

            const worker = await this.getWorker(tessLang);
            const result = await worker.recognize(blob);
            const text = result.data.text?.trim();
            if (text && text.length > 1) {
                this.onText(text);
                if (!this.continuous) showToast(`${text.length} karakter okundu, tamamı çevriliyor…`, 'success');
            } else if (!this.continuous) {
                showToast('Metin algılanamadı', 'warning');
            }
        } catch (err) {
            console.error('OCR Hata:', err);
            if (!this.continuous) showToast('Görüntü okunurken hata oluştu', 'error');
        } finally {
            this.loader?.classList.add('hidden');
            this.isProcessing = false;
        }
    }
}

// ==================== APP CONTROLLER ====================
class App {
    constructor() {
        this.engine = new TranslationEngine();
        this.history = new HistoryManager();
        this.ocr = new CameraOCR((text) => this.onOcrText(text));
        this.visualizer = new WaveVisualizer('wave-canvas');

        this.currentSource = 'auto';
        this.currentTarget = 'en-US';
        this.selectionMode = 'source';

        this.debounceTimer = null;
        this.currentTranslationId = 0;
        this.isTranslating = false;
        this.liveModeActive = false;
        this.interpreterMode = false;
        this.isListening = false;
        this.listeningWhich = null;
        this.currentVoiceSpeed = parseFloat(localStorage.getItem('aether_speed')) || 1.0;
        this.currentFontSize = parseInt(localStorage.getItem('aether_font')) || 16;
        this.historyFavoritesOnly = false;

        this.recognizer = null;
        this.SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

        this.els = {};
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.renderLangCard('source');
        this.renderLangCard('target');
        this.updateCharCount();
        this.applyFontSize(this.currentFontSize);
        this.setupPWA();
        this.initParticles();
        this.renderHistory();
        this.syncThemeIcon();

        if (!this.SpeechRecognitionImpl) {
            const btnS = document.getElementById('btn-source');
            const btnT = document.getElementById('btn-target');
            [btnS, btnT].forEach(btn => {
                if (!btn) return;
                btn.disabled = true;
                btn.title = 'Bu tarayıcı sesle yazmayı desteklemiyor';
            });
        }

        if (!localStorage.getItem('aether_theme') && window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
                if (localStorage.getItem('aether_theme')) return;
                document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark');
                this.syncThemeIcon();
            });
        }
    }

    syncThemeIcon() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const btn = this.els['btn-theme-toggle'];
        if (!btn) return;
        const darkIcon = btn.querySelector('.icon-theme-dark');
        const lightIcon = btn.querySelector('.icon-theme-light');
        if (darkIcon) darkIcon.style.display = isLight ? 'none' : '';
        if (lightIcon) lightIcon.style.display = isLight ? '' : 'none';
    }
    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('aether_theme', next);
        this.syncThemeIcon();
    }

    cacheElements() {
        const ids = [
            'text-source','text-target','char-count','flag-source','flag-target',
            'name-source','name-target','label-source','label-target',
            'badge-source','badge-target','loader-source','loader-target',
            'typing-indicator','live-indicator','live-dot','live-track','interpreter-badge',
            'settings-modal','camera-modal','history-modal','modal-title','lang-list','lang-search',
            'settings-done','camera-done','history-done','btn-camera-header','btn-capture',
            'camera-video','wave-canvas','pwa-install-banner','btn-install-pwa','btn-dismiss-pwa',
            'alternatives-box','alternatives-list','btn-star','history-list','btn-clear-history',
            'btn-history-header','font-slider','camera-continuous-toggle','camera-toggle-track',
            'live-toggle','btn-theme-toggle','history-search','btn-history-favorites-filter',
            'translation-badge','badge-icon','badge-text','camera-translation','camera-original-text','camera-translated-text'
        ];
        ids.forEach(id => this.els[id] = document.getElementById(id));
    }

    scheduleTranslation() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.performTranslation(), CONFIG.DEBOUNCE_MS);
    }

    async performTranslation(force = false, retryCount = 0) {
        const srcEl = this.els['text-source'];
        const tgtEl = this.els['text-target'];
        if (!srcEl || !tgtEl) return;

        const text = srcEl.value.trim();
        if (!text) { 
            tgtEl.value = ''; 
            this.hideAlternatives(); 
            this.hideTranslationBadge(); 
            return; 
        }

        const sourceInfo = LANG_DATA[this.currentSource];
        const targetInfo = LANG_DATA[this.currentTarget];
        const pairKey = `${this.currentSource}>${this.currentTarget}:${text}`;

        if (!force && tgtEl.dataset.lastPair === pairKey) return;

        this.showTyping();
        this.setLoader('target', true);

        const myId = ++this.currentTranslationId;
        this.isTranslating = true;

        try {
            const { translated, detected, alternatives, fromCache, source, confidence, chunked, chunkCount } = await this.engine.translateLong(
                text, sourceInfo.api, targetInfo.api,
                (done, total) => { if (total > 1 && done === 1) showToast(`Uzun metin ${total} parçada tam çevriliyor…`, 'info'); }
            );
            if (myId !== this.currentTranslationId) return;

            tgtEl.value = translated;
            tgtEl.dataset.lastPair = pairKey;

            if (this.currentSource === 'auto' && detected) {
                const detectedKey = this.findLangKeyByApi(detected);
                if (detectedKey && this.els['flag-source']) {
                    this.els['flag-source'].textContent = LANG_DATA[detectedKey].flag;
                }
            }

            this.renderAlternatives(alternatives);
            this.showTranslationBadge(source, confidence, fromCache);

            if (!fromCache) this.history.add(text, translated, this.currentSource, this.currentTarget);

            if (chunked) showToast(`Uzun metin ${chunkCount} parçada tam çevrildi`, 'success');

            if (this.interpreterMode && this.liveModeActive && translated) {
                this.speakText(translated, targetInfo.voice);
            }

        } catch (err) {
            if (myId !== this.currentTranslationId) return;
            console.error('Çeviri hatası:', err);
            this.showTranslationBadge('error', 0, false);
            if (retryCount < 2) {
                showToast('Çeviri yapılamadı, tekrar deneniyor…', 'warning');
                setTimeout(() => {
                    if (myId === this.currentTranslationId) this.performTranslation(true, retryCount + 1);
                }, 1200 * (retryCount + 1));
            } else {
                showToast('Çeviri başarısız. İnternet bağlantınızı kontrol edin.', 'error');
            }
        } finally {
            if (myId === this.currentTranslationId) {
                this.isTranslating = false;
                this.hideTyping();
                this.setLoader('target', false);
            }
        }
    }

    async performReverseTranslation() {
        const srcEl = this.els['text-source'];
        const tgtEl = this.els['text-target'];
        const text = tgtEl?.value.trim();
        if (!srcEl || !tgtEl || !text) return;

        const sourceInfo = LANG_DATA[this.currentSource === 'auto' ? 'tr-TR' : this.currentSource];
        const targetInfo = LANG_DATA[this.currentTarget];

        this.setLoader('source', true);
        try {
            const { translated, source, confidence } = await this.engine.translateLong(text, targetInfo.api, sourceInfo.api);
            if (tgtEl.value.trim() !== text) return;
            srcEl.value = translated;
            this.updateCharCount();
            this.history.add(translated, text, this.currentSource, this.currentTarget);
            this.showTranslationBadge(source, confidence, false);
            if (this.interpreterMode && this.liveModeActive) this.speakText(translated, sourceInfo.voice);
        } catch (err) {
            console.error('Ters çeviri hatası:', err);
            showToast('Çeviri yapılamadı', 'error');
        } finally {
            this.setLoader('source', false);
        }
    }

    findLangKeyByApi(apiCode) {
        const found = Object.entries(LANG_DATA).find(([, v]) => v.api === apiCode);
        return found ? found[0] : null;
    }

    renderAlternatives(alts) {
        const box = this.els['alternatives-box'];
        const list = this.els['alternatives-list'];
        if (!box || !list) return;
        if (!alts || alts.length === 0) { box.classList.add('hidden'); return; }
        list.innerHTML = '';
        alts.forEach(alt => {
            const chip = document.createElement('span');
            chip.className = 'alt-chip';
            chip.textContent = alt;
            chip.addEventListener('click', () => {
                this.els['text-target'].value = alt;
                this.els['text-target'].dataset.lastPair = '';
            });
            list.appendChild(chip);
        });
        box.classList.remove('hidden');
    }
    hideAlternatives() { this.els['alternatives-box']?.classList.add('hidden'); }

    showTranslationBadge(source, confidence, fromCache) {
        const badge = this.els['translation-badge'];
        const icon = this.els['badge-icon'];
        const text = this.els['badge-text'];
        if (!badge || !icon || !text) return;
        
        badge.classList.remove('hidden', 'badge-cache', 'badge-retry', 'badge-error');
        
        if (source === 'error') {
            badge.classList.add('badge-error');
            icon.textContent = '⚠️';
            text.textContent = 'Çeviri Başarısız';
        } else if (fromCache) {
            badge.classList.add('badge-cache');
            icon.textContent = '💾';
            text.textContent = 'Önbellekten';
        } else if (source === 'fallback') {
            badge.classList.add('badge-retry');
            icon.textContent = '🔁';
            text.textContent = 'Yedek Sunucu';
        } else {
            icon.textContent = '⚡';
            text.textContent = confidence >= 0.9 ? 'Anlık Çeviri' : 
                              confidence >= 0.8 ? 'Anlık Çeviri' : 'Tahmini Çeviri';
        }
        badge.classList.remove('hidden');
    }
    hideTranslationBadge() {
        this.els['translation-badge']?.classList.add('hidden');
    }

    showTyping() { this.els['typing-indicator']?.classList.remove('hidden'); }
    hideTyping() { this.els['typing-indicator']?.classList.add('hidden'); }
    setLoader(which, show) {
        const el = this.els[`loader-${which}`];
        if (el) el.classList.toggle('hidden', !show);
    }

    updateCharCount() {
        const el = this.els['text-source'];
        const counter = this.els['char-count'];
        if (!el || !counter) return;
        const len = el.value.length;
        counter.textContent = `${len} / ${CONFIG.MAX_TEXT_LEN}`;
        counter.classList.remove('warn', 'danger', 'critical');
        if (len > 4500) counter.classList.add('critical');
        else if (len > 4000) counter.classList.add('danger');
        else if (len > 3000) counter.classList.add('warn');
    }

    applyFontSize(size) {
        document.querySelectorAll('textarea').forEach(t => t.style.fontSize = size + 'px');
        localStorage.setItem('aether_font', size);
    }

    renderLangCard(which) {
        const key = which === 'source' ? this.currentSource : this.currentTarget;
        const info = LANG_DATA[key];
        if (!info) return;
        const flagEl = document.getElementById(`flag-${which}`);
        const nameEl = document.getElementById(`name-${which}`);
        const micLabel = document.getElementById(`mic-label-${which}`);
        if (flagEl) flagEl.textContent = info.flag;
        if (nameEl) nameEl.textContent = info.name;
        if (micLabel) micLabel.textContent = info.api.toUpperCase();

        const textEl = document.getElementById(`text-${which}`);
        const cardEl = document.getElementById(`card-${which}`);
        if (textEl) textEl.dir = info.rtl ? 'rtl' : 'auto';
        cardEl?.classList.toggle('rtl-active', !!info.rtl);
    }

    renderLangList(filter = '') {
        const list = this.els['lang-list'];
        if (!list) return;
        const q = filter.trim().toLocaleLowerCase('tr');
        list.innerHTML = '';
        const activeKey = this.selectionMode === 'target' ? this.currentTarget : this.currentSource;

        const entries = Object.entries(LANG_DATA)
            .filter(([key]) => !(this.selectionMode === 'target' && key === 'auto'))
            .filter(([, info]) => !q || info.name.toLocaleLowerCase('tr').includes(q));

        entries.forEach(([key, info]) => {
            const item = document.createElement('div');
            item.className = 'lang-item';
            const isActive = key === activeKey;
            item.innerHTML = `<span>${info.flag} ${escapeHtml(info.name)}</span>${isActive ? ' ' + ICONS.check : ''}`;
            item.addEventListener('click', () => this.selectLanguage(key));
            list.appendChild(item);
        });
    }

    selectLanguage(key) {
        if (this.selectionMode === 'source') { this.currentSource = key; this.renderLangCard('source'); }
        else { this.currentTarget = key; this.renderLangCard('target'); }
        this.closeModal('settings-modal');
        this.els['text-target'].dataset.lastPair = '';
        this.scheduleTranslation();
    }

    swapLanguages() {
        if (this.currentSource === 'auto') { showToast('Otomatik algılamada dil değiştirilemez', 'warning'); return; }
        [this.currentSource, this.currentTarget] = [this.currentTarget, this.currentSource];
        this.renderLangCard('source'); this.renderLangCard('target');
        const srcEl = this.els['text-source']; 
        const tgtEl = this.els['text-target'];
        if (srcEl && tgtEl) { 
            const tmp = srcEl.value; 
            srcEl.value = tgtEl.value; 
            tgtEl.value = tmp; 
            this.updateCharCount(); 
            tgtEl.dataset.lastPair = ''; 
            if (srcEl.value.trim()) this.scheduleTranslation(); 
        }
    }

    openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
    closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

    openLangPicker(mode) {
        this.selectionMode = mode;
        if (this.els['modal-title']) this.els['modal-title'].textContent = mode === 'source' ? 'Kaynak Dil' : 'Hedef Dil';
        const langGroup = document.querySelector('.lang-group');
        const langSearchRow = document.querySelector('.lang-search-row');
        if (langGroup) langGroup.style.display = '';
        if (langSearchRow) langSearchRow.style.display = '';
        this.renderLangList(); 
        this.openModal('settings-modal');
    }
    
    openFullSettings() {
        if (this.els['modal-title']) this.els['modal-title'].textContent = 'Ayarlar';
        const langGroup = document.querySelector('.lang-group');
        const langSearchRow = document.querySelector('.lang-search-row');
        if (langGroup) langGroup.style.display = 'none';
        if (langSearchRow) langSearchRow.style.display = 'none';
        this.openModal('settings-modal');
    }

    async openCamera() { 
        const ok = await this.ocr.start(); 
        if (ok) { this.openModal('camera-modal'); this.hideCameraCaption(); }
    }
    closeCamera() {
        this.ocr.stop();
        this.els['camera-toggle-track']?.classList.remove('active');
        this.closeModal('camera-modal');
        this.hideCameraCaption();
        const langGroup = document.querySelector('.lang-group');
        const langSearchRow = document.querySelector('.lang-search-row');
        if (langGroup) langGroup.style.display = '';
        if (langSearchRow) langSearchRow.style.display = '';
    }

    onOcrText(text) {
        const srcEl = this.els['text-source'];
        if (!srcEl) return;
        srcEl.value = text;
        this.updateCharCount();

        if (this.ocr.continuous) {
            this.runCameraTranslation(text);
        } else {
            this.closeCamera();
            this.scheduleTranslation();
        }
    }

    async runCameraTranslation(text) {
        this.showCameraCaption(text, null);
        const sourceInfo = LANG_DATA[this.currentSource];
        const targetInfo = LANG_DATA[this.currentTarget];
        try {
            const { translated, alternatives, fromCache, source, confidence } = await this.engine.translateLong(
                text, sourceInfo.api, targetInfo.api
            );
            const tgtEl = this.els['text-target'];
            if (tgtEl) {
                tgtEl.value = translated;
                tgtEl.dataset.lastPair = `${this.currentSource}>${this.currentTarget}:${text}`;
            }
            this.renderAlternatives(alternatives);
            this.showTranslationBadge(source, confidence, fromCache);
            if (!fromCache) this.history.add(text, translated, this.currentSource, this.currentTarget);
            this.showCameraCaption(text, translated);
        } catch (err) {
            console.error('Kamera çeviri hatası:', err);
            this.showCameraCaption(text, null, true);
        }
    }

    showCameraCaption(original, translated, isError = false) {
        const box = this.els['camera-translation'];
        const origEl = this.els['camera-original-text'];
        const transEl = this.els['camera-translated-text'];
        if (!box || !origEl || !transEl) return;
        origEl.textContent = original.length > 140 ? original.slice(0, 140) + '…' : original;
        transEl.classList.toggle('camera-translated-error', isError);
        if (isError) transEl.textContent = 'Çeviri başarısız, tekrar deneyin';
        else if (translated === null) transEl.textContent = 'Çevriliyor…';
        else transEl.textContent = translated;
        box.classList.remove('hidden');
    }

    hideCameraCaption() {
        this.els['camera-translation']?.classList.add('hidden');
    }

    renderHistory(filter = '') {
        const list = this.els['history-list'];
        if (!list) return;
        const q = filter.trim().toLocaleLowerCase('tr');
        const allItems = this.history.getAll();
        let items = q ? allItems.filter(i =>
            i.source.toLocaleLowerCase('tr').includes(q) || i.target.toLocaleLowerCase('tr').includes(q)
        ) : allItems;
        if (this.historyFavoritesOnly) items = items.filter(i => i.starred);

        if (allItems.length === 0) { 
            list.innerHTML = '<div class="history-empty">Henüz çeviri geçmişi yok.</div>'; 
            return; 
        }
        if (items.length === 0) { 
            list.innerHTML = '<div class="history-empty">Sonuç bulunamadı.</div>'; 
            return; 
        }
        list.innerHTML = '';
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            const timeStr = new Date(item.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const sName = LANG_DATA[item.sLang]?.name || item.sLang;
            const tName = LANG_DATA[item.tLang]?.name || item.tLang;
            div.innerHTML = `
                <div class="history-source">${item.starred ? '★ ' : ''}${escapeHtml(item.source.substring(0, 120))}${item.source.length > 120 ? '…' : ''}</div>
                <div class="history-target">${escapeHtml(item.target.substring(0, 120))}${item.target.length > 120 ? '…' : ''}</div>
                <div class="history-meta">
                    <span class="history-langs">${escapeHtml(sName)} → ${escapeHtml(tName)}</span>
                    <span class="history-time">${timeStr}</span>
                </div>
                <button class="history-delete" data-id="${item.id}">×</button>
            `;
            div.addEventListener('click', (e) => {
                if (e.target.closest('.history-delete')) return;
                this.els['text-source'].value = item.source;
                this.els['text-target'].value = item.target;
                this.els['text-target'].dataset.lastPair = '';
                this.currentSource = item.sLang; 
                this.currentTarget = item.tLang;
                this.renderLangCard('source'); 
                this.renderLangCard('target');
                this.updateCharCount(); 
                this.closeModal('history-modal');
            });
            div.querySelector('.history-delete')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.history.remove(item.id);
                this.renderHistory(this.els['history-search']?.value || '');
            });
            list.appendChild(div);
        });
    }

    speakText(text, voiceLang) {
        if (!text || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = voiceLang;
        utter.rate = this.currentVoiceSpeed;
        window.speechSynthesis.speak(utter);
    }

    createRecognizer(lang, onResult) {
        if (!this.SpeechRecognitionImpl) return null;
        const rec = new this.SpeechRecognitionImpl();
        rec.lang = lang; 
        rec.continuous = this.liveModeActive; 
        rec.interimResults = true; 
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) { 
                if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '; 
            }
            if (final) onResult(final.trim(), true);
        };
        rec.onerror = (err) => {
            if (err.error === 'no-speech') return;
            this.stopListening();
        };
        rec.onend = () => { 
            if (this.liveModeActive && this.isListening) { 
                setTimeout(() => { 
                    try { rec.start(); } catch(e){} 
                }, 400); 
            } else { 
                this.stopListening(); 
            } 
        };
        return rec;
    }

    startListening(which) {
        if (!this.SpeechRecognitionImpl) {
            showToast('Bu tarayıcı sesle yazmayı desteklemiyor. Chrome/Android deneyin.', 'error', 3600);
            return;
        }
        if (this.isListening) {
            if (this.listeningWhich === which) return this.stopListening();
            this.stopListening();
        }
        const langInfo = which === 'source' 
            ? LANG_DATA[this.currentSource === 'auto' ? 'tr-TR' : this.currentSource] 
            : LANG_DATA[this.currentTarget];
        this.recognizer = this.createRecognizer(langInfo.voice, (text) => {
            const el = document.getElementById(which === 'source' ? 'text-source' : 'text-target');
            if (!el) return;
            el.value += (el.value ? ' ' : '') + text;
            if (which === 'source') { 
                this.updateCharCount(); 
                this.scheduleTranslation(); 
            } else { 
                el.dataset.lastPair = ''; 
                this.performReverseTranslation(); 
            }
        });
        if (this.recognizer) {
            try {
                this.recognizer.start();
                this.isListening = true; 
                this.listeningWhich = which;
                const btnEl = document.getElementById(`btn-${which}`);
                btnEl?.classList.add('listening');
                this.els['live-indicator']?.classList.remove('hidden');
                this.visualizer.start(btnEl);
            } catch (err) { 
                this.stopListening(); 
            }
        }
    }

    stopListening() {
        if (this.recognizer) try { this.recognizer.stop(); } catch(e){}
        if (this.listeningWhich) document.getElementById(`btn-${this.listeningWhich}`)?.classList.remove('listening');
        this.isListening = false; 
        this.listeningWhich = null;
        this.els['live-indicator']?.classList.add('hidden');
        this.visualizer.stop();
    }

    bindEvents() {
        this.els['text-source']?.addEventListener('input', () => { 
            this.updateCharCount(); 
            this.scheduleTranslation(); 
        });
        this.els['text-source']?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(this.debounceTimer);
                this.performTranslation(true);
            }
        });

        this.els['badge-source']?.addEventListener('click', () => this.openLangPicker('source'));
        this.els['badge-target']?.addEventListener('click', () => this.openLangPicker('target'));

        document.querySelector('.btn-settings')?.addEventListener('click', () => this.openFullSettings());
        this.els['settings-done']?.addEventListener('click', () => {
            this.closeModal('settings-modal');
            const langGroup = document.querySelector('.lang-group');
            const langSearchRow = document.querySelector('.lang-search-row');
            if (langGroup) langGroup.style.display = '';
            if (langSearchRow) langSearchRow.style.display = '';
        });

        document.querySelector('.swap-btn')?.addEventListener('click', () => this.swapLanguages());

        document.querySelector('.btn-clear')?.addEventListener('click', () => {
            this.els['text-source'].value = ''; 
            this.els['text-target'].value = '';
            this.els['text-target'].dataset.lastPair = ''; 
            this.hideAlternatives();
            this.hideTranslationBadge();
            this.updateCharCount(); 
            this.engine.clear();
        });

        document.querySelector('.btn-speak-source')?.addEventListener('click', () => {
            const info = LANG_DATA[this.currentSource === 'auto' ? 'tr-TR' : this.currentSource];
            this.speakText(this.els['text-source']?.value, info.voice);
        });
        document.querySelector('.btn-speak-target')?.addEventListener('click', () => {
            this.speakText(this.els['text-target']?.value, LANG_DATA[this.currentTarget].voice);
        });

        document.getElementById('btn-source')?.addEventListener('click', () => this.startListening('source'));
        document.getElementById('btn-target')?.addEventListener('click', () => this.startListening('target'));

        // Live Toggle
        this.els['live-toggle']?.addEventListener('click', (e) => {
            if (this.longPressFired) { 
                this.longPressFired = false; 
                return; 
            }
            this.liveModeActive = !this.liveModeActive;
            this.els['live-dot']?.classList.toggle('active', this.liveModeActive);
            this.els['live-track']?.classList.toggle('active', this.liveModeActive);
            if (!this.liveModeActive && this.isListening) this.stopListening();
            showToast(this.liveModeActive ? 'Canlı mod açık' : 'Canlı mod kapalı');
        });

        // Interpreter mode (long press)
        let livePressTimer = null;
        this.longPressFired = false;
        const triggerInterpreterToggle = () => {
            this.longPressFired = true;
            this.interpreterMode = !this.interpreterMode;
            this.els['interpreter-badge']?.classList.toggle('hidden', !this.interpreterMode);
            showToast(this.interpreterMode ? 'Tercüman modu aktif: çeviri otomatik seslendirilecek' : 'Tercüman modu kapalı');
        };
        
        const startLongPress = (e) => {
            if (e.type === 'touchstart') this.longPressFired = false;
            livePressTimer = setTimeout(triggerInterpreterToggle, 800);
        };
        const cancelLongPress = () => {
            if (livePressTimer) {
                clearTimeout(livePressTimer);
                livePressTimer = null;
            }
        };
        
        this.els['live-toggle']?.addEventListener('mousedown', startLongPress);
        this.els['live-toggle']?.addEventListener('mouseup', cancelLongPress);
        this.els['live-toggle']?.addEventListener('mouseleave', cancelLongPress);
        this.els['live-toggle']?.addEventListener('touchstart', startLongPress, { passive: true });
        this.els['live-toggle']?.addEventListener('touchend', cancelLongPress);
        this.els['live-toggle']?.addEventListener('touchcancel', cancelLongPress);

        // Copy
        document.querySelector('.btn-copy')?.addEventListener('click', () => {
            const text = this.els['text-target']?.value;
            if (!text) return;
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => showToast('Kopyalandı!', 'success'));
            } else {
                this.els['text-target'].select(); 
                document.execCommand('copy'); 
                showToast('Kopyalandı!', 'success');
            }
        });

        // Share
        document.querySelector('.btn-share')?.addEventListener('click', () => {
            const text = this.els['text-target']?.value;
            if (text && navigator.share) navigator.share({ text }).catch(() => {});
        });

        // Star / Favorite
        this.els['btn-star']?.addEventListener('click', () => {
            const src = this.els['text-source']?.value; 
            const tgt = this.els['text-target']?.value;
            if (!src || !tgt) return;
            this.history.star(src, tgt, this.currentSource, this.currentTarget);
            this.els['btn-star'].classList.add('active');
            showToast('Favorilere eklendi', 'success');
            setTimeout(() => this.els['btn-star'].classList.remove('active'), 1500);
        });

        // Camera
        this.els['btn-camera-header']?.addEventListener('click', () => this.openCamera());
        document.querySelector('.btn-camera-card')?.addEventListener('click', () => this.openCamera());
        this.els['camera-done']?.addEventListener('click', () => this.closeCamera());
        this.els['btn-capture']?.addEventListener('click', () => this.ocr.captureAndRecognize());

        // Camera continuous toggle
        this.els['camera-continuous-toggle']?.addEventListener('click', () => {
            const track = this.els['camera-toggle-track'];
            const isActive = track.classList.toggle('active');
            if (isActive) { 
                this.ocr.startContinuous(); 
                showToast('Sürekli tarama açık', 'info'); 
            } else { 
                this.ocr.stopContinuous(); 
                this.hideCameraCaption();
                showToast('Sürekli tarama kapalı', 'info'); 
            }
        });

        // History
        this.els['btn-history-header']?.addEventListener('click', () => {
            if (this.els['history-search']) this.els['history-search'].value = '';
            this.renderHistory();
            this.openModal('history-modal');
        });
        this.els['history-done']?.addEventListener('click', () => this.closeModal('history-modal'));
        this.els['btn-clear-history']?.addEventListener('click', () => {
            if (confirm('Tüm geçmiş silinsin mi?')) { 
                this.history.clear(); 
                this.renderHistory(); 
                showToast('Geçmiş temizlendi', 'success'); 
            }
        });

        // Settings speed
        document.querySelectorAll('.speed-opt').forEach(btn => {
            if (parseFloat(btn.dataset.speed) === this.currentVoiceSpeed) btn.classList.add('active');
            btn.addEventListener('click', (e) => {
                const speed = parseFloat(e.currentTarget.dataset.speed);
                this.currentVoiceSpeed = speed; 
                localStorage.setItem('aether_speed', speed);
                document.querySelectorAll('.speed-opt').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                showToast(`Okuma hızı: ${speed}x`);
            });
        });

        // Font slider
        this.els['font-slider']?.addEventListener('input', (e) => {
            const size = parseInt(e.target.value);
            this.applyFontSize(size);
        });
        if (this.els['font-slider']) this.els['font-slider'].value = this.currentFontSize;

        // Search
        this.els['lang-search']?.addEventListener('input', (e) => this.renderLangList(e.target.value));
        this.els['history-search']?.addEventListener('input', (e) => this.renderHistory(e.target.value));
        this.els['btn-history-favorites-filter']?.addEventListener('click', () => {
            this.historyFavoritesOnly = !this.historyFavoritesOnly;
            this.els['btn-history-favorites-filter'].classList.toggle('active', this.historyFavoritesOnly);
            this.renderHistory(this.els['history-search']?.value || '');
        });

        // Theme toggle
        this.els['btn-theme-toggle']?.addEventListener('click', () => this.toggleTheme());

        // Backdrops
        document.querySelectorAll('.modal-backdrop').forEach(el => {
            el.addEventListener('click', () => {
                const modal = el.closest('.modal');
                if (modal) {
                    if (modal.id === 'camera-modal') this.closeCamera();
                    else this.closeModal(modal.id);
                }
            });
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { 
                this.closeModal('settings-modal'); 
                this.closeModal('history-modal'); 
                this.closeCamera(); 
            }
        });
    }

    setupPWA() {
        let deferredPrompt = null;
        const banner = this.els['pwa-install-banner'];
        const installBtn = this.els['btn-install-pwa'];
        const dismissBtn = this.els['btn-dismiss-pwa'];

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault(); 
            deferredPrompt = e; 
            banner?.classList.remove('hidden');
        });

        installBtn?.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') banner?.classList.add('hidden');
            deferredPrompt = null;
        });
        dismissBtn?.addEventListener('click', () => banner?.classList.add('hidden'));
    }

    initParticles() {
        const canvas = document.getElementById('particle-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let w, h, particles = [];
        const resize = () => { 
            w = canvas.width = window.innerWidth; 
            h = canvas.height = window.innerHeight; 
        };
        resize(); 
        window.addEventListener('resize', resize);
        const palette = ['--accent', '--accent-2', '--accent-3'];
        for (let i = 0; i < 40; i++) particles.push({ 
            x: Math.random()*w, 
            y: Math.random()*h, 
            vx: (Math.random()-0.5)*0.3, 
            vy: (Math.random()-0.5)*0.3, 
            r: Math.random()*2+1,
            colorVar: palette[i % palette.length]
        });
        const draw = () => {
            ctx.clearRect(0,0,w,h);
            const style = getComputedStyle(document.documentElement);
            const colors = { '--accent': style.getPropertyValue('--accent').trim(), '--accent-2': style.getPropertyValue('--accent-2').trim(), '--accent-3': style.getPropertyValue('--accent-3').trim() };
            particles.forEach(p => { 
                p.x+=p.vx; 
                p.y+=p.vy; 
                if(p.x<0)p.x=w; 
                if(p.x>w)p.x=0; 
                if(p.y<0)p.y=h; 
                if(p.y>h)p.y=0; 
                ctx.globalAlpha=0.28;
                ctx.fillStyle = colors[p.colorVar];
                ctx.beginPath(); 
                ctx.arc(p.x,p.y,p.r,0,Math.PI*2); 
                ctx.fill(); 
            });
            requestAnimationFrame(draw);
        };
        draw();
    }
}

// ==================== AĞ DURUMU & GLOBAL HATA ====================
window.addEventListener('error', (e) => console.error('Aether hata:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Aether promise hatası:', e.reason));

// ==================== BOOT ====================
const appInstance = new App();
window.appInstance = appInstance;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => appInstance.init());
else appInstance.init();

window.addEventListener('beforeunload', () => {
    appInstance.ocr?.terminateWorker();
});
// ==========================================
// FLOW IMAGE AUTOMATION - CRIADORES DARK
// Versão 4.1 - Drag & Drop + API Rename (Flow Voz)
// + ADD-ONS: Resume, Numeração Fiel e Upscale
// + FIX: Seletores atualizados para nova interface Flow (Mai/2026)
// ==========================================
//
// ARQUITETURA:
//   - Três modos: Livre, Referências, Cenas
//   - Rename e Favoritar via API (não simula cliques)
//   - Atribuição manual via Drag & Drop após geração
//   - Labels visuais nos tiles com X para remover
//   - Referências usam sufixo " _" para identificação
//   - Vozes adicionadas usando a tag <voz: Nome>
//
(function() {
    'use strict';

    if (window.FlowAutomationInitialized) {
        console.warn('[Flow] Já está rodando!');
        return;
    }
    window.FlowAutomationInitialized = true;

    // ============================================================
    // TOKEN INTERCEPTION (captura Bearer token automaticamente)
    // ============================================================
    const _origFetch = window.fetch;
    let _authToken = null;

    window.fetch = async function(...args) {
        const [, config] = args;
        try {
            const headers = config?.headers || {};
            const auth = headers instanceof Headers
                ? headers.get('authorization')
                : headers['authorization'] || headers['Authorization'];
            if (auth && auth.startsWith('Bearer ')) _authToken = auth;
        } catch(_) {}
        return _origFetch.apply(this, args);
    };

    const _origXhrOpen = XMLHttpRequest.prototype.open;
    const _origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function(...args) {
        this._url = args[1];
        return _origXhrOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) _authToken = value;
        return _origXhrSetHeader.apply(this, arguments);
    };

    // ============================================================
    // DEBUG + CONFIG
    // ============================================================
    const DEBUG = true;
    const log = {
        info:    (m,...a) => DEBUG && console.log(`%c[Flow] ℹ️ ${m}`,  'color:#7b1fa2;font-weight:bold;',...a),
        success: (m,...a) => DEBUG && console.log(`%c[Flow] ✅ ${m}`,  'color:#4caf50;font-weight:bold;',...a),
        warn:    (m,...a) => DEBUG && console.warn(`%c[Flow] ⚠️ ${m}`, 'color:#ff9800;font-weight:bold;',...a),
        error:   (m,...a) => DEBUG && console.error(`%c[Flow] ❌ ${m}`,'color:#f44336;font-weight:bold;',...a),
    };

    const CONFIG = {
        DELAY_SHORT:            [200, 400],
        DELAY_MEDIUM:           [400, 650],
        DELAY_LONG:            [800, 1200],
        DELAY_BETWEEN_SUBMITS: [2000, 3000],
        DELAY_BETWEEN_BATCHES: [1500, 2500],
        GENERATION_TIMEOUT:  180000,
        TILE_CHECK_INTERVAL:   2000,
        STABILIZE_TIME:        5000,
        MAX_RETRIES:              3,
        API_BASE: 'https://aisandbox-pa.googleapis.com/v1/flowWorkflows',
        REF_SUFFIX: ' _',
        VERSION: '4.3 (Flow Voz + Velocidade + Enum Bloco)',
        SPEED_PROFILES: {
            slow:   { label: '🐢 Lento',  multiplier: 1.5 },
            normal: { label: '🔄 Normal', multiplier: 1.0 },
            fast:   { label: '⚡ Rápido', multiplier: 0.7 },
        },
    };

    // ============================================================
    // PARSERS
    // ============================================================
function triggerTrustedClick(el) {
    if (!el) return false;

    const reactKey = Object.keys(el).find(k =>
        k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers')
    );

    const onClick = reactKey && el[reactKey] && el[reactKey].onClick;

    if (typeof onClick === 'function') {
        try {
            onClick({
                isTrusted: true,
                preventDefault() {},
                stopPropagation() {},
                stopImmediatePropagation() {},
                type: 'click',
                target: el,
                currentTarget: el,
                bubbles: true,
                cancelable: true,
                defaultPrevented: false,
                eventPhase: 2,
                detail: 1,
                button: 0,
                buttons: 0,
                nativeEvent: {
                    isTrusted: true,
                    type: 'click'
                },
            });
            return true;
        } catch (err) {
            console.warn('[Flow] triggerTrustedClick falhou, usando .click():', err);
        }
    }

    el.click();
    return false;
}
    function parsePrompt(prompt) {
        const segs = [];
        const re = /(\[([^\]]+)\]|<voz:\s*([^>]+)>)/gi;
        let last = 0, m;
        while ((m = re.exec(prompt)) !== null) {
            if (m.index > last) segs.push({ type:'text', content: prompt.slice(last, m.index) });
            if (m[2]) {
                 segs.push({ type:'ref', name: m[2].trim() });
            } else if (m[3]) {
                 segs.push({ type:'voice', name: m[3].trim() });
            }
            last = m.index + m[0].length;
        }
        if (last < prompt.length) segs.push({ type:'text', content: prompt.slice(last) });
        return segs;
    }

    function extractReferences(prompts) {
        const s = new Set();
        for (const p of prompts) {
            const t = typeof p === 'string' ? p : p.text;
            (t.match(/\[([^\]]+)\]/g) || []).forEach(m => s.add(m.slice(1,-1).trim()));
        }
        return [...s];
    }

    function extractVoices(prompts) {
        const s = new Set();
        for (const p of prompts) {
            const t = typeof p === 'string' ? p : p.text;
             (t.match(/<voz:\s*([^>]+)>/gi) || []).forEach(m => s.add(m.replace(/<voz:\s*/i, '').replace(/>/, '').trim()));
        }
        return [...s];
    }

    function parsePromptsText(text, startFrom = 1) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const result = [];
        let nextNum = startFrom;
        for (const line of lines) {
            const tag = line.match(/^\{(?:prompt|cena)\s*([\d.]+)\}\s*/i);
            if (tag) {
                const n = parseFloat(tag[1]);
                const rest = line.slice(tag[0].length).trim();
                if (rest) { result.push({ text: rest, promptNum: n }); nextNum = Math.floor(n) + 1; }
                else { nextNum = n; }
            } else {
                result.push({ text: line, promptNum: nextNum++ });
            }
        }
        return result;
    }

    /** Extrai nomes de referência da primeira linha: [Maria][José][Praia] */
    function parseReferenceHeader(text) {
        const lines = text.split('\n');
        const firstLine = lines[0].trim();
        const refs = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(firstLine)) !== null) refs.push(m[1].trim());
        // Primeira linha é SOMENTE referências?
        const stripped = firstLine.replace(/\[([^\]]+)\]/g, '').trim();
        if (refs.length > 0 && stripped === '') {
            let startIdx = 1;
            while (startIdx < lines.length && lines[startIdx].trim() === '') startIdx++;
            return { refs, remaining: lines.slice(startIdx).join('\n') };
        }
        return { refs: [], remaining: text };
    }

    // ============================================================
    // CSS
    // ============================================================
    const css = `
:root{--cd-primary:#10b981;--cd-primary-dark:#059669;--cd-primary-light:#34d399;--cd-bg:#fff;--cd-bg-secondary:#f8fafc;--cd-bg-card:#fff;--cd-border:#e2e8f0;--cd-border-light:#f1f5f9;--cd-text:#1e293b;--cd-text-muted:#64748b;--cd-text-light:#94a3b8;--cd-shadow:0 10px 40px -10px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.05);--cd-shadow-glow:0 0 20px rgba(16,185,129,.3);--cd-radius:16px;--cd-radius-sm:12px;--cd-radius-xs:8px;}
#flow-sidebar{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:10000;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));border-radius:9999px;padding:16px 12px;cursor:pointer;box-shadow:var(--cd-shadow-glow),var(--cd-shadow);transition:all .2s;font-family:'Inter','Segoe UI',system-ui,sans-serif;border:none;writing-mode:vertical-rl;text-orientation:mixed;}
#flow-sidebar:hover{transform:translateY(-50%) scale(1.05);}
#flow-sidebar .icon{color:#fff;font-size:14px;font-weight:600;letter-spacing:.5px;}
#flow-panel{position:fixed;top:12px;right:12px;bottom:12px;width:420px;z-index:10001;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:var(--cd-shadow);border:1px solid var(--cd-border);display:flex;flex-direction:column;font-family:'Inter','Segoe UI',system-ui,sans-serif;transform:translateX(110%);transition:transform .3s cubic-bezier(.4,0,.2,1);overflow:hidden;}
#flow-panel.active{transform:translateX(0);}
.flow-header{padding:16px 20px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.flow-header-left{display:flex;align-items:center;gap:12px;}
.flow-logo{width:36px;height:36px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.15);}
.flow-logo svg{width:21px;height:21px;}
.flow-header-title{font-size:15px;font-weight:700;color:var(--cd-text);margin:0;line-height:1.3;}
.flow-header-subtitle{font-size:12px;font-weight:500;color:var(--cd-text-muted);margin:0;line-height:1.3;}
.flow-close-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--cd-border);background:var(--cd-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;padding:0;}
.flow-close-btn:hover{background:#fee2e2;border-color:#fca5a5;}
.flow-close-btn svg{width:16px;height:16px;color:var(--cd-text-muted);}
.flow-tabs{display:flex;border-bottom:1px solid var(--cd-border-light);flex-shrink:0;}
.flow-tab{flex:1;padding:12px 16px;font-size:13px;font-weight:600;color:var(--cd-text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;}
.flow-tab:hover{color:var(--cd-text);background:var(--cd-bg-secondary);}
.flow-tab.active{color:var(--cd-primary);border-bottom-color:var(--cd-primary);}
.flow-tab-content{display:none;}
.flow-tab-content.active{display:block;}
.flow-scroll{flex:1;overflow-y:auto;}
.flow-scroll::-webkit-scrollbar{width:4px;}
.flow-scroll::-webkit-scrollbar-thumb{background:var(--cd-border);border-radius:4px;}
.flow-tab-body{padding:16px 20px;}
.flow-card{background:var(--cd-bg-card);border:1px solid var(--cd-border);border-radius:var(--cd-radius-sm);margin-bottom:12px;overflow:hidden;}
.flow-card-header{padding:14px 16px 8px;}
.flow-card-title{font-size:14px;font-weight:600;color:var(--cd-text);margin:0;}
.flow-card-description{font-size:12px;color:var(--cd-text-muted);margin:4px 0 0;line-height:1.4;}
.flow-card-content{padding:8px 16px 16px;}
.flow-textarea{width:100%;min-height:300px;border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:12px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;outline:none;transition:border .2s;line-height:1.5;}
.flow-textarea:focus{border-color:var(--cd-primary);box-shadow:0 0 0 3px rgba(16,185,129,.1);}
.flow-textarea::placeholder{color:var(--cd-text-light);}
.flow-ref-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.flow-ref-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid;}
.flow-voice-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid #c7d2fe; background:#eff6ff; color:#1e40af;}
.flow-ref-tag.found{background:#ecfdf5;color:#065f46;border-color:#a7f3d0;}
.flow-ref-tag.missing{background:#fef2f2;color:#991b1b;border-color:#fecaca;}
.flow-ref-tag.pending{background:#f8fafc;color:#64748b;border-color:#e2e8f0;}
.flow-validate-btn{background:var(--cd-bg-secondary);color:var(--cd-text);border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;margin-top:10px;width:100%;}
.flow-validate-btn:hover{background:var(--cd-primary);color:#fff;border-color:var(--cd-primary);}
.flow-validate-btn:disabled{opacity:.5;cursor:not-allowed;}
.flow-option{display:flex;align-items:flex-start;gap:10px;padding:8px 0;}
.flow-option input[type="checkbox"]{margin-top:2px;accent-color:var(--cd-primary);width:16px;height:16px;cursor:pointer;}
.flow-option-text{flex:1;}
.flow-option-title{font-size:13px;font-weight:500;color:var(--cd-text);}
.flow-option-desc{font-size:11px;color:var(--cd-text-muted);margin-top:2px;}
.flow-mode-btns{display:flex;gap:6px;margin-top:6px;}
.flow-mode-btn{flex:1;padding:9px 8px;border-radius:var(--cd-radius-xs);border:1.5px solid var(--cd-border);background:var(--cd-bg);font-size:12px;font-weight:600;color:var(--cd-text-muted);cursor:pointer;transition:all .2s;text-align:center;line-height:1.3;}
.flow-mode-btn:hover{border-color:var(--cd-primary);color:var(--cd-primary);background:rgba(16,185,129,.04);}
.flow-mode-btn.active{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border-color:var(--cd-primary);box-shadow:0 2px 10px rgba(16,185,129,.3);}
.flow-batch-btns{display:flex;gap:6px;}
.flow-batch-btn{width:36px;height:36px;border-radius:var(--cd-radius-xs);border:1px solid var(--cd-border);background:var(--cd-bg-secondary);font-size:14px;font-weight:700;color:var(--cd-text-muted);cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
.flow-batch-btn:hover{border-color:var(--cd-primary);color:var(--cd-primary);}
.flow-batch-btn.active{background:var(--cd-primary);color:#fff;border-color:var(--cd-primary);box-shadow:0 2px 8px rgba(16,185,129,.3);}
.flow-select-imgs{border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:6px 10px;font-size:13px;font-family:inherit;background:var(--cd-bg);color:var(--cd-text);cursor:pointer;}
.flow-actions{display:flex;gap:10px;margin:16px 0 12px;}
.flow-btn{flex:1;padding:10px 16px;border-radius:var(--cd-radius-xs);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;transition:all .2s;}
.flow-btn svg{width:16px;height:16px;}
.flow-btn-primary{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;box-shadow:0 2px 8px rgba(16,185,129,.3);}
.flow-btn-primary:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.4);transform:translateY(-1px);}
.flow-btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.flow-btn-secondary{background:var(--cd-bg);color:var(--cd-text);border-color:var(--cd-border);}
.flow-btn-secondary:hover:not(:disabled){background:var(--cd-bg-secondary);}
.flow-btn-secondary:disabled{opacity:.5;cursor:not-allowed;}
.flow-status{padding:10px 14px;border-radius:var(--cd-radius-xs);font-size:12px;margin-bottom:10px;display:none;line-height:1.4;}
.flow-status.info{display:block;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;}
.flow-status.success{display:block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;}
.flow-status.error{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;}
.flow-status.warning{display:block;background:#fffbeb;color:#92400e;border:1px solid #fde68a;}
.flow-progress{height:4px;background:var(--cd-border-light);border-radius:4px;overflow:hidden;margin-bottom:10px;}
.flow-progress-bar{height:100%;background:linear-gradient(90deg,var(--cd-primary),var(--cd-primary-light));border-radius:4px;transition:width .4s;width:0%;}
.flow-logs-container{display:none;}
.flow-logs-container.visible{display:block;}
.flow-debug-panel{max-height:180px;overflow-y:auto;font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;border-radius:var(--cd-radius-xs);padding:12px;line-height:1.5;}
.flow-debug-panel::-webkit-scrollbar{width:4px;}
.flow-debug-panel::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}
.flow-debug-line{padding:1px 0;}
.flow-debug-line.error{color:#f87171;}
.flow-debug-line.success{color:#4ade80;}
.flow-debug-line.info{color:#60a5fa;}
.flow-prompt-list{margin-top:8px;}
.flow-prompt-item{display:grid;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;gap:4px 8px;padding:10px 12px;border:1px solid var(--cd-border-light);border-radius:var(--cd-radius-xs);margin-bottom:6px;font-size:12px;transition:all .2s;align-items:start;}
.flow-prompt-item .num{grid-row:1;grid-column:1;font-weight:700;color:var(--cd-primary);min-width:20px;padding-top:1px;}
.flow-prompt-item .text{grid-row:1;grid-column:2;color:var(--cd-text);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;}
.flow-prompt-item .refs{grid-row:2;grid-column:2;display:flex;gap:4px;flex-wrap:wrap;}
.flow-prompt-item .ref-badge{background:var(--cd-primary);color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;}
.flow-prompt-item .voice-badge{background:#3b82f6;color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;}
.flow-prompt-item .status-badge{grid-row:1;grid-column:3;font-size:10px;font-weight:600;padding:2px 6px;border-radius:9999px;white-space:nowrap;}
.flow-prompt-item.active{border-color:var(--cd-primary);background:#ecfdf5;}
.flow-prompt-item.done{border-color:#a7f3d0;background:#f0fdf4;opacity:.7;}
.flow-prompt-item.error{border-color:#fecaca;background:#fef2f2;}
.flow-prompt-item.retrying{border-color:#fde68a;background:#fffbeb;}
.flow-video-placeholder{text-align:center;padding:40px 20px;}
.flow-video-placeholder .icon{font-size:48px;margin-bottom:12px;}
.flow-video-placeholder h3{font-size:16px;font-weight:600;color:var(--cd-text);margin:0 0 8px;}
.flow-video-placeholder p{font-size:13px;color:var(--cd-text-muted);margin:0;line-height:1.5;}
.flow-footer{padding:12px 20px;border-top:1px solid var(--cd-border-light);text-align:center;font-size:11px;color:var(--cd-text-light);flex-shrink:0;}
.flow-footer a{color:var(--cd-primary);text-decoration:none;font-weight:600;}
.flow-logout-link{display:block;text-align:center;font-size:11px;color:var(--cd-text-light);margin-top:16px;cursor:pointer;text-decoration:underline;padding:4px;}
#flow-mini{position:fixed;bottom:16px;right:16px;z-index:10002;background:var(--cd-bg);border:1px solid var(--cd-border);border-radius:var(--cd-radius-sm);padding:14px 18px;display:none;flex-direction:column;gap:8px;cursor:pointer;box-shadow:var(--cd-shadow);min-width:280px;font-family:'Inter','Segoe UI',system-ui,sans-serif;}
.flow-mini-header{display:flex;align-items:center;gap:10px;}
.flow-mini-icon{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.flow-mini-icon svg{width:16px;height:16px;}
.flow-mini-title{font-size:13px;font-weight:700;color:var(--cd-text);flex:1;}
.flow-mini-close{background:none;border:none;cursor:pointer;padding:4px;color:var(--cd-text-muted);transition:color .2s;flex-shrink:0;}
.flow-mini-close:hover{color:#ef4444;}
.flow-mini-close svg{width:14px;height:14px;}
.flow-mini-status{font-size:12px;font-weight:600;color:var(--cd-primary);}
.flow-mini-sub{font-size:11px;color:var(--cd-text-muted);}
.flow-mini-details{font-size:11px;color:var(--cd-text-muted);display:flex;gap:12px;}
.flow-mini-progress{height:4px;background:var(--cd-border-light);border-radius:4px;}
.flow-mini-progress-bar{height:100%;background:linear-gradient(90deg,var(--cd-primary),var(--cd-primary-light));border-radius:4px;transition:width .4s;width:0%;}
#flow-popup-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);z-index:10003;}
#flow-popup{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10004;background:var(--cd-bg);border-radius:var(--cd-radius);padding:32px;box-shadow:var(--cd-shadow);text-align:center;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;}
#flow-popup h3{font-size:20px;margin:0 0 8px;color:var(--cd-text);}
#flow-popup p{font-size:14px;color:var(--cd-text-muted);margin:0 0 20px;}
#flow-popup .failed-list{text-align:left;background:var(--cd-bg-secondary);border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:12px;margin:0 0 16px;font-size:12px;max-height:150px;overflow-y:auto;}
#flow-popup .failed-list div{padding:4px 0;color:var(--cd-text);border-bottom:1px solid var(--cd-border-light);}
#flow-popup .failed-list div:last-child{border:none;}
.flow-promo{display:block;margin-top:16px;padding:14px;background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #a7f3d0;border-radius:var(--cd-radius-xs);text-decoration:none;transition:transform .2s;}
.flow-promo:hover{transform:scale(1.02);box-shadow:0 4px 12px rgba(16,185,129,.15);}
.flow-promo p{color:var(--cd-text);font-size:12px;margin:0;line-height:1.5;}
.flow-promo strong{color:var(--cd-primary-dark);}
/* ========== ASSIGNMENT PANEL (horizontal top bar) ========== */
#flow-assign-panel{display:none;position:fixed;top:12px;left:84px;right:456px;z-index:10005;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:0 10px 40px -10px rgba(0,0,0,.2);border:1px solid var(--cd-border);font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;flex-direction:column;transition:all .3s;}
#flow-assign-panel.active{display:flex;}
#flow-assign-panel.panel-closed{right:12px;}
#flow-assign-panel.minimized .flow-assign-items,#flow-assign-panel.minimized .flow-assign-reload-bar,#flow-assign-panel.minimized .flow-assign-prompt-preview{display:none;}
.flow-assign-dl-btn{display:none;padding:5px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:6px;cursor:pointer;transition:all .2s;white-space:nowrap;}
.flow-assign-dl-btn:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.35);transform:translateY(-1px);}
.flow-assign-dl-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.flow-assign-reload-bar{display:none;}
.flow-assign-header{padding:10px 16px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;gap:12px;flex-shrink:0;}
.flow-assign-header h3{font-size:13px;font-weight:700;color:var(--cd-text);margin:0;white-space:nowrap;}
.flow-assign-count{font-size:11px;color:var(--cd-text-muted);font-weight:500;white-space:nowrap;}
.flow-assign-items{padding:8px 12px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;max-height:130px;}
.flow-assign-items::-webkit-scrollbar{width:4px;}
.flow-assign-items::-webkit-scrollbar-thumb{background:var(--cd-border);border-radius:4px;}
.flow-assign-item{display:flex;align-items:center;gap:6px;padding:6px 12px;border:2px solid var(--cd-border);border-radius:9999px;cursor:grab;font-size:12px;font-weight:500;color:var(--cd-text);transition:border-color .15s,background .15s;background:var(--cd-bg);white-space:nowrap;flex-shrink:0;position:relative;box-sizing:border-box;}
.flow-assign-item:hover{border-color:var(--cd-primary);background:rgba(16,185,129,.04);}
.flow-assign-item:active{cursor:grabbing;}
.flow-assign-item .drag-icon{color:var(--cd-text-light);font-size:14px;flex-shrink:0;}
.flow-assign-item .assign-name{white-space:nowrap;}
.flow-assign-item .assign-status{font-size:12px;flex-shrink:0;}
.flow-assign-item.assigned{background:#ecfdf5;border-color:#a7f3d0;opacity:.65;}
.flow-assign-item.assigned .assign-name{text-decoration:line-through;color:var(--cd-text-muted);}
/* ADD-ON Auto-Enumerador: conclusão (verde) e faltante (apagado) */
.flow-assign-item.complete{background:#dcfce7;border-color:#4ade80;opacity:1;}
.flow-assign-item.complete .assign-name{color:#166534;font-weight:600;text-decoration:none;}
.flow-assign-item.missing{opacity:.5;border-style:dashed;}
#flow-assign-auto{font-weight:700;color:var(--cd-primary);}
#flow-assign-auto:hover{color:var(--cd-primary-dark);background:var(--cd-bg-secondary);}
.flow-assign-prompt-preview{padding:0 16px 10px;font-size:11px;color:var(--cd-text-muted);line-height:1.5;min-height:20px;border-top:1px solid var(--cd-border-light);margin-top:4px;flex-shrink:0;overflow:hidden;}
.flow-assign-prompt-preview .preview-label{font-weight:600;color:var(--cd-primary);margin-right:4px;}
.flow-assign-prompt-preview .preview-text{color:var(--cd-text-muted);}
.flow-assign-header-btns{display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0;}
.flow-assign-hbtn{background:none;border:none;cursor:pointer;padding:3px;color:var(--cd-text-muted);font-size:14px;line-height:1;transition:all .2s;border-radius:4px;}
.flow-assign-hbtn:hover{color:var(--cd-text);background:var(--cd-bg-secondary);}
.flow-assign-hbtn.close-btn:hover{color:#ef4444;background:#fef2f2;}
.flow-assign-dl-btn{display:none;padding:5px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:6px;cursor:pointer;transition:all .2s;white-space:nowrap;}
.flow-assign-dl-btn:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.35);transform:translateY(-1px);}
.flow-assign-dl-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.flow-assign-reload-bar{display:none;padding:10px 16px;text-align:center;border-top:1px solid var(--cd-border-light);flex-shrink:0;}
.flow-assign-reload-bar.visible{display:block;}
.flow-assign-reload-bar button{padding:8px 24px;font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:var(--cd-radius-xs);cursor:pointer;animation:pulse-glow 1.5s ease-in-out infinite;transition:all .2s;}
.flow-assign-reload-bar button:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(16,185,129,.4);}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 4px rgba(16,185,129,.3);}50%{box-shadow:0 0 16px rgba(16,185,129,.6);}}
/* ========== ASSIGNMENT PANEL: VERTICAL MODE ========== */
#flow-assign-panel.vertical{top:12px;left:auto;right:12px;bottom:12px;width:220px;max-height:none;}
#flow-assign-panel.vertical .flow-assign-header{flex-wrap:wrap;gap:6px;padding:8px 10px;}
#flow-assign-panel.vertical .flow-assign-header h3{font-size:12px;}
#flow-assign-panel.vertical .flow-assign-items{flex-direction:column;flex-wrap:nowrap;max-height:none;flex:1;overflow-y:auto;padding:6px 8px;gap:4px;}
#flow-assign-panel.vertical .flow-assign-item{white-space:nowrap;font-size:11px;padding:5px 10px;}
#flow-assign-panel.vertical .flow-assign-header-btns{gap:2px;}
#flow-assign-panel.vertical .flow-assign-dl-btn{font-size:10px;padding:4px 8px;}
#flow-assign-panel.vertical .flow-assign-prompt-preview{font-size:10px;padding:0 8px 6px;}
#flow-assign-panel.vertical.panel-closed{right:12px;}
/* ========== TILE LABELS ========== */
.flow-tile-label{position:absolute;top:8px;left:8px;z-index:10;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.8);color:#fff;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;backdrop-filter:blur(4px);pointer-events:auto;max-width:calc(100% - 24px);}
.flow-tile-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.flow-tile-label .label-x{background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;transition:color .2s;flex-shrink:0;}
.flow-tile-label .label-x:hover{color:#f87171;}
/* ========== DROP FEEDBACK ========== */
[data-tile-id].drop-hover{outline:3px solid var(--cd-primary)!important;outline-offset:-3px;border-radius:8px;}
`;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ============================================================
    // HTML
    // ============================================================
    document.body.insertAdjacentHTML('beforeend', `
<button id="flow-sidebar"><span class="icon">Criadores Dark</span></button>
<div id="flow-panel">
  <div class="flow-header">
    <div class="flow-header-left">
      <div class="flow-logo">
        <svg viewBox="0 0 24 24">
          <defs><linearGradient id="flowPlayGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#10b981"/><stop offset="100%" style="stop-color:#059669"/></linearGradient></defs>
          <polygon points="8,6 20,12 8,18" fill="none" stroke="url(#flowPlayGrad)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <div class="flow-header-title">Criadores Dark - Vinícius Linhares</div>
        <div class="flow-header-subtitle">Flow Voz</div>
      </div>
    </div>
    <button class="flow-close-btn" id="flow-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div class="flow-tabs">
    <button class="flow-tab active" data-tab="images">🖼️ Imagens</button>
    <button class="flow-tab" data-tab="videos">🎬 Vídeos</button>
  </div>
  <div class="flow-scroll">
    <div class="flow-tab-content active" data-tab="images">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Prompts de imagem</h3>
            <p class="flow-card-description">Um prompt por linha. Use <strong>[nome]</strong> para referências do projeto.</p>
          </div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="flow-prompts-input" placeholder="Ex:&#10;Imagem de [Maria] sentada na [Sala]&#10;[João] caminhando no [Parque]"></textarea>
            <input type="number" id="flow-start-from" class="flow-select-imgs" style="margin-top:8px;width:100%;box-sizing:border-box;" placeholder="Retomar de (Cena X). Ex: 20 (Use 0 para pular)">
            <div id="flow-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Referências detectadas</h3>
            <p class="flow-card-description">Valide as referências [nome] antes de iniciar.</p>
          </div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="flow-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência detectada.</span></div>
<button class="flow-validate-btn" id="flow-validate-btn">🔍 Validar referências na galeria</button>
<button class="flow-validate-btn" id="flow-mark-refs-valid-btn" style="margin-top:6px;">✅ Referências já validadas</button>
<button class="flow-validate-btn" id="flow-clear-refs-btn" style="margin-top:6px;">🧽 Limpar referências validadas</button>
<button class="flow-validate-btn" id="flow-fix-upload-refs-btn" style="margin-top:6px;">🧹 Corrigir uploads para referências</button>
<button class="flow-validate-btn" id="flow-auto-enumerate-btn" style="margin-top:6px;font-weight:700;">⚡ Enumerar cenas automático (renomear "Cena N")</button>
<button class="flow-validate-btn" id="flow-assign-refs-btn" style="display:none;margin-top:6px;">📌 Atribuir referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-title">Modo de geração</div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-mode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-mode="refs">🖼️ Referências</button>
                <button class="flow-mode-btn" data-mode="scenes">🎬 Cenas</button>
              </div>
              <div id="flow-mode-desc" style="font-size:11px;color:var(--cd-text-light);line-height:1.4;min-height:16px;">Gera imagens sem atribuir nomes. Ideal para testes rápidos.</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Prompts simultâneos</div>
                <div class="flow-option-desc">Prompts enviados por lote. Flow gera todos em paralelo.</div>
              </div>
              <div class="flow-batch-btns">
                <button class="flow-batch-btn" data-batch="1">1</button>
                <button class="flow-batch-btn" data-batch="2">2</button>
                <button class="flow-batch-btn" data-batch="3">3</button>
                <button class="flow-batch-btn active" data-batch="4">4</button>
                <button class="flow-batch-btn" data-batch="5">5</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Imagens por prompt</div>
                <div class="flow-option-desc">Quantas imagens o Flow gera por envio.</div>
              </div>
              <select id="flow-imgs-per-prompt" class="flow-select-imgs">
                <option value="1">1 imagem</option>
                <option value="2">2 imagens</option>
                <option value="3" selected>3 imagens</option>
                <option value="4">4 imagens</option>
              </select>
              <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
  <div class="flow-option-text">
    <div class="flow-option-title">Tentativas ao falhar</div>
    <div class="flow-option-desc">Quantas vezes tentar novamente o prompt se a geração falhar. 0 desativa a regeração.</div>
  </div>
  <select id="flow-max-retries" class="flow-select-imgs">
    <option value="0" selected>0 tentativa</option>
    <option value="1">1 tentativa</option>
    <option value="2">2 tentativas</option>
    <option value="3">3 tentativas</option>
    <option value="4">4 tentativas</option>
    <option value="5">5 tentativas</option>
  </select>
</div>
            </div>
            <div id="flow-grid-info" style="font-size:11px;color:var(--cd-text-light);margin-top:4px;font-style:italic;"></div>
           <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
  <input type="checkbox" id="flow-auto-name-scenes">
  <div class="flow-option-text">
    <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Nomear imagens automaticamente</div>
    <div class="flow-option-desc">No modo Cenas, renomeia como Cena X - Imagem Y.</div>
  </div>
</label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Quando enumerar</div>
                <div class="flow-option-desc">Enumera ao final de tudo ou após cada bloco de prompts.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-enum="end">📋 No final</button>
                <button class="flow-mode-btn" data-enum="block">🏷️ Por bloco</button>
              </div>
            </div>
            <label class="flow-option" style="margin-top:4px;">
              <input type="checkbox" id="flow-approve-enum">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Aprovar antes de enumerar</div>
                <div class="flow-option-desc">Pausa após cada bloco e pede aprovação antes de nomear.</div>
              </div>
            </label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Velocidade</div>
                <div class="flow-option-desc">Ajusta o tempo entre ações. Rápido = menos espera.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn" data-speed="slow">🐢 Lento</button>
                <button class="flow-mode-btn active" data-speed="normal">🔄 Normal</button>
                <button class="flow-mode-btn" data-speed="fast">⚡ Rápido</button>
              </div>
              <div id="flow-speed-info" style="font-size:11px;color:var(--cd-text-light);">Velocidade: Normal (1.0×)</div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-defer-retry">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Retentar falhas no final</div>
                <div class="flow-option-desc">Em vez de parar para retentar, guarda os que falharam e retenta tudo no final.</div>
              </div>
            </label>

            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-use-backspace">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Modo alternativo (Backspace 3x)</div>
                <div class="flow-option-desc">Apaga a ref para evitar erros.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-show-logs">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div>
              </div>
            </label>
          </div>
        </div>
        <div class="flow-actions">
          <button id="flow-start-btn" class="flow-btn flow-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg> Iniciar</button>
          <button id="flow-stop-btn" class="flow-btn flow-btn-secondary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> Parar</button>
        </div>
        <div id="flow-status" class="flow-status"></div>
        <div class="flow-progress"><div id="flow-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="flow-prompts-preview-card" style="display:none;">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Fila de prompts</h3>
            <p class="flow-card-description" id="flow-queue-info"></p>
          </div>
          <div class="flow-card-content">
            <div class="flow-prompt-list" id="flow-prompt-list"></div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Analisar Projeto</h3>
            <p class="flow-card-description">Escaneia o projeto para mostrar labels em imagens já atribuídas.</p>
          </div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="flow-analyze-btn">🔍 Analisar projeto existente</button>
            <button class="flow-validate-btn" id="flow-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel de atribuição</button>
            <div id="flow-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;color:var(--cd-text);margin-bottom:8px;">⬇️ Baixar Imagens do Projeto</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="flow-dl-identified" style="margin:0;">📋 Todas as Identificadas</button>
                <button class="flow-validate-btn" id="flow-dl-scenes" style="margin:0;">🎬 Apenas Cenas</button>
                <button class="flow-validate-btn" id="flow-dl-refs" style="margin:0;">🖼️ Apenas Referências</button>
                <button class="flow-validate-btn" id="flow-dl-all" style="margin:0;">📦 Completo (Todas as Geradas)</button>
              </div>
            </div>
          </div>
        </div>
        <div id="flow-logs-container" class="flow-logs-container"><div id="flow-debug-panel" class="flow-debug-panel"></div></div>
        <a id="flow-logout-link" class="flow-logout-link">Sair da conta</a>
      </div>
    </div>
    <div class="flow-tab-content" data-tab="videos">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Prompts de vídeo</h3>
            <p class="flow-card-description">Um prompt por linha. Use <strong>{cena X}</strong> para numerar cenas, <strong>[nome]</strong> para referências e <strong>&lt;voz: Nome&gt;</strong> para vozes.</p>
          </div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="fv-prompts-input" placeholder="Ex:&#10;{cena 10} [Maria] caminhando no [Parque] com vento forte &lt;voz: Algebra&gt;&#10;{cena 13} Close-up de [João] olhando para o horizonte&#10;&#10;Ou sem numeração:&#10;Paisagem noturna com lua cheia&#10;Carro andando na estrada"></textarea>
            <input type="number" id="fv-start-from" class="flow-select-imgs" style="margin-top:8px;width:100%;box-sizing:border-box;" placeholder="Retomar de (Cena X). Ex: 20 (Use 0 para pular)">
            <div id="fv-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Referências detectadas</h3>
            <p class="flow-card-description">Valide as referências [nome] antes de iniciar.</p>
          </div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="fv-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência ou voz detectada.</span></div>
           <button class="flow-validate-btn" id="fv-validate-btn">🔍 Validar referências na galeria</button>
<button class="flow-validate-btn" id="fv-mark-refs-valid-btn" style="margin-top:6px;">✅ Referências já validadas</button>
<button class="flow-validate-btn" id="fv-clear-refs-btn" style="margin-top:6px;">🧽 Limpar referências validadas</button>
<button class="flow-validate-btn" id="fv-assign-refs-btn" style="display:none;margin-top:6px;">📌 Atribuir referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-title">Modo de geração</div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-vmode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-vmode="scenes">🎬 Cenas</button>
                <button class="flow-mode-btn" data-vmode="voice">🎙️ Vozes</button>
              </div>
              <div id="fv-mode-desc" style="font-size:11px;color:var(--cd-text-light);line-height:1.4;min-height:16px;">Gera vídeos sem atribuir nomes. Ideal para testes rápidos.</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Prompts simultâneos</div>
                <div class="flow-option-desc">Prompts enviados por lote.</div>
              </div>
              <div class="flow-batch-btns">
                <button class="flow-batch-btn" data-vbatch="1">1</button>
                <button class="flow-batch-btn" data-vbatch="2">2</button>
                <button class="flow-batch-btn" data-vbatch="3">3</button>
                <button class="flow-batch-btn active" data-vbatch="4">4</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Resultados por prompt</div>
                <div class="flow-option-desc">Quantos vídeos o Flow gera por envio.</div>
              </div>
              <select id="fv-results-per-prompt" class="flow-select-imgs">
                <option value="1">1 vídeo</option>
                <option value="2">2 vídeos</option>
                <option value="3" selected>3 vídeos</option>
                <option value="4">4 vídeos</option>
              </select>
              <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
  <div class="flow-option-text">
    <div class="flow-option-title">Tentativas ao falhar</div>
    <div class="flow-option-desc">Quantas vezes tentar novamente o prompt se a geração falhar. 0 desativa a regeração.</div>
  </div>
  <select id="fv-max-retries" class="flow-select-imgs">
    <option value="0" selected>0 tentativa</option>
    <option value="1">1 tentativa</option>
    <option value="2">2 tentativas</option>
    <option value="3">3 tentativas</option>
    <option value="4">4 tentativas</option>
    <option value="5">5 tentativas</option>
  </select>
</div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
  <input type="checkbox" id="fv-auto-name-scenes">
  <div class="flow-option-text">
    <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Nomear vídeos automaticamente</div>
    <div class="flow-option-desc">No modo Cenas, renomeia como Cena X - Vídeo Y.</div>
  </div>
</label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Quando enumerar</div>
                <div class="flow-option-desc">Enumera ao final de tudo ou após cada bloco de prompts.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-enum="end">📋 No final</button>
                <button class="flow-mode-btn" data-enum="block">🏷️ Por bloco</button>
              </div>
            </div>
            <label class="flow-option" style="margin-top:4px;">
              <input type="checkbox" id="fv-approve-enum">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Aprovar antes de enumerar</div>
                <div class="flow-option-desc">Pausa após cada bloco e pede aprovação antes de nomear.</div>
              </div>
            </label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Velocidade</div>
                <div class="flow-option-desc">Ajusta o tempo entre ações. Rápido = menos espera.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn" data-speed="slow">🐢 Lento</button>
                <button class="flow-mode-btn active" data-speed="normal">🔄 Normal</button>
                <button class="flow-mode-btn" data-speed="fast">⚡ Rápido</button>
              </div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-defer-retry">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Retentar falhas no final</div>
                <div class="flow-option-desc">Em vez de parar para retentar, guarda os que falharam e retenta tudo no final.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-use-backspace">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Modo alternativo (Backspace 3x)</div>
                <div class="flow-option-desc">Apaga a ref para evitar erros.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-show-logs">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div>
              </div>
            </label>
          </div>
        </div>
        <div class="flow-actions">
          <button id="fv-start-btn" class="flow-btn flow-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg> Iniciar</button>
          <button id="fv-stop-btn" class="flow-btn flow-btn-secondary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> Parar</button>
        </div>
        <div id="fv-status" class="flow-status"></div>
        <div class="flow-progress"><div id="fv-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="fv-prompts-preview-card" style="display:none;">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Fila de prompts</h3>
            <p class="flow-card-description" id="fv-queue-info"></p>
          </div>
          <div class="flow-card-content">
            <div class="flow-prompt-list" id="fv-prompt-list"></div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Analisar Projeto (Vídeos)</h3>
            <p class="flow-card-description">Escaneia o projeto para mostrar labels de vídeos já atribuídos.</p>
          </div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="fv-analyze-btn">🔍 Analisar projeto existente</button>
            <button class="flow-validate-btn" id="fv-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel de atribuição</button>
            <div id="fv-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;color:var(--cd-text);margin-bottom:8px;">⬇️ Baixar do Projeto</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="fv-dl-identified" style="margin:0;">📋 Todas as Identificadas</button>
                <button class="flow-validate-btn" id="fv-dl-scenes" style="margin:0;">🎬 Apenas Cenas</button>
                <button class="flow-validate-btn" id="fv-dl-all" style="margin:0;">📦 Completo (Todas as Geradas)</button>
                <button class="flow-validate-btn" id="fv-upscale-btn" style="margin:0; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#fff; border:none; margin-top: 6px;">🚀 Upscale 1080p (Vídeos Identificados)</button>
                <button class="flow-validate-btn" id="fv-upscale-stop-btn" style="margin:0; margin-top:6px; display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca;">⏹ Parar Upscale</button>
                <button class="flow-validate-btn" id="fv-upscale-retry-btn" style="margin:0; margin-top:6px; display:none; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; border:none;">🔄 Retentar Falhas do Upscale</button>
             
              <button class="flow-validate-btn" id="fv-upscale-debug-btn" style="margin:0; margin-top:6px;">
  🔎 Diagnosticar vídeos do upscale
</button>
              </div>
            </div>
          </div>
        </div>
        <div id="fv-logs-container" class="flow-logs-container"><div id="fv-debug-panel" class="flow-debug-panel"></div></div>
      </div>
    </div>
  </div>
  <footer class="flow-footer">Feito por <a href="https://www.youtube.com/@ViníciusLinharesCANALDARK" target="_blank">Criadores Dark - Vinícius Linhares</a></footer>
</div>
<div id="flow-mini">
  <div class="flow-mini-header">
    <div class="flow-mini-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="8,6 20,12 8,18"/></svg></div>
    <div class="flow-mini-title">Criadores Dark</div>
    <button id="flow-mini-close" class="flow-mini-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div id="flow-mini-status" class="flow-mini-status">Processando...</div>
  <div id="flow-mini-sub" class="flow-mini-sub"></div>
  <div id="flow-mini-details" class="flow-mini-details"></div>
  <div class="flow-mini-progress"><div id="flow-mini-progress-bar" class="flow-mini-progress-bar"></div></div>
</div>
<div id="flow-popup-overlay"></div>
<div id="flow-popup">
  <h3>✅ Automação Concluída!</h3>
  <p id="flow-popup-msg">Todos os prompts foram processados!</p>
  <div id="flow-popup-failed" class="failed-list" style="display:none;"></div>
  <div style="display:flex;gap:8px;">
    <button id="flow-popup-download" class="flow-btn flow-btn-primary" style="flex:1;display:none;">⬇️ Baixar Geradas</button>
    <button id="flow-close-popup" class="flow-btn flow-btn-secondary" style="flex:1;">Fechar</button>
  </div>
  <a href="https://darktube-mentor.lovable.app/curso" target="_blank" class="flow-promo">
    <p>Conheça nosso Curso sobre <strong>CANAIS DARK</strong> e tenha acesso a várias outras ferramentas</p>
  </a>
</div>
<div id="flow-assign-panel">
  <div class="flow-assign-header">
    <h3 id="flow-assign-title">Atribuir</h3>
    <span class="flow-assign-count" id="flow-assign-count"></span>
    <div class="flow-assign-header-btns">
      <button class="flow-assign-dl-btn" id="flow-assign-download" style="display:none;">⬇️ Baixar Cenas</button>
      <button class="flow-assign-hbtn" id="flow-assign-auto" title="Enumerar automático: renomeia cada imagem gerada pelo início do prompt">⚡ Auto</button>
      <button class="flow-assign-hbtn" id="flow-assign-layout" title="Alternar Horizontal/Vertical">↔</button>
      <button class="flow-assign-hbtn" id="flow-assign-toggle" title="Minimizar">▲</button>
      <button class="flow-assign-hbtn close-btn" id="flow-assign-close" title="Fechar">✕</button>
    </div>
  </div>
  <div class="flow-assign-items" id="flow-assign-items"></div>
  <div class="flow-assign-prompt-preview" id="flow-assign-preview" style="display:none;"><span class="preview-label"></span><span class="preview-text"></span></div>
  <div class="flow-assign-reload-bar" id="flow-assign-reload-bar"><button id="flow-assign-reload">🔄 Atualizar Página</button></div>
</div>
`);

    // ============================================================
    // CLASSE PRINCIPAL
    // ============================================================
    class FlowAutomation {

        constructor() {
            this.isRunning       = false;
            this.shouldStop      = false;
            this.prompts         = [];
            this.validatedRefs   = this.loadValidatedRefs();
            this.batchSize       = 4;
            this.imagesPerPrompt = 3;
            this.maxPromptRetries = CONFIG.MAX_RETRIES;
            this.gridCols        = 3;
            this.rowHeight       = 347;
            // Modo: 'free' | 'refs' | 'scenes'
            this.genMode         = 'free';
            // Reference mode
            this.refNames        = [];
            this.refAssignments  = new Map(); // name → workflowId
            // Scene mode
            this.sceneCount      = 0;
            this.sceneAssignments = new Map(); // 'Cena X' → [{ imgNum, workflowId }]
            // Tile tracking
            this.tileAssignments = new Map(); // workflowId → { label, type }
            // ── Video state ──
            this.videoIsRunning       = false;
            this.videoShouldStop      = false;
            this.videoPrompts         = [];
            this.videoGenMode         = 'free'; // 'free' | 'scenes' | 'voice'
            this.videoBatchSize       = 4;
            this.videoResultsPerPrompt = 3;
            this.videoMaxPromptRetries = CONFIG.MAX_RETRIES;
            this.videoSceneCount      = 0;
            this.videoSceneAssignments = new Map(); // 'Cena X' → [{ imgNum, workflowId }]
            // ── Speed + Enum config ──
            this.speedMultiplier  = 1.0;   // 0.7 / 1.0 / 1.5
            this.enumMode         = 'end'; // 'end' | 'block'
            this.approveBeforeEnum = false;
            this._blockApprovalResolve = null; // para pausar no approve
            this.deferRetry = false; // retentar no final em vez de imediatamente
            this.initUI();
            this.setupTextWatcher();
            this.setupVideoTextWatcher();
            this.setupDragDrop();
            log.success('Flow Automation v4.0 inicializado!');
            if (!_authToken) log.warn('Token ainda não capturado — faça qualquer ação na página.');

            // Verifica se há estado salvo de crash anterior
            this.checkCrashRecovery();
        }

        // ──────────────────────────────────────────────
        // UI INIT
        // ──────────────────────────────────────────────

        initUI() {
            const $ = id => document.getElementById(id);
            const sidebar = $('flow-sidebar'), panel = $('flow-panel'), close = $('flow-close');
            const mini = $('flow-mini'), miniClose = $('flow-mini-close');

            sidebar.addEventListener('click', () => {
                panel.classList.add('active');
                sidebar.style.display = 'none';
                mini.style.display = 'none';
                document.getElementById('flow-assign-panel').classList.remove('panel-closed');
            });
           close.addEventListener('click', () => {
    panel.classList.remove('active');
    document.getElementById('flow-assign-panel').classList.add('panel-closed');
    sidebar.style.display = '';

    if (this.isRunning || this.videoIsRunning) {
        mini.style.display = 'flex';
    } else {
        mini.style.display = 'none';
    }
});
            mini.addEventListener('click', e => {
                if (e.target.closest('#flow-mini-close')) return;
                panel.classList.add('active');
                mini.style.display = 'none';
                sidebar.style.display = 'none';
                document.getElementById('flow-assign-panel').classList.remove('panel-closed');
            });
            miniClose.addEventListener('click', () => { mini.style.display = 'none'; sidebar.style.display = ''; });

            document.querySelectorAll('.flow-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.flow-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.flow-tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.querySelector(`.flow-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
                });
            });

            // Mode selector
            const modeDescs = {
                free: 'Gera imagens sem atribuir nomes. Ideal para testes rápidos.',
                refs: 'Primeira linha: [Nome1][Nome2]... Após gerar, arraste cada referência para a imagem desejada.',
                scenes: 'Cada prompt = uma cena. Após gerar, arraste as cenas para as melhores imagens e baixe.'
            };
            document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.genMode = btn.dataset.mode;
                    const descEl = document.getElementById('flow-mode-desc');
                    if (descEl) descEl.textContent = modeDescs[this.genMode] || '';
                    this.logDebug(`Modo: ${this.genMode}`, 'info');
                });
            });

            $('flow-validate-btn').addEventListener('click', () => this.validateReferences());
$('flow-mark-refs-valid-btn').addEventListener('click', () => this.markReferencesAsValidated('images'));
            const clearImageRefsBtn = $('flow-clear-refs-btn');
if (clearImageRefsBtn) {
    clearImageRefsBtn.addEventListener('click', () => this.clearReferencesForUI('images'));
}

const fixUploadRefsBtn = $('flow-fix-upload-refs-btn');
if (fixUploadRefsBtn) {
    fixUploadRefsBtn.addEventListener('click', () => this.renameUploadReferencesFromFilenames());
}
            $('flow-show-logs').addEventListener('change', e => $('flow-logs-container').classList.toggle('visible', e.target.checked));
            $('flow-start-btn').addEventListener('click', () => this.start());
            $('flow-stop-btn').addEventListener('click',  () => this.stop());
            $('flow-close-popup').addEventListener('click', () => { $('flow-popup').style.display='none'; $('flow-popup-overlay').style.display='none'; });
            $('flow-popup-download').addEventListener('click', () => this.downloadLastRunMedia());
            $('flow-logout-link').addEventListener('click', () => { if(confirm('Sair da conta Criadores Dark?')) chrome.runtime?.sendMessage?.({action:'logout'}); });

            // ── Layout toggle (horizontal ↔ vertical) ──
            $('flow-assign-layout').addEventListener('click', () => {
                const panel = document.getElementById('flow-assign-panel');
                panel.classList.toggle('vertical');
                const isVert = panel.classList.contains('vertical');
                $('flow-assign-layout').textContent = isVert ? '↕' : '↔';
                $('flow-assign-layout').title = isVert ? 'Voltar para Horizontal' : 'Alternar para Vertical';
                this.updateScrollerPadding();
            });
            $('flow-analyze-btn').addEventListener('click', () => this.analyzeProject());
            $('flow-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('flow-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('flow-dl-refs').addEventListener('click', () => this.downloadProjectImages('refs'));
            $('flow-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('flow-assign-close').addEventListener('click', () => this.hideAssignPanel());
            $('flow-reopen-assign').addEventListener('click', () => this.reopenAssignPanel());
            $('flow-assign-reload').addEventListener('click', () => location.reload());
            // reload bar is the parent container
            $('flow-assign-download').addEventListener('click', () => this.downloadScenes());
            $('flow-assign-toggle').addEventListener('click', () => this.toggleAssignPanel());
            $('flow-assign-refs-btn').addEventListener('click', () => this.openAssignRefsFromDetected());
            const autoBtnEl = document.getElementById('flow-assign-auto');
            if (autoBtnEl) autoBtnEl.addEventListener('click', () => this.autoEnumerarCenas());
            const autoMainBtn = document.getElementById('flow-auto-enumerate-btn');
            if (autoMainBtn) autoMainBtn.addEventListener('click', () => this.autoEnumerarCenas());

            // ── Speed buttons (shared) ──
            document.querySelectorAll('[data-speed]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const profile = CONFIG.SPEED_PROFILES[btn.dataset.speed];
                    if (profile) {
                        this.speedMultiplier = profile.multiplier;
                        const infoEl = document.getElementById('flow-speed-info');
                        if (infoEl) infoEl.textContent = `Velocidade: ${profile.label} (${profile.multiplier}×)`;
                        this.logDebug(`Velocidade: ${profile.label} (${profile.multiplier}×)`, 'info');
                    }
                });
            });

            // ── Enum mode buttons (shared) ──
            document.querySelectorAll('[data-enum]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-enum]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.enumMode = btn.dataset.enum;
                    this.logDebug(`Enumeração: ${this.enumMode === 'block' ? 'Por bloco' : 'No final'}`, 'info');
                });
            });

            // ── Approve checkbox ──
            const approveCheckbox = $('flow-approve-enum');
            if (approveCheckbox) {
                approveCheckbox.addEventListener('change', e => {
                    this.approveBeforeEnum = e.target.checked;
                });
            }

            // ── Defer retry checkboxes (sync image ↔ video) ──
            const deferImgCb = $('flow-defer-retry');
            if (deferImgCb) {
                deferImgCb.addEventListener('change', e => {
                    this.deferRetry = e.target.checked;
                    const fvCb = document.getElementById('fv-defer-retry');
                    if (fvCb) fvCb.checked = e.target.checked;
                });
            }
            const deferVidCb = $('fv-defer-retry');
            if (deferVidCb) {
                deferVidCb.addEventListener('change', e => {
                    this.deferRetry = e.target.checked;
                    const imgCb = document.getElementById('flow-defer-retry');
                    if (imgCb) imgCb.checked = e.target.checked;
                });
            }

            document.querySelectorAll('.flow-batch-btn').forEach(btn => {
                if (btn.hasAttribute('data-vbatch')) return;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-batch-btn:not([data-vbatch])').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.batchSize = parseInt(btn.dataset.batch);
                });
            });

            $('flow-imgs-per-prompt').addEventListener('change', e => {
                this.imagesPerPrompt = parseInt(e.target.value);
            });
            const imageRetriesSelect = $('flow-max-retries');
if (imageRetriesSelect) {
    this.maxPromptRetries = parseInt(imageRetriesSelect.value, 10);

    imageRetriesSelect.addEventListener('change', e => {
        this.maxPromptRetries = parseInt(e.target.value, 10);
        this.logDebug(`Tentativas ao falhar: ${this.maxPromptRetries}`, 'info');
    });
}

            // ── VIDEO TAB LISTENERS ──

            // Video mode selector
            const videoModeDescs = {
                free: 'Gera vídeos sem atribuir nomes. Ideal para testes rápidos.',
                scenes: 'Cada prompt = uma cena. Após gerar, arraste as cenas para os melhores vídeos e baixe.',
                voice: 'Seleciona a voz especificada com <voz: Nome> e gera a cena.'
            };
            document.querySelectorAll('[data-vmode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vmode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.videoGenMode = btn.dataset.vmode;
                    const descEl = document.getElementById('fv-mode-desc');
                    if (descEl) descEl.textContent = videoModeDescs[this.videoGenMode] || '';
                    this.logVideoDebug(`Modo: ${this.videoGenMode}`, 'info');
                });
            });

            // Video batch buttons
            document.querySelectorAll('[data-vbatch]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vbatch]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.videoBatchSize = parseInt(btn.dataset.vbatch);
                });
            });

            $('fv-results-per-prompt').addEventListener('change', e => {
                this.videoResultsPerPrompt = parseInt(e.target.value);
            });
            const videoRetriesSelect = $('fv-max-retries');
if (videoRetriesSelect) {
    this.videoMaxPromptRetries = parseInt(videoRetriesSelect.value, 10);

    videoRetriesSelect.addEventListener('change', e => {
        this.videoMaxPromptRetries = parseInt(e.target.value, 10);
        this.logVideoDebug(`Tentativas ao falhar: ${this.videoMaxPromptRetries}`, 'info');
    });
}

            // ── Video approve checkbox ──
            const videoApproveCheckbox = $('fv-approve-enum');
            if (videoApproveCheckbox) {
                videoApproveCheckbox.addEventListener('change', e => {
                    this.approveBeforeEnum = e.target.checked;
                    // Sync com o checkbox de imagens
                    const imgCheckbox = document.getElementById('flow-approve-enum');
                    if (imgCheckbox) imgCheckbox.checked = e.target.checked;
                });
            }

            $('fv-validate-btn').addEventListener('click', () => this.validateReferences('video'));
            $('fv-mark-refs-valid-btn').addEventListener('click', () => this.markReferencesAsValidated('video'));

            // ── Video assign refs button ──
            const fvAssignRefsBtn = $('fv-assign-refs-btn');
            if (fvAssignRefsBtn) {
                fvAssignRefsBtn.addEventListener('click', () => this.openVideoAssignRefsFromDetected());
            }
            const clearVideoRefsBtn = $('fv-clear-refs-btn');
if (clearVideoRefsBtn) {
    clearVideoRefsBtn.addEventListener('click', () => this.clearReferencesForUI('video'));
}
            $('fv-show-logs').addEventListener('change', e => $('fv-logs-container').classList.toggle('visible', e.target.checked));
            $('fv-start-btn').addEventListener('click', () => this.startVideo());
            $('fv-stop-btn').addEventListener('click', () => this.stopVideo());
            $('fv-analyze-btn').addEventListener('click', () => this.analyzeProject('video'));
            $('fv-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('fv-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('fv-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('fv-reopen-assign').addEventListener('click', () => this.reopenAssignPanel());
            
            // BOTÃO NOVO (UPSCALE) INJETADO AQUI
            const fvUpscaleBtn = $('fv-upscale-btn');
if (fvUpscaleBtn) fvUpscaleBtn.addEventListener('click', () => this.startUpscaleProcess());

// Upscale stop button
const fvUpscaleStopBtn = $('fv-upscale-stop-btn');
if (fvUpscaleStopBtn) {
    fvUpscaleStopBtn.addEventListener('click', () => {
        this.upscaleShouldStop = true;
        this.logVideoDebug('⏹ Upscale parado pelo usuário.', 'warning');
        this.setVideoStatus('warning', '⏹ Parando upscale...');
    });
}

// Upscale retry button
const fvUpscaleRetryBtn = $('fv-upscale-retry-btn');
if (fvUpscaleRetryBtn) {
    fvUpscaleRetryBtn.addEventListener('click', () => this.retryFailedUpscale());
}

const fvUpscaleDebugBtn = $('fv-upscale-debug-btn');
if (fvUpscaleDebugBtn) {
    fvUpscaleDebugBtn.addEventListener('click', () => this.debugUpscaleList());
}

} // fecha initUI()

setupTextWatcher() {
            const ta = document.getElementById('flow-prompts-input');
            let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateReferences(), 300); });
        }

        updateReferences() {
            const text    = document.getElementById('flow-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs    = extractReferences(prompts);
            document.getElementById('flow-prompt-count').textContent =
                `${prompts.length} prompt${prompts.length !== 1 ? 's' : ''} detectado${prompts.length !== 1 ? 's' : ''}`;
            const list = document.getElementById('flow-ref-list');
            if (!refs.length) {
                list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência. Prompts serão enviados como texto puro.</span>';
            } else {
                list.innerHTML = refs.map(r => {
                    const s = this.validatedRefs[r.toLowerCase()];
                    const cls  = s === true ? 'found'   : s === false ? 'missing'  : 'pending';
                    const icon = s === true ? '✅'      : s === false ? '❌'       : '⏳';
                    return `<span class="flow-ref-tag ${cls}">${icon} ${this.esc(r)}</span>`;
                }).join('');
            }
            // Mostra botão de atribuir se tem referências
            const assignBtn = document.getElementById('flow-assign-refs-btn');
            if (assignBtn) assignBtn.style.display = refs.length > 0 ? '' : 'none';
        }

        setupVideoTextWatcher() {
            const ta = document.getElementById('fv-prompts-input');
            let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateVideoReferences(), 300); });
        }

        updateVideoReferences() {
            const text    = document.getElementById('fv-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs    = extractReferences(prompts);
            const voices  = extractVoices(prompts);
            
            document.getElementById('fv-prompt-count').textContent =
                `${prompts.length} prompt${prompts.length !== 1 ? 's' : ''} detectado${prompts.length !== 1 ? 's' : ''}`;
            const list = document.getElementById('fv-ref-list');
            if (!refs.length && !voices.length) {
                list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência ou voz detectada.</span>';
            } else {
                let html = '';
                html += refs.map(r => {
                    const s = this.validatedRefs[r.toLowerCase()];
                    const cls  = s === true ? 'found'   : s === false ? 'missing'  : 'pending';
                    const icon = s === true ? '✅'      : s === false ? '❌'       : '⏳';
                    return `<span class="flow-ref-tag ${cls}">${icon} ${this.esc(r)}</span>`;
                }).join('');
                
                html += voices.map(v => {
                     return `<span class="flow-voice-tag">🎙️ ${this.esc(v)}</span>`;
                }).join('');
                
                list.innerHTML = html;
            }
            // Mostra botão de atribuir se tem referências
            const assignBtn = document.getElementById('fv-assign-refs-btn');
            if (assignBtn) assignBtn.style.display = refs.length > 0 ? '' : 'none';
        }
cleanUploadReferenceName(rawName) {
    if (!rawName) return null;

    let name = String(rawName).trim();

    // Se já está no padrão de referência, não mexe
    if (/\s_$/.test(name)) return null;

    // Não mexe em cenas/imagens/vídeos já identificados
    if (/^Cena\s+\d+\s*-\s*(Imagem|Vídeo|Video)\s+\d+$/i.test(name)) return null;

    // Não mexe em nomes genéricos do Flow
    if (/^(Imagem gerada|Video gerado|Vídeo gerado|Generated image|Generated video)$/i.test(name)) return null;

    // Remove extensão de arquivo, se existir
    name = name.replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '');

    // Limpa caracteres ruins de nome de arquivo
    name = name
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!name || name.length < 2) return null;

    return name;
}
        referenceKey(rawName) {
    if (!rawName) return '';

    return String(rawName)
        .trim()
        .replace(/\s_$/i, '')
        .replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
markReferencesAsValidated(source = 'images') {
    const isVideo = source === 'video';
    const inputId = isVideo ? 'fv-prompts-input' : 'flow-prompts-input';
    const statusFn = isVideo
        ? (t, m) => this.setVideoStatus(t, m)
        : (t, m) => this.setStatus(t, m);
    const updateFn = isVideo
        ? () => this.updateVideoReferences()
        : () => this.updateReferences();

    const text = document.getElementById(inputId)?.value || '';
    const prompts = parsePromptsText(text);
    const refs = extractReferences(prompts);

    if (!refs.length) {
        statusFn('warning', 'Nenhuma referência [nome] detectada nos prompts.');
        return;
    }

    for (const ref of refs) {
        const key = ref.toLowerCase().trim();
        this.validatedRefs[key] = true;
this.validatedRefs[this.referenceKey(ref)] = true;
    }

    this.saveValidatedRefs();
    updateFn();

    statusFn(
        'success',
        `✅ ${refs.length} referência(s) marcada(s) como já validada(s).`
    );
}
        // ──────────────────────────────────────────────
        // HELPERS
        // ──────────────────────────────────────────────

        sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        dynamicSleep(val) {
            const m = this.speedMultiplier || 1.0;
            if (Array.isArray(val)) {
                const [min, max] = val;
                const scaled = Math.round((min + Math.random() * (max - min)) * m);
                return this.sleep(Math.max(scaled, 100)); // mínimo 100ms
            }
            return this.sleep(Math.round(val * m));
        }

        getScroller() {
            return document.querySelector('[data-testid="virtuoso-scroller"]') ||
                   document.querySelector('[data-virtuoso-scroller="true"]') ||
                   document.querySelector('div[scrollable="true"]') ||
                   document.querySelector('[class*="virtuoso"]') ||
                   (() => {
                       // Fallback: find scrollable container holding tiles
                       const tiles = document.querySelectorAll('[data-tile-id]');
                       if (tiles.length > 0) {
                           let el = tiles[0].parentElement;
                           while (el && el !== document.body) {
                               const style = window.getComputedStyle(el);
                               if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
                                    style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                   el.scrollHeight > el.clientHeight) {
                                   return el;
                               }
                               el = el.parentElement;
                           }
                       }
                       return null;
                   })();
        }

        esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
        getValidatedRefsCacheKey() {
    const projectId = this.getProjectId?.() || location.pathname;
    return `flow_validated_refs_${projectId}`;
}

loadValidatedRefs() {
    try {
        const raw = localStorage.getItem(this.getValidatedRefsCacheKey());
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.warn('[Flow] Erro ao carregar cache de referências:', e);
        return {};
    }
}

saveValidatedRefs() {
    try {
        const onlyValid = {};
        for (const [key, value] of Object.entries(this.validatedRefs || {})) {
            if (value === true) onlyValid[key] = true;
        }
        localStorage.setItem(this.getValidatedRefsCacheKey(), JSON.stringify(onlyValid));
    } catch (e) {
        console.warn('[Flow] Erro ao salvar cache de referências:', e);
    }
}

clearValidatedRefsCache() {
    try {
        localStorage.removeItem(this.getValidatedRefsCacheKey());
    } catch (e) {}
    this.validatedRefs = {};
    this.updateReferences?.();
    this.updateVideoReferences?.();
}
clearReferencesForUI(source = 'images') {
    const isVideo = source === 'video';

    const ok = confirm(
        'Limpar referências validadas deste projeto?\n\nDepois disso, você poderá validar as referências novamente.'
    );

    if (!ok) return;

    this.clearValidatedRefsCache();

    if (isVideo) {
        this.setVideoStatus('success', '🧽 Referências validadas foram limpas. Valide novamente quando quiser.');
        this.logVideoDebug('Referências validadas limpas pelo usuário.', 'warning');
    } else {
        this.setStatus('success', '🧽 Referências validadas foram limpas. Valide novamente quando quiser.');
        this.logDebug('Referências validadas limpas pelo usuário.', 'warning');
    }
}
        // ──────────────────────────────────────────────
        // GRID + TILES
        // ──────────────────────────────────────────────

        async detectGrid() {
            const scroller = this.getScroller();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            
            // Try original virtuoso row detection
            let detected = false;
            for (let attempt = 0; attempt < 8; attempt++) {
                const firstRow = document.querySelector('[data-index="0"]');
                if (firstRow?.firstElementChild?.children?.length > 0) {
                    this.gridCols = firstRow.firstElementChild.children.length;
                    detected = true;
                    break;
                }
                await this.sleep(300);
            }
            
            // Fallback: count tiles in first visual row by Y position
            if (!detected) {
                const allTiles = document.querySelectorAll('[data-tile-id]');
                if (allTiles.length > 0) {
                    const firstTop = allTiles[0].getBoundingClientRect().top;
                    let cols = 0;
                    for (const tile of allTiles) {
                        if (Math.abs(tile.getBoundingClientRect().top - firstTop) < 10) cols++;
                        else break;
                    }
                    if (cols > 0) this.gridCols = cols;
                    // Estimate row height from first tile
                    const tileRect = allTiles[0].getBoundingClientRect();
                    if (tileRect.height > 0) this.rowHeight = tileRect.height + 8;
                    this.logDebug(`Grid detectado via fallback (tiles)`, 'info');
                }
            }
            
            const anyRow = document.querySelector('[data-known-size]');
            if (anyRow) {
                const h = parseFloat(anyRow.getAttribute('data-known-size'));
                if (h > 0) this.rowHeight = h;
            }
            const msg = `Grid: ${this.gridCols} colunas × ${this.rowHeight.toFixed(0)}px/linha`;
            this.logDebug(msg, 'success');
            const el = document.getElementById('flow-grid-info');
            if (el) el.textContent = msg;
        }

        async scrollToRow(targetRow) {
            const scroller = this.getScroller();
            if (!scroller) return;
            const el = document.querySelector(`[data-index="${targetRow}"]`);
            if (el) {
                const er = el.getBoundingClientRect();
                const sr = scroller.getBoundingClientRect();
                if (er.top >= sr.top - 10 && er.bottom <= sr.bottom + 10) return;
            }
            scroller.scrollTop = targetRow * this.rowHeight;
            await this.dynamicSleep([400, 600]);
            for (let i = 0; i < 12; i++) {
                if (document.querySelector(`[data-index="${targetRow}"]`)) return;
                await this.sleep(150);
            }
        }

        getTileAt(row, col) {
            const rowEl = document.querySelector(`[data-index="${row}"]`);
            if (!rowEl) return null;
            const container = rowEl.firstElementChild;
            if (!container) return null;
            const colSlot = container.children[col];
            if (!colSlot) return null;
            const wrapper = colSlot.firstElementChild;
            if (!wrapper) return null;
            return wrapper.firstElementChild || null;
        }

        getUuidFromTile(tile) {
            if (!tile) return null;
            const media = tile.querySelector('img[src*="getMediaUrlRedirect"]') ||
                          tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (!media) return null;
            try { return new URL(media.src).searchParams.get('name'); } catch(e) { return null; }
        }

        getWorkflowIdFromTile(tile) {
            if (!tile) return null;
            // O workflow ID está no href do link /edit/UUID, NÃO no data-tile-id
            const link = tile.querySelector('a[href*="/edit/"]');
            if (link) {
                const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                if (m) return m[1];
            }
            // Fallback: procura em tiles aninhados
            const inner = tile.querySelector('[data-tile-id]');
            if (inner) {
                const innerLink = inner.querySelector('a[href*="/edit/"]');
                if (innerLink) {
                    const m = innerLink.href.match(/\/edit\/([a-f0-9-]{36})/);
                    if (m) return m[1];
                }
            }
            return null;
        }

        getProjectId() {
            const m = location.href.match(/project\/([a-f0-9-]{36})/);
            if (m) return m[1];
            const link = document.querySelector('a[href*="/project/"]');
            if (link) {
                const m2 = link.href.match(/project\/([a-f0-9-]{36})/);
                if (m2) return m2[1];
            }
            return null;
        }

        isVideoTile(tile) {
            if (!tile) return false;
            return !!tile.querySelector('video[src*="getMediaUrlRedirect"]');
        }

        /**
         * Retorna a URL de download da mídia do tile.
         * Para vídeos: retorna o src do <video> (não da thumbnail).
         * Para imagens: retorna o src do <img>.
         */
        getMediaSrcFromTile(tile) {
            if (!tile) return '';
            // Vídeos: prioriza <video src>
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src) return video.src;
            // Imagens: <img src>
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            return img?.src || '';
        }

        // Alias para compatibilidade
        getImgSrcFromTile(tile) { return this.getMediaSrcFromTile(tile); }

        isTileLoaded(tile) {
            if (!tile) return false;
            // Verifica thumbnail (existe em imagens e vídeos carregados)
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            if (img && img.complete && parseFloat(getComputedStyle(img).opacity) >= 0.9) return true;
            // Vídeo sem thumbnail mas com src pode estar carregado
            // (verifica se o video tem src e NÃO tem indicador de progresso)
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src && !this.tileHasProgress(tile)) {
                // Checa se não é um tile "vazio" — deve ter pelo menos o play_circle icon
                const playIcon = [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'play_circle');
                if (playIcon) return true;
            }
            return false;
        }

        isTilePending(tile) {
            if (!tile) return false;
            if (this.isTileLoaded(tile)) return false;
            return this.tileHasProgress(tile);
        }

        isTileError(tile) {
            if (!tile) return false;
            if (this.isTileLoaded(tile)) return false;
            if (this.isTilePending(tile)) return false;
            return [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'warning');
        }

        tileHasProgress(tile) {
            const els = tile.querySelectorAll('div, span');
            for (const el of els) {
                const t = el.textContent?.trim();
                if (t && /^\d+%$/.test(t)) return true;
            }
            return false;
        }

        snapshotImageUuids() {
            const uuids = new Set();
            document.querySelectorAll('[data-tile-id] img[src*="getMediaUrlRedirect"]').forEach(el => {
                try { const u = new URL(el.src).searchParams.get('name'); if (u) uuids.add(u); } catch(e) {}
            });
            document.querySelectorAll('[data-tile-id] video[src*="getMediaUrlRedirect"]').forEach(el => {
                try { const u = new URL(el.src).searchParams.get('name'); if (u) uuids.add(u); } catch(e) {}
            });
            return uuids;
        }

        // ──────────────────────────────────────────────
        // MATRIZ + AGUARDAR GERAÇÃO
        // ──────────────────────────────────────────────

        buildPositionMatrix(batch, imgsPerPrompt, rowOffset) {
            const C = this.gridCols, matrix = [], total = batch.length * imgsPerPrompt;
            for (let pos = 0; pos < total; pos++) {
                const row = rowOffset + Math.floor(pos / C);
                const col = pos % C;
                const batchRevIdx = Math.floor(pos / imgsPerPrompt);
                const batchIdx = batch.length - 1 - batchRevIdx;
                const imgNum = (pos % imgsPerPrompt) + 1;
                matrix.push({ row, col, promptNum: batch[batchIdx].promptNum, imgNum, state: 'pending' });
            }
            return matrix;
        }

        async waitForMatrix(matrix, beforeUuids) {
            const scroller = this.getScroller();
            const rowsNeeded = Math.max(...matrix.map(s => s.row)) + 1;
            const start = Date.now();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            this.logDebug(`Aguardando ${matrix.length} slot(s) em ${rowsNeeded} linha(s)...`, 'info');

            // Tracking: uma vez confirmado como loaded (UUID novo), não re-verifica.
            // Isso evita falsos "pending" quando o Virtuoso destrói/recria DOM ao scrollar.
            const confirmedLoaded = new Set(); // índices de matrix[] já confirmados
            const confirmedError  = new Set();

            const countStates = () => {
                let loaded = 0, errors = 0, pending = 0;
                for (let i = 0; i < matrix.length; i++) {
                    if (confirmedLoaded.has(i)) { loaded++; continue; }
                    if (confirmedError.has(i))  { errors++; continue; }
                    const slot = matrix[i];
                    const tile = this.getTileAt(slot.row, slot.col);
                    if (!tile) { pending++; continue; }
                    if (this.isTileLoaded(tile)) {
                        const uuid = this.getUuidFromTile(tile);
                        if (uuid && !beforeUuids.has(uuid)) {
                            loaded++;
                            confirmedLoaded.add(i);
                            // Captura dados já para evitar re-scroll na Fase 3
                            slot.uuid = uuid;
                            slot.src = this.getImgSrcFromTile(tile);
                            slot.workflowId = this.getWorkflowIdFromTile(tile);
                        }
                        else pending++;
                    } else if (this.isTileError(tile)) {
                        errors++;
                        confirmedError.add(i);
                    }
                    else { pending++; }
                }
                return { loaded, errors, pending };
            };

            // Fase 1: aguarda primeiro slot resolver
            let detected = false;
            while (Date.now() - start < CONFIG.GENERATION_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                await this.dynamicSleep(CONFIG.TILE_CHECK_INTERVAL);
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors, pending } = countStates();
                if (loaded + errors > 0) { detected = true; break; }
            }
            if (!detected) { for (const s of matrix) s.state = 'error'; return; }

            // Fase 2: aguarda pending === 0 estável
            let lastPending = -1, pendingZeroAt = null;
            while (Date.now() - start < CONFIG.GENERATION_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                await this.dynamicSleep(CONFIG.TILE_CHECK_INTERVAL);
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors, pending } = countStates();
                if (pending !== lastPending) {
                    lastPending = pending;
                    pendingZeroAt = pending === 0 ? Date.now() : null;
                    this.logDebug(`Progresso: ${loaded} ✅  ${errors} ❌  ${pending} ⏳`, 'info');
                }
                if (pending === 0 && (Date.now() - (pendingZeroAt || Date.now())) >= CONFIG.STABILIZE_TIME) {
                    this.logDebug(`✅ Lote finalizado: ${loaded} ok, ${errors} erros`, 'success');
                    break;
                }
            }

            // Fase 3: classifica slots — apenas os que NÃO foram confirmados durante polling
            this.logDebug('Classificando slots finais...', 'info');
            for (let i = 0; i < matrix.length; i++) {
                const slot = matrix[i];
                if (confirmedLoaded.has(i)) {
                    slot.state = 'loaded';
                    continue;
                }
                if (confirmedError.has(i)) {
                    slot.state = 'error';
                    continue;
                }
                // Slot não confirmado: tenta scroll e verificação final
                if (this.shouldStop || this.videoShouldStop) return;
                await this.scrollToRow(slot.row);
                const tile = this.getTileAt(slot.row, slot.col);
                if (!tile) { slot.state = 'error'; continue; }
                if (this.isTileLoaded(tile)) {
                    const uuid = this.getUuidFromTile(tile);
                    if (uuid && !beforeUuids.has(uuid)) {
                        slot.state = 'loaded'; slot.uuid = uuid;
                        slot.src = this.getImgSrcFromTile(tile);
                        slot.workflowId = this.getWorkflowIdFromTile(tile);
                    } else { slot.state = 'error'; }
                } else { slot.state = 'error'; }
            }
            if (scroller) { scroller.scrollTop = 0; await this.sleep(300); }
        }

        // ──────────────────────────────────────────────
        // EDITOR (Slate)
        // ──────────────────────────────────────────────

        getEditor() {
            return document.querySelector('[data-slate-editor="true"]')
                || document.querySelector('div[role="textbox"][contenteditable="true"]')
                || document.querySelector('div[role="textbox"]');
        }

        async clearEditor() {
            const e = this.getEditor();
            if (!e) throw new Error('Editor Slate não encontrado');
            e.focus(); await this.dynamicSleep(CONFIG.DELAY_SHORT);
            document.execCommand('selectAll', false, null); await this.dynamicSleep([250, 400]);
            document.execCommand('delete', false, null); await this.dynamicSleep(CONFIG.DELAY_SHORT);
        }

        async insertText(text) {
            const e = this.getEditor();
            if (!e) throw new Error('Editor não encontrado');
            e.focus(); await this.dynamicSleep([250, 400]);

            // Slate requer beforeinput com insertText - é a única forma
            // que o editor reconhece. execCommand modifica DOM mas Slate ignora.
            // O crash anterior (insertBefore) era causado por beforeinput de backspace
            // em sequência rápida, não pela inserção de texto.
            // Proteção: aguardar animationFrame para não conflitar com React render.
            await new Promise(resolve => requestAnimationFrame(resolve));
            e.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true,
                inputType: 'insertText', data: text
            }));

            // Delay extra para React reconciliar o DOM após a inserção
            await this.dynamicSleep([400, 600]);

            if (this.isFlowCrashed()) {
                throw new Error('Flow crashou após inserção de texto');
            }
        }

        async openAtSelector() {
            const MAX_AT_RETRIES = 3;
            for (let attempt = 1; attempt <= MAX_AT_RETRIES; attempt++) {
                const e = this.getEditor();
                if (!e) throw new Error('Editor não encontrado');
                e.focus(); await this.dynamicSleep([250, 400]);
                e.dispatchEvent(new KeyboardEvent('keydown', { key:'@', bubbles:true, cancelable:true }));
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                let opened = false;
                for (let i = 0; i < 20; i++) {
                    await this.dynamicSleep(CONFIG.DELAY_SHORT);
                    if (document.querySelector('[role="dialog"], [role="presentation"]')) { opened = true; break; }
                }
                if (opened) return;
                this.logDebug(`⚠️ Diálogo @ não abriu (tentativa ${attempt}/${MAX_AT_RETRIES})`, 'error');
                e.focus(); await this.sleep(200);
                // Usa execCommand para backspace (compatível com React)
                document.execCommand('delete', false, null);
                await this.sleep(200);
                if (attempt < MAX_AT_RETRIES) {
                    await this.dynamicSleep([2000, 3000]);
                    e.focus(); e.click(); await this.dynamicSleep([500, 800]);
                }
            }
            throw new Error('Diálogo @ não abriu após ' + MAX_AT_RETRIES + ' tentativas');
        }

        // ============================================
        // O SEGREDO DAS ABAS DO RADIX
        // ============================================
        async clickDialogTab(type) {
            let targetTab = null;
            const selector = type === 'image' 
                ? 'button[role="tab"][aria-controls*="IMAGE"]' 
                : 'button[role="tab"][aria-controls*="AUDIO"]';

            for (let i = 0; i < 10; i++) {
                targetTab = document.querySelector(selector);
                if (targetTab) break;
                await this.dynamicSleep([200, 300]);
            }

            if (targetTab) {
                const isSelected = targetTab.getAttribute('aria-selected') === 'true' || targetTab.getAttribute('data-state') === 'active';
                if (!isSelected) {
                    this.logDebug(`Migrando para a aba: ${type === 'image' ? 'Imagens' : 'Vozes'}`, 'info');
                    targetTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetTab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetTab.click();
                    await this.dynamicSleep([800, 1200]); 
                }
            }
        }

        async searchAndSelect(name) {
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (!dialog) throw new Error('Diálogo @ não aberto');
            await this.dynamicSleep([500, 700]);
            const input = dialog.querySelector('input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]');
            if (!input) throw new Error('Input de pesquisa não encontrado');
            input.focus(); await this.dynamicSleep([250, 400]);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, name);
            input.dispatchEvent(new Event('input',  { bubbles:true }));
            input.dispatchEvent(new Event('change', { bubbles:true }));
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            let target = null;
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                const items = dialog.querySelectorAll('[data-item-index]');
                if (items.length > 0) {
                    let bestItem = null;
                    const nameLower = name.toLowerCase().trim();
                    // Limpa extensão do nome buscado também
                    const cleanSearch = nameLower.replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '').trim();
                    for (const item of items) {
                        const nameDiv = [...item.querySelectorAll('div')].find(d =>
                            d.children.length === 0 && d.textContent?.trim().length > 0
                        );
                        const img = item.querySelector('img');
                        const itemName = (nameDiv?.textContent || img?.alt || '').trim().toLowerCase();
                        // Comparação: tira sufixo " _" E extensão de arquivo
                        const cleanName = itemName
                            .replace(/ _$/, '')
                            .replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '')
                            .trim();
                        if (cleanName === cleanSearch || cleanName === nameLower || itemName === nameLower) {
                            bestItem = item;
                            break;
                        }
                    }
                    const chosen = bestItem || items[0];
                    target = chosen.querySelector('div[role="button"]') || chosen.querySelector('img')?.closest('div') || chosen.querySelector('div');
                    if (target) break;
                }
            }
            if (!target) throw new Error(`Sem resultado para "${name}"`);
            await this.dynamicSleep([250, 400]);
            target.click();
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                if (!document.querySelector('[role="dialog"]')) return;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }

        // ============================================
        // FUNÇÃO NOVA E DEFINITIVA PARA VOZES
        // ============================================
        async searchAndSelectVoice(name) {
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (!dialog) throw new Error('Diálogo @ não aberto');
            await this.dynamicSleep([500, 700]);
            
            const input = dialog.querySelector('input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]');
            if (!input) throw new Error('Input de pesquisa de voz não encontrado');
            
            input.focus(); await this.dynamicSleep([250, 400]);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, name);
            input.dispatchEvent(new Event('input',  { bubbles:true }));
            input.dispatchEvent(new Event('change', { bubbles:true }));
            await this.dynamicSleep([1500, 2000]); 
            
            let target = null;
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                const nameLower = name.toLowerCase().trim();
                const divs = dialog.querySelectorAll('div');
                for (const div of divs) {
                    if (div.children.length === 0 && div.textContent && div.textContent.trim().toLowerCase() === nameLower) {
                        target = div.closest('button, [role="option"], [role="button"], [role="menuitem"]') || div;
                        break;
                    }
                }
                if (target) break;
            }
            
            if (!target) throw new Error(`Voz "${name}" não encontrada.`);
            await this.dynamicSleep([250, 400]);
            
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.click();
            
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                if (!document.querySelector('[role="dialog"], [role="presentation"]')) return;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }

       async clickSubmit() {
    await this.dynamicSleep(CONFIG.DELAY_MEDIUM);

    const findSubmitBtn = () => [...document.querySelectorAll('button')].find(b =>
        b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward'
    );

    // Assinatura do conteúdo REAL do editor Slate.
    // IMPORTANTE: NÃO usar innerText/textContent — quando o editor está vazio
    // o Flow renderiza o placeholder ("What do you want to create?") DENTRO do
    // editor, então innerText tem ~27 chars mesmo vazio. O conteúdo real fica
    // nos nós [data-slate-string]; os chips de referência são nós void.
    const editorSignature = () => {
        const ed = this.getEditor?.();
        if (!ed) return null;
        const txt = [...ed.querySelectorAll('[data-slate-string="true"]')]
            .map(n => n.textContent).join('')
            .replace(/[﻿​]/g, '').trim();
        const chips = ed.querySelectorAll('[data-slate-void="true"]').length;
        return txt + '|' + chips;
    };
    const EMPTY_SIG = '|0';

    const btn = findSubmitBtn();

    if (!btn) {
        throw new Error('Botão enviar não encontrado');
    }

    for (let i = 0; i < 30; i++) {
        if (!btn.disabled) break;
        await this.dynamicSleep(CONFIG.DELAY_SHORT);
    }

    if (btn.disabled) {
        throw new Error('Botão enviar desabilitado');
    }

    // Só dá pra confirmar "esvaziou" se havia conteúdo antes do clique.
    const hadContentBefore = editorSignature() !== EMPTY_SIG;

    triggerTrustedClick(btn);

    // Confirma se o Flow realmente aceitou o envio.
    // Sinais aceitos (qualquer um):
    //   1. O editor esvaziou de verdade (conteúdo Slate == vazio) — principal.
    //   2. O botão de enviar ficou desabilitado (nem sempre acontece).
    for (let i = 0; i < 30; i++) {
        await this.dynamicSleep([250, 400]);

        const currentBtn = findSubmitBtn();

        const editorCleared = hadContentBefore && editorSignature() === EMPTY_SIG;
        const buttonReacted = currentBtn && currentBtn.disabled;

        if (editorCleared || buttonReacted) {
            await this.dynamicSleep(CONFIG.DELAY_LONG);
            return true;
        }
    }

    throw new Error('Clique de envio não confirmado pelo Flow');
}

        async prepareAndSubmit(promptObj) {
            const MAX_SUBMIT_RETRIES = 2;

            for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
                try {
                    this.logDebug(`Preparando prompt ${promptObj.promptNum}: "${promptObj.text.substring(0,50)}..."${attempt > 1 ? ` (tentativa ${attempt})` : ''}`, 'info');
                    const segs = parsePrompt(promptObj.text);
                    await this.clearEditor();
                    await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
                    for (const seg of segs) {
                        if (this.shouldStop || this.videoShouldStop) return false;
                        if (seg.type === 'text') {
                             await this.insertText(seg.content);
} else if (seg.type === 'ref') { 
                         await this.openAtSelector(); 
                         await this.clickDialogTab('image');
                         await this.searchAndSelect(seg.name); 
                         await this.dynamicSleep(CONFIG.DELAY_SHORT);
                         
                        // Verifica se a opção do Backspace foi ativada
                         const useBackspace = (document.getElementById('flow-use-backspace') && document.getElementById('flow-use-backspace').checked) || 
                                              (document.getElementById('fv-use-backspace') && document.getElementById('fv-use-backspace').checked);

                         if (useBackspace) {
                             // --- INÍCIO DA CORREÇÃO (APAGAR CHIP DO TEXTO 3 VEZES) ---
                             const editor = this.getEditor();
                             if (editor) {
                                 editor.focus();
                                 await this.dynamicSleep([150, 250]);
                                 
                                 // Loop que repete o Backspace 3 vezes
                                 for (let b = 0; b < 3; b++) {
                                     // Backspace com delay adequado entre cada para evitar conflito React
                                     await new Promise(resolve => requestAnimationFrame(resolve));
                                     editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
                                     document.execCommand('delete', false, null);
                                     await this.dynamicSleep([100, 200]);
                                 }
                                 
                                 await this.dynamicSleep([150, 250]);
                             }
                             // --- FIM DA CORREÇÃO ---
                         }

                    } else if (seg.type === 'voice') {
                             await this.openAtSelector(); 
                             await this.clickDialogTab('voice');
                             await this.searchAndSelectVoice(seg.name); 
                             await this.dynamicSleep(CONFIG.DELAY_SHORT);
                        }
                    }
                    await this.clickSubmit();
                    this.logDebug(`Prompt ${promptObj.promptNum} enviado ✅`, 'success');
                    return true;
                } catch (err) {
                    this.logDebug(`⚠️ Erro no prompt ${promptObj.promptNum}: ${err.message} — ${attempt < MAX_SUBMIT_RETRIES ? 'resetando editor...' : 'falha definitiva'}`, 'error');

                    // Detecta crash do Flow e tenta recuperar
                    if (this.isFlowCrashed()) {
                        this.logDebug('🔴 Flow crashou! Salvando estado e recarregando em 3s...', 'error');
                        this.saveRunState(promptObj.promptNum);
                        await this.sleep(3000);
                        location.reload();
                        return false;
                    }

                    if (attempt < MAX_SUBMIT_RETRIES) {
                        await this.resetEditor();
                        await this.dynamicSleep([2000, 3000]);
                    }
                }
            }
            return false;
        }

        /**
         * Força reset do editor: fecha dialogs, limpa conteúdo via botão "Apagar comando".
         */
        async resetEditor() {
            // 0. Se o Flow crashou, não tenta nada — precisa recarregar
            if (this.isFlowCrashed()) {
                this.logDebug('⚠️ Flow crashou — resetEditor abortado. Recarregue a página.', 'error');
                return;
            }

            // 1. Fecha qualquer dialog aberto (seletor @)
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (dialog) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                await this.sleep(500);
            }

            // 2. Escreve algo no editor para garantir que o botão X fica disponível
            const editor = this.getEditor();
            if (editor) {
                editor.focus();
                await this.sleep(200);
                await new Promise(resolve => requestAnimationFrame(resolve));
                editor.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true,
                    inputType: 'insertText', data: ' reset'
                }));
                await this.sleep(500);
            }

            // 3. Clica no botão "Apagar comando" (ícone close)
            const closeBtn = [...document.querySelectorAll('button')].find(btn => {
                const icon = btn.querySelector('i.google-symbols');
                if (!icon || icon.textContent.trim() !== 'close') return false;
                return btn.textContent.includes('Apagar') || btn.querySelector('span')?.textContent?.includes('Apagar');
            });
            if (closeBtn) {
                closeBtn.click();
                this.logDebug('Editor resetado via botão Apagar', 'info');
                await this.sleep(800);
            } else {
                // Fallback: selectAll + delete
                if (editor) {
                    editor.focus();
                    await this.sleep(200);
                    document.execCommand('selectAll', false, null);
                    await this.sleep(200);
                    document.execCommand('delete', false, null);
                    this.logDebug('Editor resetado via selectAll+delete', 'info');
                    await this.sleep(500);
                }
            }

            // 4. Fecha qualquer dialog que possa ter reaberto
            const dialog2 = document.querySelector('[role="dialog"], [role="presentation"]');
            if (dialog2) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                await this.sleep(400);
            }
        }

        // ──────────────────────────────────────────────
        // API (rename + favorite via HTTP)
        // ──────────────────────────────────────────────

        async apiRename(workflowId, newName) {
            if (!_authToken) { this.logDebug('Token não capturado — faça uma ação na página', 'error'); return false; }
            const projectId = this.getProjectId();
            if (!projectId || !workflowId) return false;
            try {
                const res = await _origFetch(`${CONFIG.API_BASE}/${workflowId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': _authToken },
                    body: JSON.stringify({
                        workflow: { name: workflowId, projectId, metadata: { displayName: newName } },
                        updateMask: 'metadata.displayName'
                    })
                });
                if (!res.ok) this.logDebug(`API rename falhou: ${res.status}`, 'error');
                return res.ok;
            } catch(e) { this.logDebug(`Erro API rename: ${e.message}`, 'error'); return false; }
        }

        async apiFavorite(workflowId, favorited) {
            if (!_authToken) return false;
            const projectId = this.getProjectId();
            if (!projectId || !workflowId) return false;
            try {
                const res = await _origFetch(`${CONFIG.API_BASE}/${workflowId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': _authToken },
                    body: JSON.stringify({
                        workflow: { name: workflowId, projectId, metadata: { favorited: !!favorited } },
                        updateMask: 'metadata.favorited'
                    })
                });
                return res.ok;
            } catch(e) { return false; }
        }

        // ──────────────────────────────────────────────
        // PIPELINE PRINCIPAL (sem rename automático)
        // ──────────────────────────────────────────────

        async start() {
            if (this.videoIsRunning) { this.setStatus('warning', '⚠️ A automação de vídeos está rodando. Aguarde finalizar.'); return; }
            let text = document.getElementById('flow-prompts-input').value;

            // Em modo referências: extrai nomes da primeira linha
            if (this.genMode === 'refs') {
                const parsed = parseReferenceHeader(text);
                if (!parsed.refs.length) {
                    this.setStatus('error', 'Modo Referências: a primeira linha deve conter nomes entre [colchetes]. Ex: [Maria][José][Praia]');
                    return;
                }
                this.refNames = parsed.refs;
                this.refAssignments = new Map();
                text = parsed.remaining;
                this.logDebug(`Referências detectadas: ${this.refNames.join(', ')}`, 'info');
            }

            this.prompts = parsePromptsText(text);
            if (!this.prompts.length) { this.setStatus('error', 'Nenhum prompt detectado.'); return; }

            // --- INJEÇÃO ADD-ON: Sistema "Retomar de" ---
            const resumeInput = document.getElementById('flow-start-from').value.trim();
            let resumeFrom = -1;
            if (resumeInput !== '') {
                resumeFrom = parseInt(resumeInput, 10);
            }

            // Valida referências nos prompts (não as da primeira linha)
            // Pula no modo 'refs' — ali estamos CRIANDO referências, não usando existentes
            if (this.genMode !== 'refs') {
                const refs = extractReferences(this.prompts);
                if (refs.length > 0) {
                    const unvalidated = refs.filter(r => this.validatedRefs[r.toLowerCase()] === undefined);
                    const missing     = refs.filter(r => this.validatedRefs[r.toLowerCase()] === false);
                    if (unvalidated.length) { this.setStatus('warning', 'Valide as referências antes de iniciar.'); return; }
                    if (missing.length)     { this.setStatus('error', `Referências não encontradas: ${missing.join(', ')}`); return; }
                }
            }

            // Em modo cenas: sceneCount = número de prompts (INJEÇÃO ADD-ON: Numeração Fiel)
            if (this.genMode === 'scenes') {
                this.sceneCount = this.prompts.length;
                this.sceneAssignments = new Map();
                for (let i = 0; i < this.prompts.length; i++) {
                    this.sceneAssignments.set(`Cena ${this.prompts[i].promptNum}`, []);
                }
            }

            this.isRunning = true;
            this.shouldStop = false;
            document.getElementById('flow-start-btn').disabled = true;
            document.getElementById('flow-stop-btn').disabled  = false;
            document.getElementById('flow-prompts-input').disabled = true;

            this.buildPromptList();
            this.setStatus('info', '🚀 Iniciando automação v4.0...');
            this.updateProgress(0);

            // --- INJEÇÃO ADD-ON: Regra do 0 ---
            if (resumeFrom === 0) {
                this.logDebug('Regra do 0: Marcando geração como concluída e abrindo painel de atribuição...', 'success');
                this.prompts.forEach((p, idx) => {
                    this.updatePromptItemStatus(idx, 'done', 'Concluído');
                });
                this.updateProgress(1);
                this.setStatus('success', '✅ Geração pulada. Atribua as imagens.');
                this.isRunning = false;
                document.getElementById('flow-start-btn').disabled = false;
                document.getElementById('flow-stop-btn').disabled  = true;
                document.getElementById('flow-prompts-input').disabled = false;
                if (this.genMode === 'scenes' || this.genMode === 'refs') {
                    this.showAssignPanel([]);
                }
                return;
            }

            // --- INJEÇÃO ADD-ON: Resume > 0 ---
            let promptsToProcess = this.prompts;
            if (resumeFrom > 0) {
                promptsToProcess = this.prompts.filter(p => p.promptNum >= resumeFrom);
                const skipped = this.prompts.filter(p => p.promptNum < resumeFrom);
                skipped.forEach(p => {
                    const idx = this.prompts.findIndex(x => x.promptNum === p.promptNum);
                    this.updatePromptItemStatus(idx, 'done', 'Concluído');
                });
                this.logDebug(`Retomando da cena/prompt ${resumeFrom}. ${skipped.length} prompts marcados como concluídos.`, 'info');
            }

            await this.detectGrid();

            const batches = [];
            // INJEÇÃO ADD-ON: Usando promptsToProcess em vez de this.prompts
            for (let i = 0; i < promptsToProcess.length; i += this.batchSize)
                batches.push(promptsToProcess.slice(i, Math.min(i + this.batchSize, promptsToProcess.length)));
            this.logDebug(`${promptsToProcess.length} prompts → ${batches.length} lote(s)`, 'info');

            const allMatrices = [];

            try {
                const N = this.imagesPerPrompt, C = this.gridCols;
                const retryCount = {};
                const deferredFailures = []; // prompts falhados para retentar no final
                let cumulativeRows = 0; // linhas totais de lotes anteriores

                for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                    if (this.shouldStop) break;
                    const batch = batches[bIdx];
                    const totalN = batch.length * N;
                    const rowsThis = Math.ceil(totalN / C);

                    batch.forEach(p => this.updatePromptItemStatus(
                        this.prompts.findIndex(x => x.promptNum === p.promptNum), 'active'
                    ));
                    this.updateProgress(bIdx / batches.length);
                    this.updateMini(
                        `Lote ${bIdx+1}/${batches.length}`,
                        batch.map(p => `#${p.promptNum}`).join(' + '),
                        bIdx / batches.length,
                        `${this.genMode === 'scenes' ? 'Cenas' : this.genMode === 'refs' ? 'Referências' : 'Livre'} • ${N} imgs/prompt • ${this.batchSize} simult.`
                    );
                    this.logDebug(`\n╭─── LOTE ${bIdx+1}/${batches.length}: prompts ${batch.map(p=>p.promptNum).join(', ')} ───╮`, 'info');

                    // 1. Snapshot
                    const beforeUuids = this.snapshotImageUuids();

                    // 2. Submit com stagger
                    this.setStatus('info', `⚡ Submetendo lote ${bIdx+1}/${batches.length}...`);
                    for (let pi = 0; pi < batch.length; pi++) {
                        if (this.shouldStop) break;
                        const ok = await this.prepareAndSubmit(batch[pi]);
                        if (!ok) break;
                        if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    if (this.shouldStop) break;
                    await this.dynamicSleep([1200, 1800]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    await this.waitForMatrix(matrix, beforeUuids);
                    if (this.shouldStop) break;

                    // 4. Retry falhas (parciais ou totais)
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        const loadedCount = slots.filter(s => s.state === 'loaded').length;
                        if (loadedCount < N) {
                            const missing = N - loadedCount;
                            this.logDebug(`⚠️ Prompt ${prompt.promptNum}: gerou ${loadedCount}/${N} (faltam ${missing})`, 'warning');
                            failedPrompts.push(prompt);
                        }
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        const gi = this.prompts.findIndex(x => x.promptNum === key);

                        // ── Deferred retry: guardar para o final ──
                        if (this.deferRetry) {
                            this.logDebug(`⏸️ Prompt ${key}: falhou — guardado para retentar no final`, 'warning');
                            this.updatePromptItemStatus(gi, 'retrying', 'adiado');
                            deferredFailures.push(fp);
                            continue;
                        }

                        // ── Retry imediato (comportamento original) ──
                        if (!retryCount[key]) retryCount[key] = 0;
                        let recovered = false;
                        const maxRetries = Number.isInteger(this.maxPromptRetries)
    ? this.maxPromptRetries
    : CONFIG.MAX_RETRIES;

while (retryCount[key] < maxRetries && !this.shouldStop) {
                            retryCount[key]++;
                            this.logDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updatePromptItemStatus(gi, 'retrying', `${retryCount[key]}/${maxRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updatePromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                break;
                            }
                        }
                        if (!recovered) this.updatePromptItemStatus(gi, 'error', `falhou`);
                    }

                    // Marca prompts do lote como done
                    batch.forEach(p => {
                        const gi = this.prompts.findIndex(x => x.promptNum === p.promptNum);
                        const slots = matrix.filter(s => s.promptNum === p.promptNum);
                        if (slots.some(s => s.state === 'loaded')) this.updatePromptItemStatus(gi, 'done');
                    });

                    allMatrices.push(matrix);

                    // ── Enum por bloco (se ativo) ──
                    const autoNameImages = document.getElementById('flow-auto-name-scenes')?.checked;
                    if (this.enumMode === 'block' && this.genMode === 'scenes' && autoNameImages && !this.shouldStop) {
                        if (this.approveBeforeEnum) {
                            // Pausa para aprovação
                            this.setStatus('info', `✅ Lote ${bIdx+1}/${batches.length} concluído. Aprovar enumeração?`);
                            const approved = await this.waitForBlockApproval(bIdx + 1, batches.length);
                            if (approved === 'stop') { this.shouldStop = true; break; }
                            if (approved === 'approve') {
                                await this.autoAssignScenesFromMatrices([matrix], { isVideo: false });
                            }
                            // 'skip' = não enumera, continua
                        } else {
                            await this.autoAssignScenesFromMatrices([matrix], { isVideo: false });
                        }
                    }

                    if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
                }

                // ══════ DEFERRED RETRY: retentar falhas acumuladas ══════
                if (deferredFailures.length > 0 && !this.shouldStop) {
                    this.logDebug(`\n╔═══ RETENTANDO ${deferredFailures.length} PROMPT(S) ADIADO(S) ═══╗`, 'info');
                    this.setStatus('info', `🔄 Retentando ${deferredFailures.length} prompt(s) que falharam...`);

                    const maxRetries = Number.isInteger(this.maxPromptRetries) ? this.maxPromptRetries : CONFIG.MAX_RETRIES;

                    for (let di = 0; di < deferredFailures.length && !this.shouldStop; di++) {
                        const fp = deferredFailures[di];
                        const key = fp.promptNum;
                        const gi = this.prompts.findIndex(x => x.promptNum === key);
                        let recovered = false;

                        this.setStatus('info', `🔄 Retry adiado ${di+1}/${deferredFailures.length} — Prompt ${key}`);

                        for (let attempt = 1; attempt <= maxRetries && !this.shouldStop; attempt++) {
                            this.logDebug(`🔄 Retry adiado: prompt ${key} — tentativa ${attempt}/${maxRetries}`, 'info');
                            this.updatePromptItemStatus(gi, 'retrying', `${attempt}/${maxRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updatePromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                this.logDebug(`✅ Prompt ${key} recuperado no retry adiado!`, 'success');
                                break;
                            }
                        }
                        if (!recovered) {
                            this.updatePromptItemStatus(gi, 'error', 'falhou');
                            this.logDebug(`❌ Prompt ${key} falhou mesmo após retries adiados`, 'error');
                        }
                        if (di < deferredFailures.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    this.logDebug(`╚═══ FIM DOS RETRIES ADIADOS ═══╝`, 'info');
                }

                if (!this.shouldStop) {
                    this.updateProgress(1);
                    const doneCount = document.querySelectorAll('.flow-prompt-item.done').length;
                    const errCount = document.querySelectorAll('.flow-prompt-item.error').length;
                    const failedList = this.prompts.filter((_, i) =>
                        document.querySelector(`.flow-prompt-item[data-index="${i}"]`)?.classList.contains('error')
                    );

                    let statusMsg = `✅ Geração concluída! ${doneCount} sucesso(s)`;
                    if (errCount) statusMsg += `, ${errCount} falha(s)`;
                    statusMsg += '.';
                    if (this.genMode !== 'free') statusMsg += ' Arraste os nomes para atribuir às imagens.';
                    this.setStatus('success', statusMsg);

// Mostra painel de atribuição / nomeia automaticamente (modo 'end')
if (this.genMode === 'refs') {
    this.showAssignPanel(allMatrices);
} else if (this.genMode === 'scenes') {
    this.showAssignPanel(allMatrices);

    // Só enumera no final se enumMode === 'end'
    if (this.enumMode === 'end') {
        const autoNameImages = document.getElementById('flow-auto-name-scenes')?.checked;
        if (autoNameImages) {
            await this.autoAssignScenesFromMatrices(allMatrices, { isVideo: false });
        }
    }
}
                    // Popup com detalhes de falhas
                    let popupMsg = `${doneCount} prompt(s) gerado(s) com sucesso.`;
                    if (this.genMode === 'refs') popupMsg += '\n\nArraste as referências do painel superior para as imagens desejadas.';
                    else if (this.genMode === 'scenes') popupMsg += '\n\nArraste as cenas do painel superior para as imagens desejadas.';

                    // Coleta mídias geradas nesta execução
                    this._lastRunMedia = allMatrices.flatMap(m =>
                        m.filter(s => s.state === 'loaded' && s.src).map(s => ({
                            src: s.src, workflowId: s.workflowId, uuid: s.uuid, promptNum: s.promptNum, isVideo: false
                        }))
                    );
                    this.showCompletionPopup(popupMsg, failedList.length > 0 ? failedList : null);
                } else {
                    this.setStatus('warning', '⏹ Automação interrompida.');
                }

            } catch (err) {
                this.setStatus('error', '❌ Erro: ' + err.message);
                log.error('Pipeline error:', err);
            }

            this.isRunning = false;
            this.clearRunState(); // Limpa estado de crash (processo terminou)
            document.getElementById('flow-start-btn').disabled = false;
            document.getElementById('flow-stop-btn').disabled  = true;
            document.getElementById('flow-prompts-input').disabled = false;
            document.getElementById('flow-mini').style.display = 'none';
            document.getElementById('flow-sidebar').style.display = '';
        }

        stop() { this.shouldStop = true; this.setStatus('warning', '⏹ Parando...'); }

        // ──────────────────────────────────────────────
        // VALIDAÇÃO DE REFERÊNCIAS
        // ──────────────────────────────────────────────
async renameUploadReferencesFromFilenames() {
    const btn = document.getElementById('flow-fix-upload-refs-btn');
    const originalText = btn?.textContent || '🧹 Corrigir uploads para referências';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Escaneando uploads...';
    }

    try {
        if (!_authToken) {
            this.setStatus('warning', 'Token ainda não capturado. Faça uma ação no Flow e tente novamente.');
            return;
        }

        const scroller = this.getScroller();
        if (!scroller) {
            this.setStatus('error', 'Scroller da galeria não encontrado.');
            return;
        }

        const checked = new Set();
        let renamed = 0;
        let skipped = 0;
        let failed = 0;
        let samePositionCount = 0;

        this.setStatus('info', '🧹 Corrigindo uploads para o padrão de referência...');
        this.logDebug('Iniciando correção reforçada de uploads para referências...', 'info');

        // Começa do final da galeria
        scroller.scrollTop = scroller.scrollHeight;
        await this.sleep(1200);

        for (let iter = 0; iter < 900; iter++) {
            const visibleTiles = [...document.querySelectorAll('[data-tile-id]')];

            const uniqueTiles = new Map();

            for (const el of visibleTiles) {
                const tile = el.querySelector('a[href*="/edit/"]') ? el : (el.querySelector('[data-tile-id]') || el);
                const workflowId = this.getWorkflowIdFromTile(tile);

                if (!workflowId) continue;
                if (uniqueTiles.has(workflowId)) continue;

                uniqueTiles.set(workflowId, tile);
            }

            for (const [workflowId, tile] of uniqueTiles.entries()) {
                if (checked.has(workflowId)) continue;
                checked.add(workflowId);

                if (!this.isTileLoaded(tile)) {
                    skipped++;
                    continue;
                }

                // Referências são imagens. Não mexe em vídeo.
                if (this.isVideoTile(tile)) {
                    skipped++;
                    continue;
                }

                const currentName = await this.getTileName(tile);
                const cleanName = this.cleanUploadReferenceName(currentName);

                if (!cleanName) {
                    skipped++;
                    continue;
                }

                const newName = cleanName + CONFIG.REF_SUFFIX;

                this.logDebug(`Renomeando referência: "${currentName}" → "${newName}"`, 'info');

                const okRename = await this.apiRename(workflowId, newName);
                const okFav = await this.apiFavorite(workflowId, true);

                if (okRename && okFav) {
                    renamed++;

                    const lowerKey = cleanName.toLowerCase().trim();
                    const refKey = this.referenceKey(cleanName);

                    this.validatedRefs[lowerKey] = true;
                    this.validatedRefs[refKey] = true;

                    this.refAssignments.set(cleanName, workflowId);
                    this.tileAssignments.set(workflowId, {
                        label: cleanName,
                        type: 'ref',
                        name: cleanName
                    });

                    const outer = tile.closest('[data-tile-id]') || tile;
                    this.addLabelToTile(outer, cleanName, workflowId, 'ref', cleanName);

                    this.logDebug(`✅ Referência pronta: ${cleanName}`, 'success');

                    if (btn) {
                        btn.textContent = `⏳ ${renamed} corrigida(s)...`;
                    }

                    await this.sleep(450);
                } else {
                    failed++;
                    this.logDebug(`❌ Falha ao renomear "${currentName}"`, 'error');
                }
            }

            const prev = Math.round(scroller.scrollTop);

            // Scroll mais forte e mais lento para a galeria virtualizada carregar os próximos cards
            const step = Math.max(180, Math.floor(scroller.clientHeight * 0.45));
            scroller.scrollTop = Math.max(0, scroller.scrollTop - step);

            await this.sleep(1000);

            const now = Math.round(scroller.scrollTop);

            if (now === prev) {
                samePositionCount++;
            } else {
                samePositionCount = 0;
            }

            // Chegou no topo e não anda mais
            if (now <= 0 && samePositionCount >= 2) break;
        }

        this.saveValidatedRefs();
        this.updateReferences();
        this.updateVideoReferences();

        if (renamed > 0) {
            this.startLabelObserver();
            this.setStatus(
                'success',
                `✅ ${renamed} referência(s) corrigida(s). ${failed ? `${failed} falha(s).` : ''}`
            );
        } else {
            this.setStatus(
                'warning',
                'Nenhum upload novo foi corrigido. Verifique se os cards estão carregados e se os nomes ainda não estavam no padrão de referência.'
            );
        }

        this.logDebug(
            `Correção finalizada: ${renamed} corrigido(s), ${skipped} ignorado(s), ${failed} falha(s), ${checked.size} tile(s) verificado(s).`,
            'info'
        );

    } catch (err) {
        this.setStatus('error', 'Erro ao corrigir uploads: ' + err.message);
        this.logDebug('Erro ao corrigir uploads: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}
        async validateReferences(source = 'images') {
            const isVideo = source === 'video';
            const btnId = isVideo ? 'fv-validate-btn' : 'flow-validate-btn';
            const inputId = isVideo ? 'fv-prompts-input' : 'flow-prompts-input';
            const statusFn = isVideo ? (t, m) => this.setVideoStatus(t, m) : (t, m) => this.setStatus(t, m);
            const updateFn = isVideo ? () => this.updateVideoReferences() : () => this.updateReferences();

            const btn = document.getElementById(btnId);
            btn.disabled = true; btn.textContent = '⏳ Escaneando galeria...';
            try {
               const text = document.getElementById(inputId).value;
const prompts = parsePromptsText(text);
const refs = extractReferences(prompts);

if (!refs.length) {
    updateFn();
    btn.disabled = false;
    btn.textContent = '🔍 Validar referências na galeria';
    return;
}

// Carrega cache salvo e mistura com o estado atual
this.validatedRefs = {
    ...this.loadValidatedRefs(),
    ...this.validatedRefs
};

// Se alguma referência já foi validada antes, ela não precisa ser escaneada de novo
const cachedFound = refs.filter(r =>
    this.validatedRefs[r.toLowerCase().trim()] === true ||
    this.validatedRefs[this.referenceKey(r)] === true
);

const pending = new Map();

for (const ref of refs) {
    const lowerKey = ref.toLowerCase().trim();
    const refKey = this.referenceKey(ref);

    const alreadyValid =
        this.validatedRefs[lowerKey] === true ||
        this.validatedRefs[refKey] === true;

    if (!alreadyValid) {
        pending.set(refKey, ref);
    }
}

const found = new Set(cachedFound.map(r => this.referenceKey(r)));

if (!pending.size) {
    updateFn();
    statusFn('success', `✅ Todas as ${refs.length} referências já estavam validadas!`);
    btn.disabled = false;
    btn.textContent = '🔍 Validar referências na galeria';
    return;
}
                const checkedTileIds = new Set();
                const scroller = this.getScroller();
                if (!scroller) throw new Error('Scroller não encontrado');
                scroller.scrollTop = scroller.scrollHeight; await this.sleep(600);
                for (let iter = 0; iter < 200 && pending.size > 0; iter++) {
                    const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                    for (const tile of tiles) {
                        if (!pending.size) break;
                        const id = tile.getAttribute('data-tile-id');
                        if (checkedTileIds.has(id)) continue;
                        checkedTileIds.add(id);
                        const name = await this.getTileName(tile);
                        if (!name) continue;
                        const lc = this.referenceKey(name);

if (pending.has(lc)) {
    const originalName = pending.get(lc);
    pending.delete(lc);
    found.add(lc);

    btn.textContent = `⏳ ${found.size}/${refs.length}`;
    const wfId = this.getWorkflowIdFromTile(tile);
                            if (wfId) {
                                const outer = tile.closest('[data-tile-id]') || tile;
                                this.tileAssignments.set(wfId, { label: originalName, type: 'ref', name: originalName });
                                this.addLabelToTile(outer, originalName, wfId, 'ref', originalName);
                            }
                        }
                    }
                    const prev = scroller.scrollTop;
                    scroller.scrollTop = Math.max(0, scroller.scrollTop - 350); await this.sleep(400);
                    if (scroller.scrollTop === 0 && prev === 0) break;
                }
              for (const ref of refs) {
    const lowerKey = ref.toLowerCase().trim();
    const refKey = this.referenceKey(ref);

    if (found.has(refKey)) {
        this.validatedRefs[lowerKey] = true;
        this.validatedRefs[refKey] = true;
    } else {
        this.validatedRefs[lowerKey] = false;
        this.validatedRefs[refKey] = false;
    }
}

this.saveValidatedRefs();
updateFn();
                if (!pending.size) statusFn('success', `✅ Todas as ${refs.length} referências encontradas!`);
                else statusFn('error', `❌ Não encontradas: ${[...pending.values()].join(', ')}`);
                scroller.scrollTop = 0;
                if (found.size > 0) this.startLabelObserver();
            } catch (err) { statusFn('error', 'Erro: ' + err.message); }
            btn.disabled = false; btn.textContent = '🔍 Validar referências na galeria';
        }

       async getTileName(tile) {
    tile.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
    tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles:true }));
    await this.sleep(350);

    const UI = [
        'favorite','redo','more_vert','image','warning','refresh','delete_forever','undo',
        'play_arrow','pause','download',
        'Adicionar aos favoritos','Reutilizar comando','Mais',
        'Add to favorites','Reuse prompt','More',
        'Falha','Ops!','Tentar novamente','Excluir',
        'Failed','Oops!','Retry','Delete'
    ];

    let nome = null;

    for (let t = 0; t < 5; t++) {
        for (const div of tile.querySelectorAll('div')) {
            // Ignora labels visuais criadas pela própria extensão
            if (div.closest('.flow-tile-label')) continue;
            if (div.closest('.flow-assign-item')) continue;

            const text = div.textContent?.trim();

            if (!text || text.length < 1 || text.length > 80) continue;
            if ([...div.querySelectorAll('div')].some(c => c.textContent?.trim())) continue;
            if (div.querySelector('i, svg, button')) continue;
            if (UI.some(u => text === u)) continue;

            nome = text;
            break;
        }

        if (nome) break;
        await this.sleep(100);
    }

    tile.dispatchEvent(new MouseEvent('mouseleave', { bubbles:true }));
    tile.dispatchEvent(new MouseEvent('mouseout', { bubbles:true }));
    await this.sleep(80);

    return nome;
}

        // ──────────────────────────────────────────────
        // PAINEL DE ATRIBUIÇÃO (Drag & Drop)
        // ──────────────────────────────────────────────
        getSceneVariationCountsFromMatrices(allMatrices) {
    const counts = new Map();
    const seen = new Set();

    const slots = (allMatrices || [])
        .flatMap(m => Array.isArray(m) ? m : [])
        .filter(Boolean);

    for (const slot of slots) {
        if (slot.state !== 'loaded') continue;

        const sceneNum = Number(slot.promptNum || 0);
        if (!sceneNum) continue;

        const uniqueKey =
            slot.workflowId ||
            slot.uuid ||
            slot.src ||
            `${slot.row}:${slot.col}:${slot.promptNum}:${slot.imgNum}`;

        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        counts.set(sceneNum, (counts.get(sceneNum) || 0) + 1);
    }

    return counts;
}

formatSceneNameWithVariationCount(sceneName, variationCounts) {
    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
    const count = variationCounts?.get(sceneNum) || 0;

    return `${sceneName} (${count})`;
}

        // ──────────────────────────────────────────────
        // ADD-ON: ENUMERAÇÃO AUTOMÁTICA (renomear pelo início do prompt)
        // ──────────────────────────────────────────────

        /** Núcleo: limpa um texto (prompt ou nome do Flow) para virar um nome curto. */
        cleanPromptToName(text) {
            let base = (text || '').trim();
            base = base.replace(/^\{[^}]*\}\s*/, '');        // remove {cena X}
            base = base.replace(/^\s*\d+\s*[\-.):]\s*/, '');  // remove "11-" / "11." / "11)"
            base = base.replace(/\[[^\]]*\]/g, ' ');          // remove [ref]
            base = base.replace(/<voz:[^>]*>/gi, ' ');        // remove <voz:...>
            base = base.replace(/\s+/g, ' ').trim();
            const words = base.split(' ').filter(Boolean).slice(0, 8).join(' ');
            return words.substring(0, 50).trim();
        }

        /** Deriva o nome a partir do início do prompt (compat.). */
        promptStartName(prompt, imgNum) {
            const clean = this.cleanPromptToName(prompt?.text) || `Cena ${prompt?.promptNum ?? ''}`.trim();
            return imgNum ? `${clean} ${imgNum}` : clean;
        }

        /** Palavras significativas de um texto (para comparar título x prompt). */
        _sigWords(s) {
            const combining = new RegExp('[\\u0300-\\u036f]', 'g'); // acentos (só-ASCII no source)
            return (s || '').toLowerCase()
                .normalize('NFD').replace(combining, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/).filter(w => w.length > 2);
        }

        /** Acha, entre os prompts que você enviou, o mais parecido com o título da mídia (coef. de Dice). */
        matchPromptForTitle(title, prompts) {
            const tw = new Set(this._sigWords(title));
            if (!tw.size) return null;
            let best = null, bestScore = 0;
            for (const p of prompts) {
                const pw = this._sigWords(this.cleanPromptToName(p.text) || p.text);
                if (!pw.length) continue;
                let hit = 0; const seen = new Set();
                for (const w of pw) { if (tw.has(w) && !seen.has(w)) { hit++; seen.add(w); } }
                const score = (2 * hit) / (pw.length + tw.size);  // Dice
                if (score > bestScore) { bestScore = score; best = p; }
            }
            return bestScore >= 0.34 ? best : null;
        }

        /**
         * Renomeia automaticamente todas as imagens geradas.
         * Funciona direto no DOM (não depende de rodada da sessão), então roda
         * em projetos JÁ FINALIZADOS: lê o nome (=prompt) de cada imagem, agrupa
         * as variações da mesma cena e renomeia numerando.
         */
        async autoEnumerarCenas() {
            const buttons = ['flow-assign-auto', 'flow-auto-enumerate-btn'].map(id => document.getElementById(id)).filter(Boolean);
            buttons.forEach(b => b.disabled = true);

            try {
                // Mapa EXATO da rodada (fallback pra mídias cujo prompt não seja legível no DOM)
                const exactByWf = new Map();
                for (const slot of (this._lastMatrices || []).flatMap(m => Array.isArray(m) ? m : [])) {
                    if (slot && slot.state === 'loaded' && slot.workflowId && slot.promptNum) {
                        exactByWf.set(slot.workflowId, String(slot.promptNum));
                    }
                }

                // COLETA varrendo a PÁGINA TODA. Para cada mídia, lê a CENA direto do
                // prompt guardado no tile ("97.2 - ..." -> cena 97.2). Confiável e exato.
                this.setStatus('info', '⚡ Varrendo a página...');
                const scroller = this.findFlowScroller();
                const scrollEl = scroller || document.scrollingElement || document.documentElement;
                if (scroller) scroller.scrollTop = 0; else window.scrollTo(0, 0);
                await this.sleep(600);

                const collected = [];      // ordem de aparição (topo -> baixo)
                const seen = new Set();
                let guard = 0, stuck = 0;
                while (guard++ < 500) {
                    for (const link of document.querySelectorAll('a[href*="/edit/"]')) {
                        const tile = link.closest('[data-tile-id]');
                        if (!tile) continue;
                        const wf = this.getWorkflowIdFromTile(tile);
                        if (!wf || seen.has(wf)) continue;
                        if (!this.isTileLoaded(tile)) continue;
                        seen.add(wf);
                        const isVid = this.isVideoTile(tile);
                        const sceneNum = this.sceneNumFromTile(tile) || exactByWf.get(wf) || null;
                        collected.push({ wf, isVid, sceneNum });
                        this.setStatus('info', `⚡ Varrendo... ${collected.length} mídias`);
                    }
                    const before = scrollEl.scrollTop;
                    scrollEl.scrollTop = before + Math.max(300, Math.floor(scrollEl.clientHeight * 0.8));
                    await this.sleep(450);
                    const bottom = scrollEl.scrollTop <= before + 2 ||
                        (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4);
                    if (bottom) { if (++stuck >= 2) break; } else stuck = 0;
                }
                if (!collected.length) { this.setStatus('warning', 'Nenhuma mídia encontrada na página.'); return; }

                // Agrupa por CENA (o número lido do prompt) e numera as gerações (Vídeo/Imagem 1,2,...)
                const counters = new Map();
                const plan = [];  // {wf, sceneNum, g, isVid}
                let semCena = 0;
                for (const it of collected) {
                    if (it.sceneNum == null) { semCena++; continue; }
                    const g = (counters.get(it.sceneNum) || 0) + 1;
                    counters.set(it.sceneNum, g);
                    plan.push({ wf: it.wf, sceneNum: it.sceneNum, g, isVid: it.isVid });
                }
                if (!plan.length) {
                    this.setStatus('warning', 'Não consegui ler o número da cena nos prompts das mídias.');
                    return;
                }

                // Renomeia conforme o plano
                let done = 0, fail = 0, vids = 0, imgs = 0;
                for (const it of plan) {
                    const tipo = it.isVid ? 'Vídeo' : 'Imagem';
                    const newName = `Cena ${it.sceneNum} - ${tipo} ${it.g}`;
                    const ok = await this.apiRename(it.wf, newName);
                    await this.apiFavorite(it.wf, true);
                    if (ok) {
                        done++; if (it.isVid) vids++; else imgs++;
                        this.tileAssignments.set(it.wf, { label: newName, type: 'scene', scene: `Cena ${it.sceneNum}`, imgNum: it.g });
                        const link = document.querySelector(`a[href*="/edit/${it.wf}"]`);
                        const tile = link ? link.closest('[data-tile-id]') : null;
                        if (tile) this.addLabelToTile(tile, newName, it.wf, 'scene', `Cena ${it.sceneNum}`);
                        this.setStatus('info', `⚡ Renomeando... ${done}/${plan.length}`);
                    } else fail++;
                }

                this.startLabelObserver();
                const mediaWord = (vids && !imgs) ? 'vídeo(s)' : ((imgs && !vids) ? 'imagem(ns)' : 'mídia(s)');
                if (done === 0 && fail > 0) {
                    this.setStatus('error', 'Não consegui renomear (token não capturado?). Clique numa mídia e tente de novo.');
                } else {
                    this.setStatus('success', `⚡ ${counters.size} cena(s), ${done} ${mediaWord} renomeada(s)` +
                        (semCena ? `, ${semCena} sem número` : '') + (fail ? `, ${fail} falharam` : '') + '.');
                }
                this.logDebug(`Enumeração: ${counters.size} cenas, ${done} renomeadas, ${semCena} sem número, ${fail} falhas.`, done ? 'success' : 'error');
            } catch (err) {
                this.setStatus('error', 'Erro na enumeração automática: ' + (err?.message || err));
                this.logDebug('Erro autoEnumerarCenas: ' + (err?.message || err), 'error');
            } finally {
                buttons.forEach(b => b.disabled = false);
            }
        }

        /**
         * Lê o PROMPT completo guardado no tile (campo interno "subtitle" do React).
         * É onde fica o texto real do prompt, que começa com o número da cena
         * (ex: "97.2 - Reference set..."). Rápido: não precisa hover nem abrir o vídeo.
         */
        getPromptSubtitleFromTile(tile) {
            if (!tile) return null;
            const key = Object.keys(tile).find(k => k.startsWith('__reactFiber$'));
            let fiber = key ? tile[key] : null;
            let hops = 0;
            while (fiber && hops < 60) {
                hops++;
                for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
                    if (bag && typeof bag === 'object') {
                        const stack = [[bag, 0]]; let steps = 0;
                        while (stack.length && steps < 200) {
                            steps++;
                            const [o, d] = stack.pop();
                            if (!o || typeof o !== 'object' || d > 3) continue;
                            for (const k of Object.keys(o)) {
                                const v = o[k];
                                if (typeof v === 'string' && v.length > 20 &&
                                    (k === 'subtitle' || /^\s*\d+(?:\.\d+)?\s*[-.]\s/.test(v))) {
                                    return v;
                                } else if (v && typeof v === 'object') {
                                    stack.push([v, d + 1]);
                                }
                            }
                        }
                    }
                }
                fiber = fiber.return;
            }
            return null;
        }

        /** Número da cena lido do início do prompt do tile (ex: "97.2 - ..." -> "97.2"). */
        sceneNumFromTile(tile) {
            const sub = this.getPromptSubtitleFromTile(tile);
            if (!sub) return null;
            const m = sub.match(/^\s*(\d+(?:\.\d+)?)/);
            return m ? m[1] : null;
        }

        /** Número da cena a partir do prefixo "N-"/"N."/"N)" do prompt (fallback: promptNum). */
        sceneNumFromPrompt(p) {
            if (!p) return null;
            const m = (p.text || '').match(/^\s*(\d+(?:\.\d+)?)\s*[\-.):]/);
            if (m) return m[1];
            return (p.promptNum != null) ? String(p.promptNum) : null;
        }

        /** Acha o container de scroll do Flow (ignora os painéis da própria extensão). */
        findFlowScroller() {
            const els = [...document.querySelectorAll('div')].filter(el => {
                if (el.closest('[id^="flow-"]')) return false;                  // UI da extensão
                if ((el.className || '').toString().includes('flow-')) return false;
                const s = getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
            });
            els.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
            return els[0] || null;
        }

        /** Recolore os itens do painel conforme a meta (verde = concluída) e atualiza a contagem. */
        repaintCompletion() {
            const target = parseInt(document.getElementById('flow-imgs-per-prompt')?.value, 10) || 0;
            let complete = 0, totalScenes = 0;
            for (const item of document.querySelectorAll('.flow-assign-item[data-type="scene"]')) {
                totalScenes++;
                const sceneName = item.dataset.scene;
                const count = (this.sceneAssignments.get(sceneName) || []).length;
                const isComplete = target > 0 && count >= target;
                item.classList.toggle('complete', isComplete);
                item.classList.toggle('missing', count === 0);
                if (isComplete) complete++;
                const status = item.querySelector('.assign-status');
                if (status) status.textContent = isComplete ? '✅' : (count > 0 ? `${count}/${target || '?'}` : '⏳');
            }
            const el = document.getElementById('flow-assign-count');
            if (el && totalScenes) el.textContent = `${complete}/${totalScenes} concluídas`;
        }

        showAssignPanel(allMatrices) {
            this._videoAssignActive = false;
            const panel = document.getElementById('flow-assign-panel');
            const title = document.getElementById('flow-assign-title');
            const items = document.getElementById('flow-assign-items');
            const dlBtn = document.getElementById('flow-assign-download');
            const variationCounts = this.getSceneVariationCountsFromMatrices(allMatrices);
            this._lastMatrices = allMatrices || [];   // ADD-ON: usado pela Enumeração Automática
            const autoBtn = document.getElementById('flow-assign-auto');
            if (autoBtn) autoBtn.style.display = 'inline-flex'; // ADD-ON: sempre disponível (funciona no DOM)

            items.innerHTML = '';

            if (this.genMode === 'refs') {
                title.textContent = 'Atribuir Referências';
                const previewEl = document.getElementById('flow-assign-preview');
                if (previewEl) previewEl.style.display = 'none';
                const rlBar = document.getElementById('flow-assign-reload-bar');
                if (rlBar) rlBar.classList.remove('visible');
                dlBtn.style.display = 'none';
                for (const name of this.refNames) {
                    const item = document.createElement('div');
                    item.className = 'flow-assign-item';
                    item.draggable = true;
                    item.dataset.type = 'ref';
                    item.dataset.name = name;
                    item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(name)}</span><span class="assign-status">⏳</span>`;
                    item.addEventListener('dragstart', e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'ref', name }));
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    items.appendChild(item);
                }
            } else if (this.genMode === 'scenes') {
                title.textContent = 'Atribuir Cenas';
                const previewEl = document.getElementById('flow-assign-preview');
                if (previewEl) { previewEl.style.display = 'none'; }
                dlBtn.style.display = 'inline-flex';
                const rlBar2 = document.getElementById('flow-assign-reload-bar'); if (rlBar2) rlBar2.classList.remove('visible');
                
                // INJEÇÃO ADD-ON: Numeração Fiel
                for (const [sceneName] of this.sceneAssignments) {
                    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                    const prompt = this.prompts.find(p => p.promptNum === sceneNum);
                    const promptText = prompt?.text || '';

                    const item = document.createElement('div');
                    item.className = 'flow-assign-item';
                    item.draggable = true;
                    item.dataset.type = 'scene';
                    item.dataset.scene = sceneName;
                    item.dataset.sceneNum = sceneNum;
                    const displaySceneName = this.formatSceneNameWithVariationCount(sceneName, variationCounts);
                    // ADD-ON: cor por meta variável (verde = atingiu "Imagens por prompt"; apagado = nenhuma)
                    {
                        const _gen = variationCounts.get(sceneNum) || 0;
                        const _target = parseInt(document.getElementById('flow-imgs-per-prompt')?.value, 10) || 0;
                        if (_target > 0 && _gen >= _target) item.classList.add('complete');
                        else if (_gen === 0) item.classList.add('missing');
                    }

item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(displaySceneName)}</span><span class="assign-status">⏳</span>`;
item.title = `${sceneName}: ${variationCounts.get(sceneNum) || 0} variação(ões) encontrada(s)`;
                    item.addEventListener('mouseenter', () => {
                        const preview = document.getElementById('flow-assign-preview');
                        if (preview) {
                            preview.style.display = '';
                            preview.querySelector('.preview-label').textContent = sceneName + ': ';
                            preview.querySelector('.preview-text').textContent = promptText.substring(0, 300) + (promptText.length > 300 ? '...' : '');
                        }
                    });
                    item.addEventListener('mouseleave', () => {
                        const preview = document.getElementById('flow-assign-preview');
                        if (preview) preview.style.display = 'none';
                    });
                    item.addEventListener('dragstart', e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'scene', sceneNum, sceneName }));
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    items.appendChild(item);
                }
            }

            panel.classList.add('active');
            panel.classList.remove('minimized');
            document.getElementById('flow-assign-toggle').textContent = '▲';
            const reopenBtn = document.getElementById('flow-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            this.updateAssignCount();
            this.updateScrollerPadding();
        }

        hideAssignPanel() {
            document.getElementById('flow-assign-panel').classList.remove('active');
            // Mostra o botão reopen correto
            if (this._videoAssignActive) {
                const reopenBtn = document.getElementById('fv-reopen-assign');
                if (reopenBtn) reopenBtn.style.display = '';
            } else {
                const reopenBtn = document.getElementById('flow-reopen-assign');
                if (reopenBtn) reopenBtn.style.display = '';
            }
            this.updateScrollerPadding();
        }

        reopenAssignPanel() {
            document.getElementById('flow-assign-panel').classList.add('active');
            const reopenBtn = document.getElementById('flow-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            const fvReopenBtn = document.getElementById('fv-reopen-assign');
            if (fvReopenBtn) fvReopenBtn.style.display = 'none';
            this.updateScrollerPadding();
        }

        /** Abre painel de atribuição com referências detectadas nos prompts */
        openAssignRefsFromDetected() {
            const text = document.getElementById('flow-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs = extractReferences(prompts);
            if (!refs.length) { this.setStatus('warning', 'Nenhuma referência [nome] detectada nos prompts.'); return; }
            this.genMode = 'refs';
            this.refNames = refs;
            this.refAssignments = new Map();
            document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
            const refsBtn = document.querySelector('.flow-mode-btn[data-mode="refs"]');
            if (refsBtn) refsBtn.classList.add('active');
            const descEl = document.getElementById('flow-mode-desc');
            if (descEl) descEl.textContent = 'Arraste cada referência para a imagem desejada.';
            this.showAssignPanel([]);
        }

        /** Abre painel de atribuição com referências detectadas nos prompts de vídeo */
        openVideoAssignRefsFromDetected() {
            const text = document.getElementById('fv-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs = extractReferences(prompts);
            if (!refs.length) { this.setVideoStatus('warning', 'Nenhuma referência [nome] detectada nos prompts de vídeo.'); return; }
            this.genMode = 'refs';
            this._videoAssignActive = true;
            this.refNames = refs;
            this.refAssignments = new Map();
            document.querySelectorAll('[data-vmode]').forEach(b => b.classList.remove('active'));
            this.showAssignPanel([]);
        }

        toggleAssignPanel() {
            const panel = document.getElementById('flow-assign-panel');
            const toggle = document.getElementById('flow-assign-toggle');
            panel.classList.toggle('minimized');
            toggle.textContent = panel.classList.contains('minimized') ? '▼' : '▲';
            toggle.classList.toggle('collapsed', panel.classList.contains('minimized'));
            this.updateScrollerPadding();
        }

        /**
         * Ajusta padding-top do scroller da galeria para que a primeira
         * linha de imagens não fique escondida atrás do painel de atribuição.
         */
        updateScrollerPadding() {
            setTimeout(() => {
                const panel = document.getElementById('flow-assign-panel');
                const scroller = this.getScroller();
                if (!scroller) return;

                const isVisible = panel.classList.contains('active') && !panel.classList.contains('minimized');
                if (isVisible) {
                    const panelHeight = panel.getBoundingClientRect().height;
                    scroller.style.paddingTop = (panelHeight + 8) + 'px';
                } else {
                    scroller.style.paddingTop = '';
                }
            }, 60);
        }

        updateAssignCount() {
            const el = document.getElementById('flow-assign-count');
            if (this.genMode === 'refs' && !this._videoAssignActive) {
                const total = this.refNames.length;
                const done = [...this.refAssignments.values()].filter(Boolean).length;
                el.textContent = `${done}/${total}`;
                const rlBar = document.getElementById('flow-assign-reload-bar');
                if (done >= total && total > 0) {
                    if (rlBar) rlBar.classList.add('visible');
                    this.setStatus('success', '✅ Todas as referências atribuídas! Atualize a página.');
                } else {
                    if (rlBar) rlBar.classList.remove('visible');
                }
            } else if (this._videoAssignActive) {
                // Vídeo scenes
                const total = this.videoSceneAssignments.size;
                const done = [...this.videoSceneAssignments.values()].filter(arr => arr.length > 0).length;
                el.textContent = `${done}/${total}`;
                const dlBtn = document.getElementById('flow-assign-download');
            } else if (this.genMode === 'scenes') {
                const total = this.sceneAssignments.size; // INJEÇÃO ADD-ON: Numeração Fiel
                const done = [...this.sceneAssignments.values()].filter(arr => arr.length > 0).length;
                el.textContent = `${done}/${total}`;
                const dlBtn = document.getElementById('flow-assign-download');
            }
        }

        // ──────────────────────────────────────────────
        // DRAG & DROP (event delegation no scroller)
        // ──────────────────────────────────────────────

        setupDragDrop() {
            // Usa delegação global — tiles são virtualizados
            document.addEventListener('dragover', e => {
                const tile = e.target.closest('[data-tile-id]');
                if (tile) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    // Highlight só no tile que tem imagem
                    const inner = tile.querySelector('[data-tile-id]') || tile;
                    document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
                    inner.classList.add('drop-hover');
                }
            });

            document.addEventListener('dragleave', e => {
                // Só remove se saiu do tile completamente
                const related = e.relatedTarget?.closest('[data-tile-id]');
                const current = e.target.closest('[data-tile-id]');
                if (current && current !== related) current.classList.remove('drop-hover');
            });

            document.addEventListener('drop', async e => {
                const tile = e.target.closest('[data-tile-id]');
                if (tile) tile.classList.remove('drop-hover');
                if (!tile) return;
                e.preventDefault();

                let data;
                try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
                if (!data?.type) return;

                // Encontra inner tile (com imagem) e outer tile (para label)
                const innerTile = tile.querySelector('[data-tile-id]') || tile;
                const workflowId = this.getWorkflowIdFromTile(innerTile);
                const outerTile = tile;
                document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
                if (!workflowId) { this.logDebug('Drop: workflowId não encontrado', 'error'); return; }

                if (data.type === 'ref') {
                    await this.assignReference(data.name, workflowId, outerTile);
                } else if (data.type === 'scene') {
                    await this.assignScene(data.sceneNum, data.sceneName, workflowId, outerTile);
                }
            });

            // Click handler para labels X (delegação)
            document.addEventListener('click', async e => {
                const xBtn = e.target.closest('.label-x');
                if (!xBtn) return;
                const label = xBtn.closest('.flow-tile-label');
                if (!label) return;
                const wfId = label.dataset.wf;
                const type = label.dataset.type;
                if (!wfId) return;

                // Remove atribuição
                await this.apiRename(wfId, 'Imagem gerada');
                await this.apiFavorite(wfId, false);
                label.remove();

                if (type === 'ref') {
                    const name = label.dataset.name;
                    this.refAssignments.delete(name);
                    this.updateAssignItemUI(name, false);
                } else if (type === 'scene') {
                    const sceneName = label.dataset.scene;
                    const arr = this.sceneAssignments.get(sceneName);
                    if (arr) {
                        const idx = arr.findIndex(a => a.workflowId === wfId);
                        if (idx >= 0) arr.splice(idx, 1);
                    }
                    // Atualiza UI do item no painel
                    this.updateAssignItemUI(sceneName, (arr?.length || 0) > 0);
                }
                this.tileAssignments.delete(wfId);
                this.updateAssignCount();
                this.logDebug(`Removida atribuição de ${wfId}`, 'info');
            });
        }
        // ── Pause for block approval ──
        waitForBlockApproval(blockNum, totalBlocks) {
            return new Promise(resolve => {
                const statusEl = document.getElementById('flow-status');
                if (!statusEl) return resolve('approve');

                // Create approval buttons
                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
                btnContainer.innerHTML = `
                    <button id="flow-approve-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;font-weight:600;font-size:12px;cursor:pointer;">✅ Aprovar e Enumerar</button>
                    <button id="flow-skip-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-weight:600;font-size:12px;cursor:pointer;">⏭️ Pular</button>
                    <button id="flow-stop-approve-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;font-weight:600;font-size:12px;cursor:pointer;">⏹ Parar</button>
                `;
                statusEl.appendChild(btnContainer);

                const cleanup = () => btnContainer.remove();

                document.getElementById('flow-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Lote ${blockNum} aprovado para enumeração`, 'success');
                    resolve('approve');
                });
                document.getElementById('flow-skip-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Lote ${blockNum} pulado (sem enumeração)`, 'info');
                    resolve('skip');
                });
                document.getElementById('flow-stop-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Automação parada pelo usuário no lote ${blockNum}`, 'warning');
                    resolve('stop');
                });
            });
        }
        // ── Pause for video block approval ──
        waitForVideoBlockApproval(blockNum, totalBlocks) {
            return new Promise(resolve => {
                const statusEl = document.getElementById('fv-status');
                if (!statusEl) return resolve('approve');

                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
                btnContainer.innerHTML = `
                    <button id="fv-approve-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;font-weight:600;font-size:12px;cursor:pointer;">✅ Aprovar e Enumerar</button>
                    <button id="fv-skip-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-weight:600;font-size:12px;cursor:pointer;">⏭️ Pular</button>
                    <button id="fv-stop-approve-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;font-weight:600;font-size:12px;cursor:pointer;">⏹ Parar</button>
                `;
                statusEl.appendChild(btnContainer);

                const cleanup = () => btnContainer.remove();

                document.getElementById('fv-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Lote ${blockNum} aprovado para enumeração`, 'success');
                    resolve('approve');
                });
                document.getElementById('fv-skip-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Lote ${blockNum} pulado (sem enumeração)`, 'info');
                    resolve('skip');
                });
                document.getElementById('fv-stop-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Automação parada pelo usuário no lote ${blockNum}`, 'warning');
                    resolve('stop');
                });
            });
        }

        async autoAssignScenesFromMatrices(allMatrices, options = {}) {
    const isVideo = !!options.isVideo;

    const assignments = isVideo ? this.videoSceneAssignments : this.sceneAssignments;
    const statusFn = isVideo
        ? (type, msg) => this.setVideoStatus(type, msg)
        : (type, msg) => this.setStatus(type, msg);

    const logFn = isVideo
        ? (msg, type) => this.logVideoDebug(msg, type)
        : (msg, type) => this.logDebug(msg, type);

    const mediaLabel = isVideo ? 'vídeo' : 'imagem';

    const slots = allMatrices
        .flatMap(m => Array.isArray(m) ? m : [])
        .filter(s => s && s.state === 'loaded' && s.workflowId)
        .sort((a, b) => {
            const pa = Number(a.promptNum || 0);
            const pb = Number(b.promptNum || 0);
            if (pa !== pb) return pa - pb;
            return Number(a.imgNum || 0) - Number(b.imgNum || 0);
        });

    if (!slots.length) {
        statusFn('warning', `Nenhuma ${mediaLabel} carregada para nomear automaticamente.`);
        return;
    }

    const previousVideoAssignState = this._videoAssignActive;
    this._videoAssignActive = isVideo;

    let assigned = 0;
    let failed = 0;
    const used = new Set();

    try {
        logFn(`Iniciando nomeação automática de ${slots.length} ${mediaLabel}(s).`, 'info');

        for (const slot of slots) {
            if ((isVideo && this.videoShouldStop) || (!isVideo && this.shouldStop)) break;
            if (!slot.workflowId || used.has(slot.workflowId)) continue;

            used.add(slot.workflowId);

            const sceneNum = Number(slot.promptNum || 0);
            if (!sceneNum) {
                failed++;
                continue;
            }

            const sceneName = `Cena ${sceneNum}`;
            if (!assignments.has(sceneName)) assignments.set(sceneName, []);

            const tile = await this.scrollToWorkflow(slot.workflowId);
            if (!tile) {
                failed++;
                logFn(`Tile não encontrado para ${slot.workflowId.substring(0, 8)}.`, 'error');
                continue;
            }

            await this.assignScene(sceneNum, sceneName, slot.workflowId, tile);
            assigned++;

            statusFn(
                'info',
                `🏷️ Nomeando ${mediaLabel}s automaticamente: ${assigned}/${slots.length}`
            );

            await this.sleep(500);
        }

        statusFn(
            'success',
            `✅ ${assigned} ${mediaLabel}(s) nomeada(s) automaticamente.${failed ? ` Falhas: ${failed}.` : ''}`
        );

        logFn(`✅ Nomeação automática concluída: ${assigned} sucesso(s), ${failed} falha(s).`, 'success');

    } finally {
        this._videoAssignActive = previousVideoAssignState;
    }
}

        // ──────────────────────────────────────────────
        // ATRIBUIR REFERÊNCIA
        // ──────────────────────────────────────────────

        async assignReference(name, workflowId, tileEl) {
            this.logDebug(`Atribuindo referência "${name}" → ${workflowId.substring(0,8)}...`, 'info');

            // Se esta referência já estava atribuída a outro tile: remove
            const prevWfId = this.refAssignments.get(name);
            if (prevWfId && prevWfId !== workflowId) {
                await this.apiRename(prevWfId, 'Imagem gerada');
                await this.apiFavorite(prevWfId, false);
                this.removeLabelFromTile(prevWfId);
                this.tileAssignments.delete(prevWfId);
            }

            // Se o tile destino já tinha outra atribuição: remove
            const prevAssign = this.tileAssignments.get(workflowId);
            if (prevAssign) {
                if (prevAssign.type === 'ref') this.refAssignments.delete(prevAssign.name);
                this.removeLabelFromTile(workflowId);
            }

            // Renomeia com sufixo " _"
            const apiName = name + CONFIG.REF_SUFFIX;
            const ok1 = await this.apiRename(workflowId, apiName);
            const ok2 = await this.apiFavorite(workflowId, true);

            if (ok1 && ok2) {
                this.refAssignments.set(name, workflowId);
                this.tileAssignments.set(workflowId, { label: name, type: 'ref', name });
                this.addLabelToTile(tileEl, name, workflowId, 'ref', name);
                this.updateAssignItemUI(name, true);
                this.updateAssignCount();
                this.startLabelObserver();
                this.logDebug(`✅ "${name}" atribuída`, 'success');
            } else {
                this.logDebug(`❌ Falha ao atribuir "${name}"`, 'error');
            }
        }

        // ──────────────────────────────────────────────
        // ATRIBUIR CENA
        // ──────────────────────────────────────────────

        async assignScene(sceneNum, sceneName, workflowId, tileEl) {
            const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
            const arr = assignments.get(sceneName) || [];
            const itemLabel = this._videoAssignActive ? 'Vídeo' : 'Imagem';
            const logFn = this._videoAssignActive ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);

            // Se tile já tem atribuição: sobrescreve
            const prevAssign = this.tileAssignments.get(workflowId);
            if (prevAssign) {
                if (prevAssign.type === 'scene') {
                    const prevArr = assignments.get(prevAssign.scene);
                    if (prevArr) {
                        const idx = prevArr.findIndex(a => a.workflowId === workflowId);
                        if (idx >= 0) prevArr.splice(idx, 1);
                    }
                    this.updateAssignItemUI(prevAssign.scene, (prevArr?.length || 0) > 0);
                } else if (prevAssign.type === 'ref') {
                    this.refAssignments.delete(prevAssign.name);
                    this.updateAssignItemUI(prevAssign.name, false);
                }
                this.removeLabelFromTile(workflowId);
            }

            const imgNum = arr.length + 1;
            const fullName = `Cena ${sceneNum} - ${itemLabel} ${imgNum}`;

            logFn(`Atribuindo "${fullName}" → ${workflowId.substring(0,8)}...`, 'info');

            const ok1 = await this.apiRename(workflowId, fullName);
            const ok2 = await this.apiFavorite(workflowId, true);

            if (ok1 && ok2) {
                arr.push({ imgNum, workflowId, src: this.getImgSrcFromTile(tileEl) || '' });
                assignments.set(sceneName, arr);
                this.tileAssignments.set(workflowId, { label: fullName, type: 'scene', scene: sceneName, imgNum });
                this.addLabelToTile(tileEl, fullName, workflowId, 'scene', sceneName);
                this.updateAssignItemUI(sceneName, true);
                this.updateAssignCount();
                this.startLabelObserver();
                logFn(`✅ "${fullName}" atribuída`, 'success');
            } else {
                logFn(`❌ Falha ao atribuir "${fullName}"`, 'error');
            }
        }

        // ──────────────────────────────────────────────
        // LABELS NOS TILES
        // ──────────────────────────────────────────────

        addLabelToTile(tileEl, text, workflowId, type, extraData) {
            // Remove label anterior se existir
            this.removeLabelFromTile(workflowId);

            // Encontra o outerTile para posicionar
            const outer = tileEl.closest('[data-tile-id]') || tileEl;
            outer.style.position = 'relative';

            const label = document.createElement('div');
            label.className = 'flow-tile-label';
            label.dataset.wf = workflowId;
            label.dataset.type = type;
            if (type === 'ref') label.dataset.name = extraData;
            if (type === 'scene') label.dataset.scene = extraData;
            label.innerHTML = `<span>${this.esc(text)}</span><button class="label-x" title="Remover">×</button>`;
            outer.appendChild(label);
        }

        removeLabelFromTile(workflowId) {
            document.querySelectorAll(`.flow-tile-label[data-wf="${workflowId}"]`).forEach(l => l.remove());
        }

        /**
         * Inicia polling que re-aplica labels em tiles visíveis.
         * Necessário porque o Virtuoso destrói/recria DOM ao scrollar.
         */
        startLabelObserver() {
            // Mostra seção de download se há atribuições
            const dlSection = document.getElementById('flow-download-section');
            if (dlSection && this.tileAssignments.size > 0) dlSection.style.display = '';
            if (this._labelObserverId) return;
            this._labelObserverId = setInterval(() => {
                if (this.tileAssignments.size === 0) return;
                const links = document.querySelectorAll('a[href*="/edit/"]');
                for (const link of links) {
                    const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                    if (!m) continue;
                    const wfId = m[1];
                    const data = this.tileAssignments.get(wfId);
                    if (!data) continue;
                    const tile = link.closest('[data-tile-id]');
                    if (!tile) continue;
                    if (tile.querySelector(`.flow-tile-label[data-wf="${wfId}"]`)) continue;
                    tile.style.position = 'relative';
                    const label = document.createElement('div');
                    label.className = 'flow-tile-label';
                    label.dataset.wf = wfId;
                    label.dataset.type = data.type;
                    if (data.type === 'ref') label.dataset.name = data.name || '';
                    if (data.type === 'scene') label.dataset.scene = data.scene || '';
                    label.innerHTML = `<span>${this.esc(data.label)}</span><button class="label-x" title="Remover">\u00d7</button>`;
                    tile.appendChild(label);
                }
            }, 600);
        }

        stopLabelObserver() {
            if (this._labelObserverId) { clearInterval(this._labelObserverId); this._labelObserverId = null; }
        }

        updateAssignItemUI(name, assigned) {
            const items = document.querySelectorAll('.flow-assign-item');
            for (const item of items) {
                const itemName = item.dataset.name || item.dataset.scene;
                if (itemName === name) {
                    item.classList.toggle('assigned', assigned);
                    const status = item.querySelector('.assign-status');
                    if (status) status.textContent = assigned ? '✅' : '⏳';
                }
            }
        }

        // ──────────────────────────────────────────────
        // DOWNLOAD DE CENAS
        // ──────────────────────────────────────────────

        async downloadScenes() {
            const btn = document.getElementById('flow-assign-download');
            btn.disabled = true; btn.textContent = '⏳ Baixando...';
            const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
            const ext = this._videoAssignActive ? 'mp4' : 'jpg';
            const logFn = this._videoAssignActive ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);
            let count = 0;
            try {
                for (const [sceneName, imgs] of [...assignments.entries()].sort((a,b) => {
                    const na = parseFloat(a[0].match(/[\d.]+/)?.[0] || 0);
                    const nb = parseFloat(b[0].match(/[\d.]+/)?.[0] || 0);
                    return na - nb;
                })) {
                    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                    const sorted = imgs.sort((a,b) => a.imgNum - b.imgNum);
                    for (let i = 0; i < sorted.length; i++) {
                        const fileName = i === 0 ? `cena_${sceneNum}.${ext}` : `cena_${sceneNum}_${i+1}.${ext}`;
                        // Tenta pegar src fresco do tile
                        let src = sorted[i].src;
                        if (!src) {
                            const link = document.querySelector(`a[href*="/edit/${sorted[i].workflowId}"]`);
                            if (link) {
                                const tile = link.closest('[data-tile-id]');
                                if (tile) src = this.getMediaSrcFromTile(tile);
                            }
                        }
                        if (!src) continue;
                        try {
                            const resp = await _origFetch(src);
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = fileName;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            count++; await this.sleep(400);
                        } catch(e) { logFn(`Erro download ${fileName}: ${e.message}`, 'error'); }
                    }
                }
                logFn(`✅ ${count} arquivo(s) baixado(s)`, 'success');
            } catch(e) { logFn(`Erro: ${e.message}`, 'error'); }
            btn.disabled = false; btn.textContent = '⬇️ Baixar Cenas';
        }

        // ──────────────────────────────────────────────
        // DOWNLOAD DE IMAGENS DO PROJETO
        // ──────────────────────────────────────────────

        /**
         * Baixa imagens do projeto com base no tileAssignments e/ou galeria.
         * @param {'identified'|'scenes'|'refs'|'all'} mode
         */
        async downloadProjectImages(mode) {
            const btnId = { identified: 'flow-dl-identified', scenes: 'flow-dl-scenes', refs: 'flow-dl-refs', all: 'flow-dl-all' }[mode] || { identified: 'fv-dl-identified', scenes: 'fv-dl-scenes', refs: 'fv-dl-refs', all: 'fv-dl-all' }[mode];
            const btn = document.getElementById(btnId);
            const origText = btn?.textContent;
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Baixando...'; }

            try {
                if (mode === 'all') {
                    // Baixa TODAS as imagens da galeria
                    await this.downloadAllGalleryImages(btn);
                } else {
                    // Baixa baseado no tileAssignments
                    if (this.tileAssignments.size === 0) {
                        this.setStatus('warning', 'Nenhuma imagem identificada. Execute "Analisar projeto" primeiro.');
                        if (btn) { btn.disabled = false; btn.textContent = origText; }
                        return;
                    }

                    const entries = [...this.tileAssignments.entries()].filter(([, data]) => {
                        if (mode === 'identified') return true;
                        if (mode === 'scenes') return data.type === 'scene';
                        if (mode === 'refs') return data.type === 'ref';
                        return false;
                    });

                    if (!entries.length) {
                        this.setStatus('warning', `Nenhuma ${mode === 'scenes' ? 'cena' : 'referência'} encontrada.`);
                        if (btn) { btn.disabled = false; btn.textContent = origText; }
                        return;
                    }

                    this.logDebug(`Baixando ${entries.length} arquivo(s) (${mode})...`, 'info');
                    let count = 0;
                    const pending = new Map(entries); // wfId → data
                    const scroller = this.getScroller();

                    if (scroller) {
                        scroller.scrollTop = 0;
                        await this.sleep(600);

                        // Scroll pela galeria procurando os tiles
                        for (let iter = 0; iter < 500 && pending.size > 0; iter++) {
                            const links = document.querySelectorAll('a[href*="/edit/"]');
                            for (const link of links) {
                                const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                                if (!m) continue;
                                const wfId = m[1];
                                const data = pending.get(wfId);
                                if (!data) continue;

                                const tile = link.closest('[data-tile-id]');
                                if (!tile || !this.isTileLoaded(tile)) continue;
                                const mediaSrc = this.getMediaSrcFromTile(tile);
                                if (!mediaSrc) continue;
                                const tileIsVideo = this.isVideoTile(tile);

                                let fileName;
                                if (data.type === 'scene') {
                                    const sm = data.label.match(/Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
                                    const ext = tileIsVideo ? 'mp4' : 'jpg';
                                    if (sm) fileName = parseInt(sm[2]) === 1 ? `cena_${sm[1]}.${ext}` : `cena_${sm[1]}_${sm[2]}.${ext}`;
                                    else fileName = `cena_${data.label.replace(/\s+/g, '_')}.${ext}`;
                                } else if (data.type === 'ref') {
                                    const clean = (data.name || data.label).replace(/ _$/, '').trim();
                                    fileName = `referencia_${clean.toLowerCase().replace(/\s+/g, '_')}.jpg`;
                                } else {
                                    const ext = tileIsVideo ? 'mp4' : 'jpg';
                                    fileName = `media_${wfId.substring(0, 8)}.${ext}`;
                                }

                                try {
                                    const resp = await _origFetch(mediaSrc);
                                    const blob = await resp.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url; a.download = fileName;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                    count++;
                                    pending.delete(wfId);
                                    if (btn) btn.textContent = `⏳ ${count}/${entries.length}...`;
                                    await this.sleep(400);
                                } catch(e) {
                                    this.logDebug(`Erro download ${fileName}: ${e.message}`, 'error');
                                }
                            }

                            if (pending.size === 0) break;
                            const prev = scroller.scrollTop;
                            scroller.scrollTop += 350;
                            await this.sleep(400);
                            if (scroller.scrollTop === prev) break;
                        }

                        scroller.scrollTop = 0;
                    }

                    this.logDebug(`✅ ${count}/${entries.length} arquivo(s) baixado(s)`, 'success');
                    this.setStatus('success', `✅ ${count} arquivo(s) baixado(s)!`);
                }
            } catch(e) {
                this.logDebug(`Erro: ${e.message}`, 'error');
            }

            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }

        /**
         * Baixa apenas as mídias geradas na última execução.
         * Usa o array _lastRunMedia que é populado no final de start() e startVideo().
         */
        async downloadLastRunMedia() {
            const media = this._lastRunMedia || [];
            if (!media.length) return;

            const btn = document.getElementById('flow-popup-download');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Baixando...'; }

            const scroller = this.getScroller();
            let count = 0;
            const pending = new Map(); // uuid → media item
            for (const item of media) {
                if (item.uuid) pending.set(item.uuid, item);
            }

            // Scroll pela galeria procurando os tiles
            if (scroller) {
                scroller.scrollTop = 0;
                await this.sleep(600);

                for (let iter = 0; iter < 500 && pending.size > 0; iter++) {
                    const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                    for (const tile of tiles) {
                        if (!this.isTileLoaded(tile)) continue;
                        const uuid = this.getUuidFromTile(tile);
                        const item = uuid ? pending.get(uuid) : null;
                        if (!item) continue;

                        const mediaSrc = this.getMediaSrcFromTile(tile);
                        if (!mediaSrc) continue;

                        const tileIsVideo = this.isVideoTile(tile);
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        const fileName = `${String(count + 1).padStart(4, '0')}.${ext}`;

                        try {
                            const resp = await _origFetch(mediaSrc);
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = fileName;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            count++;
                            pending.delete(uuid);
                            if (btn) btn.textContent = `⏳ ${count}/${media.length}...`;
                            await this.sleep(400);
                        } catch(e) {
                            this.logDebug(`Erro download ${fileName}: ${e.message}`, 'error');
                        }
                    }

                    if (pending.size === 0) break;
                    const prev = scroller.scrollTop;
                    scroller.scrollTop += 350;
                    await this.sleep(400);
                    if (scroller.scrollTop === prev) break;
                }
                scroller.scrollTop = 0;
            }

            this.logDebug(`✅ ${count}/${media.length} mídia(s) baixada(s)`, 'success');
            if (btn) { btn.disabled = false; btn.textContent = `✅ ${count} baixada(s)!`; }
        }

        async downloadAllGalleryImages(btn) {
            const scroller = this.getScroller();
            if (!scroller) { this.setStatus('error', 'Scroller não encontrado'); return; }

            const downloaded = new Set();
            let count = 0;
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 500; iter++) {
                // Itera por todos os tiles visíveis
                const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                for (const tile of tiles) {
                    if (!this.isTileLoaded(tile)) continue;
                    const uuid = this.getUuidFromTile(tile);
                    if (!uuid || downloaded.has(uuid)) continue;
                    downloaded.add(uuid);

                    const mediaSrc = this.getMediaSrcFromTile(tile);
                    if (!mediaSrc) continue;
                    const tileIsVideo = this.isVideoTile(tile);

                    // Determina nome baseado no tileAssignment se existir
                    const link = tile.querySelector('a[href*="/edit/"]');
                    const wfId = link?.href.match(/\/edit\/([a-f0-9-]{36})/)?.[1];
                    const data = wfId ? this.tileAssignments.get(wfId) : null;

                    let fileName;
                    if (data?.type === 'scene') {
                        const m = data.label.match(/Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        if (m) fileName = parseInt(m[2]) === 1 ? `cena_${m[1]}.${ext}` : `cena_${m[1]}_${m[2]}.${ext}`;
                        else fileName = `cena_${data.label.replace(/\s+/g, '_')}.${ext}`;
                    } else if (data?.type === 'ref') {
                        const clean = (data.name || data.label).replace(/ _$/, '').trim();
                        fileName = `referencia_${clean.toLowerCase().replace(/\s+/g, '_')}.jpg`;
                    } else {
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        fileName = `media_${count + 1}.${ext}`;
                    }

                    try {
                        const resp = await _origFetch(mediaSrc);
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = fileName;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        count++;
                        if (btn) btn.textContent = `⏳ ${count} baixada(s)...`;
                        await this.sleep(300);
                    } catch(e) { this.logDebug(`Erro: ${e.message}`, 'error'); }
                }

                const prev = scroller.scrollTop;
                scroller.scrollTop += 350;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break;
            }

            scroller.scrollTop = 0;
            this.logDebug(`✅ ${count} mídia(s) baixada(s) (completo)`, 'success');
            this.setStatus('success', `✅ Download completo: ${count} mídia(s)!`);
        }

        // ──────────────────────────────────────────────
        // ANALISAR PROJETO EXISTENTE
        // ──────────────────────────────────────────────

        async analyzeProject(source = 'images') {
            const isVideo = source === 'video';
            const btnId = isVideo ? 'fv-analyze-btn' : 'flow-analyze-btn';
            const dlSectionId = isVideo ? 'fv-download-section' : 'flow-download-section';
            const statusFn = isVideo ? (t, m) => this.setVideoStatus(t, m) : (t, m) => this.setStatus(t, m);
            const logFn = isVideo ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);

            const btn = document.getElementById(btnId);
            btn.disabled = true; btn.textContent = '⏳ Analisando...';
            logFn('Analisando projeto...', 'info');

            // Remove labels anteriores
            document.querySelectorAll('.flow-tile-label').forEach(l => l.remove());
            
            // INJEÇÃO ADD-ON: Limpa as memórias para evitar lixo do passado no Upscale
            this.tileAssignments.clear();
            if (isVideo) this.videoSceneAssignments.clear();
            else this.sceneAssignments.clear();
            this.refAssignments.clear();

            const scroller = this.getScroller();
            if (!scroller) { btn.disabled = false; btn.textContent = '🔍 Analisar projeto existente'; return; }

            let labelsFound = 0;
            const checkedIds = new Set();

            // Scroll do topo ao fundo
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 300; iter++) {
                const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                for (const tile of tiles) {
                    const tileId = tile.getAttribute('data-tile-id');
                    if (checkedIds.has(tileId)) continue;
                    checkedIds.add(tileId);

                    const name = await this.getTileName(tile);
                    if (!name) continue;

                    const wfId = this.getWorkflowIdFromTile(tile);
                    let labelText = null, type = null, extra = null, sceneMatch = null;

                    // Match "Cena X - Imagem Y" ou "Cena X - Vídeo Y"
                    sceneMatch = name.match(/^Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)$/i);
                    if (sceneMatch) {
                        labelText = name;
                        type = 'scene';
                        extra = `Cena ${sceneMatch[1]}`;
                    }
                    // Match referência (termina com " _")
                    else if (name.endsWith(CONFIG.REF_SUFFIX)) {
                        const cleanName = name.slice(0, -CONFIG.REF_SUFFIX.length);
                        labelText = cleanName;
                        type = 'ref';
                        extra = cleanName;
                    }

                    if (labelText && type && wfId) {
                        const outer = tile.closest('[data-tile-id]') || tile;
                        this.addLabelToTile(outer, labelText, wfId, type, extra);
                        this.tileAssignments.set(wfId, { label: labelText, type, name: extra, scene: extra });
                        
                        // INJEÇÃO ADD-ON: SINCRONIZA COM A MEMÓRIA DOS PAINÉIS / UPSCALE / DOWNLOAD
                        if (type === 'scene') {
                            const sceneName = extra;
                            const assignmentsMap = isVideo ? this.videoSceneAssignments : this.sceneAssignments;
                            if (!assignmentsMap.has(sceneName)) assignmentsMap.set(sceneName, []);
                            
                            const imgNum = sceneMatch ? parseInt(sceneMatch[2], 10) : 1;
                            assignmentsMap.get(sceneName).push({ imgNum, workflowId: wfId, src: this.getMediaSrcFromTile(tile) });
                        } else if (type === 'ref') {
                            this.refAssignments.set(extra, wfId);
                        }

                        labelsFound++;
                        btn.textContent = `⏳ ${labelsFound} encontrada(s)...`;
                    }
                }
                const prev = scroller.scrollTop;
                scroller.scrollTop += 350;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break;
            }

            scroller.scrollTop = 0; await this.sleep(300);
            if (labelsFound > 0) this.startLabelObserver();
            statusFn('success', `✅ Análise concluída: ${labelsFound} item(ns) identificado(s).`);
            logFn(`Análise: ${labelsFound} labels, ${checkedIds.size} tiles verificados`, 'success');
            const dlSection = document.getElementById(dlSectionId);
            if (dlSection) dlSection.style.display = '';
            btn.disabled = false; btn.textContent = '🔍 Analisar projeto existente';
        }

        // ──────────────────────────────────────────────
        // VIDEO PIPELINE
        // ──────────────────────────────────────────────

        async startVideo() {
            if (this.isRunning) { this.setVideoStatus('warning', '⚠️ A automação de imagens está rodando. Aguarde finalizar.'); return; }
            if (this.videoIsRunning) return;

            const text = document.getElementById('fv-prompts-input').value;
            this.videoPrompts = parsePromptsText(text);
            if (!this.videoPrompts.length) { this.setVideoStatus('error', 'Nenhum prompt detectado.'); return; }

            // --- INJEÇÃO ADD-ON: Sistema "Retomar de" ---
            const resumeInput = document.getElementById('fv-start-from').value.trim();
            let resumeFrom = -1;
            if (resumeInput !== '') {
                resumeFrom = parseInt(resumeInput, 10);
            }

            // Valida referências nos prompts
            const refs = extractReferences(this.videoPrompts);
            if (refs.length > 0) {
                const unvalidated = refs.filter(r => this.validatedRefs[r.toLowerCase()] === undefined);
                const missing     = refs.filter(r => this.validatedRefs[r.toLowerCase()] === false);
                if (unvalidated.length) { this.setVideoStatus('warning', 'Valide as referências antes de iniciar.'); return; }
                if (missing.length)     { this.setVideoStatus('error', `Referências não encontradas: ${missing.join(', ')}`); return; }
            }

            // Em modo cenas: sceneCount = número de prompts. (INJEÇÃO ADD-ON: Numeração Fiel)
            if (this.videoGenMode === 'scenes') {
                this.videoSceneCount = this.videoPrompts.length;
                this.videoSceneAssignments = new Map();
                for (let i = 0; i < this.videoPrompts.length; i++) {
                    this.videoSceneAssignments.set(`Cena ${this.videoPrompts[i].promptNum}`, []);
                }
            }

            this.videoIsRunning = true;
            this.videoShouldStop = false;
            document.getElementById('fv-start-btn').disabled = true;
            document.getElementById('fv-stop-btn').disabled  = false;
            document.getElementById('fv-prompts-input').disabled = true;

            this.buildVideoPromptList();
            this.setVideoStatus('info', '🚀 Iniciando automação de vídeos v4.0...');
            this.updateVideoProgress(0);

            // --- INJEÇÃO ADD-ON: Regra do 0 ---
            if (resumeFrom === 0) {
                this.logVideoDebug('Regra do 0: Marcando geração como concluída e abrindo painel de atribuição...', 'success');
                this.videoPrompts.forEach((p, idx) => {
                    this.updateVideoPromptItemStatus(idx, 'done', 'Pulado');
                });
                this.updateVideoProgress(1);
                this.setVideoStatus('success', '✅ Geração pulada. Atribua as cenas.');
                this.videoIsRunning = false;
                document.getElementById('fv-start-btn').disabled = false;
                document.getElementById('fv-stop-btn').disabled  = true;
                document.getElementById('fv-prompts-input').disabled = false;
                if (this.videoGenMode === 'scenes') {
                    this.showVideoAssignPanel([]);
                }
                return;
            }

            // --- INJEÇÃO ADD-ON: Resume > 0 ---
            let promptsToProcess = this.videoPrompts;
            if (resumeFrom > 0) {
                promptsToProcess = this.videoPrompts.filter(p => p.promptNum >= resumeFrom);
                const skipped = this.videoPrompts.filter(p => p.promptNum < resumeFrom);
                skipped.forEach(p => {
                    const idx = this.videoPrompts.findIndex(x => x.promptNum === p.promptNum);
this.updateVideoPromptItemStatus(idx, 'done', 'Concluído');
                });
                this.logVideoDebug(`Retomando da cena ${resumeFrom}. ${skipped.length} prompts marcados como concluídos.`, 'info');
            }

            await this.detectGrid();

            const N = this.videoResultsPerPrompt;
            const batches = [];
            // INJEÇÃO ADD-ON: Usando promptsToProcess em vez de this.prompts
            for (let i = 0; i < promptsToProcess.length; i += this.videoBatchSize)
                batches.push(promptsToProcess.slice(i, Math.min(i + this.videoBatchSize, promptsToProcess.length)));
            this.logVideoDebug(`${promptsToProcess.length} prompts → ${batches.length} lote(s)`, 'info');

            const allMatrices = [];

            try {
                const C = this.gridCols;
                const retryCount = {};
                const deferredFailures = []; // prompts falhados para retentar no final

                for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                    if (this.videoShouldStop) break;
                    const batch = batches[bIdx];
                    const totalN = batch.length * N;
                    const rowsThis = Math.ceil(totalN / C);

                    batch.forEach(p => this.updateVideoPromptItemStatus(
                        this.videoPrompts.findIndex(x => x.promptNum === p.promptNum), 'active'
                    ));
                    this.updateVideoProgress(bIdx / batches.length);
                    this.updateMini(
                        `Vídeo ${bIdx+1}/${batches.length}`,
                        batch.map(p => `#${p.promptNum}`).join(' + '),
                        bIdx / batches.length,
                        `${this.videoGenMode === 'scenes' ? 'Cenas' : 'Livre'} • ${N} resultado(s)/prompt • ${this.videoBatchSize} simult.`
                    );
                    this.logVideoDebug(`\n╭─── LOTE ${bIdx+1}/${batches.length}: prompts ${batch.map(p=>p.promptNum).join(', ')} ───╮`, 'info');

                    // 1. Snapshot
                    const beforeUuids = this.snapshotImageUuids();

                    // 2. Submit com stagger
                    this.setVideoStatus('info', `⚡ Submetendo lote ${bIdx+1}/${batches.length}...`);
                    for (let pi = 0; pi < batch.length; pi++) {
                        if (this.videoShouldStop) break;
                        const ok = await this.prepareAndSubmit(batch[pi]);
                        if (!ok) break;
                        if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    if (this.videoShouldStop) break;
                    await this.dynamicSleep([1200, 1800]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setVideoStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    // Override shouldStop temporariamente para usar videoShouldStop
                    const origShouldStop = this.shouldStop;
                    this.shouldStop = this.videoShouldStop;
                    await this.waitForMatrix(matrix, beforeUuids);
                    this.shouldStop = origShouldStop;
                    if (this.videoShouldStop) break;

                    // 4. Retry falhas (parciais ou totais)
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        const loadedCount = slots.filter(s => s.state === 'loaded').length;
                        if (loadedCount < N) {
                            const missing = N - loadedCount;
                            this.logVideoDebug(`⚠️ Prompt ${prompt.promptNum}: gerou ${loadedCount}/${N} (faltam ${missing})`, 'warning');
                            failedPrompts.push(prompt);
                        }
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === key);

                        // ── Deferred retry: guardar para o final ──
                        if (this.deferRetry) {
                            this.logVideoDebug(`⏸️ Prompt ${key}: falhou — guardado para retentar no final`, 'warning');
                            this.updateVideoPromptItemStatus(gi, 'retrying', 'adiado');
                            deferredFailures.push(fp);
                            continue;
                        }

                        // ── Retry imediato (comportamento original) ──
                        if (!retryCount[key]) retryCount[key] = 0;
                        let recovered = false;
                        const maxVideoRetries = Number.isInteger(this.videoMaxPromptRetries)
    ? this.videoMaxPromptRetries
    : CONFIG.MAX_RETRIES;

while (retryCount[key] < maxVideoRetries && !this.videoShouldStop) {
                            retryCount[key]++;
                            this.logVideoDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updateVideoPromptItemStatus(gi, 'retrying', `${retryCount[key]}/${maxVideoRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            this.shouldStop = this.videoShouldStop;
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            this.shouldStop = origShouldStop;
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updateVideoPromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                break;
                            }
                        }
                        if (!recovered) this.updateVideoPromptItemStatus(gi, 'error', `falhou`);
                    }

                    // Marca prompts do lote como done
                    batch.forEach(p => {
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === p.promptNum);
                        const slots = matrix.filter(s => s.promptNum === p.promptNum);
                        if (slots.some(s => s.state === 'loaded')) this.updateVideoPromptItemStatus(gi, 'done');
                    });

                    allMatrices.push(matrix);

                    // ── Enum por bloco (se ativo) ──
                    const autoNameVideos = document.getElementById('fv-auto-name-scenes')?.checked;
                    if (this.enumMode === 'block' && this.videoGenMode === 'scenes' && autoNameVideos && !this.videoShouldStop) {
                        if (this.approveBeforeEnum) {
                            this.setVideoStatus('info', `✅ Lote ${bIdx+1}/${batches.length} concluído. Aprovar enumeração?`);
                            const approved = await this.waitForVideoBlockApproval(bIdx + 1, batches.length);
                            if (approved === 'stop') { this.videoShouldStop = true; break; }
                            if (approved === 'approve') {
                                await this.autoAssignScenesFromMatrices([matrix], { isVideo: true });
                            }
                        } else {
                            await this.autoAssignScenesFromMatrices([matrix], { isVideo: true });
                        }
                    }

                    if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
                }

                // ══════ DEFERRED RETRY (Vídeos): retentar falhas acumuladas ══════
                if (deferredFailures.length > 0 && !this.videoShouldStop) {
                    this.logVideoDebug(`\n╔═══ RETENTANDO ${deferredFailures.length} PROMPT(S) ADIADO(S) ═══╗`, 'info');
                    this.setVideoStatus('info', `🔄 Retentando ${deferredFailures.length} prompt(s) que falharam...`);

                    const maxVideoRetries = Number.isInteger(this.videoMaxPromptRetries) ? this.videoMaxPromptRetries : CONFIG.MAX_RETRIES;

                    for (let di = 0; di < deferredFailures.length && !this.videoShouldStop; di++) {
                        const fp = deferredFailures[di];
                        const key = fp.promptNum;
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === key);
                        let recovered = false;

                        this.setVideoStatus('info', `🔄 Retry adiado ${di+1}/${deferredFailures.length} — Prompt ${key}`);

                        for (let attempt = 1; attempt <= maxVideoRetries && !this.videoShouldStop; attempt++) {
                            this.logVideoDebug(`🔄 Retry adiado: prompt ${key} — tentativa ${attempt}/${maxVideoRetries}`, 'info');
                            this.updateVideoPromptItemStatus(gi, 'retrying', `${attempt}/${maxVideoRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            const origShouldStop = this.shouldStop;
                            this.shouldStop = this.videoShouldStop;
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            this.shouldStop = origShouldStop;
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updateVideoPromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                this.logVideoDebug(`✅ Prompt ${key} recuperado no retry adiado!`, 'success');
                                break;
                            }
                        }
                        if (!recovered) {
                            this.updateVideoPromptItemStatus(gi, 'error', 'falhou');
                            this.logVideoDebug(`❌ Prompt ${key} falhou mesmo após retries adiados`, 'error');
                        }
                        if (di < deferredFailures.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    this.logVideoDebug(`╚═══ FIM DOS RETRIES ADIADOS ═══╝`, 'info');
                }

                if (!this.videoShouldStop) {
                    this.updateVideoProgress(1);
                    const doneCount = document.querySelectorAll('#fv-prompt-list .flow-prompt-item.done').length;
                    const errCount = document.querySelectorAll('#fv-prompt-list .flow-prompt-item.error').length;
                    const failedList = this.videoPrompts.filter((_, i) =>
                        document.querySelector(`#fv-prompt-list .flow-prompt-item[data-index="${i}"]`)?.classList.contains('error')
                    );

                    let statusMsg = `✅ Geração concluída! ${doneCount} sucesso(s)`;
                    if (errCount) statusMsg += `, ${errCount} falha(s)`;
                    statusMsg += '.';
                    if (this.videoGenMode === 'scenes') statusMsg += ' Arraste as cenas para atribuir aos vídeos.';
                    this.setVideoStatus('success', statusMsg);

                    // Mostra painel de atribuição / nomeia automaticamente (modo 'end')
if (this.videoGenMode === 'scenes') {
    this.showVideoAssignPanel(allMatrices);

    // Só enumera no final se enumMode === 'end'
    if (this.enumMode === 'end') {
        const autoNameVideos = document.getElementById('fv-auto-name-scenes')?.checked;
        if (autoNameVideos) {
            await this.autoAssignScenesFromMatrices(allMatrices, { isVideo: true });
        }
    }
}
                    // Popup com detalhes
                    let popupMsg = `${doneCount} prompt(s) de vídeo gerado(s) com sucesso.`;
                    if (this.videoGenMode === 'scenes') popupMsg += '\n\nArraste as cenas do painel superior para os melhores vídeos.';

                    // Coleta mídias geradas nesta execução
                    this._lastRunMedia = allMatrices.flatMap(m =>
                        m.filter(s => s.state === 'loaded' && s.src).map(s => ({
                            src: s.src, workflowId: s.workflowId, uuid: s.uuid, promptNum: s.promptNum, isVideo: true
                        }))
                    );
                    this.showCompletionPopup(popupMsg, failedList.length > 0 ? failedList : null);
                } else {
                    this.setVideoStatus('warning', '⏹ Automação de vídeos interrompida.');
                }

            } catch (err) {
                this.setVideoStatus('error', '❌ Erro: ' + err.message);
                log.error('Video pipeline error:', err);
            }

            this.videoIsRunning = false;
            this.clearRunState(); // Limpa estado de crash (processo terminou)
            document.getElementById('fv-start-btn').disabled = false;
            document.getElementById('fv-stop-btn').disabled  = true;
            document.getElementById('fv-prompts-input').disabled = false;
            document.getElementById('flow-mini').style.display = 'none';
            document.getElementById('flow-sidebar').style.display = '';
        }

        stopVideo() { this.videoShouldStop = true; this.setVideoStatus('warning', '⏹ Parando...'); }

        /**
         * Mostra painel de atribuição para vídeos (modo cenas).
         * Reutiliza o mesmo painel de assign do DOM, mas com estado de vídeo.
         */
        showVideoAssignPanel(allMatrices) {
            const panel = document.getElementById('flow-assign-panel');
            const title = document.getElementById('flow-assign-title');
            const items = document.getElementById('flow-assign-items');
            const dlBtn = document.getElementById('flow-assign-download');
            const variationCounts = this.getSceneVariationCountsFromMatrices(allMatrices);
            this._lastMatrices = allMatrices || [];   // ADD-ON: modo exato do ⚡ Auto (vídeo, mesma sessão)

            items.innerHTML = '';
            title.textContent = 'Atribuir Cenas (Vídeos)';

            const previewEl = document.getElementById('flow-assign-preview');
            if (previewEl) previewEl.style.display = 'none';

            dlBtn.style.display = 'inline-flex';

            const rlBar = document.getElementById('flow-assign-reload-bar');
            if (rlBar) rlBar.classList.remove('visible');

            // INJEÇÃO ADD-ON: Numeração Fiel
            for (const [sceneName] of this.videoSceneAssignments) {
                const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                const prompt = this.videoPrompts.find(p => p.promptNum === sceneNum);
                const promptText = prompt?.text || '';

                const item = document.createElement('div');
                item.className = 'flow-assign-item';
                item.draggable = true;
                item.dataset.type = 'scene';
                item.dataset.scene = sceneName;
                item.dataset.sceneNum = sceneNum;
const displaySceneName = this.formatSceneNameWithVariationCount(sceneName, variationCounts);

item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(displaySceneName)}</span><span class="assign-status">⏳</span>`;
item.title = `${sceneName}: ${variationCounts.get(sceneNum) || 0} variação(ões) encontrada(s)`;                item.addEventListener('mouseenter', () => {
                    const preview = document.getElementById('flow-assign-preview');
                    if (preview) {
                        preview.style.display = '';
                        preview.querySelector('.preview-label').textContent = sceneName + ': ';
                        preview.querySelector('.preview-text').textContent = promptText.substring(0, 300) + (promptText.length > 300 ? '...' : '');
                    }
                });
                item.addEventListener('mouseleave', () => {
                    const preview = document.getElementById('flow-assign-preview');
                    if (preview) preview.style.display = 'none';
                });
                item.addEventListener('dragstart', e => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'scene', sceneNum, sceneName }));
                    e.dataTransfer.effectAllowed = 'copy';
                });
                items.appendChild(item);
            }

            panel.classList.add('active');
            panel.classList.remove('minimized');
            document.getElementById('flow-assign-toggle').textContent = '▲';
            const reopenBtn = document.getElementById('fv-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            // Atualiza contadores usando videoSceneAssignments
            this._videoAssignActive = true;
            this.updateAssignCount();
            this.updateScrollerPadding();
        }

               /**
         * --- INJEÇÃO ADD-ON: Sistema Automático de Upscale 1080p (Vídeos) ---
         * Versão reforçada: menu do tile -> Download -> 1080p -> toast -> próximo vídeo
         */
        async waitFor(conditionFn, timeout = 8000, interval = 150) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                try {
                    const result = await conditionFn();
                    if (result) return result;
                } catch (_) {}
                await this.sleep(interval);
            }
            return null;
        }

        isVisible(el) {
            if (!el || !el.isConnected) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        }

        async getTileMenuButton(tile) {
            if (!tile) return null;

            // força hover no tile
            tile.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
            await this.sleep(350);

            const candidates = [
                ...tile.querySelectorAll('button'),
                ...tile.querySelectorAll('[role="button"]')
            ];

            for (const btn of candidates) {
                const text = btn.textContent?.trim() || '';
                const aria = btn.getAttribute('aria-label') || '';
                const title = btn.getAttribute('title') || '';

                if (
                    /more|mais/i.test(text) ||
                    /more|mais/i.test(aria) ||
                    /more|mais/i.test(title)
                ) {
                    if (this.isVisible(btn)) return btn;
                }

                const icon = btn.querySelector('i, span');
                const iconText = icon?.textContent?.trim() || '';
                if ((iconText === 'more_vert' || iconText === 'more_horiz') && this.isVisible(btn)) {
                    return btn;
                }
            }

            return null;
        }

        async openTileMenu(tile) {
            const menuBtn = await this.getTileMenuButton(tile);
            if (!menuBtn) return false;

            menuBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, view: window }));
            menuBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            menuBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            menuBtn.click();

            const opened = await this.waitFor(() => {
                const menuItems = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return menuItems.length ? menuItems : null;
            }, 5000);

            return !!opened;
        }

        async openDownloadSubmenu() {
            const downloadBtn = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => /download|baixar/i.test(el.textContent || ''));
            }, 5000);

            if (!downloadBtn) return false;

            downloadBtn.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
            downloadBtn.click();

            const submenu = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => /1080p/i.test(el.textContent || ''));
            }, 5000);

            return !!submenu;
        }

        async click1080pOption() {
            const upscaleBtn = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    return /1080p/i.test(text);
                });
            }, 5000);

            if (!upscaleBtn) return { ok: false, reason: '1080p_not_found' };

            upscaleBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, view: window }));
            upscaleBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            upscaleBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            upscaleBtn.click();

            return { ok: true };
        }

        async waitForUpscaleToast() {
            const toast = await this.waitFor(() => {
                const toasts = [...document.querySelectorAll('li[data-sonner-toast], li[data-sonner-toast="true"]')];
                return toasts.find(el =>
                    /Upscaling your video/i.test(el.textContent || '')
                );
            }, 6000, 200);

            if (!toast) return false;

            const dismissBtn = [...toast.querySelectorAll('button')].find(btn =>
                /dismiss/i.test(btn.textContent || '')
            );

            if (dismissBtn) dismissBtn.click();
            return true;
        }

        getUpscaleRequestedSet() {
            if (!this._upscaleRequestedWfIds) this._upscaleRequestedWfIds = new Set();
            return this._upscaleRequestedWfIds;
        }
async scanIdentifiedVideosForUpscale() {
    const scroller = this.getScroller();
    const found = new Map();

    if (!scroller) {
        this.logVideoDebug('Upscale scan: scroller não encontrado.', 'error');
        return found;
    }

    const addFound = (workflowId, label, tile) => {
        if (!workflowId || !label) return;

        const match = label.match(/^Cena\s+([\d.]+)\s*-\s*(?:Vídeo|Video)\s+(\d+)$/i);
        if (!match) return;

        found.set(workflowId, {
            workflowId,
            label,
            sceneNum: parseFloat(match[1]),
            videoNum: parseInt(match[2], 10),
            tile
        });
    };

    this.logVideoDebug('🔎 Upscale: varrendo galeria para encontrar todos os vídeos identificados...', 'info');

    const scanVisibleTiles = async () => {
        const tiles = [...document.querySelectorAll('[data-tile-id]')];

        for (const rawTile of tiles) {
            const tile = rawTile.querySelector('a[href*="/edit/"]')
                ? rawTile
                : (rawTile.querySelector('[data-tile-id]') || rawTile);

            if (!tile || !this.isTileLoaded(tile)) continue;
            if (!this.isVideoTile(tile)) continue;

            const workflowId = this.getWorkflowIdFromTile(tile);
            if (!workflowId || found.has(workflowId)) continue;

            const name = await this.getTileName(tile);
            if (!name) continue;

            addFound(workflowId, name, tile);
        }
    };

    // Passada 1: de cima para baixo
    scroller.scrollTop = 0;
    await this.sleep(800);

    let samePositionCount = 0;

    for (let iter = 0; iter < 800; iter++) {
        await scanVisibleTiles();

        const prev = Math.round(scroller.scrollTop);
        const step = Math.max(300, Math.floor(scroller.clientHeight * 0.7));
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + step);

        await this.sleep(650);

        const now = Math.round(scroller.scrollTop);

        if (now === prev) {
            samePositionCount++;
        } else {
            samePositionCount = 0;
        }

        if (samePositionCount >= 2) break;
    }

    // Passada 2: de baixo para cima, para pegar o que a galeria virtualizada pulou
    scroller.scrollTop = scroller.scrollHeight;
    await this.sleep(800);

    samePositionCount = 0;

    for (let iter = 0; iter < 800; iter++) {
        await scanVisibleTiles();

        const prev = Math.round(scroller.scrollTop);
        const step = Math.max(300, Math.floor(scroller.clientHeight * 0.7));
        scroller.scrollTop = Math.max(0, scroller.scrollTop - step);

        await this.sleep(650);

        const now = Math.round(scroller.scrollTop);

        if (now === prev) {
            samePositionCount++;
        } else {
            samePositionCount = 0;
        }

        if (now <= 0 && samePositionCount >= 2) break;
    }

    // Também junta o que já estava na memória da extensão
    for (const [workflowId, data] of this.tileAssignments.entries()) {
        const label = data?.label || '';

        if (
            data?.type === 'scene' &&
            /^Cena\s+[\d.]+\s*-\s*(?:Vídeo|Video)\s+\d+$/i.test(label)
        ) {
            addFound(workflowId, label, null);
        }
    }

    if (this.videoSceneAssignments instanceof Map) {
        for (const [sceneName, arr] of this.videoSceneAssignments.entries()) {
            const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);

            for (const item of arr || []) {
                if (!item?.workflowId) continue;

                const videoNum = Number(item.imgNum || 0);
                const label = sceneNum && videoNum
                    ? `Cena ${sceneNum} - Vídeo ${videoNum}`
                    : '';

                addFound(item.workflowId, label, null);
            }
        }
    }

    const sorted = new Map(
        [...found.entries()].sort((a, b) => {
            const av = a[1];
            const bv = b[1];

            if (av.sceneNum !== bv.sceneNum) return av.sceneNum - bv.sceneNum;
            return av.videoNum - bv.videoNum;
        })
    );

    this.logVideoDebug(
        `✅ Upscale scan: ${sorted.size} vídeo(s) identificado(s) encontrado(s).`,
        sorted.size ? 'success' : 'warning'
    );

    for (const item of sorted.values()) {
        this.logVideoDebug(`• ${item.label} → ${item.workflowId.substring(0, 8)}`, 'info');
    }

    return sorted;
}
            async debugUpscaleList() {
    const btn = document.getElementById('fv-upscale-debug-btn');
    const originalText = btn?.textContent || '🔎 Diagnosticar vídeos do upscale';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Diagnosticando...';
    }

    try {
        const logsToggle = document.getElementById('fv-show-logs');
        const logsContainer = document.getElementById('fv-logs-container');

        if (logsToggle) logsToggle.checked = true;
        if (logsContainer) logsContainer.classList.add('visible');

        this.setVideoStatus('info', '🔎 Diagnosticando vídeos identificados para upscale...');
        this.logVideoDebug('🔎 Diagnóstico de upscale iniciado. Nenhum upscale será solicitado.', 'info');

        const identifiedVideosMap = await this.scanIdentifiedVideosForUpscale();
        const videos = [...identifiedVideosMap.values()];

        if (!videos.length) {
            this.setVideoStatus(
                'warning',
                'Nenhum vídeo identificado encontrado para upscale. Use "Analisar projeto existente" ou atribua/nomeie os vídeos primeiro.'
            );
            this.logVideoDebug('⚠️ Diagnóstico: nenhum vídeo identificado encontrado.', 'warning');
            return;
        }

        const byScene = new Map();

        for (const item of videos) {
            const sceneNum = Number(item.sceneNum || 0);
            if (!byScene.has(sceneNum)) byScene.set(sceneNum, []);
            byScene.get(sceneNum).push(item);
        }

        const sortedScenes = [...byScene.entries()]
            .sort((a, b) => a[0] - b[0]);

        this.logVideoDebug(`✅ Diagnóstico: ${videos.length} vídeo(s) identificado(s) encontrado(s).`, 'success');

        for (const [sceneNum, sceneVideos] of sortedScenes) {
            const sortedVideos = sceneVideos.sort((a, b) => Number(a.videoNum || 0) - Number(b.videoNum || 0));

            this.logVideoDebug(
                `Cena ${sceneNum}: ${sortedVideos.length} vídeo(s) identificado(s).`,
                'info'
            );

            for (const item of sortedVideos) {
                const workflowShort = item.workflowId
                    ? item.workflowId.substring(0, 8)
                    : 'sem-id';

                this.logVideoDebug(
                    `• ${item.label} → ${workflowShort}`,
                    'info'
                );
            }
        }

        this.setVideoStatus(
            'success',
            `✅ Diagnóstico concluído: ${videos.length} vídeo(s) identificado(s) para upscale. Confira os logs.`
        );

    } catch (err) {
        this.setVideoStatus('error', 'Erro no diagnóstico do upscale: ' + err.message);
        this.logVideoDebug('Erro no diagnóstico do upscale: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}
        async startUpscaleProcess() {
           const btn = document.getElementById('fv-upscale-btn');

// Controle apenas desta execução.
// Assim uma variação não fica "pulada" por ter sido marcada em tentativa anterior.
const requested = new Set();

            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Iniciando Upscale 1080p...';
            }
            // Mostra botão de parar e reseta flag
            this.upscaleShouldStop = false;
            const stopBtn = document.getElementById('fv-upscale-stop-btn');
            if (stopBtn) stopBtn.style.display = '';

            // Salva URL do projeto para detectar se saiu
            const projectUrl = location.href;

const identifiedVideosMap = await this.scanIdentifiedVideosForUpscale();

const wfIdsToUpscale = [...identifiedVideosMap.keys()].filter(wfId => !requested.has(wfId));

this.logVideoDebug(
    `Upscale: ${wfIdsToUpscale.length} vídeo(s) identificado(s) único(s) serão processados agora.`,
    'info'
);

            if (!wfIdsToUpscale.length) {
                this.setVideoStatus('warning', 'Nenhum vídeo identificado pendente para upscale. Use "Analisar projeto existente" ou atribua as cenas primeiro.');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)';
                }
                return;
            }

            this.logVideoDebug(`Iniciando upscale de ${wfIdsToUpscale.length} vídeo(s)...`, 'info');
            this.setVideoStatus('info', `🚀 Solicitando upscale de ${wfIdsToUpscale.length} vídeo(s)...`);

            let count = 0;
            let fail = 0;
            const failedWfIds = []; // guarda IDs que falharam para retry

            for (const wfId of wfIdsToUpscale) {
                const videoInfo = identifiedVideosMap.get(wfId);
const videoLabel = videoInfo?.label || wfId.substring(0, 8);

this.logVideoDebug(`🎬 Processando upscale: ${videoLabel}`, 'info');
this.setVideoStatus('info', `🚀 Pedindo upscale: ${videoLabel}`);
                if (this.upscaleShouldStop) break;

                // Verifica se ainda está no MESMO PROJETO — comparando só o ID do projeto,
                // NÃO a URL inteira. Assim, abrir um vídeo (.../project/ID/edit/...) não é
                // tratado como "saiu do projeto" (era o bug que abortava o upscale).
                const getProj = u => (String(u).match(/project\/([a-f0-9-]{36})/) || [])[1] || null;
                this.logVideoDebug(`🔗 URL atual: ${location.href}`, 'info');   // DIAGNÓSTICO
                if (getProj(location.href) !== getProj(projectUrl)) {
                    this.logVideoDebug(`❌ Saiu do projeto! Parando upscale. (esperado projeto=${getProj(projectUrl)}, atual=${getProj(location.href)}, url=${location.href})`, 'error');
                    this.setVideoStatus('error', '❌ O upscale parou porque a página saiu do projeto. Volte ao projeto e tente novamente.');
                    break;
                }
                // Continua no projeto, mas abriu uma subpágina (ex: um vídeo)? Volta pra grade.
                if (/\/edit\//.test(location.href)) {
                    this.logVideoDebug('↩️ Página abriu um vídeo; voltando à grade do projeto...', 'warning');
                    history.back();
                    await this.sleep(1500);
                    await this.waitFor(() => document.querySelector('a[href*="/edit/"]'), 5000);
                }

                try {
                    const tile = await this.scrollToWorkflow(wfId);
                    if (!tile) {
                        this.logVideoDebug(`❌ Tile não encontrado para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const menuOpened = await this.openTileMenu(tile);
                    if (!menuOpened) {
                        this.logVideoDebug(`❌ Menu não abriu para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const submenuOpened = await this.openDownloadSubmenu();
                    if (!submenuOpened) {
                        this.logVideoDebug(`❌ Submenu Download não abriu para ${wfId.substring(0, 8)}`, 'error');
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            bubbles: true
                        }));
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const clickResult = await this.click1080pOption();
                    if (!clickResult.ok) {
                        this.logVideoDebug(`⚠️ Opção 1080p não encontrada para ${wfId.substring(0, 8)}`, 'warning');
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            bubbles: true
                        }));
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const toastOk = await this.waitForUpscaleToast();
                    if (toastOk) {
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`✅ Upscale solicitado para ${videoLabel}`, 'success');
                    } else {
                        // em alguns casos o clique pega mesmo sem o toast aparecer
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`⚠️ Clique em 1080p executado, mas toast não apareceu para ${videoLabel}`, 'warning');
                    }

                    if (btn) btn.textContent = `⏳ Upscale ${count}/${wfIdsToUpscale.length}`;
                    await this.sleep(2200);

                } catch (err) {
                    fail++;
                    failedWfIds.push(wfId);
                    this.logVideoDebug(`❌ Erro no upscale ${wfId.substring(0, 8)}: ${err.message}`, 'error');
                    document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        bubbles: true
                    }));
                    await this.sleep(500);
                }
            }

            this.setVideoStatus('success', `✅ Upscale solicitado para ${count} vídeo(s). Falhas: ${fail}.`);
this.logVideoDebug(`✅ Processo concluído. Upscale solicitado: ${count}. Falhas: ${fail}.`, 'success');

if (btn) {
    btn.disabled = false;
    btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)';
}
// Esconde botão de parar
const stopBtn2 = document.getElementById('fv-upscale-stop-btn');
if (stopBtn2) stopBtn2.style.display = 'none';

// Salva falhas e mostra botão de retry se houver
this._upscaleFailedWfIds = failedWfIds;
this._upscaleVideosMap = identifiedVideosMap;
const retryBtn = document.getElementById('fv-upscale-retry-btn');
if (retryBtn) {
    if (failedWfIds.length > 0) {
        retryBtn.style.display = '';
        retryBtn.textContent = `🔄 Retentar ${failedWfIds.length} Falha(s) do Upscale`;
    } else {
        retryBtn.style.display = 'none';
    }
}
}

        /** Retenta upscale apenas nos vídeos que falharam na tentativa anterior */
        async retryFailedUpscale() {
            if (!this._upscaleFailedWfIds || !this._upscaleFailedWfIds.length) {
                this.setVideoStatus('warning', 'Nenhuma falha para retentar.');
                return;
            }

            const btn = document.getElementById('fv-upscale-btn');
            const retryBtn = document.getElementById('fv-upscale-retry-btn');
            const stopBtn = document.getElementById('fv-upscale-stop-btn');

            if (btn) { btn.disabled = true; btn.textContent = '⏳ Retentando Upscale...'; }
            if (retryBtn) retryBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = '';
            this.upscaleShouldStop = false;

            const projectUrl = location.href;
            const identifiedVideosMap = this._upscaleVideosMap || new Map();
            const wfIdsToRetry = [...this._upscaleFailedWfIds];

            this.logVideoDebug(`\n╔═══ RETENTANDO UPSCALE: ${wfIdsToRetry.length} VÍDEO(S) ═══╗`, 'info');
            this.setVideoStatus('info', `🔄 Retentando upscale de ${wfIdsToRetry.length} vídeo(s)...`);

            let count = 0;
            let fail = 0;
            const stillFailed = [];

            for (let i = 0; i < wfIdsToRetry.length; i++) {
                const wfId = wfIdsToRetry[i];
                const videoInfo = identifiedVideosMap.get(wfId);
                const videoLabel = videoInfo?.label || wfId.substring(0, 8);

                if (this.upscaleShouldStop) break;

                if (location.href !== projectUrl) {
                    this.logVideoDebug('❌ Saiu do projeto! Parando retry.', 'error');
                    this.setVideoStatus('error', '❌ Saiu do projeto durante o retry.');
                    // Salva os restantes como falha
                    for (let j = i; j < wfIdsToRetry.length; j++) stillFailed.push(wfIdsToRetry[j]);
                    break;
                }

                this.logVideoDebug(`🔄 Retry ${i+1}/${wfIdsToRetry.length}: ${videoLabel}`, 'info');
                this.setVideoStatus('info', `🔄 Retry ${i+1}/${wfIdsToRetry.length}: ${videoLabel}`);

                try {
                    const tile = await this.scrollToWorkflow(wfId);
                    if (!tile) { fail++; stillFailed.push(wfId); continue; }

                    const menuOpened = await this.openTileMenu(tile);
                    if (!menuOpened) { fail++; stillFailed.push(wfId); continue; }

                    const submenuOpened = await this.openDownloadSubmenu();
                    if (!submenuOpened) {
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                        fail++; stillFailed.push(wfId); continue;
                    }

                    const clickResult = await this.click1080pOption();
                    if (!clickResult.ok) {
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                        fail++; stillFailed.push(wfId); continue;
                    }

                    const toastOk = await this.waitForUpscaleToast();
                    count++;
                    this.logVideoDebug(`✅ Retry upscale OK: ${videoLabel}${toastOk ? '' : ' (sem toast)'}`, 'success');

                    if (btn) btn.textContent = `⏳ Retry ${count}/${wfIdsToRetry.length}`;
                    await this.sleep(2200);

                } catch (err) {
                    fail++;
                    stillFailed.push(wfId);
                    this.logVideoDebug(`❌ Retry falhou: ${wfId.substring(0, 8)}: ${err.message}`, 'error');
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                    await this.sleep(500);
                }
            }

            this.logVideoDebug(`╚═══ FIM RETRY: ${count} recuperado(s), ${fail} falha(s) ═══╝`, 'info');
            this.setVideoStatus(fail > 0 ? 'warning' : 'success',
                `${fail > 0 ? '⚠️' : '✅'} Retry concluído: ${count} recuperado(s), ${fail} falha(s).`
            );

            if (btn) { btn.disabled = false; btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)'; }
            if (stopBtn) stopBtn.style.display = 'none';

            // Atualiza lista de falhas para possível novo retry
            this._upscaleFailedWfIds = stillFailed;
            if (retryBtn) {
                if (stillFailed.length > 0) {
                    retryBtn.style.display = '';
                    retryBtn.textContent = `🔄 Retentar ${stillFailed.length} Falha(s) do Upscale`;
                } else {
                    retryBtn.style.display = 'none';
                }
            }
        }

async scrollToWorkflow(wfId) {
            const scroller = this.getScroller();
            if (!scroller) return null;

            // Verifica se tiles existem (confirma que estamos num projeto)
            const tilesExist = document.querySelectorAll('[data-tile-id]').length > 0;
            if (!tilesExist) {
                this.logVideoDebug('⚠️ scrollToWorkflow: nenhum tile encontrado. Pode ter saído do projeto.', 'warning');
                return null;
            }

            // Primeiro tenta achar sem scrollar (já visível)
            const linkDirect = document.querySelector(`a[href*="/edit/${wfId}"]`);
            if (linkDirect) {
                const tileDirect = linkDirect.closest('[data-tile-id]');
                if (tileDirect) return tileDirect;
            }

            // Scroll pro topo do virtualizer (não da página)
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 80; iter++) {
                // Check de parada
                if (this.upscaleShouldStop) return null;

                // Verifica se ainda tem tiles (não saiu do projeto)
                if (document.querySelectorAll('[data-tile-id]').length === 0) {
                    this.logVideoDebug('⚠️ scrollToWorkflow: tiles sumiram durante scroll. Abortando.', 'warning');
                    return null;
                }

                const link = document.querySelector(`a[href*="/edit/${wfId}"]`);
                if (link) {
                    const tile = link.closest('[data-tile-id]');
                    if (tile) {
                        // Ajuste de posição para ficar visível
                        const rect = tile.getBoundingClientRect();
                        const scrollerRect = scroller.getBoundingClientRect();
                        if (rect.top < scrollerRect.top + 50 || rect.bottom > scrollerRect.bottom - 50) {
                            const relativeTop = rect.top - scrollerRect.top;
                            scroller.scrollTop += (relativeTop - scrollerRect.height / 2 + rect.height / 2);
                            await this.sleep(300);
                        }
                        return tile;
                    }
                }

                const prev = scroller.scrollTop;
                scroller.scrollTop += 450;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break; // Chegou no fim
            }
            return null;
        }

        /** Comunicação com background via bridge */
        sendToBackground(action, data = {}) {
            return new Promise((resolve) => {
                const id = 'cd_' + Date.now() + '_' + Math.random();
                const handler = (event) => {
                    if (event.data?.type === 'CD_FROM_BACKGROUND' && event.data.id === id) {
                        window.removeEventListener('message', handler);
                        resolve(event.data.result);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ type: 'CD_TO_BACKGROUND', action, data, id }, '*');
                setTimeout(() => { window.removeEventListener('message', handler); resolve({ success: false, error: 'Timeout' }); }, 30000);
            });
        }

        // ──────────────────────────────────────────────
        // CRASH RECOVERY (memória de estado)
        // ──────────────────────────────────────────────

        /**
         * Salva estado do run antes de reload por crash.
         * Guarda: prompts, posição, modo, configurações.
         */
        saveRunState(currentPromptNum) {
            try {
                const imgInput = document.getElementById('flow-prompts-input');
                const vidInput = document.getElementById('fv-prompts-input');
                const isVideo = this.videoIsRunning;

                const state = {
                    timestamp: Date.now(),
                    promptText: isVideo ? (vidInput?.value || '') : (imgInput?.value || ''),
                    currentPromptNum: currentPromptNum,
                    isVideo: isVideo,
                    genMode: isVideo ? this.videoGenMode : this.genMode,
                    speedMultiplier: this.speedMultiplier,
                    batchSize: isVideo ? this.videoBatchSize : this.batchSize,
                    imagesPerPrompt: isVideo ? this.videoResultsPerPrompt : this.imagesPerPrompt,
                    projectUrl: location.href
                };

                localStorage.setItem('flow_crash_state', JSON.stringify(state));
                console.log('[Flow] Estado salvo para crash recovery:', state);
            } catch (e) {
                console.error('[Flow] Falha ao salvar estado:', e);
            }
        }

        /**
         * Carrega estado salvo do crash anterior.
         */
        loadRunState() {
            try {
                const raw = localStorage.getItem('flow_crash_state');
                if (!raw) return null;
                const state = JSON.parse(raw);
                // Expira estados com mais de 30 minutos
                if (Date.now() - state.timestamp > 30 * 60 * 1000) {
                    this.clearRunState();
                    return null;
                }
                return state;
            } catch (e) {
                return null;
            }
        }

        /**
         * Limpa estado salvo.
         */
        clearRunState() {
            localStorage.removeItem('flow_crash_state');
        }

        /**
         * Verifica se há estado salvo de crash e mostra banner de recuperação.
         */
        checkCrashRecovery() {
            const state = this.loadRunState();
            if (!state) return;

            // Cria banner de recuperação
            const banner = document.createElement('div');
            banner.id = 'flow-crash-recovery-banner';
            banner.style.cssText = `
                position: fixed; bottom: 20px; right: 20px; z-index: 99999;
                background: linear-gradient(135deg, #1e1b4b, #312e81);
                border: 1px solid #6366f1; border-radius: 12px;
                padding: 16px 20px; color: #e0e7ff;
                font-family: 'Inter', sans-serif; font-size: 13px;
                box-shadow: 0 8px 32px rgba(99,102,241,0.4);
                max-width: 380px; line-height: 1.5;
            `;

            const modeLabel = state.isVideo ? '🎬 Vídeo' : '🖼️ Imagem';
            const modeText = state.genMode === 'scenes' ? 'Cenas' : state.genMode === 'refs' ? 'Referências' : 'Livre';
            const timeAgo = Math.round((Date.now() - state.timestamp) / 60000);

            banner.innerHTML = `
                <div style="font-weight:700; font-size:14px; margin-bottom:8px; color:#a5b4fc;">
                    🔄 Sessão anterior detectada
                </div>
                <div style="margin-bottom:4px;">
                    ${modeLabel} • Modo ${modeText} • Parou no prompt <b>${state.currentPromptNum}</b>
                </div>
                <div style="font-size:11px; opacity:0.7; margin-bottom:12px;">
                    Há ${timeAgo < 1 ? 'menos de 1' : timeAgo} minuto(s) atrás
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="flow-crash-resume" style="
                        flex:1; padding:8px 12px; border:none; border-radius:8px;
                        background:linear-gradient(135deg, #6366f1, #8b5cf6);
                        color:white; font-weight:600; cursor:pointer; font-size:13px;
                    ">▶ Continuar de onde parou</button>
                    <button id="flow-crash-dismiss" style="
                        padding:8px 12px; border:1px solid #4f46e5; border-radius:8px;
                        background:transparent; color:#a5b4fc; cursor:pointer; font-size:13px;
                    ">✕</button>
                </div>
            `;

            document.body.appendChild(banner);

            // Handler: Continuar
            document.getElementById('flow-crash-resume').addEventListener('click', () => {
                const s = state;
                if (s.isVideo) {
                    // Preenche aba de vídeo
                    const vidInput = document.getElementById('fv-prompts-input');
                    if (vidInput) vidInput.value = s.promptText;
                    // Seta retomar de
                    const resumeInput = document.getElementById('fv-start-from');
                    if (resumeInput) resumeInput.value = String(s.currentPromptNum);
                    // Abre aba de vídeo
                    document.querySelector('[data-tab="video"]')?.click();
                } else {
                    // Preenche aba de imagem
                    const imgInput = document.getElementById('flow-prompts-input');
                    if (imgInput) imgInput.value = s.promptText;
                    // Seta retomar de
                    const resumeInput = document.getElementById('flow-start-from');
                    if (resumeInput) resumeInput.value = String(s.currentPromptNum);
                    // Dispara evento para atualizar contadores
                    imgInput?.dispatchEvent(new Event('input', { bubbles: true }));
                }

                this.setStatus('info', `✅ Prompts restaurados! "Retomar de" setado para ${s.currentPromptNum}. Clique Iniciar quando pronto.`);
                this.clearRunState();
                banner.remove();
            });

            // Handler: Dispensar
            document.getElementById('flow-crash-dismiss').addEventListener('click', () => {
                this.clearRunState();
                banner.remove();
            });
        }

        // ──────────────────────────────────────────────
        // CRASH DETECTION
        // ──────────────────────────────────────────────

        /**
         * Detecta se o Flow crashou (client-side exception).
         * Verifica: texto de erro na página, editor ausente, ou body com overlay de erro.
         */
        isFlowCrashed() {
            // 1. Texto explícito de crash do Next.js/React
            const bodyText = document.body?.innerText || '';
            if (bodyText.includes('Application error') && bodyText.includes('client-side exception')) return true;

            // 2. Overlay de erro do Next.js
            const errorOverlay = document.getElementById('__next-route-announcer__')?.parentElement;
            if (errorOverlay && bodyText.includes('Error')) {
                // Verifica se o editor sumiu (indica crash real)
                const editor = this.getEditor?.();
                const submitBtn = [...document.querySelectorAll('button')].find(b =>
                    b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward'
                );
                if (!editor && !submitBtn) return true;
            }

            return false;
        }

        // ──────────────────────────────────────────────
        // UI HELPERS
        // ──────────────────────────────────────────────

        setStatus(type, msg) {
            const el = document.getElementById('flow-status');
            el.className = 'flow-status ' + type;
            el.innerHTML = msg;
        }

        updateProgress(fraction) {
            const pct = Math.round(fraction * 100);
            document.getElementById('flow-progress-bar').style.width = pct + '%';
            document.getElementById('flow-mini-progress-bar').style.width = pct + '%';
        }

       updateMini(title, sub, fraction, details) {
    const panel = document.getElementById('flow-panel');
    const mini = document.getElementById('flow-mini');
    const sidebar = document.getElementById('flow-sidebar');

    const panelOpen = panel?.classList.contains('active');
    const isAnyAutomationRunning = this.isRunning || this.videoIsRunning;

    if (!panelOpen && isAnyAutomationRunning) {
        if (mini) mini.style.display = 'flex';
        if (sidebar) sidebar.style.display = '';
    } else if (!isAnyAutomationRunning) {
        if (mini) mini.style.display = 'none';
    }

    const statusEl = document.getElementById('flow-mini-status');
    const subEl = document.getElementById('flow-mini-sub');
    const detailsEl = document.getElementById('flow-mini-details');

    if (statusEl) statusEl.textContent = title || 'Processando...';
    if (subEl) subEl.textContent = sub || '';
    if (detailsEl) detailsEl.textContent = details || '';

    this.updateProgress(fraction);
}
        buildPromptList() {
            document.getElementById('flow-prompts-preview-card').style.display = 'block';
            document.getElementById('flow-queue-info').textContent = `${this.prompts.length} prompts na fila`;
            document.getElementById('flow-prompt-list').innerHTML = this.prompts.map((p, i) => {
                const refs = (p.text.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1,-1));
                return `<div class="flow-prompt-item" data-index="${i}">
                    <span class="num">${p.promptNum}</span>
                    <span class="text">${this.esc(p.text.replace(/\[([^\]]+)\]/g, '●$1'))}</span>
                    ${refs.length ? `<span class="refs">${refs.map(r => `<span class="ref-badge">${this.esc(r)}</span>`).join('')}</span>` : ''}
                </div>`;
            }).join('');
        }

        updatePromptItemStatus(index, status, extra = '') {
            const item = document.querySelector(`.flow-prompt-item[data-index="${index}"]`);
            if (!item) return;
            item.className = `flow-prompt-item ${status}`;
            let badge = item.querySelector('.status-badge');
            const icons  = { active:'⚡', done:'✅', error:'❌', retrying:'🔄' };
            const labels = { active:'Gerando', done:'Concluído', error:'Falhou', retrying:'Retentando' };
            const colors = {
                active:   { bg:'#e0f2fe', fg:'#0369a1' },
                done:     { bg:'#d1fae5', fg:'#065f46' },
                error:    { bg:'#fee2e2', fg:'#991b1b' },
                retrying: { bg:'#fef9c3', fg:'#78350f' },
            };
            if (status !== 'active' || extra) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'status-badge'; item.appendChild(badge); }
                badge.textContent = `${icons[status] || ''} ${extra || labels[status] || status}`;
                const clr = colors[status] || colors.active;
                badge.style.background = clr.bg; badge.style.color = clr.fg;
            } else if (badge) { badge.remove(); }
        }

        showCompletionPopup(msg, failedPrompts) {
            const msgEl = document.getElementById('flow-popup-msg');
            if (msgEl) msgEl.textContent = msg || 'Concluído!';
            const failedEl = document.getElementById('flow-popup-failed');
            if (failedEl) {
                if (failedPrompts && failedPrompts.length > 0) {
                    failedEl.style.display = 'block';
                    failedEl.innerHTML = '<div style="font-weight:600;margin-bottom:6px;color:#991b1b;">⚠️ Prompts que falharam:</div>' +
                        failedPrompts.map(p => `<div>#${p.promptNum} — ${this.esc(p.text.substring(0, 80))}${p.text.length > 80 ? '...' : ''}</div>`).join('');
                } else {
                    failedEl.style.display = 'none';
                    failedEl.innerHTML = '';
                }
            }
            // Botão de download das mídias geradas nesta execução
            const dlBtn = document.getElementById('flow-popup-download');
            if (dlBtn) {
                const media = this._lastRunMedia || [];
                if (media.length > 0) {
                    const isVideo = media[0]?.isVideo;
                    const label = isVideo ? 'vídeo(s)' : 'imagem(ns)';
                    dlBtn.textContent = `⬇️ Baixar ${media.length} ${label}`;
                    dlBtn.style.display = '';
                    dlBtn.disabled = false;
                } else {
                    dlBtn.style.display = 'none';
                }
            }
            const overlay = document.getElementById('flow-popup-overlay');
            const popup = document.getElementById('flow-popup');
            if (overlay) overlay.style.display = 'block';
            if (popup) popup.style.display = 'block';
        }

        logDebug(msg, type = 'info') {
            const panel = document.getElementById('flow-debug-panel');
            if (panel) {
                const line = document.createElement('div');
                line.className = `flow-debug-line ${type}`;
                line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
                panel.appendChild(line);
                panel.scrollTop = panel.scrollHeight;
            }
            if      (type === 'error')   log.error(msg);
            else if (type === 'success') log.success(msg);
            else                         log.info(msg);
        }

        // ──────────────────────────────────────────────
        // VIDEO UI HELPERS
        // ──────────────────────────────────────────────

        setVideoStatus(type, msg) {
            const el = document.getElementById('fv-status');
            el.className = 'flow-status ' + type;
            el.innerHTML = msg;
        }

        updateVideoProgress(fraction) {
            const pct = Math.round(fraction * 100);
            document.getElementById('fv-progress-bar').style.width = pct + '%';
            document.getElementById('flow-mini-progress-bar').style.width = pct + '%';
        }

        buildVideoPromptList() {
            document.getElementById('fv-prompts-preview-card').style.display = 'block';
            document.getElementById('fv-queue-info').textContent = `${this.videoPrompts.length} prompts na fila`;
            document.getElementById('fv-prompt-list').innerHTML = this.videoPrompts.map((p, i) => {
                const refs = (p.text.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1,-1));
                return `<div class="flow-prompt-item" data-index="${i}">
                    <span class="num">${p.promptNum}</span>
                    <span class="text">${this.esc(p.text.replace(/\[([^\]]+)\]/g, '●$1'))}</span>
                    ${refs.length ? `<span class="refs">${refs.map(r => `<span class="ref-badge">${this.esc(r)}</span>`).join('')}</span>` : ''}
                </div>`;
            }).join('');
        }

        updateVideoPromptItemStatus(index, status, extra = '') {
            const item = document.querySelector(`#fv-prompt-list .flow-prompt-item[data-index="${index}"]`);
            if (!item) return;
            item.className = `flow-prompt-item ${status}`;
            let badge = item.querySelector('.status-badge');
            const icons  = { active:'⚡', done:'✅', error:'❌', retrying:'🔄' };
            const labels = { active:'Gerando', done:'Concluído', error:'Falhou', retrying:'Retentando' };
            const colors = {
                active:   { bg:'#e0f2fe', fg:'#0369a1' },
                done:     { bg:'#d1fae5', fg:'#065f46' },
                error:    { bg:'#fee2e2', fg:'#991b1b' },
                retrying: { bg:'#fef9c3', fg:'#78350f' },
            };
            if (status !== 'active' || extra) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'status-badge'; item.appendChild(badge); }
                badge.textContent = `${icons[status] || ''} ${extra || labels[status] || status}`;
                const clr = colors[status] || colors.active;
                badge.style.background = clr.bg; badge.style.color = clr.fg;
            } else if (badge) { badge.remove(); }
        }

        logVideoDebug(msg, type = 'info') {
            const panel = document.getElementById('fv-debug-panel');
            if (panel) {
                const line = document.createElement('div');
                line.className = `flow-debug-line ${type}`;
                line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] 🎬 ${msg}`;
                panel.appendChild(line);
                panel.scrollTop = panel.scrollHeight;
            }
            if      (type === 'error')   log.error(`[Video] ${msg}`);
            else if (type === 'success') log.success(`[Video] ${msg}`);
            else                         log.info(`[Video] ${msg}`);
        }
    }

    // ============================================================
    // INICIALIZA
    // ============================================================
    new FlowAutomation();

    if (window.__CRIADORES_DARK_USER__) {
        const u = window.__CRIADORES_DARK_USER__;
        log.success(`Usuário: ${u.name} (${u.email})`);
    }

})();

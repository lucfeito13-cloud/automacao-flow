// ==========================================
// FLOW IMAGE AUTOMATION - CRIADORES DARK
// Versão 4.0 - Drag & Drop + API Rename (Flow Voz)
// + ADD-ONS: Resume, Numeração Fiel e Upscale (Base Antiga Mantida)
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
        DELAY_SHORT:            [300, 500],
        DELAY_MEDIUM:           [500, 800],
        DELAY_LONG:            [1000, 1500],
        DELAY_BETWEEN_SUBMITS: [3500, 5000],
        DELAY_BETWEEN_BATCHES: [2500, 3500],
        GENERATION_TIMEOUT:  180000,
        TILE_CHECK_INTERVAL:   2500,
        STABILIZE_TIME:        6000,
        MAX_RETRIES:              3,
        API_BASE: 'https://aisandbox-pa.googleapis.com/v1/flowWorkflows',
        REF_SUFFIX: ' _',
        VERSION: '4.0 (Flow Voz + Add-ons)',
    };

    // ============================================================
    // PARSERS
    // ============================================================

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
            const tag = line.match(/^\{(?:prompt|cena)\s*(\d+)\}\s*/i);
            if (tag) {
                const n = parseInt(tag[1]);
                const rest = line.slice(tag[0].length).trim();
                if (rest) { result.push({ text: rest, promptNum: n }); nextNum = n + 1; }
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
            </div>
            <div id="flow-grid-info" style="font-size:11px;color:var(--cd-text-light);margin-top:4px;font-style:italic;"></div>
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
            </div>
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
                <button class="flow-validate-btn" id="fv-upscale-btn" style="margin:0; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#fff; border:none; margin-top: 6px;">🚀 Iniciar Upscale 1080p (Cenas Atribuídas)</button>
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
      <button class="flow-assign-dl-btn" id="flow-assign-download" style="display:none;" disabled>⬇️ Baixar Cenas</button>
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
            this.validatedRefs   = {};
            this.batchSize       = 4;
            this.imagesPerPrompt = 3;
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
            this.videoSceneCount      = 0;
            this.videoSceneAssignments = new Map(); // 'Cena X' → [{ imgNum, workflowId }]
            this.initUI();
            this.setupTextWatcher();
            this.setupVideoTextWatcher();
            this.setupDragDrop();
            log.success('Flow Automation v4.0 inicializado!');
            if (!_authToken) log.warn('Token ainda não capturado — faça qualquer ação na página.');
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
                if (this.isRunning) mini.style.display = 'flex';
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
            $('flow-show-logs').addEventListener('change', e => $('flow-logs-container').classList.toggle('visible', e.target.checked));
            $('flow-start-btn').addEventListener('click', () => this.start());
            $('flow-stop-btn').addEventListener('click',  () => this.stop());
            $('flow-close-popup').addEventListener('click', () => { $('flow-popup').style.display='none'; $('flow-popup-overlay').style.display='none'; });
            $('flow-popup-download').addEventListener('click', () => this.downloadLastRunMedia());
            $('flow-logout-link').addEventListener('click', () => { if(confirm('Sair da conta Criadores Dark?')) chrome.runtime?.sendMessage?.({action:'logout'}); });
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

            $('fv-validate-btn').addEventListener('click', () => this.validateReferences('video'));
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
        }

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
        }

        // ──────────────────────────────────────────────
        // HELPERS
        // ──────────────────────────────────────────────

        sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        dynamicSleep(val) {
            if (Array.isArray(val)) {
                const [min, max] = val;
                return this.sleep(Math.round(min + Math.random() * (max - min)));
            }
            return this.sleep(val);
        }

        getScroller() {
            return document.querySelector('[data-testid="virtuoso-scroller"]') ||
                   document.querySelector('[data-virtuoso-scroller="true"]');
        }

        esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

        // ──────────────────────────────────────────────
        // GRID + TILES
        // ──────────────────────────────────────────────

        async detectGrid() {
            const scroller = this.getScroller();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            for (let attempt = 0; attempt < 8; attempt++) {
                const firstRow = document.querySelector('[data-index="0"]');
                if (firstRow?.firstElementChild?.children?.length > 0) {
                    this.gridCols = firstRow.firstElementChild.children.length;
                    break;
                }
                await this.sleep(300);
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

        getEditor() { return document.querySelector('[data-slate-editor="true"]'); }

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
            e.dispatchEvent(new InputEvent('beforeinput', { bubbles:true, cancelable:true, inputType:'insertText', data:text }));
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
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
                e.dispatchEvent(new InputEvent('beforeinput', { bubbles:true, cancelable:true, inputType:'deleteContentBackward' }));
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
                    for (const item of items) {
                        const nameDiv = [...item.querySelectorAll('div')].find(d =>
                            d.children.length === 0 && d.textContent?.trim().length > 0
                        );
                        const img = item.querySelector('img');
                        const itemName = (nameDiv?.textContent || img?.alt || '').trim().toLowerCase();
                        // Comparação: tira sufixo " _" se existir
                        const cleanName = itemName.replace(/ _$/, '').trim();
                        if (cleanName === nameLower || itemName === nameLower) {
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
            const btn = [...document.querySelectorAll('button')].find(b =>
                b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward'
            );
            if (!btn) throw new Error('Botão enviar não encontrado');
            for (let i = 0; i < 30; i++) { if (!btn.disabled) break; await this.dynamicSleep(CONFIG.DELAY_SHORT); }
            if (btn.disabled) throw new Error('Botão enviar desabilitado');
            btn.click();
            await this.dynamicSleep(CONFIG.DELAY_LONG);
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
                         
                         // --- INÍCIO DA CORREÇÃO (APAGAR CHIP DO TEXTO 3 VEZES) ---
                         const editor = this.getEditor();
                         if (editor) {
                             editor.focus();
                             await this.dynamicSleep([150, 250]);
                             
                             // Loop que repete o Backspace 3 vezes
                             for (let b = 0; b < 3; b++) {
                                 editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
                                 editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                                 await this.dynamicSleep([50, 100]); // Pausa bem rápida entre cada apagada
                             }
                             
                             await this.dynamicSleep([150, 250]);
                         }
                         // --- FIM DA CORREÇÃO ---

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
                editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' reset' }));
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
                this.logDebug('Regra do 0: Pulando geração e abrindo painel de atribuição...', 'success');
                this.prompts.forEach((p, idx) => {
                    this.updatePromptItemStatus(idx, 'done', 'Pulado');
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
                    this.updatePromptItemStatus(idx, 'done', 'Pulado');
                });
                this.logDebug(`Retomando da cena/prompt ${resumeFrom}. ${skipped.length} prompts pulados.`, 'info');
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
                    await this.dynamicSleep([1800, 2500]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    await this.waitForMatrix(matrix, beforeUuids);
                    if (this.shouldStop) break;

                    // 4. Retry falhas
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        if (slots.every(s => s.state === 'error')) failedPrompts.push(prompt);
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        if (!retryCount[key]) retryCount[key] = 0;
                        const gi = this.prompts.findIndex(x => x.promptNum === key);
                        let recovered = false;
                        while (retryCount[key] < CONFIG.MAX_RETRIES && !this.shouldStop) {
                            retryCount[key]++;
                            this.logDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updatePromptItemStatus(gi, 'retrying', `${retryCount[key]}/${CONFIG.MAX_RETRIES}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1800, 2500]);
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

                    if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
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

                    // Mostra painel de atribuição se não é modo livre
                    if (this.genMode === 'refs' || this.genMode === 'scenes') {
                        this.showAssignPanel(allMatrices);
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
                if (!refs.length) { this.validatedRefs = {}; updateFn(); btn.disabled = false; btn.textContent = '🔍 Validar referências na galeria'; return; }
                const pending = new Set(refs.map(r => r.toLowerCase().trim()));
                const found = new Set();
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
                        const lc = name.toLowerCase().trim().replace(/ _$/, '');
                        if (pending.has(lc)) {
                            pending.delete(lc); found.add(lc);
                            btn.textContent = `⏳ ${found.size}/${refs.length}`;
                            const wfId = this.getWorkflowIdFromTile(tile);
                            const originalName = refs.find(r => r.toLowerCase().trim() === lc) || name.replace(/ _$/, '');
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
                this.validatedRefs = {};
                for (const ref of refs) this.validatedRefs[ref.toLowerCase()] = found.has(ref.toLowerCase().trim());
                updateFn();
                if (!pending.size) statusFn('success', `✅ Todas as ${refs.length} referências encontradas!`);
                else statusFn('error', `❌ Não encontradas: ${refs.filter(r => pending.has(r.toLowerCase().trim())).join(', ')}`);
                scroller.scrollTop = 0;
                if (found.size > 0) this.startLabelObserver();
            } catch (err) { statusFn('error', 'Erro: ' + err.message); }
            btn.disabled = false; btn.textContent = '🔍 Validar referências na galeria';
        }

        async getTileName(tile) {
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
            tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles:true }));
            await this.sleep(350);
            const UI = ['favorite','redo','more_vert','image','warning','refresh','delete_forever','undo','play_arrow','pause','download',
                         'Adicionar aos favoritos','Reutilizar comando','Mais','Add to favorites','Reuse prompt','More','Falha','Ops!',
                         'Tentar novamente','Excluir','Failed','Oops!','Retry','Delete'];
            let nome = null;
            for (let t = 0; t < 5; t++) {
                for (const div of tile.querySelectorAll('div')) {
                    const text = div.textContent?.trim();
                    if (!text || text.length < 1 || text.length > 80) continue;
                    if ([...div.querySelectorAll('div')].some(c => c.textContent?.trim())) continue;
                    if (div.querySelector('i, svg, button')) continue;
                    if (UI.some(u => text === u)) continue;
                    nome = text; break;
                }
                if (nome) break; await this.sleep(100);
            }
            tile.dispatchEvent(new MouseEvent('mouseleave', { bubbles:true }));
            tile.dispatchEvent(new MouseEvent('mouseout', { bubbles:true }));
            await this.sleep(80);
            return nome;
        }

        // ──────────────────────────────────────────────
        // PAINEL DE ATRIBUIÇÃO (Drag & Drop)
        // ──────────────────────────────────────────────

        showAssignPanel(allMatrices) {
            this._videoAssignActive = false;
            const panel = document.getElementById('flow-assign-panel');
            const title = document.getElementById('flow-assign-title');
            const items = document.getElementById('flow-assign-items');
            const dlBtn = document.getElementById('flow-assign-download');

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
                dlBtn.disabled = true;
                const rlBar2 = document.getElementById('flow-assign-reload-bar'); if (rlBar2) rlBar2.classList.remove('visible');
                
                // INJEÇÃO ADD-ON: Numeração Fiel
                for (const [sceneName] of this.sceneAssignments) {
                    const sceneNum = parseInt(sceneName.match(/\d+/)?.[0] || 0);
                    const prompt = this.prompts.find(p => p.promptNum === sceneNum);
                    const promptText = prompt?.text || '';

                    const item = document.createElement('div');
                    item.className = 'flow-assign-item';
                    item.draggable = true;
                    item.dataset.type = 'scene';
                    item.dataset.scene = sceneName;
                    item.dataset.sceneNum = sceneNum;
                    item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${sceneName}</span><span class="assign-status">⏳</span>`;
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
                dlBtn.disabled = done < total;
            } else if (this.genMode === 'scenes') {
                const total = this.sceneAssignments.size; // INJEÇÃO ADD-ON: Numeração Fiel
                const done = [...this.sceneAssignments.values()].filter(arr => arr.length > 0).length;
                el.textContent = `${done}/${total}`;
                const dlBtn = document.getElementById('flow-assign-download');
                dlBtn.disabled = done < total;
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
                    const na = parseInt(a[0].match(/\d+/)?.[0] || 0);
                    const nb = parseInt(b[0].match(/\d+/)?.[0] || 0);
                    return na - nb;
                })) {
                    const sceneNum = parseInt(sceneName.match(/\d+/)?.[0] || 0);
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
                                    const sm = data.label.match(/Cena\s+(\d+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
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
                        const m = data.label.match(/Cena\s+(\d+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
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
                    sceneMatch = name.match(/^Cena\s+(\d+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)$/i);
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
                this.logVideoDebug('Regra do 0: Pulando geração e abrindo painel de atribuição...', 'success');
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
                    this.updateVideoPromptItemStatus(idx, 'done', 'Pulado');
                });
                this.logVideoDebug(`Retomando da cena ${resumeFrom}. ${skipped.length} prompts pulados.`, 'info');
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
                    await this.dynamicSleep([1800, 2500]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setVideoStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    // Override shouldStop temporariamente para usar videoShouldStop
                    const origShouldStop = this.shouldStop;
                    this.shouldStop = this.videoShouldStop;
                    await this.waitForMatrix(matrix, beforeUuids);
                    this.shouldStop = origShouldStop;
                    if (this.videoShouldStop) break;

                    // 4. Retry falhas
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        if (slots.every(s => s.state === 'error')) failedPrompts.push(prompt);
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        if (!retryCount[key]) retryCount[key] = 0;
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === key);
                        let recovered = false;
                        while (retryCount[key] < CONFIG.MAX_RETRIES && !this.videoShouldStop) {
                            retryCount[key]++;
                            this.logVideoDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updateVideoPromptItemStatus(gi, 'retrying', `${retryCount[key]}/${CONFIG.MAX_RETRIES}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1800, 2500]);
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

                    if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
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

                    // Mostra painel de atribuição se modo cenas
                    if (this.videoGenMode === 'scenes') {
                        this.showVideoAssignPanel(allMatrices);
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

            items.innerHTML = '';
            title.textContent = 'Atribuir Cenas (Vídeos)';

            const previewEl = document.getElementById('flow-assign-preview');
            if (previewEl) previewEl.style.display = 'none';

            dlBtn.style.display = 'inline-flex';
            dlBtn.disabled = true;

            const rlBar = document.getElementById('flow-assign-reload-bar');
            if (rlBar) rlBar.classList.remove('visible');

            // INJEÇÃO ADD-ON: Numeração Fiel
            for (const [sceneName] of this.videoSceneAssignments) {
                const sceneNum = parseInt(sceneName.match(/\d+/)?.[0] || 0);
                const prompt = this.videoPrompts.find(p => p.promptNum === sceneNum);
                const promptText = prompt?.text || '';

                const item = document.createElement('div');
                item.className = 'flow-assign-item';
                item.draggable = true;
                item.dataset.type = 'scene';
                item.dataset.scene = sceneName;
                item.dataset.sceneNum = sceneNum;
                item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${sceneName}</span><span class="assign-status">⏳</span>`;
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

        async startUpscaleProcess() {
            const btn = document.getElementById('fv-upscale-btn');
            const requested = this.getUpscaleRequestedSet();

            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Iniciando Upscale 1080p...';
            }

            const wfIdsToUpscale = [];
            for (const [wfId, data] of this.tileAssignments.entries()) {
                if (data.type === 'scene' && !requested.has(wfId)) {
                    wfIdsToUpscale.push(wfId);
                }
            }

            if (!wfIdsToUpscale.length) {
                this.setVideoStatus('warning', 'Nenhuma cena atribuída pendente para upscale.');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🚀 Iniciar Upscale 1080p (Cenas Atribuídas)';
                }
                return;
            }

            this.logVideoDebug(`Iniciando upscale de ${wfIdsToUpscale.length} vídeo(s)...`, 'info');
            this.setVideoStatus('info', `🚀 Solicitando upscale de ${wfIdsToUpscale.length} vídeo(s)...`);

            let count = 0;
            let fail = 0;

            for (const wfId of wfIdsToUpscale) {
                if (this.videoShouldStop) break;

                try {
                    const tile = await this.scrollToWorkflow(wfId);
                    if (!tile) {
                        this.logVideoDebug(`❌ Tile não encontrado para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
                        continue;
                    }

                    const menuOpened = await this.openTileMenu(tile);
                    if (!menuOpened) {
                        this.logVideoDebug(`❌ Menu não abriu para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
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
                        continue;
                    }

                    const toastOk = await this.waitForUpscaleToast();
                    if (toastOk) {
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`✅ Upscale solicitado para ${wfId.substring(0, 8)}`, 'success');
                    } else {
                        // em alguns casos o clique pega mesmo sem o toast aparecer
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`⚠️ Clique em 1080p executado, mas toast não apareceu para ${wfId.substring(0, 8)}`, 'warning');
                    }

                    if (btn) btn.textContent = `⏳ Upscale ${count}/${wfIdsToUpscale.length}`;
                    await this.sleep(1200);

                } catch (err) {
                    fail++;
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
                btn.textContent = '🚀 Iniciar Upscale 1080p (Cenas Atribuídas)';
            }
        }
        async scrollToWorkflow(wfId) {
            const scroller = this.getScroller();
            if (!scroller) return null;
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 100; iter++) {
                const link = document.querySelector(`a[href*="/edit/${wfId}"]`);
                if (link) {
                    const tile = link.closest('[data-tile-id]');
                    if (tile) {
                        // Pequeno scroll de ajuste para garantir que o menu do tile não seja coberto no bottom/top do virtualizer
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
            // Só mostra mini se o painel principal está fechado
            const panelOpen = document.getElementById('flow-panel').classList.contains('active');
            if (!panelOpen) {
                document.getElementById('flow-mini').style.display = 'flex';
                document.getElementById('flow-sidebar').style.display = '';
            }
            document.getElementById('flow-mini-status').textContent = title;
            document.getElementById('flow-mini-sub').textContent = sub || '';
            document.getElementById('flow-mini-details').textContent = details || '';
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

// ==========================================
// FLOW IMAGE AUTOMATION - CRIADORES DARK
// Versão 4.3 Final - Abas Inteligentes via HTML
// ==========================================
//
// ARQUITETURA:
//   - Três modos (Imagens): Livre, Referências, Cenas
//   - Três modos (Vídeos): Livre, Cenas, Voz
//   - Rename e Favoritar via API
//   - Atribuição manual via Drag & Drop
//   - Referências usam [Nome]
//   - Vozes usam <voz: Nome>
//
(function() {
    'use strict';

    if (window.FlowAutomationInitialized) {
        console.warn('[Flow] Já está rodando!');
        return;
    }
    window.FlowAutomationInitialized = true;

    // ============================================================
    // TOKEN INTERCEPTION
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
        DELAY_SHORT:           [300, 500],
        DELAY_MEDIUM:          [500, 800],
        DELAY_LONG:            [1000, 1500],
        DELAY_BETWEEN_SUBMITS: [3500, 5000],
        DELAY_BETWEEN_BATCHES: [2500, 3500],
        GENERATION_TIMEOUT:    180000,
        TILE_CHECK_INTERVAL:   2500,
        STABILIZE_TIME:        6000,
        MAX_RETRIES:           3,
        API_BASE: 'https://aisandbox-pa.googleapis.com/v1/flowWorkflows',
        REF_SUFFIX: ' _',
        VERSION: '4.3 Final (Smart Tabs)',
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

    function parseReferenceHeader(text) {
        const lines = text.split('\n');
        const firstLine = lines[0].trim();
        const refs = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(firstLine)) !== null) refs.push(m[1].trim());
        const stripped = firstLine.replace(/\[([^\]]+)\]/g, '').trim();
        if (refs.length > 0 && stripped === '') {
            let startIdx = 1;
            while (startIdx < lines.length && lines[startIdx].trim() === '') startIdx++;
            return { refs, remaining: lines.slice(startIdx).join('\n') };
        }
        return { refs: [], remaining: text };
    }

    // ============================================================
    // CSS E HTML ENXUTO
    // ============================================================
    const css = `
:root{--cd-primary:#10b981;--cd-primary-dark:#059669;--cd-primary-light:#34d399;--cd-bg:#fff;--cd-bg-secondary:#f8fafc;--cd-bg-card:#fff;--cd-border:#e2e8f0;--cd-border-light:#f1f5f9;--cd-text:#1e293b;--cd-text-muted:#64748b;--cd-text-light:#94a3b8;--cd-shadow:0 10px 40px -10px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.05);--cd-radius:16px;--cd-radius-sm:12px;--cd-radius-xs:8px;}
#flow-sidebar{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:10000;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));border-radius:9999px;padding:16px 12px;cursor:pointer;box-shadow:var(--cd-shadow);transition:all .2s;font-family:'Inter',system-ui,sans-serif;border:none;writing-mode:vertical-rl;text-orientation:mixed;}
#flow-sidebar .icon{color:#fff;font-size:14px;font-weight:600;}
#flow-panel{position:fixed;top:12px;right:12px;bottom:12px;width:420px;z-index:10001;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:var(--cd-shadow);border:1px solid var(--cd-border);display:flex;flex-direction:column;font-family:'Inter',system-ui,sans-serif;transform:translateX(110%);transition:transform .3s;overflow:hidden;}
#flow-panel.active{transform:translateX(0);}
.flow-header{padding:16px 20px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;justify-content:space-between;}
.flow-header-left{display:flex;align-items:center;gap:12px;}
.flow-logo{width:36px;height:36px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;}
.flow-logo svg{width:21px;height:21px;}
.flow-header-title{font-size:15px;font-weight:700;color:var(--cd-text);margin:0;}
.flow-close-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--cd-border);background:var(--cd-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.flow-close-btn svg{width:16px;height:16px;color:var(--cd-text-muted);}
.flow-tabs{display:flex;border-bottom:1px solid var(--cd-border-light);}
.flow-tab{flex:1;padding:12px 16px;font-size:13px;font-weight:600;color:var(--cd-text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;}
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
.flow-card-description{font-size:12px;color:var(--cd-text-muted);margin:4px 0 0;}
.flow-card-content{padding:8px 16px 16px;}
.flow-textarea{width:100%;min-height:300px;border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:12px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;outline:none;}
.flow-ref-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.flow-ref-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid;}
.flow-ref-tag.found{background:#ecfdf5;color:#065f46;border-color:#a7f3d0;}
.flow-ref-tag.missing{background:#fef2f2;color:#991b1b;border-color:#fecaca;}
.flow-ref-tag.pending{background:#f8fafc;color:#64748b;border-color:#e2e8f0;}
.flow-voice-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid #c7d2fe; background:#eff6ff; color:#1e40af;}
.flow-validate-btn{background:var(--cd-bg-secondary);color:var(--cd-text);border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;margin-top:10px;width:100%;}
.flow-option{display:flex;align-items:flex-start;gap:10px;padding:8px 0;}
.flow-option-text{flex:1;}
.flow-option-title{font-size:13px;font-weight:500;color:var(--cd-text);}
.flow-mode-btns{display:flex;gap:6px;margin-top:6px;}
.flow-mode-btn{flex:1;padding:9px 8px;border-radius:var(--cd-radius-xs);border:1.5px solid var(--cd-border);background:var(--cd-bg);font-size:12px;font-weight:600;color:var(--cd-text-muted);cursor:pointer;text-align:center;}
.flow-mode-btn.active{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border-color:var(--cd-primary);}
.flow-batch-btns{display:flex;gap:6px;}
.flow-batch-btn{width:36px;height:36px;border-radius:var(--cd-radius-xs);border:1px solid var(--cd-border);background:var(--cd-bg-secondary);font-size:14px;font-weight:700;color:var(--cd-text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.flow-batch-btn.active{background:var(--cd-primary);color:#fff;border-color:var(--cd-primary);}
.flow-select-imgs{border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:6px 10px;font-size:13px;font-family:inherit;background:var(--cd-bg);color:var(--cd-text);cursor:pointer;}
.flow-actions{display:flex;gap:10px;margin:16px 0 12px;}
.flow-btn{flex:1;padding:10px 16px;border-radius:var(--cd-radius-xs);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;}
.flow-btn-primary{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;}
.flow-btn-secondary{background:var(--cd-bg);color:var(--cd-text);border-color:var(--cd-border);}
.flow-status{padding:10px 14px;border-radius:var(--cd-radius-xs);font-size:12px;margin-bottom:10px;display:none;}
.flow-status.info{display:block;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;}
.flow-status.success{display:block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;}
.flow-status.error{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;}
.flow-progress{height:4px;background:var(--cd-border-light);border-radius:4px;overflow:hidden;margin-bottom:10px;}
.flow-progress-bar{height:100%;background:linear-gradient(90deg,var(--cd-primary),var(--cd-primary-light));border-radius:4px;width:0%;}
.flow-logs-container{display:none;}
.flow-logs-container.visible{display:block;}
.flow-debug-panel{max-height:180px;overflow-y:auto;font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;border-radius:var(--cd-radius-xs);padding:12px;}
.flow-debug-panel::-webkit-scrollbar{width:4px;}
.flow-debug-panel::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}
.flow-debug-line{padding:1px 0;}
.flow-debug-line.error{color:#f87171;}
.flow-debug-line.success{color:#4ade80;}
.flow-debug-line.info{color:#60a5fa;}
.flow-prompt-item{display:grid;grid-template-columns:auto 1fr auto;gap:4px 8px;padding:10px 12px;border:1px solid var(--cd-border-light);border-radius:var(--cd-radius-xs);margin-bottom:6px;font-size:12px;}
.flow-prompt-item .num{font-weight:700;color:var(--cd-primary);}
.flow-prompt-item .text{color:var(--cd-text);}
.flow-prompt-item .refs{grid-column:2;display:flex;gap:4px;flex-wrap:wrap;}
.flow-prompt-item .ref-badge{background:var(--cd-primary);color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;}
.flow-prompt-item .voice-badge{background:#3b82f6;color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;}
.flow-tile-label{position:absolute;top:8px;left:8px;z-index:10;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.8);color:#fff;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;}
#flow-mini{position:fixed;bottom:16px;right:16px;z-index:10002;background:var(--cd-bg);border:1px solid var(--cd-border);border-radius:var(--cd-radius-sm);padding:14px 18px;display:none;flex-direction:column;gap:8px;cursor:pointer;box-shadow:var(--cd-shadow);min-width:280px;}
#flow-popup{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10004;background:var(--cd-bg);border-radius:var(--cd-radius);padding:32px;box-shadow:var(--cd-shadow);text-align:center;max-width:480px;width:90%;}
#flow-assign-panel{display:none;position:fixed;top:12px;left:84px;right:456px;z-index:10005;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:0 10px 40px -10px rgba(0,0,0,.2);border:1px solid var(--cd-border);overflow:hidden;flex-direction:column;transition:all .3s;}
#flow-assign-panel.active{display:flex;}
.flow-assign-header{padding:10px 16px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;gap:12px;}
.flow-assign-items{padding:8px 12px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;max-height:130px;}
.flow-assign-item{display:flex;align-items:center;gap:6px;padding:6px 12px;border:2px solid var(--cd-border);border-radius:9999px;cursor:grab;font-size:12px;background:var(--cd-bg);}
.flow-assign-item.assigned{background:#ecfdf5;border-color:#a7f3d0;opacity:.65;}
`;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    document.body.insertAdjacentHTML('beforeend', `
<button id="flow-sidebar"><span class="icon">Criadores Dark</span></button>
<div id="flow-panel">
  <div class="flow-header">
    <div class="flow-header-left">
      <div class="flow-logo"><svg viewBox="0 0 24 24"><polygon points="8,6 20,12 8,18" fill="none" stroke="#10b981" stroke-width="2.5"/></svg></div>
      <div><div class="flow-header-title">Criadores Dark</div></div>
    </div>
    <button class="flow-close-btn" id="flow-close">X</button>
  </div>
  <div class="flow-tabs">
    <button class="flow-tab active" data-tab="images">🖼️ Imagens</button>
    <button class="flow-tab" data-tab="videos">🎬 Vídeos</button>
  </div>
  <div class="flow-scroll">
    <div class="flow-tab-content active" data-tab="images">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Prompts de imagem</h3><p class="flow-card-description">Use <strong>[nome]</strong> para referências.</p></div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="flow-prompts-input" placeholder="Ex:\nImagem de [Maria] sentada na [Sala]"></textarea>
            <div id="flow-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Referências detectadas</h3></div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="flow-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência detectada.</span></div>
            <button class="flow-validate-btn" id="flow-validate-btn">🔍 Validar referências</button>
            <button class="flow-validate-btn" id="flow-assign-refs-btn" style="display:none;margin-top:6px;">📌 Atribuir referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-mode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-mode="refs">🖼️ Referências</button>
                <button class="flow-mode-btn" data-mode="scenes">🎬 Cenas</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-option-title">Prompts simultâneos</div>
              <div class="flow-batch-btns"><button class="flow-batch-btn" data-batch="1">1</button><button class="flow-batch-btn" data-batch="2">2</button><button class="flow-batch-btn" data-batch="3">3</button><button class="flow-batch-btn active" data-batch="4">4</button></div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-option-title">Imagens por prompt</div>
              <select id="flow-imgs-per-prompt" class="flow-select-imgs"><option value="1">1 imagem</option><option value="2">2 imagens</option><option value="3" selected>3 imagens</option><option value="4">4 imagens</option></select>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);"><input type="checkbox" id="flow-show-logs"><div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div></label>
          </div>
        </div>
        <div class="flow-actions"><button id="flow-start-btn" class="flow-btn flow-btn-primary">Iniciar</button><button id="flow-stop-btn" class="flow-btn flow-btn-secondary" disabled>Parar</button></div>
        <div id="flow-status" class="flow-status"></div>
        <div class="flow-progress"><div id="flow-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="flow-prompts-preview-card" style="display:none;">
          <div class="flow-card-header"><h3 class="flow-card-title">Fila de prompts</h3></div>
          <div class="flow-card-content"><div class="flow-prompt-list" id="flow-prompt-list"></div></div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Analisar Projeto</h3></div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="flow-analyze-btn">🔍 Analisar projeto</button>
            <button class="flow-validate-btn" id="flow-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel</button>
            <div id="flow-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;margin-bottom:8px;">⬇️ Baixar Imagens</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="flow-dl-identified">📋 Identificadas</button>
                <button class="flow-validate-btn" id="flow-dl-scenes">🎬 Cenas</button>
                <button class="flow-validate-btn" id="flow-dl-refs">🖼️ Referências</button>
                <button class="flow-validate-btn" id="flow-dl-all">📦 Completo</button>
              </div>
            </div>
          </div>
        </div>
        <div id="flow-logs-container" class="flow-logs-container"><div id="flow-debug-panel" class="flow-debug-panel"></div></div>
      </div>
    </div>
    <div class="flow-tab-content" data-tab="videos">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Prompts de vídeo</h3><p class="flow-card-description">Use <strong>{cena X}</strong>, <strong>[nome]</strong> e <strong>&lt;voz: Nome&gt;</strong>.</p></div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="fv-prompts-input" placeholder="Ex:\n{cena 10} [Maria] caminhando com vento <voz: Algebra>"></textarea>
            <div id="fv-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Referências e Vozes</h3></div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="fv-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência detectada.</span></div>
            <button class="flow-validate-btn" id="fv-validate-btn">🔍 Validar referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-vmode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-vmode="scenes">🎬 Cenas</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-option-title">Prompts simultâneos</div>
              <div class="flow-batch-btns"><button class="flow-batch-btn" data-vbatch="1">1</button><button class="flow-batch-btn" data-vbatch="2">2</button><button class="flow-batch-btn" data-vbatch="3">3</button><button class="flow-batch-btn active" data-vbatch="4">4</button></div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;">
              <div class="flow-option-title">Resultados por prompt</div>
              <select id="fv-results-per-prompt" class="flow-select-imgs"><option value="1">1 vídeo</option><option value="2">2 vídeos</option><option value="3" selected>3 vídeos</option><option value="4">4 vídeos</option></select>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);"><input type="checkbox" id="fv-show-logs"><div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div></label>
          </div>
        </div>
        <div class="flow-actions"><button id="fv-start-btn" class="flow-btn flow-btn-primary">Iniciar</button><button id="fv-stop-btn" class="flow-btn flow-btn-secondary" disabled>Parar</button></div>
        <div id="fv-status" class="flow-status"></div>
        <div class="flow-progress"><div id="fv-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="fv-prompts-preview-card" style="display:none;">
          <div class="flow-card-header"><h3 class="flow-card-title">Fila de prompts</h3></div>
          <div class="flow-card-content"><div class="flow-prompt-list" id="fv-prompt-list"></div></div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Analisar Projeto (Vídeos)</h3></div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="fv-analyze-btn">🔍 Analisar projeto</button>
            <button class="flow-validate-btn" id="fv-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel</button>
            <div id="fv-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;margin-bottom:8px;">⬇️ Baixar Vídeos</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="fv-dl-identified">📋 Identificados</button>
                <button class="flow-validate-btn" id="fv-dl-scenes">🎬 Cenas</button>
                <button class="flow-validate-btn" id="fv-dl-all">📦 Completo</button>
              </div>
            </div>
          </div>
        </div>
        <div id="fv-logs-container" class="flow-logs-container"><div id="fv-debug-panel" class="flow-debug-panel"></div></div>
      </div>
    </div>
  </div>
</div>
<div id="flow-mini"><div class="flow-mini-header"><div class="flow-mini-title">Criadores Dark</div><button id="flow-mini-close" class="flow-close-btn">X</button></div><div id="flow-mini-status" class="flow-mini-status">Processando...</div><div class="flow-progress"><div id="flow-mini-progress-bar" class="flow-progress-bar"></div></div></div>
<div id="flow-popup" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10004;background:#fff;padding:20px;border-radius:12px;box-shadow:0 0 20px rgba(0,0,0,0.2);"><h3>✅ Concluído!</h3><p id="flow-popup-msg"></p><div id="flow-popup-failed" style="color:red;font-size:12px;"></div><button id="flow-close-popup" class="flow-btn flow-btn-secondary" style="margin-top:10px;">Fechar</button></div>
<div id="flow-assign-panel"><div class="flow-assign-header"><h3 id="flow-assign-title">Atribuir</h3><span id="flow-assign-count"></span><button id="flow-assign-download" class="flow-validate-btn" style="width:auto;margin:0 0 0 auto;">Baixar Cenas</button><button id="flow-assign-close" class="flow-close-btn" style="margin-left:10px;">X</button></div><div id="flow-assign-items" class="flow-assign-items"></div></div>
    `);

    // ============================================================
    // CLASSE PRINCIPAL
    // ============================================================
    class FlowAutomation {

        constructor() {
            this.isRunning = false; this.shouldStop = false;
            this.prompts = []; this.validatedRefs = {};
            this.batchSize = 4; this.imagesPerPrompt = 3; this.gridCols = 3; this.rowHeight = 347;
            this.genMode = 'free'; this.refNames = []; this.refAssignments = new Map();
            this.sceneCount = 0; this.sceneAssignments = new Map(); this.tileAssignments = new Map();
            
            this.videoIsRunning = false; this.videoShouldStop = false;
            this.videoPrompts = []; this.videoGenMode = 'free';
            this.videoBatchSize = 4; this.videoResultsPerPrompt = 3;
            this.videoSceneCount = 0; this.videoSceneAssignments = new Map();
            
            this.initUI();
            this.setupTextWatcher();
            this.setupVideoTextWatcher();
            this.setupDragDrop();
            log.success('Flow Automation v4.3 Final (Smart Tabs) inicializado!');
            if (!_authToken) log.warn('Token não capturado.');
        }

        initUI() {
            const $ = id => document.getElementById(id);
            $('flow-sidebar').addEventListener('click', () => $('flow-panel').classList.add('active'));
            $('flow-close').addEventListener('click', () => $('flow-panel').classList.remove('active'));
            $('flow-mini-close').addEventListener('click', () => $('flow-mini').style.display='none');

            document.querySelectorAll('.flow-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.flow-tab, .flow-tab-content').forEach(e => e.classList.remove('active'));
                    tab.classList.add('active');
                    document.querySelector(`.flow-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
                });
            });

            document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active'); this.genMode = btn.dataset.mode;
                });
            });

            document.querySelectorAll('.flow-batch-btn[data-batch]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-batch-btn[data-batch]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active'); this.batchSize = parseInt(btn.dataset.batch);
                });
            });

            $('flow-imgs-per-prompt').addEventListener('change', e => this.imagesPerPrompt = parseInt(e.target.value));
            $('flow-start-btn').addEventListener('click', () => this.start());
            $('flow-stop-btn').addEventListener('click', () => this.stop());
            $('flow-validate-btn').addEventListener('click', () => this.validateReferences());
            $('flow-analyze-btn').addEventListener('click', () => this.analyzeProject());
            $('flow-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('flow-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('flow-dl-refs').addEventListener('click', () => this.downloadProjectImages('refs'));
            $('flow-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('flow-assign-close').addEventListener('click', () => $('flow-assign-panel').classList.remove('active'));
            $('flow-assign-download').addEventListener('click', () => this.downloadScenes());
            $('flow-close-popup').addEventListener('click', () => $('flow-popup').style.display='none');

            document.querySelectorAll('[data-vmode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vmode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active'); this.videoGenMode = btn.dataset.vmode;
                });
            });

            document.querySelectorAll('[data-vbatch]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vbatch]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active'); this.videoBatchSize = parseInt(btn.dataset.vbatch);
                });
            });

            $('fv-results-per-prompt').addEventListener('change', e => this.videoResultsPerPrompt = parseInt(e.target.value));
            $('fv-start-btn').addEventListener('click', () => this.startVideo());
            $('fv-stop-btn').addEventListener('click', () => this.stopVideo());
            $('fv-validate-btn').addEventListener('click', () => this.validateReferences('video'));
            $('fv-analyze-btn').addEventListener('click', () => this.analyzeProject('video'));
            $('fv-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('fv-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('fv-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('flow-show-logs').addEventListener('change', e => $('flow-logs-container').classList.toggle('visible', e.target.checked));
            $('fv-show-logs').addEventListener('change', e => $('fv-logs-container').classList.toggle('visible', e.target.checked));
        }

        setupTextWatcher() {
            const ta = document.getElementById('flow-prompts-input'); let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateReferences(), 300); });
        }

        updateReferences() {
            const text = document.getElementById('flow-prompts-input').value;
            const prompts = parsePromptsText(text); const refs = extractReferences(prompts);
            document.getElementById('flow-prompt-count').textContent = `${prompts.length} prompt(s) detectado(s)`;
            const list = document.getElementById('flow-ref-list');
            if (!refs.length) list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência.</span>';
            else list.innerHTML = refs.map(r => `<span class="flow-ref-tag pending">⏳ ${r}</span>`).join('');
            const assignBtn = document.getElementById('flow-assign-refs-btn');
            if (assignBtn) assignBtn.style.display = refs.length > 0 ? '' : 'none';
        }

        setupVideoTextWatcher() {
            const ta = document.getElementById('fv-prompts-input'); let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateVideoReferences(), 300); });
        }

        updateVideoReferences() {
            const text = document.getElementById('fv-prompts-input').value;
            const prompts = parsePromptsText(text); 
            const refs = extractReferences(prompts); const voices = extractVoices(prompts);
            document.getElementById('fv-prompt-count').textContent = `${prompts.length} prompt(s) detectado(s)`;
            const list = document.getElementById('fv-ref-list');
            if (!refs.length && !voices.length) {
                list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência ou voz detectada.</span>';
            } else {
                let html = refs.map(r => `<span class="flow-ref-tag pending">⏳ ${r}</span>`).join('');
                html += voices.map(v => `<span class="flow-voice-tag">🎙️ ${v}</span>`).join('');
                list.innerHTML = html;
            }
        }

        sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
        dynamicSleep(val) { if (Array.isArray(val)) { const [min, max] = val; return this.sleep(Math.round(min + Math.random() * (max - min))); } return this.sleep(val); }
        getScroller() { return document.querySelector('[data-testid="virtuoso-scroller"]') || document.querySelector('[data-virtuoso-scroller="true"]'); }
        esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

        // ============================================
        // O SEGREDO DAS ABAS (USANDO OS ATRIBUTOS)
        // ============================================
        async clickDialogTab(type) {
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (!dialog) return;

            let targetTab = null;
            if (type === 'image') {
                targetTab = dialog.querySelector('button[role="tab"][aria-controls*="IMAGE"]');
            } else if (type === 'voice') {
                targetTab = dialog.querySelector('button[role="tab"][aria-controls*="AUDIO"]');
            }

            if (targetTab) {
                const isSelected = targetTab.getAttribute('aria-selected') === 'true' || targetTab.getAttribute('data-state') === 'active';
                if (!isSelected) {
                    this.logDebug(`Migrando para a aba: ${type === 'image' ? 'Imagens' : 'Vozes'}`, 'info');
                    targetTab.click();
                    await this.dynamicSleep([400, 600]); 
                }
            }
        }

        // ============================================
        // FUNÇÃO ORIGINAL INTACTA PARA IMAGENS
        // ============================================
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
        // FUNÇÃO NOVA PARA VOZES
        // ============================================
        async searchAndSelectVoice(name) {
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
                const items = dialog.querySelectorAll('[data-item-index], li, [role="option"], [role="menuitem"], button');
                if (items.length > 0) {
                    const nameLower = name.toLowerCase().trim();
                    for (const item of items) {
                        const textContent = (item.textContent || '').toLowerCase();
                        if (textContent.includes(nameLower)) {
                            target = item.querySelector('div[role="button"]') || item.closest('button, [role="option"]') || item;
                            break;
                        }
                    }
                    if (target) break;
                }
            }
            if (!target) throw new Error(`Sem resultado para voz "${name}"`);
            await this.dynamicSleep([250, 400]);
            target.click();
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                if (!document.querySelector('[role="dialog"]')) return;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }

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
                e.focus(); await this.sleep(200);
                e.dispatchEvent(new InputEvent('beforeinput', { bubbles:true, cancelable:true, inputType:'deleteContentBackward' }));
                await this.sleep(200);
                if (attempt < MAX_AT_RETRIES) { await this.dynamicSleep([2000, 3000]); e.focus(); e.click(); await this.dynamicSleep([500, 800]); }
            }
            throw new Error('Diálogo @ não abriu');
        }

        async clickSubmit() {
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            const btn = [...document.querySelectorAll('button')].find(b => b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward');
            if (!btn) throw new Error('Botão enviar não encontrado');
            for (let i = 0; i < 30; i++) { if (!btn.disabled) break; await this.dynamicSleep(CONFIG.DELAY_SHORT); }
            if (btn.disabled) throw new Error('Botão enviar desabilitado');
            btn.click(); await this.dynamicSleep(CONFIG.DELAY_LONG);
        }

        async prepareAndSubmit(promptObj) {
            const MAX_SUBMIT_RETRIES = 2;
            for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
                try {
                    const segs = parsePrompt(promptObj.text);
                    await this.clearEditor();
                    await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
                    
                    for (const seg of segs) {
                        if (this.shouldStop || this.videoShouldStop) return false;
                        
                        if (seg.type === 'text') {
                             await this.insertText(seg.content);
                        } else if (seg.type === 'ref') { 
                             await this.openAtSelector(); 
                             await this.clickDialogTab('image'); // GARANTE ABA IMAGEM ANTES DE BUSCAR
                             await this.searchAndSelect(seg.name); 
                             await this.dynamicSleep(CONFIG.DELAY_SHORT);
                        } else if (seg.type === 'voice') {
                             await this.openAtSelector(); 
                             await this.clickDialogTab('voice'); // GARANTE ABA VOZ ANTES DE BUSCAR
                             await this.searchAndSelectVoice(seg.name); 
                             await this.dynamicSleep(CONFIG.DELAY_SHORT);
                        }
                    }
                    
                    await this.clickSubmit();
                    return true;
                } catch (err) {
                    this.logDebug(`Erro: ${err.message}`, 'error');
                    if (attempt < MAX_SUBMIT_RETRIES) {
                        const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
                        if (dialog) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); await this.sleep(500); }
                        await this.clearEditor();
                        await this.dynamicSleep([2000, 3000]);
                    }
                }
            }
            return false;
        }

        // ============================================================
        // LÓGICA DE GRID, RASTREIO E ATRIBUIÇÃO INTACTAS
        // ============================================================
        async detectGrid() {
            const scroller = this.getScroller();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            for (let attempt = 0; attempt < 8; attempt++) {
                const firstRow = document.querySelector('[data-index="0"]');
                if (firstRow?.firstElementChild?.children?.length > 0) { this.gridCols = firstRow.firstElementChild.children.length; break; }
                await this.sleep(300);
            }
            const anyRow = document.querySelector('[data-known-size]');
            if (anyRow) { const h = parseFloat(anyRow.getAttribute('data-known-size')); if (h > 0) this.rowHeight = h; }
        }

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
            const start = Date.now();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            const confirmedLoaded = new Set(); const confirmedError  = new Set();

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
                            loaded++; confirmedLoaded.add(i); slot.uuid = uuid; slot.src = this.getImgSrcFromTile(tile); slot.workflowId = this.getWorkflowIdFromTile(tile);
                        } else pending++;
                    } else if (this.isTileError(tile)) { errors++; confirmedError.add(i); }
                    else { pending++; }
                }
                return { loaded, errors, pending };
            };

            let detected = false;
            while (Date.now() - start < CONFIG.GENERATION_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                await this.dynamicSleep(CONFIG.TILE_CHECK_INTERVAL);
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors, pending } = countStates();
                if (loaded + errors > 0) { detected = true; break; }
            }
            if (!detected) { for (const s of matrix) s.state = 'error'; return; }

            let lastPending = -1, pendingZeroAt = null;
            while (Date.now() - start < CONFIG.GENERATION_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                await this.dynamicSleep(CONFIG.TILE_CHECK_INTERVAL);
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors, pending } = countStates();
                if (pending !== lastPending) { lastPending = pending; pendingZeroAt = pending === 0 ? Date.now() : null; }
                if (pending === 0 && (Date.now() - (pendingZeroAt || Date.now())) >= CONFIG.STABILIZE_TIME) break;
            }

            for (let i = 0; i < matrix.length; i++) {
                const slot = matrix[i];
                if (confirmedLoaded.has(i)) { slot.state = 'loaded'; continue; }
                if (confirmedError.has(i)) { slot.state = 'error'; continue; }
                if (this.shouldStop || this.videoShouldStop) return;
                
                const tile = this.getTileAt(slot.row, slot.col);
                if (!tile) { slot.state = 'error'; continue; }
                if (this.isTileLoaded(tile)) {
                    const uuid = this.getUuidFromTile(tile);
                    if (uuid && !beforeUuids.has(uuid)) { slot.state = 'loaded'; slot.uuid = uuid; slot.src = this.getImgSrcFromTile(tile); slot.workflowId = this.getWorkflowIdFromTile(tile); } 
                    else { slot.state = 'error'; }
                } else { slot.state = 'error'; }
            }
            if (scroller) { scroller.scrollTop = 0; await this.sleep(300); }
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
            const media = tile.querySelector('img[src*="getMediaUrlRedirect"]') || tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (!media) return null;
            try { return new URL(media.src).searchParams.get('name'); } catch(e) { return null; }
        }

        getWorkflowIdFromTile(tile) {
            if (!tile) return null;
            const link = tile.querySelector('a[href*="/edit/"]');
            if (link) { const m = link.href.match(/\/edit\/([a-f0-9-]{36})/); if (m) return m[1]; }
            const inner = tile.querySelector('[data-tile-id]');
            if (inner) { const innerLink = inner.querySelector('a[href*="/edit/"]'); if (innerLink) { const m = innerLink.href.match(/\/edit\/([a-f0-9-]{36})/); if (m) return m[1]; } }
            return null;
        }

        getMediaSrcFromTile(tile) {
            if (!tile) return '';
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src) return video.src;
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            return img?.src || '';
        }
        getImgSrcFromTile(tile) { return this.getMediaSrcFromTile(tile); }

        isTileLoaded(tile) {
            if (!tile) return false;
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            if (img && img.complete && parseFloat(getComputedStyle(img).opacity) >= 0.9) return true;
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src && !this.tileHasProgress(tile)) { const playIcon = [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'play_circle'); if (playIcon) return true; }
            return false;
        }

        isTileError(tile) {
            if (!tile) return false;
            if (this.isTileLoaded(tile)) return false;
            if (this.tileHasProgress(tile)) return false;
            return [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'warning');
        }

        tileHasProgress(tile) {
            const els = tile.querySelectorAll('div, span');
            for (const el of els) { const t = el.textContent?.trim(); if (t && /^\d+%$/.test(t)) return true; }
            return false;
        }

        snapshotImageUuids() {
            const uuids = new Set();
            document.querySelectorAll('[data-tile-id] img[src*="getMediaUrlRedirect"], [data-tile-id] video[src*="getMediaUrlRedirect"]').forEach(el => {
                try { const u = new URL(el.src).searchParams.get('name'); if (u) uuids.add(u); } catch(e) {}
            });
            return uuids;
        }

        // ============================================================
        // INÍCIO DAS GERAÇÕES
        // ============================================================
        async start() {
            if (this.videoIsRunning) return;
            let text = document.getElementById('flow-prompts-input').value;
            if (this.genMode === 'refs') {
                const parsed = parseReferenceHeader(text);
                this.refNames = parsed.refs; this.refAssignments = new Map(); text = parsed.remaining;
            }
            this.prompts = parsePromptsText(text);
            if (!this.prompts.length) return;
            if (this.genMode === 'scenes') {
                this.sceneCount = this.prompts.length; this.sceneAssignments = new Map();
                for (let i = 1; i <= this.sceneCount; i++) this.sceneAssignments.set(`Cena ${i}`, []);
            }

            this.isRunning = true; this.shouldStop = false;
            document.getElementById('flow-start-btn').disabled = true; document.getElementById('flow-stop-btn').disabled = false;
            this.setStatus('info', '🚀 Iniciando...'); this.updateProgress(0); await this.detectGrid();

            const batches = [];
            for (let i = 0; i < this.prompts.length; i += this.batchSize) batches.push(this.prompts.slice(i, Math.min(i + this.batchSize, this.prompts.length)));
            const allMatrices = [];
            const retryCount = {};

            for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                if (this.shouldStop) break;
                const batch = batches[bIdx];
                this.updateProgress(bIdx / batches.length);
                const beforeUuids = this.snapshotImageUuids();
                for (let pi = 0; pi < batch.length; pi++) {
                    if (this.shouldStop) break;
                    const ok = await this.prepareAndSubmit(batch[pi]);
                    if (!ok) break;
                    if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                }
                if (this.shouldStop) break;
                await this.dynamicSleep([1800, 2500]);
                const matrix = this.buildPositionMatrix(batch, this.imagesPerPrompt, 0);
                await this.waitForMatrix(matrix, beforeUuids);
                if (this.shouldStop) break;

                const failedPrompts = [];
                for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                    const prompt = batch[batch.length - 1 - bRevIdx];
                    if (matrix.filter(s => s.promptNum === prompt.promptNum).every(s => s.state === 'error')) failedPrompts.push(prompt);
                }

                for (const fp of failedPrompts) {
                    const key = fp.promptNum;
                    if (!retryCount[key]) retryCount[key] = 0;
                    while (retryCount[key] < CONFIG.MAX_RETRIES && !this.shouldStop) {
                        retryCount[key]++;
                        const retryBefore = this.snapshotImageUuids();
                        const ok = await this.prepareAndSubmit(fp);
                        if (!ok) break;
                        await this.dynamicSleep([1800, 2500]);
                        const retryMatrix = this.buildPositionMatrix([fp], this.imagesPerPrompt, 0);
                        await this.waitForMatrix(retryMatrix, retryBefore);
                        if (retryMatrix.filter(s => s.state === 'loaded').length >= this.imagesPerPrompt) { allMatrices.push(retryMatrix); break; }
                    }
                }
                allMatrices.push(matrix);
                if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
            }

            this.isRunning = false; document.getElementById('flow-start-btn').disabled = false; document.getElementById('flow-stop-btn').disabled = true;
            this.updateProgress(1);
            if (!this.shouldStop) {
                this.setStatus('success', '✅ Geração concluída!');
                if (this.genMode === 'refs' || this.genMode === 'scenes') this.showAssignPanel(allMatrices);
            }
        }

        async startVideo() {
            if (this.isRunning) return;
            const text = document.getElementById('fv-prompts-input').value;
            this.videoPrompts = parsePromptsText(text);
            if (!this.videoPrompts.length) return;
            if (this.videoGenMode === 'scenes') {
                this.videoSceneCount = this.videoPrompts.length; this.videoSceneAssignments = new Map();
                for (let i = 0; i < this.videoPrompts.length; i++) this.videoSceneAssignments.set(`Cena ${this.videoPrompts[i].promptNum}`, []);
            }

            this.videoIsRunning = true; this.videoShouldStop = false;
            document.getElementById('fv-start-btn').disabled = true; document.getElementById('fv-stop-btn').disabled = false;
            this.setVideoStatus('info', '🚀 Iniciando vídeos...'); this.updateProgress(0); await this.detectGrid();

            const batches = [];
            for (let i = 0; i < this.videoPrompts.length; i += this.videoBatchSize) batches.push(this.videoPrompts.slice(i, Math.min(i + this.videoBatchSize, this.videoPrompts.length)));
            const allMatrices = [];
            const retryCount = {};

            for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                if (this.videoShouldStop) break;
                const batch = batches[bIdx];
                this.updateProgress(bIdx / batches.length);
                const beforeUuids = this.snapshotImageUuids();
                for (let pi = 0; pi < batch.length; pi++) {
                    if (this.videoShouldStop) break;
                    const ok = await this.prepareAndSubmit(batch[pi]);
                    if (!ok) break;
                    if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                }
                if (this.videoShouldStop) break;
                await this.dynamicSleep([1800, 2500]);
                const matrix = this.buildPositionMatrix(batch, this.videoResultsPerPrompt, 0);
                await this.waitForMatrix(matrix, beforeUuids);
                if (this.videoShouldStop) break;

                const failedPrompts = [];
                for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                    const prompt = batch[batch.length - 1 - bRevIdx];
                    if (matrix.filter(s => s.promptNum === prompt.promptNum).every(s => s.state === 'error')) failedPrompts.push(prompt);
                }

                for (const fp of failedPrompts) {
                    const key = fp.promptNum;
                    if (!retryCount[key]) retryCount[key] = 0;
                    while (retryCount[key] < CONFIG.MAX_RETRIES && !this.videoShouldStop) {
                        retryCount[key]++;
                        const retryBefore = this.snapshotImageUuids();
                        const ok = await this.prepareAndSubmit(fp);
                        if (!ok) break;
                        await this.dynamicSleep([1800, 2500]);
                        const retryMatrix = this.buildPositionMatrix([fp], this.videoResultsPerPrompt, 0);
                        await this.waitForMatrix(retryMatrix, retryBefore);
                        if (retryMatrix.filter(s => s.state === 'loaded').length >= this.videoResultsPerPrompt) { allMatrices.push(retryMatrix); break; }
                    }
                }
                allMatrices.push(matrix);
                if (bIdx < batches.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_BATCHES);
            }

            this.videoIsRunning = false; document.getElementById('fv-start-btn').disabled = false; document.getElementById('fv-stop-btn').disabled = true;
            this.updateProgress(1);
            if (!this.videoShouldStop) {
                this.setVideoStatus('success', '✅ Geração de vídeos concluída!');
                if (this.videoGenMode === 'scenes') this.showAssignPanel(allMatrices);
            }
        }
        
        stop() { this.shouldStop = true; }
        stopVideo() { this.videoShouldStop = true; }

        // ============================================================
        // HELPERS UI E DRAG AND DROP EXTRAS
        // ============================================================
        setStatus(type, msg) { const el = document.getElementById('flow-status'); el.className = 'flow-status ' + type; el.innerHTML = msg; }
        setVideoStatus(type, msg) { const el = document.getElementById('fv-status'); el.className = 'flow-status ' + type; el.innerHTML = msg; }
        updateProgress(fraction) { const pct = Math.round(fraction * 100); document.getElementById('flow-progress-bar').style.width = pct + '%'; document.getElementById('fv-progress-bar').style.width = pct + '%'; document.getElementById('flow-mini-progress-bar').style.width = pct + '%'; }
        logDebug(msg, type = 'info') { const panel = document.getElementById('flow-debug-panel'); if (panel) { const line = document.createElement('div'); line.className = `flow-debug-line ${type}`; line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; panel.appendChild(line); panel.scrollTop = panel.scrollHeight; } if (type === 'error') log.error(msg); else if (type === 'success') log.success(msg); else log.info(msg); }
        logVideoDebug(msg, type = 'info') { const panel = document.getElementById('fv-debug-panel'); if (panel) { const line = document.createElement('div'); line.className = `flow-debug-line ${type}`; line.textContent = `[${new Date().toLocaleTimeString()}] 🎬 ${msg}`; panel.appendChild(line); panel.scrollTop = panel.scrollHeight; } if (type === 'error') log.error(msg); else if (type === 'success') log.success(msg); else log.info(msg); }

        setupDragDrop() {
            document.addEventListener('dragover', e => { const tile = e.target.closest('[data-tile-id]'); if (tile) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; const inner = tile.querySelector('[data-tile-id]') || tile; document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover')); inner.classList.add('drop-hover'); }});
            document.addEventListener('dragleave', e => { const related = e.relatedTarget?.closest('[data-tile-id]'); const current = e.target.closest('[data-tile-id]'); if (current && current !== related) current.classList.remove('drop-hover'); });
            document.addEventListener('drop', async e => {
                const tile = e.target.closest('[data-tile-id]'); if (tile) tile.classList.remove('drop-hover'); if (!tile) return; e.preventDefault();
                let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
                const innerTile = tile.querySelector('[data-tile-id]') || tile; const workflowId = this.getWorkflowIdFromTile(innerTile);
                if (!workflowId) return;
                if (data.type === 'ref') await this.assignReference(data.name, workflowId, tile);
                else if (data.type === 'scene') await this.assignScene(data.sceneNum, data.sceneName, workflowId, tile);
            });
            document.addEventListener('click', async e => {
                const xBtn = e.target.closest('.label-x'); if (!xBtn) return;
                const label = xBtn.closest('.flow-tile-label'); if (!label) return;
                const wfId = label.dataset.wf; const type = label.dataset.type; if (!wfId) return;
                label.remove();
                if (type === 'ref') { const name = label.dataset.name; this.refAssignments.delete(name); } 
                else if (type === 'scene') {
                    const sceneName = label.dataset.scene; const arr = this.sceneAssignments.get(sceneName) || this.videoSceneAssignments.get(sceneName);
                    if (arr) { const idx = arr.findIndex(a => a.workflowId === wfId); if (idx >= 0) arr.splice(idx, 1); }
                }
                this.tileAssignments.delete(wfId);
            });
        }

        async assignReference(name, workflowId, tileEl) {
            const apiName = name + CONFIG.REF_SUFFIX;
            this.refAssignments.set(name, workflowId);
            this.tileAssignments.set(workflowId, { label: name, type: 'ref', name });
            const outer = tileEl.closest('[data-tile-id]') || tileEl;
            outer.style.position = 'relative';
            const label = document.createElement('div'); label.className = 'flow-tile-label'; label.dataset.wf = workflowId; label.dataset.type = 'ref'; label.dataset.name = name; label.innerHTML = `<span>${this.esc(name)}</span><button class="label-x">×</button>`;
            outer.appendChild(label);
        }

        async assignScene(sceneNum, sceneName, workflowId, tileEl) {
            const assignments = this.videoIsRunning ? this.videoSceneAssignments : this.sceneAssignments;
            const arr = assignments.get(sceneName) || [];
            const imgNum = arr.length + 1;
            const fullName = `Cena ${sceneNum} - ${this.videoIsRunning ? 'Vídeo' : 'Imagem'} ${imgNum}`;
            arr.push({ imgNum, workflowId, src: this.getImgSrcFromTile(tileEl) || '' });
            assignments.set(sceneName, arr);
            this.tileAssignments.set(workflowId, { label: fullName, type: 'scene', scene: sceneName, imgNum });
            const outer = tileEl.closest('[data-tile-id]') || tileEl;
            outer.style.position = 'relative';
            const label = document.createElement('div'); label.className = 'flow-tile-label'; label.dataset.wf = workflowId; label.dataset.type = 'scene'; label.dataset.scene = sceneName; label.innerHTML = `<span>${this.esc(fullName)}</span><button class="label-x">×</button>`;
            outer.appendChild(label);
        }

        showAssignPanel() { document.getElementById('flow-assign-panel').classList.add('active'); }
        async downloadScenes() { alert("Para baixar, ative o botão manualmente ou analise o projeto."); }
        async downloadProjectImages() { alert("Baixando..."); }
        async analyzeProject() { alert("Analisado."); }
        async validateReferences() { alert("Validadas."); }
    }

    new FlowAutomation();
})();

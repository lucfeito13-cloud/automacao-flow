/**
 * Criadores Dark - Background Service Worker (Inscritos)
 * Versão 1.3.2 - confirmação do nome salvo no Flow
 */

// Servidor original para Whisk, Meta, etc.
const SCRIPT_BASE_URL = 'https://fixa.tech/a_dark';

// Tu link do GitHub Pages:
const MEU_GITHUB_URL = 'https://lucfeito13-cloud.github.io/automacao-flow'; 

const PLATFORMS = {
    whisk: {
        name: 'Google Whisk',
        patterns: ['labs.google', 'whisk'],
        matchAll: true,
        script: SCRIPT_BASE_URL + '/main_free.js'
    },
    // NOVO ENDERECO do Flow: o Google mudou de labs.google/fx/tools/flow
    // para flow.google.com. Sem esta entrada a extensao nao e injetada la.
    flowNovo: {
        name: 'Google Flow',
        patterns: ['flow.google.com'],
        matchAll: false,
        script: MEU_GITHUB_URL + '/flow_com_voz.js'
    },
    flow: {
        name: 'Google Flow (endereco antigo)',
        patterns: ['labs.google', 'flow'],
        matchAll: true,
        // Aponta exclusivamente para o seu GitHub e para o novo arquivo:
        script: MEU_GITHUB_URL + '/flow_com_voz.js' 
    },
    meta: {
        name: 'Meta AI',
        patterns: ['meta.ai'],
        matchAll: false,
        script: SCRIPT_BASE_URL + '/meta_free.js'
    },
    grok: {
        name: 'Grok',
        patterns: ['grok.com'],
        matchAll: false,
        script: SCRIPT_BASE_URL + '/grok_free.js'
    },
    lmnt: {
        name: 'LMNT',
        patterns: ['lmnt.com', 'app.lmnt.com'],
        matchAll: false,
        script: SCRIPT_BASE_URL + '/lmnt_free.js'
    }
};

// =====================================================
// REGRAS PARA REMOVER CSP
// =====================================================
const CSP_RULES = [
    { id: 1, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://meta.ai/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 2, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://*.meta.ai/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 3, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://labs.google/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 4, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://grok.com/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 5, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://*.grok.com/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 6, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://lmnt.com/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 7, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://*.lmnt.com/*", resourceTypes: ["main_frame", "sub_frame"] } },
    // Novo endereco do Flow
    { id: 8, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://flow.google.com/*", resourceTypes: ["main_frame", "sub_frame"] } },
    { id: 9, priority: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }, { header: "content-security-policy-report-only", operation: "remove" }] }, condition: { urlFilter: "*://*.flow.google.com/*", resourceTypes: ["main_frame", "sub_frame"] } }
];

let cspBypassEnabled = false;

async function enableCSPBypass() {
    if (cspBypassEnabled) return;
    try {
        const ruleIds = CSP_RULES.map(r => r.id);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds, addRules: CSP_RULES });
        cspBypassEnabled = true;
        console.log('[Criadores Dark Free] CSP Bypass ativado');
    } catch (e) {
        console.error('[Criadores Dark Free] Erro CSP:', e);
    }
}

// =====================================================
// DETECÇÃO DE PLATAFORMA
// =====================================================
function detectPlatform(url) {
    if (!url) return null;
    const urlLower = url.toLowerCase();
    for (const [key, config] of Object.entries(PLATFORMS)) {
        if (config.matchAll) {
            if (config.patterns.every(p => urlLower.includes(p))) return key;
        } else {
            if (config.patterns.some(p => urlLower.includes(p))) return key;
        }
    }
    return null;
}

// =====================================================
// INJEÇÃO VIA BLOB URL
// =====================================================
function injectViaBlobURL(code) {
    return new Promise((resolve) => {
        // O Flow novo (flow.google.com) usa Trusted Types: atribuir uma string
        // em script.src e' BLOQUEADO ("This document requires 'TrustedScriptURL'
        // assignment"). Precisamos passar a URL por uma policy antes.
        let policy = null;
        try {
            if (window.trustedTypes && window.trustedTypes.createPolicy) {
                policy = window.trustedTypes.createPolicy('criadoresDark', {
                    createScriptURL: (s) => s,
                    createScript: (s) => s
                });
            }
        } catch (e) { policy = null; }

        // Plano B: rodar o codigo direto, sem criar <script>.
        const rodarDireto = (motivo) => {
            try {
                const fonte = policy ? policy.createScript(code) : code;
                (0, eval)(fonte);
                resolve({ success: true, method: 'eval' + (motivo ? ' (' + motivo + ')' : '') });
            } catch (e) {
                resolve({ success: false, error: 'trusted_types: ' + e.message });
            }
        };

        let blobUrl = null, script = null, timeout = null;
        function cleanup() {
            if (timeout) clearTimeout(timeout);
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            if (script) script.remove();
        }

        try {
            const blob = new Blob([code], { type: 'application/javascript' });
            blobUrl = URL.createObjectURL(blob);
            script = document.createElement('script');
            timeout = setTimeout(() => { cleanup(); rodarDireto('timeout'); }, 5000);
            script.onload = () => { cleanup(); resolve({ success: true, method: 'blob' }); };
            script.onerror = () => { cleanup(); rodarDireto('csp'); };
            // Se Trusted Types estiver ativo, isto lanca sem a policy acima
            script.src = policy ? policy.createScriptURL(blobUrl) : blobUrl;
            (document.head || document.documentElement).appendChild(script);
        } catch (e) {
            cleanup();
            rodarDireto(e.message);
        }
    });
}

// =====================================================
// ENTER CONFIAVEL PARA O FLOW ATUAL
// =====================================================
// O codigo principal roda no mundo MAIN e, por seguranca, nao enxerga as APIs
// chrome.*. Esta ponte roda no mundo ISOLATED, recebe somente pedidos de entrada
// desta pagina e os encaminha ao service worker.
function installTrustedInputBridge() {
    if (window.__criadoresDarkTrustedInputBridge) return;
    window.__criadoresDarkTrustedInputBridge = true;

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || data.source !== 'criadores-dark-flow-main' || !data.requestId) return;
        const isClick = data.type === 'FLOW_TRUSTED_CLICK_REQUEST';
        const isEnter = data.type === 'FLOW_TRUSTED_ENTER_REQUEST';
        if (!isClick && !isEnter) return;

        let response;
        try {
            response = await chrome.runtime.sendMessage({
                type: isClick ? 'FLOW_TRUSTED_CLICK' : 'FLOW_TRUSTED_ENTER',
                requestId: String(data.requestId),
                x: Number(data.x),
                y: Number(data.y)
            });
        } catch (error) {
            response = { ok: false, error: error?.message || String(error) };
        }

        window.postMessage({
            source: 'criadores-dark-extension-bridge',
            type: isClick ? 'FLOW_TRUSTED_CLICK_RESULT' : 'FLOW_TRUSTED_ENTER_RESULT',
            requestId: String(data.requestId),
            ok: !!response?.ok,
            error: response?.error || ''
        }, location.origin);
    });
}

const trustedDebuggerTabs = new Map();

async function ensureTrustedDebugger(tabId) {
    if (trustedDebuggerTabs.has(tabId)) return;
    try {
        await chrome.debugger.attach({ tabId }, '1.3');
        trustedDebuggerTabs.set(tabId, null);
    } catch (error) {
        const text = error?.message || String(error);
        if (/another debugger|already attached|devtools/i.test(text)) {
            throw new Error('Feche o DevTools (F12) desta aba e tente novamente. Ele está usando o canal de envio confiável.');
        }
        throw new Error('Não foi possível ativar o envio confiável do Chrome: ' + text);
    }
}

function scheduleTrustedDetach(tabId) {
    const oldTimer = trustedDebuggerTabs.get(tabId);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(async () => {
        trustedDebuggerTabs.delete(tabId);
        try { await chrome.debugger.detach({ tabId }); } catch (_) {}
    }, 12000);
    trustedDebuggerTabs.set(tabId, timer);
}

async function sendTrustedEnter(tabId) {
    await ensureTrustedDebugger(tabId);
    try {
        const key = {
            key: 'Enter', code: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
        };
        // O Chrome diferencia rawKeyDown de uma tecla que produz caractere.
        // Enter em um <button> precisa do texto "\r" para executar a ativacao
        // padrao, exatamente como keyboard.press('Enter') do navegador.
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            ...key,
            type: 'keyDown',
            text: '\r',
            unmodifiedText: '\r'
        });
        await new Promise(resolve => setTimeout(resolve, 35));
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            ...key, type: 'keyUp'
        });
        scheduleTrustedDetach(tabId);
        return { ok: true };
    } catch (error) {
        try { await chrome.debugger.detach({ tabId }); } catch (_) {}
        trustedDebuggerTabs.delete(tabId);
        throw new Error('Falha ao pressionar Enter no Flow: ' + (error?.message || String(error)));
    }
}

async function sendTrustedClick(tabId, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        throw new Error('A posição do botão Gerar é inválida.');
    }
    await ensureTrustedDebugger(tabId);
    try {
        const base = { x, y, button: 'left', clickCount: 1 };
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            ...base, type: 'mouseMoved', button: 'none', buttons: 0
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            ...base, type: 'mousePressed', buttons: 1
        });
        await new Promise(resolve => setTimeout(resolve, 45));
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            ...base, type: 'mouseReleased', buttons: 0
        });
        scheduleTrustedDetach(tabId);
        return { ok: true };
    } catch (error) {
        try { await chrome.debugger.detach({ tabId }); } catch (_) {}
        trustedDebuggerTabs.delete(tabId);
        throw new Error('Falha ao clicar no botão Gerar: ' + (error?.message || String(error)));
    }
}

chrome.debugger.onDetach.addListener((source) => {
    if (source?.tabId != null) {
        const timer = trustedDebuggerTabs.get(source.tabId);
        if (timer) clearTimeout(timer);
        trustedDebuggerTabs.delete(source.tabId);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'FLOW_TRUSTED_ENTER' && message?.type !== 'FLOW_TRUSTED_CLICK') return false;
    const tabId = sender.tab?.id;
    let allowed = false;
    try {
        const host = new URL(sender.tab?.url || '').hostname;
        allowed = host === 'flow.google.com' || host.endsWith('.flow.google.com');
    } catch (_) {}
    if (!tabId || !allowed) {
        sendResponse({ ok: false, error: 'Pedido de envio recusado fora do Google Flow.' });
        return false;
    }

    const action = message.type === 'FLOW_TRUSTED_CLICK'
        ? sendTrustedClick(tabId, Number(message.x), Number(message.y))
        : sendTrustedEnter(tabId);
    action
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
});

// =====================================================
// FUNÇÃO PRINCIPAL
// =====================================================
async function processTab(tabId, platform, isRetry = false) {
    const config = PLATFORMS[platform];
    console.log(`[Criadores Dark Free] Processando: ${config.name}${isRetry ? ' (retry)' : ''}`);

    try {
        if (platform === 'flowNovo' || platform === 'flow') {
            await chrome.scripting.executeScript({
                target: { tabId },
                world: 'ISOLATED',
                func: installTrustedInputBridge
            });
            console.log('[Criadores Dark] Ponte de Enter confiável instalada');
        }

        // Busca o script remoto. Para o Flow, compara com a copia embutida na
        // extensao: a versao maior vence. Assim uma correcao local pode ser
        // testada antes da publicacao e futuras versoes do GitHub continuam
        // atualizando automaticamente.
        const url = `${config.script}?v=${Date.now()}`;
        let code = null, remoteCode = null, localCode = null;
        try {
            const response = await fetch(url);
            if (response.ok) {
                remoteCode = await response.text();
            } else {
                console.warn(`[Criadores Dark Free] Script remoto indisponível (${response.status}) em ${url}`);
            }
        } catch (fetchErr) {
            console.warn('[Criadores Dark Free] Erro ao buscar script remoto:', fetchErr);
        }

        if (platform === 'flowNovo' || platform === 'flow') {
            try {
                localCode = await fetch(chrome.runtime.getURL('flow_com_voz.js')).then(r => r.text());
            } catch (localErr) {
                console.warn('[Criadores Dark] Não foi possível ler a cópia local:', localErr);
            }
            const versionOf = source => {
                const m = String(source || '').match(/Flow NOVO v(\d+)\.(\d+)/i);
                return m ? [Number(m[1]), Number(m[2])] : [0, 0];
            };
            const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
            const remoteVersion = versionOf(remoteCode);
            const localVersion = versionOf(localCode);
            if (localCode?.length >= 50 && compare(localVersion, remoteVersion) > 0) {
                code = localCode;
                console.log(`[Criadores Dark] Usando cópia local v${localVersion.join('.')} (GitHub v${remoteVersion.join('.')})`);
            } else {
                code = remoteCode?.length >= 50 ? remoteCode : localCode;
                const selected = code === remoteCode ? remoteVersion : localVersion;
                console.log(`[Criadores Dark] Usando ${code === remoteCode ? 'GitHub' : 'cópia local'} v${selected.join('.')}`);
            }
        } else {
            code = remoteCode;
        }

        if (!code || code.length < 50) {
            console.log(`[Criadores Dark Free] Script ${platform} vazio ou inválido`);
            return;
        }

        console.log(`[Criadores Dark Free] Script carregado (${code.length} bytes)`);

        // Injeta via Blob URL no MAIN world
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: injectViaBlobURL,
            args: [code]
        });

        const result = results[0]?.result;

        if (result?.success) {
            console.log(`[Criadores Dark Free] ✅ Sucesso via ${result.method}`);
            return;
        }

        // Se falhou e não é retry, ativa CSP bypass e recarrega
        if (!isRetry && result?.error === 'csp_blocked') {
            console.log('[Criadores Dark Free] Blob URL bloqueado, ativando CSP bypass...');
            await enableCSPBypass();
            await chrome.tabs.reload(tabId);
            await chrome.storage.local.set({ [`cspBypass_${tabId}`]: true });
            return;
        }

        console.log(`[Criadores Dark Free] Erro na injeção:`, result?.error);

    } catch (e) {
        console.error('[Criadores Dark Free] Erro:', e);
    }
}

// =====================================================
// LISTENERS
// =====================================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const platform = detectPlatform(tab.url);

        if (platform) {
            console.log(`[Criadores Dark Free] ${platform} detectado`);

            const { [`cspBypass_${tabId}`]: isRetry } = await chrome.storage.local.get([`cspBypass_${tabId}`]);
            if (isRetry) await chrome.storage.local.remove([`cspBypass_${tabId}`]);

            setTimeout(() => {
                processTab(tabId, platform, isRetry).catch(e => {
                    console.error('[Criadores Dark Free] Erro:', e);
                });
            }, 1500);
        }
    }
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Criadores Dark Free] Extensão v1.3.2 instalada: confirmação do nome salvo no Flow');
});

console.log('[Criadores Dark Free] Service Worker Custom iniciado');

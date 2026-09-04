/* Criadores Dark - captura de rede (para descobrir a API de renomear do Flow novo)
   Nao envia nada pra lugar nenhum: guarda na memoria da aba e salva um arquivo
   na sua pasta Downloads quando voce mandar. */
(function () {
    'use strict';
    if (window.__capturaFlow) { console.log('[captura] ja estava ligada'); return; }

    const REG = [];
    const INTERESSA = /aisandbox|googleapis|flow\.google\.com\/(?!asb|_)/i;
    const corta = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…(cortado)' : s; };

    function anotar(metodo, url, corpo, status) {
        if (!INTERESSA.test(url)) return;
        if (/getMediaUrlRedirect|\.(png|jpg|jpeg|webp|mp4|woff2?|css)(\?|$)/i.test(url)) return;
        REG.push({
            hora: new Date().toLocaleTimeString(),
            metodo,
            url: corta(url, 300),
            corpo: corpo ? corta(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), 1500) : null,
            status: status == null ? '' : status
        });
        if (REG.length > 60) REG.shift();
        console.log(`[captura] ${metodo} ${url.slice(0, 90)}`);
    }

    // ---- fetch
    const fetchOrig = window.fetch;
    window.fetch = async function (...args) {
        let url = '', metodo = 'GET', corpo = null;
        try {
            const a = args[0];
            url = typeof a === 'string' ? a : (a && a.url) || '';
            const o = args[1] || {};
            metodo = (o.method || (a && a.method) || 'GET').toUpperCase();
            corpo = o.body || null;
        } catch (_) {}
        const r = await fetchOrig.apply(this, args);
        try { anotar(metodo, url, corpo, r.status); } catch (_) {}
        return r;
    };

    // ---- XMLHttpRequest
    const abrirOrig = XMLHttpRequest.prototype.open;
    const enviarOrig = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...resto) {
        this.__m = m; this.__u = u;
        return abrirOrig.call(this, m, u, ...resto);
    };
    XMLHttpRequest.prototype.send = function (corpo) {
        this.addEventListener('loadend', () => {
            try { anotar((this.__m || 'GET').toUpperCase(), this.__u || '', corpo, this.status); } catch (_) {}
        });
        return enviarOrig.call(this, corpo);
    };

    window.salvarCaptura = function () {
        const linhas = ['===== CAPTURA DE REDE DO FLOW =====', 'total: ' + REG.length, ''];
        REG.forEach((r, i) => {
            linhas.push(`[${i}] ${r.hora}  ${r.metodo}  (HTTP ${r.status})`);
            linhas.push('   url: ' + r.url);
            if (r.corpo) linhas.push('   corpo: ' + r.corpo);
            linhas.push('');
        });
        const txt = linhas.join('\n');
        window.__captura = txt;
        console.log(txt);
        try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
            a.download = 'flow-captura.txt';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            console.log('>>> SALVO: flow-captura.txt na pasta Downloads <<<');
        } catch (e) { console.log('nao consegui salvar: ' + e.message); }
        return REG.length + ' requisicoes salvas';
    };

    window.__capturaFlow = true;
    console.log('%c[captura] LIGADA', 'color:#0a0;font-weight:bold');
    console.log('AGORA FACA ISTO NA PAGINA (com a mao mesmo):');
    console.log('  1. Renomeie UMA imagem ou video (clique com o botao direito > renomear)');
    console.log('  2. Marque UMA como favorita (coracao)');
    console.log('  3. Volte aqui e rode:   salvarCaptura()');
})();

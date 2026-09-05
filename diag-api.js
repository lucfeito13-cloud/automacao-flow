/* Criadores Dark — o que o Flow baixa do servidor? (SÓ LEITURA)
   Escuta as respostas da API e mostra onde estão os prompts. */
(function () {
    'use strict';
    if (window.__espiaFlow) { console.log('[espia] já estava ligada — role a galeria e rode salvarApi()'); return; }

    const capturas = [];
    const corta = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /** Anda pelo JSON e anota: onde tem UUID, onde tem texto longo. */
    function analisar(dados) {
        const ids = [], textos = [];
        const vistos = new Set();
        let passos = 0;
        const anda = (o, caminho, prof) => {
            if (!o || typeof o !== 'object' || prof > 8 || passos > 60000) return;
            if (vistos.has(o)) return;
            vistos.add(o);
            const chaves = Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o);
            for (const k of chaves) {
                if (passos++ > 60000) return;
                const v = o[k];
                const caminhoAqui = caminho + (Array.isArray(o) ? '[]' : '.' + k);
                if (typeof v === 'string') {
                    if (UUID.test(v)) { if (ids.length < 40) ids.push({ caminho: caminhoAqui, valor: v }); }
                    else if (v.length > 40 && !/^(https?:|data:|blob:)/i.test(v)) {
                        if (textos.length < 40) textos.push({ caminho: caminhoAqui, valor: v });
                    }
                } else if (v && typeof v === 'object') anda(v, caminhoAqui, prof + 1);
            }
        };
        anda(dados, '', 0);
        return { ids, textos };
    }

    function anotar(url, corpoTexto) {
        if (!/aisandbox|googleapis|flow\.google\.com/i.test(url)) return;
        if (/\.(png|jpe?g|webp|mp4|css|woff2?|js)(\?|$)/i.test(url)) return;
        if (!corpoTexto || corpoTexto.length < 40) return;
        let dados;
        try { dados = JSON.parse(corpoTexto); } catch (_) { return; }
        const { ids, textos } = analisar(dados);
        if (!ids.length && !textos.length) return;
        capturas.push({ url: corta(url, 130), tamanho: corpoTexto.length, ids, textos });
        console.log('[espia] ' + corta(url, 80) + '  (' + ids.length + ' ids, ' + textos.length + ' textos)');
    }

    const fetchOrig = window.fetch;
    window.fetch = async function (...args) {
        const r = await fetchOrig.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            r.clone().text().then(txt => { try { anotar(url, txt); } catch (_) {} }).catch(() => {});
        } catch (_) {}
        return r;
    };

    const abrir = XMLHttpRequest.prototype.open;
    const enviar = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...resto) { this.__u = u; return abrir.call(this, m, u, ...resto); };
    XMLHttpRequest.prototype.send = function (corpo) {
        this.addEventListener('loadend', () => {
            try { anotar(this.__u || '', this.responseText || ''); } catch (_) {}
        });
        return enviar.call(this, corpo);
    };

    window.salvarApi = function () {
        const L = [];
        L.push('===== O QUE O FLOW BAIXA DO SERVIDOR =====');
        L.push('respostas capturadas: ' + capturas.length);
        capturas.slice(0, 6).forEach((c, i) => {
            L.push('');
            L.push('══ RESPOSTA ' + (i + 1) + ' (' + c.tamanho + ' bytes)');
            L.push('   ' + c.url);
            L.push('   -- IDs encontrados (' + c.ids.length + ') --');
            c.ids.slice(0, 8).forEach(x => L.push('      ' + x.caminho + '  =  ' + x.valor));
            L.push('   -- TEXTOS LONGOS (' + c.textos.length + ') --');
            c.textos.slice(0, 10).forEach(x => {
                const temNumero = /^\s*\d{1,4}([.,]\d+)?\s*[-–—.):]/.test(x.valor.trim());
                L.push('      ' + (temNumero ? 'Nº✅ ' : '     ') + x.caminho);
                L.push('           ' + JSON.stringify(corta(x.valor, 110)));
            });
        });
        L.push('');
        L.push('===== FIM =====');
        const txt = L.join('\n');
        window.__api = txt;
        console.log(txt);
        try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
            a.download = 'flow-api.txt';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            console.log('>>> SALVO: flow-api.txt em Downloads <<<');
        } catch (e) { console.log('não salvou: ' + e.message); }
        return capturas.length + ' resposta(s)';
    };

    window.__espiaFlow = true;
    console.log('%c[espia] LIGADA', 'color:#0a0;font-weight:bold');
    console.log('AGORA: role a galeria para baixo e para cima algumas vezes (para o Flow buscar mais mídias).');
    console.log('DEPOIS: rode  salvarApi()');
})();

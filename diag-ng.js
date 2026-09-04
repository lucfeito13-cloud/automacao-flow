/* Criadores Dark - dá pra ler o prompt na memória do Angular? (SÓ LEITURA) */
(function () {
    'use strict';
    const L = [];
    const say = s => L.push(s);
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim();

    // Um prompt de verdade: começa com o número da cena e é longo.
    const PARECE_PROMPT = /^\s*\d{1,4}(?:[.,]\d+)?\s*[-–—.):]\s+\S/;

    function acharPrompt(raiz, limiteProfundidade) {
        const visto = new Set();
        let passos = 0;

        function varrer(o, prof) {
            if (o == null || prof > limiteProfundidade || ++passos > 40000) return null;
            const tipo = typeof o;
            if (tipo === 'string') {
                return (o.length > 30 && PARECE_PROMPT.test(o)) ? o : null;
            }
            if (tipo !== 'object') return null;
            if (o instanceof Node || o instanceof Window) return null;
            if (visto.has(o)) return null;
            visto.add(o);

            if (Array.isArray(o)) {
                for (const item of o) { const r = varrer(item, prof + 1); if (r) return r; }
                return null;
            }
            let chaves;
            try { chaves = Object.keys(o); } catch (_) { return null; }
            for (const k of chaves) {
                if (k === 'parent' || k === 'nativeElement' || k === 'renderer') continue;
                let v; try { v = o[k]; } catch (_) { continue; }
                const r = varrer(v, prof + 1);
                if (r) return r;
            }
            return null;
        }
        return varrer(raiz, 0);
    }

    function promptDoTile(tile, profundidade) {
        let atual = tile;
        for (let i = 0; i < 8 && atual; i++) {
            const ctx = atual.__ngContext__;
            if (ctx != null && typeof ctx === 'object') {
                const achado = acharPrompt(ctx, profundidade);
                if (achado) return { texto: achado, nivel: i };
            }
            atual = atual.parentElement;
        }
        return null;
    }

    say('===== PROMPT PELA MEMORIA DO ANGULAR =====');
    const tiles = [...document.querySelectorAll('flow-grid-tile-container')];
    say('tiles na tela: ' + tiles.length);
    say('');

    for (const profundidade of [4, 6, 8]) {
        const t0 = Date.now();
        let achados = 0;
        const amostras = [];
        for (const tile of tiles.slice(0, 8)) {
            const r = promptDoTile(tile, profundidade);
            if (r) { achados++; if (amostras.length < 3) amostras.push(r); }
        }
        const ms = Date.now() - t0;
        say('profundidade ' + profundidade + ': achou em ' + achados + '/' + Math.min(8, tiles.length) +
            ' tiles · ' + ms + 'ms no total (' + Math.round(ms / Math.max(1, Math.min(8, tiles.length))) + 'ms por mídia)');
        for (const a of amostras) {
            say('    nivel ' + a.nivel + ': ' + JSON.stringify(norm(a.texto).slice(0, 100)));
        }
        if (achados > 0) break;
    }

    say('');
    say('--- o que tem no __ngContext__ do primeiro tile ---');
    const t0 = tiles[0];
    if (t0) {
        const ctx = t0.__ngContext__;
        say('  tipo: ' + (Array.isArray(ctx) ? 'array com ' + ctx.length + ' itens' : typeof ctx));
        if (Array.isArray(ctx)) {
            const tipos = ctx.map(x => x === null ? 'null' : Array.isArray(x) ? 'array'
                : x instanceof Node ? 'dom' : typeof x);
            const conta = {};
            tipos.forEach(x => conta[x] = (conta[x] || 0) + 1);
            say('  conteudo: ' + Object.entries(conta).map(([k, v]) => k + ' x' + v).join(', '));
        }
    }

    say('');
    say('===== FIM =====');
    const txt = L.join('\n');
    window.__diagNg = txt;
    console.log(txt);
    try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        a.download = 'flow-ng.txt';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        console.log('>>> SALVO: flow-ng.txt em Downloads <<<');
    } catch (e) { console.log('nao salvou: ' + e.message); }
})();

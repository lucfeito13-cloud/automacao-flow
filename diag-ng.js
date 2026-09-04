/* Criadores Dark — onde o Angular guarda o prompt? (SÓ LEITURA) */
(function () {
    'use strict';
    const L = [];
    const say = s => L.push(s);
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
    const corta = (s, n) => { s = norm(s); return s.length > n ? s.slice(0, n) + '…' : s; };

    say('===== ONDE ESTÁ O PROMPT (Angular) =====');
    say('url: ' + location.href.replace(/[a-f0-9-]{30,}/g, '<id>'));

    const tiles = [...document.querySelectorAll('flow-grid-tile-container')];
    say('tiles na tela: ' + tiles.length);

    // ── 1. O que o rótulo traz ──
    say('');
    say('--- 1. RÓTULO (aria-label) das 8 primeiras ---');
    tiles.slice(0, 8).forEach((t, i) => {
        const rot = norm(t.getAttribute('aria-label'));
        const comecaComNumero = /^\s*\d{1,4}([.,]\d+)?\s*[-–—.):]/.test(rot);
        say('  [' + i + '] ' + (comecaComNumero ? 'Nº✅' : 'Nº❌') + '  ' + JSON.stringify(corta(rot, 70)));
    });

    // ── 2. __ngContext__ existe? ──
    say('');
    say('--- 2. CONTEXTO ANGULAR ---');
    let comCtx = 0;
    for (const t of tiles.slice(0, 8)) {
        let el = t, achou = false;
        for (let i = 0; i < 6 && el; i++) { if (el.__ngContext__ != null) { achou = true; break; } el = el.parentElement; }
        if (achou) comCtx++;
    }
    say('  tiles com __ngContext__: ' + comCtx + ' de ' + Math.min(8, tiles.length));

    // ── 3. Dump de TODOS os textos longos achados no contexto ──
    say('');
    say('--- 3. TEXTOS ENCONTRADOS DENTRO DO COMPONENTE ---');
    say('    (das 3 primeiras mídias; procuro onde o prompt mora)');

    function varrer(raiz, limite) {
        const achados = [];
        const vistos = new Set();
        let passos = 0;
        const anda = (obj, caminho, prof) => {
            if (!obj || typeof obj !== 'object' || prof > 6 || passos > 20000 || achados.length >= limite) return;
            if (vistos.has(obj)) return;
            vistos.add(obj);
            let chaves;
            try { chaves = Object.keys(obj); } catch (_) { return; }
            for (const k of chaves) {
                if (passos++ > 20000 || achados.length >= limite) return;
                let v;
                try { v = obj[k]; } catch (_) { continue; }
                if (typeof v === 'string' && v.length > 25 && v.length < 3000) {
                    if (!/^(https?:|data:|blob:|[0-9a-f-]{30,}$)/i.test(v)) {
                        achados.push({ caminho: (caminho + '.' + k).slice(-60), texto: v });
                    }
                } else if (v && typeof v === 'object' && !(v instanceof Node) && !(v instanceof Window)) {
                    anda(v, caminho + '.' + k, prof + 1);
                }
            }
        };
        anda(raiz, '', 0);
        return achados;
    }

    tiles.slice(0, 3).forEach((tile, idx) => {
        say('');
        say('  ══ MÍDIA ' + (idx + 1) + ' — rótulo: ' + JSON.stringify(corta(tile.getAttribute('aria-label'), 45)));
        let el = tile, ctx = null, nivel = 0;
        for (let i = 0; i < 6 && el; i++) { if (el.__ngContext__ != null) { ctx = el.__ngContext__; nivel = i; break; } el = el.parentElement; }
        if (!ctx) { say('     sem __ngContext__ em 6 níveis acima'); return; }
        say('     contexto achado ' + nivel + ' nível(is) acima · tipo: ' + (Array.isArray(ctx) ? 'array[' + ctx.length + ']' : typeof ctx));
        const achados = varrer(ctx, 14);
        if (!achados.length) { say('     nenhum texto longo encontrado'); return; }
        achados.forEach((a, i) => {
            const temNumero = /^\s*\d{1,4}([.,]\d+)?\s*[-–—.):]/.test(norm(a.texto));
            say('     [' + i + '] ' + (temNumero ? 'Nº✅' : '   ') + ' ' + a.caminho);
            say('          ' + JSON.stringify(corta(a.texto, 100)));
        });
    });

    // ── 4. Alguma alternativa no DOM? ──
    say('');
    say('--- 4. OUTROS LUGARES NO DOM ---');
    const t0 = tiles[0];
    if (t0) {
        ['title', 'data-prompt', 'data-subtitle', 'data-tooltip', 'matTooltip'].forEach(a => {
            const achou = t0.querySelector('[' + a + ']');
            say('  [' + a + ']: ' + (achou ? JSON.stringify(corta(achou.getAttribute(a), 70)) : 'não existe'));
        });
        const textos = [...t0.querySelectorAll('*')]
            .filter(e => !e.children.length && norm(e.textContent).length > 20)
            .slice(0, 5);
        say('  textos soltos dentro do tile: ' + textos.length);
        textos.forEach(e => say('     ' + e.tagName.toLowerCase() + '.' + (e.className || '').split(' ')[0] +
            ': ' + JSON.stringify(corta(e.textContent, 70))));
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
    } catch (e) { console.log('não salvou: ' + e.message); }
})();

/* Criadores Dark - onde mora o PROMPT de cada mídia? (SÓ LEITURA, sem mouse) */
(function () {
    'use strict';
    const L = [];
    const say = s => L.push(s);
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
    const temNumeroDeCena = s => /^\s*[{[(]?\s*(?:cena|prompt|scene)?\s*\d{1,4}(?:[.,]\d+)?\s*[-–—.):}\]]/i.test(norm(s));

    say('===== ONDE ESTA O PROMPT =====');
    say('Angular em modo dev (window.ng)? ' + (typeof window.ng !== 'undefined'));

    const tiles = [...document.querySelectorAll('flow-grid-tile-container')];
    say('tiles na tela: ' + tiles.length);

    for (let i = 0; i < Math.min(3, tiles.length); i++) {
        const tile = tiles[i];
        say('');
        say('=========== TILE ' + (i + 1) + ' ===========');
        say('aria-label: ' + JSON.stringify(norm(tile.getAttribute('aria-label')).slice(0, 90)));

        // 1) Todo texto que ja existe dentro do tile, sem hover
        say('');
        say('--- textos dentro do tile (sem passar o mouse) ---');
        let achou = 0;
        for (const el of tile.querySelectorAll('*')) {
            const proprio = [...el.childNodes]
                .filter(nd => nd.nodeType === 3)
                .map(nd => norm(nd.textContent)).join(' ').trim();
            if (!proprio || proprio.length < 3) continue;
            if (++achou > 14) break;
            say('  <' + el.tagName.toLowerCase() + (el.className ? ' class="' + String(el.className).slice(0, 40) + '"' : '') + '>');
            say('     ' + JSON.stringify(proprio.slice(0, 110)) + (temNumeroDeCena(proprio) ? '   <<< TEM NUMERO DE CENA' : ''));
        }
        if (!achou) say('  (nenhum texto solto)');

        // 2) Atributos longos (title, alt, data-*) que possam guardar o prompt
        say('');
        say('--- atributos com texto longo ---');
        let attrs = 0;
        for (const el of [tile, ...tile.querySelectorAll('*')]) {
            for (const a of el.attributes) {
                const v = norm(a.value);
                if (v.length < 25) continue;
                if (/^https?:|^data:|^blob:/.test(v)) continue;
                if (++attrs > 10) break;
                say('  ' + el.tagName.toLowerCase() + '[' + a.name + '] = ' + JSON.stringify(v.slice(0, 110)) +
                    (temNumeroDeCena(v) ? '   <<< TEM NUMERO DE CENA' : ''));
            }
            if (attrs > 10) break;
        }
        if (!attrs) say('  (nenhum)');

        // 3) Propriedades internas do Angular presas ao elemento
        say('');
        say('--- propriedades internas (Angular) ---');
        const chaves = Object.keys(tile).filter(k => k.startsWith('__') || k.startsWith('ng') || k.startsWith('_'));
        say('  chaves no elemento: ' + (chaves.length ? chaves.slice(0, 8).join(', ') : '(nenhuma)'));
        if (typeof window.ng !== 'undefined' && window.ng.getComponent) {
            try {
                const c = window.ng.getComponent(tile);
                if (c) {
                    const campos = Object.keys(c).filter(k => typeof c[k] === 'string' && c[k].length > 20);
                    say('  campos de texto do componente: ' + (campos.join(', ') || '(nenhum)'));
                    for (const campo of campos.slice(0, 4)) {
                        say('     ' + campo + ' = ' + JSON.stringify(norm(c[campo]).slice(0, 100)) +
                            (temNumeroDeCena(c[campo]) ? '   <<< TEM NUMERO DE CENA' : ''));
                    }
                }
            } catch (e) { say('  ng.getComponent falhou: ' + e.message); }
        }
    }

    say('');
    say('--- painel de informacoes aberto agora? ---');
    const painel = document.querySelector('.cdk-overlay-container flow-expandable-prompt, .cdk-overlay-container flow-info-panel');
    say('  ' + (painel ? JSON.stringify(norm(painel.textContent).slice(0, 140)) : '(fechado)'));

    say('');
    say('===== FIM =====');
    const txt = L.join('\n');
    window.__diagPrompt = txt;
    console.log(txt);
    try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        a.download = 'flow-prompt.txt';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        console.log('>>> SALVO: flow-prompt.txt em Downloads <<<');
    } catch (e) { console.log('nao salvou: ' + e.message); }
})();

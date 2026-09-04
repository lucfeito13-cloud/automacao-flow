/* Criadores Dark - diagnostico do Flow novo (SO LEITURA, nao clica em nada) */
(function () {
    'use strict';
    const L = [];
    const say = (s) => L.push(s);
    const attrs = (el, max = 8) => {
        if (!el) return '(nulo)';
        const a = [...el.attributes].filter(x => !/^style$/.test(x.name))
            .map(x => x.name + '=' + JSON.stringify(String(x.value).slice(0, 45)));
        return el.tagName.toLowerCase() + ' ' + a.slice(0, max).join(' ');
    };
    const caminho = (el, n = 4) => {
        const p = [];
        let cur = el;
        while (cur && cur !== document.body && p.length < n) { p.unshift(attrs(cur, 5)); cur = cur.parentElement; }
        return p.join('\n      > ');
    };

    say('===== DIAGNOSTICO FLOW =====');
    say('url: ' + location.href.replace(/[a-f0-9-]{30,}/g, '<id>'));
    say('idioma da UI: ' + (document.documentElement.lang || '?'));

    // ---------- 1. CAIXA DE PROMPT ----------
    say('');
    say('--- 1. CAIXA DE PROMPT ---');
    const testes = {
        'data-slate-editor': '[data-slate-editor="true"]',
        'role=textbox+editable': 'div[role="textbox"][contenteditable="true"]',
        'qualquer contenteditable': '[contenteditable="true"]',
        'textarea': 'textarea',
        'input texto': 'input[type="text"]'
    };
    let editor = null;
    for (const [nome, sel] of Object.entries(testes)) {
        const achados = document.querySelectorAll(sel);
        say(`  ${achados.length ? 'OK ' : '-- '} ${nome.padEnd(24)} (${sel}) => ${achados.length}`);
        if (!editor && achados.length) editor = achados[0];
    }
    if (editor) {
        say('  ELEMENTO USADO:');
        say('      ' + caminho(editor));
        say('  placeholder visivel: ' + JSON.stringify((editor.innerText || editor.placeholder || '').slice(0, 60)));
        say('  filhos diretos: ' + [...editor.children].slice(0, 3).map(c => attrs(c, 4)).join(' | '));
    } else {
        say('  !!! NENHUMA caixa de prompt encontrada');
    }

    // ---------- 2. BOTAO DE ENVIAR ----------
    say('');
    say('--- 2. BOTOES PERTO DA CAIXA DE PROMPT ---');
    say('  i.google-symbols na pagina: ' + document.querySelectorAll('i.google-symbols').length);
    let caixa = editor;
    for (let i = 0; i < 6 && caixa && caixa.parentElement; i++) caixa = caixa.parentElement;
    const botoes = caixa ? [...caixa.querySelectorAll('button')] : [];
    say('  botoes no bloco do prompt: ' + botoes.length);
    botoes.slice(0, 12).forEach((b, i) => {
        const icone = b.querySelector('i, svg');
        say(`   [${i}] ${attrs(b, 5)}`);
        say(`        texto=${JSON.stringify((b.innerText || '').trim().slice(0, 25))}` +
            ` aria=${JSON.stringify(b.getAttribute('aria-label') || '')}` +
            ` icone=${icone ? icone.tagName.toLowerCase() + ':' + JSON.stringify((icone.textContent || '').trim().slice(0, 20)) : 'nenhum'}` +
            ` desab=${b.disabled}`);
    });

    // ---------- 3. MIDIAS / TILES ----------
    say('');
    say('--- 3. MIDIAS NA GRADE ---');
    const tiles = document.querySelectorAll('[data-tile-id]');
    say('  [data-tile-id]: ' + tiles.length);
    say('  a[href*="/edit/"]: ' + document.querySelectorAll('a[href*="/edit/"]').length);
    say('  [data-virtuoso-scroller]: ' + document.querySelectorAll('[data-virtuoso-scroller]').length);
    say('  [data-index]: ' + document.querySelectorAll('[data-index]').length);
    say('  video na pagina: ' + document.querySelectorAll('video').length + ' | img: ' + document.querySelectorAll('img').length);
    if (tiles.length) {
        say('  EXEMPLO DE TILE:');
        say('      ' + attrs(tiles[0], 8));
    } else {
        // tenta achar o container repetido das midias
        const imgs = [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 80);
        if (imgs.length > 3) {
            const mapa = new Map();
            imgs.forEach(i => { const p = i.closest('[class],[data-*]'); if (p) mapa.set(p.parentElement, (mapa.get(p.parentElement) || 0) + 1); });
            const [maior] = [...mapa.entries()].sort((a, b) => b[1] - a[1]);
            if (maior) {
                say('  container com mais imagens (' + maior[1] + ' itens):');
                say('      ' + attrs(maior[0], 6));
                say('  1o item dentro dele:');
                say('      ' + caminho(maior[0].firstElementChild, 2));
            }
        }
    }

    // ---------- 4. OUTROS ----------
    say('');
    say('--- 4. OUTROS ---');
    ['[data-testid]', '[role="listbox"]', '[role="option"]', '[role="menuitem"]', '[role="dialog"]', 'li[data-sonner-toast]']
        .forEach(s => say('  ' + s.padEnd(24) + ' => ' + document.querySelectorAll(s).length));
    say('  Trusted Types ativo: ' + !!(window.trustedTypes && window.trustedTypes.defaultPolicy));
    say('  painel Criadores Dark presente: ' + !!document.getElementById('flow-sidebar'));

    say('');
    say('===== FIM =====');

    const txt = L.join('\n');
    console.log(txt);
    try { copy(txt); console.log('>>> RELATORIO COPIADO. E so colar pro Claude. <<<'); }
    catch (e) { console.log('>>> selecione o texto acima e copie <<<'); }
})();

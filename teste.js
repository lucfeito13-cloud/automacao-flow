/* Criadores Dark — bateria de testes da aba Renomear.
   NÃO renomeia, NÃO gera, NÃO apaga. Só lê e mede. */
(function () {
    'use strict';
    const L = [];
    const say = s => L.push(s);
    const ok = (t, c, extra) => say((c ? '✅' : '❌') + '  ' + t + (extra ? '   → ' + extra : ''));
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim();

    const A = window.__flowInstance;

    (async () => {
        say('===== TESTE DA ABA RENOMEAR =====');
        say('quando: ' + new Date().toLocaleString('pt-BR'));
        say('url: ' + location.href.replace(/[a-f0-9-]{30,}/g, '<id>'));

        // ─── 1. Extensão carregada ───
        say('');
        say('--- 1. EXTENSÃO ---');
        ok('painel presente', !!document.getElementById('flow-panel'));
        ok('instância acessível (window.__flowInstance)', !!A);
        if (!A) {
            say('');
            say('!!! Sem a instância não dá para testar o resto.');
            say('    Recarregue a extensão (chrome://extensions → 🔄) e dê F5 nesta página.');
            return terminar();
        }

        // ─── 2. A aba existe ───
        say('');
        say('--- 2. ABA RENOMEAR ---');
        const aba = document.querySelector('.flow-tab[data-tab="renomear"]');
        ok('aba criada', !!aba);
        for (const id of ['rn-modelo', 'rn-variacao', 'rn-preview', 'rn-start', 'rn-stop', 'rn-testar', 'rn-barra', 'rn-resultado']) {
            ok('controle #' + id, !!document.getElementById(id));
        }
        const escopos = document.querySelectorAll('[data-rnescopo]');
        ok('botões de escopo (3)', escopos.length === 3, escopos.length + ' encontrado(s)');

        // ─── 3. Modelo de nome ───
        say('');
        say('--- 3. FORMATO DO NOME ---');
        const campo = document.getElementById('rn-modelo');
        const guardado = campo ? campo.value : null;
        for (const modelo of ['Cena {n} - {tipo} {g}', 'cena_{n}_{g}_', 'cena_M_{n}_{g}_', 'cena_{nn}_{gg}_']) {
            try { localStorage.setItem('flow_modelo_nome', modelo); } catch (_) {}
            const nome = A.montarNome(7, 2, false);
            const lido = A.lerNome(nome);
            ok(modelo.padEnd(22) + ' → ' + nome, !!lido && lido.sceneNum === 7 && lido.imgNum === 2,
               lido ? ('cena ' + lido.sceneNum + ' var ' + lido.imgNum) : 'não reconheceu');
        }
        ok('nome clássico ainda reconhecido', !!A.lerNome('Cena 15 - Vídeo 3'));
        ok('nome qualquer é ignorado', A.lerNome('Foto do cachorro') === null);
        try { localStorage.setItem('flow_modelo_nome', guardado || 'Cena {n} - {tipo} {g}'); } catch (_) {}
        if (campo) campo.value = guardado || 'Cena {n} - {tipo} {g}';

        // ─── 4. Galeria e rolagem ───
        say('');
        say('--- 4. GALERIA E ROLAGEM ---');
        const sc = A.getScroller();
        ok('área rolável encontrada', !!sc, sc ? (sc.tagName.toLowerCase() + '.' + (sc.className || '').split(' ')[0]) : '-');
        if (sc) {
            const alturaTotal = sc.scrollHeight, visivel = sc.clientHeight;
            say('    altura total: ' + alturaTotal + 'px · visível: ' + visivel + 'px');
            ok('tem conteúdo para rolar', alturaTotal > visivel + 4);
            const antes = Math.round(sc.scrollTop);
            const andou = A.rolarUmPedaco ? A.rolarUmPedaco(sc, 0.45, false) : false;
            await new Promise(r => setTimeout(r, 400));
            const depois = Math.round(sc.scrollTop);
            ok('ROLAGEM AUTOMÁTICA funciona', andou && depois !== antes, antes + 'px → ' + depois + 'px');
            sc.scrollTop = antes;
            await new Promise(r => setTimeout(r, 300));
        }

        const tiles = A.getTiles();
        ok('mídias visíveis na tela', tiles.length > 0, tiles.length + ' tile(s)');
        if (tiles.length) {
            const vids = tiles.filter(t => A.isVideoTile(t)).length;
            say('    imagens: ' + (tiles.length - vids) + ' · vídeos: ' + vids);
            ok('consegue ler o ID da mídia', !!A.getUuidFromTile(tiles[0]), String(A.getUuidFromTile(tiles[0])).slice(0, 12));
            ok('consegue ler o nome da mídia', !!A.getTileName(tiles[0]), JSON.stringify(String(A.getTileName(tiles[0])).slice(0, 45)));
        }

        // ─── 5. Detecção do número da cena ───
        say('');
        say('--- 5. NÚMERO DA CENA (sem renomear) ---');
        let porNome = 0, porRotulo = 0, semNada = 0;
        const exemplos = [];
        for (const tile of tiles.slice(0, 25)) {
            const entry = { uuid: A.getUuidFromTile(tile), name: A.getTileName(tile), isVideo: A.isVideoTile(tile), loaded: true };
            if (!entry.uuid) continue;
            const achado = await A.cenaDaMidia(entry, null, false);   // false = sem clicar em Reutilizar
            if (achado && achado.origem === 'nome') porNome++;
            else if (achado) porRotulo++;
            else semNada++;
            if (exemplos.length < 8) {
                exemplos.push('    ' + (achado ? ('cena ' + achado.num + ' (' + achado.origem + ')') : 'precisa ler o prompt').padEnd(28) +
                              JSON.stringify(String(entry.name).slice(0, 42)));
            }
        }
        say('  pelo nome já formatado: ' + porNome);
        say('  pelo rótulo (nº no começo do prompt): ' + porRotulo);
        say('  precisam abrir o prompt: ' + semNada);
        exemplos.forEach(e => say(e));

        // ─── 6. Leitura do prompt em UMA mídia ───
        say('');
        say('--- 6. LER O PROMPT (teste em 1 mídia) ---');
        const semNumero = [];
        for (const tile of tiles.slice(0, 25)) {
            const entry = { uuid: A.getUuidFromTile(tile), name: A.getTileName(tile), isVideo: A.isVideoTile(tile), loaded: true };
            if (!entry.uuid) continue;
            if (!(await A.cenaDaMidia(entry, null, false))) { semNumero.push(tile); break; }
        }
        if (!semNumero.length) {
            say('    (todas as mídias visíveis já têm número — nada a testar aqui, é bom sinal)');
        } else {
            const t0 = Date.now();
            const texto = await A.promptViaReutilizar(semNumero[0]);
            const ms = Date.now() - t0;
            ok('leu o prompt pelo botão Reutilizar', !!texto && texto.length > 10, ms + 'ms · ' + JSON.stringify(String(texto).slice(0, 60)));
            const num = A.numeroDaCenaNoTexto(texto);
            ok('achou o número da cena no prompt', num != null, num != null ? ('cena ' + num) : 'o prompt não começa com número');
            say('    (nessa velocidade, 100 mídias sem número levariam ~' + Math.round(ms * 100 / 1000) + 's)');
        }

        // ─── 7. Plano simulado ───
        say('');
        say('--- 7. COMO FICARIA (simulação das visíveis) ---');
        const contador = new Map();
        let simuladas = 0;
        for (const tile of tiles.slice(0, 12)) {
            const entry = { uuid: A.getUuidFromTile(tile), name: A.getTileName(tile), isVideo: A.isVideoTile(tile), loaded: true };
            if (!entry.uuid) continue;
            const achado = await A.cenaDaMidia(entry, null, false);
            if (!achado) continue;
            const chave = achado.num + '|' + (entry.isVideo ? 'v' : 'i');
            const g = (contador.get(chave) || 0) + 1;
            contador.set(chave, g);
            say('    ' + String(entry.name).slice(0, 34).padEnd(36) + '→  ' + A.montarNome(achado.num, g, entry.isVideo));
            simuladas++;
        }
        ok('simulação gerou nomes', simuladas > 0, simuladas + ' mídia(s)');

        say('');
        say('===== FIM =====');
        terminar();
    })().catch(e => {
        say('');
        say('!!! ERRO NO TESTE: ' + e.message);
        say(String(e.stack).split('\n').slice(0, 4).join('\n'));
        terminar();
    });

    function terminar() {
        const txt = L.join('\n');
        window.__teste = txt;
        console.log(txt);
        try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
            a.download = 'flow-teste.txt';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            console.log('>>> SALVO: flow-teste.txt em Downloads <<<');
        } catch (e) { console.log('não salvou: ' + e.message); }
    }
})();

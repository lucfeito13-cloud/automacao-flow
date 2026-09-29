const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'flow_com_voz.js'), 'utf8');

function method(startMarker, endMarker, names = [], values = []) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Método ausente: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Fim do método ausente: ${endMarker}`);
  const definition = source.slice(start, end).trim().replace(/,\s*$/, '');
  const name = /(?:async )?(\w+)\(/.exec(startMarker)[1];
  return Function(...names, `return ({ ${definition} })[${JSON.stringify(name)}];`)(...values);
}

test('favorito do Flow usa FILL, não aria-label fixo, e evita clique duplicado', async () => {
  const botaoFavoritoNoTile = method(
    '      botaoFavoritoNoTile(tile) {',
    '      estadoFavoritoNoBotao(button) {',
    ['$$'],
    [(selector, tile) => selector === 'button' ? [tile.button] : []]
  );
  const estadoFavoritoNoBotao = method(
    '      estadoFavoritoNoBotao(button) {',
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    ['getComputedStyle'],
    [icon => ({ fontVariationSettings: `"FILL" ${icon.fill}, "wght" 400` })]
  );
  const favoritarPeloBotao = method(
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    '      // ── MARCAR AGORA, RENOMEAR PELO BOTAO',
    ['$$'],
    [(selector, tile) => selector === 'button[aria-label]' ? [tile.button] : []]
  );
  const icon = { fill: 0 };
  let clicks = 0;
  const button = {
    getAttribute: name => name === 'aria-label' ? 'Favourite' : null,
    querySelector: () => icon,
    click() { clicks++; icon.fill = 1; }
  };
  const tile = { isConnected: true, button };
  let scrolls = 0;
  const state = {
    botaoFavoritoNoTile,
    estadoFavoritoNoBotao,
    favoritoNoTile: current => estadoFavoritoNoBotao(current.button),
    getUuidFromTile: () => 'id-1',
    workflowIdReal: () => 'id-1',
    scrollToWorkflow: async () => { scrolls++; return tile; },
    modernWait: async check => check(),
    logDebug() {}
  };
  assert.equal(await favoritarPeloBotao.call(state, 'id-1', true, tile), true);
  assert.equal(await favoritarPeloBotao.call(state, 'id-1', true, tile), true);
  assert.equal(clicks, 1);
  assert.equal(scrolls, 0, 'reutiliza o card, sem percorrer a galeria novamente');

  tile.isConnected = false;
  icon.fill = 0;
  state.getTiles = () => [{ isConnected: true, button }];
  assert.equal(await favoritarPeloBotao.call(state, 'id-1', true, tile), true);
  assert.equal(scrolls, 0, 'card recriado não reinicia a varredura');
});

test('favorito não é confirmado se o Flow não mudar o coração', async () => {
  const botaoFavoritoNoTile = method(
    '      botaoFavoritoNoTile(tile) {',
    '      estadoFavoritoNoBotao(button) {',
    ['$$'],
    [(selector, tile) => [tile.button]]
  );
  const estadoFavoritoNoBotao = method(
    '      estadoFavoritoNoBotao(button) {',
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    ['getComputedStyle'],
    [() => ({ fontVariationSettings: '"FILL" 0' })]
  );
  const favoritarPeloBotao = method(
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    '      // ── MARCAR AGORA, RENOMEAR PELO BOTAO',
    ['$$'],
    [(selector, tile) => [tile.button]]
  );
  const tile = {
    isConnected: true,
    button: {
      getAttribute: name => name === 'aria-label' ? 'Favourite' : null,
      querySelector: () => ({}),
      click() {}
    }
  };
  const state = {
    botaoFavoritoNoTile,
    estadoFavoritoNoBotao,
    favoritoNoTile: current => estadoFavoritoNoBotao(current.button),
    getUuidFromTile: () => 'id-1',
    workflowIdReal: () => 'id-1',
    modernWait: async check => check(),
    logDebug() {}
  };
  assert.equal(await favoritarPeloBotao.call(state, 'id-1', true, tile), false);
});

test('favorito revela o hotbar e usa clique físico no botão correto', async () => {
  const calls = [];
  const button = {
    getBoundingClientRect: () => ({ left: 80, top: 20, width: 20, height: 20 }),
    contains: () => false
  };
  const tile = {
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, width: 200, height: 120 })
  };
  const clicarFavoritoFisico = method(
    '      async clicarFavoritoFisico(tile, button) {',
    '      estadoFavoritoNoBotao(button) {',
    ['document', 'getComputedStyle'],
    [{ elementFromPoint: () => button, getElementById: () => null }, () => ({ display: 'block' })]
  );
  const state = {
    botaoFavoritoNoTile: () => button,
    entradaConfiavelNoFlow: async (...args) => { calls.push(args); return true; },
    modernWait: async check => check()
  };
  assert.equal(await clicarFavoritoFisico.call(state, tile, button), true);
  assert.deepEqual(calls, [['MOVE', 110, 70], ['CLICK', 90, 30]]);
});

test('localiza coração pelo mat-icon mesmo sem aria-label no botão', () => {
  const botaoFavoritoNoTile = method(
    '      botaoFavoritoNoTile(tile) {',
    '      estadoFavoritoNoBotao(button) {',
    ['$$'],
    [(selector, tile) => selector === 'button' ? tile.buttons : []]
  );
  const outro = { getAttribute: () => null, querySelector: () => ({ textContent: 'more_vert' }) };
  const favorito = { getAttribute: () => null, querySelector: () => ({ textContent: 'favorite' }) };
  assert.equal(botaoFavoritoNoTile({ buttons: [outro, favorito] }), favorito);
});

test('revela coração que só aparece após hover e então clica', async () => {
  const favoritarPeloBotao = method(
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    '      // ── MARCAR AGORA, RENOMEAR PELO BOTAO'
  );
  let revelado = false;
  let preenchido = false;
  const tile = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  const state = {
    getUuidFromTile: () => 'id-1',
    workflowIdReal: () => 'id-1',
    botaoFavoritoNoTile: () => revelado ? {} : null,
    estadoFavoritoNoBotao: () => preenchido,
    favoritoNoTile: () => preenchido,
    entradaConfiavelNoFlow: async tipo => { assert.equal(tipo, 'MOVE'); revelado = true; },
    clicarFavoritoFisico: async () => { preenchido = true; return true; },
    modernWait: async check => check(),
    logDebug() {}
  };
  assert.equal(await favoritarPeloBotao.call(state, 'id-1', true, tile), true);
});

test('favorita pelo menu nativo quando a barra de hover está oculta', async () => {
  let favorito = false;
  let cliquesSinteticos = 0;
  let abriu = false;
  let fechou = false;
  const item = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 80, height: 30 }),
    click: () => { cliquesSinteticos++; }
  };
  const favoritarPeloMenu = method(
    '      async favoritarPeloMenu(id, value, tileOptional = null) {',
    '      botaoFavoritoNoTile(tile) {',
    ['menuItem'],
    [labels => labels.includes('Favourite') ? item : null]
  );
  const tile = { isConnected: true };
  const state = {
    getUuidFromTile: () => 'video-1',
    workflowIdReal: () => '',
    favoritoNoTile: () => favorito,
    openTileMenu: async () => { abriu = true; },
    entradaConfiavelNoFlow: async (kind, x, y) => {
      assert.deepEqual([kind, x, y], ['CLICK', 50, 35]);
      favorito = true;
    },
    modernWait: async check => check(),
    closeMenus: async () => { fechou = true; },
    logDebug() {}
  };
  assert.equal(await favoritarPeloMenu.call(state, 'video-1', true, tile), true);
  assert.equal(abriu, true);
  assert.equal(fechou, true);
  assert.equal(cliquesSinteticos, 0);
});

test('não declara favorito se nem a interface nem o servidor confirmarem', async () => {
  const old = {
    apiFavorite: async () => true,
    apiReadFavorite: async () => false
  };
  const apiFavorite = method(
    '      async apiFavorite(id, value, tileOptional = null) {',
    '      async entradaConfiavelNoFlow(tipo, x, y) {',
    ['old'], [old]
  );
  let patches = 0;
  old.apiFavorite = async () => { patches++; return true; };
  const state = {
    favoritarPeloMenu: async () => false,
    favoritarPeloBotao: async () => false,
    idServeNaApi: () => true,
    apiComLimite: promise => promise
  };
  assert.equal(await apiFavorite.call(state, 'id-1', true), false);
  assert.equal(patches, 1);
  old.apiReadFavorite = async () => true;
  assert.equal(await apiFavorite.call(state, 'id-1', true), true);
});

test('renomeação volta a usar o botão de opções do card e exige Rename no menu', () => {
  const menu = source.slice(source.indexOf('      async openTileMenu(tile, expectedLabels = []) {'), source.indexOf('      async closeMenus() {'));
  const rename = source.slice(source.indexOf('      async renomearPeloMenu(id, name, tileOptional = null) {'), source.indexOf('      async apiFavorite(id, value, tileOptional = null) {'));
  assert.match(menu, /let btn = \$\('button\[aria-label="More options"\]/);
  assert.doesNotMatch(menu, /if \(btn && !visible\(btn\)\) btn = null/);
  assert.match(menu, /expectedLabels\.some\(label => controlText\(item\)/);
  assert.match(rename, /openTileMenu\(tile, \['Rename', 'Renomear'\]\)/);
  assert.match(rename, /modernWait\(\(\) => menuItem\(\['Rename', 'Renomear'\]\)/);
});

test('vídeo sem UUID real já renomeado não é enviado para renomear outra vez', async () => {
  const renomear = method(
    '      async renomearSelecionadoConfirmado(id, name, tileOptional = null) {',
    '      async renomearPeloMenu(id, name, tileOptional = null) {',
    ['norm', 'old'],
    [value => String(value || '').trim(), {}]
  );
  const tile = { isConnected: true };
  let abriuMenu = false;
  const state = {
    getUuidFromTile: () => 'video-123',
    workflowIdReal: () => '',
    getTileName: () => 'cena_43_',
    renomearPeloMenu: async () => { abriuMenu = true; return false; }
  };
  assert.equal(await renomear.call(state, 'video-123', 'cena_43_', tile), true);
  assert.equal(abriuMenu, false);
});

test('vídeo sem UUID real confirma o nome pela galeria e mantém favorito pendente', () => {
  const rename = source.slice(source.indexOf('      async renomearPeloMenu(id, name, tileOptional = null) {'), source.indexOf('      async apiFavorite(id, value, tileOptional = null) {'));
  const observer = source.slice(source.indexOf('      startLabelObserver() {'), source.indexOf('      async ', source.indexOf('      startLabelObserver() {') + 20));
  assert.match(rename, /if \(!realId\) \{[\s\S]*?const nomeNoFlow =/);
  assert.match(rename, /if \(!nomeNoFlow\(\)\) throw new Error/);
  assert.match(observer, /norm\(nomeAtual\) === norm\(pendente\.nome\) && this\.favoritoNoTile\(tile\) === true/);
  assert.match(source, /marca\.estado = renomeou \? 'favorite_pending' : 'failed'/);
});

test('favorito reconhece o estado preenchido e Unfavourite do Flow', () => {
  const estado = method(
    '      estadoFavoritoNoBotao(button) {',
    '      async favoritarPeloBotao(id, value, tileOptional = null) {',
    ['getComputedStyle'],
    [() => ({ fontVariationSettings: 'normal' })]
  );
  const botao = (label, fill) => ({
    getAttribute: name => name === 'aria-label' ? label : null,
    querySelector: () => ({ classList: { contains: name => name === 'fill' && fill } })
  });
  assert.equal(estado(botao('Unfavourite', false)), true);
  assert.equal(estado(botao('Favourite', true)), true);
  assert.equal(estado(botao('Favourite', false)), false);
});

test('botão Favoritar selecionadas não renomeia nem toca linhas sem nome salvo', async () => {
  const status = { className: '', textContent: '' };
  const barra = { style: {} };
  const favoritar = method(
    '      async favoritarSelecionadasDoPlano() {',
    '      /** Aplica o que sobrou na lista depois das suas remocoes. */',
    ['document', 'norm'],
    [{ getElementById: id => id === 'rn-status' ? status : barra }, value => String(value || '').trim()]
  );
  const marcas = { salvo: { nome: 'Cena 1', nomeSalvo: true }, naoSalvo: { nome: 'Cena 2' } };
  const nomes = [];
  const favoritos = [];
  const state = {
    _planoRenomear: [
      { uuid: 'salvo', novo: 'Cena 1', nomeSalvo: true, selecionado: true, cena: 1, g: 1, isVideo: true },
      { uuid: 'naoSalvo', novo: 'Cena 2', nomeSalvo: false, selecionado: true, cena: 2, g: 1, isVideo: true }
    ],
    lerMarcas: () => marcas,
    scrollToWorkflow: async id => ({ id }),
    getTileName: tile => { nomes.push(tile.id); return tile.id === 'salvo' ? 'Cena 1' : 'Cena 2'; },
    favoritoNoTile: () => false,
    apiFavorite: async id => { favoritos.push(id); return true; },
    registrarRenomeacaoConfirmada() {},
    removeLabelFromTile() {},
    salvarMarcas() {},
    mostrarPlanoRenomear() {},
    updateAssignCount() {},
    logDebug() {},
    apiRename: () => { throw new Error('não pode renomear'); },
    renomearPeloMenu: () => { throw new Error('não pode renomear'); }
  };
  await favoritar.call(state);
  assert.deepEqual(nomes, ['salvo']);
  assert.deepEqual(favoritos, ['salvo']);
  assert.equal(state._planoRenomear.length, 1);
  assert.equal(marcas.salvo, undefined);
  assert.match(status.textContent, /Nenhum nome foi alterado/);
});

test('painel Atribuir favorita só caixas com nome confirmado e preserva as demais', async () => {
  const favoritar = method(
    '      async favoritarMarcasSemRenomear() {',
    '      async validateReferences(source = \'images\') {',
    ['norm'],
    [value => String(value || '').trim()]
  );
  const marcas = {
    pronta: { nome: 'REF_1', tipo: 'ref', referencia: 'REF_1' },
    errada: { nome: 'REF_2', tipo: 'ref', referencia: 'REF_2' },
    favorita: { nome: 'REF_3', tipo: 'ref', referencia: 'REF_3' }
  };
  const favorites = [];
  const state = {
    lerMarcas: () => marcas,
    atualizarBotaoRenomearMarcadas() {},
    scrollToWorkflow: async id => ({ id }),
    getUuidFromTile: tile => tile.id,
    getTileName: tile => tile.id === 'errada' ? 'Nome antigo' : marcas[tile.id].nome,
    favoritoNoTile: tile => tile.id === 'favorita',
    apiFavorite: async id => { favorites.push(id); return true; },
    registrarRenomeacaoConfirmada() {},
    updateAssignItemUI() {},
    removeLabelFromTile() {},
    salvarMarcas() {},
    updateAssignCount() {},
    logDebug() {},
    apiRename: () => { throw new Error('não pode renomear'); }
  };
  await favoritar.call(state);
  assert.deepEqual(favorites, ['pronta']);
  assert.deepEqual(Object.keys(marcas), ['errada']);
  assert.equal(state._favoritandoMarcas, false);
  assert.match(source, /id="flow-assign-favorite"/);
});

test('mídia já renomeada mas sem favorito continua selecionada para favoritar', () => {
  const marcar = method(
    '      marcar(id, dados) {',
    '      desmarcar(id) {',
    ['norm'],
    [value => String(value || '').trim()]
  );
  const marcas = {};
  const historico = { id: { nome: 'REF_1' } };
  const tile = { id: 'id' };
  const state = {
    lerMarcas: () => marcas,
    lerHistoricoRenomeacao: () => historico,
    getTiles: () => [tile],
    getUuidFromTile: item => item.id,
    getTileName: () => 'REF_1',
    favoritoNoTile: () => false,
    salvarMarcas() {},
    startLabelObserver() {},
    salvarHistoricoRenomeacao() { throw new Error('não deve apagar o histórico'); }
  };
  marcar.call(state, 'id', { nome: 'REF_1', tipo: 'ref', referencia: 'REF_1' });
  assert.equal(marcas.id.nomeSalvo, true);
  assert.equal(marcas.id.estado, 'favorite_pending');
  assert.equal(historico.id.nome, 'REF_1');
});

test('download interrompe a varredura ao selecionar todos os IDs marcados', () => {
  assert.match(source, /const alvos = new Set\(\[\.\.\.this\.tileAssignments\]/);
  assert.match(source, /if \(!tipoDesconhecido && alvos\.size && encontrados\.size >= alvos\.size\) return false;/);
  assert.match(source, /if \(ok === selecionados\.length\) break;/);
  assert.match(source, /plano\.push\(\{ \.\.\.entry, cena, g, novo, origem: 'favorito_pendente', favoritoPendente: true \}\)/);
  assert.match(source, /if \(jaNomeada && this\.favoritoNoTile\(tile\) !== true\)/);
});

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
    entradaConfiavelNoFlow: async (...args) => { calls.push(args); return true; },
    modernWait: async check => check()
  };
  assert.equal(await clicarFavoritoFisico.call(state, tile, button), true);
  assert.deepEqual(calls, [['MOVE', 110, 70], ['CLICK', 90, 30]]);
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
    favoritarPeloBotao: async () => false,
    idServeNaApi: () => true,
    apiComLimite: promise => promise
  };
  assert.equal(await apiFavorite.call(state, 'id-1', true), false);
  assert.equal(patches, 1);
  old.apiReadFavorite = async () => true;
  assert.equal(await apiFavorite.call(state, 'id-1', true), true);
});

test('download interrompe a varredura ao selecionar todos os IDs marcados', () => {
  assert.match(source, /const alvos = new Set\(\[\.\.\.this\.tileAssignments\]/);
  assert.match(source, /if \(!tipoDesconhecido && alvos\.size && encontrados\.size >= alvos\.size\) return false;/);
  assert.match(source, /if \(ok === selecionados\.length\) break;/);
  assert.match(source, /plano\.push\(\{ \.\.\.entry, cena, g, novo, origem: 'favorito_pendente', favoritoPendente: true \}\)/);
  assert.match(source, /if \(jaNomeada && this\.favoritoNoTile\(tile\) !== true\)/);
});

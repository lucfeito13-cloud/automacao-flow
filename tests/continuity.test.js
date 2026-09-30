const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '..', 'flow_com_voz.js'), 'utf8');
const parseStart = source.indexOf('    function parsePrompt(prompt) {');
const parseEnd = source.indexOf('    function extractReferences(prompts) {', parseStart);
const parsePrompt = Function(source.slice(parseStart, parseEnd) + '; return parsePrompt;')();
const promptsStart = source.indexOf('    function parsePromptsText(text, startFrom = 1) {');
const promptsEnd = source.indexOf('    /**', promptsStart);
const parsePromptsText = Function('dividirEmPrompts', source.slice(promptsStart, promptsEnd) + '; return parsePromptsText;')(text => text.split('\n'));
const runStart = source.indexOf('      async runContinuity(video) {');
const runEnd = source.indexOf('      async runModern(video) {', runStart);
const definition = source.slice(runStart, runEnd).trim().replace(/,\s*$/, '');

async function execute(video, renameFails = false) {
  const tipo = video ? 'Vídeo' : 'Imagem';
  const nome = n => `Cena ${n} - ${tipo} 1`;
  const elements = {
    input: { value: `{Cena 1} Primeiro plano\n{Cena 2} [${nome(1)}] Segundo plano\n{Cena 3} [${nome(1)}] Terceiro plano` },
    resume: { value: '' }, start: {}, stop: {}
  };
  const document = { getElementById: id => id.endsWith('-prompts-input') ? elements.input :
    id.endsWith('-start-from') ? elements.resume : id.endsWith('-start-btn') ? elements.start :
    id.endsWith('-stop-btn') ? elements.stop : null };
  const run = Function('document', 'parsePromptsText', 'lerModeloContinuidade', 'montarNome', 'localStorage', 'stopError',
    `return ({${definition}}).runContinuity;`)(document, parsePromptsText, () => 'modelo', n => nome(n),
    { getItem: () => null }, () => new Error('parada'));
  const sent = [], rows = [], favorites = [], checkpoints = [], titles = new Map();
  let marks = {};
  const state = {
    imagesPerPrompt: 2, videoResultsPerPrompt: 2, batchSize: 5, videoBatchSize: 5,
    genMode: 'free', videoGenMode: 'free', tileAssignments: new Map(),
    setStatus() {}, setVideoStatus() {}, logDebug() {},
    updatePromptItemStatus: (...args) => rows.push(args),
    updateVideoPromptItemStatus: (...args) => rows.push(args),
    updateProgress() {}, updateVideoProgress() {}, buildPromptList() {}, buildVideoPromptList() {},
    configureGeneration: async (isVideo, count) => {
      assert.equal(isVideo, video); assert.equal(count, 1);
      assert.equal(state.imagesPerPrompt, 1); assert.equal(state.videoResultsPerPrompt, 1);
    },
    prepareGalleryForRun: async () => {}, modernStopped: () => false,
    snapshotImageUuids: () => new Set(),
    prepareAndSubmit: async prompt => {
      const refs = parsePrompt(prompt.text).filter(p => p.type === 'ref').map(p => p.name);
      for (const ref of refs) assert.ok([...titles.values()].includes(ref), 'referência vem de uma cena com nome já salvo');
      sent.push({ text: prompt.text, refs }); return true;
    },
    pausa: async () => {}, sleep: async () => {},
    buildPositionMatrix: () => [{ state: 'loaded', uuid: 'id-' + sent.length }],
    waitForMatrix: async () => {},
    scrollToWorkflow: async id => ({ id }), getTileName: tile => titles.get(tile.id) || 'Título original',
    renomearSelecionadoConfirmado: async (id, name) => { if (renameFails) return false; titles.set(id, name); return true; },
    pintarNomeNoTile() {},
    apiFavorite: async id => { favorites.push(id); return id !== 'id-1'; },
    lerMarcas: () => ({ ...marks }), salvarMarcas: value => { marks = { ...value }; },
    registrarRenomeacaoConfirmada() {}, removeLabelFromTile() {}, atualizarEstadoItemAtribuir() {},
    salvarContinuidade: (isVideo, value) => checkpoints.push(value), limparContinuidade() {}, chaveContinuidade: () => 'continuidade',
    gerarRelatorioDeExecucao() {}, closeAssetPicker: async () => {}, closeMenus: async () => {}
  };
  await run.call(state, video);
  return { sent, rows, favorites, checkpoints, marks, nome };
}

for (const video of [false, true]) {
  test(`continuidade ${video ? 'vídeo' : 'imagem'} usa só referências do prompt e avança com favorito pendente`, async () => {
    const result = await execute(video);
    assert.equal(result.sent.length, 3);
    assert.deepEqual(result.sent.map(p => p.refs), [[], [result.nome(1)], [result.nome(1)]]);
    assert.equal(result.marks['id-1'].nomeSalvo, true);
    assert.equal(result.marks['id-1'].estado, 'favorite_pending');
    assert.deepEqual(Object.keys(result.marks), ['id-1']);
    assert.deepEqual(result.checkpoints.map(p => p.proximaCena), [1, 2, 3]);
    assert.ok(result.rows.some(([index, status, text]) => index === 0 && status === 'error' && /favorito/.test(text)));
  });
}

test('continuidade para se o nome falhar e guarda a mídia sem gerar a próxima cena', async () => {
  const result = await execute(false, true);
  assert.equal(result.sent.length, 1);
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.favorites.length, 0);
  assert.equal(result.marks['id-1'].estado, 'failed');
  assert.ok(result.rows.some(([index, status]) => index === 0 && status === 'error'));
});

test('sigla personalizada formata e reconhece a cena com três dígitos sem mudar o formato normal', () => {
  const start = source.indexOf("    const MODELO_PADRAO = 'Cena {n} - {tipo} {g}';");
  const end = source.indexOf('    Object.assign(proto, {', start);
  const settings = new Map([
    ['flow_modelo_nome', 'cena_{n}_{g}_'],
    ['flow_continuidade_sigla_nome', JSON.stringify({ ativo: true, sigla: 'S_' })]
  ]);
  const helpers = Function('localStorage', 'norm', source.slice(start, end) +
    '; return { lerModelo, lerModeloContinuidade, montarNome, lerNomeModelo };')(
      { getItem: key => settings.get(key) || null }, text => String(text || '').trim());
  assert.equal(helpers.lerModelo(), 'cena_{n}_{g}_');
  assert.equal(helpers.lerModeloContinuidade(), 'S_{nnn}_');
  assert.equal(helpers.montarNome(23, 1, false, helpers.lerModeloContinuidade()), 'S_023_');
  assert.equal(helpers.montarNome(1, 1, true, helpers.lerModeloContinuidade()), 'S_001_');
  assert.equal(helpers.montarNome(1234, 1, true, helpers.lerModeloContinuidade()), 'S_1234_');
  assert.equal(helpers.lerNomeModelo('S_023_').sceneNum, 23);
  settings.set('flow_continuidade_sigla_nome', JSON.stringify({ ativo: true, sigla: 'LOC' }));
  assert.equal(helpers.montarNome(23, 1, false, helpers.lerModeloContinuidade()), 'LOC_023_');
  assert.equal(helpers.lerNomeModelo('LOC_023_').sceneNum, 23);
  settings.set('flow_continuidade_sigla_nome', JSON.stringify({ ativo: false, sigla: 'LOC' }));
  assert.equal(helpers.lerModeloContinuidade(), 'cena_{n}_{g}_');
  assert.equal(helpers.lerNomeModelo('LOC_023_').sceneNum, 23, 'nome salvo continua reconhecido com a opção desligada');
});

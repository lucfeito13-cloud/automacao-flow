const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'flow_com_voz.js'), 'utf8');

function method(startMarker, endMarker, names, values) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Método ausente: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `Fim do método ausente: ${endMarker}`);
  const definition = source.slice(start, end).trim().replace(/,\s*$/, '');
  return Function(...names, `return ({ ${definition} })[${JSON.stringify(startMarker.match(/async (\w+)/)[1])}];`)(...values);
}

test('Gerar um por um passa o tipo de mídia e sempre limpa o contexto', async () => {
  const document = { getElementById: () => ({ value: '{Cena 13.1} teste' }) };
  const prepare = async function () { return this._modernIndividualVideo; };
  const gerar = method(
    '      async gerarPromptIndividual(prompt, isVideo, button) {',
    '      async prepareAndSubmit(prompt) {',
    ['parseIndividualPrompts', 'document', 'prepare'],
    [() => [], document, prepare]
  );
  const makeState = () => ({
    esc: value => value,
    registrarPromptsIndividuais() {},
    setVideoStatus() {},
    setStatus() {}
  });
  const video = makeState();
  const button = { disabled: false };
  assert.equal(await gerar.call(video, { text: 'teste', sceneName: 'Cena 13.1' }, true, button), true);
  assert.equal(video._modernIndividualVideo, false);
  assert.equal(video._modernTaskRunning, false);
  assert.equal(button.disabled, false);

  const image = makeState();
  await assert.rejects(gerar.call(image, { text: 'teste', sceneName: 'Cena 13.1' }, false, button), /não confirmou/);
  assert.equal(image._modernIndividualVideo, false);
  assert.equal(image._modernTaskRunning, false);
  assert.equal(button.disabled, false);
});

test('Vídeo individual usa um clique no botão; imagem usa somente a ponte', async () => {
  const editor = {
    text: 'prompt de teste',
    getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 100 })
  };
  let directClicks = 0;
  let bridgeClicks = 0;
  const button = {
    disabled: false,
    getAttribute: name => name === 'aria-label' ? 'Start generation' : null,
    click() { directClicks++; editor.text = ''; },
    scrollIntoView() {},
    focus() {},
    getBoundingClientRect: () => ({ left: 350, right: 390, top: 60, bottom: 90 })
  };
  const window = {
    handler: null,
    addEventListener(_name, fn) { this.handler = fn; },
    removeEventListener() { this.handler = null; },
    postMessage(data, origin) {
      bridgeClicks++;
      editor.text = '';
      this.handler({ source: this, origin, data: {
        source: 'criadores-dark-extension-bridge',
        type: 'FLOW_TRUSTED_CLICK_RESULT',
        requestId: data.requestId,
        ok: true
      } });
    }
  };
  const $ = selector => selector.includes('Start generation') ? button : null;
  const submit = method(
    '      async clickSubmit() {',
    '      async prepareAndSubmit(prompt) {',
    ['$', '$$', 'visible', 'own', 'norm', 'cleanEditorText', 'window', 'location'],
    [$, () => [], el => !!el, () => false, value => String(value || '').trim(), ed => ed.text, window, { origin: 'https://flow.google.com' }]
  );
  const state = {
    videoIsRunning: false,
    _modernIndividualVideo: true,
    closeAssetPicker: async () => {},
    getEditor: () => editor,
    textoSemChips: ed => ed.text,
    getTiles: () => [],
    tileHasProgress: () => false,
    modernWait: async fn => {
      const result = fn();
      if (!result) throw new Error('Sem confirmação');
      return result;
    },
    logDebug() {},
    logVideoDebug() {}
  };
  assert.equal(await submit.call(state), true);
  assert.equal(directClicks, 1);
  assert.equal(bridgeClicks, 0);

  editor.text = 'outro prompt';
  state._modernIndividualVideo = false;
  assert.equal(await submit.call(state), true);
  assert.equal(directClicks, 1);
  assert.equal(bridgeClicks, 1);
});

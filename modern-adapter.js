/* Compatibility layer for the Google Flow interface observed on 2026-09-04. */
(function (root) {
  'use strict';
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const refKey = value => norm(value).replace(/ _$/, '').replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '').toLocaleLowerCase();
  const sceneInfo = name => {
    const m = norm(name).match(/^Cena\s+(\d+(?:\.\d+)?)\s*-\s*(Imagem|V[ií]deo)\s+(\d+)$/i);
    return m ? { scene: `Cena ${m[1]}`, sceneNum: Number(m[1]), imgNum: Number(m[3]), isVideo: /^v/i.test(m[2]) } : null;
  };
  const unique = entries => [...new Map(entries.filter(e => e && e.uuid).map(e => [e.uuid, e])).values()];
  const cleanEditorText = editor => {
    const copy = editor.cloneNode(true);
    copy.querySelectorAll('.prosemirror-placeholder,.ProseMirror-separator,.ProseMirror-trailingBreak').forEach(e => e.remove());
    return norm(copy.textContent.replace(/[\u200b\ufeff]/g, ''));
  };
  const safeName = value => norm(value).replace(/\.(png|jpe?g|webp|gif|mp4|webm)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'media';
  const videoIdentity = source => {
    const direct = String(source).match(/\/image\/([a-f0-9-]{36})(?:[?/#]|$)/i)?.[1];
    if (direct) return direct;
    // Flow uses the same opaque ASB resource for a thumbnail and playback;
    // playback appends a rendition suffix such as =mm,22,15.
    const resource = String(source).match(/\/asb\/([^?=#]+)/)?.[1];
    if (!resource) return null;
    let hash = 0xcbf29ce484222325n;
    for (const char of resource) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n);
    return 'video-' + hash.toString(16).padStart(16, '0');
  };
  const zipFiles = async files => {
    if (files.length > 65535) throw new Error('Divida o download em lotes menores.');
    const encode = new TextEncoder(), local = [], central = [];
    let offset = 0, centralSize = 0;
    for (const file of files) {
      const data = new Uint8Array(await file.blob.arrayBuffer()), name = encode.encode(file.name);
      let crc = 0xffffffff;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      if (offset + data.length + name.length + 30 > 0xffffffff) throw new Error('Divida o download em lotes menores que 4 GB.');
      const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); header.set(name, 30);
      const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
      d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
      local.push(header, data); central.push(directory); offset += header.length + data.length; centralSize += directory.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  };
  const pure = { norm, refKey, sceneInfo, unique, cleanEditorText, safeName, zipFiles, videoIdentity };
  if (typeof module === 'object' && module.exports) module.exports = pure;

  root.__installFlowModern = function (FlowAutomation, ctx) {
    if (location.hostname !== 'flow.google.com' && !location.hostname.endsWith('.flow.google.com')) return;
    console.info('%c[Flow] VERSAO: ABA-RENOMEAR 21:27:59', 'background:#10b981;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px');
    const { CONFIG, parsePrompt, parsePromptsText, extractReferences, parseReferenceHeader } = ctx;
    const proto = FlowAutomation.prototype;
    const old = Object.fromEntries(Object.getOwnPropertyNames(proto).filter(k => typeof proto[k] === 'function').map(k => [k, proto[k]]));
    const labels = {
      'Search assets': 'Pesquisar recursos', 'Add ingredients to the prompt box': 'Adicionar elementos à caixa de comando',
      'Settings trigger': 'Gatilho de configurações', 'Start generation': 'Iniciar geração', 'Clear prompt': 'Apagar comando',
      'Category navigation': 'Navegação por categoria', 'Asset list': 'Lista de recursos', 'Mode': 'Modo',
      'Output count': 'Quantidade de resultados', 'More options': 'Mais opções', 'Done': 'Concluído',
      'Cancel': 'Cancelar', 'Project navigation': 'Navegar pelos projetos', 'Search': 'Pesquisar',
      'Filtering and sorting options': 'Opções de filtragem e ordenação', 'Clear all filters': 'Limpar todos os filtros'
    };
    const selectorFor = selector => selector.replace(/\[aria-label="([^"]+)"\]/g, (match, label) => labels[label] ? `:is(${match},[aria-label="${labels[label]}"])` : match);
    const $ = (selector, parent = document) => parent.querySelector(selectorFor(selector));
    const $$ = (selector, parent = document) => [...parent.querySelectorAll(selectorFor(selector))];
    const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const own = el => !!el.closest('#flow-panel,#flow-assign-panel,#flow-popup,#flow-mini');
    const controlText = el => {
      if (el.getAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
      const copy = el.cloneNode(true);
      copy.querySelectorAll('mat-icon,i.google-symbols,svg,[aria-hidden="true"]').forEach(icon => icon.remove());
      return norm(copy.textContent);
    };
    const textButton = (labels, selector = 'button', parent = document) => $$(selector, parent).find(el => visible(el) && !own(el) && labels.some(label => controlText(el).toLowerCase() === label.toLowerCase()));
    const menuItem = labels => textButton(labels, '[role="menuitem"]');
    const stopError = () => Object.assign(new Error('Operação interrompida.'), { stopped: true });
    const setInput = (el, value) => {
      if (!el) throw new Error('Campo de texto não encontrado.');
      const type = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    Object.assign(proto, {
      modernStopped() { return this._modernTaskRunning && (this.shouldStop || this.videoShouldStop); },
      async modernWait(check, timeout = 10000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          if (this.modernStopped()) throw stopError();
          const result = check();
          if (result) return result;
          await this.sleep(150);
        }
        throw new Error('O Flow não respondeu no tempo esperado.');
      },
      getEditor() { return $('.ProseMirror[contenteditable="true"]'); },
      async clearEditor() {
        await this.closeAssetPicker();
        const clear = $('button[aria-label="Clear prompt"]');
        if (clear) { clear.click(); await this.sleep(150); }
        const editor = this.getEditor();
        if (!editor) throw new Error('Campo de prompt do Flow não encontrado.');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('delete', false);
        await this.modernWait(() => cleanEditorText(editor) === '');
      },
      async insertText(text) {
        if (!text) return;
        const editor = this.getEditor();
        if (!editor) throw new Error('Campo de prompt do Flow não encontrado.');
        editor.focus();
        const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const before = cleanEditorText(editor);
        if (!document.execCommand('insertText', false, text)) throw new Error('O Flow não aceitou a inserção de texto.');
        await this.modernWait(() => cleanEditorText(editor) !== before || !norm(text));
        await this.sleep(200);
      },
      async closeAssetPicker() {
        const trigger = $('button[aria-label="Add ingredients to the prompt box"]');
        if (trigger?.getAttribute('aria-expanded') === 'true') {
          trigger.click();
          await this.modernWait(() => !visible($('input[aria-label="Search assets"]')));
        }
      },
      async openAtSelector() {
        if (visible($('input[aria-label="Search assets"]'))) return;
        const trigger = $('button[aria-label="Add ingredients to the prompt box"]');
        if (!trigger) throw new Error('Botão de referências não encontrado.');
        trigger.click();
        await this.modernWait(() => visible($('input[aria-label="Search assets"]')));
      },
      async clickDialogTab(type) {
        const labels = type === 'voice' ? ['Voices', 'Vozes'] : ['Images', 'Imagens'];
        const tab = $$('[role="tablist"][aria-label="Category navigation"] [role="tab"]').find(el => labels.includes(norm($('.toggle-text', el)?.textContent || el.textContent).replace(/^(image|voice_selection)\s*/, '')));
        // Match the visible category label without depending on the icon font.
        const match = tab || $$('[role="tablist"][aria-label="Category navigation"] [role="tab"]').find(el => labels.some(label => norm(el.textContent).endsWith(label)));
        if (!match) throw new Error(`Categoria ${labels[0]} não encontrada no seletor.`);
        if (match.getAttribute('aria-selected') !== 'true') {
          match.click();
          await this.modernWait(() => match.getAttribute('aria-selected') === 'true');
        }
      },
      /**
       * Número da cena lido do TEXTO (prompt). Aceita "{cena 12} ...", "12 - ...",
       * "12. ...", "12) ...", "97,2 - ...".
       */
      numeroDaCenaNoTexto(texto) {
        const s = norm(texto);
        if (!s) return null;
        const marcado = s.match(/^\s*[{[(]\s*(?:cena|prompt|scene)\s*([0-9]+(?:[.,][0-9]+)?)\s*[}\])]/i);
        if (marcado) return Number(String(marcado[1]).replace(',', '.'));
        const prefixo = s.match(/^\s*([0-9]{1,4}(?:[.,][0-9]+)?)\s*[-–—.):]\s+/);
        if (prefixo) return Number(String(prefixo[1]).replace(',', '.'));
        return null;
      },

      /**
       * Pega o PROMPT de uma mídia pedindo ao próprio Flow: clica em
       * "Reutilizar comando" (ícone redo), que joga o prompt inteiro na caixa de
       * texto, lê de lá e limpa. É o único caminho que funciona — o painel de
       * informações só abre com mouse físico, e a API não expõe o texto.
       */
      async promptViaReutilizar(tile) {
        if (!tile) return '';
        const botao = [...tile.querySelectorAll('button')].find(b => {
          const icone = norm(b.querySelector('mat-icon,i')?.textContent);
          const rotulo = norm(b.getAttribute('aria-label') || b.getAttribute('title'));
          return icone === 'redo' || /reutilizar|reuse|usar novamente/i.test(rotulo);
        });
        if (!botao) return '';

        try {
          botao.click();
          const editor = await this.modernWait(() => this.getEditor(), 3000);
          // MEDIDO AO VIVO: o prompt cai na caixa em ~210ms. Conferimos a cada
          // 40ms para nao perder tempo, com 2s de teto por seguranca.
          let texto = '';
          for (let i = 0; i < 50; i++) {
            await this.sleep(40);
            texto = norm(cleanEditorText(editor));
            if (texto.length > 15) break;
          }
          await this.clearEditor();
          return texto;
        } catch (_) {
          try { await this.clearEditor(); } catch (__) {}
          return '';
        }
      },
      async findAsset(name, type = 'image') {
        await this.openAtSelector();
        await this.clickDialogTab(type);
        const input = $('input[aria-label="Search assets"]');
        setInput(input, name);
        await this.sleep(700);
        let matches = [];
        try {
          await this.modernWait(() => {
            matches = $$('[role="listbox"][aria-label="Asset list"] [role="option"]').filter(option => refKey($('.asset-title', option)?.textContent) === refKey(name));
            return matches.length > 0;
          }, 12000);
        } catch (error) {
          if (error.stopped) throw error;
          throw new Error(`Referência ${type === 'voice' ? 'de voz ' : ''}"${name}" não encontrada.`);
        }
        if (matches.length !== 1) throw new Error(`Há ${matches.length} referências com o nome "${name}". Dê nomes distintos antes de continuar.`);
        return matches[0];
      },
      async selectAsset(name, type) {
        await this.openMentionPicker();
        const target = await this.findAsset(name, type);
        const before = this.getEditor().innerHTML;
        target.click();
        await this.sleep(250);
        const add = textButton(['Add to prompt', 'Adicionar ao prompt', 'Incluir no comando']);
        if (add) {
          if (add.disabled) throw new Error(`O Flow não permite adicionar "${name}" neste modo.`);
          add.click();
        }
        await this.modernWait(() => this.getEditor()?.innerHTML !== before);
        await this.closeAssetPicker();
        this.getEditor().focus();
        const useBackspace = document.getElementById(this.videoIsRunning || this._modernTestVideo ? 'fv-use-backspace' : 'flow-use-backspace')?.checked;
        if (useBackspace) {
          // Preserve the attached ingredient while removing its inline mention.
          const chips = $$('.mention-chip', this.getEditor());
          const chip = chips[chips.length - 1];
          if (chip) {
            const range = document.createRange(); range.selectNode(chip);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
            document.execCommand('delete', false); await this.sleep(200);
          }
        }
      },
      async searchAndSelect(name) { return this.selectAsset(name, 'image'); },
      async searchAndSelectVoice(name) { return this.selectAsset(name, 'voice'); },
      async openMentionPicker() {
        await this.closeAssetPicker();
        const editor = this.getEditor();
        editor.focus();
        const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const keydown = new KeyboardEvent('keydown', { key: '@', code: 'Digit2', shiftKey: true, bubbles: true, cancelable: true });
        const notHandled = editor.dispatchEvent(keydown);
        // ProseMirror routes printable characters through keypress/handleTextInput.
        const keypress = new KeyboardEvent('keypress', { key: '@', code: 'Digit2', keyCode: 64, charCode: 64, which: 64, shiftKey: true, bubbles: true, cancelable: true });
        const textNotHandled = notHandled && editor.dispatchEvent(keypress);
        if (textNotHandled && document.activeElement === editor) document.execCommand('insertText', false, '@');
        editor.dispatchEvent(new KeyboardEvent('keyup', { key: '@', code: 'Digit2', shiftKey: true, bubbles: true }));
        await this.modernWait(() => visible($('input[aria-label="Search assets"]')));
      },
      async resetEditor() { await this.closeAssetPicker(); await this.clearEditor(); },
      async configureGeneration(isVideo, count) {
        await this.closeAssetPicker();
        const trigger = $('button[aria-label="Settings trigger"]');
        if (!trigger) throw new Error('Configurações de geração não encontradas.');
        if (!visible($('[aria-label="Mode"]'))) trigger.click();
        await this.modernWait(() => visible($('[aria-label="Mode"]')));
        const radio = $$('[aria-label="Mode"] [role="radio"]').find(el => (isVideo ? ['Video', 'Vídeo'] : ['Image', 'Imagem']).includes(norm($('.toggle-text', el)?.textContent)));
        if (!radio) throw new Error('Modo de geração indisponível.');
        if (radio.getAttribute('aria-checked') !== 'true') radio.click();
        await this.modernWait(() => radio.getAttribute('aria-checked') === 'true');
        const quantity = await this.modernWait(() => $$('[aria-label="Output count"] [role="radio"]').find(el => norm(el.textContent) === `x${count}`));
        if (quantity.disabled || quantity.getAttribute('aria-disabled') === 'true') throw new Error(`O modelo atual não permite ${count} resultado(s).`);
        if (quantity.getAttribute('aria-checked') !== 'true') quantity.click();
        await this.modernWait(() => quantity.getAttribute('aria-checked') === 'true');
        trigger.click();
        await this.sleep(200);
      },
      async clickSubmit() {
        const editor = this.getEditor();
        if (!editor || !cleanEditorText(editor)) throw new Error('O prompt está vazio; nenhum envio foi feito.');
        this._modernPreparedText = cleanEditorText(editor);
        const btn = await this.modernWait(() => {
          const b = $('button[aria-label="Start generation"]');
          return b && !b.disabled ? b : null;
        });
        btn.click();
        try {
          await this.modernWait(() => cleanEditorText(this.getEditor()) === '', 15000);
        } catch (error) {
          // Do not retry an ambiguous submission: it may already have used credits.
          this._modernUncertain = true;
          throw new Error('Envio sem confirmação do Flow.');
        }
        return true;
      },
      async prepareAndSubmit(prompt) {
        if (this.modernStopped()) throw stopError();
        try { return await this.montarEEnviar(prompt); }
        catch (erro) {
          // Só o botão Parar interrompe. Qualquer outro problema (referência
          // inexistente, diálogo travado, editor teimoso) vira falha DESTE
          // prompt e a fila segue para o próximo.
          if (erro && erro.stopped) throw erro;
          const reg = this.videoIsRunning ? this.logVideoDebug : this.logDebug;
          try { reg.call(this, `⏭️ Prompt ${prompt.promptNum} pulado: ${erro && erro.message ? erro.message : erro}`, 'error'); } catch (_) {}
          try { await this.closeAssetPicker(); } catch (_) {}
          try { await this.closeMenus(); } catch (_) {}
          try { await this.clearEditor(); } catch (_) {}
          return false;
        }
      },
      async montarEEnviar(prompt) {
        this.logDebug(`Preparando prompt ${prompt.promptNum}...`, 'info');
        await this.clearEditor();
        for (const segment of parsePrompt(prompt.text)) {
          if (this.modernStopped()) throw stopError();
          if (segment.type === 'text') await this.insertText(segment.content);
          else if (segment.type === 'ref') await this.searchAndSelect(segment.name);
          else if (segment.type === 'voice') await this.searchAndSelectVoice(segment.name);
        }
        return this.clickSubmit();
      },
      getScroller() {
        // Procura quem REALMENTE rola: o nome do container muda entre versoes do
        // Flow, e pegar o errado fazia a rolagem automatica nao andar (a pagina so
        // descia quando o usuario rolava na mao).
        const rola = el => el && el.scrollHeight > el.clientHeight + 4;
        for (const sel of ['cdk-virtual-scroll-viewport.tiles-container',
                           'cdk-virtual-scroll-viewport',
                           '.virtual-scroll-container',
                           '[data-virtuoso-scroller="true"]']) {
          const el = $(sel);
          if (rola(el)) return el;
        }
        let el = this.getTiles()[0];
        for (let i = 0; el && i < 14; i++) {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && rola(el)) return el;
          el = el.parentElement;
        }
        const pagina = document.scrollingElement || document.documentElement;
        if (rola(pagina)) return pagina;
        return $('cdk-virtual-scroll-viewport.tiles-container') || $('.virtual-scroll-container') || null;
      },

      /** Rola um pedaco e confere se andou; nao insiste quando ja chegou na ponta. */
      rolarUmPedaco(scroller, fracao, paraCima) {
        const passo = Math.max(100, scroller.clientHeight * fracao);
        const antes = Math.round(scroller.scrollTop);
        const limite = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (!paraCima && antes >= limite - 2) return false;
        if (paraCima && antes <= 2) return false;
        scroller.scrollTop = paraCima ? Math.max(0, antes - passo) : Math.min(limite, antes + passo);
        if (Math.round(scroller.scrollTop) !== antes) return true;
        const tiles = this.getTiles();
        const alvo = paraCima ? tiles[0] : tiles[tiles.length - 1];
        if (!alvo || !alvo.scrollIntoView) return false;
        alvo.scrollIntoView({ block: paraCima ? 'start' : 'end', inline: 'nearest' });
        const agora = Math.round(scroller.scrollTop);
        const foiPraFrente = paraCima ? agora < antes : agora > antes;
        if (!foiPraFrente) { scroller.scrollTop = antes; return false; }
        return true;
      },
      getTiles() { return $$('flow-grid-tile-container').filter(tile => $('flow-image-tile,flow-video-tile', tile)); },
      getUuidFromTile(tile) {
        // Video tiles expose their persistent thumbnail id instead of data-media-id.
        // This is a gallery identity only; renaming/downloading use native UI actions.
        if ($('flow-video-tile', tile)) {
          this._modernVideoIds ||= new WeakMap();
          this._modernVideoAliases ||= new Map();
          if ($('flow-pending-tile', tile)) { this._modernVideoIds.delete(tile); return null; }
          const source = $('flow-video-tile img.thumbnail', tile)?.getAttribute('src') || $('flow-video-tile video', tile)?.getAttribute('poster') || $('flow-video-tile video', tile)?.getAttribute('src') || '';
          const key = videoIdentity(source), name = this.getTileName(tile), previous = this._modernVideoIds.get(tile);
          if (!key) return previous?.id || null;
          const sameTile = previous && (previous.key === key || previous.name === name);
          const id = this._modernVideoAliases.get(key) || (sameTile ? previous.id : key);
          this._modernVideoAliases.set(key, id); this._modernVideoIds.set(tile, { id, key, name });
          return id;
        }
        return $('[data-media-id]', tile)?.getAttribute('data-media-id') || null;
      },
      getWorkflowIdFromTile(tile) { return this.getUuidFromTile(tile); },
      getTileName(tile) { return norm(tile.getAttribute('aria-label') || $('.footer-title', tile)?.textContent); },
      getPromptSubtitleFromTile(tile) { return this.getTileName(tile); },
      isVideoTile(tile) { return !!$('flow-video-tile,video', tile); },
      getMediaSrcFromTile(tile) { return $('video[src],img[data-media-id],flow-video-tile img.thumbnail', tile)?.src || ''; },
      getImgSrcFromTile(tile) { return this.getMediaSrcFromTile(tile); },
      tileHasProgress(tile) { return !!$('flow-pending-tile,[role="progressbar"],mat-progress-spinner,mat-spinner', tile); },
      isTileError(tile) { return !this.tileHasProgress(tile) && (!!$('flow-error-tile,flow-failed-tile', tile) || $$('mat-icon', tile).some(el => ['error', 'warning', 'error_outline'].includes(norm(el.textContent)))); },
      isTileLoaded(tile) { return !!this.getUuidFromTile(tile) && !this.tileHasProgress(tile) && !this.isTileError(tile) && !!$('img[src],video[src]', tile); },
      isTilePending(tile) { return !this.isTileLoaded(tile) && !this.isTileError(tile); },
      snapshotImageUuids() { return new Set(this.getTiles().map(t => this.getUuidFromTile(t)).filter(Boolean)); },
      tileEntry(tile) {
        const uuid = this.getUuidFromTile(tile);
        return { uuid, workflowId: uuid, name: this.getTileName(tile), src: this.getMediaSrcFromTile(tile), isVideo: this.isVideoTile(tile), loaded: this.isTileLoaded(tile), error: this.isTileError(tile) };
      },
      async scanGallery(visit, { restore = true, completo = false, aoAndar = null, maxMs = 0 } = {}) {
        const scroller = this.getScroller();
        if (!scroller) throw new Error('Galeria do projeto não encontrada. Volte à tela de mídias.');
        const originalTop = scroller.scrollTop;
        const entries = new Map();
        const inicio = Date.now();
        const TETO = maxMs || (completo ? 180000 : 60000);
        let settledBottom = 0;
        scroller.scrollTop = 0;

        // Espera a grade desenhar. No modo COMPLETO espera ela PARAR de mudar,
        // senao lemos uma linha pela metade e a rolagem seguinte pula midias.
        let assinaturaAnterior = '';
        const esperarGrade = async () => {
          if (!completo) {
            for (let e = 0; e < 250; e += 50) {
              await this.sleep(50);
              const a = this.getTiles().map(x => this.getUuidFromTile(x)).join(',');
              if (a && a !== assinaturaAnterior) { assinaturaAnterior = a; return; }
            }
            return;
          }
          let anterior = null;
          for (let e = 0; e < 900; e += 80) {
            await this.sleep(80);
            const a = this.getTiles().map(x => this.getUuidFromTile(x)).join(',');
            if (a && a === anterior) { assinaturaAnterior = a; return; }
            anterior = a;
          }
        };

        const colher = async () => {
          for (const tile of this.getTiles()) {
            const entry = this.tileEntry(tile);
            if (!entry.uuid || entries.has(entry.uuid)) continue;
            entries.set(entry.uuid, entry);
            if (visit && await visit(entry, tile) === false) return false;
          }
          if (aoAndar) aoAndar(entries.size, Math.round(scroller.scrollTop));
          return true;
        };

        try {
          // ── Descida ──
          for (let step = 0; step < 2000; step++) {
            if (this.modernStopped()) throw stopError();
            if (Date.now() - inicio >= TETO) return [...entries.values()];
            await esperarGrade();
            if (!(await colher())) return [...entries.values()];
            if (!this.rolarUmPedaco(scroller, completo ? 0.45 : 0.65, false)) {
              if (++settledBottom >= 2) break;
            } else settledBottom = 0;
          }

          // ── Subida (so no modo completo): pega o que a lista virtualizada
          //    nao chegou a desenhar na descida. ──
          if (completo) {
            let parado = 0;
            for (let volta = 0; volta < 600; volta++) {
              if (this.modernStopped()) throw stopError();
              if (Date.now() - inicio >= TETO) break;
              await esperarGrade();
              if (!(await colher())) break;
              if (!this.rolarUmPedaco(scroller, 0.45, true)) { if (++parado >= 2) break; } else parado = 0;
            }
          }
          return [...entries.values()];
        } finally { if (restore && scroller.isConnected) scroller.scrollTop = originalTop; }
      },
      async scrollToWorkflow(id) {
        let found = this.getTiles().find(t => this.getUuidFromTile(t) === id);
        if (found) { found.scrollIntoView({ block: 'center' }); return found; }
        await this.scanGallery((entry, tile) => { if (entry.uuid === id) { found = tile; return false; } }, { restore: false });
        return found || null;
      },
      async detectGrid() {
        const tiles = this.getTiles();
        const first = tiles[0]?.getBoundingClientRect();
        this.gridCols = first ? tiles.filter(t => Math.abs(t.getBoundingClientRect().top - first.top) < 10).length || 1 : 1;
        this.rowHeight = first?.height || 300;
        const info = document.getElementById('flow-grid-info');
        if (info) info.textContent = `Flow atualizado • ${this.gridCols} coluna(s)`;
      },
      async openTileMenu(tile) {
        if (!tile?.isConnected) throw new Error('Mídia não está visível na galeria.');
        tile.scrollIntoView({ block: 'center' });
        const btn = $('button[aria-label="More options"]', tile);
        if (btn) btn.click();
        else tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        await this.modernWait(() => $$('[role="menu"]').some(visible));
        return true;
      },
      async closeMenus() {
        const active = document.activeElement;
        active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        $$('.cdk-overlay-backdrop').filter(visible).forEach(el => el.click());
        await this.sleep(150);
      },
      /**
       * Renomeia. Tenta primeiro a API do Flow (um PATCH — era assim antes da
       * atualização e é MUITO mais rápido que abrir menu). Se a API não
       * responder, cai no menu da mídia. A decisão é tomada UMA vez.
       */
      async apiRename(id, name) {
        if (this._apiRenomearVale !== false && old.apiRename) {
          try {
            const deu = await old.apiRename.call(this, id, name);
            if (deu) {
              if (this._apiRenomearVale === undefined) {
                this._apiRenomearVale = true;
                this.logDebug('⚡ Renomeando pela API do Flow (rápido).', 'success');
              }
              return true;
            }
          } catch (_) {}
          if (this._apiRenomearVale === undefined) {
            this._apiRenomearVale = false;
            this.logDebug('A API de renomear não respondeu; usando o menu da mídia (mais lento).', 'warning');
          }
        }
        return this.renomearPeloMenu(id, name);
      },

      async renomearPeloMenu(id, name) {
        try {
          const tile = await this.scrollToWorkflow(id);
          if (!tile) throw new Error('Mídia não encontrada para renomear.');
          if (this.getTileName(tile) === name) return true;
          await this.openTileMenu(tile);
          const rename = menuItem(['Rename', 'Renomear']);
          if (!rename) throw new Error('Comando Renomear não encontrado.');
          rename.click();
          const form = await this.modernWait(() => $$('.cdk-overlay-pane flow-editable-text').find(visible));
          setInput($('input', form), name);
          const done = $('button[aria-label="Done"]', form) || $$('button', form).find(b => norm($('mat-icon', b)?.textContent) === 'done');
          if (!done) throw new Error('Confirmação de renomeação não encontrada.');
          done.click();
          await this.modernWait(() => this.getTiles().some(t => this.getUuidFromTile(t) === id && this.getTileName(t) === name));
          return true;
        } catch (error) { this.logDebug(`Renomear: ${error.message}`, 'error'); await this.closeMenus(); return false; }
      },
      async apiFavorite(id, value) {
        if (this._apiFavoritarVale !== false && old.apiFavorite) {
          try {
            const deu = await old.apiFavorite.call(this, id, value);
            if (deu) { this._apiFavoritarVale = true; return true; }
          } catch (_) {}
          if (this._apiFavoritarVale === undefined) this._apiFavoritarVale = false;
        }
        return this.favoritarPeloBotao(id, value);
      },

      async favoritarPeloBotao(id, value) {
        try {
          const tile = await this.scrollToWorkflow(id);
          if (!tile) throw new Error('Mídia não encontrada para favoritar.');
          const target = $$('button[aria-label]', tile).find(b => /favou?rite|favorito/i.test(b.getAttribute('aria-label')));
          if (!target) throw new Error('Botão de favorito não encontrado.');
          const before = target.getAttribute('aria-label');
          if (/remove|remover/i.test(before) === !!value) return true;
          target.click();
          await this.modernWait(() => $$('button[aria-label]', tile).some(b => /favou?rite|favorito/i.test(b.getAttribute('aria-label')) && b.getAttribute('aria-label') !== before));
          return true;
        } catch (error) { this.logDebug(`Favoritar: ${error.message}`, 'error'); return false; }
      },
      async assignScene(sceneNum, sceneName, id, tile) {
        const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
        const existing = assignments.get(sceneName) || [];
        const known = existing.find(item => item.workflowId === id);
        const imgNum = known?.imgNum || Math.max(0, ...existing.map(item => item.imgNum)) + 1;
        const label = `Cena ${sceneNum} - ${this._videoAssignActive ? 'Vídeo' : 'Imagem'} ${imgNum}`;
        if (!await this.apiRename(id, label)) return false;
        const favorite = await this.apiFavorite(id, true);
        for (const list of assignments.values()) {
          const index = list.findIndex(item => item.workflowId === id);
          if (index >= 0) list.splice(index, 1);
        }
        const list = assignments.get(sceneName) || [];
        list.push({ imgNum, workflowId: id, src: this.getMediaSrcFromTile(tile) }); assignments.set(sceneName, list);
        this.tileAssignments.set(id, { label, type: 'scene', scene: sceneName, imgNum, isVideo: !!this._videoAssignActive });
        this.addLabelToTile(tile, label, id, 'scene', sceneName);
        this.updateAssignItemUI(sceneName, true); this.updateAssignCount(); this.startLabelObserver();
        this.logDebug(favorite ? `✅ ${label} atribuída.` : `${label} renomeada; não foi possível marcar favorito.`, favorite ? 'success' : 'warning');
        return true;
      },
      async assignReference(name, id, tile) {
        const previous = this.refAssignments.get(name);
        if (!await this.apiRename(id, name + CONFIG.REF_SUFFIX)) return false;
        const favorite = await this.apiFavorite(id, true);
        if (previous && previous !== id && await this.apiRename(previous, 'Imagem gerada')) {
          await this.apiFavorite(previous, false); this.tileAssignments.delete(previous); this.removeLabelFromTile(previous);
        }
        this.refAssignments.set(name, id);
        this.tileAssignments.set(id, { label: name, type: 'ref', name });
        this.addLabelToTile(tile, name, id, 'ref', name);
        this.updateAssignItemUI(name, true); this.updateAssignCount(); this.startLabelObserver();
        this.logDebug(favorite ? `✅ ${name} atribuída.` : `${name} renomeada; não foi possível marcar favorito.`, favorite ? 'success' : 'warning');
        return true;
      },
      async validateReferences(source = 'images') {
        const video = source === 'video', prefix = video ? 'fv' : 'flow';
        const btn = document.getElementById(`${prefix}-validate-btn`), label = btn.textContent;
        const status = (type, message) => video ? this.setVideoStatus(type, message) : this.setStatus(type, message);
        btn.disabled = true;
        try {
          const refs = extractReferences(parsePromptsText(document.getElementById(`${prefix}-prompts-input`).value));
          const missing = [];
          for (let i = 0; i < refs.length; i++) {
            btn.textContent = `⏳ ${i + 1}/${refs.length}`;
            let valid = false;
            try { await this.findAsset(refs[i], 'image'); valid = true; }
            catch (error) { missing.push(refs[i]); this.logDebug(error.message, 'warning'); }
            this.validatedRefs[refs[i].toLowerCase().trim()] = valid;
            this.validatedRefs[this.referenceKey(refs[i])] = valid;
          }
          this.saveValidatedRefs(); this.updateReferences(); this.updateVideoReferences();
          status(missing.length ? 'error' : 'success', missing.length ? `Não encontradas: ${missing.join(', ')}` : `✅ ${refs.length} referência(s) conferida(s) no Flow.`);
        } catch (error) { status('error', error.message); }
        finally { await this.closeAssetPicker(); btn.disabled = false; btn.textContent = label; }
      },
      async analyzeProject(source = 'images') {
        const video = source === 'video', prefix = video ? 'fv' : 'flow';
        const btn = document.getElementById(`${prefix}-analyze-btn`), label = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analisando...'; }
        try {
          const entries = await this.scanGallery();
          this.tileAssignments.clear(); this.refAssignments.clear(); this.sceneAssignments.clear(); this.videoSceneAssignments.clear();
          for (const entry of entries) {
            const scene = sceneInfo(entry.name);
            if (scene) {
              const assignments = entry.isVideo ? this.videoSceneAssignments : this.sceneAssignments;
              if (!assignments.has(scene.scene)) assignments.set(scene.scene, []);
              assignments.get(scene.scene).push({ imgNum: scene.imgNum, workflowId: entry.uuid, src: entry.src });
              this.tileAssignments.set(entry.uuid, { label: entry.name, type: 'scene', scene: scene.scene, imgNum: scene.imgNum, isVideo: entry.isVideo });
            } else if (entry.name.endsWith(CONFIG.REF_SUFFIX)) {
              const name = entry.name.slice(0, -CONFIG.REF_SUFFIX.length);
              this.refAssignments.set(name, entry.uuid);
              this.tileAssignments.set(entry.uuid, { label: name, name, type: 'ref', isVideo: entry.isVideo });
            }
          }
          this.startLabelObserver(); this.updateAssignCount();
          document.getElementById(`${prefix}-download-section`).style.display = '';
          (video ? this.setVideoStatus : this.setStatus).call(this, 'success', `✅ ${entries.length} mídias analisadas; ${this.tileAssignments.size} identificadas.`);
        } catch (error) { (video ? this.setVideoStatus : this.setStatus).call(this, 'error', error.message); }
        finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
      },
      startLabelObserver() {
        const render = () => {
          for (const tile of this.getTiles()) {
            const id = this.getUuidFromTile(tile), data = this.tileAssignments.get(id);
            const previous = $('.flow-tile-label', tile);
            if (previous && (previous.dataset.wf !== id || !data)) previous.remove();
            if (data && !$('.flow-tile-label', tile)) this.addLabelToTile(tile, data.label, id, data.type, data.type === 'ref' ? data.name : data.scene);
          }
        };
        render();
        if (!this._labelObserverId) this._labelObserverId = setInterval(render, 800);
      },
      saveDownload(blob, filename) {
        const link = document.createElement('a'), url = URL.createObjectURL(blob);
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      },
      async downloadEntry(entry, filename, collect = false) {
        // Images use the media URL already exposed by Flow. Videos use its download menu.
        const tile = await this.scrollToWorkflow(entry.uuid || entry.workflowId);
        if (!tile) throw new Error(`Mídia não encontrada: ${entry.name || entry.uuid}`);
        if (!this.isVideoTile(tile)) {
          const src = this.getMediaSrcFromTile(tile);
          const response = await fetch(src, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`Download recusado (${response.status}).`);
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) throw new Error('O Flow não retornou um arquivo de imagem.');
          const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
          const file = { blob, name: `${safeName(filename)}.${ext}` };
          if (collect) return file;
          this.saveDownload(blob, file.name);
        } else {
          await this.openTileMenu(tile);
          const download = menuItem(['Download', 'Baixar']);
          if (!download) throw new Error('Download de vídeo não encontrado.');
          download.click();
          const original = await this.modernWait(() => $$('[role="menuitem"]').find(b => visible(b) && !b.disabled && /original|720p/i.test(b.textContent)));
          original.click();
          await this.closeMenus();
        }
        await this.sleep(500);
      },
      async downloadEntries(entries) {
        if (this._modernDownloading) return;
        this._modernDownloading = true;
        let done = 0, failed = 0;
        const files = [], names = new Set();
        const list = unique(entries.map(e => ({ ...e, uuid: e.uuid || e.workflowId })));
        try {
        for (const entry of list) {
          try {
            const file = await this.downloadEntry(entry, entry.filename || entry.name || `media_${entry.uuid}`, list.length > 1);
            if (file) {
              if (names.has(file.name)) file.name = `${safeName(file.name)}_${entry.uuid}.${file.name.split('.').pop()}`;
              names.add(file.name); files.push(file);
            }
            done++;
          }
          catch (error) { failed++; this.logDebug(error.message, 'error'); }
        }
        if (files.length) this.saveDownload(await zipFiles(files), `Flow_imagens_${Date.now()}.zip`);
        this.setStatus(failed ? 'warning' : 'success', `⬇️ ${done} mídia(s) preparada(s)${files.length ? `; ${files.length} imagem(ns) no ZIP` : ''}${failed ? `; ${failed} falha(s)` : ''}. Confira os downloads do Chrome.`);
        } catch (error) { this.setStatus('error', `Download: ${error.message}`); }
        finally { this._modernDownloading = false; }
      },
      async downloadScenes() {
        const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
        const entries = [...assignments].flatMap(([name, items]) => items.map(item => ({ ...item, uuid: item.workflowId, filename: `${name.replace(/ /g, '_')}_${item.imgNum}` })));
        return this.downloadEntries(entries);
      },
      async downloadProjectImages(mode) {
        const entries = await this.scanGallery();
        const filtered = entries.filter(e => mode === 'all' || (mode === 'scenes' ? this.tileAssignments.get(e.uuid)?.type === 'scene' : mode === 'refs' ? this.tileAssignments.get(e.uuid)?.type === 'ref' : this.tileAssignments.has(e.uuid)));
        return this.downloadEntries(filtered);
      },
      async downloadAllGalleryImages() { return this.downloadEntries(await this.scanGallery()); },
      async downloadLastRunMedia() { return this.downloadEntries(this._lastRunMedia || []); }
    });

    const prepare = proto.prepareAndSubmit;
    Object.assign(proto, {
      async prepareAndSubmit(prompt) {
        this._modernCurrentPrompt = prompt.promptNum;
        const beforeIds = this.snapshotImageUuids();
        const expected = this.videoIsRunning ? this.videoResultsPerPrompt : this.imagesPerPrompt;
        const enviou = await prepare.call(this, prompt);
        // Pulado lá dentro: não adianta esperar resultados que não virão.
        if (enviou === false) return false;
        const record = { promptNum: prompt.promptNum, nodes: [], results: new Map(), beforeIds, expected, signature: this._modernPreparedText };
        this._modernActiveRecords ||= [];
        this._modernActiveRecords.push(record);
        try {
          await this.modernWait(() => {
            this.captureModernResults();
            return record.nodes.length === expected;
          }, 12000);
        } catch (error) {
          if (error && error.stopped) throw error;
          this._modernUncertain = true;
          const reg = this.videoIsRunning ? this.logVideoDebug : this.logDebug;
          try { reg.call(this, `⏭️ Prompt ${prompt.promptNum}: envio feito, mas não identifiquei os resultados — conta como falha e sigo.`, 'error'); } catch (_) {}
          return false;
        }
        if (!this._modernGalleryObserver) {
          this._modernGalleryObserver = new MutationObserver(() => this.captureModernResults());
          this._modernGalleryObserver.observe(this.getScroller(), { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-media-id', 'aria-label'] });
        }
        record.observer = this._modernGalleryObserver;
        this._modernRecords ||= new Map();
        this._modernRecords.set(prompt.promptNum, record);
        this._modernObservers ||= []; this._modernObservers.push(record.observer);
        return true;
      },
      captureModernResults() {
        const records = this._modernActiveRecords || [];
        const total = records.reduce((sum, rec) => sum + rec.expected, 0);
        const ignoredErrors = new Map(this._modernIgnoredErrors || []);
        const fresh = this.getTiles().filter(tile => !this._modernBaseline?.has(this.getUuidFromTile(tile))).reverse().filter(tile => {
          if (!this.isTileError(tile)) return true;
          const key = norm(tile.textContent), remaining = ignoredErrors.get(key) || 0;
          if (!remaining) return true;
          ignoredErrors.set(key, remaining - 1); return false;
        }).reverse();
        // CDK rebuilds entire rows on insertion. Associate fresh slots by creation
        // order, not DOM object identity, and validate pending text when available.
        if (!total || fresh.length !== total) return;
        let offset = 0;
        for (const record of [...records].reverse()) {
          const nodes = fresh.slice(offset, offset + record.expected);
          offset += record.expected;
          if (nodes.some(tile => {
            const pendingText = norm($('flow-pending-tile .subtitle', tile)?.textContent);
            return pendingText && pendingText !== record.signature;
          })) { this._modernCaptureError = 'A ordem dos resultados mudou ou há uma geração externa ao lote.'; return; }
          record.nodes = nodes;
          nodes.forEach((tile, index) => {
            const entry = this.tileEntry(tile), previous = record.results.get(index);
            if (previous?.uuid && entry.uuid && previous.uuid !== entry.uuid) {
              this._modernCaptureError = 'A ordem da galeria mudou durante o acompanhamento.'; return;
            }
            if (entry.loaded && !record.beforeIds.has(entry.uuid)) record.results.set(index, entry);
            else if (entry.error) record.results.set(index, { error: true });
          });
        }
      },
      buildPositionMatrix(batch, count) {
        return batch.flatMap(prompt => Array.from({ length: count }, (_, index) => ({ promptNum: prompt.promptNum, imgNum: index + 1, state: 'pending', record: this._modernRecords?.get(prompt.promptNum), index })));
      },
      async waitForMatrix(matrix) {
        const noProgressLimit = Math.max(60000, Number(document.getElementById('flow-t-semprog')?.value || 2) * 60000);
        let lastProgress = Date.now(), signature = '';
        let motivoParada = null;   // encerra o lote sem derrubar a fila
        const hardDeadline = Date.now() + Math.max(noProgressLimit * 5, 20 * 60000);
        while (true) {
          if (this.modernStopped()) throw stopError();
          this.captureModernResults();
          if (this._modernCaptureError) { motivoParada = this._modernCaptureError; break; }
          let pending = 0;
          for (const slot of matrix) {
            if (slot.state !== 'pending') continue;
            if (!slot.record) { slot.state = 'error'; continue; }
            const result = slot.record.results.get(slot.index);
            if (result?.error) slot.state = 'error';
            else if (result?.loaded) Object.assign(slot, result, { state: 'loaded' });
            else pending++;
          }
          if (!pending) break;
          const nextSignature = matrix.map(slot => `${slot.state}:${norm(slot.record?.nodes[slot.index]?.querySelector('.loading-percentage')?.textContent)}`).join('|');
          if (signature !== nextSignature) { signature = nextSignature; lastProgress = Date.now(); }
          if (Date.now() - lastProgress > noProgressLimit || Date.now() > hardDeadline) {
            motivoParada = 'A geração não terminou no tempo esperado.'; break;
          }
          if (matrix.some(slot => slot.state === 'pending' && !slot.record?.nodes[slot.index]?.isConnected)) {
            motivoParada = 'A galeria mudou durante o lote.'; break;
          }
          await this.sleep(Math.max(300, Number(document.getElementById('flow-t-poll')?.value || 0.5) * 1000));
        }
        if (motivoParada) {
          this._modernUncertain = true;
          const faltaram = matrix.filter(s => s.state === 'pending');
          for (const s of faltaram) s.state = 'error';
          const reg = this.videoIsRunning ? this.logVideoDebug : this.logDebug;
          try { reg.call(this, '⚠️ ' + motivoParada + ' ' + faltaram.length + ' contam como falha — a fila SEGUE.', 'warning'); } catch (_) {}
        }
        for (const record of new Set(matrix.map(slot => slot.record).filter(Boolean))) record.observer.disconnect();
        for (const slot of matrix) if (slot.uuid) this._modernBaseline?.add(slot.uuid);
        this.rememberModernErrors();
        this._modernActiveRecords = [];
        this._modernGalleryObserver = null;
        // Keep only serializable result fields in assignment/download history.
        matrix.forEach(slot => { delete slot.record; delete slot.index; });
      },
      async prepareGalleryForRun() {
        const nav = $('[aria-label="Project navigation"]');
        const all = nav && $$('*', nav).find(el => !el.children.length && ['All media','Todas as mídias'].includes(norm(el.textContent)));
        if (all) { all.click(); await this.sleep(200); }
        const search = $('main input[aria-label="Search"]');
        if (search?.value) { setInput(search, ''); await this.sleep(350); }
        const filterTrigger = $('button[aria-label="Filtering and sorting options"]') || $$('main button').find(b => norm($('mat-icon', b)?.textContent) === 'filter_list');
        if (filterTrigger) {
          filterTrigger.click();
          const dialog = await this.modernWait(() => $$('[role="dialog"]').find(d => visible(d) && $('[role="radiogroup"]', d)));
          const clear = $('button[aria-label="Clear all filters"]', dialog) || textButton(['Clear', 'Limpar', 'Limpar todos os filtros'], 'button', dialog);
          if (clear) clear.click();
          const newest = $$('[role="radio"],input[type="radio"]', dialog).find(r => ['Newest','Mais recentes','Mais recente'].includes(norm(r.getAttribute('aria-label') || r.closest('mat-radio-button')?.textContent || r.textContent)));
          if (newest && newest.getAttribute('aria-checked') !== 'true' && !newest.checked) newest.click();
          await this.closeMenus();
        }
        const scroller = this.getScroller();
        if (!scroller) throw new Error('Abra a galeria do projeto antes de iniciar.');
        scroller.scrollTop = 0; await this.sleep(300);
        if (this.getTiles().some(t => this.tileHasProgress(t))) throw new Error('Já há gerações em andamento no Flow. Aguarde terminarem antes de iniciar outro lote.');
        this._modernBaseline = new Set((await this.scanGallery()).map(e => e.uuid));
        scroller.scrollTop = 0; await this.sleep(300);
        this.rememberModernErrors();
      },
      rememberModernErrors() {
        this._modernIgnoredErrors = new Map();
        for (const tile of this.getTiles().filter(t => this.isTileError(t))) {
          const key = norm(tile.textContent);
          this._modernIgnoredErrors.set(key, (this._modernIgnoredErrors.get(key) || 0) + 1);
        }
      },
      async runModern(video) {
        if (this.isRunning || this.videoIsRunning || this._modernTaskRunning) return;
        const status = (type, text) => (video ? this.setVideoStatus : this.setStatus).call(this, type, text);
        this._modernTaskRunning = true; this.shouldStop = false; this.videoShouldStop = false; this._modernUncertain = false;
        this._modernActiveRecords = []; this._modernCaptureError = null;
        try {
          const prefix = video ? 'fv' : 'flow';
          if (!norm(document.getElementById(`${prefix}-prompts-input`).value)) { status('warning', 'Insira pelo menos um prompt.'); return; }
          if (document.getElementById(`${prefix}-start-from`).value.trim() === '0') {
            await (video ? old.startVideo : old.start).call(this); return;
          }
          const count = video ? this.videoResultsPerPrompt : this.imagesPerPrompt;
          await this.configureGeneration(video, count);
          await this.prepareGalleryForRun();
          const original = video ? old.startVideo : old.start;
          await original.call(this);
        } catch (error) { status(error.stopped ? 'warning' : 'error', error.message); }
        finally {
          this._modernTaskRunning = false;
          this.isRunning = false; this.videoIsRunning = false;
          this._modernObservers?.forEach(observer => observer.disconnect()); this._modernObservers = [];
          this._modernGalleryObserver = null;
          for (const prefix of ['flow', 'fv']) {
            const start = document.getElementById(`${prefix}-start-btn`), stop = document.getElementById(`${prefix}-stop-btn`), input = document.getElementById(`${prefix}-prompts-input`);
            if (start) start.disabled = false;
            if (stop) stop.disabled = true;
            if (input) input.disabled = false;
          }
        }
      },
      async start() { return this.runModern(false); },
      async startVideo() { return this.runModern(true); },
      async autoEnumerarCenas() {
        const matrices = this._lastMatrices || [];
        if (matrices.some(m => m.some(s => s.state === 'loaded' && s.workflowId))) return this.autoAssignScenesFromMatrices(matrices, { isVideo: !!this._videoAssignActive });
        const prompts = parsePromptsText(document.getElementById(this._videoAssignActive ? 'fv-prompts-input' : 'flow-prompts-input').value);
        // A galeria manda: se o que esta na tela e video, tratamos como video,
        // nao importa por qual aba o botao foi clicado. Era isso que fazia o
        // Enumerar descartar tudo e dizer que nao achou correspondencia.
        const naTela = this.getTiles().filter(x => this.isTileLoaded(x));
        const qtdVideo = naTela.filter(x => this.isVideoTile(x)).length;
        if (naTela.length) this._videoAssignActive = qtdVideo > naTela.length / 2;
        const ehVideo = !!this._videoAssignActive;
        const aviso = (m) => { try { (ehVideo ? this.setVideoStatus : this.setStatus).call(this, 'info', m); } catch (_) {} };
        aviso('🔎 Varrendo a galeria de ' + (ehVideo ? 'vídeos' : 'imagens') + '...');

        // 1ª passada: lê o prompt de quem não tem número, clicando em
        // "Reutilizar comando" (o Flow joga o prompt na caixa de texto).
        const promptsLidos = new Map();
        let lidos = 0;
        const entries = await this.scanGallery(async (entry, tile) => {
          if (!entry.uuid || !entry.loaded) return;
          if (entry.isVideo !== !!this._videoAssignActive) return;
          if (sceneInfo(entry.name)) return;
          if (this.numeroDaCenaNoTexto(entry.name) != null) return;
          const texto = await this.promptViaReutilizar(tile);
          if (this.numeroDaCenaNoTexto(texto) != null) { promptsLidos.set(entry.uuid, texto); lidos++; }
          aviso('🔎 Lendo os prompts... ' + lidos + ' lido(s)');
        });
        aviso('🏷️ Preparando a renomeação...');

        const results = [];
        for (const entry of entries) {
          if (entry.isVideo !== !!this._videoAssignActive || !entry.loaded) continue;
          const known = sceneInfo(entry.name);

          // Já nomeada: usa o número do próprio nome.
          if (known) { results.push({ ...entry, promptNum: known.sceneNum, imgNum: known.imgNum || 1, state: 'loaded' }); continue; }

          // Número que veio do prompt (rótulo ou botão Reutilizar).
          const doPrompt = this.numeroDaCenaNoTexto(entry.name) != null
            ? this.numeroDaCenaNoTexto(entry.name)
            : this.numeroDaCenaNoTexto(promptsLidos.get(entry.uuid));
          if (doPrompt != null) { results.push({ ...entry, promptNum: doPrompt, imgNum: 1, state: 'loaded' }); continue; }
          const exact = prompts.filter(p => norm(p.text).toLowerCase() === norm(entry.name).toLowerCase());
          const prompt = known ? prompts.find(p => p.promptNum === known.sceneNum) : exact.length === 1 ? exact[0] : null;
          if (prompt?.promptNum) results.push({ ...entry, promptNum: prompt.promptNum, imgNum: known?.imgNum || 1, state: 'loaded' });
        }
        if (!results.length) {
          const carregadas = entries.filter(e => e.loaded);
          const doTipo = carregadas.filter(e => e.isVideo === ehVideo).length;
          const msg = doTipo === 0
            ? 'Não encontrei ' + (ehVideo ? 'vídeos' : 'imagens') + ' carregados nesta galeria (' + entries.length + ' item(ns) vistos).'
            : 'Encontrei ' + doTipo + ' mídia(s), mas não consegui ler o número da cena em nenhuma. O número precisa estar no começo do prompt (ex.: "235 - ...").';
          (ehVideo ? this.setVideoStatus : this.setStatus).call(this, 'warning', msg);
          this.logDebug('🔎 ' + entries.length + ' mídias vistas · ' + doTipo + ' do tipo ' + (ehVideo ? 'vídeo' : 'imagem') + ' · prompts lidos: ' + lidos + '.', 'warning');
          return;
        }
        await this.autoAssignScenesFromMatrices([results], { isVideo: !!this._videoAssignActive });
      },
      async renameUploadReferencesFromFilenames() {
        const aviso = (m) => { try { (this._videoAssignActive ? this.setVideoStatus : this.setStatus).call(this, 'info', m); } catch (_) {} };
        aviso('🔎 Varrendo a galeria inteira...');
        const entries = await this.scanGallery(null, {
          completo: true,
          aoAndar: (qtd) => aviso('🔎 Varrendo a galeria... ' + qtd + ' mídias encontradas')
        });
        aviso('🔎 Varredura concluída: ' + entries.length + ' mídias.');
        let count = 0;
        for (const entry of entries) {
          if (!/\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/i.test(entry.name)) continue;
          const name = entry.name.replace(/\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)$/i, '').replace(/ _$/, '');
          if (await this.apiRename(entry.uuid, name + CONFIG.REF_SUFFIX)) { await this.apiFavorite(entry.uuid, true); count++; }
        }
        this.setStatus('success', `✅ ${count} referência(s) renomeada(s) a partir dos nomes dos arquivos.`);
      },
      async startUpscaleProcess() {
        if (this._modernUpscaling) return;
        this._modernUpscaling = true; this.upscaleShouldStop = false; this._modernUpscaleFailures = [];
        const button = document.getElementById('fv-upscale-btn'), stop = document.getElementById('fv-upscale-stop-btn');
        button.disabled = true; stop.style.display = '';
        try {
          const entries = [...(await this.scanIdentifiedVideosForUpscale()).values()].filter(e => !this.getUpscaleRequestedSet().has(e.uuid));
          if (!entries.length) throw new Error('Analise o projeto e atribua os vídeos às cenas antes do upscale.');
          let requested = 0;
          for (const entry of entries) {
            if (this.upscaleShouldStop) break;
            try { await this.requestModernUpscale(entry); requested++; }
            catch (error) { this._modernUpscaleFailures.push(entry); this.logVideoDebug(error.message, 'error'); }
          }
          this.setVideoStatus(this._modernUpscaleFailures.length || this.upscaleShouldStop ? 'warning' : 'success', `Upscale solicitado para ${requested} vídeo(s); ${this._modernUpscaleFailures.length} falha(s)${this.upscaleShouldStop ? '; interrompido pelo usuário' : ''}. Acompanhe os downloads do Flow.`);
        } catch (error) { this.setVideoStatus('error', error.message); }
        finally {
          this._modernUpscaling = false; button.disabled = false; stop.style.display = 'none';
          document.getElementById('fv-upscale-retry-btn').style.display = this._modernUpscaleFailures.length ? '' : 'none';
        }
      },
      async scanIdentifiedVideosForUpscale() {
        const entries = await this.scanGallery();
        return new Map(entries.filter(e => e.isVideo && (sceneInfo(e.name) || this.tileAssignments.get(e.uuid)?.type === 'scene')).map(e => {
          const scene = sceneInfo(e.name) || sceneInfo(this.tileAssignments.get(e.uuid)?.label);
          return [e.uuid, { ...e, label: e.name, sceneNum: scene?.sceneNum, videoNum: scene?.imgNum }];
        }));
      },
      async requestModernUpscale(entry) {
        const tile = await this.scrollToWorkflow(entry.uuid);
        if (!tile) throw new Error(`Vídeo não encontrado: ${entry.name}`);
        await this.openTileMenu(tile);
        const download = menuItem(['Download', 'Baixar']);
        if (!download) throw new Error('Menu de download não encontrado.');
        download.click();
        const upscale = await this.modernWait(() => $$('[role="menuitem"]').find(b => visible(b) && /1080p/i.test(b.textContent)));
        if (upscale.disabled || upscale.getAttribute('aria-disabled') === 'true') throw new Error(`1080p indisponível para ${entry.name}.`);
        upscale.click();
        await this.modernWait(() => !visible(upscale), 10000);
        this.getUpscaleRequestedSet().add(entry.uuid);
        await this.sleep(800); await this.closeMenus();
      },
      async retryFailedUpscale() {
        if (this._modernUpscaling) return;
        this._modernUpscaling = true; this.upscaleShouldStop = false;
        const pending = this._modernUpscaleFailures || [];
        this._modernUpscaleFailures = [];
        let requested = 0;
        try {
        for (const entry of pending) {
          if (this.upscaleShouldStop) { this._modernUpscaleFailures.push(entry); continue; }
          try { await this.requestModernUpscale(entry); requested++; }
          catch (error) { this._modernUpscaleFailures.push(entry); this.logVideoDebug(error.message, 'error'); }
        }
        this.setVideoStatus(this._modernUpscaleFailures.length ? 'warning' : 'success', `${requested} solicitação(ões) reenviada(s).`);
        } finally { this._modernUpscaling = false; }
      }
    });
    // =====================================================================
    // ABA RENOMEAR — analisa o prompt de cada geração e renomeia
    // =====================================================================
    // Mesmo estilo de antes do Flow atualizar: varre a página de cima a baixo,
    // lê o número da cena no prompt de cada mídia, agrupa por cena e numera as
    // variações na ordem em que aparecem. A diferença é que agora o formato do
    // nome é escolhido por você, e imagens e vídeos são tratados na mesma passada.

    const MODELO_PADRAO = 'Cena {n} - {tipo} {g}';
    const CHAVE_MODELO = 'flow_modelo_nome';
    const CHAVE_ESCOPO = 'flow_renomear_escopo';

    const lerModelo = () => {
      try { return localStorage.getItem(CHAVE_MODELO) || MODELO_PADRAO; }
      catch (_) { return MODELO_PADRAO; }
    };

    const montarNome = (n, g, isVideo, modelo) => {
      const pad = v => String(v).padStart(2, '0');
      return String(modelo || lerModelo())
        .replace(/\{nn\}/gi, pad(n))
        .replace(/\{gg\}/gi, pad(g))
        .replace(/\{n\}/gi, String(n))
        .replace(/\{g\}/gi, String(g))
        .replace(/\{tipo\}/gi, isVideo ? 'Vídeo' : 'Imagem')
        .trim();
    };

    // Transforma o modelo numa expressão que RECONHECE nomes já aplicados,
    // para o Analisar, o Upscale e os Downloads continuarem achando as mídias.
    const regexDoModelo = (modelo) => {
      const marcas = [];
      const SEP = '\u0001';
      let padrao = String(modelo).replace(/\{(nn|gg|n|g|tipo)\}/gi, (_, m) => {
        marcas.push(m.toLowerCase());
        return SEP + marcas.length + SEP;
      });
      padrao = padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \t]+/g, '\\s+');
      padrao = padrao.replace(new RegExp(SEP + '(\\d+)' + SEP, 'g'), (_, i) => {
        const m = marcas[Number(i) - 1];
        if (m === 'tipo') return '(Imagem|V[ií]deo|Video)';
        if (m === 'n' || m === 'nn') return '(\\d+(?:\\.\\d+)?)';
        return '(\\d+)';
      });
      return { re: new RegExp('^' + padrao + '$', 'i'), marcas };
    };

    const lerNomeModelo = (nome) => {
      const texto = norm(nome);
      if (!texto) return null;
      for (const modelo of [lerModelo(), MODELO_PADRAO]) {
        let info;
        try { info = regexDoModelo(modelo); } catch (_) { continue; }
        const m = texto.match(info.re);
        if (!m) continue;
        const d = { sceneNum: null, imgNum: 1, isVideo: false };
        info.marcas.forEach((marca, i) => {
          const v = m[i + 1];
          if (marca === 'n' || marca === 'nn') d.sceneNum = Number(v);
          else if (marca === 'g' || marca === 'gg') d.imgNum = Number(v);
          else if (marca === 'tipo') d.isVideo = /^v/i.test(v);
        });
        if (d.sceneNum != null && !isNaN(d.sceneNum)) return d;
      }
      return null;
    };

    Object.assign(proto, {
      modeloNome: lerModelo,
      montarNome(n, g, isVideo) { return montarNome(n, g, isVideo); },
      lerNome(nome) { return lerNomeModelo(nome); },

      /**
       * Descobre o número da cena de uma mídia, do mais barato ao mais caro:
       *   1. o nome atual já está no formato de cena
       *   2. o rótulo da mídia começa com o número ("97.2 - ...")
       *   3. pede o prompt ao Flow (botão Reutilizar) — só quando precisa
       */
      async cenaDaMidia(entry, tile, permitirReutilizar) {
        const jaNomeada = lerNomeModelo(entry.name) || sceneInfo(entry.name);
        if (jaNomeada) return { num: jaNomeada.sceneNum, origem: 'nome' };

        const doRotulo = this.numeroDaCenaNoTexto(entry.name);
        if (doRotulo != null) return { num: doRotulo, origem: 'rótulo' };

        // 3. Prompt inteiro pelo painel que abre ao passar o mouse. É onde o
        //    Flow novo guarda o prompt (flow-expandable-prompt > .prompt-text).
        //    Faz o papel do __reactFiber$ da versão antiga: o __ngContext__ do
        //    Angular em produção é só um número, não dá para ler por lá.
        if (tile) {
          const doPainel = this.numeroDaCenaNoTexto(await this.promptPorHover(tile));
          if (doPainel != null) return { num: doPainel, origem: 'painel' };
        }

        // 4. Último recurso: pedir o prompt ao Flow pelo botão Reutilizar.
        if (!permitirReutilizar || !tile) return null;
        const texto = await this.promptViaReutilizar(tile);
        const doPrompt = this.numeroDaCenaNoTexto(texto);
        if (doPrompt != null) return { num: doPrompt, origem: 'reutilizar' };
        return null;
      },

      /**
       * Lê o PROMPT da mídia direto do componente Angular, sem clicar em nada.
       * É o mesmo truque que a versão antiga usava com o React (__reactFiber$):
       * o Angular guarda o estado do componente em __ngContext__, e o prompt
       * está lá dentro — inteiro, não cortado como no rótulo.
       */
      promptDoContexto(tile) {
        if (!tile) return null;
        const pareceprompt = (chave, valor) =>
          typeof valor === 'string' && valor.length > 20 && valor.length < 4000 &&
          (/^\s*\d{1,4}(?:[.,]\d+)?\s*[-–—.):]\s+/.test(valor) ||
           /^\s*[{[(]\s*(?:cena|prompt|scene)\s*\d/i.test(valor) ||
           /prompt|subtitle|caption|descri|titulo|title|text/i.test(String(chave)));

        const vistos = new Set();
        let passos = 0;
        const procurar = (obj, prof) => {
          if (!obj || prof > 5 || passos > 4000) return null;
          if (typeof obj !== 'object') return null;
          if (vistos.has(obj)) return null;
          vistos.add(obj);
          let chaves;
          try { chaves = Object.keys(obj); } catch (_) { return null; }
          for (const k of chaves) {
            passos++;
            if (passos > 4000) return null;
            let v;
            try { v = obj[k]; } catch (_) { continue; }
            if (pareceprompt(k, v)) return v;
            if (v && typeof v === 'object' && !(v instanceof Node) && !(v instanceof Window)) {
              const achou = procurar(v, prof + 1);
              if (achou) return achou;
            }
          }
          return null;
        };

        let el = tile;
        for (let i = 0; i < 6 && el; i++) {
          const ctx = el.__ngContext__;
          if (ctx) {
            const achou = procurar(ctx, 0);
            if (achou) return norm(achou);
          }
          el = el.parentElement;
        }
        return null;
      },

      /**
       * Lê o PROMPT da mídia passando o mouse por cima. O Flow abre um painel
       * (flow-info-panel > flow-expandable-prompt) com o prompt INTEIRO, que é
       * onde está o número da cena. Substitui o truque do React da versão antiga.
       */
      lerPainelDePrompt() {
        const alvos = document.querySelectorAll(
          '.cdk-overlay-container flow-expandable-prompt .prompt-text,' +
          'flow-info-panel flow-expandable-prompt .prompt-text,' +
          '.cdk-overlay-container .prompt-text');
        for (const el of alvos) {
          const t = norm(el.textContent);
          if (t.length > 12) return t;
        }
        return null;
      },

      async promptPorHover(tile, tetoMs = 1400) {
        if (!tile) return null;
        const antes = this.lerPainelDePrompt();
        const disparar = tipos => tipos.forEach(tipo => {
          try { tile.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
        });

        disparar(['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']);

        let texto = null;
        for (let esperou = 0; esperou < tetoMs; esperou += 60) {
          await this.sleep(60);
          const agora = this.lerPainelDePrompt();
          // Só aceita quando o painel MUDOU: senão leríamos o prompt da mídia anterior.
          if (agora && agora !== antes) { texto = agora; break; }
        }

        disparar(['mouseout', 'mouseleave', 'pointerleave']);
        return texto;
      },

      /** Varre tudo, monta o plano e renomeia. escopo: 'ambos' | 'imagens' | 'videos' */
      async renomearGaleria({ escopo = 'ambos', apenasAnalisar = false } = {}) {
        if (this._renomeando) return;
        this._renomeando = true;
        this.renomearParar = false;

        const painel = document.getElementById('rn-resultado');
        const barra = document.getElementById('rn-barra');
        const aviso = (m, tipo) => {
          const el = document.getElementById('rn-status');
          if (el) { el.className = 'flow-status ' + (tipo || 'info'); el.innerHTML = m; }
        };
        const linha = (texto, cor) => {
          if (!painel) return;
          const d = document.createElement('div');
          d.style.cssText = 'font-size:12px;padding:3px 8px;border-radius:6px;margin-bottom:3px;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
            (cor === 'erro' ? 'background:#fef2f2;color:#991b1b;' : 'background:#dcfce7;color:#166534;');
          d.textContent = texto;
          painel.appendChild(d);
          painel.scrollTop = painel.scrollHeight;
        };
        const progresso = (f) => { if (barra) barra.style.width = Math.round(f * 100) + '%'; };

        if (painel) painel.innerHTML = '';
        progresso(0);

        try {
          // ── 1. VARREDURA: coleta na ORDEM em que aparecem, de cima para baixo
          aviso('🔎 Varrendo a galeria...');
          const coletadas = [];
          const vistos = new Set();
          await this.scanGallery(async (entry, tile) => {
            if (this.renomearParar) return false;
            if (!entry.uuid || !entry.loaded || vistos.has(entry.uuid)) return;
            if (escopo === 'imagens' && entry.isVideo) return;
            if (escopo === 'videos' && !entry.isVideo) return;
            vistos.add(entry.uuid);
            // Número da cena: primeiro o barato (nome/rótulo). Só quem não tem
            // é que ganha o hover — e AGORA, enquanto o tile está na tela.
            let cena = null, origem = null;
            const jaTem = this.lerNome(entry.name) || sceneInfo(entry.name);
            if (jaTem) { cena = jaTem.sceneNum; origem = 'nome'; }
            else {
              const doRotulo = this.numeroDaCenaNoTexto(entry.name);
              if (doRotulo != null) { cena = doRotulo; origem = 'rótulo'; }
              else {
                const p = await this.promptPorHover(tile);
                const doPainel = this.numeroDaCenaNoTexto(p);
                if (doPainel != null) { cena = doPainel; origem = 'painel'; }
              }
            }
            coletadas.push({ uuid: entry.uuid, name: entry.name, isVideo: entry.isVideo, cena, origem });
            aviso('🔎 Varrendo a galeria... <b>' + coletadas.length + '</b> mídia(s)');
          }, { completo: true });

          if (this.renomearParar) { aviso('⏹ Parado por você.', 'warning'); return; }
          if (!coletadas.length) { aviso('Nenhuma mídia encontrada nesta tela.', 'warning'); return; }

          // ── 2. NÚMERO DA CENA: barato primeiro; só usa o Reutilizar quem precisa
          aviso('🔎 Lendo o número da cena de ' + coletadas.length + ' mídia(s)...');
          const semNumero = coletadas.filter(x => x.cena == null);
          const porOrigem = {};
          coletadas.forEach(x => { if (x.origem) porOrigem[x.origem] = (porOrigem[x.origem] || 0) + 1; });
          this.logDebug('🔎 Números encontrados por: ' +
            (Object.entries(porOrigem).map(([k, v]) => k + '=' + v).join(' · ') || 'nenhum'), 'info');

          // Sem número = sem renomear. Não abrimos o prompt de cada mídia
          // (era lento e escrevia na sua caixa de texto). O prompt já foi lido
          // do componente durante a varredura, como a versão antiga fazia.
          if (semNumero.length) {
            this.logDebug('🔎 ' + semNumero.length + ' mídia(s) sem número de cena — ficam de fora.', 'warning');
          }
          progresso(0.4);

          // ── 3. PLANO: agrupa por cena e numera as variações na ordem de aparição
          const contador = new Map();
          const plano = [];
          let semCena = 0;
          for (const item of coletadas) {
            if (item.cena == null) { semCena++; continue; }
            const chave = item.cena + '|' + (item.isVideo ? 'v' : 'i');
            const g = (contador.get(chave) || 0) + 1;
            contador.set(chave, g);
            plano.push({ ...item, g, novo: montarNome(item.cena, g, item.isVideo) });
          }

          const cenas = new Set(plano.map(p => p.cena)).size;
          if (!plano.length) {
            aviso('Não consegui ler o número da cena de nenhuma mídia. ' +
                  'Confira se os prompts começam com o número (ex: <b>12 - ...</b> ou <b>{cena 12}</b>).', 'warning');
            return;
          }

          if (apenasAnalisar) {
            aviso('🔎 <b>' + plano.length + '</b> mídia(s) em <b>' + cenas + '</b> cena(s) prontas para renomear' +
                  (semCena ? ' · ' + semCena + ' sem número (ficam de fora)' : '') + '.', 'success');
            plano.slice(0, 200).forEach(p => linha(p.name.slice(0, 40) + '  →  ' + p.novo));
            if (plano.length > 200) linha('… e mais ' + (plano.length - 200) + '.');
            progresso(1);
            return;
          }

          // ── 4. RENOMEIA
          let ok = 0, falhou = 0;
          for (let i = 0; i < plano.length; i++) {
            if (this.renomearParar) { aviso('⏹ Parado por você. ' + ok + ' renomeada(s).', 'warning'); return; }
            const p = plano[i];
            aviso('🏷️ Renomeando <b>' + (i + 1) + '/' + plano.length + '</b> — ' + p.novo);
            progresso(0.4 + (i / plano.length) * 0.6);
            if (norm(p.name) === norm(p.novo)) { ok++; linha('já estava: ' + p.novo); continue; }
            const deu = await this.apiRename(p.uuid, p.novo);
            if (deu) {
              ok++;
              linha(p.novo);
              this.tileAssignments.set(p.uuid, { label: p.novo, type: 'scene', scene: 'Cena ' + p.cena, imgNum: p.g });
              try { await this.apiFavorite(p.uuid, true); } catch (_) {}
            } else {
              falhou++;
              linha('falhou: ' + p.name.slice(0, 40), 'erro');
            }
          }

          progresso(1);
          aviso('✅ <b>' + ok + '</b> mídia(s) renomeada(s) em <b>' + cenas + '</b> cena(s)' +
                (falhou ? ' · ' + falhou + ' falha(s)' : '') +
                (semCena ? ' · ' + semCena + ' sem número' : '') + '.', 'success');
        } catch (erro) {
          if (erro && erro.stopped) aviso('⏹ Parado por você.', 'warning');
          else aviso('❌ ' + erro.message, 'error');
        } finally {
          this._renomeando = false;
          const b1 = document.getElementById('rn-start'), b2 = document.getElementById('rn-stop');
          if (b1) b1.disabled = false;
          if (b2) b2.disabled = true;
        }
      },
    });

    // ── A ABA em si ──
    function montarAbaRenomear() {
      const abas = document.querySelector('.flow-tabs');
      const scroll = document.querySelector('.flow-scroll');
      if (!abas || !scroll || document.querySelector('.flow-tab[data-tab="renomear"]')) return;

      const botao = document.createElement('button');
      botao.className = 'flow-tab';
      botao.setAttribute('data-tab', 'renomear');
      botao.textContent = '🏷️ Renomear';
      abas.appendChild(botao);

      const conteudo = document.createElement('div');
      conteudo.className = 'flow-tab-content';
      conteudo.setAttribute('data-tab', 'renomear');
      conteudo.innerHTML =
        '<div class="flow-tab-body">' +
          '<div class="flow-card">' +
            '<div class="flow-card-header">' +
              '<h3 class="flow-card-title">Formato do nome</h3>' +
              '<p class="flow-card-description">Ele lê o número da cena no prompt de cada geração e renomeia na ordem.</p>' +
            '</div>' +
            '<div class="flow-card-content">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
                '<button class="flow-validate-btn" data-rnmodelo="Cena {n} - {tipo} {g}" style="margin:0;flex:1;min-width:140px;">Cena 7 - Imagem 2</button>' +
                '<button class="flow-validate-btn" data-rnmodelo="cena_{n}_{g}_" style="margin:0;flex:1;min-width:140px;">cena_7_2_</button>' +
                '<button class="flow-validate-btn" data-rnmodelo="cena_M_{n}_{g}_" style="margin:0;flex:1;min-width:140px;">cena_M_7_2_</button>' +
                '<button class="flow-validate-btn" data-rnmodelo="cena_{nn}_{gg}_" style="margin:0;flex:1;min-width:140px;">cena_07_02_</button>' +
              '</div>' +
              '<input type="text" id="rn-modelo" class="flow-textarea" style="min-height:auto;padding:8px 10px;margin-top:8px;font-family:monospace;">' +
              '<div style="font-size:11px;color:var(--cd-text-muted);margin-top:6px;line-height:1.6;">' +
                '<b>{n}</b> nº da cena · <b>{g}</b> nº da variação · <b>{tipo}</b> Imagem/Vídeo · <b>{nn}</b>/<b>{gg}</b> com dois dígitos' +
              '</div>' +
              '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;cursor:pointer;font-size:12px;">' +
                '<input type="checkbox" id="rn-variacao" style="margin-top:2px;">' +
                '<span><b>Numerar as variações</b><br><span style="color:var(--cd-text-light);font-size:11px;">' +
                'Ligado: cena_7_1_, cena_7_2_. Desligado: todas ficam como cena_7_.</span></span></label>' +
              '<div id="rn-preview" style="font-size:12px;margin-top:8px;padding:8px 10px;border-radius:8px;background:var(--cd-bg-secondary);border:1px solid var(--cd-border-light);"></div>' +
            '</div>' +
          '</div>' +

          '<div class="flow-card">' +
            '<div class="flow-card-header"><h3 class="flow-card-title">O que renomear</h3></div>' +
            '<div class="flow-card-content">' +
              '<div class="flow-mode-btns">' +
                '<button class="flow-mode-btn active" data-rnescopo="ambos">🖼️🎬 Tudo</button>' +
                '<button class="flow-mode-btn" data-rnescopo="imagens">🖼️ Só imagens</button>' +
                '<button class="flow-mode-btn" data-rnescopo="videos">🎬 Só vídeos</button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="flow-actions">' +
            '<button id="rn-start" class="flow-btn flow-btn-primary">🏷️ Analisar e renomear</button>' +
            '<button id="rn-stop" class="flow-btn flow-btn-secondary" disabled>⏹ Parar</button>' +
          '</div>' +
          '<button class="flow-validate-btn" id="rn-testar" style="margin-top:0;">🔎 Só analisar (não renomeia)</button>' +
          '<div id="rn-status" class="flow-status"></div>' +
          '<div class="flow-progress"><div id="rn-barra" class="flow-progress-bar"></div></div>' +
          '<div id="rn-resultado" style="max-height:260px;overflow-y:auto;margin-top:8px;"></div>' +
        '</div>';
      scroll.appendChild(conteudo);
      console.info('%c[Flow] aba 🏷️ Renomear montada', 'color:#10b981;font-weight:bold');

      // troca de aba
      abas.querySelectorAll('.flow-tab').forEach(t => {
        t.addEventListener('click', () => {
          abas.querySelectorAll('.flow-tab').forEach(x => x.classList.remove('active'));
          scroll.querySelectorAll('.flow-tab-content').forEach(x => x.classList.remove('active'));
          t.classList.add('active');
          const alvo = scroll.querySelector('.flow-tab-content[data-tab="' + t.getAttribute('data-tab') + '"]');
          if (alvo) alvo.classList.add('active');
        });
      });

      const campo = document.getElementById('rn-modelo');
      const caixaVar = document.getElementById('rn-variacao');
      const temVar = m => { const s = String(m).toLowerCase(); return s.includes('{g}') || s.includes('{gg}'); };
      campo.value = lerModelo();

      const atualizar = (salvar) => {
        const modelo = campo.value.trim() || MODELO_PADRAO;
        if (salvar) { try { localStorage.setItem(CHAVE_MODELO, modelo); } catch (_) {} }
        caixaVar.checked = temVar(modelo);
        const alvo = document.getElementById('rn-preview');
        if (alvo) {
          alvo.innerHTML = 'Vai ficar assim:<br><b>' + montarNome(7, 1, false, modelo) + '</b> · <b>' +
            montarNome(7, 2, false, modelo) + '</b> · <b>' + montarNome(12, 1, true, modelo) + '</b>' +
            (temVar(modelo) ? '' :
              '<br><span style="color:#92400e;">⚠️ Sem <b>{g}</b>, todas as variações da cena ficam com o mesmo nome.</span>');
        }
      };

      campo.addEventListener('input', () => atualizar(false));
      campo.addEventListener('change', () => atualizar(true));
      campo.addEventListener('blur', () => atualizar(true));
      conteudo.querySelectorAll('[data-rnmodelo]').forEach(b => {
        b.addEventListener('click', () => { campo.value = b.getAttribute('data-rnmodelo'); atualizar(true); });
      });
      caixaVar.addEventListener('change', () => {
        let m = campo.value.trim() || MODELO_PADRAO;
        if (caixaVar.checked) {
          if (!temVar(m)) {
            const base = m.trimEnd();
            m = base.endsWith('_') ? base.slice(0, -1) + '_{g}_' : base + (base.includes('_') ? '_' : ' ') + '{g}';
          }
        } else {
          m = m.split('{gg}').join('').split('{GG}').join('').split('{g}').join('').split('{G}').join('');
          while (m.includes('__')) m = m.split('__').join('_');
        }
        campo.value = m;
        atualizar(true);
      });

      let escopo = 'ambos';
      try { escopo = localStorage.getItem(CHAVE_ESCOPO) || 'ambos'; } catch (_) {}
      conteudo.querySelectorAll('[data-rnescopo]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-rnescopo') === escopo);
        b.addEventListener('click', () => {
          conteudo.querySelectorAll('[data-rnescopo]').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          escopo = b.getAttribute('data-rnescopo');
          try { localStorage.setItem(CHAVE_ESCOPO, escopo); } catch (_) {}
        });
      });

      const inst = root.__flowInstance;
      const rodar = (apenasAnalisar) => {
        const alvo = root.__flowInstance;
        if (!alvo) return;
        document.getElementById('rn-start').disabled = true;
        document.getElementById('rn-stop').disabled = false;
        alvo.renomearGaleria({ escopo, apenasAnalisar });
      };
      document.getElementById('rn-start').addEventListener('click', () => rodar(false));
      document.getElementById('rn-testar').addEventListener('click', () => rodar(true));
      document.getElementById('rn-stop').addEventListener('click', () => {
        const alvo = root.__flowInstance;
        if (alvo) alvo.renomearParar = true;
        document.getElementById('rn-stop').disabled = true;
      });

      atualizar(false);
    }

    // Tenta cedo e insiste: o painel do Flow demora a montar em máquina lenta.
    [300, 800, 1500, 2500, 4000].forEach(ms => setTimeout(montarAbaRenomear, ms));
    setInterval(montarAbaRenomear, 4000);

    proto.initUI = function () {
      old.initUI.call(this);
      root.__flowInstance = this;   // a aba Renomear precisa da instância
      // Hover replaces a video's thumbnail with a signed playback URL. Preserve
      // its observed identity before that change, including virtualized rows.
      const rememberVideos = () => this.getTiles().filter(tile => $('flow-video-tile', tile)).forEach(tile => this.getUuidFromTile(tile));
      rememberVideos();
      this._modernIdentityObserver = new MutationObserver(rememberVideos);
      this._modernIdentityObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
      for (const prefix of ['flow', 'fv']) {
      const test = document.createElement('button');
      test.id = `${prefix}-test-input`; test.className = 'flow-btn flow-btn-secondary';
      test.textContent = 'Testar preenchimento (sem gerar)';
      test.style.cssText = 'width:100%;margin-top:8px';
      document.getElementById(`${prefix}-start-btn`).parentElement.after(test);
      test.addEventListener('click', async () => {
        if (this.isRunning || this.videoIsRunning || this._modernTaskRunning) return;
        test.disabled = true; this._modernTaskRunning = true; this.shouldStop = false; this.videoShouldStop = false;
        this._modernTestVideo = prefix === 'fv';
        const status = (type, message) => (prefix === 'fv' ? this.setVideoStatus : this.setStatus).call(this, type, message);
        try {
          const prompt = parsePromptsText(document.getElementById(`${prefix}-prompts-input`).value)[0];
          if (!prompt) throw new Error('Insira um prompt para testar.');
          await this.clearEditor();
          for (const seg of parsePrompt(prompt.text)) {
            if (seg.type === 'text') await this.insertText(seg.content);
            else if (seg.type === 'ref') await this.searchAndSelect(seg.name);
            else if (seg.type === 'voice') await this.searchAndSelectVoice(seg.name);
          }
          status('success', '✅ Texto e referências preenchidos. Nenhuma geração foi enviada.');
        } catch (error) { status('error', `Teste: ${error.message}`); }
        finally { test.disabled = false; this._modernTaskRunning = false; this._modernTestVideo = false; }
      });
      }
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

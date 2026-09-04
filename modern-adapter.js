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
    console.info('%c[Flow] VERSAO: ENUMERAR-PELO-PROMPT 2026-09-04 22:28', 'background:#10b981;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px');
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
          throw Object.assign(new Error('Envio sem confirmação. A fila foi pausada para evitar geração duplicada; confira o Flow antes de retomar.'), { uncertainSubmission: true });
        }
        return true;
      },
      async prepareAndSubmit(prompt) {
        if (this.modernStopped()) throw stopError();
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
      getScroller() { return $('cdk-virtual-scroll-viewport.tiles-container'); },
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
      async scanGallery(visit, { restore = true } = {}) {
        const scroller = this.getScroller();
        if (!scroller) throw new Error('Galeria do projeto não encontrada. Volte à tela de mídias.');
        const originalTop = scroller.scrollTop;
        const entries = new Map();
        let settledBottom = 0;
        scroller.scrollTop = 0;
        try {
          for (let step = 0; step < 2000; step++) {
            if (this.modernStopped()) throw stopError();
            await this.sleep(250);
            for (const tile of this.getTiles()) {
              const entry = this.tileEntry(tile);
              if (!entry.uuid || entries.has(entry.uuid)) continue;
              entries.set(entry.uuid, entry);
              if (visit && await visit(entry, tile) === false) return [...entries.values()];
            }
            const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            if (scroller.scrollTop >= bottom - 2) {
              if (++settledBottom >= 3) return [...entries.values()];
              await this.sleep(300);
            } else settledBottom = 0;
            scroller.scrollTop = Math.min(bottom, scroller.scrollTop + Math.max(100, scroller.clientHeight * 0.65));
          }
          throw new Error('A galeria não terminou de carregar; análise incompleta.');
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
      async apiRename(id, name) {
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
        await prepare.call(this, prompt);
        const record = { promptNum: prompt.promptNum, nodes: [], results: new Map(), beforeIds, expected, signature: this._modernPreparedText };
        this._modernActiveRecords ||= [];
        this._modernActiveRecords.push(record);
        try {
          await this.modernWait(() => {
            this.captureModernResults();
            return record.nodes.length === expected;
          }, 12000);
        } catch (error) {
          this._modernUncertain = true;
          throw Object.assign(new Error('O envio foi aceito, mas não foi possível identificar seus resultados. A fila foi pausada; não reenvie sem conferir a galeria.'), { uncertainSubmission: true });
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
        const hardDeadline = Date.now() + Math.max(noProgressLimit * 5, 20 * 60000);
        while (true) {
          if (this.modernStopped()) throw stopError();
          this.captureModernResults();
          if (this._modernCaptureError) {
            this._modernUncertain = true;
            throw Object.assign(new Error(this._modernCaptureError + ' Fila pausada; confira a galeria.'), { uncertainSubmission: true });
          }
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
            this._modernUncertain = true;
            throw Object.assign(new Error('A geração ainda não terminou ou deixou de responder. Fila pausada; confira os resultados antes de retomar para evitar duplicatas.'), { uncertainSubmission: true });
          }
          if (matrix.some(slot => slot.state === 'pending' && !slot.record?.nodes[slot.index]?.isConnected)) {
            this._modernUncertain = true;
            throw Object.assign(new Error('A galeria mudou durante o lote. Fila pausada para preservar a correspondência entre prompts e resultados.'), { uncertainSubmission: true });
          }
          await this.sleep(Math.max(300, Number(document.getElementById('flow-t-poll')?.value || 0.5) * 1000));
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
        const entries = await this.scanGallery();
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
    proto.initUI = function () {
      old.initUI.call(this);
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

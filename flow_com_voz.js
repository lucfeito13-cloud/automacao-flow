// ============================================================================
//  CRIADORES DARK - AUTOMACAO DO GOOGLE FLOW
//  Flow NOVO v7.1   -   2026-09-05
// ============================================================================
//
//  ESTE E O ARQUIVO UNICO. Todo o codigo da automacao esta aqui dentro.
//
//  Ele tem duas partes, nesta ordem:
//    PARTE 1 - Compatibilidade com o Flow novo (flow.google.com, Angular)
//    PARTE 2 - O programa principal (painel, filas, tempos, downloads)
//
//  Para trocar de versao: pegue um arquivo antigo e substitua este.
//  Depois e so dar F5 na pagina do Flow — nao precisa recarregar a extensao.
//
// ============================================================================


// ┌──────────────────────────────────────────────────────────────────────────┐
// │  PARTE 1 de 2 — COMPATIBILIDADE COM O FLOW NOVO                          │
// └──────────────────────────────────────────────────────────────────────────┘
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
  const blobToJpeg = async (blob) => {
    if (!blob || !blob.type || blob.type === 'image/jpeg' || blob.type === 'image/jpg') return blob;
    if (!blob.type.startsWith('image/')) return blob;
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise((resolve) => {
        canvas.toBlob(jBlob => resolve(jBlob || blob), 'image/jpeg', 0.95);
      });
    } catch (_) {
      return blob;
    }
  };
  const pure = { norm, refKey, sceneInfo, unique, cleanEditorText, safeName, zipFiles, blobToJpeg, videoIdentity };
  if (typeof module === 'object' && module.exports) module.exports = pure;

  root.__installFlowModern = function (FlowAutomation, ctx) {
    if (location.hostname !== 'flow.google.com' && !location.hostname.endsWith('.flow.google.com')) return;
    console.info('%c[Flow] Criadores Dark — Flow NOVO v7.1 (lote silencioso em ZIP)', 'background:#10b981;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px');
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
      /** Fator do seletor Lento/Normal/Rápido. O adapter ignorava isso. */
      /**
       * Texto digitado, SEM os chips de referencia. O chip continua no editor
       * depois do envio, entao exigir o editor "vazio" fazia todo prompt COM
       * referencia ser dado como falho mesmo tendo sido enviado.
       */
      textoSemChips(editor) {
        try {
          const ed = editor || this.getEditor();
          if (!ed) return '';
          const copia = ed.cloneNode(true);
          copia.querySelectorAll('.mention-chip, [data-mention], [contenteditable="false"], .prosemirror-placeholder, .ProseMirror-separator, .ProseMirror-trailingBreak')
            .forEach(e => e.remove());
          return norm(copia.textContent.replace(/[​﻿]/g, ''));
        } catch (_) { return cleanEditorText(editor || this.getEditor()); }
      },
      fatorVelocidade() {
        const f = Number(this.speedMultiplier);
        return (isFinite(f) && f > 0) ? Math.min(3, Math.max(0.4, f)) : 1;
      },
      /** Pausa interna do adapter, sujeita ao seletor de velocidade. */
      pausa(ms) { return this.sleep(Math.max(20, Math.round(ms * this.fatorVelocidade()))); },
      async modernWait(check, timeout = 10000) {
        // O Flow costuma responder em menos de meio segundo. Conferir de 150 em
        // 150ms fazia a gente PERDER ate 150ms em CADA espera, e sao varias por
        // referencia. Agora olhamos rapido no comeco e vamos afrouxando.
        const inicio = Date.now(), end = inicio + timeout;
        while (Date.now() < end) {
          if (this.modernStopped()) throw stopError();
          const result = check();
          if (result) return result;
          const decorrido = Date.now() - inicio;
          await this.sleep(decorrido < 1000 ? 40 : decorrido < 3000 ? 100 : 200);
        }
        throw new Error('O Flow não respondeu no tempo esperado.');
      },
      getEditor() { return $('.ProseMirror[contenteditable="true"]'); },
      async clearEditor() {
        await this.closeAssetPicker();
        const clear = $('button[aria-label="Clear prompt"]');
        if (clear) { clear.click(); await this.pausa(150); }
        const editor = this.getEditor();
        if (!editor) throw new Error('Campo de prompt do Flow não encontrado.');
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('delete', false);
        await this.modernWait(() => cleanEditorText(editor) === '' || this.textoSemChips(editor) === '');
      },
      async insertText(text) {
        if (!text) return;
        // Com o painel de ingredientes aberto o cursor NAO esta na caixa de
        // prompt e a escrita se perde. Volta para a caixa antes de escrever.
        if (visible($('input[aria-label="Search assets"]'))) await this.voltarAoEditor();
        const editor = this.getEditor();
        if (!editor) throw new Error('Campo de prompt do Flow não encontrado.');
        const antes = cleanEditorText(editor);
        const mudou = () => cleanEditorText(editor) !== antes;

        // Logo depois de fechar o painel de ingredientes o editor pode ainda nao
        // estar com o foco, e a escrita falhava de primeira — derrubando o prompt
        // inteiro por causa do texto que vem DEPOIS da referencia. Agora insiste:
        // foco, execCommand, e por fim o beforeinput, que e o jeito antigo.
        const posicionar = () => {
          editor.focus();
          const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        };

        for (let tentativa = 1; tentativa <= 3; tentativa++) {
          if (this.modernStopped()) throw stopError();
          posicionar();
          let aceitou = false;
          try { aceitou = document.execCommand('insertText', false, text); } catch (_) { aceitou = false; }
          if (!aceitou) {
            try {
              editor.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true, inputType: 'insertText', data: text
              }));
            } catch (_) {}
          }
          try {
            await this.modernWait(() => mudou() || !norm(text), 2500);
            await this.pausa(60);
            return;
          } catch (_) {
            if (tentativa === 3) break;
            this.logDebug('O editor não aceitou o texto; tentando de novo.', 'warning');
            await this.pausa(250);
          }
        }
        throw new Error('O Flow não aceitou a inserção de texto.');
      },      async closeAssetPicker() {
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
      async clickDialogTab(type, broad = false) {
        // O Flow passou a separar referências visuais entre Images, Characters,
        // Avatars e Uploads. Mantemos Images como primeira tentativa e usamos
        // All como fallback, para que referências antigas continuem funcionando.
        const labels = type === 'voice'
          ? ['Voices', 'Vozes']
          : (broad ? ['All', 'Tudo', 'Todos'] : ['Images', 'Imagens']);
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
        let input = $('input[aria-label="Search assets"]');
        const opcoes = () => $$('[role="listbox"][aria-label="Asset list"] [role="option"]');
        const exatas = () => opcoes().filter(o => refKey($('.asset-title', o)?.textContent) === refKey(name));
        // Espera a lista responder. Assim que aparece um resultado exato usamos
        // ele; se so vierem parecidos, ficamos com o PRIMEIRO, como a versao
        // rapida fazia. Antes exigiamos nome exato E unico, e qualquer duvida
        // custava uma troca de aba mais 12 segundos de espera por prompt.
        const esperar = async timeout => {
          const fimT = Date.now() + timeout;
          let algum = [];
          while (Date.now() < fimT) {
            if (this.modernStopped()) throw stopError();
            const e = exatas();
            if (e.length) return e[0];
            algum = opcoes();
            if (algum.length) { await this.pausa(200); const e2 = exatas(); return e2.length ? e2[0] : (opcoes()[0] || algum[0]); }
            await this.pausa(120);
          }
          return null;
        };

        setInput(input, name);
        let alvo = await esperar(type === 'voice' ? 12000 : 3000);
        if (!alvo && type !== 'voice') {
          await this.clickDialogTab(type, true);
          input = $('input[aria-label="Search assets"]');
          if (!input) throw new Error('Campo de busca de referencias nao encontrado.');
          setInput(input, name);
          alvo = await esperar(8000);
        }
        if (!alvo) throw new Error(`Referência ${type === 'voice' ? 'de voz ' : ''}"${name}" não encontrada.`);
        return alvo;
      },
      /**
       * Anexa uma referencia. Em prompt com VARIAS referencias, o painel de
       * ingredientes fica ABERTO entre uma e outra: fechar e reabrir custava um
       * ciclo inteiro (fechar + digitar @ + esperar abrir) por referencia. Se o
       * atalho nao funcionar, refazemos do jeito completo — nunca sai sem a
       * referencia.
       */
      /**
       * A referencia ja esta anexada neste prompt? O Flow anexa o ingrediente
       * UMA vez; quando o mesmo [nome] aparece varias vezes no texto, procurar de
       * novo so gastava tempo e, quando a busca nao achava, derrubava o prompt
       * inteiro por causa de algo que ja estava la.
       */
      referenciaNoEditor(name) {
        try {
          const editor = this.getEditor();
          if (!editor || !name) return false;
          const limpar = v => refKey(v).replace(/[ _]+$/, '');
          const alvo = limpar(name);
          if (!alvo) return false;
          const pedacos = $$('.mention-chip, [data-mention], [contenteditable="false"]', editor);
          const folhas = pedacos.length ? pedacos
            : $$('span, div, a', editor).filter(el => !el.children.length);
          for (const el of folhas) {
            // Comparacao ESTRITA. Aceitar prefixo fazia qualquer pedaco do editor
            // passar por referencia e a extensao pulava o anexo de verdade.
            if (limpar(el.textContent) === alvo) return true;
          }
          return false;
        } catch (_) { return false; }   // nunca derrubar um prompt por causa desta checagem
      },
      /**
       * Volta para a caixa de prompt depois de anexar uma referencia. Nao basta
       * .focus(): o Flow so devolve o cursor quando ha um CLIQUE de verdade na
       * caixa. Sem isso o painel de ingredientes ficava aberto e o texto que vem
       * depois da referencia nao entrava.
       */
      async voltarAoEditor() {
        for (let i = 0; i < 3; i++) {
          if (!visible($('input[aria-label="Search assets"]'))) break;
          try { await this.closeAssetPicker(); } catch (_) {}
          await this.pausa(120);
        }
        const ed = this.getEditor();
        if (!ed) return;
        const r = ed.getBoundingClientRect();
        const x = Math.round(r.left + Math.min(Math.max(r.width - 8, 4), 40));
        const y = Math.round(r.top + r.height / 2);
        for (const tipo of ['pointerdown', 'mousedown', 'mouseup', 'click', 'pointerup']) {
          try {
            ed.dispatchEvent(/^pointer/.test(tipo)
              ? new PointerEvent(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true })
              : new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: tipo === 'mousedown' ? 1 : 0 }));
          } catch (_) {}
        }
        ed.focus();
        try {
          const range = document.createRange(); range.selectNodeContents(ed); range.collapse(false);
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        } catch (_) {}
        await this.pausa(80);
      },
      async selectAsset(name, type, opcoes) {
        const { reaproveitar = false, manterAberto = false } = opcoes || {};
        const useBackspace = document.getElementById(this.videoIsRunning || this._modernTestVideo ? 'fv-use-backspace' : 'flow-use-backspace')?.checked;
        const segurar = manterAberto && !useBackspace;
        // Cada [nome] escrito no prompt vira uma mencao NAQUELE ponto do texto.
        // Pular as repeticoes deixava o prompt sem a mencao no lugar certo — por
        // isso buscamos quantas vezes o prompt mandar.
        const jaAberto = reaproveitar && visible($('input[aria-label="Search assets"]'));
        if (!jaAberto) await this.openMentionPicker();

        const antes = this.getEditor().innerHTML;
        const jaEntrou = () => this.getEditor()?.innerHTML !== antes || this.referenciaNoEditor(name);
        let entrou = false;
        try {
          const alvo = await this.findAsset(name, type);

          // SAO DOIS CLIQUES na referencia. O primeiro seleciona, o segundo e o
          // que realmente a insere no prompt. Dar so um deixava a extensao
          // esperando por uma insercao que nunca vinha, com o painel aberto.
          const clicar = el => {
            const r = el.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
            for (const tipo of ['pointerdown', 'mousedown', 'mouseup', 'click', 'pointerup']) {
              try {
                el.dispatchEvent(/^pointer/.test(tipo)
                  ? new PointerEvent(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true })
                  : new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: tipo === 'mousedown' ? 1 : 0 }));
              } catch (_) {}
            }
            try { el.click(); } catch (_) {}
          };

          clicar(alvo);
          await this.pausa(160);

          if (!jaEntrou()) {
            // O segundo clique. A lista pode ter se redesenhado depois do
            // primeiro, entao reencontramos o item antes de clicar de novo.
            let segundo = alvo;
            if (!segundo || !segundo.isConnected) {
              try { segundo = await this.findAsset(name, type); } catch (_) { segundo = null; }
            }
            if (segundo) clicar(segundo.closest('[role="option"]') || segundo);
            await this.pausa(160);
          }
          if (!jaEntrou()) {
            // Algumas telas trocam o segundo clique por um botao de confirmar.
            const add = textButton(['Add to prompt', 'Adicionar ao prompt', 'Incluir no comando']);
            if (add) {
              if (add.disabled) throw new Error(`O Flow não permite adicionar "${name}" neste modo.`);
              clicar(add);
            }
          }

          await this.modernWait(jaEntrou, jaAberto ? 5000 : 10000);
          entrou = true;
        } catch (erro) {
          if (this.referenciaNoEditor(name)) {
            // Ja entrou (o Flow renomeia o chip, ex: 'REF_ODI_' vira 'REF_ODI__').
            this.logDebug(`⚠️ a busca por "${name}" falhou (${erro && erro.message ? erro.message : erro}), mas ela já aparece no prompt; sigo em frente.`, 'warning');
            entrou = true;
          } else if (!jaAberto) {
            try { await this.closeAssetPicker(); } catch (_) {}
            throw erro;
          } else {
            this.logDebug('O painel reaproveitado não aceitou a referência; refazendo do jeito completo.', 'warning');
          }
        }
        if (!entrou) return this.selectAsset(name, type, { reaproveitar: false, manterAberto });

        this.logDebug(`✅ referência "${name}" anexada.`, 'success');
        if (segurar) return;   // proxima referencia usa este mesmo painel
        await this.voltarAoEditor();
        if (useBackspace) {
          // Preserve the attached ingredient while removing its inline mention.
          const chips = $$('.mention-chip', this.getEditor());
          const chip = chips[chips.length - 1];
          if (chip) {
            const range = document.createRange(); range.selectNode(chip);
            const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
            document.execCommand('delete', false); await this.pausa(200);
          }
        }
      },
      async searchAndSelect(name, opcoes) { return this.selectAsset(name, 'image', opcoes); },
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
        await this.pausa(200);
      },
      async clickSubmit() {
        // Com o painel de ingredientes aberto o envio nao acontece.
        try { await this.closeAssetPicker(); } catch (_) {}
        const editor = this.getEditor();
        if (!editor || !cleanEditorText(editor)) throw new Error('O prompt está vazio; nenhum envio foi feito.');
        this._modernPreparedText = cleanEditorText(editor);
        const textoAntes = this.textoSemChips(editor);
        const gerandoAntes = this.getTiles().filter(t => this.tileHasProgress(t)).length;

        const btn = await this.modernWait(() => {
          const b = $('button[aria-label="Start generation"]');
          return b && !b.disabled ? b : null;
        });
        btn.click();

        // O Flow ACEITOU se qualquer um destes acontecer. Exigir o editor vazio
        // dava falso negativo em TODO prompt com referencia, porque o chip fica
        // no editor depois do envio e o texto nunca chegava a ser vazio.
        const aceitou = () => {
          const ed = this.getEditor();
          if (!ed) return true;
          if (cleanEditorText(ed) === '') return true;
          const agora = this.textoSemChips(ed);
          if (textoAntes && agora.length <= Math.max(2, Math.round(textoAntes.length * 0.4))) return true;
          const b = $('button[aria-label="Start generation"]');
          if (b && b.disabled) return true;
          if (this.getTiles().filter(t => this.tileHasProgress(t)).length > gerandoAntes) return true;
          return false;
        };
        try {
          await this.modernWait(aceitou, 15000);
        } catch (error) {
          // Nao repetimos um envio duvidoso: ele pode ja ter gasto credito.
          this._modernUncertain = true;
          const restou = String(this.textoSemChips(this.getEditor())).slice(0, 60);
          const gerandoAgora = this.getTiles().filter(t => this.tileHasProgress(t)).length;
          this.logDebug('Envio sem confirmação. Sobrou no editor: ' + JSON.stringify(restou) +
            ' | texto antes: ' + textoAntes.length + ' caracteres' +
            ' | gerando: ' + gerandoAgora + ' (antes ' + gerandoAntes + ')', 'error');
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
        const partes = parsePrompt(prompt.text);
        const t0 = Date.now();
        const tempos = [];
        for (let i = 0; i < partes.length; i++) {
          if (this.modernStopped()) throw stopError();
          const parte = partes[i];
          if (parte.type === 'text') { await this.insertText(parte.content); continue; }
          const marca = Date.now();
          if (parte.type === 'ref') {
            // Sem reaproveitar o painel: o caminho completo e o que comprovadamente
            // funciona. O atalho economizava pouco e arriscava a referencia.
            await this.searchAndSelect(parte.name);
          } else if (parte.type === 'voice') {
            await this.searchAndSelectVoice(parte.name);
          }
          tempos.push(parte.name + ' ' + ((Date.now() - marca) / 1000).toFixed(1) + 's');
        }
        // Medicao para saber ONDE esta o tempo, em vez de apertar no escuro.
        if (tempos.length) this.logDebug('⏱️ referências: ' + tempos.join(' · '), 'info');
        const enviou = await this.clickSubmit();
        this.logDebug('⏱️ prompt ' + prompt.promptNum + ' montado e enviado em ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', 'info');
        return enviou;
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
      // A grade e virtualizada: o tile pode ter saido da tela. Sem esta guarda,
      // marcar uma midia que rolou para fora quebrava a atribuicao inteira.
      getTileName(tile) { return tile ? norm(tile.getAttribute('aria-label') || $('.footer-title', tile)?.textContent) : ''; },
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
              await this.pausa(50);
              const a = this.getTiles().map(x => this.getUuidFromTile(x)).join(',');
              if (a && a !== assinaturaAnterior) { assinaturaAnterior = a; return; }
            }
            return;
          }
          let anterior = null;
          for (let e = 0; e < 900; e += 80) {
            await this.pausa(80);
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
        await this.pausa(150);
      },
      /**
       * Renomeia. Tenta primeiro a API do Flow (um PATCH — era assim antes da
       * atualização e é MUITO mais rápido que abrir menu). Se a API não
       * responder, cai no menu da mídia. A decisão é tomada UMA vez.
       */
      /** Id sintetico de video (video-xxxx) nao existe na API do Flow. */
      idServeNaApi(id) { return !!id && !/^video-/i.test(String(id)); },
      async apiRename(id, name) {
        if (this.idServeNaApi(id) && this._apiRenomearVale !== false && old.apiRename) {
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
        if (this.idServeNaApi(id) && this._apiFavoritarVale !== false && old.apiFavorite) {
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
      // ── MARCAR AGORA, RENOMEAR AO ATUALIZAR A PAGINA ────────────────────────
      // Arrastar um nome nao mexe mais no servidor. A marcacao fica guardada e
      // so vira renomeacao quando voce atualiza a pagina. Assim, se voce errar,
      // basta tirar no ✕ e a midia continua com o NOME ORIGINAL dela — antes ela
      // virava "Imagem gerada" e nao dava para voltar atras.
      chaveDasMarcas() {
        const proj = (typeof this.getProjectId === 'function' && this.getProjectId()) || location.pathname;
        return 'flow_marcas_' + proj;
      },
      lerMarcas() {
        try { return JSON.parse(localStorage.getItem(this.chaveDasMarcas()) || '{}') || {}; }
        catch (_) { return {}; }
      },
      salvarMarcas(marcas) {
        try { localStorage.setItem(this.chaveDasMarcas(), JSON.stringify(marcas || {})); } catch (_) {}
        this.mostrarBarraDeAtualizar();
      },
      marcar(id, dados) {
        const marcas = this.lerMarcas();
        const antigo = marcas[id];
        let original = (antigo && antigo.original) || '';
        if (!original) {
          // Guarda o nome que a midia tem AGORA, para o ✕ poder devolver.
          try { original = this.getTileName(this.getTiles().find(t => this.getUuidFromTile(t) === id)) || ''; }
          catch (_) { original = ''; }
        }
        marcas[id] = Object.assign({ original }, dados);
        this.salvarMarcas(marcas);
      },
      desmarcar(id) {
        const marcas = this.lerMarcas();
        const marca = marcas[id];
        delete marcas[id];
        this.salvarMarcas(marcas);
        return marca || null;
      },
      /** Avisa que ha marcacoes esperando a atualizacao da pagina. */
      mostrarBarraDeAtualizar() {
        const barra = document.getElementById('flow-assign-reload-bar');
        if (!barra) return;
        const quantas = Object.keys(this.lerMarcas()).length;
        barra.classList.toggle('visible', quantas > 0);
        const aplicar = document.getElementById('flow-aplicar-nomes');
        if (aplicar) {
          aplicar.textContent = quantas ? '✅ Aplicar renomeação (' + quantas + ')' : '✅ Aplicar renomeação';
          aplicar.style.display = quantas ? '' : 'none';
        }
        const botao = document.getElementById('flow-assign-reload');
        if (botao) botao.textContent = '🔄 Atualizar Página';
      },
      async assignScene(sceneNum, sceneName, id, tile) {
        const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
        const existing = assignments.get(sceneName) || [];
        const known = existing.find(item => item.workflowId === id);
        const imgNum = known?.imgNum || Math.max(0, ...existing.map(item => item.imgNum)) + 1;
        const label = `Cena ${sceneNum} - ${this._videoAssignActive ? 'Vídeo' : 'Imagem'} ${imgNum}`;
        for (const list of assignments.values()) {
          const index = list.findIndex(item => item.workflowId === id);
          if (index >= 0) list.splice(index, 1);
        }
        const list = assignments.get(sceneName) || [];
        list.push({ imgNum, workflowId: id, src: this.getMediaSrcFromTile(tile) }); assignments.set(sceneName, list);
        this.tileAssignments.set(id, { label, type: 'scene', scene: sceneName, imgNum, isVideo: !!this._videoAssignActive });
        this.addLabelToTile(tile, label, id, 'scene', sceneName);
        this.marcar(id, { nome: label, tipo: 'scene', cena: sceneName, favoritar: true });
        this.updateAssignItemUI(sceneName, true); this.updateAssignCount(); this.startLabelObserver();

        // Renomeia na API imediatamente para não depender de recarregar a página
        try {
          await this.apiRename(id, label);
          await this.apiFavorite(id, true);
          this.logDebug(`✅ ${label} atribuída e renomeada no Flow!`, 'success');
        } catch (_) {
          this.logDebug(`📌 ${label} atribuída localmente.`, 'info');
        }
        return true;
      },
      async assignReference(name, id, tile) {
        const previous = this.refAssignments.get(name);
        if (previous && previous !== id) {
          this.desmarcar(previous);
          this.tileAssignments.delete(previous);
          this.removeLabelFromTile(previous);
        }
        this.refAssignments.set(name, id);
        this.tileAssignments.set(id, { label: name, type: 'ref', name });
        this.addLabelToTile(tile, name, id, 'ref', name);
        const refName = name + CONFIG.REF_SUFFIX;
        this.marcar(id, { nome: refName, tipo: 'ref', ref: name, favoritar: true });
        this.updateAssignItemUI(name, true); this.updateAssignCount(); this.startLabelObserver();

        // Renomeia na API imediatamente
        try {
          await this.apiRename(id, refName);
          await this.apiFavorite(id, true);
          this.logDebug(`✅ Referência [${name}] atribuída e renomeada no Flow!`, 'success');
        } catch (_) {
          this.logDebug(`📌 Referência [${name}] atribuída localmente.`, 'info');
        }
        return true;
      },
      /** Aplica de uma vez tudo que foi marcado. Roda sozinho ao abrir a pagina. */
      async aplicarMarcas() {
        const marcas = this.lerMarcas();
        const ids = Object.keys(marcas);
        if (!ids.length || this._aplicandoMarcas) return;
        this._aplicandoMarcas = true;
        const aviso = m => { try { this.setStatus('info', m); } catch (_) {} };
        let ok = 0, falhou = 0;
        try {
          aviso('🏷️ Aplicando ' + ids.length + ' nome(s) marcado(s)...');
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i], marca = marcas[id];
            aviso('🏷️ Aplicando <b>' + (i + 1) + '/' + ids.length + '</b> — ' + marca.nome);
            let deu = false;
            try { deu = await this.apiRename(id, marca.nome); } catch (_) {}
            if (deu) {
              ok++;
              this.pintarNomeNoTile(id, marca.nome);
              if (marca.favoritar) { try { await this.apiFavorite(id, true); } catch (_) {} }
              delete marcas[id];
              this.salvarMarcas(marcas);
            } else {
              falhou++;
              this.logDebug('Não consegui aplicar "' + marca.nome + '"; a marcação continua guardada.', 'warning');
            }
          }
          try {
            this.setStatus(falhou ? 'warning' : 'success',
              '✅ <b>' + ok + '</b> nome(s) aplicado(s)' +
              (falhou ? ' · ' + falhou + ' continuam marcados' : '') +
              (ok ? '. Agora dá para usar <b>Baixar Cenas</b> — vem tudo de uma vez, já com os nomes.' : '.'));
          } catch (_) {}
        } finally {
          this._aplicandoMarcas = false;
          this.mostrarBarraDeAtualizar();
        }
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
      /**
       * Escreve o nome novo no proprio tile. O Flow so redesenha o rotulo dele
       * quando a pagina recarrega; sem isto a renomeacao ficava invisivel ate
       * o F5, mesmo tendo dado certo no servidor.
       */
      pintarNomeNoTile(id, nome) {
        try {
          const tile = this.getTiles().find(t => this.getUuidFromTile(t) === id);
          if (!tile) return false;
          tile.setAttribute('aria-label', nome);
          const titulo = $('.footer-title', tile);
          if (titulo) titulo.textContent = nome;
          return true;
        } catch (_) { return false; }
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
      async baixarPeloMenuDoFlow(tile, preferencias) {
        const capturado = { blob: null, nome: null, houveClique: false };
        const porUrl = new Map();
        const origCriar = URL.createObjectURL;
        const origClicar = HTMLAnchorElement.prototype.click;
        let clicarQualidade = null;
        try {
          // A pagina cria varios arquivos temporarios o tempo todo. Guardamos
          // TODOS por endereco e so ficamos com o do link de download — antes eu
          // pegava o primeiro que aparecesse, e vinha um arquivo vazio.
          URL.createObjectURL = function (b) {
            const url = origCriar.apply(this, arguments);
            try { if (b && b.size > 0) porUrl.set(String(url), b); } catch (_) {}
            return url;
          };
          HTMLAnchorElement.prototype.click = function () {
            let ehNosso = false;
            try {
              const href = String(this.href || '');
              const baixa = this.hasAttribute('download');
              if (baixa && href.startsWith('blob:')) {
                ehNosso = true;
                capturado.houveClique = true;
                capturado.nome = this.getAttribute('download') || capturado.nome;
                const b = porUrl.get(href);
                if (b) capturado.blob = b;
              }
            } catch (_) {}
            // Só engolimos o clique que é do download; o resto da página segue igual.
            if (!ehNosso) return origClicar.apply(this, arguments);
          };

          await this.openTileMenu(tile);
          const baixar = menuItem(['Download', 'Baixar']);
          if (!baixar) throw new Error('Download não encontrado no menu da mídia.');
          const r = baixar.getBoundingClientRect();
          for (const t of ['pointerover', 'mouseover', 'mouseenter', 'mousemove']) {
            try { baixar.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); } catch (_) {}
          }
          baixar.click();

          const opcoes = await this.modernWait(() => {
            const itens = $$('[role="menuitem"]').filter(b => visible(b) && !b.disabled &&
              /original|upscaled|\b\d(?:k|80p|20p)\b/i.test(b.textContent));
            return itens.length ? itens : null;
          }, 8000);
          for (const re of preferencias) {
            clicarQualidade = opcoes.find(b => re.test(norm(b.textContent)));
            if (clicarQualidade) break;
          }
          if (!clicarQualidade) clicarQualidade = opcoes[0];
          this.logDebug('⬇️ qualidade: ' + norm(clicarQualidade.textContent), 'info');
          clicarQualidade.click();

          // Espera o Flow montar o arquivo e disparar o link.
          for (let esperou = 0; esperou < 40000; esperou += 200) {
            if (capturado.blob && capturado.blob.size > 0) break;
            await this.sleep(200);
          }
        } finally {
          URL.createObjectURL = origCriar;
          HTMLAnchorElement.prototype.click = origClicar;
        }
        try { await this.closeMenus(); } catch (_) {}

        if (!capturado.blob || !capturado.blob.size) {
          this.logDebug('Não consegui pegar o arquivo do menu' +
            (capturado.houveClique ? ' (o link veio sem conteúdo)' : ' (o Flow não disparou o link)') +
            '; deixando o Flow salvar sozinho.', 'warning');
          if (clicarQualidade && clicarQualidade.isConnected) clicarQualidade.click();
          return null;
        }
        return capturado;
      },
      /**
       * Tira o "-rw" do endereco da imagem.
       *
       * Medido na pagina (05/09): o Flow serve a grade como
       *   .../asb/<id>=s1600-rw   -> image/webp  125 KB   (o "arquivo web")
       * e o MESMO endereco sem o -rw devolve
       *   .../asb/<id>=s1600      -> image/jpeg  139 KB
       * Mesma resolucao, arquivo de imagem de verdade, e continua sendo um
       * unico pedido — entao o download segue rapido e em ZIP.
       */
      urlDeImagemReal(src) {
        try {
          if (!src || /^blob:|^data:/.test(src)) return src;
          const u = new URL(src, location.href);
          if (!/=/.test(u.pathname)) return src;
          u.pathname = u.pathname.replace(/-rw(?=$|-)/g, '');
          return u.toString();
        } catch (_) { return src; }
      },
      /**
       * Baixar o arquivo ORIGINAL. É o PADRÃO: ele nao quer o JPEG menor que
       * vem pelo endereco da grade, quer o arquivo cheio do Flow. So fica
       * desligado se ele desmarcar na mao.
       */
      altaQualidadeLigada() {
        const caixa = document.getElementById('flow-alta-qualidade');
        if (caixa) return !!caixa.checked;
        try { return localStorage.getItem('flow_baixar_original') !== '0'; } catch (_) { return true; }
      },
      async downloadEntry(entry, filename, collect = false) {
        const tile = await this.scrollToWorkflow(entry.uuid || entry.workflowId);
        if (!tile) throw new Error(`Mídia não encontrada: ${entry.name || entry.uuid}`);
        const ehVideo = this.isVideoTile(tile);

        // Video sempre pelo menu: nao da para pegar o arquivo por endereco.
        // Imagem so vai pelo menu quando VOCE pedir o original.
        if (ehVideo || this.altaQualidadeLigada()) {
          const preferencias = ehVideo
            ? [/original/i, /1080/, /720/]
            : [/original/i, /\b1k\b/i, /\b2k\b/i, /\b4k\b/i];
          let pego = null;
          try { pego = await this.baixarPeloMenuDoFlow(tile, preferencias); }
          catch (erro) { this.logDebug('Menu de download falhou: ' + erro.message, 'warning'); }
          if (pego && pego.blob) {
            const tipo = pego.blob.type || '';
            const ext = ehVideo
              ? (tipo.includes('webm') ? 'webm' : 'mp4')
              : 'jpg';
            let finalBlob = pego.blob;
            if (!ehVideo && !tipo.includes('jpeg') && !tipo.includes('jpg')) {
              finalBlob = await blobToJpeg(pego.blob);
            }
            const file = { blob: finalBlob, name: `${safeName(filename)}.${ext}` };
            this.logDebug('⬇️ ' + file.name + ': ' + Math.round(finalBlob.size / 1024) + ' KB (original do Flow)', 'success');
            if (collect) return file;
            this.saveDownload(finalBlob, file.name);
            return file;
          }
          if (ehVideo) return;   // o Flow salvou sozinho
          this.logDebug('Baixando via URL direta em JPEG...', 'info');
        }

        // Caminho rapido e confiavel: tira o "-rw" da URL para devolver JPEG real
        const imagem = $('img[data-media-id]', tile) || $('img', tile);
        const src = (imagem && (imagem.currentSrc || imagem.src)) || this.getMediaSrcFromTile(tile);
        const real = this.urlDeImagemReal(src);
        let response = null;
        if (real !== src) {
          try { response = await fetch(real, { credentials: 'include' }); } catch (_) { response = null; }
          if (response && !response.ok) response = null;
        }
        if (!response) response = await fetch(src, { credentials: 'include' });
        if (!response.ok) throw new Error(`Download recusado (${response.status}).`);
        let blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('O Flow não retornou um arquivo de imagem.');
        blob = await blobToJpeg(blob);
        const file = { blob, name: `${safeName(filename)}.jpg` };
        if (collect) return file;
        this.saveDownload(blob, file.name);
        return file;
      },
      /**
       * Suaviza os menus do Flow enquanto o lote roda, sem bloquear eventos do DOM.
       */
      silenciarMenus(ligar) {
        const id = 'flow-esconde-menus';
        const antigo = document.getElementById(id);
        if (!ligar) { if (antigo) antigo.remove(); return; }
        if (antigo) return;
        const st = document.createElement('style');
        st.id = id;
        st.textContent = '.cdk-overlay-container{opacity:0.01!important;}' +
          '.cdk-overlay-backdrop{opacity:0.01!important;}';
        document.head.appendChild(st);
      },
      async downloadEntries(entries) {
        if (this._modernDownloading) return;
        this._modernDownloading = true;
        this.silenciarMenus(true);
        let done = 0, failed = 0;
        const files = [], names = new Set();
        const list = unique(entries.map(e => ({ ...e, uuid: e.uuid || e.workflowId })));
        try {
        for (const entry of list) {
          try {
            this.setStatus('info', '⬇️ Baixando <b>' + (done + failed + 1) + '/' + list.length + '</b> — ' +
              String(entry.filename || entry.name || '').slice(0, 40));
            const baseNome = entry.filename || entry.name || `media_${entry.uuid}`;
            const file = await this.downloadEntry(entry, baseNome, true);
            if (file) {
              if (names.has(file.name)) file.name = `${safeName(file.name)}_${entry.uuid}.${file.name.split('.').pop()}`;
              names.add(file.name);
              files.push(file);
            }
            done++;
          }
          catch (error) { failed++; this.logDebug(error.message, 'error'); }
        }
        if (files.length) {
          this.setStatus('info', `📦 Criando arquivo ZIP com ${files.length} mídia(s)...`);
          const zip = await zipFiles(files);
          this.saveDownload(zip, `Flow_cenas_${Date.now()}.zip`);
        }
        this.setStatus(failed ? 'warning' : 'success', `⬇️ ${done} mídia(s) processada(s)${files.length ? `; ${files.length} no ZIP` : ''}${failed ? `; ${failed} falha(s)` : ''}. Confira os downloads.`);
        } catch (error) { this.setStatus('error', `Download: ${error.message}`); }
        finally { this._modernDownloading = false; this.silenciarMenus(false); }
      },
      async downloadScenes() {
        const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
        let entries = [...assignments].flatMap(([name, items]) => items.map(item => ({
          ...item,
          uuid: item.workflowId,
          filename: `${name.replace(/\s+/g, '_')}_${item.imgNum}`
        })));

        // Se o mapa em memória estiver vazio (ex: após F5 ou uso da aba Renomear),
        // varre a galeria buscando todas as cenas já identificadas!
        if (!entries.length) {
          this.logDebug('Buscando cenas na galeria para gerar o ZIP...', 'info');
          const gallery = await this.scanGallery();
          const encontradas = [];
          for (const item of gallery) {
            const info = sceneInfo(item.name) || (item.name ? this.lerNome(item.name) : null);
            if (info) {
              encontradas.push({
                uuid: item.uuid,
                name: item.name,
                isVideo: item.isVideo,
                filename: `Cena_${info.sceneNum}_${info.imgNum || 1}`
              });
            } else {
              const tileAssigned = this.tileAssignments.get(item.uuid);
              if (tileAssigned && tileAssigned.type === 'scene') {
                encontradas.push({
                  uuid: item.uuid,
                  name: tileAssigned.label || item.name,
                  isVideo: item.isVideo,
                  filename: `${(tileAssigned.scene || 'Cena').replace(/\s+/g, '_')}_${tileAssigned.imgNum || 1}`
                });
              }
            }
          }
          entries = encontradas;
        }

        if (!entries.length) {
          this.setStatus('warning', 'Nenhuma cena encontrada para download. Atribua ou renomeie as cenas primeiro.');
          return;
        }

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
        // Teto do lote derivado do SEU campo "desistir sem progresso": estourou,
        // o que faltou conta como falha e passamos para o proximo lote.
        const hardDeadline = Date.now() + Math.max(noProgressLimit * 5, 5 * 60000);
        // "Confirmar por" do painel: espera esse tempinho depois que tudo chegou,
        // para nao cortar um resultado que ainda esta assentando.
        const confirmar = Math.max(0, Number(CONFIG.STABILIZE_TIME) || 0);
        let zeradoEm = null;
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
          if (!pending) {
            if (!confirmar) break;
            if (zeradoEm == null) zeradoEm = Date.now();
            if (Date.now() - zeradoEm >= confirmar) break;
          } else zeradoEm = null;
          const nextSignature = matrix.map(slot => `${slot.state}:${norm(slot.record?.nodes[slot.index]?.querySelector('.loading-percentage')?.textContent)}`).join('|');
          if (signature !== nextSignature) { signature = nextSignature; lastProgress = Date.now(); }
          if (Date.now() - lastProgress > noProgressLimit || Date.now() > hardDeadline) {
            motivoParada = 'A geração não terminou em ' + Math.round(noProgressLimit / 60000) + ' min sem progresso (seu limite).'; break;
          }
          if (matrix.some(slot => slot.state === 'pending' && !slot.record?.nodes[slot.index]?.isConnected)) {
            motivoParada = 'A galeria mudou durante o lote.'; break;
          }
          const passo = Math.max(300, Number(document.getElementById('flow-t-poll')?.value || 0.5) * 1000);
          await this.sleep(Math.round(passo * this.fatorVelocidade()));
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
        if (all) { all.click(); await this.pausa(200); }
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
        // O Flow ordena por "Mais recentes", entao tudo que nascer novo aparece
        // ACIMA do que ja existe. Varrer a galeria inteira so para montar a linha
        // de base atrasava o primeiro envio em ate um minuto em projetos grandes.
        this._modernBaseline = new Set();
        for (let volta = 0; volta < 4; volta++) {
          this.getTiles().forEach(t => { const id = this.getUuidFromTile(t); if (id) this._modernBaseline.add(id); });
          if (!this.rolarUmPedaco(scroller, 0.9, false)) break;
          await this.sleep(250);
        }
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
        // O id cdk-overlay-N muda a cada abertura; por isso ancoramos nos
        // componentes estáveis e lemos primeiro o span exato mostrado no DevTools.
        const seletores = [
          '.cdk-overlay-pane flow-info-panel flow-expandable-prompt .prompt-text > span:nth-child(1)',
          'flow-info-panel flow-expandable-prompt .prompt-text > span:nth-child(1)',
          '.cdk-overlay-pane flow-info-panel flow-expandable-prompt .prompt-text',
          'flow-info-panel flow-expandable-prompt .prompt-text',
          '.cdk-overlay-container flow-expandable-prompt .prompt-text'
        ];
        const alvos = document.querySelectorAll(seletores.join(','));
        for (const el of alvos) {
          if (!visible(el)) continue;
          const t = norm(el.textContent);
          if (t.length > 3) return t;
        }
        return null;
      },

      async promptPorHover(tile, tetoMs = 3000) {
        if (!tile) return null;
        // O Flow decide o hover em algum nivel entre o <video>/<img> e o tile
        // inteiro, e isso muda entre versoes. Em vez de apostar num alvo so,
        // avisamos a cadeia inteira, de dentro para fora.
        const midia = tile.querySelector('flow-video-tile video, flow-image-tile img, video, img') || tile;
        const cadeia = [];
        for (let el = midia; el && el !== document.body && cadeia.length < 6; el = el.parentElement) cadeia.push(el);
        if (!cadeia.includes(tile)) cadeia.push(tile);
        const r = (midia.getBoundingClientRect().width ? midia : tile).getBoundingClientRect();
        if (!r.width || !r.height) return null;
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);

        const disparar = (el, tipo) => {
          const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0 };
          try {
            el.dispatchEvent(/^pointer/.test(tipo)
              ? new PointerEvent(tipo, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, base))
              : new MouseEvent(tipo, base));
          } catch (_) {}
        };
        const ENTRAR = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'];
        const SAIR = ['pointermove', 'mousemove', 'pointerout', 'mouseout', 'pointerleave', 'mouseleave'];
        // O diagnostico provou que o Flow so abre o painel quando TODOS os
        // filhos do tile recebem o hover. Por isso isso vem de primeira.
        const filhos = () => [tile, ...tile.querySelectorAll('*')];
        const entrarTudo = () => {
          cadeia.forEach(el => ENTRAR.forEach(t => disparar(el, t)));
          filhos().forEach(el => { disparar(el, 'pointerover'); disparar(el, 'mouseover'); disparar(el, 'mouseenter'); disparar(el, 'mousemove'); });
        };
        const sairTudo = () => {
          cadeia.forEach(el => SAIR.forEach(t => disparar(el, t)));
          filhos().forEach(el => { disparar(el, 'pointerout'); disparar(el, 'mouseout'); disparar(el, 'mouseleave'); });
        };

        let texto = null;
        try {
          tile.scrollIntoView({ block: 'center' });
          // O painel da midia ANTERIOR pode ainda estar aberto. Se lermos nesse
          // instante pegamos o prompt errado e a midia recebe o nome de outra
          // cena. Entao primeiro afastamos o mouse e esperamos o painel fechar.
          if (this.lerPainelDePrompt()) {
            sairTudo();
            const corpo = document.body;
            ['pointermove', 'mousemove'].forEach(t => {
              try { corpo.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 2, clientY: 2 })); } catch (_) {}
            });
            for (let e = 0; e < 1200 && this.lerPainelDePrompt(); e += 100) await this.sleep(100);
          }
          entrarTudo();
          for (let esperou = 0; esperou < tetoMs; esperou += 80) {
            await this.pausa(80);
            texto = this.lerPainelDePrompt();
            if (texto) break;
            if (esperou % 400 === 0) entrarTudo();
            else cadeia.forEach(el => { disparar(el, 'pointermove'); disparar(el, 'mousemove'); });
          }
        } finally {
          sairTudo();
        }
        return texto;
      },

      /**
       * Mostra o plano como uma lista de atribuicoes, igual ao seletor de
       * atribuir: cada linha traz o nome atual, o nome novo e um X para tirar
       * aquela midia antes de aplicar.
       */
      mostrarPlanoRenomear(plano) {
        this._planoRenomear = plano.slice();
        const painel = document.getElementById('rn-resultado');
        const botao = document.getElementById('rn-aplicar');
        if (!painel) return;
        const desenhar = () => {
          painel.innerHTML = '';
          for (const p of this._planoRenomear) {
            const linha = document.createElement('div');
            linha.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 8px;' +
              'border-radius:6px;margin-bottom:3px;background:var(--cd-bg-secondary);border:1px solid var(--cd-border-light);';
            const texto = document.createElement('span');
            texto.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            texto.innerHTML = '<span style="opacity:.55">' + (p.name || 'sem nome').slice(0, 30) + '</span> → <b>' + p.novo + '</b>';
            texto.title = p.prompt ? String(p.prompt).slice(0, 400) : '';
            const x = document.createElement('button');
            x.textContent = '✕';
            x.title = 'Tirar esta mídia da lista';
            x.style.cssText = 'border:0;background:transparent;cursor:pointer;color:#dc2626;font-size:13px;line-height:1;padding:2px 5px;';
            x.addEventListener('click', () => { this._planoRenomear = this._planoRenomear.filter(o => o !== p); desenhar(); });
            linha.appendChild(texto); linha.appendChild(x);
            painel.appendChild(linha);
          }
          if (botao) {
            const n = this._planoRenomear.length;
            botao.style.display = n ? '' : 'none';
            botao.disabled = !n;
            botao.textContent = '✅ Aplicar em ' + n + ' mídia(s)';
          }
        };
        desenhar();
      },

      /** Aplica o que sobrou na lista depois das suas remocoes. */
      async aplicarPlanoRenomear() {
        const plano = (this._planoRenomear || []).slice();
        if (!plano.length || this._renomeando) return;
        this._renomeando = true;
        this.renomearParar = false;
        const aviso = (m, tipo) => {
          const el = document.getElementById('rn-status');
          if (el) { el.className = 'flow-status ' + (tipo || 'info'); el.innerHTML = m; }
        };
        const barra = document.getElementById('rn-barra');
        const botao = document.getElementById('rn-aplicar');
        if (botao) botao.disabled = true;
        let ok = 0, falhou = 0;
        try {
          for (let i = 0; i < plano.length; i++) {
            if (this.renomearParar) { aviso('⏹ Parado por você. ' + ok + ' renomeada(s).', 'warning'); return; }
            const p = plano[i];
            aviso('🏷️ Renomeando <b>' + (i + 1) + '/' + plano.length + '</b> — ' + p.novo);
            if (barra) barra.style.width = Math.round((i / plano.length) * 100) + '%';
            if (norm(p.name) === norm(p.novo)) { ok++; continue; }
            if (await this.apiRename(p.uuid, p.novo)) {
              ok++;
              this.tileAssignments.set(p.uuid, { label: p.novo, type: 'scene', scene: 'Cena ' + p.cena, imgNum: p.g });
              this.pintarNomeNoTile(p.uuid, p.novo);
              this.startLabelObserver();
              try { await this.apiFavorite(p.uuid, true); } catch (_) {}
              this._planoRenomear = this._planoRenomear.filter(o => o.uuid !== p.uuid);
            } else falhou++;
          }
          if (barra) barra.style.width = '100%';
          aviso('✅ <b>' + ok + '</b> mídia(s) renomeada(s)' + (falhou ? ' · ' + falhou + ' falha(s)' : '') + '.', 'success');
        } catch (erro) {
          aviso('❌ ' + erro.message, 'error');
        } finally {
          this._renomeando = false;
          this.mostrarPlanoRenomear(this._planoRenomear || []);
        }
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

            let cena = null, origem = null;
            // 1. Já está nomeada? (ex: "Cena 1 - Imagem 1")
            const jaNomeada = lerNomeModelo(entry.name) || sceneInfo(entry.name);
            if (jaNomeada) {
              cena = jaNomeada.sceneNum;
              origem = 'nome';
            } else {
              // 2. Número da cena no rótulo/título visível do card (ex: "1 - Homem...", "{cena 1}...")
              const doRotulo = this.numeroDaCenaNoTexto(entry.name);
              if (doRotulo != null) {
                cena = doRotulo;
                origem = 'rótulo';
              } else {
                // 3. Pelo componente Angular na memória
                const doAngular = this.promptDoComponente(tile);
                const cenaAngular = doAngular ? this.numeroDaCenaNoTexto(doAngular) : null;
                if (cenaAngular != null) {
                  cena = cenaAngular;
                  origem = 'angular';
                } else {
                  // 4. Hover rápido (1.2s máx)
                  try {
                    const promptHover = await this.promptPorHover(tile, 1200);
                    const doHover = this.numeroDaCenaNoTexto(promptHover);
                    if (doHover != null) {
                      cena = doHover;
                      origem = 'hover';
                    }
                  } catch (_) {}
                }
              }
            }

            coletadas.push({ uuid: entry.uuid, name: entry.name, isVideo: entry.isVideo, cena, origem });
            aviso('🔎 Varrendo a galeria... <b>' + coletadas.length + '</b> mídia(s)');
          }, { completo: true });

          if (this.renomearParar) { aviso('⏹ Parado por você.', 'warning'); return; }
          if (!coletadas.length) { aviso('Nenhuma mídia encontrada nesta tela.', 'warning'); return; }

          // ── 2. NÚMERO DA CENA: caso ainda haja mídias sem número, tenta casar com os prompts digitados
          aviso('🔎 Identificando cenas de ' + coletadas.length + ' mídia(s)...');
          const promptsInput = document.getElementById('flow-prompts-input')?.value || document.getElementById('fv-prompts-input')?.value || '';
          const parsedPrompts = parsePromptsText(promptsInput);
          if (parsedPrompts.length > 0) {
            for (const item of coletadas) {
              if (item.cena != null) continue;
              const match = parsedPrompts.find(p => norm(p.text).toLowerCase() === norm(item.name).toLowerCase());
              if (match && match.promptNum) {
                item.cena = match.promptNum;
                item.origem = 'prompt_digitado';
              }
            }
          }

          const semNumero = coletadas.filter(x => x.cena == null);
          const porOrigem = {};
          coletadas.forEach(x => { if (x.origem) porOrigem[x.origem] = (porOrigem[x.origem] || 0) + 1; });
          this.logDebug('🔎 Números encontrados por: ' +
            (Object.entries(porOrigem).map(([k, v]) => k + '=' + v).join(' · ') || 'nenhum'), 'info');

          if (semNumero.length) {
            this.logDebug('🔎 ' + semNumero.length + ' mídia(s) sem número de cena identificado.', 'warning');
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
            this.mostrarPlanoRenomear(plano);
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
              this.pintarNomeNoTile(p.uuid, p.novo);
              this.startLabelObserver();
              try { await this.apiFavorite(p.uuid, true); } catch (_) {}

              // Mantém o mapa de cenas atualizado para o download em ZIP logo em seguida
              const assignments = p.isVideo ? this.videoSceneAssignments : this.sceneAssignments;
              const sceneName = 'Cena ' + p.cena;
              if (!assignments.has(sceneName)) assignments.set(sceneName, []);
              const list = assignments.get(sceneName);
              const idx = list.findIndex(item => item.workflowId === p.uuid);
              if (idx >= 0) list.splice(idx, 1);
              list.push({ imgNum: p.g, workflowId: p.uuid, src: p.src || '' });
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
            '<button id="rn-start" class="flow-btn flow-btn-primary">🔎 Analisar a galeria</button>' +
            '<button id="rn-stop" class="flow-btn flow-btn-secondary" disabled>⏹ Parar</button>' +
          '</div>' +
          '<button class="flow-validate-btn" id="rn-testar" style="display:none;">analisar</button>' +
          '<button class="flow-btn flow-btn-primary" id="rn-aplicar" style="width:100%;margin-top:6px;display:none;" disabled>✅ Aplicar renomeação</button>' +
          '<div style="font-size:11px;color:var(--cd-text-muted);margin:2px 0 8px;line-height:1.5;">' +
            'Nada é renomeado até você clicar em <b>Aplicar</b>. Revise a lista e use o <b>✕</b> para tirar o que não quer.' +
          '</div>' +
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
      // Analisar NUNCA renomeia. Aplicar e um segundo clique, seu.
      document.getElementById('rn-start').addEventListener('click', () => rodar(true));
      document.getElementById('rn-testar').addEventListener('click', () => rodar(true));
      document.getElementById('rn-aplicar').addEventListener('click', () => {
        const alvo = root.__flowInstance;
        if (alvo) alvo.aplicarPlanoRenomear();
      });
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

    // Diagnostico do hover: descobre O QUE abre o painel de prompt.
    root.__flowDiag = async function (indice) {
      const i = root.__flowInstance;
      if (!i) return 'sem instancia';
      const tiles = i.getTiles();
      const tile = tiles[indice || 0];
      if (!tile) return { erro: 'nenhuma midia na tela', tiles: tiles.length };
      const espera = ms => new Promise(r => setTimeout(r, ms));
      const conta = () => ({
        overlays: document.querySelectorAll('.cdk-overlay-pane').length,
        infoPanel: document.querySelectorAll('flow-info-panel').length,
        expandable: document.querySelectorAll('flow-expandable-prompt').length,
        promptText: document.querySelectorAll('.prompt-text').length,
        lido: i.lerPainelDePrompt()
      });
      const disparar = (el, tipos) => tipos.forEach(t => {
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, view: window, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2), buttons: 0 };
        try { el.dispatchEvent(/^pointer/.test(t) ? new PointerEvent(t, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o)) : new MouseEvent(t, o)); } catch (_) {}
      });
      const EV = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'];

      tile.scrollIntoView({ block: 'center' });
      await espera(300);
      const relatorio = { tiles: tiles.length, antes: conta(), tentativas: [] };

      const midia = tile.querySelector('flow-video-tile video, flow-image-tile img, video, img') || tile;
      const cadeia = [];
      for (let el = midia; el && el !== document.body && cadeia.length < 6; el = el.parentElement) cadeia.push(el);

      for (const el of cadeia) {
        disparar(el, EV);
        await espera(700);
        const c = conta();
        relatorio.tentativas.push(Object.assign({ modo: 'hover ' + el.tagName.toLowerCase() }, c));
        if (c.lido) { relatorio.funcionou = 'hover ' + el.tagName.toLowerCase(); return relatorio; }
      }

      tile.querySelectorAll('*').forEach(el => disparar(el, ['pointerover', 'mouseover', 'mouseenter']));
      await espera(900);
      const ultimo = Object.assign({ modo: 'todos os filhos' }, conta());
      relatorio.tentativas.push(ultimo);
      if (ultimo.lido) { relatorio.funcionou = 'todos os filhos'; return relatorio; }

      relatorio.botoes = [...tile.querySelectorAll('button,[role="button"],[aria-label]')]
        .map(b => b.tagName.toLowerCase() + '[' + (b.getAttribute('aria-label') || '') + ']').slice(0, 20);
      relatorio.componentes = [...new Set([...tile.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(t => t.startsWith('flow-') || t.startsWith('mat-')))];
      relatorio.htmlDoTile = tile.outerHTML.slice(0, 700);
      relatorio.overlaysNoDoc = [...document.querySelectorAll('.cdk-overlay-pane')].map(o => (o.textContent || '').trim().slice(0, 120));
      return relatorio;
    };

    // Autoteste: cole __flowCheck() no console para ver o que esta carregado.
    root.__flowCheck = function () {
      const i = root.__flowInstance;
      const metodos = ['montarNome','renomearGaleria','promptPorHover','lerPainelDePrompt','scanGallery','apiRename','autoEnumerarCenas'];
      const tiles = i ? i.getTiles() : [];
      return {
        versao: 'Flow NOVO v7.1',
        instancia: !!i,
        abaRenomear: !!document.querySelector('.flow-tab[data-tab="renomear"]'),
        abas: [...document.querySelectorAll('.flow-tab')].map(t => t.textContent.trim()),
        metodos: i ? metodos.filter(m => typeof i[m] === 'function') : 'sem instancia',
        faltando: i ? metodos.filter(m => typeof i[m] !== 'function') : metodos,
        editor: !!document.querySelector('.ProseMirror[contenteditable="true"]'),
        rolagem: i && i.getScroller() ? i.getScroller().tagName.toLowerCase() : null,
        midiasNaTela: tiles.length,
        exemplo: tiles.length && i ? i.tileEntry(tiles[0]) : null
      };
    };

    // ── Encolher para o canto inferior direito ──────────────────────────────
    // O painel de atribuir nascia colado no alto e ocupava a largura da galeria.
    // Minimizado ele agora vira uma barrinha no canto de baixo, do lado direito.
    const CHAVE_CANTO = 'flow_assign_canto';
    function estiloDoCanto() {
      if (document.getElementById('flow-estilo-canto')) return;
      const st = document.createElement('style');
      st.id = 'flow-estilo-canto';
      st.textContent = [
        '#flow-assign-panel.canto{top:auto!important;left:auto!important;right:16px!important;',
        'bottom:16px!important;width:auto!important;max-width:340px;min-width:190px;',
        'border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.28);}',
        '#flow-assign-panel.canto .flow-assign-header{padding:8px 12px;}',
        '#flow-assign-panel.canto .flow-assign-header h3{font-size:12px;}',
        '#flow-assign-panel.canto .flow-assign-items,',
        '#flow-assign-panel.canto .flow-assign-prompt-preview,',
        '#flow-assign-panel.canto .flow-assign-reload-bar{display:none;}'
      ].join('');
      document.head.appendChild(st);
    }

    // Painel de atribuir e cartao do painel principal disputam o mesmo canto.
    // Quando os dois estao na tela, o de atribuir sobe e fica em cima do cartao.
    function ajustarCanto() {
      const painel = document.getElementById('flow-assign-panel');
      if (!painel) return;
      // O painel reescreve o simbolo do botao quando reabre; aqui garantimos
      // que ele sempre diga a acao certa: — para minimizar, ⤢ para maximizar.
      const b = document.getElementById('flow-assign-toggle');
      const noCanto = painel.classList.contains('canto');
      if (b) {
        const certo = noCanto ? '⤢' : '—';
        if (b.textContent !== certo) {
          b.textContent = certo;
          b.title = noCanto ? 'Maximizar (voltar ao tamanho cheio)' : 'Minimizar para o canto';
        }
      }
      if (!noCanto) { painel.style.removeProperty('bottom'); return; }
      const mini = document.getElementById('flow-mini');
      let embaixo = 16;
      try {
        if (mini && getComputedStyle(mini).display !== 'none') {
          const h = mini.getBoundingClientRect().height;
          if (h > 0) embaixo = Math.round(h) + 26;
        }
      } catch (_) {}
      painel.style.setProperty('bottom', embaixo + 'px', 'important');
    }
    setInterval(ajustarCanto, 1200);

    // ── Numeros mais legiveis ───────────────────────────────────────────────
    // As contagens nasciam em cinza claro sobre fundo branco e quase nao se liam.
    // Aqui elas ficam pretas e em negrito, sem mexer no resto do visual.
    function estiloDosNumeros() {
      if (document.getElementById('flow-estilo-numeros')) return;
      const st = document.createElement('style');
      st.id = 'flow-estilo-numeros';
      st.textContent = [
        /* contagem do painel de atribuir: "3/10 concluidas" */
        '.flow-assign-count{color:#0f172a!important;font-weight:800!important;font-size:13px!important;}',
        /* nome e situacao de cada item do seletor */
        '.flow-assign-item{color:#0f172a!important;}',
        '.flow-assign-item .assign-name{color:#0f172a!important;font-weight:600!important;}',
        '.flow-assign-item .assign-status{font-weight:800!important;color:#0f172a!important;}',
        '.flow-assign-item.assigned{opacity:.95!important;}',
        '.flow-assign-item.assigned .assign-name{color:#334155!important;}',
        '.flow-assign-item.complete .assign-name{color:#14532d!important;font-weight:800!important;}',
        '.flow-assign-item.missing{opacity:.8!important;}',
        /* quantos prompts foram lidos, nas duas abas */
        '#flow-prompt-count,#fv-prompt-count{color:#0f172a!important;font-weight:700!important;font-size:12px!important;}',
        /* resumo dos tempos */
        '#flow-t-info,#fv-t-info{color:#334155!important;font-weight:600!important;}',
        /* aba Renomear: situacao, previa e a lista de nomes */
        '#rn-status{font-weight:600!important;}',
        '#rn-status b{color:#0f172a!important;font-weight:800!important;}',
        '#rn-preview{color:#0f172a!important;}',
        '#rn-preview b{color:#0f172a!important;font-weight:800!important;}',
        '#rn-resultado{color:#0f172a!important;}',
        '#rn-resultado b{color:#0f172a!important;font-weight:800!important;}',
        '#rn-resultado span[style*="opacity"]{opacity:.8!important;color:#334155!important;}',
        '#rn-aplicar{font-weight:800!important;}'
      ].join('');
      document.head.appendChild(st);
    }
    estiloDosNumeros();
    for (const ms of [400, 1200, 2500]) setTimeout(estiloDosNumeros, ms);

    proto.toggleAssignPanel = function () {
      const painel = document.getElementById('flow-assign-panel');
      const botao = document.getElementById('flow-assign-toggle');
      if (!painel) return;
      estiloDoCanto();
      const encolher = !painel.classList.contains('minimized');
      painel.classList.toggle('minimized', encolher);
      painel.classList.toggle('canto', encolher);
      if (botao) {
        // Duas acoes claras, no mesmo lugar: encolher e voltar ao tamanho cheio.
        botao.textContent = encolher ? '⤢' : '—';
        botao.title = encolher ? 'Maximizar (voltar ao tamanho cheio)' : 'Minimizar para o canto';
        botao.classList.toggle('collapsed', encolher);
      }
      // Encolhido, o cabecalho inteiro vira o botao de maximizar.
      const cabecalho = painel.querySelector('.flow-assign-header');
      if (cabecalho && !cabecalho._voltaLigada) {
        cabecalho._voltaLigada = true;
        cabecalho.addEventListener('click', (ev) => {
          if (!painel.classList.contains('canto')) return;
          if (ev.target.closest('button')) return;   // os botoes proprios seguem valendo
          this.toggleAssignPanel();
        });
      }
      if (cabecalho) cabecalho.style.cursor = encolher ? 'pointer' : '';
      if (cabecalho) cabecalho.title = encolher ? 'Clique para maximizar' : '';
      try { localStorage.setItem(CHAVE_CANTO, encolher ? '1' : '0'); } catch (_) {}
      if (!encolher) painel.style.removeProperty('bottom'); else ajustarCanto();
      this.updateScrollerPadding();
    };

    // A galeria nao precisa de espaco reservado quando o painel esta no canto.
    const padraoPadding = proto.updateScrollerPadding;
    proto.updateScrollerPadding = function () {
      const painel = document.getElementById('flow-assign-panel');
      if (painel && painel.classList.contains('canto')) {
        const scroller = this.getScroller();
        if (scroller) scroller.style.paddingTop = '';
        return;
      }
      return padraoPadding.call(this);
    };

    proto.initUI = function () {
      old.initUI.call(this);
      root.__flowInstance = this;   // a aba Renomear precisa da instância
      // Lembra se voce deixou o painel de atribuir encolhido no canto.
      const aplicarCantoSalvo = () => {
        try {
          if (localStorage.getItem(CHAVE_CANTO) !== '1') return;
          const painel = document.getElementById('flow-assign-panel');
          if (!painel || painel.classList.contains('canto')) return;
          if (!painel.classList.contains('active')) return;
          this.toggleAssignPanel();
        } catch (_) {}
      };
      for (const ms of [400, 1200, 2500]) setTimeout(aplicarCantoSalvo, ms);
      const abrir = ['showAssignPanel', 'showVideoAssignPanel'];
      for (const nome of abrir) {
        if (typeof this[nome] !== 'function') continue;
        const original = this[nome].bind(this);
        this[nome] = (...args) => { const r = original(...args); setTimeout(aplicarCantoSalvo, 60); return r; };
      }

      // ── Escolha da qualidade do download ───────────────────────────────────
      // Desmarcada (padrao): um pedido por imagem, rapido, tudo num ZIP, em JPEG.
      // Marcada: pega o arquivo ORIGINAL pelo menu do Flow. Bem maior, e mais
      // lento, porque o Flow monta o arquivo de cada midia na hora.
      const criarCaixaQualidade = () => {
        for (const secao of ['flow-download-section', 'fv-download-section']) {
          const alvo = document.getElementById(secao);
          if (!alvo || alvo.querySelector('.flow-caixa-qualidade')) continue;
          const cx = document.createElement('label');
          cx.className = 'flow-caixa-qualidade';
          cx.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-top:10px;' +
            'padding-top:10px;border-top:1px solid var(--cd-border-light);cursor:pointer;font-size:12px;';
          const marca = document.createElement('input');
          marca.type = 'checkbox';
          marca.style.marginTop = '2px';
          // Nasce MARCADA: o padrao e o arquivo original.
          try { marca.checked = localStorage.getItem('flow_baixar_original') !== '0'; }
          catch (_) { marca.checked = true; }
          // Um id só: as duas abas compartilham a mesma escolha.
          marca.id = document.getElementById('flow-alta-qualidade') ? '' : 'flow-alta-qualidade';
          const texto = document.createElement('span');
          texto.innerHTML = '<b>Baixar o arquivo original</b> (recomendado)<br>' +
            '<span style="color:var(--cd-text-light);font-size:11px;">' +
            'Ligado: arquivo original do Flow, em tamanho cheio. Desligado: versão ' +
            'menor e mais rápida. Os dois modos entregam tudo num ZIP só.</span>';
          cx.appendChild(marca); cx.appendChild(texto);
          alvo.appendChild(cx);
          // A segunda aba espelha a primeira.
          marca.addEventListener('change', () => {
            try { localStorage.setItem('flow_baixar_original', marca.checked ? '1' : '0'); } catch (_) {}
            document.querySelectorAll('.flow-caixa-qualidade input').forEach(o => { o.checked = marca.checked; });
            const principal = document.getElementById('flow-alta-qualidade');
            if (principal) principal.checked = marca.checked;
          });
        }
      };
      for (const ms of [600, 1800, 3500]) setTimeout(criarCaixaQualidade, ms);
      setInterval(criarCaixaQualidade, 5000);

      // ── Botao "Aplicar renomeação" ─────────────────────────────────────────
      // Voce marca tudo arrastando, clica UMA vez aqui, e os nomes valem na
      // hora. Sem precisar atualizar a pagina. Depois disso as midias seguem
      // marcadas, entao o download em lote (Baixar Cenas) pega todas de uma vez,
      // com os nomes certos — do jeito que voce ja usava.
      const criarBotaoAplicar = () => {
        const barra = document.getElementById('flow-assign-reload-bar');
        if (!barra || document.getElementById('flow-aplicar-nomes')) return;
        const b = document.createElement('button');
        b.id = 'flow-aplicar-nomes';
        b.textContent = '✅ Aplicar renomeação';
        b.style.cssText = 'padding:8px 20px;font-size:13px;font-weight:800;border:none;' +
          'border-radius:8px;cursor:pointer;margin-right:8px;color:#fff;' +
          'background:linear-gradient(135deg,#10b981,#059669);';
        b.addEventListener('click', async () => {
          if (b.disabled) return;
          b.disabled = true;
          const antes = b.textContent;
          b.textContent = '⏳ Aplicando...';
          try { await this.aplicarMarcas(); }
          finally { b.disabled = false; b.textContent = antes; this.mostrarBarraDeAtualizar(); }
        });
        barra.insertBefore(b, barra.firstChild);
      };
      for (const ms of [500, 1500, 3000]) setTimeout(criarBotaoAplicar, ms);
      setInterval(criarBotaoAplicar, 4000);

      // Ao abrir a pagina, aplica o que ficou marcado da vez passada.
      // Espera a galeria aparecer para nao tentar antes da hora.
      const aplicarAoAbrir = async () => {
        try {
          if (!Object.keys(this.lerMarcas()).length) return;
          this.mostrarBarraDeAtualizar();
          for (let i = 0; i < 40; i++) {
            if (this.getTiles().length) break;
            await this.sleep(500);
          }
          if (!this.getTiles().length) {
            this.logDebug('Há nomes marcados, mas a galeria não abriu; eles continuam guardados.', 'warning');
            return;
          }
          await this.aplicarMarcas();
        } catch (_) {}
      };
      setTimeout(aplicarAoAbrir, 2500);

      // ── O X da etiqueta desfaz a atribuicao NA HORA ──────────────────────
      // Ao clicar no X da etiqueta, a imagem é desvinculada e o seletor na barrinha
      // volta ao estado original (cinza/disponível), sem ser excluído.
      document.addEventListener('click', (e) => {
        const xis = e.target && e.target.closest && e.target.closest('.label-x');
        if (!xis) return;
        const etiqueta = xis.closest('.flow-tile-label');
        if (!etiqueta || !etiqueta.dataset.wf) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();   // impede o tratador antigo

        const wf = etiqueta.dataset.wf;
        const tipo = etiqueta.dataset.type;
        const nome = etiqueta.dataset.name;
        const cena = etiqueta.dataset.scene;

        etiqueta.remove();
        this.tileAssignments.delete(wf);

        // Se ainda era so uma MARCACAO, some sem tocar no servidor e a midia
        // fica com o nome original dela. Se ja tinha sido aplicada, devolvemos
        // o nome que ela tinha antes — nunca mais "Imagem gerada" no lugar.
        const marca = this.desmarcar(wf);
        const original = (marca && marca.original) || '';
        const jaAplicada = !marca;
        this.pintarNomeNoTile(wf, original || 'Imagem gerada');

        if (tipo === 'ref') {
          if (nome) {
            this.refAssignments.delete(nome);
            this.updateAssignItemUI(nome, false);
          }
        } else if (tipo === 'scene' && cena) {
          const mapa = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
          const lista = mapa.get(cena) || [];
          const i = lista.findIndex(a => a && a.workflowId === wf);
          if (i >= 0) lista.splice(i, 1);
          if (!lista.length) {
            mapa.delete(cena);
            this.updateAssignItemUI(cena, false);
          } else {
            mapa.set(cena, lista);
            this.updateAssignItemUI(cena, true);
          }
        }
        try { this.updateAssignCount(); } catch (_) {}
        this.logDebug(jaAplicada
          ? '✕ atribuição desfeita; devolvendo o nome ' + JSON.stringify(original || 'Imagem gerada') + '.'
          : '✕ marcação removida antes de aplicar; a mídia manteve o nome dela.', 'info');

        // Servidor so quando a renomeacao JA tinha sido aplicada.
        if (jaAplicada) {
          (async () => {
            try { await this.apiRename(wf, original || 'Imagem gerada'); } catch (_) {}
            try { await this.apiFavorite(wf, false); } catch (_) {}
          })();
        }
      }, true);


      // Fechar o painel principal passa a deixar o cartao no canto inferior
      // direito, e nao so durante uma execucao. O X do proprio cartao dispensa.
      const fechar = document.getElementById('flow-close');
      if (fechar) fechar.addEventListener('click', () => {
        const mini = document.getElementById('flow-mini');
        if (!mini) return;
        mini.style.display = 'flex';
        if (!this.isRunning && !this.videoIsRunning) {
          const st = document.getElementById('flow-mini-status');
          const sub = document.getElementById('flow-mini-sub');
          if (st) st.textContent = 'Criadores Dark';
          if (sub) sub.textContent = 'Clique para abrir o painel';
        }
      });

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

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  PARTE 2 de 2 — PROGRAMA PRINCIPAL                                       │
// └──────────────────────────────────────────────────────────────────────────┘
// ==========================================
// FLOW IMAGE AUTOMATION - CRIADORES DARK
// Versão 4.1 - Drag & Drop + API Rename (Flow Voz)
// + ADD-ONS: Resume, Numeração Fiel e Upscale
// + FIX: Seletores atualizados para nova interface Flow (Mai/2026)
// ==========================================
//
// ARQUITETURA:
//   - Três modos: Livre, Referências, Cenas
//   - Rename e Favoritar via API (não simula cliques)
//   - Atribuição manual via Drag & Drop após geração
//   - Labels visuais nos tiles com X para remover
//   - Referências usam sufixo " _" para identificação
//   - Vozes adicionadas usando a tag <voz: Nome>
//
(function() {
    'use strict';

    if (window.FlowAutomationInitialized) {
        console.warn('[Flow] Já está rodando!');
        return;
    }
    window.FlowAutomationInitialized = true;

    // ============================================================
    // TRUSTED TYPES (Flow novo em flow.google.com)
    // ============================================================
    // O Flow novo exige TrustedHTML: passar uma string para innerHTML ou
    // insertAdjacentHTML e bloqueado ('This document requires TrustedHTML
    // assignment') e o painel nunca chegava a ser desenhado. Registrar a
    // policy 'default' faz o navegador aceitar as strings de HTML que o
    // painel ja usa, sem precisar mexer nos 22 pontos que montam HTML.
    try {
        if (window.trustedTypes && window.trustedTypes.createPolicy && !window.trustedTypes.defaultPolicy) {
            window.trustedTypes.createPolicy('default', {
                createHTML: (s) => s,
                createScript: (s) => s,
                createScriptURL: (s) => s
            });
        }
    } catch (e) {
        console.warn('[Flow] Trusted Types: nao foi possivel registrar a policy padrao.', e);
    }

    // ============================================================
    // TOKEN INTERCEPTION (captura Bearer token automaticamente)
    // ============================================================
    const _origFetch = window.fetch;
    let _authToken = null;

    window.fetch = async function(...args) {
        const [, config] = args;
        try {
            const headers = config?.headers || {};
            const auth = headers instanceof Headers
                ? headers.get('authorization')
                : headers['authorization'] || headers['Authorization'];
            if (auth && auth.startsWith('Bearer ')) _authToken = auth;
        } catch(_) {}
        return _origFetch.apply(this, args);
    };

    const _origXhrOpen = XMLHttpRequest.prototype.open;
    const _origXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function(...args) {
        this._url = args[1];
        return _origXhrOpen.apply(this, args);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) _authToken = value;
        return _origXhrSetHeader.apply(this, arguments);
    };

    // ============================================================
    // DEBUG + CONFIG
    // ============================================================
    const DEBUG = true;
    const log = {
        info:    (m,...a) => DEBUG && console.log(`%c[Flow] ℹ️ ${m}`,  'color:#7b1fa2;font-weight:bold;',...a),
        success: (m,...a) => DEBUG && console.log(`%c[Flow] ✅ ${m}`,  'color:#4caf50;font-weight:bold;',...a),
        warn:    (m,...a) => DEBUG && console.warn(`%c[Flow] ⚠️ ${m}`, 'color:#ff9800;font-weight:bold;',...a),
        error:   (m,...a) => DEBUG && console.error(`%c[Flow] ❌ ${m}`,'color:#f44336;font-weight:bold;',...a),
    };

    const CONFIG = {
        DELAY_SHORT:            [200, 400],
        DELAY_MEDIUM:           [400, 650],
        DELAY_LONG:            [800, 1200],
        DELAY_BETWEEN_SUBMITS: [2000, 3000],
        DELAY_BETWEEN_BATCHES: [1000, 1600],
        GENERATION_TIMEOUT:  180000,
        SEM_PROGRESSO_TIMEOUT: 150000,   // só desiste após 2,5 min SEM nada progredir
        TETO_TIMEOUT:         1800000,   // teto absoluto de segurança (30 min)
        TILE_CHECK_INTERVAL:    900,
        STABILIZE_TIME:        2000,
        MAX_RETRIES:              3,
        API_BASE: 'https://aisandbox-pa.googleapis.com/v1/flowWorkflows',
        REF_SUFFIX: ' _',
        VERSION: '4.4 (Flow Voz + Enum Auto + Aguenta Minimizado)',
        SPEED_PROFILES: {
            slow:   { label: '🐢 Lento',  multiplier: 1.5 },
            normal: { label: '🔄 Normal', multiplier: 1.0 },
            fast:   { label: '⚡ Rápido', multiplier: 0.7 },
        },
    };

    // ============================================================
    // AGUENTA MINIMIZADO
    // ============================================================
    // requestAnimationFrame PARA quando a aba não está visível (minimizada / em
    // segundo plano) — isso travava a automação. Esta versão resolve pelo rAF
    // quando dá, ou por um setTimeout de plano B quando o rAF está congelado.
    // O Chrome FREIA setTimeout (mínimo ~1s) em aba oculta/minimizada. Timers
    // dentro de um Web Worker NÃO sofrem esse freio — então toda a espera da
    // automação passa por aqui e roda em velocidade cheia mesmo minimizado.
    let _timerWorker = null, _timerSeq = 0;
    const _timerWaiters = new Map();
    function getTimerWorker() {
        if (_timerWorker !== null) return _timerWorker;
        try {
            const src = 'self.onmessage=function(e){setTimeout(function(){self.postMessage(e.data.id);},e.data.ms);};';
            const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
            w.onmessage = ev => {
                const done = _timerWaiters.get(ev.data);
                if (done) { _timerWaiters.delete(ev.data); done(); }
            };
            _timerWorker = w;
        } catch (_) {
            _timerWorker = false;   // sem worker: cai no setTimeout normal
        }
        return _timerWorker;
    }

    function wait(ms) {
        const w = getTimerWorker();
        if (!w) return new Promise(r => setTimeout(r, ms));
        return new Promise(resolve => {
            const id = ++_timerSeq;
            _timerWaiters.set(id, resolve);
            // rede de segurança: se o worker não responder, destrava assim mesmo
            setTimeout(() => {
                if (!_timerWaiters.has(id)) return;
                _timerWaiters.delete(id);
                if (_timerWorker) {
                    try { _timerWorker.terminate(); } catch (_) {}
                    _timerWorker = false;
                    console.warn('[Flow] O Flow bloqueou o timer em Worker; usando setTimeout.');
                }
                resolve();
            }, ms + 250);
            w.postMessage({ id, ms });
        });
    }

    // Cede a vez para o React terminar de reconciliar. MessageChannel é o mesmo
    // mecanismo do agendador do React e, ao contrário do setTimeout, NÃO é freado
    // com a aba oculta.
    function yieldTask() {
        return new Promise(resolve => {
            try {
                const ch = new MessageChannel();
                ch.port1.onmessage = () => resolve();
                ch.port2.postMessage(0);
            } catch (_) { resolve(); }
        });
    }

    async function nextFrame() {
        // Aba visível: espera o frame de verdade (é o comportamento original).
        if (document.visibilityState === 'visible') {
            return new Promise(resolve => {
                let done = false;
                const finish = () => { if (!done) { done = true; resolve(); } };
                try { requestAnimationFrame(finish); } catch (_) {}
                wait(150).then(finish);
            });
        }
        // Minimizado o rAF NUNCA dispara. Não dá pra "esperar o frame" — então
        // damos tempo real + deixamos o agendador do React esvaziar a fila.
        // Sem isso o Slate recebe input antes de reconciliar e o Flow quebra
        // com "Application error / client-side exception".
        await wait(260);
        await yieldTask();
        await yieldTask();
    }

    // Mantém a aba "acordada" mesmo minimizada, reduzindo o freio do Chrome nos
    // timers. Áudio praticamente inaudível. Best-effort: se falhar, não faz mal.
    let _keepAliveCtx = null;
    function startKeepAlive() {
        if (_keepAliveCtx) { try { if (_keepAliveCtx.state === 'suspended') _keepAliveCtx.resume(); } catch (_) {} return; }
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.0001;   // quase mudo, mas conta como "tocando"
            osc.frequency.value = 30;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start();
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            _keepAliveCtx = ctx;
        } catch (_) {}
    }

    // ============================================================
    // PARSERS
    // ============================================================
function triggerTrustedClick(el) {
    if (!el) return false;

    const reactKey = Object.keys(el).find(k =>
        k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers')
    );

    const onClick = reactKey && el[reactKey] && el[reactKey].onClick;

    if (typeof onClick === 'function') {
        try {
            onClick({
                isTrusted: true,
                preventDefault() {},
                stopPropagation() {},
                stopImmediatePropagation() {},
                type: 'click',
                target: el,
                currentTarget: el,
                bubbles: true,
                cancelable: true,
                defaultPrevented: false,
                eventPhase: 2,
                detail: 1,
                button: 0,
                buttons: 0,
                nativeEvent: {
                    isTrusted: true,
                    type: 'click'
                },
            });
            return true;
        } catch (err) {
            console.warn('[Flow] triggerTrustedClick falhou, usando .click():', err);
        }
    }

    el.click();
    return false;
}
    function parsePrompt(prompt) {
        const segs = [];
        const re = /(\[([^\]]+)\]|<voz:\s*([^>]+)>)/gi;
        let last = 0, m;
        while ((m = re.exec(prompt)) !== null) {
            if (m.index > last) segs.push({ type:'text', content: prompt.slice(last, m.index) });
            if (m[2]) {
                 segs.push({ type:'ref', name: m[2].trim() });
            } else if (m[3]) {
                 segs.push({ type:'voice', name: m[3].trim() });
            }
            last = m.index + m[0].length;
        }
        if (last < prompt.length) segs.push({ type:'text', content: prompt.slice(last) });
        return segs;
    }

    function extractReferences(prompts) {
        const s = new Set();
        for (const p of prompts) {
            const t = typeof p === 'string' ? p : p.text;
            (t.match(/\[([^\]]+)\]/g) || []).forEach(m => s.add(m.slice(1,-1).trim()));
        }
        return [...s];
    }

    function extractVoices(prompts) {
        const s = new Set();
        for (const p of prompts) {
            const t = typeof p === 'string' ? p : p.text;
             (t.match(/<voz:\s*([^>]+)>/gi) || []).forEach(m => s.add(m.replace(/<voz:\s*/i, '').replace(/>/, '').trim()));
        }
        return [...s];
    }

    // Como os prompts são separados. 'linha' = cada linha é um prompt (padrão antigo);
    // 'vazia' = separa por linha em branco (permite prompt com várias linhas);
    // 'custom' = separa por um caractere/texto escolhido por você (ex: ---).
    let SEPARADOR = { modo: 'linha', texto: '---' };

    function escaparRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function dividirEmPrompts(text) {
        if (SEPARADOR.modo === 'vazia') return String(text).split(/\n\s*\n+/);
        if (SEPARADOR.modo === 'custom') {
            const sep = (SEPARADOR.texto || '').trim();
            if (sep) return String(text).split(new RegExp(escaparRegex(sep), 'i'));
        }
        return String(text).split('\n');
    }

    function parsePromptsText(text, startFrom = 1) {
        const lines = dividirEmPrompts(text).map(l => l.trim()).filter(Boolean);
        const result = [];
        let nextNum = startFrom;
        for (const line of lines) {
            const tag = line.match(/^\{(?:prompt|cena)\s*([\d.]+)\}\s*/i);
            if (tag) {
                const n = parseFloat(tag[1]);
                const rest = line.slice(tag[0].length).trim();
                if (rest) { result.push({ text: rest, promptNum: n }); nextNum = Math.floor(n) + 1; }
                else { nextNum = n; }
            } else {
                result.push({ text: line, promptNum: nextNum++ });
            }
        }
        return result;
    }

    /** Extrai nomes de referência da primeira linha: [Maria][José][Praia] */
    function parseReferenceHeader(text) {
        const lines = text.split('\n');
        const firstLine = lines[0].trim();
        const refs = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(firstLine)) !== null) refs.push(m[1].trim());
        // Primeira linha é SOMENTE referências?
        const stripped = firstLine.replace(/\[([^\]]+)\]/g, '').trim();
        if (refs.length > 0 && stripped === '') {
            let startIdx = 1;
            while (startIdx < lines.length && lines[startIdx].trim() === '') startIdx++;
            return { refs, remaining: lines.slice(startIdx).join('\n') };
        }
        return { refs: [], remaining: text };
    }

    // ============================================================
    // CSS
    // ============================================================
    const css = `
:root{--cd-primary:#10b981;--cd-primary-dark:#059669;--cd-primary-light:#34d399;--cd-bg:#fff;--cd-bg-secondary:#f8fafc;--cd-bg-card:#fff;--cd-border:#e2e8f0;--cd-border-light:#f1f5f9;--cd-text:#1e293b;--cd-text-muted:#64748b;--cd-text-light:#94a3b8;--cd-shadow:0 10px 40px -10px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.05);--cd-shadow-glow:0 0 20px rgba(16,185,129,.3);--cd-radius:16px;--cd-radius-sm:12px;--cd-radius-xs:8px;}
#flow-sidebar{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:10000;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));border-radius:9999px;padding:16px 12px;cursor:pointer;box-shadow:var(--cd-shadow-glow),var(--cd-shadow);transition:all .2s;font-family:'Inter','Segoe UI',system-ui,sans-serif;border:none;writing-mode:vertical-rl;text-orientation:mixed;}
#flow-sidebar:hover{transform:translateY(-50%) scale(1.05);}
#flow-sidebar .icon{color:#fff;font-size:14px;font-weight:600;letter-spacing:.5px;}
#flow-panel{position:fixed;top:12px;right:12px;bottom:12px;width:420px;z-index:10001;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:var(--cd-shadow);border:1px solid var(--cd-border);display:flex;flex-direction:column;font-family:'Inter','Segoe UI',system-ui,sans-serif;transform:translateX(110%);transition:transform .3s cubic-bezier(.4,0,.2,1);overflow:hidden;}
#flow-panel.active{transform:translateX(0);}
.flow-header{padding:16px 20px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.flow-header-left{display:flex;align-items:center;gap:12px;}
.flow-logo{width:36px;height:36px;border-radius:50%;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.15);}
.flow-logo svg{width:21px;height:21px;}
.flow-header-title{font-size:15px;font-weight:700;color:var(--cd-text);margin:0;line-height:1.3;}
.flow-header-subtitle{font-size:12px;font-weight:500;color:var(--cd-text-muted);margin:0;line-height:1.3;}
.flow-close-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--cd-border);background:var(--cd-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;padding:0;}
.flow-close-btn:hover{background:#fee2e2;border-color:#fca5a5;}
.flow-close-btn svg{width:16px;height:16px;color:var(--cd-text-muted);}
.flow-tabs{display:flex;border-bottom:1px solid var(--cd-border-light);flex-shrink:0;}
.flow-tab{flex:1;padding:12px 16px;font-size:13px;font-weight:600;color:var(--cd-text-muted);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;}
.flow-tab:hover{color:var(--cd-text);background:var(--cd-bg-secondary);}
.flow-tab.active{color:var(--cd-primary);border-bottom-color:var(--cd-primary);}
.flow-tab-content{display:none;}
.flow-tab-content.active{display:block;}
.flow-scroll{flex:1;overflow-y:auto;}
.flow-scroll::-webkit-scrollbar{width:4px;}
.flow-scroll::-webkit-scrollbar-thumb{background:var(--cd-border);border-radius:4px;}
.flow-tab-body{padding:16px 20px;}
.flow-card{background:var(--cd-bg-card);border:1px solid var(--cd-border);border-radius:var(--cd-radius-sm);margin-bottom:12px;overflow:hidden;}
.flow-card-header{padding:14px 16px 8px;}
.flow-card-title{font-size:14px;font-weight:600;color:var(--cd-text);margin:0;}
.flow-card-description{font-size:12px;color:var(--cd-text-muted);margin:4px 0 0;line-height:1.4;}
.flow-card-content{padding:8px 16px 16px;}
.flow-textarea{width:100%;min-height:300px;border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:12px;font-size:13px;font-family:inherit;resize:vertical;box-sizing:border-box;outline:none;transition:border .2s;line-height:1.5;}
.flow-textarea:focus{border-color:var(--cd-primary);box-shadow:0 0 0 3px rgba(16,185,129,.1);}
.flow-textarea::placeholder{color:var(--cd-text-light);}
.flow-ref-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
.flow-ref-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid;}
.flow-voice-tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:500;border:1px solid #c7d2fe; background:#eff6ff; color:#1e40af;}
.flow-ref-tag.found{background:#ecfdf5;color:#065f46;border-color:#a7f3d0;}
.flow-ref-tag.missing{background:#fef2f2;color:#991b1b;border-color:#fecaca;}
.flow-ref-tag.pending{background:#f8fafc;color:#64748b;border-color:#e2e8f0;}
.flow-validate-btn{background:var(--cd-bg-secondary);color:var(--cd-text);border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;margin-top:10px;width:100%;}
.flow-validate-btn:hover{background:var(--cd-primary);color:#fff;border-color:var(--cd-primary);}
.flow-validate-btn:disabled{opacity:.5;cursor:not-allowed;}
.flow-option{display:flex;align-items:flex-start;gap:10px;padding:8px 0;}
.flow-option input[type="checkbox"]{margin-top:2px;accent-color:var(--cd-primary);width:16px;height:16px;cursor:pointer;}
.flow-option-text{flex:1;}
.flow-option-title{font-size:13px;font-weight:500;color:var(--cd-text);}
.flow-option-desc{font-size:11px;color:var(--cd-text-muted);margin-top:2px;}
.flow-mode-btns{display:flex;gap:6px;margin-top:6px;}
.flow-mode-btn{flex:1;padding:9px 8px;border-radius:var(--cd-radius-xs);border:1.5px solid var(--cd-border);background:var(--cd-bg);font-size:12px;font-weight:600;color:var(--cd-text-muted);cursor:pointer;transition:all .2s;text-align:center;line-height:1.3;}
.flow-mode-btn:hover{border-color:var(--cd-primary);color:var(--cd-primary);background:rgba(16,185,129,.04);}
.flow-mode-btn.active{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border-color:var(--cd-primary);box-shadow:0 2px 10px rgba(16,185,129,.3);}
.flow-batch-btns{display:flex;gap:6px;}
.flow-batch-btn{width:36px;height:36px;border-radius:var(--cd-radius-xs);border:1px solid var(--cd-border);background:var(--cd-bg-secondary);font-size:14px;font-weight:700;color:var(--cd-text-muted);cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
.flow-batch-btn:hover{border-color:var(--cd-primary);color:var(--cd-primary);}
.flow-batch-btn.active{background:var(--cd-primary);color:#fff;border-color:var(--cd-primary);box-shadow:0 2px 8px rgba(16,185,129,.3);}
.flow-select-imgs{border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:6px 10px;font-size:13px;font-family:inherit;background:var(--cd-bg);color:var(--cd-text);cursor:pointer;}
.flow-actions{display:flex;gap:10px;margin:16px 0 12px;}
.flow-btn{flex:1;padding:10px 16px;border-radius:var(--cd-radius-xs);font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;transition:all .2s;}
.flow-btn svg{width:16px;height:16px;}
.flow-btn-primary{background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;box-shadow:0 2px 8px rgba(16,185,129,.3);}
.flow-btn-primary:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.4);transform:translateY(-1px);}
.flow-btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.flow-btn-secondary{background:var(--cd-bg);color:var(--cd-text);border-color:var(--cd-border);}
.flow-btn-secondary:hover:not(:disabled){background:var(--cd-bg-secondary);}
.flow-btn-secondary:disabled{opacity:.5;cursor:not-allowed;}
.flow-status{padding:10px 14px;border-radius:var(--cd-radius-xs);font-size:12px;margin-bottom:10px;display:none;line-height:1.4;}
.flow-status.info{display:block;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;}
.flow-status.success{display:block;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;}
.flow-status.error{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;}
.flow-status.warning{display:block;background:#fffbeb;color:#92400e;border:1px solid #fde68a;}
.flow-progress{height:4px;background:var(--cd-border-light);border-radius:4px;overflow:hidden;margin-bottom:10px;}
.flow-progress-bar{height:100%;background:linear-gradient(90deg,var(--cd-primary),var(--cd-primary-light));border-radius:4px;transition:width .4s;width:0%;}
.flow-logs-container{display:none;}
.flow-logs-container.visible{display:block;}
.flow-debug-panel{max-height:180px;overflow-y:auto;font-family:monospace;font-size:11px;background:#0f172a;color:#e2e8f0;border-radius:var(--cd-radius-xs);padding:12px;line-height:1.5;}
.flow-debug-panel::-webkit-scrollbar{width:4px;}
.flow-debug-panel::-webkit-scrollbar-thumb{background:#334155;border-radius:4px;}
.flow-debug-line{padding:1px 0;}
.flow-debug-line.error{color:#f87171;}
.flow-debug-line.success{color:#4ade80;}
.flow-debug-line.info{color:#60a5fa;}
.flow-prompt-list{margin-top:8px;}
.flow-prompt-item{display:grid;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;gap:4px 8px;padding:10px 12px;border:1px solid var(--cd-border-light);border-radius:var(--cd-radius-xs);margin-bottom:6px;font-size:12px;transition:all .2s;align-items:start;}
.flow-prompt-item .num{grid-row:1;grid-column:1;font-weight:700;color:var(--cd-primary);min-width:20px;padding-top:1px;}
.flow-prompt-item .text{grid-row:1;grid-column:2;color:var(--cd-text);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;}
.flow-prompt-item .refs{grid-row:2;grid-column:2;display:flex;gap:4px;flex-wrap:wrap;}
.flow-prompt-item .ref-badge{background:var(--cd-primary);color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;}
.flow-prompt-item .voice-badge{background:#3b82f6;color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:600;}
.flow-prompt-item .status-badge{grid-row:1;grid-column:3;font-size:10px;font-weight:600;padding:2px 6px;border-radius:9999px;white-space:nowrap;}
.flow-prompt-item.active{border-color:var(--cd-primary);background:#ecfdf5;}
.flow-prompt-item.done{border-color:#a7f3d0;background:#f0fdf4;opacity:.7;}
.flow-prompt-item.error{border-color:#fecaca;background:#fef2f2;}
.flow-prompt-item.retrying{border-color:#fde68a;background:#fffbeb;}
.flow-video-placeholder{text-align:center;padding:40px 20px;}
.flow-video-placeholder .icon{font-size:48px;margin-bottom:12px;}
.flow-video-placeholder h3{font-size:16px;font-weight:600;color:var(--cd-text);margin:0 0 8px;}
.flow-video-placeholder p{font-size:13px;color:var(--cd-text-muted);margin:0;line-height:1.5;}
.flow-footer{padding:12px 20px;border-top:1px solid var(--cd-border-light);text-align:center;font-size:11px;color:var(--cd-text-light);flex-shrink:0;}
.flow-footer a{color:var(--cd-primary);text-decoration:none;font-weight:600;}
.flow-logout-link{display:block;text-align:center;font-size:11px;color:var(--cd-text-light);margin-top:16px;cursor:pointer;text-decoration:underline;padding:4px;}
#flow-mini{position:fixed;bottom:16px;right:16px;z-index:10002;background:var(--cd-bg);border:1px solid var(--cd-border);border-radius:var(--cd-radius-sm);padding:14px 18px;display:none;flex-direction:column;gap:8px;cursor:pointer;box-shadow:var(--cd-shadow);min-width:280px;font-family:'Inter','Segoe UI',system-ui,sans-serif;}
.flow-mini-header{display:flex;align-items:center;gap:10px;}
.flow-mini-icon{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.flow-mini-icon svg{width:16px;height:16px;}
.flow-mini-title{font-size:13px;font-weight:700;color:var(--cd-text);flex:1;}
.flow-mini-close{background:none;border:none;cursor:pointer;padding:4px;color:var(--cd-text-muted);transition:color .2s;flex-shrink:0;}
.flow-mini-close:hover{color:#ef4444;}
.flow-mini-close svg{width:14px;height:14px;}
.flow-mini-status{font-size:12px;font-weight:600;color:var(--cd-primary);}
.flow-mini-sub{font-size:11px;color:var(--cd-text-muted);}
.flow-mini-details{font-size:11px;color:var(--cd-text-muted);display:flex;gap:12px;}
.flow-mini-progress{height:4px;background:var(--cd-border-light);border-radius:4px;}
.flow-mini-progress-bar{height:100%;background:linear-gradient(90deg,var(--cd-primary),var(--cd-primary-light));border-radius:4px;transition:width .4s;width:0%;}
#flow-popup-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);z-index:10003;}
#flow-popup{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10004;background:var(--cd-bg);border-radius:var(--cd-radius);padding:32px;box-shadow:var(--cd-shadow);text-align:center;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;}
#flow-popup h3{font-size:20px;margin:0 0 8px;color:var(--cd-text);}
#flow-popup p{font-size:14px;color:var(--cd-text-muted);margin:0 0 20px;}
#flow-popup .failed-list{text-align:left;background:var(--cd-bg-secondary);border:1px solid var(--cd-border);border-radius:var(--cd-radius-xs);padding:12px;margin:0 0 16px;font-size:12px;max-height:150px;overflow-y:auto;}
#flow-popup .failed-list div{padding:4px 0;color:var(--cd-text);border-bottom:1px solid var(--cd-border-light);}
#flow-popup .failed-list div:last-child{border:none;}
.flow-promo{display:block;margin-top:16px;padding:14px;background:linear-gradient(135deg,#ecfdf5,#f0fdf4);border:1px solid #a7f3d0;border-radius:var(--cd-radius-xs);text-decoration:none;transition:transform .2s;}
.flow-promo:hover{transform:scale(1.02);box-shadow:0 4px 12px rgba(16,185,129,.15);}
.flow-promo p{color:var(--cd-text);font-size:12px;margin:0;line-height:1.5;}
.flow-promo strong{color:var(--cd-primary-dark);}
/* ========== ASSIGNMENT PANEL (horizontal top bar) ========== */
#flow-assign-panel{display:none;position:fixed;top:12px;left:84px;right:456px;z-index:10005;background:var(--cd-bg);border-radius:var(--cd-radius);box-shadow:0 10px 40px -10px rgba(0,0,0,.2);border:1px solid var(--cd-border);font-family:'Inter','Segoe UI',system-ui,sans-serif;overflow:hidden;flex-direction:column;transition:all .3s;}
#flow-assign-panel.active{display:flex;}
#flow-assign-panel.panel-closed{right:12px;}
#flow-assign-panel.minimized .flow-assign-items,#flow-assign-panel.minimized .flow-assign-reload-bar,#flow-assign-panel.minimized .flow-assign-prompt-preview{display:none;}
.flow-assign-dl-btn{display:none;padding:5px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:6px;cursor:pointer;transition:all .2s;white-space:nowrap;}
.flow-assign-dl-btn:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.35);transform:translateY(-1px);}
.flow-assign-dl-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.flow-assign-reload-bar{display:none;}
.flow-assign-header{padding:10px 16px;border-bottom:1px solid var(--cd-border-light);display:flex;align-items:center;gap:12px;flex-shrink:0;}
.flow-assign-header h3{font-size:13px;font-weight:700;color:var(--cd-text);margin:0;white-space:nowrap;}
.flow-assign-count{font-size:11px;color:var(--cd-text-muted);font-weight:500;white-space:nowrap;}
.flow-assign-items{padding:8px 12px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:6px;max-height:130px;}
.flow-assign-items::-webkit-scrollbar{width:4px;}
.flow-assign-items::-webkit-scrollbar-thumb{background:var(--cd-border);border-radius:4px;}
.flow-assign-item{display:flex;align-items:center;gap:6px;padding:6px 12px;border:2px solid var(--cd-border);border-radius:9999px;cursor:grab;font-size:12px;font-weight:500;color:var(--cd-text);transition:border-color .15s,background .15s;background:var(--cd-bg);white-space:nowrap;flex-shrink:0;position:relative;box-sizing:border-box;}
.flow-assign-item:hover{border-color:var(--cd-primary);background:rgba(16,185,129,.04);}
.flow-assign-item:active{cursor:grabbing;}
.flow-assign-item .drag-icon{color:var(--cd-text-light);font-size:14px;flex-shrink:0;}
.flow-assign-item .assign-name{white-space:nowrap;}
.flow-assign-item .assign-status{font-size:12px;flex-shrink:0;}
.flow-assign-item.assigned{background:#ecfdf5;border-color:#a7f3d0;opacity:.65;}
.flow-assign-item.assigned .assign-name{text-decoration:line-through;color:var(--cd-text-muted);}
/* ADD-ON Auto-Enumerador: conclusão (verde) e faltante (apagado) */
.flow-assign-item.complete{background:#dcfce7;border-color:#4ade80;opacity:1;}
.flow-assign-item.complete .assign-name{color:#166534;font-weight:600;text-decoration:none;}
.flow-assign-item.missing{opacity:.5;border-style:dashed;}
#flow-assign-auto{font-weight:700;color:var(--cd-primary);}
#flow-assign-auto:hover{color:var(--cd-primary-dark);background:var(--cd-bg-secondary);}
.flow-assign-prompt-preview{padding:0 16px 10px;font-size:11px;color:var(--cd-text-muted);line-height:1.5;min-height:20px;border-top:1px solid var(--cd-border-light);margin-top:4px;flex-shrink:0;overflow:hidden;}
.flow-assign-prompt-preview .preview-label{font-weight:600;color:var(--cd-primary);margin-right:4px;}
.flow-assign-prompt-preview .preview-text{color:var(--cd-text-muted);}
.flow-assign-header-btns{display:flex;align-items:center;gap:4px;margin-left:auto;flex-shrink:0;}
.flow-assign-hbtn{background:none;border:none;cursor:pointer;padding:3px;color:var(--cd-text-muted);font-size:14px;line-height:1;transition:all .2s;border-radius:4px;}
.flow-assign-hbtn:hover{color:var(--cd-text);background:var(--cd-bg-secondary);}
.flow-assign-hbtn.close-btn:hover{color:#ef4444;background:#fef2f2;}
.flow-assign-dl-btn{display:none;padding:5px 14px;font-size:12px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:6px;cursor:pointer;transition:all .2s;white-space:nowrap;}
.flow-assign-dl-btn:hover:not(:disabled){box-shadow:0 4px 12px rgba(16,185,129,.35);transform:translateY(-1px);}
.flow-assign-dl-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.flow-assign-reload-bar{display:none;padding:10px 16px;text-align:center;border-top:1px solid var(--cd-border-light);flex-shrink:0;}
.flow-assign-reload-bar.visible{display:block;}
.flow-assign-reload-bar button{padding:8px 24px;font-size:13px;font-weight:700;background:linear-gradient(135deg,var(--cd-primary),var(--cd-primary-dark));color:#fff;border:none;border-radius:var(--cd-radius-xs);cursor:pointer;animation:pulse-glow 1.5s ease-in-out infinite;transition:all .2s;}
.flow-assign-reload-bar button:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(16,185,129,.4);}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 4px rgba(16,185,129,.3);}50%{box-shadow:0 0 16px rgba(16,185,129,.6);}}
/* ========== ASSIGNMENT PANEL: VERTICAL MODE ========== */
#flow-assign-panel.vertical{top:12px;left:auto;right:12px;bottom:12px;width:220px;max-height:none;}
#flow-assign-panel.vertical .flow-assign-header{flex-wrap:wrap;gap:6px;padding:8px 10px;}
#flow-assign-panel.vertical .flow-assign-header h3{font-size:12px;}
#flow-assign-panel.vertical .flow-assign-items{flex-direction:column;flex-wrap:nowrap;max-height:none;flex:1;overflow-y:auto;padding:6px 8px;gap:4px;}
#flow-assign-panel.vertical .flow-assign-item{white-space:nowrap;font-size:11px;padding:5px 10px;}
#flow-assign-panel.vertical .flow-assign-header-btns{gap:2px;}
#flow-assign-panel.vertical .flow-assign-dl-btn{font-size:10px;padding:4px 8px;}
#flow-assign-panel.vertical .flow-assign-prompt-preview{font-size:10px;padding:0 8px 6px;}
#flow-assign-panel.vertical.panel-closed{right:12px;}
/* ========== TILE LABELS ========== */
.flow-tile-label{position:absolute;top:8px;left:8px;z-index:10;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.8);color:#fff;font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;backdrop-filter:blur(4px);pointer-events:auto;max-width:calc(100% - 24px);}
.flow-tile-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.flow-tile-label .label-x{background:none;border:none;color:rgba(255,255,255,.6);cursor:pointer;font-size:14px;padding:0 2px;line-height:1;transition:color .2s;flex-shrink:0;}
.flow-tile-label .label-x:hover{color:#f87171;}
/* ========== DROP FEEDBACK ========== */
[data-tile-id].drop-hover{outline:3px solid var(--cd-primary)!important;outline-offset:-3px;border-radius:8px;}
`;
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ============================================================
    // HTML
    // ============================================================
    document.body.insertAdjacentHTML('beforeend', `
<button id="flow-sidebar"><span class="icon">Criadores Dark</span></button>
<div id="flow-panel">
  <div class="flow-header">
    <div class="flow-header-left">
      <div class="flow-logo">
        <svg viewBox="0 0 24 24">
          <defs><linearGradient id="flowPlayGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#10b981"/><stop offset="100%" style="stop-color:#059669"/></linearGradient></defs>
          <polygon points="8,6 20,12 8,18" fill="none" stroke="url(#flowPlayGrad)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <div class="flow-header-title">Criadores Dark - Vinícius Linhares</div>
        <div class="flow-header-subtitle">Flow Voz</div>
      </div>
    </div>
    <button class="flow-close-btn" id="flow-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div class="flow-tabs">
    <button class="flow-tab active" data-tab="images">🖼️ Imagens</button>
    <button class="flow-tab" data-tab="videos">🎬 Vídeos</button>
  </div>
  <div class="flow-scroll">
    <div class="flow-tab-content active" data-tab="images">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Prompts de imagem</h3>
            <p class="flow-card-description">Um prompt por linha. Use <strong>[nome]</strong> para referências do projeto.</p>
          </div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="flow-prompts-input" placeholder="Ex:&#10;Imagem de [Maria] sentada na [Sala]&#10;[João] caminhando no [Parque]"></textarea>
            <input type="number" id="flow-start-from" class="flow-select-imgs" style="margin-top:8px;width:100%;box-sizing:border-box;" placeholder="Retomar de (Cena X). Ex: 20 (Use 0 para pular)">
            <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;font-size:12px;">
              <span style="color:var(--cd-text-muted);">Separar prompts por:</span>
              <select id="flow-sep-modo" class="flow-select-imgs" style="width:auto;padding:4px 6px;">
                <option value="linha">Cada linha</option>
                <option value="vazia">Linha em branco</option>
                <option value="custom">Caractere...</option>
              </select>
              <input type="text" id="flow-sep-texto" class="flow-select-imgs" style="width:70px;padding:4px 6px;display:none;" value="---" placeholder="---">
            </div>
            <div id="flow-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Referências detectadas</h3>
            <p class="flow-card-description">Valide as referências [nome] antes de iniciar.</p>
          </div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="flow-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência detectada.</span></div>
<button class="flow-validate-btn" id="flow-validate-btn">🔍 Validar referências na galeria</button>
<button class="flow-validate-btn" id="flow-mark-refs-valid-btn" style="margin-top:6px;">✅ Referências já validadas</button>
<button class="flow-validate-btn" id="flow-clear-refs-btn" style="margin-top:6px;">🧽 Limpar referências validadas</button>
<button class="flow-validate-btn" id="flow-fix-upload-refs-btn" style="margin-top:6px;">🧹 Corrigir uploads para referências</button>
<button class="flow-validate-btn" id="flow-auto-enumerate-btn" style="margin-top:6px;font-weight:700;">⚡ Enumerar cenas automático (renomear "Cena N")</button>
<div id="flow-auto-results" style="display:none;margin-top:8px;border:1px solid var(--cd-border-light);border-radius:8px;padding:8px;background:var(--cd-bg-secondary,#f8fafc);">
  <div id="flow-auto-results-head" style="font-size:12px;font-weight:700;color:var(--cd-primary);margin-bottom:6px;">Concluídas: 0</div>
  <div id="flow-auto-results-list" style="max-height:170px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;"></div>
</div>
<button class="flow-validate-btn" id="flow-assign-refs-btn" style="display:none;margin-top:6px;">📌 Atribuir referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-title">Modo de geração</div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-mode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-mode="refs">🖼️ Referências</button>
                <button class="flow-mode-btn" data-mode="scenes">🎬 Cenas</button>
              </div>
              <div id="flow-mode-desc" style="font-size:11px;color:var(--cd-text-light);line-height:1.4;min-height:16px;">Gera imagens sem atribuir nomes. Ideal para testes rápidos.</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Prompts simultâneos</div>
                <div class="flow-option-desc">Prompts enviados por lote. Flow gera todos em paralelo.</div>
              </div>
              <div class="flow-batch-btns">
                <button class="flow-batch-btn" data-batch="1">1</button>
                <button class="flow-batch-btn" data-batch="2">2</button>
                <button class="flow-batch-btn" data-batch="3">3</button>
                <button class="flow-batch-btn active" data-batch="4">4</button>
                <button class="flow-batch-btn" data-batch="5">5</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Imagens por prompt</div>
                <div class="flow-option-desc">Quantas imagens o Flow gera por envio.</div>
              </div>
              <select id="flow-imgs-per-prompt" class="flow-select-imgs">
                <option value="1">1 imagem</option>
                <option value="2">2 imagens</option>
                <option value="3" selected>3 imagens</option>
                <option value="4">4 imagens</option>
              </select>
              <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
  <div class="flow-option-text">
    <div class="flow-option-title">Tentativas ao falhar</div>
    <div class="flow-option-desc">Quantas vezes tentar novamente o prompt se a geração falhar. 0 desativa a regeração.</div>
  </div>
  <select id="flow-max-retries" class="flow-select-imgs">
    <option value="0" selected>0 tentativa</option>
    <option value="1">1 tentativa</option>
    <option value="2">2 tentativas</option>
    <option value="3">3 tentativas</option>
    <option value="4">4 tentativas</option>
    <option value="5">5 tentativas</option>
  </select>
</div>
            </div>
            <div id="flow-grid-info" style="font-size:11px;color:var(--cd-text-light);margin-top:4px;font-style:italic;"></div>
           <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
  <input type="checkbox" id="flow-auto-name-scenes">
  <div class="flow-option-text">
    <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Nomear imagens automaticamente</div>
    <div class="flow-option-desc">No modo Cenas, renomeia como Cena X - Imagem Y.</div>
  </div>
</label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Quando enumerar</div>
                <div class="flow-option-desc">Enumera ao final de tudo ou após cada bloco de prompts.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-enum="end">📋 No final</button>
                <button class="flow-mode-btn" data-enum="block">🏷️ Por bloco</button>
              </div>
            </div>
            <label class="flow-option" style="margin-top:4px;">
              <input type="checkbox" id="flow-approve-enum">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Aprovar antes de enumerar</div>
                <div class="flow-option-desc">Pausa após cada bloco e pede aprovação antes de nomear.</div>
              </div>
            </label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Velocidade</div>
                <div class="flow-option-desc">Ajusta o tempo entre ações. Rápido = menos espera.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn" data-speed="slow">🐢 Lento</button>
                <button class="flow-mode-btn active" data-speed="normal">🔄 Normal</button>
                <button class="flow-mode-btn" data-speed="fast">⚡ Rápido</button>
              </div>
              <div id="flow-speed-info" style="font-size:11px;color:var(--cd-text-light);">Velocidade: Normal (1.0×)</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">⏱️ Tempos</div>
                <div class="flow-option-desc">Os botões acima preenchem estes valores. Você pode ajustar à mão. Vale para imagens e vídeos.</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:6px 8px;width:100%;align-items:center;font-size:12px;">
                <label for="flow-t-lotes"><b>Pausa entre lotes (seg)</b><br><span style="color:var(--cd-text-light);font-size:11px;">Descanso após um lote terminar</span></label>
                <input type="number" id="flow-t-lotes" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0" max="60" step="0.5" value="2">
                <label for="flow-t-poll">Checar a cada (seg)</label>
                <input type="number" id="flow-t-poll" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0.3" max="10" step="0.1" value="1">
                <label for="flow-t-estab">Confirmar por (seg)</label>
                <input type="number" id="flow-t-estab" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0" max="60" step="0.5" value="2.5">
                <label for="flow-t-semprog">Desistir sem progresso (min)</label>
                <input type="number" id="flow-t-semprog" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0.5" max="30" step="0.5" value="3">
              </div>
              <button class="flow-validate-btn" id="flow-t-reset" style="margin-top:2px;">↩️ Restaurar padrão</button>
              <div id="flow-t-info" style="font-size:11px;color:var(--cd-text-light);"></div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-defer-retry">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Retentar falhas no final</div>
                <div class="flow-option-desc">Em vez de parar para retentar, guarda os que falharam e retenta tudo no final.</div>
              </div>
            </label>

            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-use-backspace">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Modo alternativo (Backspace 3x)</div>
                <div class="flow-option-desc">Apaga a ref para evitar erros.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="flow-show-logs">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div>
              </div>
            </label>
          </div>
        </div>
        <div class="flow-actions">
          <button id="flow-start-btn" class="flow-btn flow-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg> Iniciar</button>
          <button id="flow-stop-btn" class="flow-btn flow-btn-secondary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> Parar</button>
        </div>
        <div id="flow-status" class="flow-status"></div>
        <div class="flow-progress"><div id="flow-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="flow-prompts-preview-card" style="display:none;">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Fila de prompts</h3>
            <p class="flow-card-description" id="flow-queue-info"></p>
          </div>
          <div class="flow-card-content">
            <div class="flow-prompt-list" id="flow-prompt-list"></div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Analisar Projeto</h3>
            <p class="flow-card-description">Escaneia o projeto para mostrar labels em imagens já atribuídas.</p>
          </div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="flow-analyze-btn">🔍 Analisar projeto existente</button>
            <button class="flow-validate-btn" id="flow-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel de atribuição</button>
            <div id="flow-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;color:var(--cd-text);margin-bottom:8px;">⬇️ Baixar Imagens do Projeto</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="flow-dl-identified" style="margin:0;">📋 Todas as Identificadas</button>
                <button class="flow-validate-btn" id="flow-dl-scenes" style="margin:0;">🎬 Apenas Cenas</button>
                <button class="flow-validate-btn" id="flow-dl-refs" style="margin:0;">🖼️ Apenas Referências</button>
                <button class="flow-validate-btn" id="flow-dl-all" style="margin:0;">📦 Completo (Todas as Geradas)</button>
              </div>
            </div>
          </div>
        </div>
        <div id="flow-logs-container" class="flow-logs-container"><div id="flow-debug-panel" class="flow-debug-panel"></div></div>
        <a id="flow-logout-link" class="flow-logout-link">Sair da conta</a>
      </div>
    </div>
    <div class="flow-tab-content" data-tab="videos">
      <div class="flow-tab-body">
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Prompts de vídeo</h3>
            <p class="flow-card-description">Um prompt por linha. Use <strong>{cena X}</strong> para numerar cenas, <strong>[nome]</strong> para referências e <strong>&lt;voz: Nome&gt;</strong> para vozes.</p>
          </div>
          <div class="flow-card-content">
            <textarea class="flow-textarea" id="fv-prompts-input" placeholder="Ex:&#10;{cena 10} [Maria] caminhando no [Parque] com vento forte &lt;voz: Algebra&gt;&#10;{cena 13} Close-up de [João] olhando para o horizonte&#10;&#10;Ou sem numeração:&#10;Paisagem noturna com lua cheia&#10;Carro andando na estrada"></textarea>
            <input type="number" id="fv-start-from" class="flow-select-imgs" style="margin-top:8px;width:100%;box-sizing:border-box;" placeholder="Retomar de (Cena X). Ex: 20 (Use 0 para pular)">
            <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;font-size:12px;">
              <span style="color:var(--cd-text-muted);">Separar prompts por:</span>
              <select id="fv-sep-modo" class="flow-select-imgs" style="width:auto;padding:4px 6px;">
                <option value="linha">Cada linha</option>
                <option value="vazia">Linha em branco</option>
                <option value="custom">Caractere...</option>
              </select>
              <input type="text" id="fv-sep-texto" class="flow-select-imgs" style="width:70px;padding:4px 6px;display:none;" value="---" placeholder="---">
            </div>
            <div id="fv-prompt-count" style="font-size:11px;color:var(--cd-text-light);margin-top:6px;">0 prompts detectados</div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Referências detectadas</h3>
            <p class="flow-card-description">Valide as referências [nome] antes de iniciar.</p>
          </div>
          <div class="flow-card-content">
            <div class="flow-ref-list" id="fv-ref-list"><span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência ou voz detectada.</span></div>
           <button class="flow-validate-btn" id="fv-validate-btn">🔍 Validar referências na galeria</button>
<button class="flow-validate-btn" id="fv-mark-refs-valid-btn" style="margin-top:6px;">✅ Referências já validadas</button>
<button class="flow-validate-btn" id="fv-clear-refs-btn" style="margin-top:6px;">🧽 Limpar referências validadas</button>
<button class="flow-validate-btn" id="fv-assign-refs-btn" style="display:none;margin-top:6px;">📌 Atribuir referências</button>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header"><h3 class="flow-card-title">Opções</h3></div>
          <div class="flow-card-content">
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-title">Modo de geração</div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-vmode="free">🎯 Livre</button>
                <button class="flow-mode-btn" data-vmode="scenes">🎬 Cenas</button>
                <button class="flow-mode-btn" data-vmode="voice">🎙️ Vozes</button>
              </div>
              <div id="fv-mode-desc" style="font-size:11px;color:var(--cd-text-light);line-height:1.4;min-height:16px;">Gera vídeos sem atribuir nomes. Ideal para testes rápidos.</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Prompts simultâneos</div>
                <div class="flow-option-desc">Prompts enviados por lote.</div>
              </div>
              <div class="flow-batch-btns">
                <button class="flow-batch-btn" data-vbatch="1">1</button>
                <button class="flow-batch-btn" data-vbatch="2">2</button>
                <button class="flow-batch-btn" data-vbatch="3">3</button>
                <button class="flow-batch-btn active" data-vbatch="4">4</button>
              </div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
              <div class="flow-option-text">
                <div class="flow-option-title">Resultados por prompt</div>
                <div class="flow-option-desc">Quantos vídeos o Flow gera por envio.</div>
              </div>
              <select id="fv-results-per-prompt" class="flow-select-imgs">
                <option value="1">1 vídeo</option>
                <option value="2">2 vídeos</option>
                <option value="3" selected>3 vídeos</option>
                <option value="4">4 vídeos</option>
              </select>
              <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;">
  <div class="flow-option-text">
    <div class="flow-option-title">Tentativas ao falhar</div>
    <div class="flow-option-desc">Quantas vezes tentar novamente o prompt se a geração falhar. 0 desativa a regeração.</div>
  </div>
  <select id="fv-max-retries" class="flow-select-imgs">
    <option value="0" selected>0 tentativa</option>
    <option value="1">1 tentativa</option>
    <option value="2">2 tentativas</option>
    <option value="3">3 tentativas</option>
    <option value="4">4 tentativas</option>
    <option value="5">5 tentativas</option>
  </select>
</div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
  <input type="checkbox" id="fv-auto-name-scenes">
  <div class="flow-option-text">
    <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Nomear vídeos automaticamente</div>
    <div class="flow-option-desc">No modo Cenas, renomeia como Cena X - Vídeo Y.</div>
  </div>
</label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Quando enumerar</div>
                <div class="flow-option-desc">Enumera ao final de tudo ou após cada bloco de prompts.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn active" data-enum="end">📋 No final</button>
                <button class="flow-mode-btn" data-enum="block">🏷️ Por bloco</button>
              </div>
            </div>
            <label class="flow-option" style="margin-top:4px;">
              <input type="checkbox" id="fv-approve-enum">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Aprovar antes de enumerar</div>
                <div class="flow-option-desc">Pausa após cada bloco e pede aprovação antes de nomear.</div>
              </div>
            </label>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">Velocidade</div>
                <div class="flow-option-desc">Ajusta o tempo entre ações. Rápido = menos espera.</div>
              </div>
              <div class="flow-mode-btns">
                <button class="flow-mode-btn" data-speed="slow">🐢 Lento</button>
                <button class="flow-mode-btn active" data-speed="normal">🔄 Normal</button>
                <button class="flow-mode-btn" data-speed="fast">⚡ Rápido</button>
              </div>
              <div id="fv-speed-info" style="font-size:11px;color:var(--cd-text-light);">Velocidade: Normal (1.0×)</div>
            </div>
            <div class="flow-option" style="flex-direction:column;align-items:flex-start;gap:8px;cursor:default;margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div class="flow-option-text">
                <div class="flow-option-title">⏱️ Tempos</div>
                <div class="flow-option-desc">Os botões acima preenchem estes valores. Você pode ajustar à mão. Vale para imagens e vídeos.</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr auto;gap:6px 8px;width:100%;align-items:center;font-size:12px;">
                <label for="fv-t-lotes"><b>Pausa entre lotes (seg)</b><br><span style="color:var(--cd-text-light);font-size:11px;">Descanso após um lote terminar</span></label>
                <input type="number" id="fv-t-lotes" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0" max="60" step="0.5" value="2">
                <label for="fv-t-poll">Checar a cada (seg)</label>
                <input type="number" id="fv-t-poll" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0.3" max="10" step="0.1" value="1">
                <label for="fv-t-estab">Confirmar por (seg)</label>
                <input type="number" id="fv-t-estab" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0" max="60" step="0.5" value="2.5">
                <label for="fv-t-semprog">Desistir sem progresso (min)</label>
                <input type="number" id="fv-t-semprog" class="flow-select-imgs" style="width:82px;padding:4px 6px;" min="0.5" max="30" step="0.5" value="3">
              </div>
              <button class="flow-validate-btn" id="fv-t-reset" style="margin-top:2px;">↩️ Restaurar padrão</button>
              <div id="fv-t-info" style="font-size:11px;color:var(--cd-text-light);"></div>
            </div>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-defer-retry">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Retentar falhas no final</div>
                <div class="flow-option-desc">Em vez de parar para retentar, guarda os que falharam e retenta tudo no final.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-use-backspace">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Modo alternativo (Backspace 3x)</div>
                <div class="flow-option-desc">Apaga a ref para evitar erros.</div>
              </div>
            </label>
            <label class="flow-option" style="margin-top:4px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <input type="checkbox" id="fv-show-logs">
              <div class="flow-option-text">
                <div class="flow-option-title" style="color:var(--cd-text-muted);font-size:12px;">Mostrar logs</div>
              </div>
            </label>
          </div>
        </div>
        <div class="flow-actions">
          <button id="fv-start-btn" class="flow-btn flow-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg> Iniciar</button>
          <button id="fv-stop-btn" class="flow-btn flow-btn-secondary" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg> Parar</button>
        </div>
        <div id="fv-status" class="flow-status"></div>
        <div class="flow-progress"><div id="fv-progress-bar" class="flow-progress-bar"></div></div>
        <div class="flow-card" id="fv-prompts-preview-card" style="display:none;">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Fila de prompts</h3>
            <p class="flow-card-description" id="fv-queue-info"></p>
          </div>
          <div class="flow-card-content">
            <div class="flow-prompt-list" id="fv-prompt-list"></div>
          </div>
        </div>
        <div class="flow-card">
          <div class="flow-card-header">
            <h3 class="flow-card-title">Analisar Projeto (Vídeos)</h3>
            <p class="flow-card-description">Escaneia o projeto para mostrar labels de vídeos já atribuídos.</p>
          </div>
          <div class="flow-card-content">
            <button class="flow-validate-btn" id="fv-analyze-btn">🔍 Analisar projeto existente</button>
            <button class="flow-validate-btn" id="fv-reopen-assign" style="display:none;margin-top:6px;">📋 Reabrir painel de atribuição</button>
            <div id="fv-download-section" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--cd-border-light);">
              <div style="font-size:12px;font-weight:600;color:var(--cd-text);margin-bottom:8px;">⬇️ Baixar do Projeto</div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                <button class="flow-validate-btn" id="fv-dl-identified" style="margin:0;">📋 Todas as Identificadas</button>
                <button class="flow-validate-btn" id="fv-dl-scenes" style="margin:0;">🎬 Apenas Cenas</button>
                <button class="flow-validate-btn" id="fv-dl-all" style="margin:0;">📦 Completo (Todas as Geradas)</button>
                <button class="flow-validate-btn" id="fv-upscale-btn" style="margin:0; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:#fff; border:none; margin-top: 6px;">🚀 Upscale 1080p (Vídeos Identificados)</button>
                <button class="flow-validate-btn" id="fv-upscale-stop-btn" style="margin:0; margin-top:6px; display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca;">⏹ Parar Upscale</button>
                <button class="flow-validate-btn" id="fv-upscale-retry-btn" style="margin:0; margin-top:6px; display:none; background:linear-gradient(135deg, #f59e0b, #d97706); color:#fff; border:none;">🔄 Retentar Falhas do Upscale</button>
             
              <button class="flow-validate-btn" id="fv-upscale-debug-btn" style="margin:0; margin-top:6px;">
  🔎 Diagnosticar vídeos do upscale
</button>
              </div>
            </div>
          </div>
        </div>
        <div id="fv-logs-container" class="flow-logs-container"><div id="fv-debug-panel" class="flow-debug-panel"></div></div>
      </div>
    </div>
  </div>
  <footer class="flow-footer">Feito por <a href="https://www.youtube.com/@ViníciusLinharesCANALDARK" target="_blank">Criadores Dark - Vinícius Linhares</a></footer>
</div>
<div id="flow-mini">
  <div class="flow-mini-header">
    <div class="flow-mini-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="8,6 20,12 8,18"/></svg></div>
    <div class="flow-mini-title">Criadores Dark</div>
    <button id="flow-mini-close" class="flow-mini-close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
  </div>
  <div id="flow-mini-status" class="flow-mini-status">Processando...</div>
  <div id="flow-mini-sub" class="flow-mini-sub"></div>
  <div id="flow-mini-details" class="flow-mini-details"></div>
  <div class="flow-mini-progress"><div id="flow-mini-progress-bar" class="flow-mini-progress-bar"></div></div>
</div>
<div id="flow-popup-overlay"></div>
<div id="flow-popup">
  <h3>✅ Automação Concluída!</h3>
  <p id="flow-popup-msg">Todos os prompts foram processados!</p>
  <div id="flow-popup-failed" class="failed-list" style="display:none;"></div>
  <div style="display:flex;gap:8px;">
    <button id="flow-popup-download" class="flow-btn flow-btn-primary" style="flex:1;display:none;">⬇️ Baixar Geradas</button>
    <button id="flow-close-popup" class="flow-btn flow-btn-secondary" style="flex:1;">Fechar</button>
  </div>
  <a href="https://darktube-mentor.lovable.app/curso" target="_blank" class="flow-promo">
    <p>Conheça nosso Curso sobre <strong>CANAIS DARK</strong> e tenha acesso a várias outras ferramentas</p>
  </a>
</div>
<div id="flow-assign-panel">
  <div class="flow-assign-header">
    <h3 id="flow-assign-title">Atribuir</h3>
    <span class="flow-assign-count" id="flow-assign-count"></span>
    <div class="flow-assign-header-btns">
      <button class="flow-assign-dl-btn" id="flow-assign-download" style="display:none;">⬇️ Baixar Cenas</button>
      <button class="flow-assign-hbtn" id="flow-assign-auto" title="Enumerar automático: renomeia cada imagem gerada pelo início do prompt">⚡ Auto</button>
      <button class="flow-assign-hbtn" id="flow-assign-layout" title="Alternar Horizontal/Vertical">↔</button>
      <button class="flow-assign-hbtn" id="flow-assign-toggle" title="Minimizar">▲</button>
      <button class="flow-assign-hbtn close-btn" id="flow-assign-close" title="Fechar">✕</button>
    </div>
  </div>
  <div class="flow-assign-items" id="flow-assign-items"></div>
  <div class="flow-assign-prompt-preview" id="flow-assign-preview" style="display:none;"><span class="preview-label"></span><span class="preview-text"></span></div>
  <div class="flow-assign-reload-bar" id="flow-assign-reload-bar"><button id="flow-assign-reload">🔄 Atualizar Página</button></div>
</div>
`);

    // ============================================================
    // CLASSE PRINCIPAL
    // ============================================================
    class FlowAutomation {

        constructor() {
            this.isRunning       = false;
            this.shouldStop      = false;
            this.prompts         = [];
            this.validatedRefs   = this.loadValidatedRefs();
            this.batchSize       = 4;
            this.imagesPerPrompt = 3;
            this.maxPromptRetries = CONFIG.MAX_RETRIES;
            this.gridCols        = 3;
            this.rowHeight       = 347;
            // Modo: 'free' | 'refs' | 'scenes'
            this.genMode         = 'free';
            // Reference mode
            this.refNames        = [];
            this.refAssignments  = new Map(); // name → workflowId
            // Scene mode
            this.sceneCount      = 0;
            this.sceneAssignments = new Map(); // 'Cena X' → [{ imgNum, workflowId }]
            // Tile tracking
            this.tileAssignments = new Map(); // workflowId → { label, type }
            // ── Video state ──
            this.videoIsRunning       = false;
            this.videoShouldStop      = false;
            this.videoPrompts         = [];
            this.videoGenMode         = 'free'; // 'free' | 'scenes' | 'voice'
            this.videoBatchSize       = 4;
            this.videoResultsPerPrompt = 3;
            this.videoMaxPromptRetries = CONFIG.MAX_RETRIES;
            this.videoSceneCount      = 0;
            this.videoSceneAssignments = new Map(); // 'Cena X' → [{ imgNum, workflowId }]
            // ── Speed + Enum config ──
            this.speedMultiplier  = 1.0;   // 0.7 / 1.0 / 1.5
            this.enumMode         = 'end'; // 'end' | 'block'
            this.approveBeforeEnum = false;
            this._blockApprovalResolve = null; // para pausar no approve
            this.deferRetry = false; // retentar no final em vez de imediatamente
            this.initUI();
            this.setupTextWatcher();
            this.setupVideoTextWatcher();
            this.setupDragDrop();
            log.success('Flow Automation 4.2 — compatibilidade setembro/2026 inicializada!');
            if (!location.hostname.endsWith('flow.google.com') && !_authToken) log.warn('Token ainda não capturado — faça qualquer ação na página.');

            // Verifica se há estado salvo de crash anterior
            this.checkCrashRecovery();
        }

        // ──────────────────────────────────────────────
        // UI INIT
        // ──────────────────────────────────────────────

        initUI() {
            const $ = id => document.getElementById(id);
            const sidebar = $('flow-sidebar'), panel = $('flow-panel'), close = $('flow-close');
            const mini = $('flow-mini'), miniClose = $('flow-mini-close');

            sidebar.addEventListener('click', () => {
                panel.classList.add('active');
                sidebar.style.display = 'none';
                mini.style.display = 'none';
                document.getElementById('flow-assign-panel').classList.remove('panel-closed');
            });
           close.addEventListener('click', () => {
    panel.classList.remove('active');
    document.getElementById('flow-assign-panel').classList.add('panel-closed');
    sidebar.style.display = '';

    if (this.isRunning || this.videoIsRunning) {
        mini.style.display = 'flex';
    } else {
        mini.style.display = 'none';
    }
});
            mini.addEventListener('click', e => {
                if (e.target.closest('#flow-mini-close')) return;
                panel.classList.add('active');
                mini.style.display = 'none';
                sidebar.style.display = 'none';
                document.getElementById('flow-assign-panel').classList.remove('panel-closed');
            });
            miniClose.addEventListener('click', () => { mini.style.display = 'none'; sidebar.style.display = ''; });

            document.querySelectorAll('.flow-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.flow-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.flow-tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    document.querySelector(`.flow-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
                });
            });

            // Mode selector
            const modeDescs = {
                free: 'Gera imagens sem atribuir nomes. Ideal para testes rápidos.',
                refs: 'Primeira linha: [Nome1][Nome2]... Após gerar, arraste cada referência para a imagem desejada.',
                scenes: 'Cada prompt = uma cena. Após gerar, arraste as cenas para as melhores imagens e baixe.'
            };
            document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.genMode = btn.dataset.mode;
                    const descEl = document.getElementById('flow-mode-desc');
                    if (descEl) descEl.textContent = modeDescs[this.genMode] || '';
                    this.logDebug(`Modo: ${this.genMode}`, 'info');
                });
            });

            $('flow-validate-btn').addEventListener('click', () => this.validateReferences());
$('flow-mark-refs-valid-btn').addEventListener('click', () => this.markReferencesAsValidated('images'));
            const clearImageRefsBtn = $('flow-clear-refs-btn');
if (clearImageRefsBtn) {
    clearImageRefsBtn.addEventListener('click', () => this.clearReferencesForUI('images'));
}

const fixUploadRefsBtn = $('flow-fix-upload-refs-btn');
if (fixUploadRefsBtn) {
    fixUploadRefsBtn.addEventListener('click', () => this.renameUploadReferencesFromFilenames());
}
            $('flow-show-logs').addEventListener('change', e => $('flow-logs-container').classList.toggle('visible', e.target.checked));
            $('flow-start-btn').addEventListener('click', () => { startKeepAlive(); this.start(); });
            $('flow-stop-btn').addEventListener('click',  () => this.stop());
            $('flow-close-popup').addEventListener('click', () => { $('flow-popup').style.display='none'; $('flow-popup-overlay').style.display='none'; });
            $('flow-popup-download').addEventListener('click', () => this.downloadLastRunMedia());
            $('flow-logout-link').addEventListener('click', () => { if(confirm('Sair da conta Criadores Dark?')) chrome.runtime?.sendMessage?.({action:'logout'}); });

            // ── Layout toggle (horizontal ↔ vertical) ──
            $('flow-assign-layout').addEventListener('click', () => {
                const panel = document.getElementById('flow-assign-panel');
                panel.classList.toggle('vertical');
                const isVert = panel.classList.contains('vertical');
                $('flow-assign-layout').textContent = isVert ? '↕' : '↔';
                $('flow-assign-layout').title = isVert ? 'Voltar para Horizontal' : 'Alternar para Vertical';
                this.updateScrollerPadding();
            });
            $('flow-analyze-btn').addEventListener('click', () => this.analyzeProject());
            $('flow-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('flow-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('flow-dl-refs').addEventListener('click', () => this.downloadProjectImages('refs'));
            $('flow-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('flow-assign-close').addEventListener('click', () => this.hideAssignPanel());
            $('flow-reopen-assign').addEventListener('click', () => this.reopenAssignPanel());
            $('flow-assign-reload').addEventListener('click', () => location.reload());
            // reload bar is the parent container
            $('flow-assign-download').addEventListener('click', () => this.downloadScenes());
            $('flow-assign-toggle').addEventListener('click', () => this.toggleAssignPanel());
            $('flow-assign-refs-btn').addEventListener('click', () => this.openAssignRefsFromDetected());
            const autoBtnEl = document.getElementById('flow-assign-auto');
            if (autoBtnEl) autoBtnEl.addEventListener('click', () => { startKeepAlive(); this.autoEnumerarCenas(); });
            const autoMainBtn = document.getElementById('flow-auto-enumerate-btn');
            if (autoMainBtn) autoMainBtn.addEventListener('click', () => { startKeepAlive(); this.autoEnumerarCenas(); });

            // ── Speed buttons (shared) ──
            document.querySelectorAll('[data-speed]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const profile = CONFIG.SPEED_PROFILES[btn.dataset.speed];
                    if (profile) {
                        this.speedMultiplier = profile.multiplier;
                        const infoEl = document.getElementById('flow-speed-info');
                        if (infoEl) infoEl.textContent = `Velocidade: ${profile.label} (${profile.multiplier}×)`;
                        this.logDebug(`Velocidade: ${profile.label} (${profile.multiplier}×)`, 'info');
                    }
                    // A velocidade É uma configuração: preenche os campos de tempo,
                    // pra você VER o que cada perfil significa (e poder ajustar depois).
                    const perfil = this.perfisTempo()[btn.dataset.speed];
                    if (perfil) this.escreverTempos(perfil, `perfil ${btn.dataset.speed}`);
                });
            });

            // ── Tempos da espera (ajustáveis pelo usuário, valem p/ imagem e vídeo) ──
            this.setupTempos();
            this.setupSeparador();

            // ── Enum mode buttons (shared) ──
            document.querySelectorAll('[data-enum]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-enum]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.enumMode = btn.dataset.enum;
                    this.logDebug(`Enumeração: ${this.enumMode === 'block' ? 'Por bloco' : 'No final'}`, 'info');
                });
            });

            // ── Approve checkbox ──
            const approveCheckbox = $('flow-approve-enum');
            if (approveCheckbox) {
                approveCheckbox.addEventListener('change', e => {
                    this.approveBeforeEnum = e.target.checked;
                });
            }

            // ── Defer retry checkboxes (sync image ↔ video) ──
            const deferImgCb = $('flow-defer-retry');
            if (deferImgCb) {
                deferImgCb.addEventListener('change', e => {
                    this.deferRetry = e.target.checked;
                    const fvCb = document.getElementById('fv-defer-retry');
                    if (fvCb) fvCb.checked = e.target.checked;
                });
            }
            const deferVidCb = $('fv-defer-retry');
            if (deferVidCb) {
                deferVidCb.addEventListener('change', e => {
                    this.deferRetry = e.target.checked;
                    const imgCb = document.getElementById('flow-defer-retry');
                    if (imgCb) imgCb.checked = e.target.checked;
                });
            }

            document.querySelectorAll('.flow-batch-btn').forEach(btn => {
                if (btn.hasAttribute('data-vbatch')) return;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.flow-batch-btn:not([data-vbatch])').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.batchSize = parseInt(btn.dataset.batch);
                });
            });

            $('flow-imgs-per-prompt').addEventListener('change', e => {
                this.imagesPerPrompt = parseInt(e.target.value);
            });
            const imageRetriesSelect = $('flow-max-retries');
if (imageRetriesSelect) {
    this.maxPromptRetries = parseInt(imageRetriesSelect.value, 10);

    imageRetriesSelect.addEventListener('change', e => {
        this.maxPromptRetries = parseInt(e.target.value, 10);
        this.logDebug(`Tentativas ao falhar: ${this.maxPromptRetries}`, 'info');
    });
}

            // ── VIDEO TAB LISTENERS ──

            // Video mode selector
            const videoModeDescs = {
                free: 'Gera vídeos sem atribuir nomes. Ideal para testes rápidos.',
                scenes: 'Cada prompt = uma cena. Após gerar, arraste as cenas para os melhores vídeos e baixe.',
                voice: 'Seleciona a voz especificada com <voz: Nome> e gera a cena.'
            };
            document.querySelectorAll('[data-vmode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vmode]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.videoGenMode = btn.dataset.vmode;
                    const descEl = document.getElementById('fv-mode-desc');
                    if (descEl) descEl.textContent = videoModeDescs[this.videoGenMode] || '';
                    this.logVideoDebug(`Modo: ${this.videoGenMode}`, 'info');
                });
            });

            // Video batch buttons
            document.querySelectorAll('[data-vbatch]').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('[data-vbatch]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.videoBatchSize = parseInt(btn.dataset.vbatch);
                });
            });

            $('fv-results-per-prompt').addEventListener('change', e => {
                this.videoResultsPerPrompt = parseInt(e.target.value);
            });
            const videoRetriesSelect = $('fv-max-retries');
if (videoRetriesSelect) {
    this.videoMaxPromptRetries = parseInt(videoRetriesSelect.value, 10);

    videoRetriesSelect.addEventListener('change', e => {
        this.videoMaxPromptRetries = parseInt(e.target.value, 10);
        this.logVideoDebug(`Tentativas ao falhar: ${this.videoMaxPromptRetries}`, 'info');
    });
}

            // ── Video approve checkbox ──
            const videoApproveCheckbox = $('fv-approve-enum');
            if (videoApproveCheckbox) {
                videoApproveCheckbox.addEventListener('change', e => {
                    this.approveBeforeEnum = e.target.checked;
                    // Sync com o checkbox de imagens
                    const imgCheckbox = document.getElementById('flow-approve-enum');
                    if (imgCheckbox) imgCheckbox.checked = e.target.checked;
                });
            }

            $('fv-validate-btn').addEventListener('click', () => this.validateReferences('video'));
            $('fv-mark-refs-valid-btn').addEventListener('click', () => this.markReferencesAsValidated('video'));

            // ── Video assign refs button ──
            const fvAssignRefsBtn = $('fv-assign-refs-btn');
            if (fvAssignRefsBtn) {
                fvAssignRefsBtn.addEventListener('click', () => this.openVideoAssignRefsFromDetected());
            }
            const clearVideoRefsBtn = $('fv-clear-refs-btn');
if (clearVideoRefsBtn) {
    clearVideoRefsBtn.addEventListener('click', () => this.clearReferencesForUI('video'));
}
            $('fv-show-logs').addEventListener('change', e => $('fv-logs-container').classList.toggle('visible', e.target.checked));
            $('fv-start-btn').addEventListener('click', () => { startKeepAlive(); this.startVideo(); });
            $('fv-stop-btn').addEventListener('click', () => this.stopVideo());
            $('fv-analyze-btn').addEventListener('click', () => this.analyzeProject('video'));
            $('fv-dl-identified').addEventListener('click', () => this.downloadProjectImages('identified'));
            $('fv-dl-scenes').addEventListener('click', () => this.downloadProjectImages('scenes'));
            $('fv-dl-all').addEventListener('click', () => this.downloadProjectImages('all'));
            $('fv-reopen-assign').addEventListener('click', () => this.reopenAssignPanel());
            
            // BOTÃO NOVO (UPSCALE) INJETADO AQUI
            const fvUpscaleBtn = $('fv-upscale-btn');
if (fvUpscaleBtn) fvUpscaleBtn.addEventListener('click', () => { startKeepAlive(); this.startUpscaleProcess(); });

// Upscale stop button
const fvUpscaleStopBtn = $('fv-upscale-stop-btn');
if (fvUpscaleStopBtn) {
    fvUpscaleStopBtn.addEventListener('click', () => {
        this.upscaleShouldStop = true;
        this.logVideoDebug('⏹ Upscale parado pelo usuário.', 'warning');
        this.setVideoStatus('warning', '⏹ Parando upscale...');
    });
}

// Upscale retry button
const fvUpscaleRetryBtn = $('fv-upscale-retry-btn');
if (fvUpscaleRetryBtn) {
    fvUpscaleRetryBtn.addEventListener('click', () => this.retryFailedUpscale());
}

const fvUpscaleDebugBtn = $('fv-upscale-debug-btn');
if (fvUpscaleDebugBtn) {
    fvUpscaleDebugBtn.addEventListener('click', () => this.debugUpscaleList());
}

} // fecha initUI()

setupTextWatcher() {
            const ta = document.getElementById('flow-prompts-input');
            let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateReferences(), 300); });
        }

        updateReferences() {
            const text    = document.getElementById('flow-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs    = extractReferences(prompts);
            document.getElementById('flow-prompt-count').textContent = this.resumoDaLeitura(prompts);
            const list = document.getElementById('flow-ref-list');
            if (!refs.length) {
                list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência. Prompts serão enviados como texto puro.</span>';
            } else {
                list.innerHTML = refs.map(r => {
                    const s = this.validatedRefs[r.toLowerCase()];
                    const cls  = s === true ? 'found'   : s === false ? 'missing'  : 'pending';
                    const icon = s === true ? '✅'      : s === false ? '❌'       : '⏳';
                    return `<span class="flow-ref-tag ${cls}">${icon} ${this.esc(r)}</span>`;
                }).join('');
            }
            // Mostra botão de atribuir se tem referências
            const assignBtn = document.getElementById('flow-assign-refs-btn');
            if (assignBtn) assignBtn.style.display = refs.length > 0 ? '' : 'none';
        }

        setupVideoTextWatcher() {
            const ta = document.getElementById('fv-prompts-input');
            let t;
            ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.updateVideoReferences(), 300); });
        }

        updateVideoReferences() {
            const text    = document.getElementById('fv-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs    = extractReferences(prompts);
            const voices  = extractVoices(prompts);
            
            document.getElementById('fv-prompt-count').textContent = this.resumoDaLeitura(prompts);
            const list = document.getElementById('fv-ref-list');
            if (!refs.length && !voices.length) {
                list.innerHTML = '<span style="font-size:12px;color:var(--cd-text-light);">Nenhuma referência ou voz detectada.</span>';
            } else {
                let html = '';
                html += refs.map(r => {
                    const s = this.validatedRefs[r.toLowerCase()];
                    const cls  = s === true ? 'found'   : s === false ? 'missing'  : 'pending';
                    const icon = s === true ? '✅'      : s === false ? '❌'       : '⏳';
                    return `<span class="flow-ref-tag ${cls}">${icon} ${this.esc(r)}</span>`;
                }).join('');
                
                html += voices.map(v => {
                     return `<span class="flow-voice-tag">🎙️ ${this.esc(v)}</span>`;
                }).join('');
                
                list.innerHTML = html;
            }
            // Mostra botão de atribuir se tem referências
            const assignBtn = document.getElementById('fv-assign-refs-btn');
            if (assignBtn) assignBtn.style.display = refs.length > 0 ? '' : 'none';
        }
cleanUploadReferenceName(rawName) {
    if (!rawName) return null;

    let name = String(rawName).trim();

    // Se já está no padrão de referência, não mexe
    if (/\s_$/.test(name)) return null;

    // Não mexe em cenas/imagens/vídeos já identificados
    if (/^Cena\s+\d+\s*-\s*(Imagem|Vídeo|Video)\s+\d+$/i.test(name)) return null;

    // Não mexe em nomes genéricos do Flow
    if (/^(Imagem gerada|Video gerado|Vídeo gerado|Generated image|Generated video)$/i.test(name)) return null;

    // Remove extensão de arquivo, se existir
    name = name.replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '');

    // Limpa caracteres ruins de nome de arquivo
    name = name
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!name || name.length < 2) return null;

    return name;
}
        referenceKey(rawName) {
    if (!rawName) return '';

    return String(rawName)
        .trim()
        .replace(/\s_$/i, '')
        .replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_-]+/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
markReferencesAsValidated(source = 'images') {
    const isVideo = source === 'video';
    const inputId = isVideo ? 'fv-prompts-input' : 'flow-prompts-input';
    const statusFn = isVideo
        ? (t, m) => this.setVideoStatus(t, m)
        : (t, m) => this.setStatus(t, m);
    const updateFn = isVideo
        ? () => this.updateVideoReferences()
        : () => this.updateReferences();

    const text = document.getElementById(inputId)?.value || '';
    const prompts = parsePromptsText(text);
    const refs = extractReferences(prompts);

    if (!refs.length) {
        statusFn('warning', 'Nenhuma referência [nome] detectada nos prompts.');
        return;
    }

    for (const ref of refs) {
        const key = ref.toLowerCase().trim();
        this.validatedRefs[key] = true;
this.validatedRefs[this.referenceKey(ref)] = true;
    }

    this.saveValidatedRefs();
    updateFn();

    statusFn(
        'success',
        `✅ ${refs.length} referência(s) marcada(s) como já validada(s).`
    );
}
        // ──────────────────────────────────────────────
        // HELPERS
        // ──────────────────────────────────────────────

        sleep(ms) { return wait(ms); }   // via Web Worker: não é freado minimizado

        dynamicSleep(val) {
            // Minimizado o React não tem frames pra reconciliar; um respiro extra
            // evita quebrar o editor do Flow (client-side exception).
            const oculto = (document.visibilityState === 'hidden') ? 1.25 : 1;
            const m = (this.speedMultiplier || 1.0) * oculto;
            if (Array.isArray(val)) {
                const [min, max] = val;
                const scaled = Math.round((min + Math.random() * (max - min)) * m);
                return this.sleep(Math.max(scaled, 100)); // mínimo 100ms
            }
            return this.sleep(Math.round(val * m));
        }

        getScroller() {
            return document.querySelector('[data-testid="virtuoso-scroller"]') ||
                   document.querySelector('[data-virtuoso-scroller="true"]') ||
                   document.querySelector('div[scrollable="true"]') ||
                   document.querySelector('[class*="virtuoso"]') ||
                   (() => {
                       // Fallback: find scrollable container holding tiles
                       const tiles = document.querySelectorAll('[data-tile-id]');
                       if (tiles.length > 0) {
                           let el = tiles[0].parentElement;
                           while (el && el !== document.body) {
                               const style = window.getComputedStyle(el);
                               if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
                                    style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                   el.scrollHeight > el.clientHeight) {
                                   return el;
                               }
                               el = el.parentElement;
                           }
                       }
                       return null;
                   })();
        }

        esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
        getValidatedRefsCacheKey() {
    const projectId = this.getProjectId?.() || location.pathname;
    return `flow_validated_refs_${projectId}`;
}

loadValidatedRefs() {
    try {
        const raw = localStorage.getItem(this.getValidatedRefsCacheKey());
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.warn('[Flow] Erro ao carregar cache de referências:', e);
        return {};
    }
}

saveValidatedRefs() {
    try {
        const onlyValid = {};
        for (const [key, value] of Object.entries(this.validatedRefs || {})) {
            if (value === true) onlyValid[key] = true;
        }
        localStorage.setItem(this.getValidatedRefsCacheKey(), JSON.stringify(onlyValid));
    } catch (e) {
        console.warn('[Flow] Erro ao salvar cache de referências:', e);
    }
}

clearValidatedRefsCache() {
    try {
        localStorage.removeItem(this.getValidatedRefsCacheKey());
    } catch (e) {}
    this.validatedRefs = {};
    this.updateReferences?.();
    this.updateVideoReferences?.();
}
clearReferencesForUI(source = 'images') {
    const isVideo = source === 'video';

    const ok = confirm(
        'Limpar referências validadas deste projeto?\n\nDepois disso, você poderá validar as referências novamente.'
    );

    if (!ok) return;

    this.clearValidatedRefsCache();

    if (isVideo) {
        this.setVideoStatus('success', '🧽 Referências validadas foram limpas. Valide novamente quando quiser.');
        this.logVideoDebug('Referências validadas limpas pelo usuário.', 'warning');
    } else {
        this.setStatus('success', '🧽 Referências validadas foram limpas. Valide novamente quando quiser.');
        this.logDebug('Referências validadas limpas pelo usuário.', 'warning');
    }
}
        // ──────────────────────────────────────────────
        // GRID + TILES
        // ──────────────────────────────────────────────

        async detectGrid() {
            const scroller = this.getScroller();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            
            // Try original virtuoso row detection
            let detected = false;
            for (let attempt = 0; attempt < 8; attempt++) {
                const firstRow = document.querySelector('[data-index="0"]');
                if (firstRow?.firstElementChild?.children?.length > 0) {
                    this.gridCols = firstRow.firstElementChild.children.length;
                    detected = true;
                    break;
                }
                await this.sleep(300);
            }
            
            // Fallback: count tiles in first visual row by Y position
            if (!detected) {
                const allTiles = document.querySelectorAll('[data-tile-id]');
                if (allTiles.length > 0) {
                    const firstTop = allTiles[0].getBoundingClientRect().top;
                    let cols = 0;
                    for (const tile of allTiles) {
                        if (Math.abs(tile.getBoundingClientRect().top - firstTop) < 10) cols++;
                        else break;
                    }
                    if (cols > 0) this.gridCols = cols;
                    // Estimate row height from first tile
                    const tileRect = allTiles[0].getBoundingClientRect();
                    if (tileRect.height > 0) this.rowHeight = tileRect.height + 8;
                    this.logDebug(`Grid detectado via fallback (tiles)`, 'info');
                }
            }
            
            const anyRow = document.querySelector('[data-known-size]');
            if (anyRow) {
                const h = parseFloat(anyRow.getAttribute('data-known-size'));
                if (h > 0) this.rowHeight = h;
            }
            const msg = `Grid: ${this.gridCols} colunas × ${this.rowHeight.toFixed(0)}px/linha`;
            this.logDebug(msg, 'success');
            const el = document.getElementById('flow-grid-info');
            if (el) el.textContent = msg;
        }

        async scrollToRow(targetRow) {
            const scroller = this.getScroller();
            if (!scroller) return;
            const el = document.querySelector(`[data-index="${targetRow}"]`);
            if (el) {
                const er = el.getBoundingClientRect();
                const sr = scroller.getBoundingClientRect();
                if (er.top >= sr.top - 10 && er.bottom <= sr.bottom + 10) return;
            }
            scroller.scrollTop = targetRow * this.rowHeight;
            await this.dynamicSleep([400, 600]);
            for (let i = 0; i < 12; i++) {
                if (document.querySelector(`[data-index="${targetRow}"]`)) return;
                await this.sleep(150);
            }
        }

        getTileAt(row, col) {
            const rowEl = document.querySelector(`[data-index="${row}"]`);
            if (!rowEl) return null;
            const container = rowEl.firstElementChild;
            if (!container) return null;
            const colSlot = container.children[col];
            if (!colSlot) return null;
            const wrapper = colSlot.firstElementChild;
            if (!wrapper) return null;
            return wrapper.firstElementChild || null;
        }

        getUuidFromTile(tile) {
            if (!tile) return null;
            const media = tile.querySelector('img[src*="getMediaUrlRedirect"]') ||
                          tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (!media) return null;
            try { return new URL(media.src).searchParams.get('name'); } catch(e) { return null; }
        }

        getWorkflowIdFromTile(tile) {
            if (!tile) return null;
            // O workflow ID está no href do link /edit/UUID, NÃO no data-tile-id
            const link = tile.querySelector('a[href*="/edit/"]');
            if (link) {
                const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                if (m) return m[1];
            }
            // Fallback: procura em tiles aninhados
            const inner = tile.querySelector('[data-tile-id]');
            if (inner) {
                const innerLink = inner.querySelector('a[href*="/edit/"]');
                if (innerLink) {
                    const m = innerLink.href.match(/\/edit\/([a-f0-9-]{36})/);
                    if (m) return m[1];
                }
            }
            return null;
        }

        getProjectId() {
            const m = location.href.match(/project\/([a-f0-9-]{36})/);
            if (m) return m[1];
            const link = document.querySelector('a[href*="/project/"]');
            if (link) {
                const m2 = link.href.match(/project\/([a-f0-9-]{36})/);
                if (m2) return m2[1];
            }
            return null;
        }

        isVideoTile(tile) {
            if (!tile) return false;
            return !!tile.querySelector('video[src*="getMediaUrlRedirect"]');
        }

        /**
         * Retorna a URL de download da mídia do tile.
         * Para vídeos: retorna o src do <video> (não da thumbnail).
         * Para imagens: retorna o src do <img>.
         */
        getMediaSrcFromTile(tile) {
            if (!tile) return '';
            // Vídeos: prioriza <video src>
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src) return video.src;
            // Imagens: <img src>
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            return img?.src || '';
        }

        // Alias para compatibilidade
        getImgSrcFromTile(tile) { return this.getMediaSrcFromTile(tile); }

        isTileLoaded(tile) {
            if (!tile) return false;
            // Verifica thumbnail (existe em imagens e vídeos carregados)
            const img = tile.querySelector('img[src*="getMediaUrlRedirect"]');
            if (img && img.complete && parseFloat(getComputedStyle(img).opacity) >= 0.9) return true;
            // Vídeo sem thumbnail mas com src pode estar carregado
            // (verifica se o video tem src e NÃO tem indicador de progresso)
            const video = tile.querySelector('video[src*="getMediaUrlRedirect"]');
            if (video?.src && !this.tileHasProgress(tile)) {
                // Checa se não é um tile "vazio" — deve ter pelo menos o play_circle icon
                const playIcon = [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'play_circle');
                if (playIcon) return true;
            }
            return false;
        }

        isTilePending(tile) {
            if (!tile) return false;
            if (this.isTileLoaded(tile)) return false;
            return this.tileHasProgress(tile);
        }

        isTileError(tile) {
            if (!tile) return false;
            if (this.isTileLoaded(tile)) return false;
            if (this.isTilePending(tile)) return false;
            return [...tile.querySelectorAll('i')].some(i => i.textContent?.trim() === 'warning');
        }

        tileHasProgress(tile) {
            const els = tile.querySelectorAll('div, span');
            for (const el of els) {
                const t = el.textContent?.trim();
                if (t && /^\d+%$/.test(t)) return true;
            }
            return false;
        }

        snapshotImageUuids() {
            const uuids = new Set();
            document.querySelectorAll('[data-tile-id] img[src*="getMediaUrlRedirect"]').forEach(el => {
                try { const u = new URL(el.src).searchParams.get('name'); if (u) uuids.add(u); } catch(e) {}
            });
            document.querySelectorAll('[data-tile-id] video[src*="getMediaUrlRedirect"]').forEach(el => {
                try { const u = new URL(el.src).searchParams.get('name'); if (u) uuids.add(u); } catch(e) {}
            });
            return uuids;
        }

        // ──────────────────────────────────────────────
        // MATRIZ + AGUARDAR GERAÇÃO
        // ──────────────────────────────────────────────

        buildPositionMatrix(batch, imgsPerPrompt, rowOffset) {
            const C = this.gridCols, matrix = [], total = batch.length * imgsPerPrompt;
            for (let pos = 0; pos < total; pos++) {
                const row = rowOffset + Math.floor(pos / C);
                const col = pos % C;
                const batchRevIdx = Math.floor(pos / imgsPerPrompt);
                const batchIdx = batch.length - 1 - batchRevIdx;
                const imgNum = (pos % imgsPerPrompt) + 1;
                matrix.push({ row, col, promptNum: batch[batchIdx].promptNum, imgNum, state: 'pending' });
            }
            return matrix;
        }

        /**
         * Quantos tiles ainda estão GERANDO (o Flow mostra o progresso, ex: "38%").
         * Enquanto houver algum, não faz sentido desistir nem marcar como falha.
         */
        // ──────────────────────────────────────────────
        // TEMPOS AJUSTÁVEIS (valem para imagens e vídeos)
        // ──────────────────────────────────────────────

        /**
         * Espera EXATAMENTE o tempo escolhido no painel (com uma variaçãozinha de
         * ±10% pra não ficar robótico). Não passa pelo multiplicador de velocidade —
         * assim o número que aparece no painel é o número que acontece de verdade.
         */
        esperaFixa(ms) {
            const base = Math.max(0, Number(ms) || 0);
            return this.sleep(Math.round(base * (0.9 + Math.random() * 0.2)));
        }

        /** Cada velocidade é uma CONFIGURAÇÃO: ao clicar, preenche os campos abaixo. */
        perfisTempo() {
            return {
                slow:   { lotes: 5,   poll: 2.0, estab: 5,   semProg: 6   },
                normal: { lotes: 2,   poll: 1.0, estab: 2.5, semProg: 3   },
                fast:   { lotes: 0.8, poll: 0.5, estab: 1,   semProg: 2   },
            };
        }

        temposPadrao() {
            return Object.assign({}, this.perfisTempo().normal);
        }

        carregarTempos() {
            try {
                const salvo = JSON.parse(localStorage.getItem('flow_tempos') || 'null');
                return Object.assign(this.temposPadrao(), salvo || {});
            } catch (_) { return this.temposPadrao(); }
        }

        /** Escreve os valores escolhidos no CONFIG que a espera usa. */
        aplicarTempos(t) {
            CONFIG.TILE_CHECK_INTERVAL    = Math.round(Math.max(0.3, t.poll) * 1000);
            CONFIG.STABILIZE_TIME         = Math.round(Math.max(0, t.estab) * 1000);
            CONFIG.SEM_PROGRESSO_TIMEOUT  = Math.round(Math.max(0.5, t.semProg) * 60000);
            const lote                    = Math.round(Math.max(0, t.lotes) * 1000);
            CONFIG.DELAY_BETWEEN_BATCHES  = [lote, Math.round(lote * 1.4)];
            const resumo = `⏸️ ${t.lotes}s entre lotes • checa ${t.poll}s • confirma ${t.estab}s • desiste após ${t.semProg}min sem progresso`;
            for (const id of ['flow-t-info', 'fv-t-info']) {
                const info = document.getElementById(id);
                if (info) info.textContent = resumo;
            }
        }

        /** Cada tempo aparece em DOIS lugares: aba Imagens e aba Vídeos. */
        camposTempo() {
            return {
                lotes:   ['flow-t-lotes',   'fv-t-lotes'],
                poll:    ['flow-t-poll',    'fv-t-poll'],
                estab:   ['flow-t-estab',   'fv-t-estab'],
                semProg: ['flow-t-semprog', 'fv-t-semprog'],
            };
        }

        /** Lê os campos de uma das abas (0 = Imagens, 1 = Vídeos). */
        lerTempos(coluna = 0) {
            const t = Object.assign({}, this.perfisTempo().normal);
            for (const [k, ids] of Object.entries(this.camposTempo())) {
                const v = parseFloat(document.getElementById(ids[coluna])?.value);
                if (!isNaN(v)) t[k] = v;
            }
            return t;
        }

        /** Preenche os campos das DUAS abas, aplica e salva. */
        escreverTempos(t, origem) {
            for (const [k, ids] of Object.entries(this.camposTempo())) {
                for (const id of ids) {
                    const el = document.getElementById(id);
                    if (el && t[k] != null) el.value = t[k];
                }
            }
            this.aplicarTempos(t);
            try { localStorage.setItem('flow_tempos', JSON.stringify(t)); } catch (_) {}
            if (origem) this.logDebug(`⏱️ Tempos (${origem}): ${t.lotes}s entre lotes • checa ${t.poll}s • confirma ${t.estab}s • desiste após ${t.semProg}min.`, 'info');
        }

        // ──────────────────────────────────────────────
        // SEPARADOR DE PROMPTS (vale para imagens e vídeos)
        // ──────────────────────────────────────────────

        /** Texto de conferência: quantos prompts leu e quais cenas identificou. */
        resumoDaLeitura(prompts) {
            const n = prompts.length;
            if (!n) return '0 prompts detectados';
            const cenas = prompts.map(p => p.promptNum);
            const amostra = cenas.length > 12
                ? cenas.slice(0, 8).join(', ') + ' … ' + cenas.slice(-2).join(', ')
                : cenas.join(', ');
            const media = Math.round(prompts.reduce((s, p) => s + (p.text || '').length, 0) / n);
            return `✅ ${n} prompt${n !== 1 ? 's' : ''} • cenas: ${amostra} • ~${media} caracteres cada`;
        }

        setupSeparador() {
            const pares = [['flow-sep-modo', 'flow-sep-texto'], ['fv-sep-modo', 'fv-sep-texto']];

            const refletir = () => {
                for (const [idModo, idTexto] of pares) {
                    const m = document.getElementById(idModo), t = document.getElementById(idTexto);
                    if (m) m.value = SEPARADOR.modo;
                    if (t) { t.value = SEPARADOR.texto; t.style.display = SEPARADOR.modo === 'custom' ? '' : 'none'; }
                }
                this.updateReferences?.();
                this.updateVideoReferences?.();
            };

            try {
                const salvo = JSON.parse(localStorage.getItem('flow_separador') || 'null');
                if (salvo && salvo.modo) SEPARADOR = Object.assign(SEPARADOR, salvo);
            } catch (_) {}

            for (const [idModo, idTexto] of pares) {
                const m = document.getElementById(idModo), t = document.getElementById(idTexto);
                if (m) m.addEventListener('change', () => {
                    SEPARADOR.modo = m.value;
                    try { localStorage.setItem('flow_separador', JSON.stringify(SEPARADOR)); } catch (_) {}
                    refletir();
                    this.logDebug(`✂️ Separando prompts por: ${SEPARADOR.modo === 'linha' ? 'cada linha' : SEPARADOR.modo === 'vazia' ? 'linha em branco' : `"${SEPARADOR.texto}"`}`, 'info');
                });
                if (t) t.addEventListener('input', () => {
                    SEPARADOR.texto = t.value;
                    try { localStorage.setItem('flow_separador', JSON.stringify(SEPARADOR)); } catch (_) {}
                    refletir();
                });
            }
            refletir();
        }

        setupTempos() {
            this.escreverTempos(this.carregarTempos());

            for (const ids of Object.values(this.camposTempo())) {
                ids.forEach((id, coluna) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    // Mexeu numa aba, a outra acompanha na hora.
                    el.addEventListener('change', () => this.escreverTempos(this.lerTempos(coluna), 'ajuste manual'));
                });
            }

            for (const id of ['flow-t-reset', 'fv-t-reset']) {
                const b = document.getElementById(id);
                if (b) b.addEventListener('click', () => {
                    try { localStorage.removeItem('flow_tempos'); } catch (_) {}
                    this.escreverTempos(this.temposPadrao(), 'padrão restaurado');
                });
            }
        }

        tilesGerando() {
            let n = 0;
            for (const el of document.querySelectorAll('[data-tile-id]')) {
                if (/\b\d{1,3}\s*%/.test((el.textContent || ''))) n++;
            }
            return n;
        }

        async waitForMatrix(matrix, beforeUuids) {
            const scroller = this.getScroller();
            const rowsNeeded = Math.max(...matrix.map(s => s.row)) + 1;
            const start = Date.now();
            if (scroller) { scroller.scrollTop = 0; await this.sleep(500); }
            this.logDebug(`Aguardando ${matrix.length} slot(s) em ${rowsNeeded} linha(s)...`, 'info');

            // Tracking: uma vez confirmado como loaded (UUID novo), não re-verifica.
            // Isso evita falsos "pending" quando o Virtuoso destrói/recria DOM ao scrollar.
            const confirmedLoaded = new Set(); // índices de matrix[] já confirmados
            const confirmedError  = new Set();

            const countStates = () => {
                let loaded = 0, errors = 0, pending = 0;
                for (let i = 0; i < matrix.length; i++) {
                    if (confirmedLoaded.has(i)) { loaded++; continue; }
                    if (confirmedError.has(i))  { errors++; continue; }
                    const slot = matrix[i];
                    const tile = this.getTileAt(slot.row, slot.col);
                    if (!tile) { pending++; continue; }
                    if (this.isTileLoaded(tile)) {
                        const uuid = this.getUuidFromTile(tile);
                        if (uuid && !beforeUuids.has(uuid)) {
                            loaded++;
                            confirmedLoaded.add(i);
                            // Captura dados já para evitar re-scroll na Fase 3
                            slot.uuid = uuid;
                            slot.src = this.getImgSrcFromTile(tile);
                            slot.workflowId = this.getWorkflowIdFromTile(tile);
                        }
                        else pending++;
                    } else if (this.isTileError(tile)) {
                        errors++;
                        confirmedError.add(i);
                    }
                    else { pending++; }
                }
                return { loaded, errors, pending };
            };

            // Fase 1: aguarda primeiro slot resolver
            let detected = false;
            while (Date.now() - start < CONFIG.TETO_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                // Confere ANTES de dormir: imagens costumam ficar prontas rápido e
                // dormir primeiro custava um ciclo inteiro à toa.
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors } = countStates();
                if (loaded + errors > 0) { detected = true; break; }
                // Passou do tempo normal, mas ainda há tiles GERANDO? Continua esperando.
                if (Date.now() - start >= CONFIG.GENERATION_TIMEOUT && this.tilesGerando() === 0) break;
                await this.esperaFixa(CONFIG.TILE_CHECK_INTERVAL);
            }
            if (!detected) { for (const s of matrix) s.state = 'error'; return; }

            // Fase 2: aguarda pending === 0 estável
            let lastPending = -1, pendingZeroAt = null;
            let resolvidosAntes = -1, ultimoProgressoEm = Date.now();
            while (Date.now() - start < CONFIG.TETO_TIMEOUT) {
                if (this.shouldStop || this.videoShouldStop) return;
                if (scroller) scroller.scrollTop = 0;
                const { loaded, errors, pending } = countStates();

                // Houve avanço (mais um slot resolveu) ou ainda há tile gerando?
                // Enquanto isso acontecer, NÃO desistimos — era o que marcava como
                // "falha" um lote que só estava demorando.
                if (loaded + errors !== resolvidosAntes) {
                    resolvidosAntes = loaded + errors;
                    ultimoProgressoEm = Date.now();
                }
                const gerando = this.tilesGerando();
                if (gerando > 0) ultimoProgressoEm = Date.now();

                if (pending !== lastPending) {
                    lastPending = pending;
                    pendingZeroAt = pending === 0 ? Date.now() : null;
                    this.logDebug(`Progresso: ${loaded} ✅  ${errors} ❌  ${pending} ⏳${gerando ? `  (${gerando} gerando)` : ''}`, 'info');
                }

                if (Date.now() - ultimoProgressoEm >= CONFIG.SEM_PROGRESSO_TIMEOUT) {
                    this.logDebug(`⏱️ Sem nenhum progresso por ${Math.round(CONFIG.SEM_PROGRESSO_TIMEOUT/1000)}s — encerrando a espera.`, 'warning');
                    break;
                }
                // TODOS os slots esperados já resolveram: não há nada pra "estabilizar",
                // segue direto pro próximo lote em vez de esperar à toa.
                if (loaded + errors >= matrix.length) {
                    this.logDebug(`✅ Lote finalizado: ${loaded} ok, ${errors} erros`, 'success');
                    break;
                }
                if (pending === 0 && (Date.now() - (pendingZeroAt || Date.now())) >= CONFIG.STABILIZE_TIME) {
                    this.logDebug(`✅ Lote finalizado: ${loaded} ok, ${errors} erros`, 'success');
                    break;
                }
                await this.esperaFixa(CONFIG.TILE_CHECK_INTERVAL);
            }

            // Carência: se ainda tem tile gerando, espera terminar antes de classificar.
            // (Sem isso, o que estava só demorando era marcado como falha e reenviado.)
            if (this.tilesGerando() > 0) {
                this.logDebug(`⏳ Ainda há ${this.tilesGerando()} gerando — aguardando antes de classificar...`, 'info');
                for (let g = 0; g < 25 && this.tilesGerando() > 0; g++) {
                    if (this.shouldStop || this.videoShouldStop) return;
                    await this.esperaFixa(CONFIG.TILE_CHECK_INTERVAL);
                }
            }

            // Fase 3: classifica slots — apenas os que NÃO foram confirmados durante polling
            this.logDebug('Classificando slots finais...', 'info');
            for (let i = 0; i < matrix.length; i++) {
                const slot = matrix[i];
                if (confirmedLoaded.has(i)) {
                    slot.state = 'loaded';
                    continue;
                }
                if (confirmedError.has(i)) {
                    slot.state = 'error';
                    continue;
                }
                // Slot não confirmado: tenta scroll e verificação final
                if (this.shouldStop || this.videoShouldStop) return;
                await this.scrollToRow(slot.row);
                const tile = this.getTileAt(slot.row, slot.col);
                if (!tile) { slot.state = 'error'; continue; }
                if (this.isTileLoaded(tile)) {
                    const uuid = this.getUuidFromTile(tile);
                    if (uuid && !beforeUuids.has(uuid)) {
                        slot.state = 'loaded'; slot.uuid = uuid;
                        slot.src = this.getImgSrcFromTile(tile);
                        slot.workflowId = this.getWorkflowIdFromTile(tile);
                    } else { slot.state = 'error'; }
                } else { slot.state = 'error'; }
            }
            if (scroller) { scroller.scrollTop = 0; await this.sleep(300); }
        }

        // ──────────────────────────────────────────────
        // EDITOR (Slate)
        // ──────────────────────────────────────────────

        getEditor() {
            return document.querySelector('[data-slate-editor="true"]')
                || document.querySelector('div[role="textbox"][contenteditable="true"]')
                || document.querySelector('div[role="textbox"]');
        }

        async clearEditor() {
            const e = this.getEditor();
            if (!e) throw new Error('Editor de prompt não encontrado');
            e.focus(); await this.dynamicSleep(CONFIG.DELAY_SHORT);
            document.execCommand('selectAll', false, null); await this.dynamicSleep([250, 400]);
            document.execCommand('delete', false, null); await this.dynamicSleep(CONFIG.DELAY_SHORT);
        }

        async insertText(text) {
            const e = this.getEditor();
            if (!e) throw new Error('Editor não encontrado');
            e.focus(); await this.dynamicSleep([250, 400]);

            // Slate requer beforeinput com insertText - é a única forma
            // que o editor reconhece. execCommand modifica DOM mas Slate ignora.
            // O crash anterior (insertBefore) era causado por beforeinput de backspace
            // em sequência rápida, não pela inserção de texto.
            // Proteção: aguardar animationFrame para não conflitar com React render.
            await nextFrame();
            e.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true,
                inputType: 'insertText', data: text
            }));

            // Delay extra para React reconciliar o DOM após a inserção
            await this.dynamicSleep([400, 600]);

            if (this.isFlowCrashed()) {
                throw new Error('Flow crashou após inserção de texto');
            }
        }

        async openAtSelector() {
            const MAX_AT_RETRIES = 3;
            for (let attempt = 1; attempt <= MAX_AT_RETRIES; attempt++) {
                const e = this.getEditor();
                if (!e) throw new Error('Editor não encontrado');
                e.focus(); await this.dynamicSleep([250, 400]);
                e.dispatchEvent(new KeyboardEvent('keydown', { key:'@', bubbles:true, cancelable:true }));
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                let opened = false;
                for (let i = 0; i < 20; i++) {
                    await this.dynamicSleep(CONFIG.DELAY_SHORT);
                    if (document.querySelector('[role="dialog"], [role="presentation"]')) { opened = true; break; }
                }
                if (opened) return;
                this.logDebug(`⚠️ Diálogo @ não abriu (tentativa ${attempt}/${MAX_AT_RETRIES})`, 'error');
                e.focus(); await this.sleep(200);
                // Usa execCommand para backspace (compatível com React)
                document.execCommand('delete', false, null);
                await this.sleep(200);
                if (attempt < MAX_AT_RETRIES) {
                    await this.dynamicSleep([2000, 3000]);
                    e.focus(); e.click(); await this.dynamicSleep([500, 800]);
                }
            }
            throw new Error('Diálogo @ não abriu após ' + MAX_AT_RETRIES + ' tentativas');
        }

        // ============================================
        // O SEGREDO DAS ABAS DO RADIX
        // ============================================
        async clickDialogTab(type) {
            let targetTab = null;
            const selector = type === 'image' 
                ? 'button[role="tab"][aria-controls*="IMAGE"]' 
                : 'button[role="tab"][aria-controls*="AUDIO"]';

            for (let i = 0; i < 10; i++) {
                targetTab = document.querySelector(selector);
                if (targetTab) break;
                await this.dynamicSleep([200, 300]);
            }

            if (targetTab) {
                const isSelected = targetTab.getAttribute('aria-selected') === 'true' || targetTab.getAttribute('data-state') === 'active';
                if (!isSelected) {
                    this.logDebug(`Migrando para a aba: ${type === 'image' ? 'Imagens' : 'Vozes'}`, 'info');
                    targetTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetTab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetTab.click();
                    await this.dynamicSleep([800, 1200]); 
                }
            }
        }

        async searchAndSelect(name) {
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (!dialog) throw new Error('Diálogo @ não aberto');
            await this.dynamicSleep([500, 700]);
            const input = dialog.querySelector('input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]');
            if (!input) throw new Error('Input de pesquisa não encontrado');
            input.focus(); await this.dynamicSleep([250, 400]);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, name);
            input.dispatchEvent(new Event('input',  { bubbles:true }));
            input.dispatchEvent(new Event('change', { bubbles:true }));
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            let target = null;
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                const items = dialog.querySelectorAll('[data-item-index]');
                if (items.length > 0) {
                    let bestItem = null;
                    const nameLower = name.toLowerCase().trim();
                    // Limpa extensão do nome buscado também
                    const cleanSearch = nameLower.replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '').trim();
                    for (const item of items) {
                        const nameDiv = [...item.querySelectorAll('div')].find(d =>
                            d.children.length === 0 && d.textContent?.trim().length > 0
                        );
                        const img = item.querySelector('img');
                        const itemName = (nameDiv?.textContent || img?.alt || '').trim().toLowerCase();
                        // Comparação: tira sufixo " _" E extensão de arquivo
                        const cleanName = itemName
                            .replace(/ _$/, '')
                            .replace(/\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, '')
                            .trim();
                        if (cleanName === cleanSearch || cleanName === nameLower || itemName === nameLower) {
                            bestItem = item;
                            break;
                        }
                    }
                    const chosen = bestItem || items[0];
                    target = chosen.querySelector('div[role="button"]') || chosen.querySelector('img')?.closest('div') || chosen.querySelector('div');
                    if (target) break;
                }
            }
            if (!target) throw new Error(`Sem resultado para "${name}"`);
            await this.dynamicSleep([250, 400]);
            target.click();
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                if (!document.querySelector('[role="dialog"]')) return;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }

        // ============================================
        // FUNÇÃO NOVA E DEFINITIVA PARA VOZES
        // ============================================
        async searchAndSelectVoice(name) {
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (!dialog) throw new Error('Diálogo @ não aberto');
            await this.dynamicSleep([500, 700]);
            
            const input = dialog.querySelector('input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]');
            if (!input) throw new Error('Input de pesquisa de voz não encontrado');
            
            input.focus(); await this.dynamicSleep([250, 400]);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, name);
            input.dispatchEvent(new Event('input',  { bubbles:true }));
            input.dispatchEvent(new Event('change', { bubbles:true }));
            await this.dynamicSleep([1500, 2000]); 
            
            let target = null;
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                const nameLower = name.toLowerCase().trim();
                const divs = dialog.querySelectorAll('div');
                for (const div of divs) {
                    if (div.children.length === 0 && div.textContent && div.textContent.trim().toLowerCase() === nameLower) {
                        target = div.closest('button, [role="option"], [role="button"], [role="menuitem"]') || div;
                        break;
                    }
                }
                if (target) break;
            }
            
            if (!target) throw new Error(`Voz "${name}" não encontrada.`);
            await this.dynamicSleep([250, 400]);
            
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.click();
            
            await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
            for (let i = 0; i < 20; i++) {
                await this.dynamicSleep(CONFIG.DELAY_SHORT);
                if (!document.querySelector('[role="dialog"], [role="presentation"]')) return;
            }
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        }

       async clickSubmit() {
    await this.dynamicSleep(CONFIG.DELAY_MEDIUM);

    const findSubmitBtn = () => [...document.querySelectorAll('button')].find(b =>
        b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward'
    );

    // Assinatura do conteúdo REAL do editor Slate.
    // IMPORTANTE: NÃO usar innerText/textContent — quando o editor está vazio
    // o Flow renderiza o placeholder ("What do you want to create?") DENTRO do
    // editor, então innerText tem ~27 chars mesmo vazio. O conteúdo real fica
    // nos nós [data-slate-string]; os chips de referência são nós void.
    const editorSignature = () => {
        const ed = this.getEditor?.();
        if (!ed) return null;
        const txt = [...ed.querySelectorAll('[data-slate-string="true"]')]
            .map(n => n.textContent).join('')
            .replace(/[﻿​]/g, '').trim();
        const chips = ed.querySelectorAll('[data-slate-void="true"]').length;
        return txt + '|' + chips;
    };
    const EMPTY_SIG = '|0';

    const btn = findSubmitBtn();

    if (!btn) {
        throw new Error('Botão enviar não encontrado');
    }

    for (let i = 0; i < 30; i++) {
        if (!btn.disabled) break;
        await this.dynamicSleep(CONFIG.DELAY_SHORT);
    }

    if (btn.disabled) {
        throw new Error('Botão enviar desabilitado');
    }

    // Só dá pra confirmar "esvaziou" se havia conteúdo antes do clique.
    const hadContentBefore = editorSignature() !== EMPTY_SIG;

    triggerTrustedClick(btn);

    // Confirma se o Flow realmente aceitou o envio.
    // Sinais aceitos (qualquer um):
    //   1. O editor esvaziou de verdade (conteúdo Slate == vazio) — principal.
    //   2. O botão de enviar ficou desabilitado (nem sempre acontece).
    for (let i = 0; i < 30; i++) {
        await this.dynamicSleep([250, 400]);

        const currentBtn = findSubmitBtn();

        const editorCleared = hadContentBefore && editorSignature() === EMPTY_SIG;
        const buttonReacted = currentBtn && currentBtn.disabled;

        if (editorCleared || buttonReacted) {
            await this.dynamicSleep(CONFIG.DELAY_LONG);
            return true;
        }
    }

    throw new Error('Clique de envio não confirmado pelo Flow');
}

        async prepareAndSubmit(promptObj) {
            const MAX_SUBMIT_RETRIES = 2;

            for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
                try {
                    this.logDebug(`Preparando prompt ${promptObj.promptNum}: "${promptObj.text.substring(0,50)}..."${attempt > 1 ? ` (tentativa ${attempt})` : ''}`, 'info');
                    const segs = parsePrompt(promptObj.text);
                    await this.clearEditor();
                    await this.dynamicSleep(CONFIG.DELAY_MEDIUM);
                    for (const seg of segs) {
                        if (this.shouldStop || this.videoShouldStop) return false;
                        if (seg.type === 'text') {
                             await this.insertText(seg.content);
} else if (seg.type === 'ref') { 
                         await this.openAtSelector(); 
                         await this.clickDialogTab('image');
                         await this.searchAndSelect(seg.name); 
                         await this.dynamicSleep(CONFIG.DELAY_SHORT);
                         
                        // Verifica se a opção do Backspace foi ativada
                         const useBackspace = (document.getElementById('flow-use-backspace') && document.getElementById('flow-use-backspace').checked) || 
                                              (document.getElementById('fv-use-backspace') && document.getElementById('fv-use-backspace').checked);

                         if (useBackspace) {
                             // --- INÍCIO DA CORREÇÃO (APAGAR CHIP DO TEXTO 3 VEZES) ---
                             const editor = this.getEditor();
                             if (editor) {
                                 editor.focus();
                                 await this.dynamicSleep([150, 250]);
                                 
                                 // Loop que repete o Backspace 3 vezes
                                 for (let b = 0; b < 3; b++) {
                                     // Backspace com delay adequado entre cada para evitar conflito React
                                     await nextFrame();
                                     editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
                                     document.execCommand('delete', false, null);
                                     await this.dynamicSleep([100, 200]);
                                 }
                                 
                                 await this.dynamicSleep([150, 250]);
                             }
                             // --- FIM DA CORREÇÃO ---
                         }

                    } else if (seg.type === 'voice') {
                             await this.openAtSelector(); 
                             await this.clickDialogTab('voice');
                             await this.searchAndSelectVoice(seg.name); 
                             await this.dynamicSleep(CONFIG.DELAY_SHORT);
                        }
                    }
                    await this.clickSubmit();
                    this.logDebug(`Prompt ${promptObj.promptNum} enviado ✅`, 'success');
                    return true;
                } catch (err) {
                    this.logDebug(`⚠️ Erro no prompt ${promptObj.promptNum}: ${err.message} — ${attempt < MAX_SUBMIT_RETRIES ? 'resetando editor...' : 'falha definitiva'}`, 'error');

                    // Detecta crash do Flow e tenta recuperar
                    if (this.isFlowCrashed()) {
                        this.logDebug('🔴 Flow crashou! Salvando estado e recarregando em 3s...', 'error');
                        this.saveRunState(promptObj.promptNum);
                        await this.sleep(3000);
                        location.reload();
                        return false;
                    }

                    if (attempt < MAX_SUBMIT_RETRIES) {
                        await this.resetEditor();
                        await this.dynamicSleep([2000, 3000]);
                    }
                }
            }
            return false;
        }

        /**
         * Força reset do editor: fecha dialogs, limpa conteúdo via botão "Apagar comando".
         */
        async resetEditor() {
            // 0. Se o Flow crashou, não tenta nada — precisa recarregar
            if (this.isFlowCrashed()) {
                this.logDebug('⚠️ Flow crashou — resetEditor abortado. Recarregue a página.', 'error');
                return;
            }

            // 1. Fecha qualquer dialog aberto (seletor @)
            const dialog = document.querySelector('[role="dialog"], [role="presentation"]');
            if (dialog) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                await this.sleep(500);
            }

            // 2. Escreve algo no editor para garantir que o botão X fica disponível
            const editor = this.getEditor();
            if (editor) {
                editor.focus();
                await this.sleep(200);
                await nextFrame();
                editor.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true,
                    inputType: 'insertText', data: ' reset'
                }));
                await this.sleep(500);
            }

            // 3. Clica no botão "Apagar comando" (ícone close)
            const closeBtn = [...document.querySelectorAll('button')].find(btn => {
                const icon = btn.querySelector('i.google-symbols');
                if (!icon || icon.textContent.trim() !== 'close') return false;
                return btn.textContent.includes('Apagar') || btn.querySelector('span')?.textContent?.includes('Apagar');
            });
            if (closeBtn) {
                closeBtn.click();
                this.logDebug('Editor resetado via botão Apagar', 'info');
                await this.sleep(800);
            } else {
                // Fallback: selectAll + delete
                if (editor) {
                    editor.focus();
                    await this.sleep(200);
                    document.execCommand('selectAll', false, null);
                    await this.sleep(200);
                    document.execCommand('delete', false, null);
                    this.logDebug('Editor resetado via selectAll+delete', 'info');
                    await this.sleep(500);
                }
            }

            // 4. Fecha qualquer dialog que possa ter reaberto
            const dialog2 = document.querySelector('[role="dialog"], [role="presentation"]');
            if (dialog2) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                await this.sleep(400);
            }
        }

        // ──────────────────────────────────────────────
        // API (rename + favorite via HTTP)
        // ──────────────────────────────────────────────

        async apiRename(workflowId, newName) {
            if (!_authToken) { this.logDebug('Token não capturado — faça uma ação na página', 'error'); return false; }
            const projectId = this.getProjectId();
            if (!projectId || !workflowId) return false;
            try {
                const res = await _origFetch(`${CONFIG.API_BASE}/${workflowId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': _authToken },
                    body: JSON.stringify({
                        workflow: { name: workflowId, projectId, metadata: { displayName: newName } },
                        updateMask: 'metadata.displayName'
                    })
                });
                if (!res.ok) this.logDebug(`API rename falhou: ${res.status}`, 'error');
                return res.ok;
            } catch(e) { this.logDebug(`Erro API rename: ${e.message}`, 'error'); return false; }
        }

        async apiFavorite(workflowId, favorited) {
            if (!_authToken) return false;
            const projectId = this.getProjectId();
            if (!projectId || !workflowId) return false;
            try {
                const res = await _origFetch(`${CONFIG.API_BASE}/${workflowId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Authorization': _authToken },
                    body: JSON.stringify({
                        workflow: { name: workflowId, projectId, metadata: { favorited: !!favorited } },
                        updateMask: 'metadata.favorited'
                    })
                });
                return res.ok;
            } catch(e) { return false; }
        }

        // ──────────────────────────────────────────────
        // PIPELINE PRINCIPAL (sem rename automático)
        // ──────────────────────────────────────────────

        async start() {
            if (this.videoIsRunning) { this.setStatus('warning', '⚠️ A automação de vídeos está rodando. Aguarde finalizar.'); return; }
            let text = document.getElementById('flow-prompts-input').value;

            // Em modo referências: extrai nomes da primeira linha
            if (this.genMode === 'refs') {
                const parsed = parseReferenceHeader(text);
                if (!parsed.refs.length) {
                    this.setStatus('error', 'Modo Referências: a primeira linha deve conter nomes entre [colchetes]. Ex: [Maria][José][Praia]');
                    return;
                }
                this.refNames = parsed.refs;
                this.refAssignments = new Map();
                text = parsed.remaining;
                this.logDebug(`Referências detectadas: ${this.refNames.join(', ')}`, 'info');
            }

            this.prompts = parsePromptsText(text);
            if (!this.prompts.length) { this.setStatus('error', 'Nenhum prompt detectado.'); return; }

            // --- INJEÇÃO ADD-ON: Sistema "Retomar de" ---
            const resumeInput = document.getElementById('flow-start-from').value.trim();
            let resumeFrom = -1;
            if (resumeInput !== '') {
                resumeFrom = parseInt(resumeInput, 10);
            }

            // Valida referências nos prompts (não as da primeira linha)
            // Pula no modo 'refs' — ali estamos CRIANDO referências, não usando existentes
            if (this.genMode !== 'refs') {
                const refs = extractReferences(this.prompts);
                if (refs.length > 0) {
                    const unvalidated = refs.filter(r => this.validatedRefs[r.toLowerCase()] === undefined);
                    const missing     = refs.filter(r => this.validatedRefs[r.toLowerCase()] === false);
                    if (unvalidated.length) { this.setStatus('warning', 'Valide as referências antes de iniciar.'); return; }
                    if (missing.length)     { this.setStatus('error', `Referências não encontradas: ${missing.join(', ')}`); return; }
                }
            }

            // Em modo cenas: sceneCount = número de prompts (INJEÇÃO ADD-ON: Numeração Fiel)
            if (this.genMode === 'scenes') {
                this.sceneCount = this.prompts.length;
                this.sceneAssignments = new Map();
                for (let i = 0; i < this.prompts.length; i++) {
                    this.sceneAssignments.set(`Cena ${this.prompts[i].promptNum}`, []);
                }
            }

            this.isRunning = true;
            this.shouldStop = false;
            document.getElementById('flow-start-btn').disabled = true;
            document.getElementById('flow-stop-btn').disabled  = false;
            document.getElementById('flow-prompts-input').disabled = true;

            this.buildPromptList();
            this.setStatus('info', '🚀 Iniciando automação v4.0...');
            this.updateProgress(0);

            // --- INJEÇÃO ADD-ON: Regra do 0 ---
            if (resumeFrom === 0) {
                this.logDebug('Regra do 0: Marcando geração como concluída e abrindo painel de atribuição...', 'success');
                this.prompts.forEach((p, idx) => {
                    this.updatePromptItemStatus(idx, 'done', 'Concluído');
                });
                this.updateProgress(1);
                this.setStatus('success', '✅ Geração pulada. Atribua as imagens.');
                this.isRunning = false;
                document.getElementById('flow-start-btn').disabled = false;
                document.getElementById('flow-stop-btn').disabled  = true;
                document.getElementById('flow-prompts-input').disabled = false;
                if (this.genMode === 'scenes' || this.genMode === 'refs') {
                    this.showAssignPanel([]);
                }
                return;
            }

            // --- INJEÇÃO ADD-ON: Resume > 0 ---
            let promptsToProcess = this.prompts;
            if (resumeFrom > 0) {
                promptsToProcess = this.prompts.filter(p => p.promptNum >= resumeFrom);
                const skipped = this.prompts.filter(p => p.promptNum < resumeFrom);
                skipped.forEach(p => {
                    const idx = this.prompts.findIndex(x => x.promptNum === p.promptNum);
                    this.updatePromptItemStatus(idx, 'done', 'Concluído');
                });
                this.logDebug(`Retomando da cena/prompt ${resumeFrom}. ${skipped.length} prompts marcados como concluídos.`, 'info');
            }

            await this.detectGrid();

            const batches = [];
            // INJEÇÃO ADD-ON: Usando promptsToProcess em vez de this.prompts
            for (let i = 0; i < promptsToProcess.length; i += this.batchSize)
                batches.push(promptsToProcess.slice(i, Math.min(i + this.batchSize, promptsToProcess.length)));
            this.logDebug(`${promptsToProcess.length} prompts → ${batches.length} lote(s)`, 'info');

            const allMatrices = [];

            try {
                const N = this.imagesPerPrompt, C = this.gridCols;
                const retryCount = {};
                const deferredFailures = []; // prompts falhados para retentar no final
                let cumulativeRows = 0; // linhas totais de lotes anteriores

                for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                    if (this.shouldStop) break;
                    const batch = batches[bIdx];
                    const totalN = batch.length * N;
                    const rowsThis = Math.ceil(totalN / C);

                    batch.forEach(p => this.updatePromptItemStatus(
                        this.prompts.findIndex(x => x.promptNum === p.promptNum), 'active'
                    ));
                    this.updateProgress(bIdx / batches.length);
                    this.updateMini(
                        `Lote ${bIdx+1}/${batches.length}`,
                        batch.map(p => `#${p.promptNum}`).join(' + '),
                        bIdx / batches.length,
                        `${this.genMode === 'scenes' ? 'Cenas' : this.genMode === 'refs' ? 'Referências' : 'Livre'} • ${N} imgs/prompt • ${this.batchSize} simult.`
                    );
                    this.logDebug(`\n╭─── LOTE ${bIdx+1}/${batches.length}: prompts ${batch.map(p=>p.promptNum).join(', ')} ───╮`, 'info');

                    // 1. Snapshot
                    const beforeUuids = this.snapshotImageUuids();

                    // 2. Submit com stagger
                    this.setStatus('info', `⚡ Submetendo lote ${bIdx+1}/${batches.length}...`);
                    for (let pi = 0; pi < batch.length; pi++) {
                        if (this.shouldStop) break;
                        const ok = await this.prepareAndSubmit(batch[pi]);
                        // Um prompt que falha NAO derruba o resto do lote: marca falha e segue.
                        if (!ok) {
                            const gi = (this.videoIsRunning ? this.videoPrompts : this.prompts)
                                .findIndex(x => x.promptNum === batch[pi].promptNum);
                            if (this.videoIsRunning) this.updateVideoPromptItemStatus(gi, 'error', 'pulado');
                            else this.updatePromptItemStatus(gi, 'error', 'pulado');
                            (this.videoIsRunning ? this.logVideoDebug : this.logDebug)
                                .call(this, '⏭️ Prompt ' + batch[pi].promptNum + ' pulado; a fila SEGUE.', 'warning');
                        }
                        if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    if (this.shouldStop) break;
                    await this.dynamicSleep([1200, 1800]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    await this.waitForMatrix(matrix, beforeUuids);
                    if (this.shouldStop) break;

                    // 4. Retry falhas (parciais ou totais)
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        const loadedCount = slots.filter(s => s.state === 'loaded').length;
                        if (loadedCount < N) {
                            const missing = N - loadedCount;
                            this.logDebug(`⚠️ Prompt ${prompt.promptNum}: gerou ${loadedCount}/${N} (faltam ${missing})`, 'warning');
                            failedPrompts.push(prompt);
                        }
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        const gi = this.prompts.findIndex(x => x.promptNum === key);

                        // ── Deferred retry: guardar para o final ──
                        if (this.deferRetry) {
                            this.logDebug(`⏸️ Prompt ${key}: falhou — guardado para retentar no final`, 'warning');
                            this.updatePromptItemStatus(gi, 'retrying', 'adiado');
                            deferredFailures.push(fp);
                            continue;
                        }

                        // ── Retry imediato (comportamento original) ──
                        if (!retryCount[key]) retryCount[key] = 0;
                        let recovered = false;
                        const maxRetries = Number.isInteger(this.maxPromptRetries)
    ? this.maxPromptRetries
    : CONFIG.MAX_RETRIES;

while (retryCount[key] < maxRetries && !this.shouldStop) {
                            retryCount[key]++;
                            this.logDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updatePromptItemStatus(gi, 'retrying', `${retryCount[key]}/${maxRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updatePromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                break;
                            }
                        }
                        if (!recovered) this.updatePromptItemStatus(gi, 'error', `falhou`);
                    }

                    // Marca prompts do lote como done
                    batch.forEach(p => {
                        const gi = this.prompts.findIndex(x => x.promptNum === p.promptNum);
                        const slots = matrix.filter(s => s.promptNum === p.promptNum);
                        if (slots.filter(s => s.state === 'loaded').length >= N) this.updatePromptItemStatus(gi, 'done');
                    });

                    allMatrices.push(matrix);

                    // ── Enum por bloco (se ativo) ──
                    const autoNameImages = document.getElementById('flow-auto-name-scenes')?.checked;
                    if (this.enumMode === 'block' && this.genMode === 'scenes' && autoNameImages && !this.shouldStop) {
                        if (this.approveBeforeEnum) {
                            // Pausa para aprovação
                            this.setStatus('info', `✅ Lote ${bIdx+1}/${batches.length} concluído. Aprovar enumeração?`);
                            const approved = await this.waitForBlockApproval(bIdx + 1, batches.length);
                            if (approved === 'stop') { this.shouldStop = true; break; }
                            if (approved === 'approve') {
                                await this.autoAssignScenesFromMatrices([matrix], { isVideo: false });
                            }
                            // 'skip' = não enumera, continua
                        } else {
                            await this.autoAssignScenesFromMatrices([matrix], { isVideo: false });
                        }
                    }

                    if (bIdx < batches.length - 1) await this.esperaFixa(CONFIG.DELAY_BETWEEN_BATCHES[0]);
                }

                // ══════ DEFERRED RETRY: retentar falhas acumuladas ══════
                if (deferredFailures.length > 0 && !this.shouldStop) {
                    this.logDebug(`\n╔═══ RETENTANDO ${deferredFailures.length} PROMPT(S) ADIADO(S) ═══╗`, 'info');
                    this.setStatus('info', `🔄 Retentando ${deferredFailures.length} prompt(s) que falharam...`);

                    const maxRetries = Number.isInteger(this.maxPromptRetries) ? this.maxPromptRetries : CONFIG.MAX_RETRIES;

                    for (let di = 0; di < deferredFailures.length && !this.shouldStop; di++) {
                        const fp = deferredFailures[di];
                        const key = fp.promptNum;
                        const gi = this.prompts.findIndex(x => x.promptNum === key);
                        let recovered = false;

                        this.setStatus('info', `🔄 Retry adiado ${di+1}/${deferredFailures.length} — Prompt ${key}`);

                        for (let attempt = 1; attempt <= maxRetries && !this.shouldStop; attempt++) {
                            this.logDebug(`🔄 Retry adiado: prompt ${key} — tentativa ${attempt}/${maxRetries}`, 'info');
                            this.updatePromptItemStatus(gi, 'retrying', `${attempt}/${maxRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updatePromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                this.logDebug(`✅ Prompt ${key} recuperado no retry adiado!`, 'success');
                                break;
                            }
                        }
                        if (!recovered) {
                            this.updatePromptItemStatus(gi, 'error', 'falhou');
                            this.logDebug(`❌ Prompt ${key} falhou mesmo após retries adiados`, 'error');
                        }
                        if (di < deferredFailures.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    this.logDebug(`╚═══ FIM DOS RETRIES ADIADOS ═══╝`, 'info');
                }

                if (!this.shouldStop) {
                    this.updateProgress(1);
                    const doneCount = document.querySelectorAll('.flow-prompt-item.done').length;
                    const errCount = document.querySelectorAll('.flow-prompt-item.error').length;
                    const failedList = this.prompts.filter((_, i) =>
                        document.querySelector(`.flow-prompt-item[data-index="${i}"]`)?.classList.contains('error')
                    );

                    let statusMsg = `✅ Geração concluída! ${doneCount} sucesso(s)`;
                    if (errCount) statusMsg += `, ${errCount} falha(s)`;
                    statusMsg += '.';
                    if (this.genMode !== 'free') statusMsg += ' Arraste os nomes para atribuir às imagens.';
                    this.setStatus('success', statusMsg);

// Mostra painel de atribuição / nomeia automaticamente (modo 'end')
if (this.genMode === 'refs') {
    this.showAssignPanel(allMatrices);
} else if (this.genMode === 'scenes') {
    this.showAssignPanel(allMatrices);

    // Só enumera no final se enumMode === 'end'
    if (this.enumMode === 'end') {
        const autoNameImages = document.getElementById('flow-auto-name-scenes')?.checked;
        if (autoNameImages) {
            await this.autoAssignScenesFromMatrices(allMatrices, { isVideo: false });
        }
    }
}
                    // Popup com detalhes de falhas
                    let popupMsg = `${doneCount} prompt(s) gerado(s) com sucesso.`;
                    if (this.genMode === 'refs') popupMsg += '\n\nArraste as referências do painel superior para as imagens desejadas.';
                    else if (this.genMode === 'scenes') popupMsg += '\n\nArraste as cenas do painel superior para as imagens desejadas.';

                    // Coleta mídias geradas nesta execução
                    this._lastRunMedia = allMatrices.flatMap(m =>
                        m.filter(s => s.state === 'loaded' && s.src).map(s => ({
                            src: s.src, workflowId: s.workflowId, uuid: s.uuid, promptNum: s.promptNum, isVideo: false
                        }))
                    );
                    this.showCompletionPopup(popupMsg, failedList.length > 0 ? failedList : null);
                } else {
                    this.setStatus('warning', '⏹ Automação interrompida.');
                }

            } catch (err) {
                this.setStatus('error', '❌ Erro: ' + err.message); if (err.uncertainSubmission) this.saveRunState(this._modernCurrentPrompt || 1);
                log.error('Pipeline error:', err);
            }

            this.isRunning = false;
            if (!this._modernUncertain) this.clearRunState(); // Preserve uncertain submissions for review.
            document.getElementById('flow-start-btn').disabled = false;
            document.getElementById('flow-stop-btn').disabled  = true;
            document.getElementById('flow-prompts-input').disabled = false;
            document.getElementById('flow-mini').style.display = 'none';
            document.getElementById('flow-sidebar').style.display = '';
        }

        stop() { this.shouldStop = true; this.setStatus('warning', '⏹ Parando...'); }

        // ──────────────────────────────────────────────
        // VALIDAÇÃO DE REFERÊNCIAS
        // ──────────────────────────────────────────────
async renameUploadReferencesFromFilenames() {
    const btn = document.getElementById('flow-fix-upload-refs-btn');
    const originalText = btn?.textContent || '🧹 Corrigir uploads para referências';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Escaneando uploads...';
    }

    try {
        if (!_authToken) {
            this.setStatus('warning', 'Token ainda não capturado. Faça uma ação no Flow e tente novamente.');
            return;
        }

        const scroller = this.getScroller();
        if (!scroller) {
            this.setStatus('error', 'Scroller da galeria não encontrado.');
            return;
        }

        const checked = new Set();
        let renamed = 0;
        let skipped = 0;
        let failed = 0;
        let samePositionCount = 0;

        this.setStatus('info', '🧹 Corrigindo uploads para o padrão de referência...');
        this.logDebug('Iniciando correção reforçada de uploads para referências...', 'info');

        // Começa do final da galeria
        scroller.scrollTop = scroller.scrollHeight;
        await this.sleep(1200);

        for (let iter = 0; iter < 900; iter++) {
            const visibleTiles = [...document.querySelectorAll('[data-tile-id]')];

            const uniqueTiles = new Map();

            for (const el of visibleTiles) {
                const tile = el.querySelector('a[href*="/edit/"]') ? el : (el.querySelector('[data-tile-id]') || el);
                const workflowId = this.getWorkflowIdFromTile(tile);

                if (!workflowId) continue;
                if (uniqueTiles.has(workflowId)) continue;

                uniqueTiles.set(workflowId, tile);
            }

            for (const [workflowId, tile] of uniqueTiles.entries()) {
                if (checked.has(workflowId)) continue;
                checked.add(workflowId);

                if (!this.isTileLoaded(tile)) {
                    skipped++;
                    continue;
                }

                // Referências são imagens. Não mexe em vídeo.
                if (this.isVideoTile(tile)) {
                    skipped++;
                    continue;
                }

                const currentName = await this.getTileName(tile);
                const cleanName = this.cleanUploadReferenceName(currentName);

                if (!cleanName) {
                    skipped++;
                    continue;
                }

                const newName = cleanName + CONFIG.REF_SUFFIX;

                this.logDebug(`Renomeando referência: "${currentName}" → "${newName}"`, 'info');

                const okRename = await this.apiRename(workflowId, newName);
                const okFav = await this.apiFavorite(workflowId, true);

                if (okRename && okFav) {
                    renamed++;

                    const lowerKey = cleanName.toLowerCase().trim();
                    const refKey = this.referenceKey(cleanName);

                    this.validatedRefs[lowerKey] = true;
                    this.validatedRefs[refKey] = true;

                    this.refAssignments.set(cleanName, workflowId);
                    this.tileAssignments.set(workflowId, {
                        label: cleanName,
                        type: 'ref',
                        name: cleanName
                    });

                    const outer = tile.closest('[data-tile-id]') || tile;
                    this.addLabelToTile(outer, cleanName, workflowId, 'ref', cleanName);

                    this.logDebug(`✅ Referência pronta: ${cleanName}`, 'success');

                    if (btn) {
                        btn.textContent = `⏳ ${renamed} corrigida(s)...`;
                    }

                    await this.sleep(450);
                } else {
                    failed++;
                    this.logDebug(`❌ Falha ao renomear "${currentName}"`, 'error');
                }
            }

            const prev = Math.round(scroller.scrollTop);

            // Scroll mais forte e mais lento para a galeria virtualizada carregar os próximos cards
            const step = Math.max(180, Math.floor(scroller.clientHeight * 0.45));
            scroller.scrollTop = Math.max(0, scroller.scrollTop - step);

            await this.sleep(1000);

            const now = Math.round(scroller.scrollTop);

            if (now === prev) {
                samePositionCount++;
            } else {
                samePositionCount = 0;
            }

            // Chegou no topo e não anda mais
            if (now <= 0 && samePositionCount >= 2) break;
        }

        this.saveValidatedRefs();
        this.updateReferences();
        this.updateVideoReferences();

        if (renamed > 0) {
            this.startLabelObserver();
            this.setStatus(
                'success',
                `✅ ${renamed} referência(s) corrigida(s). ${failed ? `${failed} falha(s).` : ''}`
            );
        } else {
            this.setStatus(
                'warning',
                'Nenhum upload novo foi corrigido. Verifique se os cards estão carregados e se os nomes ainda não estavam no padrão de referência.'
            );
        }

        this.logDebug(
            `Correção finalizada: ${renamed} corrigido(s), ${skipped} ignorado(s), ${failed} falha(s), ${checked.size} tile(s) verificado(s).`,
            'info'
        );

    } catch (err) {
        this.setStatus('error', 'Erro ao corrigir uploads: ' + err.message);
        this.logDebug('Erro ao corrigir uploads: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}
        async validateReferences(source = 'images') {
            const isVideo = source === 'video';
            const btnId = isVideo ? 'fv-validate-btn' : 'flow-validate-btn';
            const inputId = isVideo ? 'fv-prompts-input' : 'flow-prompts-input';
            const statusFn = isVideo ? (t, m) => this.setVideoStatus(t, m) : (t, m) => this.setStatus(t, m);
            const updateFn = isVideo ? () => this.updateVideoReferences() : () => this.updateReferences();

            const btn = document.getElementById(btnId);
            btn.disabled = true; btn.textContent = '⏳ Escaneando galeria...';
            try {
               const text = document.getElementById(inputId).value;
const prompts = parsePromptsText(text);
const refs = extractReferences(prompts);

if (!refs.length) {
    updateFn();
    btn.disabled = false;
    btn.textContent = '🔍 Validar referências na galeria';
    return;
}

// Carrega cache salvo e mistura com o estado atual
this.validatedRefs = {
    ...this.loadValidatedRefs(),
    ...this.validatedRefs
};

// Se alguma referência já foi validada antes, ela não precisa ser escaneada de novo
const cachedFound = refs.filter(r =>
    this.validatedRefs[r.toLowerCase().trim()] === true ||
    this.validatedRefs[this.referenceKey(r)] === true
);

const pending = new Map();

for (const ref of refs) {
    const lowerKey = ref.toLowerCase().trim();
    const refKey = this.referenceKey(ref);

    const alreadyValid =
        this.validatedRefs[lowerKey] === true ||
        this.validatedRefs[refKey] === true;

    if (!alreadyValid) {
        pending.set(refKey, ref);
    }
}

const found = new Set(cachedFound.map(r => this.referenceKey(r)));

if (!pending.size) {
    updateFn();
    statusFn('success', `✅ Todas as ${refs.length} referências já estavam validadas!`);
    btn.disabled = false;
    btn.textContent = '🔍 Validar referências na galeria';
    return;
}
                const checkedTileIds = new Set();
                const scroller = this.getScroller();
                if (!scroller) throw new Error('Scroller não encontrado');
                scroller.scrollTop = scroller.scrollHeight; await this.sleep(600);
                for (let iter = 0; iter < 200 && pending.size > 0; iter++) {
                    const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                    for (const tile of tiles) {
                        if (!pending.size) break;
                        const id = tile.getAttribute('data-tile-id');
                        if (checkedTileIds.has(id)) continue;
                        checkedTileIds.add(id);
                        const name = await this.getTileName(tile);
                        if (!name) continue;
                        const lc = this.referenceKey(name);

if (pending.has(lc)) {
    const originalName = pending.get(lc);
    pending.delete(lc);
    found.add(lc);

    btn.textContent = `⏳ ${found.size}/${refs.length}`;
    const wfId = this.getWorkflowIdFromTile(tile);
                            if (wfId) {
                                const outer = tile.closest('[data-tile-id]') || tile;
                                this.tileAssignments.set(wfId, { label: originalName, type: 'ref', name: originalName });
                                this.addLabelToTile(outer, originalName, wfId, 'ref', originalName);
                            }
                        }
                    }
                    const prev = scroller.scrollTop;
                    scroller.scrollTop = Math.max(0, scroller.scrollTop - 350); await this.sleep(400);
                    if (scroller.scrollTop === 0 && prev === 0) break;
                }
              for (const ref of refs) {
    const lowerKey = ref.toLowerCase().trim();
    const refKey = this.referenceKey(ref);

    if (found.has(refKey)) {
        this.validatedRefs[lowerKey] = true;
        this.validatedRefs[refKey] = true;
    } else {
        this.validatedRefs[lowerKey] = false;
        this.validatedRefs[refKey] = false;
    }
}

this.saveValidatedRefs();
updateFn();
                if (!pending.size) statusFn('success', `✅ Todas as ${refs.length} referências encontradas!`);
                else statusFn('error', `❌ Não encontradas: ${[...pending.values()].join(', ')}`);
                scroller.scrollTop = 0;
                if (found.size > 0) this.startLabelObserver();
            } catch (err) { statusFn('error', 'Erro: ' + err.message); }
            btn.disabled = false; btn.textContent = '🔍 Validar referências na galeria';
        }

       async getTileName(tile) {
    tile.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
    tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles:true }));
    await this.sleep(350);

    const UI = [
        'favorite','redo','more_vert','image','warning','refresh','delete_forever','undo',
        'play_arrow','pause','download',
        'Adicionar aos favoritos','Reutilizar comando','Mais',
        'Add to favorites','Reuse prompt','More',
        'Falha','Ops!','Tentar novamente','Excluir',
        'Failed','Oops!','Retry','Delete'
    ];

    let nome = null;

    for (let t = 0; t < 5; t++) {
        for (const div of tile.querySelectorAll('div')) {
            // Ignora labels visuais criadas pela própria extensão
            if (div.closest('.flow-tile-label')) continue;
            if (div.closest('.flow-assign-item')) continue;

            const text = div.textContent?.trim();

            if (!text || text.length < 1 || text.length > 80) continue;
            if ([...div.querySelectorAll('div')].some(c => c.textContent?.trim())) continue;
            if (div.querySelector('i, svg, button')) continue;
            if (UI.some(u => text === u)) continue;

            nome = text;
            break;
        }

        if (nome) break;
        await this.sleep(100);
    }

    tile.dispatchEvent(new MouseEvent('mouseleave', { bubbles:true }));
    tile.dispatchEvent(new MouseEvent('mouseout', { bubbles:true }));
    await this.sleep(80);

    return nome;
}

        // ──────────────────────────────────────────────
        // PAINEL DE ATRIBUIÇÃO (Drag & Drop)
        // ──────────────────────────────────────────────
        getSceneVariationCountsFromMatrices(allMatrices) {
    const counts = new Map();
    const seen = new Set();

    const slots = (allMatrices || [])
        .flatMap(m => Array.isArray(m) ? m : [])
        .filter(Boolean);

    for (const slot of slots) {
        if (slot.state !== 'loaded') continue;

        const sceneNum = Number(slot.promptNum || 0);
        if (!sceneNum) continue;

        const uniqueKey =
            slot.workflowId ||
            slot.uuid ||
            slot.src ||
            `${slot.row}:${slot.col}:${slot.promptNum}:${slot.imgNum}`;

        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        counts.set(sceneNum, (counts.get(sceneNum) || 0) + 1);
    }

    return counts;
}

formatSceneNameWithVariationCount(sceneName, variationCounts) {
    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
    const count = variationCounts?.get(sceneNum) || 0;

    return `${sceneName} (${count})`;
}

        // ──────────────────────────────────────────────
        // ADD-ON: ENUMERAÇÃO AUTOMÁTICA (renomear pelo início do prompt)
        // ──────────────────────────────────────────────

        /** Núcleo: limpa um texto (prompt ou nome do Flow) para virar um nome curto. */
        cleanPromptToName(text) {
            let base = (text || '').trim();
            base = base.replace(/^\{[^}]*\}\s*/, '');        // remove {cena X}
            base = base.replace(/^\s*\d+\s*[\-.):]\s*/, '');  // remove "11-" / "11." / "11)"
            base = base.replace(/\[[^\]]*\]/g, ' ');          // remove [ref]
            base = base.replace(/<voz:[^>]*>/gi, ' ');        // remove <voz:...>
            base = base.replace(/\s+/g, ' ').trim();
            const words = base.split(' ').filter(Boolean).slice(0, 8).join(' ');
            return words.substring(0, 50).trim();
        }

        /** Deriva o nome a partir do início do prompt (compat.). */
        promptStartName(prompt, imgNum) {
            const clean = this.cleanPromptToName(prompt?.text) || `Cena ${prompt?.promptNum ?? ''}`.trim();
            return imgNum ? `${clean} ${imgNum}` : clean;
        }

        /** Palavras significativas de um texto (para comparar título x prompt). */
        _sigWords(s) {
            const combining = new RegExp('[\\u0300-\\u036f]', 'g'); // acentos (só-ASCII no source)
            return (s || '').toLowerCase()
                .normalize('NFD').replace(combining, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/).filter(w => w.length > 2);
        }

        /** Acha, entre os prompts que você enviou, o mais parecido com o título da mídia (coef. de Dice). */
        matchPromptForTitle(title, prompts) {
            const tw = new Set(this._sigWords(title));
            if (!tw.size) return null;
            let best = null, bestScore = 0;
            for (const p of prompts) {
                const pw = this._sigWords(this.cleanPromptToName(p.text) || p.text);
                if (!pw.length) continue;
                let hit = 0; const seen = new Set();
                for (const w of pw) { if (tw.has(w) && !seen.has(w)) { hit++; seen.add(w); } }
                const score = (2 * hit) / (pw.length + tw.size);  // Dice
                if (score > bestScore) { bestScore = score; best = p; }
            }
            return bestScore >= 0.34 ? best : null;
        }

        /**
         * Renomeia automaticamente todas as imagens geradas.
         * Funciona direto no DOM (não depende de rodada da sessão), então roda
         * em projetos JÁ FINALIZADOS: lê o nome (=prompt) de cada imagem, agrupa
         * as variações da mesma cena e renomeia numerando.
         */
        async autoEnumerarCenas() {
            const buttons = ['flow-assign-auto', 'flow-auto-enumerate-btn'].map(id => document.getElementById(id)).filter(Boolean);
            buttons.forEach(b => b.disabled = true);

            try {
                // Mapa EXATO da rodada (fallback pra mídias cujo prompt não seja legível no DOM)
                const exactByWf = new Map();
                for (const slot of (this._lastMatrices || []).flatMap(m => Array.isArray(m) ? m : [])) {
                    if (slot && slot.state === 'loaded' && slot.workflowId && slot.promptNum) {
                        exactByWf.set(slot.workflowId, String(slot.promptNum));
                    }
                }

                // COLETA varrendo a PÁGINA TODA. Para cada mídia, lê a CENA direto do
                // prompt guardado no tile ("97.2 - ..." -> cena 97.2). Confiável e exato.
                this.setStatus('info', '⚡ Varrendo a página...');
                const scroller = this.findFlowScroller();
                const scrollEl = scroller || document.scrollingElement || document.documentElement;
                if (scroller) scroller.scrollTop = 0; else window.scrollTo(0, 0);
                await this.sleep(600);

                const collected = [];      // ordem de aparição (topo -> baixo)
                const seen = new Set();
                let guard = 0, stuck = 0;
                while (guard++ < 500) {
                    for (const link of document.querySelectorAll('a[href*="/edit/"]')) {
                        const tile = link.closest('[data-tile-id]');
                        if (!tile) continue;
                        const wf = this.getWorkflowIdFromTile(tile);
                        if (!wf || seen.has(wf)) continue;
                        if (!this.isTileLoaded(tile)) continue;
                        seen.add(wf);
                        const isVid = this.isVideoTile(tile);
                        const sceneNum = this.sceneNumFromTile(tile) || exactByWf.get(wf) || null;
                        collected.push({ wf, isVid, sceneNum });
                        this.setStatus('info', `⚡ Varrendo... ${collected.length} mídias`);
                    }
                    const before = scrollEl.scrollTop;
                    scrollEl.scrollTop = before + Math.max(300, Math.floor(scrollEl.clientHeight * 0.8));
                    await this.sleep(450);
                    const bottom = scrollEl.scrollTop <= before + 2 ||
                        (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4);
                    if (bottom) { if (++stuck >= 2) break; } else stuck = 0;
                }
                if (!collected.length) { this.setStatus('warning', 'Nenhuma mídia encontrada na página.'); return; }

                // Agrupa por CENA (o número lido do prompt) e numera as gerações (Vídeo/Imagem 1,2,...)
                const counters = new Map();
                const plan = [];  // {wf, sceneNum, g, isVid}
                let semCena = 0;
                for (const it of collected) {
                    if (it.sceneNum == null) { semCena++; continue; }
                    const g = (counters.get(it.sceneNum) || 0) + 1;
                    counters.set(it.sceneNum, g);
                    plan.push({ wf: it.wf, sceneNum: it.sceneNum, g, isVid: it.isVid });
                }
                if (!plan.length) {
                    this.setStatus('warning', 'Não consegui ler o número da cena nos prompts das mídias.');
                    return;
                }

                // Renomeia conforme o plano (e vai marcando como CONCLUÍDO)
                this._resetAutoResults();
                let done = 0, fail = 0, vids = 0, imgs = 0;
                for (const it of plan) {
                    const tipo = it.isVid ? 'Vídeo' : 'Imagem';
                    const newName = `Cena ${it.sceneNum} - ${tipo} ${it.g}`;
                    const ok = await this.apiRename(it.wf, newName);
                    await this.apiFavorite(it.wf, true);   // ⭐ favorita = "concluído"
                    if (ok) {
                        done++; if (it.isVid) vids++; else imgs++;
                        this.tileAssignments.set(it.wf, { label: newName, type: 'scene', scene: `Cena ${it.sceneNum}`, imgNum: it.g });
                        const link = document.querySelector(`a[href*="/edit/${it.wf}"]`);
                        const tile = link ? link.closest('[data-tile-id]') : null;
                        if (tile) this.addLabelToTile(tile, newName, it.wf, 'scene', `Cena ${it.sceneNum}`);
                        // marca como concluído: lista verde + chip do painel (se existir) + risca
                        this._addAutoResult(newName);
                        this.updateAssignItemUI(`Cena ${it.sceneNum}`, true);
                        this.setStatus('info', `⚡ Renomeando e concluindo... ${done}/${plan.length}`);
                    } else fail++;
                }
                this.updateAssignCount();

                this.startLabelObserver();
                const mediaWord = (vids && !imgs) ? 'vídeo(s)' : ((imgs && !vids) ? 'imagem(ns)' : 'mídia(s)');
                if (done === 0 && fail > 0) {
                    this.setStatus('error', 'Não consegui renomear (token não capturado?). Clique numa mídia e tente de novo.');
                } else {
                    this.setStatus('success', `⚡ ${counters.size} cena(s), ${done} ${mediaWord} renomeada(s)` +
                        (semCena ? `, ${semCena} sem número` : '') + (fail ? `, ${fail} falharam` : '') + '.');
                }
                this.logDebug(`Enumeração: ${counters.size} cenas, ${done} renomeadas, ${semCena} sem número, ${fail} falhas.`, done ? 'success' : 'error');
            } catch (err) {
                this.setStatus('error', 'Erro na enumeração automática: ' + (err?.message || err));
                this.logDebug('Erro autoEnumerarCenas: ' + (err?.message || err), 'error');
            } finally {
                buttons.forEach(b => b.disabled = false);
            }
        }

        /**
         * Lê o PROMPT completo guardado no tile (campo interno "subtitle" do React).
         * É onde fica o texto real do prompt, que começa com o número da cena
         * (ex: "97.2 - Reference set..."). Rápido: não precisa hover nem abrir o vídeo.
         */
        getPromptSubtitleFromTile(tile) {
            if (!tile) return null;
            const key = Object.keys(tile).find(k => k.startsWith('__reactFiber$'));
            let fiber = key ? tile[key] : null;
            let hops = 0;
            while (fiber && hops < 60) {
                hops++;
                for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
                    if (bag && typeof bag === 'object') {
                        const stack = [[bag, 0]]; let steps = 0;
                        while (stack.length && steps < 200) {
                            steps++;
                            const [o, d] = stack.pop();
                            if (!o || typeof o !== 'object' || d > 3) continue;
                            for (const k of Object.keys(o)) {
                                const v = o[k];
                                if (typeof v === 'string' && v.length > 20 &&
                                    (k === 'subtitle' || /^\s*\d+(?:\.\d+)?\s*[-.]\s/.test(v))) {
                                    return v;
                                } else if (v && typeof v === 'object') {
                                    stack.push([v, d + 1]);
                                }
                            }
                        }
                    }
                }
                fiber = fiber.return;
            }
            return null;
        }

        /** Número da cena lido do início do prompt do tile (ex: "97.2 - ..." -> "97.2"). */
        sceneNumFromTile(tile) {
            const sub = this.getPromptSubtitleFromTile(tile);
            if (!sub) return null;
            const m = sub.match(/^\s*(\d+(?:\.\d+)?)/);
            return m ? m[1] : null;
        }

        /** Número da cena a partir do prefixo "N-"/"N."/"N)" do prompt (fallback: promptNum). */
        sceneNumFromPrompt(p) {
            if (!p) return null;
            const m = (p.text || '').match(/^\s*(\d+(?:\.\d+)?)\s*[\-.):]/);
            if (m) return m[1];
            return (p.promptNum != null) ? String(p.promptNum) : null;
        }

        /** Acha o container de scroll do Flow (ignora os painéis da própria extensão). */
        findFlowScroller() {
            const els = [...document.querySelectorAll('div')].filter(el => {
                if (el.closest('[id^="flow-"]')) return false;                  // UI da extensão
                if ((el.className || '').toString().includes('flow-')) return false;
                const s = getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 50;
            });
            els.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
            return els[0] || null;
        }

        /** Zera a lista de "Concluídas" e mostra o quadro. */
        _resetAutoResults() {
            const list = document.getElementById('flow-auto-results-list');
            const box = document.getElementById('flow-auto-results');
            const head = document.getElementById('flow-auto-results-head');
            if (list) list.innerHTML = '';
            if (box) box.style.display = '';
            if (head) head.textContent = 'Concluídas: 0';
        }

        /** Adiciona uma linha verde "✅ <nome>" na lista de concluídas e atualiza o contador. */
        _addAutoResult(name) {
            const list = document.getElementById('flow-auto-results-list');
            const head = document.getElementById('flow-auto-results-head');
            if (!list) return;
            const row = document.createElement('div');
            row.style.cssText = 'font-size:12px;color:#166534;background:#dcfce7;border-radius:6px;padding:3px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            row.textContent = '✅ ' + name;
            list.appendChild(row);
            list.scrollTop = list.scrollHeight;
            if (head) head.textContent = `Concluídas: ${list.children.length}`;
        }

        /** Recolore os itens do painel conforme a meta (verde = concluída) e atualiza a contagem. */
        repaintCompletion() {
            const target = parseInt(document.getElementById('flow-imgs-per-prompt')?.value, 10) || 0;
            let complete = 0, totalScenes = 0;
            for (const item of document.querySelectorAll('.flow-assign-item[data-type="scene"]')) {
                totalScenes++;
                const sceneName = item.dataset.scene;
                const count = (this.sceneAssignments.get(sceneName) || []).length;
                const isComplete = target > 0 && count >= target;
                item.classList.toggle('complete', isComplete);
                item.classList.toggle('missing', count === 0);
                if (isComplete) complete++;
                const status = item.querySelector('.assign-status');
                if (status) status.textContent = isComplete ? '✅' : (count > 0 ? `${count}/${target || '?'}` : '⏳');
            }
            const el = document.getElementById('flow-assign-count');
            if (el && totalScenes) el.textContent = `${complete}/${totalScenes} concluídas`;
        }

        showAssignPanel(allMatrices) {
            this._videoAssignActive = false;
            const panel = document.getElementById('flow-assign-panel');
            const title = document.getElementById('flow-assign-title');
            const items = document.getElementById('flow-assign-items');
            const dlBtn = document.getElementById('flow-assign-download');
            const variationCounts = this.getSceneVariationCountsFromMatrices(allMatrices);
            this._lastMatrices = allMatrices || [];   // ADD-ON: usado pela Enumeração Automática
            const autoBtn = document.getElementById('flow-assign-auto');
            if (autoBtn) autoBtn.style.display = 'inline-flex'; // ADD-ON: sempre disponível (funciona no DOM)

            items.innerHTML = '';

            if (this.genMode === 'refs') {
                title.textContent = 'Atribuir Referências';
                const previewEl = document.getElementById('flow-assign-preview');
                if (previewEl) previewEl.style.display = 'none';
                const rlBar = document.getElementById('flow-assign-reload-bar');
                if (rlBar) rlBar.classList.remove('visible');
                dlBtn.style.display = 'none';
                for (const name of this.refNames) {
                    const item = document.createElement('div');
                    item.className = 'flow-assign-item';
                    item.draggable = true;
                    item.dataset.type = 'ref';
                    item.dataset.name = name;
                    item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(name)}</span><span class="assign-status">⏳</span>`;
                    item.addEventListener('dragstart', e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'ref', name }));
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    items.appendChild(item);
                }
            } else if (this.genMode === 'scenes') {
                title.textContent = 'Atribuir Cenas';
                const previewEl = document.getElementById('flow-assign-preview');
                if (previewEl) { previewEl.style.display = 'none'; }
                dlBtn.style.display = 'inline-flex';
                const rlBar2 = document.getElementById('flow-assign-reload-bar'); if (rlBar2) rlBar2.classList.remove('visible');
                
                // INJEÇÃO ADD-ON: Numeração Fiel
                for (const [sceneName] of this.sceneAssignments) {
                    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                    const prompt = this.prompts.find(p => p.promptNum === sceneNum);
                    const promptText = prompt?.text || '';

                    const item = document.createElement('div');
                    item.className = 'flow-assign-item';
                    item.draggable = true;
                    item.dataset.type = 'scene';
                    item.dataset.scene = sceneName;
                    item.dataset.sceneNum = sceneNum;
                    const displaySceneName = this.formatSceneNameWithVariationCount(sceneName, variationCounts);
                    // ADD-ON: cor por meta variável (verde = atingiu "Imagens por prompt"; apagado = nenhuma)
                    {
                        const _gen = variationCounts.get(sceneNum) || 0;
                        const _target = parseInt(document.getElementById('flow-imgs-per-prompt')?.value, 10) || 0;
                        if (_target > 0 && _gen >= _target) item.classList.add('complete');
                        else if (_gen === 0) item.classList.add('missing');
                    }

item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(displaySceneName)}</span><span class="assign-status">⏳</span>`;
item.title = `${sceneName}: ${variationCounts.get(sceneNum) || 0} variação(ões) encontrada(s)`;
                    item.addEventListener('mouseenter', () => {
                        const preview = document.getElementById('flow-assign-preview');
                        if (preview) {
                            preview.style.display = '';
                            preview.querySelector('.preview-label').textContent = sceneName + ': ';
                            preview.querySelector('.preview-text').textContent = promptText.substring(0, 300) + (promptText.length > 300 ? '...' : '');
                        }
                    });
                    item.addEventListener('mouseleave', () => {
                        const preview = document.getElementById('flow-assign-preview');
                        if (preview) preview.style.display = 'none';
                    });
                    item.addEventListener('dragstart', e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'scene', sceneNum, sceneName }));
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    items.appendChild(item);
                }
            }

            panel.classList.add('active');
            panel.classList.remove('minimized');
            document.getElementById('flow-assign-toggle').textContent = '▲';
            const reopenBtn = document.getElementById('flow-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            this.updateAssignCount();
            this.updateScrollerPadding();
        }

        hideAssignPanel() {
            document.getElementById('flow-assign-panel').classList.remove('active');
            // Mostra o botão reopen correto
            if (this._videoAssignActive) {
                const reopenBtn = document.getElementById('fv-reopen-assign');
                if (reopenBtn) reopenBtn.style.display = '';
            } else {
                const reopenBtn = document.getElementById('flow-reopen-assign');
                if (reopenBtn) reopenBtn.style.display = '';
            }
            this.updateScrollerPadding();
        }

        reopenAssignPanel() {
            document.getElementById('flow-assign-panel').classList.add('active');
            const reopenBtn = document.getElementById('flow-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            const fvReopenBtn = document.getElementById('fv-reopen-assign');
            if (fvReopenBtn) fvReopenBtn.style.display = 'none';
            this.updateScrollerPadding();
        }

        /** Abre painel de atribuição com referências detectadas nos prompts */
        openAssignRefsFromDetected() {
            const text = document.getElementById('flow-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs = extractReferences(prompts);
            if (!refs.length) { this.setStatus('warning', 'Nenhuma referência [nome] detectada nos prompts.'); return; }
            this.genMode = 'refs';
            this.refNames = refs;
            this.refAssignments = new Map();
            document.querySelectorAll('.flow-mode-btn[data-mode]').forEach(b => b.classList.remove('active'));
            const refsBtn = document.querySelector('.flow-mode-btn[data-mode="refs"]');
            if (refsBtn) refsBtn.classList.add('active');
            const descEl = document.getElementById('flow-mode-desc');
            if (descEl) descEl.textContent = 'Arraste cada referência para a imagem desejada.';
            this.showAssignPanel([]);
        }

        /** Abre painel de atribuição com referências detectadas nos prompts de vídeo */
        openVideoAssignRefsFromDetected() {
            const text = document.getElementById('fv-prompts-input').value;
            const prompts = parsePromptsText(text);
            const refs = extractReferences(prompts);
            if (!refs.length) { this.setVideoStatus('warning', 'Nenhuma referência [nome] detectada nos prompts de vídeo.'); return; }
            this.genMode = 'refs';
            this._videoAssignActive = true;
            this.refNames = refs;
            this.refAssignments = new Map();
            document.querySelectorAll('[data-vmode]').forEach(b => b.classList.remove('active'));
            this.showAssignPanel([]);
        }

        toggleAssignPanel() {
            const panel = document.getElementById('flow-assign-panel');
            const toggle = document.getElementById('flow-assign-toggle');
            panel.classList.toggle('minimized');
            toggle.textContent = panel.classList.contains('minimized') ? '▼' : '▲';
            toggle.classList.toggle('collapsed', panel.classList.contains('minimized'));
            this.updateScrollerPadding();
        }

        /**
         * Ajusta padding-top do scroller da galeria para que a primeira
         * linha de imagens não fique escondida atrás do painel de atribuição.
         */
        updateScrollerPadding() {
            setTimeout(() => {
                const panel = document.getElementById('flow-assign-panel');
                const scroller = this.getScroller();
                if (!scroller) return;

                const isVisible = panel.classList.contains('active') && !panel.classList.contains('minimized');
                if (isVisible) {
                    const panelHeight = panel.getBoundingClientRect().height;
                    scroller.style.paddingTop = (panelHeight + 8) + 'px';
                } else {
                    scroller.style.paddingTop = '';
                }
            }, 60);
        }

        updateAssignCount() {
            const el = document.getElementById('flow-assign-count');
            if (this.genMode === 'refs' && !this._videoAssignActive) {
                const total = this.refNames.length;
                const done = [...this.refAssignments.values()].filter(Boolean).length;
                el.textContent = `${done}/${total}`;
                const rlBar = document.getElementById('flow-assign-reload-bar');
                if (done >= total && total > 0) {
                    if (rlBar) rlBar.classList.add('visible');
                    this.setStatus('success', '✅ Todas as referências atribuídas! Atualize a página.');
                } else {
                    if (rlBar) rlBar.classList.remove('visible');
                }
            } else if (this._videoAssignActive) {
                // Vídeo scenes
                const total = this.videoSceneAssignments.size;
                const done = [...this.videoSceneAssignments.values()].filter(arr => arr.length > 0).length;
                el.textContent = `${done}/${total}`;
                const dlBtn = document.getElementById('flow-assign-download');
            } else if (this.genMode === 'scenes') {
                const total = this.sceneAssignments.size; // INJEÇÃO ADD-ON: Numeração Fiel
                const done = [...this.sceneAssignments.values()].filter(arr => arr.length > 0).length;
                el.textContent = `${done}/${total}`;
                const dlBtn = document.getElementById('flow-assign-download');
            }
        }

        // ──────────────────────────────────────────────
        // DRAG & DROP (event delegation no scroller)
        // ──────────────────────────────────────────────

        setupDragDrop() {
            // Usa delegação global — tiles são virtualizados
            document.addEventListener('dragover', e => {
                const tile = e.target.closest('flow-grid-tile-container, [data-tile-id]');
                if (tile) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    // Highlight só no tile que tem imagem
                    const inner = tile.querySelector('flow-grid-tile-container, [data-tile-id]') || tile;
                    document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
                    inner.classList.add('drop-hover');
                }
            });

            document.addEventListener('dragleave', e => {
                // Só remove se saiu do tile completamente
                const related = e.relatedTarget?.closest('flow-grid-tile-container, [data-tile-id]');
                const current = e.target.closest('flow-grid-tile-container, [data-tile-id]');
                if (current && current !== related) current.classList.remove('drop-hover');
            });

            document.addEventListener('drop', async e => {
                const tile = e.target.closest('flow-grid-tile-container, [data-tile-id]');
                if (tile) tile.classList.remove('drop-hover');
                if (!tile) return;
                e.preventDefault();

                let data;
                try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
                if (!data?.type) return;

                // Encontra inner tile (com imagem) e outer tile (para label)
                const innerTile = tile.querySelector('flow-grid-tile-container, [data-tile-id]') || tile;
                const workflowId = this.getWorkflowIdFromTile(innerTile);
                const outerTile = tile;
                document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
                if (!workflowId) { this.logDebug('Drop: workflowId não encontrado', 'error'); return; }

                if (data.type === 'ref') {
                    await this.assignReference(data.name, workflowId, outerTile);
                } else if (data.type === 'scene') {
                    await this.assignScene(data.sceneNum, data.sceneName, workflowId, outerTile);
                }
            });

            // Click handler para labels X (delegação)
            document.addEventListener('click', async e => {
                const xBtn = e.target.closest('.label-x');
                if (!xBtn) return;
                const label = xBtn.closest('.flow-tile-label');
                if (!label) return;
                const wfId = label.dataset.wf;
                const type = label.dataset.type;
                if (!wfId) return;

                // Remove atribuição
                if (!await this.apiRename(wfId, 'Imagem gerada')) return;
                await this.apiFavorite(wfId, false);
                label.remove();

                if (type === 'ref') {
                    const name = label.dataset.name;
                    this.refAssignments.delete(name);
                    this.updateAssignItemUI(name, false);
                } else if (type === 'scene') {
                    const sceneName = label.dataset.scene;
                    const arr = this.sceneAssignments.get(sceneName);
                    if (arr) {
                        const idx = arr.findIndex(a => a.workflowId === wfId);
                        if (idx >= 0) arr.splice(idx, 1);
                    }
                    // Atualiza UI do item no painel
                    this.updateAssignItemUI(sceneName, (arr?.length || 0) > 0);
                }
                this.tileAssignments.delete(wfId);
                this.updateAssignCount();
                this.logDebug(`Removida atribuição de ${wfId}`, 'info');
            });
        }
        // ── Pause for block approval ──
        waitForBlockApproval(blockNum, totalBlocks) {
            return new Promise(resolve => {
                const statusEl = document.getElementById('flow-status');
                if (!statusEl) return resolve('approve');

                // Create approval buttons
                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
                btnContainer.innerHTML = `
                    <button id="flow-approve-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;font-weight:600;font-size:12px;cursor:pointer;">✅ Aprovar e Enumerar</button>
                    <button id="flow-skip-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-weight:600;font-size:12px;cursor:pointer;">⏭️ Pular</button>
                    <button id="flow-stop-approve-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;font-weight:600;font-size:12px;cursor:pointer;">⏹ Parar</button>
                `;
                statusEl.appendChild(btnContainer);

                const cleanup = () => btnContainer.remove();

                document.getElementById('flow-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Lote ${blockNum} aprovado para enumeração`, 'success');
                    resolve('approve');
                });
                document.getElementById('flow-skip-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Lote ${blockNum} pulado (sem enumeração)`, 'info');
                    resolve('skip');
                });
                document.getElementById('flow-stop-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logDebug(`Automação parada pelo usuário no lote ${blockNum}`, 'warning');
                    resolve('stop');
                });
            });
        }
        // ── Pause for video block approval ──
        waitForVideoBlockApproval(blockNum, totalBlocks) {
            return new Promise(resolve => {
                const statusEl = document.getElementById('fv-status');
                if (!statusEl) return resolve('approve');

                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
                btnContainer.innerHTML = `
                    <button id="fv-approve-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;font-weight:600;font-size:12px;cursor:pointer;">✅ Aprovar e Enumerar</button>
                    <button id="fv-skip-btn" style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-weight:600;font-size:12px;cursor:pointer;">⏭️ Pular</button>
                    <button id="fv-stop-approve-btn" style="padding:8px 12px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;font-weight:600;font-size:12px;cursor:pointer;">⏹ Parar</button>
                `;
                statusEl.appendChild(btnContainer);

                const cleanup = () => btnContainer.remove();

                document.getElementById('fv-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Lote ${blockNum} aprovado para enumeração`, 'success');
                    resolve('approve');
                });
                document.getElementById('fv-skip-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Lote ${blockNum} pulado (sem enumeração)`, 'info');
                    resolve('skip');
                });
                document.getElementById('fv-stop-approve-btn').addEventListener('click', () => {
                    cleanup();
                    this.logVideoDebug(`Automação parada pelo usuário no lote ${blockNum}`, 'warning');
                    resolve('stop');
                });
            });
        }

        async autoAssignScenesFromMatrices(allMatrices, options = {}) {
    const isVideo = !!options.isVideo;

    const assignments = isVideo ? this.videoSceneAssignments : this.sceneAssignments;
    const statusFn = isVideo
        ? (type, msg) => this.setVideoStatus(type, msg)
        : (type, msg) => this.setStatus(type, msg);

    const logFn = isVideo
        ? (msg, type) => this.logVideoDebug(msg, type)
        : (msg, type) => this.logDebug(msg, type);

    const mediaLabel = isVideo ? 'vídeo' : 'imagem';

    const slots = allMatrices
        .flatMap(m => Array.isArray(m) ? m : [])
        .filter(s => s && s.state === 'loaded' && s.workflowId)
        .sort((a, b) => {
            const pa = Number(a.promptNum || 0);
            const pb = Number(b.promptNum || 0);
            if (pa !== pb) return pa - pb;
            return Number(a.imgNum || 0) - Number(b.imgNum || 0);
        });

    if (!slots.length) {
        statusFn('warning', `Nenhuma ${mediaLabel} carregada para nomear automaticamente.`);
        return;
    }

    const previousVideoAssignState = this._videoAssignActive;
    this._videoAssignActive = isVideo;

    let assigned = 0;
    let failed = 0;
    const used = new Set();

    try {
        logFn(`Iniciando nomeação automática de ${slots.length} ${mediaLabel}(s).`, 'info');

        for (const slot of slots) {
            if ((isVideo && this.videoShouldStop) || (!isVideo && this.shouldStop)) break;
            if (!slot.workflowId || used.has(slot.workflowId)) continue;

            used.add(slot.workflowId);

            const sceneNum = Number(slot.promptNum || 0);
            if (!sceneNum) {
                failed++;
                continue;
            }

            const sceneName = `Cena ${sceneNum}`;
            if (!assignments.has(sceneName)) assignments.set(sceneName, []);

            const tile = await this.scrollToWorkflow(slot.workflowId);
            if (!tile) {
                failed++;
                logFn(`Tile não encontrado para ${slot.workflowId.substring(0, 8)}.`, 'error');
                continue;
            }

            await this.assignScene(sceneNum, sceneName, slot.workflowId, tile);
            if (!assignments.get(sceneName)?.some(item => item.workflowId === slot.workflowId)) { failed++; continue; }
            assigned++;

            statusFn(
                'info',
                `🏷️ Nomeando ${mediaLabel}s automaticamente: ${assigned}/${slots.length}`
            );

            await this.sleep(500);
        }

        statusFn(
            'success',
            `✅ ${assigned} ${mediaLabel}(s) nomeada(s) automaticamente.${failed ? ` Falhas: ${failed}.` : ''}`
        );

        logFn(`✅ Nomeação automática concluída: ${assigned} sucesso(s), ${failed} falha(s).`, 'success');

    } finally {
        this._videoAssignActive = previousVideoAssignState;
    }
}

        // ──────────────────────────────────────────────
        // ATRIBUIR REFERÊNCIA
        // ──────────────────────────────────────────────

        async assignReference(name, workflowId, tileEl) {
            this.logDebug(`Atribuindo referência "${name}" → ${workflowId.substring(0,8)}...`, 'info');

            // Se esta referência já estava atribuída a outro tile: remove
            const prevWfId = this.refAssignments.get(name);
            if (prevWfId && prevWfId !== workflowId) {
                await this.apiRename(prevWfId, 'Imagem gerada');
                await this.apiFavorite(prevWfId, false);
                this.removeLabelFromTile(prevWfId);
                this.tileAssignments.delete(prevWfId);
            }

            // Se o tile destino já tinha outra atribuição: remove
            const prevAssign = this.tileAssignments.get(workflowId);
            if (prevAssign) {
                if (prevAssign.type === 'ref') this.refAssignments.delete(prevAssign.name);
                this.removeLabelFromTile(workflowId);
            }

            // Renomeia com sufixo " _"
            const apiName = name + CONFIG.REF_SUFFIX;
            const ok1 = await this.apiRename(workflowId, apiName);
            const ok2 = await this.apiFavorite(workflowId, true);

            if (ok1 && ok2) {
                this.refAssignments.set(name, workflowId);
                this.tileAssignments.set(workflowId, { label: name, type: 'ref', name });
                this.addLabelToTile(tileEl, name, workflowId, 'ref', name);
                this.updateAssignItemUI(name, true);
                this.updateAssignCount();
                this.startLabelObserver();
                this.logDebug(`✅ "${name}" atribuída`, 'success');
            } else {
                this.logDebug(`❌ Falha ao atribuir "${name}"`, 'error');
            }
        }

        // ──────────────────────────────────────────────
        // ATRIBUIR CENA
        // ──────────────────────────────────────────────

        async assignScene(sceneNum, sceneName, workflowId, tileEl) {
            const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
            const arr = assignments.get(sceneName) || [];
            const itemLabel = this._videoAssignActive ? 'Vídeo' : 'Imagem';
            const logFn = this._videoAssignActive ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);

            // Se tile já tem atribuição: sobrescreve
            const prevAssign = this.tileAssignments.get(workflowId);
            if (prevAssign) {
                if (prevAssign.type === 'scene') {
                    const prevArr = assignments.get(prevAssign.scene);
                    if (prevArr) {
                        const idx = prevArr.findIndex(a => a.workflowId === workflowId);
                        if (idx >= 0) prevArr.splice(idx, 1);
                    }
                    this.updateAssignItemUI(prevAssign.scene, (prevArr?.length || 0) > 0);
                } else if (prevAssign.type === 'ref') {
                    this.refAssignments.delete(prevAssign.name);
                    this.updateAssignItemUI(prevAssign.name, false);
                }
                this.removeLabelFromTile(workflowId);
            }

            const imgNum = arr.length + 1;
            const fullName = `Cena ${sceneNum} - ${itemLabel} ${imgNum}`;

            logFn(`Atribuindo "${fullName}" → ${workflowId.substring(0,8)}...`, 'info');

            const ok1 = await this.apiRename(workflowId, fullName);
            const ok2 = await this.apiFavorite(workflowId, true);

            if (ok1 && ok2) {
                arr.push({ imgNum, workflowId, src: this.getImgSrcFromTile(tileEl) || '' });
                assignments.set(sceneName, arr);
                this.tileAssignments.set(workflowId, { label: fullName, type: 'scene', scene: sceneName, imgNum });
                this.addLabelToTile(tileEl, fullName, workflowId, 'scene', sceneName);
                this.updateAssignItemUI(sceneName, true);
                this.updateAssignCount();
                this.startLabelObserver();
                logFn(`✅ "${fullName}" atribuída`, 'success');
            } else {
                logFn(`❌ Falha ao atribuir "${fullName}"`, 'error');
            }
        }

        // ──────────────────────────────────────────────
        // LABELS NOS TILES
        // ──────────────────────────────────────────────

        addLabelToTile(tileEl, text, workflowId, type, extraData) {
            // Remove label anterior se existir
            this.removeLabelFromTile(workflowId);

            // Encontra o outerTile para posicionar
            const outer = tileEl.closest('flow-grid-tile-container, [data-tile-id]') || tileEl;
            outer.style.position = 'relative';

            const label = document.createElement('div');
            label.className = 'flow-tile-label';
            label.dataset.wf = workflowId;
            label.dataset.type = type;
            if (type === 'ref') label.dataset.name = extraData;
            if (type === 'scene') label.dataset.scene = extraData;
            label.innerHTML = `<span>${this.esc(text)}</span><button class="label-x" title="Remover">×</button>`;
            outer.appendChild(label);
        }

        removeLabelFromTile(workflowId) {
            document.querySelectorAll(`.flow-tile-label[data-wf="${workflowId}"]`).forEach(l => l.remove());
        }

        /**
         * Inicia polling que re-aplica labels em tiles visíveis.
         * Necessário porque o Virtuoso destrói/recria DOM ao scrollar.
         */
        startLabelObserver() {
            // Mostra seção de download se há atribuições
            const dlSection = document.getElementById('flow-download-section');
            if (dlSection && this.tileAssignments.size > 0) dlSection.style.display = '';
            if (this._labelObserverId) return;
            this._labelObserverId = setInterval(() => {
                if (this.tileAssignments.size === 0) return;
                const links = document.querySelectorAll('a[href*="/edit/"]');
                for (const link of links) {
                    const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                    if (!m) continue;
                    const wfId = m[1];
                    const data = this.tileAssignments.get(wfId);
                    if (!data) continue;
                    const tile = link.closest('[data-tile-id]');
                    if (!tile) continue;
                    if (tile.querySelector(`.flow-tile-label[data-wf="${wfId}"]`)) continue;
                    tile.style.position = 'relative';
                    const label = document.createElement('div');
                    label.className = 'flow-tile-label';
                    label.dataset.wf = wfId;
                    label.dataset.type = data.type;
                    if (data.type === 'ref') label.dataset.name = data.name || '';
                    if (data.type === 'scene') label.dataset.scene = data.scene || '';
                    label.innerHTML = `<span>${this.esc(data.label)}</span><button class="label-x" title="Remover">\u00d7</button>`;
                    tile.appendChild(label);
                }
            }, 600);
        }

        stopLabelObserver() {
            if (this._labelObserverId) { clearInterval(this._labelObserverId); this._labelObserverId = null; }
        }

        updateAssignItemUI(name, assigned) {
            const items = document.querySelectorAll('.flow-assign-item');
            for (const item of items) {
                const itemName = item.dataset.name || item.dataset.scene;
                if (itemName === name) {
                    item.classList.toggle('assigned', assigned);
                    const status = item.querySelector('.assign-status');
                    if (status) status.textContent = assigned ? '✅' : '⏳';
                }
            }
        }

        // ──────────────────────────────────────────────
        // DOWNLOAD DE CENAS
        // ──────────────────────────────────────────────

        async downloadScenes() {
            const btn = document.getElementById('flow-assign-download');
            btn.disabled = true; btn.textContent = '⏳ Baixando...';
            const assignments = this._videoAssignActive ? this.videoSceneAssignments : this.sceneAssignments;
            const ext = this._videoAssignActive ? 'mp4' : 'jpg';
            const logFn = this._videoAssignActive ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);
            let count = 0;
            try {
                for (const [sceneName, imgs] of [...assignments.entries()].sort((a,b) => {
                    const na = parseFloat(a[0].match(/[\d.]+/)?.[0] || 0);
                    const nb = parseFloat(b[0].match(/[\d.]+/)?.[0] || 0);
                    return na - nb;
                })) {
                    const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                    const sorted = imgs.sort((a,b) => a.imgNum - b.imgNum);
                    for (let i = 0; i < sorted.length; i++) {
                        const fileName = i === 0 ? `cena_${sceneNum}.${ext}` : `cena_${sceneNum}_${i+1}.${ext}`;
                        // Tenta pegar src fresco do tile
                        let src = sorted[i].src;
                        if (!src) {
                            const link = document.querySelector(`a[href*="/edit/${sorted[i].workflowId}"]`);
                            if (link) {
                                const tile = link.closest('[data-tile-id]');
                                if (tile) src = this.getMediaSrcFromTile(tile);
                            }
                        }
                        if (!src) continue;
                        try {
                            const resp = await _origFetch(src);
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = fileName;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            count++; await this.sleep(400);
                        } catch(e) { logFn(`Erro download ${fileName}: ${e.message}`, 'error'); }
                    }
                }
                logFn(`✅ ${count} arquivo(s) baixado(s)`, 'success');
            } catch(e) { logFn(`Erro: ${e.message}`, 'error'); }
            btn.disabled = false; btn.textContent = '⬇️ Baixar Cenas';
        }

        // ──────────────────────────────────────────────
        // DOWNLOAD DE IMAGENS DO PROJETO
        // ──────────────────────────────────────────────

        /**
         * Baixa imagens do projeto com base no tileAssignments e/ou galeria.
         * @param {'identified'|'scenes'|'refs'|'all'} mode
         */
        async downloadProjectImages(mode) {
            const btnId = { identified: 'flow-dl-identified', scenes: 'flow-dl-scenes', refs: 'flow-dl-refs', all: 'flow-dl-all' }[mode] || { identified: 'fv-dl-identified', scenes: 'fv-dl-scenes', refs: 'fv-dl-refs', all: 'fv-dl-all' }[mode];
            const btn = document.getElementById(btnId);
            const origText = btn?.textContent;
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Baixando...'; }

            try {
                if (mode === 'all') {
                    // Baixa TODAS as imagens da galeria
                    await this.downloadAllGalleryImages(btn);
                } else {
                    // Baixa baseado no tileAssignments
                    if (this.tileAssignments.size === 0) {
                        this.setStatus('warning', 'Nenhuma imagem identificada. Execute "Analisar projeto" primeiro.');
                        if (btn) { btn.disabled = false; btn.textContent = origText; }
                        return;
                    }

                    const entries = [...this.tileAssignments.entries()].filter(([, data]) => {
                        if (mode === 'identified') return true;
                        if (mode === 'scenes') return data.type === 'scene';
                        if (mode === 'refs') return data.type === 'ref';
                        return false;
                    });

                    if (!entries.length) {
                        this.setStatus('warning', `Nenhuma ${mode === 'scenes' ? 'cena' : 'referência'} encontrada.`);
                        if (btn) { btn.disabled = false; btn.textContent = origText; }
                        return;
                    }

                    this.logDebug(`Baixando ${entries.length} arquivo(s) (${mode})...`, 'info');
                    let count = 0;
                    const pending = new Map(entries); // wfId → data
                    const scroller = this.getScroller();

                    if (scroller) {
                        scroller.scrollTop = 0;
                        await this.sleep(600);

                        // Scroll pela galeria procurando os tiles
                        for (let iter = 0; iter < 500 && pending.size > 0; iter++) {
                            const links = document.querySelectorAll('a[href*="/edit/"]');
                            for (const link of links) {
                                const m = link.href.match(/\/edit\/([a-f0-9-]{36})/);
                                if (!m) continue;
                                const wfId = m[1];
                                const data = pending.get(wfId);
                                if (!data) continue;

                                const tile = link.closest('[data-tile-id]');
                                if (!tile || !this.isTileLoaded(tile)) continue;
                                const mediaSrc = this.getMediaSrcFromTile(tile);
                                if (!mediaSrc) continue;
                                const tileIsVideo = this.isVideoTile(tile);

                                let fileName;
                                if (data.type === 'scene') {
                                    const sm = data.label.match(/Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
                                    const ext = tileIsVideo ? 'mp4' : 'jpg';
                                    if (sm) fileName = parseInt(sm[2]) === 1 ? `cena_${sm[1]}.${ext}` : `cena_${sm[1]}_${sm[2]}.${ext}`;
                                    else fileName = `cena_${data.label.replace(/\s+/g, '_')}.${ext}`;
                                } else if (data.type === 'ref') {
                                    const clean = (data.name || data.label).replace(/ _$/, '').trim();
                                    fileName = `referencia_${clean.toLowerCase().replace(/\s+/g, '_')}.jpg`;
                                } else {
                                    const ext = tileIsVideo ? 'mp4' : 'jpg';
                                    fileName = `media_${wfId.substring(0, 8)}.${ext}`;
                                }

                                try {
                                    const resp = await _origFetch(mediaSrc);
                                    const blob = await resp.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url; a.download = fileName;
                                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                    count++;
                                    pending.delete(wfId);
                                    if (btn) btn.textContent = `⏳ ${count}/${entries.length}...`;
                                    await this.sleep(400);
                                } catch(e) {
                                    this.logDebug(`Erro download ${fileName}: ${e.message}`, 'error');
                                }
                            }

                            if (pending.size === 0) break;
                            const prev = scroller.scrollTop;
                            scroller.scrollTop += 350;
                            await this.sleep(400);
                            if (scroller.scrollTop === prev) break;
                        }

                        scroller.scrollTop = 0;
                    }

                    this.logDebug(`✅ ${count}/${entries.length} arquivo(s) baixado(s)`, 'success');
                    this.setStatus('success', `✅ ${count} arquivo(s) baixado(s)!`);
                }
            } catch(e) {
                this.logDebug(`Erro: ${e.message}`, 'error');
            }

            if (btn) { btn.disabled = false; btn.textContent = origText; }
        }

        /**
         * Baixa apenas as mídias geradas na última execução.
         * Usa o array _lastRunMedia que é populado no final de start() e startVideo().
         */
        async downloadLastRunMedia() {
            const media = this._lastRunMedia || [];
            if (!media.length) return;

            const btn = document.getElementById('flow-popup-download');
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Baixando...'; }

            const scroller = this.getScroller();
            let count = 0;
            const pending = new Map(); // uuid → media item
            for (const item of media) {
                if (item.uuid) pending.set(item.uuid, item);
            }

            // Scroll pela galeria procurando os tiles
            if (scroller) {
                scroller.scrollTop = 0;
                await this.sleep(600);

                for (let iter = 0; iter < 500 && pending.size > 0; iter++) {
                    const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                    for (const tile of tiles) {
                        if (!this.isTileLoaded(tile)) continue;
                        const uuid = this.getUuidFromTile(tile);
                        const item = uuid ? pending.get(uuid) : null;
                        if (!item) continue;

                        const mediaSrc = this.getMediaSrcFromTile(tile);
                        if (!mediaSrc) continue;

                        const tileIsVideo = this.isVideoTile(tile);
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        const fileName = `${String(count + 1).padStart(4, '0')}.${ext}`;

                        try {
                            const resp = await _origFetch(mediaSrc);
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = fileName;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            count++;
                            pending.delete(uuid);
                            if (btn) btn.textContent = `⏳ ${count}/${media.length}...`;
                            await this.sleep(400);
                        } catch(e) {
                            this.logDebug(`Erro download ${fileName}: ${e.message}`, 'error');
                        }
                    }

                    if (pending.size === 0) break;
                    const prev = scroller.scrollTop;
                    scroller.scrollTop += 350;
                    await this.sleep(400);
                    if (scroller.scrollTop === prev) break;
                }
                scroller.scrollTop = 0;
            }

            this.logDebug(`✅ ${count}/${media.length} mídia(s) baixada(s)`, 'success');
            if (btn) { btn.disabled = false; btn.textContent = `✅ ${count} baixada(s)!`; }
        }

        async downloadAllGalleryImages(btn) {
            const scroller = this.getScroller();
            if (!scroller) { this.setStatus('error', 'Scroller não encontrado'); return; }

            const downloaded = new Set();
            let count = 0;
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 500; iter++) {
                // Itera por todos os tiles visíveis
                const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                for (const tile of tiles) {
                    if (!this.isTileLoaded(tile)) continue;
                    const uuid = this.getUuidFromTile(tile);
                    if (!uuid || downloaded.has(uuid)) continue;
                    downloaded.add(uuid);

                    const mediaSrc = this.getMediaSrcFromTile(tile);
                    if (!mediaSrc) continue;
                    const tileIsVideo = this.isVideoTile(tile);

                    // Determina nome baseado no tileAssignment se existir
                    const link = tile.querySelector('a[href*="/edit/"]');
                    const wfId = link?.href.match(/\/edit\/([a-f0-9-]{36})/)?.[1];
                    const data = wfId ? this.tileAssignments.get(wfId) : null;

                    let fileName;
                    if (data?.type === 'scene') {
                        const m = data.label.match(/Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)/i);
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        if (m) fileName = parseInt(m[2]) === 1 ? `cena_${m[1]}.${ext}` : `cena_${m[1]}_${m[2]}.${ext}`;
                        else fileName = `cena_${data.label.replace(/\s+/g, '_')}.${ext}`;
                    } else if (data?.type === 'ref') {
                        const clean = (data.name || data.label).replace(/ _$/, '').trim();
                        fileName = `referencia_${clean.toLowerCase().replace(/\s+/g, '_')}.jpg`;
                    } else {
                        const ext = tileIsVideo ? 'mp4' : 'jpg';
                        fileName = `media_${count + 1}.${ext}`;
                    }

                    try {
                        const resp = await _origFetch(mediaSrc);
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = fileName;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        count++;
                        if (btn) btn.textContent = `⏳ ${count} baixada(s)...`;
                        await this.sleep(300);
                    } catch(e) { this.logDebug(`Erro: ${e.message}`, 'error'); }
                }

                const prev = scroller.scrollTop;
                scroller.scrollTop += 350;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break;
            }

            scroller.scrollTop = 0;
            this.logDebug(`✅ ${count} mídia(s) baixada(s) (completo)`, 'success');
            this.setStatus('success', `✅ Download completo: ${count} mídia(s)!`);
        }

        // ──────────────────────────────────────────────
        // ANALISAR PROJETO EXISTENTE
        // ──────────────────────────────────────────────

        async analyzeProject(source = 'images') {
            const isVideo = source === 'video';
            const btnId = isVideo ? 'fv-analyze-btn' : 'flow-analyze-btn';
            const dlSectionId = isVideo ? 'fv-download-section' : 'flow-download-section';
            const statusFn = isVideo ? (t, m) => this.setVideoStatus(t, m) : (t, m) => this.setStatus(t, m);
            const logFn = isVideo ? (m, t) => this.logVideoDebug(m, t) : (m, t) => this.logDebug(m, t);

            const btn = document.getElementById(btnId);
            btn.disabled = true; btn.textContent = '⏳ Analisando...';
            logFn('Analisando projeto...', 'info');

            // Remove labels anteriores
            document.querySelectorAll('.flow-tile-label').forEach(l => l.remove());
            
            // INJEÇÃO ADD-ON: Limpa as memórias para evitar lixo do passado no Upscale
            this.tileAssignments.clear();
            if (isVideo) this.videoSceneAssignments.clear();
            else this.sceneAssignments.clear();
            this.refAssignments.clear();

            const scroller = this.getScroller();
            if (!scroller) { btn.disabled = false; btn.textContent = '🔍 Analisar projeto existente'; return; }

            let labelsFound = 0;
            const checkedIds = new Set();

            // Scroll do topo ao fundo
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 300; iter++) {
                const tiles = [...document.querySelectorAll('[data-tile-id]')].filter(el => el.parentElement.closest('[data-tile-id]'));
                for (const tile of tiles) {
                    const tileId = tile.getAttribute('data-tile-id');
                    if (checkedIds.has(tileId)) continue;
                    checkedIds.add(tileId);

                    const name = await this.getTileName(tile);
                    if (!name) continue;

                    const wfId = this.getWorkflowIdFromTile(tile);
                    let labelText = null, type = null, extra = null, sceneMatch = null;

                    // Match "Cena X - Imagem Y" ou "Cena X - Vídeo Y"
                    sceneMatch = name.match(/^Cena\s+([\d.]+)\s*-\s*(?:Imagem|Vídeo|Video)\s+(\d+)$/i);
                    if (sceneMatch) {
                        labelText = name;
                        type = 'scene';
                        extra = `Cena ${sceneMatch[1]}`;
                    }
                    // Match referência (termina com " _")
                    else if (name.endsWith(CONFIG.REF_SUFFIX)) {
                        const cleanName = name.slice(0, -CONFIG.REF_SUFFIX.length);
                        labelText = cleanName;
                        type = 'ref';
                        extra = cleanName;
                    }

                    if (labelText && type && wfId) {
                        const outer = tile.closest('[data-tile-id]') || tile;
                        this.addLabelToTile(outer, labelText, wfId, type, extra);
                        this.tileAssignments.set(wfId, { label: labelText, type, name: extra, scene: extra });
                        
                        // INJEÇÃO ADD-ON: SINCRONIZA COM A MEMÓRIA DOS PAINÉIS / UPSCALE / DOWNLOAD
                        if (type === 'scene') {
                            const sceneName = extra;
                            const assignmentsMap = isVideo ? this.videoSceneAssignments : this.sceneAssignments;
                            if (!assignmentsMap.has(sceneName)) assignmentsMap.set(sceneName, []);
                            
                            const imgNum = sceneMatch ? parseInt(sceneMatch[2], 10) : 1;
                            assignmentsMap.get(sceneName).push({ imgNum, workflowId: wfId, src: this.getMediaSrcFromTile(tile) });
                        } else if (type === 'ref') {
                            this.refAssignments.set(extra, wfId);
                        }

                        labelsFound++;
                        btn.textContent = `⏳ ${labelsFound} encontrada(s)...`;
                    }
                }
                const prev = scroller.scrollTop;
                scroller.scrollTop += 350;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break;
            }

            scroller.scrollTop = 0; await this.sleep(300);
            if (labelsFound > 0) this.startLabelObserver();
            statusFn('success', `✅ Análise concluída: ${labelsFound} item(ns) identificado(s).`);
            logFn(`Análise: ${labelsFound} labels, ${checkedIds.size} tiles verificados`, 'success');
            const dlSection = document.getElementById(dlSectionId);
            if (dlSection) dlSection.style.display = '';
            btn.disabled = false; btn.textContent = '🔍 Analisar projeto existente';
        }

        // ──────────────────────────────────────────────
        // VIDEO PIPELINE
        // ──────────────────────────────────────────────

        async startVideo() {
            if (this.isRunning) { this.setVideoStatus('warning', '⚠️ A automação de imagens está rodando. Aguarde finalizar.'); return; }
            if (this.videoIsRunning) return;

            const text = document.getElementById('fv-prompts-input').value;
            this.videoPrompts = parsePromptsText(text);
            if (!this.videoPrompts.length) { this.setVideoStatus('error', 'Nenhum prompt detectado.'); return; }

            // --- INJEÇÃO ADD-ON: Sistema "Retomar de" ---
            const resumeInput = document.getElementById('fv-start-from').value.trim();
            let resumeFrom = -1;
            if (resumeInput !== '') {
                resumeFrom = parseInt(resumeInput, 10);
            }

            // Valida referências nos prompts
            const refs = extractReferences(this.videoPrompts);
            if (refs.length > 0) {
                const unvalidated = refs.filter(r => this.validatedRefs[r.toLowerCase()] === undefined);
                const missing     = refs.filter(r => this.validatedRefs[r.toLowerCase()] === false);
                if (unvalidated.length) { this.setVideoStatus('warning', 'Valide as referências antes de iniciar.'); return; }
                if (missing.length)     { this.setVideoStatus('error', `Referências não encontradas: ${missing.join(', ')}`); return; }
            }

            // Em modo cenas: sceneCount = número de prompts. (INJEÇÃO ADD-ON: Numeração Fiel)
            if (this.videoGenMode === 'scenes') {
                this.videoSceneCount = this.videoPrompts.length;
                this.videoSceneAssignments = new Map();
                for (let i = 0; i < this.videoPrompts.length; i++) {
                    this.videoSceneAssignments.set(`Cena ${this.videoPrompts[i].promptNum}`, []);
                }
            }

            this.videoIsRunning = true;
            this.videoShouldStop = false;
            document.getElementById('fv-start-btn').disabled = true;
            document.getElementById('fv-stop-btn').disabled  = false;
            document.getElementById('fv-prompts-input').disabled = true;

            this.buildVideoPromptList();
            this.setVideoStatus('info', '🚀 Iniciando automação de vídeos v4.0...');
            this.updateVideoProgress(0);

            // --- INJEÇÃO ADD-ON: Regra do 0 ---
            if (resumeFrom === 0) {
                this.logVideoDebug('Regra do 0: Marcando geração como concluída e abrindo painel de atribuição...', 'success');
                this.videoPrompts.forEach((p, idx) => {
                    this.updateVideoPromptItemStatus(idx, 'done', 'Pulado');
                });
                this.updateVideoProgress(1);
                this.setVideoStatus('success', '✅ Geração pulada. Atribua as cenas.');
                this.videoIsRunning = false;
                document.getElementById('fv-start-btn').disabled = false;
                document.getElementById('fv-stop-btn').disabled  = true;
                document.getElementById('fv-prompts-input').disabled = false;
                if (this.videoGenMode === 'scenes') {
                    this.showVideoAssignPanel([]);
                }
                return;
            }

            // --- INJEÇÃO ADD-ON: Resume > 0 ---
            let promptsToProcess = this.videoPrompts;
            if (resumeFrom > 0) {
                promptsToProcess = this.videoPrompts.filter(p => p.promptNum >= resumeFrom);
                const skipped = this.videoPrompts.filter(p => p.promptNum < resumeFrom);
                skipped.forEach(p => {
                    const idx = this.videoPrompts.findIndex(x => x.promptNum === p.promptNum);
this.updateVideoPromptItemStatus(idx, 'done', 'Concluído');
                });
                this.logVideoDebug(`Retomando da cena ${resumeFrom}. ${skipped.length} prompts marcados como concluídos.`, 'info');
            }

            await this.detectGrid();

            const N = this.videoResultsPerPrompt;
            const batches = [];
            // INJEÇÃO ADD-ON: Usando promptsToProcess em vez de this.prompts
            for (let i = 0; i < promptsToProcess.length; i += this.videoBatchSize)
                batches.push(promptsToProcess.slice(i, Math.min(i + this.videoBatchSize, promptsToProcess.length)));
            this.logVideoDebug(`${promptsToProcess.length} prompts → ${batches.length} lote(s)`, 'info');

            const allMatrices = [];

            try {
                const C = this.gridCols;
                const retryCount = {};
                const deferredFailures = []; // prompts falhados para retentar no final

                for (let bIdx = 0; bIdx < batches.length; bIdx++) {
                    if (this.videoShouldStop) break;
                    const batch = batches[bIdx];
                    const totalN = batch.length * N;
                    const rowsThis = Math.ceil(totalN / C);

                    batch.forEach(p => this.updateVideoPromptItemStatus(
                        this.videoPrompts.findIndex(x => x.promptNum === p.promptNum), 'active'
                    ));
                    this.updateVideoProgress(bIdx / batches.length);
                    this.updateMini(
                        `Vídeo ${bIdx+1}/${batches.length}`,
                        batch.map(p => `#${p.promptNum}`).join(' + '),
                        bIdx / batches.length,
                        `${this.videoGenMode === 'scenes' ? 'Cenas' : 'Livre'} • ${N} resultado(s)/prompt • ${this.videoBatchSize} simult.`
                    );
                    this.logVideoDebug(`\n╭─── LOTE ${bIdx+1}/${batches.length}: prompts ${batch.map(p=>p.promptNum).join(', ')} ───╮`, 'info');

                    // 1. Snapshot
                    const beforeUuids = this.snapshotImageUuids();

                    // 2. Submit com stagger
                    this.setVideoStatus('info', `⚡ Submetendo lote ${bIdx+1}/${batches.length}...`);
                    for (let pi = 0; pi < batch.length; pi++) {
                        if (this.videoShouldStop) break;
                        const ok = await this.prepareAndSubmit(batch[pi]);
                        // Um prompt que falha NAO derruba o resto do lote: marca falha e segue.
                        if (!ok) {
                            const gi = (this.videoIsRunning ? this.videoPrompts : this.prompts)
                                .findIndex(x => x.promptNum === batch[pi].promptNum);
                            if (this.videoIsRunning) this.updateVideoPromptItemStatus(gi, 'error', 'pulado');
                            else this.updatePromptItemStatus(gi, 'error', 'pulado');
                            (this.videoIsRunning ? this.logVideoDebug : this.logDebug)
                                .call(this, '⏭️ Prompt ' + batch[pi].promptNum + ' pulado; a fila SEGUE.', 'warning');
                        }
                        if (pi < batch.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    if (this.videoShouldStop) break;
                    await this.dynamicSleep([1200, 1800]);

                    // 3. Monta matriz e aguarda geração
                    const matrix = this.buildPositionMatrix(batch, N, 0);
                    this.setVideoStatus('info', `⏳ Lote ${bIdx+1}/${batches.length} — aguardando geração...`);
                    // Override shouldStop temporariamente para usar videoShouldStop
                    const origShouldStop = this.shouldStop;
                    this.shouldStop = this.videoShouldStop;
                    await this.waitForMatrix(matrix, beforeUuids);
                    this.shouldStop = origShouldStop;
                    if (this.videoShouldStop) break;

                    // 4. Retry falhas (parciais ou totais)
                    const failedPrompts = [];
                    for (let bRevIdx = 0; bRevIdx < batch.length; bRevIdx++) {
                        const bIdx2 = batch.length - 1 - bRevIdx;
                        const prompt = batch[bIdx2];
                        const slots = matrix.filter(s => s.promptNum === prompt.promptNum);
                        const loadedCount = slots.filter(s => s.state === 'loaded').length;
                        if (loadedCount < N) {
                            const missing = N - loadedCount;
                            this.logVideoDebug(`⚠️ Prompt ${prompt.promptNum}: gerou ${loadedCount}/${N} (faltam ${missing})`, 'warning');
                            failedPrompts.push(prompt);
                        }
                    }

                    for (const fp of failedPrompts) {
                        const key = fp.promptNum;
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === key);

                        // ── Deferred retry: guardar para o final ──
                        if (this.deferRetry) {
                            this.logVideoDebug(`⏸️ Prompt ${key}: falhou — guardado para retentar no final`, 'warning');
                            this.updateVideoPromptItemStatus(gi, 'retrying', 'adiado');
                            deferredFailures.push(fp);
                            continue;
                        }

                        // ── Retry imediato (comportamento original) ──
                        if (!retryCount[key]) retryCount[key] = 0;
                        let recovered = false;
                        const maxVideoRetries = Number.isInteger(this.videoMaxPromptRetries)
    ? this.videoMaxPromptRetries
    : CONFIG.MAX_RETRIES;

while (retryCount[key] < maxVideoRetries && !this.videoShouldStop) {
                            retryCount[key]++;
                            this.logVideoDebug(`🔄 Regerar prompt ${key} — tentativa ${retryCount[key]}`, 'info');
                            this.updateVideoPromptItemStatus(gi, 'retrying', `${retryCount[key]}/${maxVideoRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            this.shouldStop = this.videoShouldStop;
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            this.shouldStop = origShouldStop;
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updateVideoPromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                break;
                            }
                        }
                        if (!recovered) this.updateVideoPromptItemStatus(gi, 'error', `falhou`);
                    }

                    // Marca prompts do lote como done
                    batch.forEach(p => {
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === p.promptNum);
                        const slots = matrix.filter(s => s.promptNum === p.promptNum);
                        if (slots.filter(s => s.state === 'loaded').length >= N) this.updateVideoPromptItemStatus(gi, 'done');
                    });

                    allMatrices.push(matrix);

                    // ── Enum por bloco (se ativo) ──
                    const autoNameVideos = document.getElementById('fv-auto-name-scenes')?.checked;
                    if (this.enumMode === 'block' && this.videoGenMode === 'scenes' && autoNameVideos && !this.videoShouldStop) {
                        if (this.approveBeforeEnum) {
                            this.setVideoStatus('info', `✅ Lote ${bIdx+1}/${batches.length} concluído. Aprovar enumeração?`);
                            const approved = await this.waitForVideoBlockApproval(bIdx + 1, batches.length);
                            if (approved === 'stop') { this.videoShouldStop = true; break; }
                            if (approved === 'approve') {
                                await this.autoAssignScenesFromMatrices([matrix], { isVideo: true });
                            }
                        } else {
                            await this.autoAssignScenesFromMatrices([matrix], { isVideo: true });
                        }
                    }

                    if (bIdx < batches.length - 1) await this.esperaFixa(CONFIG.DELAY_BETWEEN_BATCHES[0]);
                }

                // ══════ DEFERRED RETRY (Vídeos): retentar falhas acumuladas ══════
                if (deferredFailures.length > 0 && !this.videoShouldStop) {
                    this.logVideoDebug(`\n╔═══ RETENTANDO ${deferredFailures.length} PROMPT(S) ADIADO(S) ═══╗`, 'info');
                    this.setVideoStatus('info', `🔄 Retentando ${deferredFailures.length} prompt(s) que falharam...`);

                    const maxVideoRetries = Number.isInteger(this.videoMaxPromptRetries) ? this.videoMaxPromptRetries : CONFIG.MAX_RETRIES;

                    for (let di = 0; di < deferredFailures.length && !this.videoShouldStop; di++) {
                        const fp = deferredFailures[di];
                        const key = fp.promptNum;
                        const gi = this.videoPrompts.findIndex(x => x.promptNum === key);
                        let recovered = false;

                        this.setVideoStatus('info', `🔄 Retry adiado ${di+1}/${deferredFailures.length} — Prompt ${key}`);

                        for (let attempt = 1; attempt <= maxVideoRetries && !this.videoShouldStop; attempt++) {
                            this.logVideoDebug(`🔄 Retry adiado: prompt ${key} — tentativa ${attempt}/${maxVideoRetries}`, 'info');
                            this.updateVideoPromptItemStatus(gi, 'retrying', `${attempt}/${maxVideoRetries}`);
                            const retryBefore = this.snapshotImageUuids();
                            const ok = await this.prepareAndSubmit(fp);
                            if (!ok) break;
                            await this.dynamicSleep([1200, 1800]);
                            const retryMatrix = this.buildPositionMatrix([fp], N, 0);
                            const origShouldStop = this.shouldStop;
                            this.shouldStop = this.videoShouldStop;
                            await this.waitForMatrix(retryMatrix, retryBefore);
                            this.shouldStop = origShouldStop;
                            if (retryMatrix.filter(s => s.state === 'loaded').length >= N) {
                                this.updateVideoPromptItemStatus(gi, 'done');
                                recovered = true;
                                allMatrices.push(retryMatrix);
                                this.logVideoDebug(`✅ Prompt ${key} recuperado no retry adiado!`, 'success');
                                break;
                            }
                        }
                        if (!recovered) {
                            this.updateVideoPromptItemStatus(gi, 'error', 'falhou');
                            this.logVideoDebug(`❌ Prompt ${key} falhou mesmo após retries adiados`, 'error');
                        }
                        if (di < deferredFailures.length - 1) await this.dynamicSleep(CONFIG.DELAY_BETWEEN_SUBMITS);
                    }
                    this.logVideoDebug(`╚═══ FIM DOS RETRIES ADIADOS ═══╝`, 'info');
                }

                if (!this.videoShouldStop) {
                    this.updateVideoProgress(1);
                    const doneCount = document.querySelectorAll('#fv-prompt-list .flow-prompt-item.done').length;
                    const errCount = document.querySelectorAll('#fv-prompt-list .flow-prompt-item.error').length;
                    const failedList = this.videoPrompts.filter((_, i) =>
                        document.querySelector(`#fv-prompt-list .flow-prompt-item[data-index="${i}"]`)?.classList.contains('error')
                    );

                    let statusMsg = `✅ Geração concluída! ${doneCount} sucesso(s)`;
                    if (errCount) statusMsg += `, ${errCount} falha(s)`;
                    statusMsg += '.';
                    if (this.videoGenMode === 'scenes') statusMsg += ' Arraste as cenas para atribuir aos vídeos.';
                    this.setVideoStatus('success', statusMsg);

                    // Mostra painel de atribuição / nomeia automaticamente (modo 'end')
if (this.videoGenMode === 'scenes') {
    this.showVideoAssignPanel(allMatrices);

    // Só enumera no final se enumMode === 'end'
    if (this.enumMode === 'end') {
        const autoNameVideos = document.getElementById('fv-auto-name-scenes')?.checked;
        if (autoNameVideos) {
            await this.autoAssignScenesFromMatrices(allMatrices, { isVideo: true });
        }
    }
}
                    // Popup com detalhes
                    let popupMsg = `${doneCount} prompt(s) de vídeo gerado(s) com sucesso.`;
                    if (this.videoGenMode === 'scenes') popupMsg += '\n\nArraste as cenas do painel superior para os melhores vídeos.';

                    // Coleta mídias geradas nesta execução
                    this._lastRunMedia = allMatrices.flatMap(m =>
                        m.filter(s => s.state === 'loaded' && s.src).map(s => ({
                            src: s.src, workflowId: s.workflowId, uuid: s.uuid, promptNum: s.promptNum, isVideo: true
                        }))
                    );
                    this.showCompletionPopup(popupMsg, failedList.length > 0 ? failedList : null);
                } else {
                    this.setVideoStatus('warning', '⏹ Automação de vídeos interrompida.');
                }

            } catch (err) {
                this.setVideoStatus('error', '❌ Erro: ' + err.message);
                log.error('Video pipeline error:', err);
            }

            this.videoIsRunning = false;
            if (!this._modernUncertain) this.clearRunState(); // Preserve uncertain submissions for review.
            document.getElementById('fv-start-btn').disabled = false;
            document.getElementById('fv-stop-btn').disabled  = true;
            document.getElementById('fv-prompts-input').disabled = false;
            document.getElementById('flow-mini').style.display = 'none';
            document.getElementById('flow-sidebar').style.display = '';
        }

        stopVideo() { this.videoShouldStop = true; this.setVideoStatus('warning', '⏹ Parando...'); }

        /**
         * Mostra painel de atribuição para vídeos (modo cenas).
         * Reutiliza o mesmo painel de assign do DOM, mas com estado de vídeo.
         */
        showVideoAssignPanel(allMatrices) {
            const panel = document.getElementById('flow-assign-panel');
            const title = document.getElementById('flow-assign-title');
            const items = document.getElementById('flow-assign-items');
            const dlBtn = document.getElementById('flow-assign-download');
            const variationCounts = this.getSceneVariationCountsFromMatrices(allMatrices);
            this._lastMatrices = allMatrices || [];   // ADD-ON: modo exato do ⚡ Auto (vídeo, mesma sessão)

            items.innerHTML = '';
            title.textContent = 'Atribuir Cenas (Vídeos)';

            const previewEl = document.getElementById('flow-assign-preview');
            if (previewEl) previewEl.style.display = 'none';

            dlBtn.style.display = 'inline-flex';

            const rlBar = document.getElementById('flow-assign-reload-bar');
            if (rlBar) rlBar.classList.remove('visible');

            // INJEÇÃO ADD-ON: Numeração Fiel
            for (const [sceneName] of this.videoSceneAssignments) {
                const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);
                const prompt = this.videoPrompts.find(p => p.promptNum === sceneNum);
                const promptText = prompt?.text || '';

                const item = document.createElement('div');
                item.className = 'flow-assign-item';
                item.draggable = true;
                item.dataset.type = 'scene';
                item.dataset.scene = sceneName;
                item.dataset.sceneNum = sceneNum;
const displaySceneName = this.formatSceneNameWithVariationCount(sceneName, variationCounts);

item.innerHTML = `<span class="drag-icon">⋮</span><span class="assign-name">${this.esc(displaySceneName)}</span><span class="assign-status">⏳</span>`;
item.title = `${sceneName}: ${variationCounts.get(sceneNum) || 0} variação(ões) encontrada(s)`;                item.addEventListener('mouseenter', () => {
                    const preview = document.getElementById('flow-assign-preview');
                    if (preview) {
                        preview.style.display = '';
                        preview.querySelector('.preview-label').textContent = sceneName + ': ';
                        preview.querySelector('.preview-text').textContent = promptText.substring(0, 300) + (promptText.length > 300 ? '...' : '');
                    }
                });
                item.addEventListener('mouseleave', () => {
                    const preview = document.getElementById('flow-assign-preview');
                    if (preview) preview.style.display = 'none';
                });
                item.addEventListener('dragstart', e => {
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'scene', sceneNum, sceneName }));
                    e.dataTransfer.effectAllowed = 'copy';
                });
                items.appendChild(item);
            }

            panel.classList.add('active');
            panel.classList.remove('minimized');
            document.getElementById('flow-assign-toggle').textContent = '▲';
            const reopenBtn = document.getElementById('fv-reopen-assign');
            if (reopenBtn) reopenBtn.style.display = 'none';
            // Atualiza contadores usando videoSceneAssignments
            this._videoAssignActive = true;
            this.updateAssignCount();
            this.updateScrollerPadding();
        }

               /**
         * --- INJEÇÃO ADD-ON: Sistema Automático de Upscale 1080p (Vídeos) ---
         * Versão reforçada: menu do tile -> Download -> 1080p -> toast -> próximo vídeo
         */
        async waitFor(conditionFn, timeout = 8000, interval = 150) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                try {
                    const result = await conditionFn();
                    if (result) return result;
                } catch (_) {}
                await this.sleep(interval);
            }
            return null;
        }

        isVisible(el) {
            if (!el || !el.isConnected) return false;
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        }

        async getTileMenuButton(tile) {
            if (!tile) return null;

            // força hover no tile
            tile.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
            tile.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
            await this.sleep(350);

            const candidates = [
                ...tile.querySelectorAll('button'),
                ...tile.querySelectorAll('[role="button"]')
            ];

            for (const btn of candidates) {
                const text = btn.textContent?.trim() || '';
                const aria = btn.getAttribute('aria-label') || '';
                const title = btn.getAttribute('title') || '';

                if (
                    /more|mais/i.test(text) ||
                    /more|mais/i.test(aria) ||
                    /more|mais/i.test(title)
                ) {
                    if (this.isVisible(btn)) return btn;
                }

                const icon = btn.querySelector('i, span');
                const iconText = icon?.textContent?.trim() || '';
                if ((iconText === 'more_vert' || iconText === 'more_horiz') && this.isVisible(btn)) {
                    return btn;
                }
            }

            return null;
        }

        async openTileMenu(tile) {
            const menuBtn = await this.getTileMenuButton(tile);
            if (!menuBtn) return false;

            menuBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, view: window }));
            menuBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            menuBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            menuBtn.click();

            const opened = await this.waitFor(() => {
                const menuItems = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return menuItems.length ? menuItems : null;
            }, 5000);

            return !!opened;
        }

        async openDownloadSubmenu() {
            const downloadBtn = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => /download|baixar/i.test(el.textContent || ''));
            }, 5000);

            if (!downloadBtn) return false;

            downloadBtn.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
            downloadBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, view: window }));
            downloadBtn.click();

            const submenu = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => /1080p/i.test(el.textContent || ''));
            }, 5000);

            return !!submenu;
        }

        async click1080pOption() {
            const upscaleBtn = await this.waitFor(() => {
                const items = [...document.querySelectorAll('button[role="menuitem"], [role="menuitem"]')];
                return items.find(el => {
                    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
                    return /1080p/i.test(text);
                });
            }, 5000);

            if (!upscaleBtn) return { ok: false, reason: '1080p_not_found' };

            upscaleBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, view: window }));
            upscaleBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
            upscaleBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
            upscaleBtn.click();

            return { ok: true };
        }

        async waitForUpscaleToast() {
            // Pega QUALQUER toast que aparecer (não só o de sucesso), pra a gente
            // saber o que o Flow respondeu (ex: erro de "já tem upscale rodando").
            const toast = await this.waitFor(() => {
                const toasts = [...document.querySelectorAll('li[data-sonner-toast]')];
                return toasts[0] || null;
            }, 8000, 200);

            if (!toast) return { ok: false, text: '(nenhum toast apareceu)', type: '' };

            const text = (toast.innerText || toast.textContent || '').replace(/\s*Dismiss\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 130);
            const type = toast.getAttribute('data-type') || '';
            const isUpscaling = /upscal/i.test(text);   // "Upscaling your video..."

            const dismissBtn = [...toast.querySelectorAll('button')].find(btn => /dismiss/i.test(btn.textContent || ''));
            if (dismissBtn) dismissBtn.click();

            return { ok: isUpscaling, text, type };
        }

        getUpscaleRequestedSet() {
            if (!this._upscaleRequestedWfIds) this._upscaleRequestedWfIds = new Set();
            return this._upscaleRequestedWfIds;
        }
async scanIdentifiedVideosForUpscale() {
    const scroller = this.getScroller();
    const found = new Map();

    if (!scroller) {
        this.logVideoDebug('Upscale scan: scroller não encontrado.', 'error');
        return found;
    }

    const addFound = (workflowId, label, tile) => {
        if (!workflowId || !label) return;

        const match = label.match(/^Cena\s+([\d.]+)\s*-\s*(?:Vídeo|Video)\s+(\d+)$/i);
        if (!match) return;

        found.set(workflowId, {
            workflowId,
            label,
            sceneNum: parseFloat(match[1]),
            videoNum: parseInt(match[2], 10),
            tile
        });
    };

    this.logVideoDebug('🔎 Upscale: varrendo galeria para encontrar todos os vídeos identificados...', 'info');

    const scanVisibleTiles = async () => {
        const tiles = [...document.querySelectorAll('[data-tile-id]')];

        for (const rawTile of tiles) {
            const tile = rawTile.querySelector('a[href*="/edit/"]')
                ? rawTile
                : (rawTile.querySelector('[data-tile-id]') || rawTile);

            if (!tile || !this.isTileLoaded(tile)) continue;
            if (!this.isVideoTile(tile)) continue;

            const workflowId = this.getWorkflowIdFromTile(tile);
            if (!workflowId || found.has(workflowId)) continue;

            const name = await this.getTileName(tile);
            if (!name) continue;

            addFound(workflowId, name, tile);
        }
    };

    // Passada 1: de cima para baixo
    scroller.scrollTop = 0;
    await this.sleep(800);

    let samePositionCount = 0;

    for (let iter = 0; iter < 800; iter++) {
        await scanVisibleTiles();

        const prev = Math.round(scroller.scrollTop);
        const step = Math.max(300, Math.floor(scroller.clientHeight * 0.7));
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + step);

        await this.sleep(650);

        const now = Math.round(scroller.scrollTop);

        if (now === prev) {
            samePositionCount++;
        } else {
            samePositionCount = 0;
        }

        if (samePositionCount >= 2) break;
    }

    // Passada 2: de baixo para cima, para pegar o que a galeria virtualizada pulou
    scroller.scrollTop = scroller.scrollHeight;
    await this.sleep(800);

    samePositionCount = 0;

    for (let iter = 0; iter < 800; iter++) {
        await scanVisibleTiles();

        const prev = Math.round(scroller.scrollTop);
        const step = Math.max(300, Math.floor(scroller.clientHeight * 0.7));
        scroller.scrollTop = Math.max(0, scroller.scrollTop - step);

        await this.sleep(650);

        const now = Math.round(scroller.scrollTop);

        if (now === prev) {
            samePositionCount++;
        } else {
            samePositionCount = 0;
        }

        if (now <= 0 && samePositionCount >= 2) break;
    }

    // Também junta o que já estava na memória da extensão
    for (const [workflowId, data] of this.tileAssignments.entries()) {
        const label = data?.label || '';

        if (
            data?.type === 'scene' &&
            /^Cena\s+[\d.]+\s*-\s*(?:Vídeo|Video)\s+\d+$/i.test(label)
        ) {
            addFound(workflowId, label, null);
        }
    }

    if (this.videoSceneAssignments instanceof Map) {
        for (const [sceneName, arr] of this.videoSceneAssignments.entries()) {
            const sceneNum = parseFloat(sceneName.match(/[\d.]+/)?.[0] || 0);

            for (const item of arr || []) {
                if (!item?.workflowId) continue;

                const videoNum = Number(item.imgNum || 0);
                const label = sceneNum && videoNum
                    ? `Cena ${sceneNum} - Vídeo ${videoNum}`
                    : '';

                addFound(item.workflowId, label, null);
            }
        }
    }

    const sorted = new Map(
        [...found.entries()].sort((a, b) => {
            const av = a[1];
            const bv = b[1];

            if (av.sceneNum !== bv.sceneNum) return av.sceneNum - bv.sceneNum;
            return av.videoNum - bv.videoNum;
        })
    );

    this.logVideoDebug(
        `✅ Upscale scan: ${sorted.size} vídeo(s) identificado(s) encontrado(s).`,
        sorted.size ? 'success' : 'warning'
    );

    for (const item of sorted.values()) {
        this.logVideoDebug(`• ${item.label} → ${item.workflowId.substring(0, 8)}`, 'info');
    }

    return sorted;
}
            async debugUpscaleList() {
    const btn = document.getElementById('fv-upscale-debug-btn');
    const originalText = btn?.textContent || '🔎 Diagnosticar vídeos do upscale';

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Diagnosticando...';
    }

    try {
        const logsToggle = document.getElementById('fv-show-logs');
        const logsContainer = document.getElementById('fv-logs-container');

        if (logsToggle) logsToggle.checked = true;
        if (logsContainer) logsContainer.classList.add('visible');

        this.setVideoStatus('info', '🔎 Diagnosticando vídeos identificados para upscale...');
        this.logVideoDebug('🔎 Diagnóstico de upscale iniciado. Nenhum upscale será solicitado.', 'info');

        const identifiedVideosMap = await this.scanIdentifiedVideosForUpscale();
        const videos = [...identifiedVideosMap.values()];

        if (!videos.length) {
            this.setVideoStatus(
                'warning',
                'Nenhum vídeo identificado encontrado para upscale. Use "Analisar projeto existente" ou atribua/nomeie os vídeos primeiro.'
            );
            this.logVideoDebug('⚠️ Diagnóstico: nenhum vídeo identificado encontrado.', 'warning');
            return;
        }

        const byScene = new Map();

        for (const item of videos) {
            const sceneNum = Number(item.sceneNum || 0);
            if (!byScene.has(sceneNum)) byScene.set(sceneNum, []);
            byScene.get(sceneNum).push(item);
        }

        const sortedScenes = [...byScene.entries()]
            .sort((a, b) => a[0] - b[0]);

        this.logVideoDebug(`✅ Diagnóstico: ${videos.length} vídeo(s) identificado(s) encontrado(s).`, 'success');

        for (const [sceneNum, sceneVideos] of sortedScenes) {
            const sortedVideos = sceneVideos.sort((a, b) => Number(a.videoNum || 0) - Number(b.videoNum || 0));

            this.logVideoDebug(
                `Cena ${sceneNum}: ${sortedVideos.length} vídeo(s) identificado(s).`,
                'info'
            );

            for (const item of sortedVideos) {
                const workflowShort = item.workflowId
                    ? item.workflowId.substring(0, 8)
                    : 'sem-id';

                this.logVideoDebug(
                    `• ${item.label} → ${workflowShort}`,
                    'info'
                );
            }
        }

        this.setVideoStatus(
            'success',
            `✅ Diagnóstico concluído: ${videos.length} vídeo(s) identificado(s) para upscale. Confira os logs.`
        );

    } catch (err) {
        this.setVideoStatus('error', 'Erro no diagnóstico do upscale: ' + err.message);
        this.logVideoDebug('Erro no diagnóstico do upscale: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}
        async startUpscaleProcess() {
           const btn = document.getElementById('fv-upscale-btn');

// Controle apenas desta execução.
// Assim uma variação não fica "pulada" por ter sido marcada em tentativa anterior.
const requested = new Set();

            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Iniciando Upscale 1080p...';
            }
            // Mostra botão de parar e reseta flag
            this.upscaleShouldStop = false;
            const stopBtn = document.getElementById('fv-upscale-stop-btn');
            if (stopBtn) stopBtn.style.display = '';

            // Salva URL do projeto para detectar se saiu
            const projectUrl = location.href;

const identifiedVideosMap = await this.scanIdentifiedVideosForUpscale();

const wfIdsToUpscale = [...identifiedVideosMap.keys()].filter(wfId => !requested.has(wfId));

this.logVideoDebug(
    `Upscale: ${wfIdsToUpscale.length} vídeo(s) identificado(s) único(s) serão processados agora.`,
    'info'
);

            if (!wfIdsToUpscale.length) {
                this.setVideoStatus('warning', 'Nenhum vídeo identificado pendente para upscale. Use "Analisar projeto existente" ou atribua as cenas primeiro.');
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)';
                }
                return;
            }

            this.logVideoDebug(`Iniciando upscale de ${wfIdsToUpscale.length} vídeo(s)...`, 'info');
            this.setVideoStatus('info', `🚀 Solicitando upscale de ${wfIdsToUpscale.length} vídeo(s)...`);

            let count = 0;
            let fail = 0;
            const failedWfIds = []; // guarda IDs que falharam para retry

            for (const wfId of wfIdsToUpscale) {
                const videoInfo = identifiedVideosMap.get(wfId);
const videoLabel = videoInfo?.label || wfId.substring(0, 8);

this.logVideoDebug(`🎬 Processando upscale: ${videoLabel}`, 'info');
this.setVideoStatus('info', `🚀 Pedindo upscale: ${videoLabel}`);
                if (this.upscaleShouldStop) break;

                // Verifica se ainda está no MESMO PROJETO — comparando só o ID do projeto,
                // NÃO a URL inteira. Assim, abrir um vídeo (.../project/ID/edit/...) não é
                // tratado como "saiu do projeto" (era o bug que abortava o upscale).
                const getProj = u => (String(u).match(/project\/([a-f0-9-]{36})/) || [])[1] || null;
                this.logVideoDebug(`🔗 URL atual: ${location.href}`, 'info');   // DIAGNÓSTICO
                if (getProj(location.href) !== getProj(projectUrl)) {
                    this.logVideoDebug(`❌ Saiu do projeto! Parando upscale. (esperado projeto=${getProj(projectUrl)}, atual=${getProj(location.href)}, url=${location.href})`, 'error');
                    this.setVideoStatus('error', '❌ O upscale parou porque a página saiu do projeto. Volte ao projeto e tente novamente.');
                    break;
                }
                // Continua no MESMO projeto, mas drifou pra uma subrota (/edit/, /collection/, etc)?
                // Volta pra grade (history.back é client-side, não recarrega, então o loop sobrevive).
                if (location.href !== projectUrl) {
                    this.logVideoDebug(`↩️ Página saiu da grade (${location.href}); voltando...`, 'warning');
                    for (let back = 0; back < 3 && location.href !== projectUrl; back++) {
                        history.back();
                        await this.sleep(1200);
                    }
                    await this.waitFor(() => document.querySelectorAll('[data-tile-id]').length > 0, 6000);
                    await this.sleep(400);
                }

                try {
                    const tile = await this.scrollToWorkflow(wfId);
                    if (!tile) {
                        this.logVideoDebug(`❌ Tile não encontrado para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const menuOpened = await this.openTileMenu(tile);
                    if (!menuOpened) {
                        this.logVideoDebug(`❌ Menu não abriu para ${wfId.substring(0, 8)}`, 'error');
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const submenuOpened = await this.openDownloadSubmenu();
                    if (!submenuOpened) {
                        this.logVideoDebug(`❌ Submenu Download não abriu para ${wfId.substring(0, 8)}`, 'error');
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            bubbles: true
                        }));
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const clickResult = await this.click1080pOption();
                    if (!clickResult.ok) {
                        this.logVideoDebug(`⚠️ Opção 1080p não encontrada para ${wfId.substring(0, 8)}`, 'warning');
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            bubbles: true
                        }));
                        fail++;
                        failedWfIds.push(wfId);
                        continue;
                    }

                    const toastRes = await this.waitForUpscaleToast();
                    if (toastRes.ok) {
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`✅ Upscale solicitado para ${videoLabel}`, 'success');
                    } else {
                        // Não veio o "Upscaling your video". Loga o que o Flow respondeu.
                        requested.add(wfId);
                        count++;
                        this.logVideoDebug(`⚠️ ${videoLabel}: Flow respondeu → "${toastRes.text}" (tipo: ${toastRes.type || '?'})`, 'warning');
                    }

                    if (btn) btn.textContent = `⏳ Upscale ${count}/${wfIdsToUpscale.length}`;
                    // Pausa adaptativa: se o Flow confirmou, segue rápido; se não
                    // confirmou, dá um respiro maior (ele pede pra não rodar vários juntos).
                    await this.sleep(toastRes.ok ? 1800 : 4000);

                } catch (err) {
                    fail++;
                    failedWfIds.push(wfId);
                    this.logVideoDebug(`❌ Erro no upscale ${wfId.substring(0, 8)}: ${err.message}`, 'error');
                    document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        bubbles: true
                    }));
                    await this.sleep(500);
                }
            }

            this.setVideoStatus('success', `✅ Upscale solicitado para ${count} vídeo(s). Falhas: ${fail}.`);
this.logVideoDebug(`✅ Processo concluído. Upscale solicitado: ${count}. Falhas: ${fail}.`, 'success');

if (btn) {
    btn.disabled = false;
    btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)';
}
// Esconde botão de parar
const stopBtn2 = document.getElementById('fv-upscale-stop-btn');
if (stopBtn2) stopBtn2.style.display = 'none';

// Salva falhas e mostra botão de retry se houver
this._upscaleFailedWfIds = failedWfIds;
this._upscaleVideosMap = identifiedVideosMap;
const retryBtn = document.getElementById('fv-upscale-retry-btn');
if (retryBtn) {
    if (failedWfIds.length > 0) {
        retryBtn.style.display = '';
        retryBtn.textContent = `🔄 Retentar ${failedWfIds.length} Falha(s) do Upscale`;
    } else {
        retryBtn.style.display = 'none';
    }
}
}

        /** Retenta upscale apenas nos vídeos que falharam na tentativa anterior */
        async retryFailedUpscale() {
            if (!this._upscaleFailedWfIds || !this._upscaleFailedWfIds.length) {
                this.setVideoStatus('warning', 'Nenhuma falha para retentar.');
                return;
            }

            const btn = document.getElementById('fv-upscale-btn');
            const retryBtn = document.getElementById('fv-upscale-retry-btn');
            const stopBtn = document.getElementById('fv-upscale-stop-btn');

            if (btn) { btn.disabled = true; btn.textContent = '⏳ Retentando Upscale...'; }
            if (retryBtn) retryBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = '';
            this.upscaleShouldStop = false;

            const projectUrl = location.href;
            const identifiedVideosMap = this._upscaleVideosMap || new Map();
            const wfIdsToRetry = [...this._upscaleFailedWfIds];

            this.logVideoDebug(`\n╔═══ RETENTANDO UPSCALE: ${wfIdsToRetry.length} VÍDEO(S) ═══╗`, 'info');
            this.setVideoStatus('info', `🔄 Retentando upscale de ${wfIdsToRetry.length} vídeo(s)...`);

            let count = 0;
            let fail = 0;
            const stillFailed = [];

            for (let i = 0; i < wfIdsToRetry.length; i++) {
                const wfId = wfIdsToRetry[i];
                const videoInfo = identifiedVideosMap.get(wfId);
                const videoLabel = videoInfo?.label || wfId.substring(0, 8);

                if (this.upscaleShouldStop) break;

                if (location.href !== projectUrl) {
                    this.logVideoDebug('❌ Saiu do projeto! Parando retry.', 'error');
                    this.setVideoStatus('error', '❌ Saiu do projeto durante o retry.');
                    // Salva os restantes como falha
                    for (let j = i; j < wfIdsToRetry.length; j++) stillFailed.push(wfIdsToRetry[j]);
                    break;
                }

                this.logVideoDebug(`🔄 Retry ${i+1}/${wfIdsToRetry.length}: ${videoLabel}`, 'info');
                this.setVideoStatus('info', `🔄 Retry ${i+1}/${wfIdsToRetry.length}: ${videoLabel}`);

                try {
                    const tile = await this.scrollToWorkflow(wfId);
                    if (!tile) { fail++; stillFailed.push(wfId); continue; }

                    const menuOpened = await this.openTileMenu(tile);
                    if (!menuOpened) { fail++; stillFailed.push(wfId); continue; }

                    const submenuOpened = await this.openDownloadSubmenu();
                    if (!submenuOpened) {
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                        fail++; stillFailed.push(wfId); continue;
                    }

                    const clickResult = await this.click1080pOption();
                    if (!clickResult.ok) {
                        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                        fail++; stillFailed.push(wfId); continue;
                    }

                    const toastRes = await this.waitForUpscaleToast();
                    count++;
                    this.logVideoDebug(`✅ Retry upscale OK: ${videoLabel}${toastRes.ok ? '' : ` (Flow: "${toastRes.text}")`}`, 'success');

                    if (btn) btn.textContent = `⏳ Retry ${count}/${wfIdsToRetry.length}`;
                    await this.sleep(2200);

                } catch (err) {
                    fail++;
                    stillFailed.push(wfId);
                    this.logVideoDebug(`❌ Retry falhou: ${wfId.substring(0, 8)}: ${err.message}`, 'error');
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
                    await this.sleep(500);
                }
            }

            this.logVideoDebug(`╚═══ FIM RETRY: ${count} recuperado(s), ${fail} falha(s) ═══╝`, 'info');
            this.setVideoStatus(fail > 0 ? 'warning' : 'success',
                `${fail > 0 ? '⚠️' : '✅'} Retry concluído: ${count} recuperado(s), ${fail} falha(s).`
            );

            if (btn) { btn.disabled = false; btn.textContent = '🚀 Upscale 1080p (Vídeos Identificados)'; }
            if (stopBtn) stopBtn.style.display = 'none';

            // Atualiza lista de falhas para possível novo retry
            this._upscaleFailedWfIds = stillFailed;
            if (retryBtn) {
                if (stillFailed.length > 0) {
                    retryBtn.style.display = '';
                    retryBtn.textContent = `🔄 Retentar ${stillFailed.length} Falha(s) do Upscale`;
                } else {
                    retryBtn.style.display = 'none';
                }
            }
        }

async scrollToWorkflow(wfId) {
            const scroller = this.getScroller();
            if (!scroller) return null;

            // Verifica se tiles existem (confirma que estamos num projeto)
            const tilesExist = document.querySelectorAll('[data-tile-id]').length > 0;
            if (!tilesExist) {
                this.logVideoDebug('⚠️ scrollToWorkflow: nenhum tile encontrado. Pode ter saído do projeto.', 'warning');
                return null;
            }

            // Primeiro tenta achar sem scrollar (já visível)
            const linkDirect = document.querySelector(`a[href*="/edit/${wfId}"]`);
            if (linkDirect) {
                const tileDirect = linkDirect.closest('[data-tile-id]');
                if (tileDirect) return tileDirect;
            }

            // Scroll pro topo do virtualizer (não da página)
            scroller.scrollTop = 0;
            await this.sleep(600);

            for (let iter = 0; iter < 80; iter++) {
                // Check de parada
                if (this.upscaleShouldStop) return null;

                // Verifica se ainda tem tiles (não saiu do projeto)
                if (document.querySelectorAll('[data-tile-id]').length === 0) {
                    this.logVideoDebug('⚠️ scrollToWorkflow: tiles sumiram durante scroll. Abortando.', 'warning');
                    return null;
                }

                const link = document.querySelector(`a[href*="/edit/${wfId}"]`);
                if (link) {
                    const tile = link.closest('[data-tile-id]');
                    if (tile) {
                        // Ajuste de posição para ficar visível
                        const rect = tile.getBoundingClientRect();
                        const scrollerRect = scroller.getBoundingClientRect();
                        if (rect.top < scrollerRect.top + 50 || rect.bottom > scrollerRect.bottom - 50) {
                            const relativeTop = rect.top - scrollerRect.top;
                            scroller.scrollTop += (relativeTop - scrollerRect.height / 2 + rect.height / 2);
                            await this.sleep(300);
                        }
                        return tile;
                    }
                }

                const prev = scroller.scrollTop;
                scroller.scrollTop += 450;
                await this.sleep(400);
                if (scroller.scrollTop === prev) break; // Chegou no fim
            }
            return null;
        }

        /** Comunicação com background via bridge */
        sendToBackground(action, data = {}) {
            return new Promise((resolve) => {
                const id = 'cd_' + Date.now() + '_' + Math.random();
                const handler = (event) => {
                    if (event.data?.type === 'CD_FROM_BACKGROUND' && event.data.id === id) {
                        window.removeEventListener('message', handler);
                        resolve(event.data.result);
                    }
                };
                window.addEventListener('message', handler);
                window.postMessage({ type: 'CD_TO_BACKGROUND', action, data, id }, '*');
                setTimeout(() => { window.removeEventListener('message', handler); resolve({ success: false, error: 'Timeout' }); }, 30000);
            });
        }

        // ──────────────────────────────────────────────
        // CRASH RECOVERY (memória de estado)
        // ──────────────────────────────────────────────

        /**
         * Salva estado do run antes de reload por crash.
         * Guarda: prompts, posição, modo, configurações.
         */
        saveRunState(currentPromptNum) {
            try {
                const imgInput = document.getElementById('flow-prompts-input');
                const vidInput = document.getElementById('fv-prompts-input');
                const isVideo = this.videoIsRunning;

                const state = {
                    timestamp: Date.now(),
                    promptText: isVideo ? (vidInput?.value || '') : (imgInput?.value || ''),
                    currentPromptNum: currentPromptNum,
                    isVideo: isVideo,
                    genMode: isVideo ? this.videoGenMode : this.genMode,
                    speedMultiplier: this.speedMultiplier,
                    batchSize: isVideo ? this.videoBatchSize : this.batchSize,
                    imagesPerPrompt: isVideo ? this.videoResultsPerPrompt : this.imagesPerPrompt,
                    projectUrl: location.href
                };

                localStorage.setItem('flow_crash_state', JSON.stringify(state));
                console.log('[Flow] Estado salvo para crash recovery:', state);
            } catch (e) {
                console.error('[Flow] Falha ao salvar estado:', e);
            }
        }

        /**
         * Carrega estado salvo do crash anterior.
         */
        loadRunState() {
            try {
                const raw = localStorage.getItem('flow_crash_state');
                if (!raw) return null;
                const state = JSON.parse(raw);
                // Expira estados com mais de 30 minutos
                if (Date.now() - state.timestamp > 30 * 60 * 1000) {
                    this.clearRunState();
                    return null;
                }
                return state;
            } catch (e) {
                return null;
            }
        }

        /**
         * Limpa estado salvo.
         */
        clearRunState() {
            localStorage.removeItem('flow_crash_state');
        }

        /**
         * Verifica se há estado salvo de crash e mostra banner de recuperação.
         */
        checkCrashRecovery() {
            const state = this.loadRunState();
            if (!state) return;

            // Cria banner de recuperação
            const banner = document.createElement('div');
            banner.id = 'flow-crash-recovery-banner';
            banner.style.cssText = `
                position: fixed; bottom: 20px; right: 20px; z-index: 99999;
                background: linear-gradient(135deg, #1e1b4b, #312e81);
                border: 1px solid #6366f1; border-radius: 12px;
                padding: 16px 20px; color: #e0e7ff;
                font-family: 'Inter', sans-serif; font-size: 13px;
                box-shadow: 0 8px 32px rgba(99,102,241,0.4);
                max-width: 380px; line-height: 1.5;
            `;

            const modeLabel = state.isVideo ? '🎬 Vídeo' : '🖼️ Imagem';
            const modeText = state.genMode === 'scenes' ? 'Cenas' : state.genMode === 'refs' ? 'Referências' : 'Livre';
            const timeAgo = Math.round((Date.now() - state.timestamp) / 60000);

            banner.innerHTML = `
                <div style="font-weight:700; font-size:14px; margin-bottom:8px; color:#a5b4fc;">
                    🔄 Sessão anterior detectada
                </div>
                <div style="margin-bottom:4px;">
                    ${modeLabel} • Modo ${modeText} • Parou no prompt <b>${state.currentPromptNum}</b>
                </div>
                <div style="font-size:11px; opacity:0.7; margin-bottom:12px;">
                    Há ${timeAgo < 1 ? 'menos de 1' : timeAgo} minuto(s) atrás
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="flow-crash-resume" style="
                        flex:1; padding:8px 12px; border:none; border-radius:8px;
                        background:linear-gradient(135deg, #6366f1, #8b5cf6);
                        color:white; font-weight:600; cursor:pointer; font-size:13px;
                    ">▶ Continuar de onde parou</button>
                    <button id="flow-crash-dismiss" style="
                        padding:8px 12px; border:1px solid #4f46e5; border-radius:8px;
                        background:transparent; color:#a5b4fc; cursor:pointer; font-size:13px;
                    ">✕</button>
                </div>
            `;

            document.body.appendChild(banner);

            // Handler: Continuar
            document.getElementById('flow-crash-resume').addEventListener('click', () => {
                const s = state;
                if (s.isVideo) {
                    // Preenche aba de vídeo
                    const vidInput = document.getElementById('fv-prompts-input');
                    if (vidInput) vidInput.value = s.promptText;
                    // Seta retomar de
                    const resumeInput = document.getElementById('fv-start-from');
                    if (resumeInput) resumeInput.value = String(s.currentPromptNum);
                    // Abre aba de vídeo
                    document.querySelector('[data-tab="video"]')?.click();
                } else {
                    // Preenche aba de imagem
                    const imgInput = document.getElementById('flow-prompts-input');
                    if (imgInput) imgInput.value = s.promptText;
                    // Seta retomar de
                    const resumeInput = document.getElementById('flow-start-from');
                    if (resumeInput) resumeInput.value = String(s.currentPromptNum);
                    // Dispara evento para atualizar contadores
                    imgInput?.dispatchEvent(new Event('input', { bubbles: true }));
                }

                this.setStatus('info', `✅ Prompts restaurados! "Retomar de" setado para ${s.currentPromptNum}. Clique Iniciar quando pronto.`);
                this.clearRunState();
                banner.remove();
            });

            // Handler: Dispensar
            document.getElementById('flow-crash-dismiss').addEventListener('click', () => {
                this.clearRunState();
                banner.remove();
            });
        }

        // ──────────────────────────────────────────────
        // CRASH DETECTION
        // ──────────────────────────────────────────────

        /**
         * Detecta se o Flow crashou (client-side exception).
         * Verifica: texto de erro na página, editor ausente, ou body com overlay de erro.
         */
        isFlowCrashed() {
            // 1. Texto explícito de crash do Next.js/React
            const bodyText = document.body?.innerText || '';
            if (bodyText.includes('Application error') && bodyText.includes('client-side exception')) return true;

            // 2. Overlay de erro do Next.js
            const errorOverlay = document.getElementById('__next-route-announcer__')?.parentElement;
            if (errorOverlay && bodyText.includes('Error')) {
                // Verifica se o editor sumiu (indica crash real)
                const editor = this.getEditor?.();
                const submitBtn = [...document.querySelectorAll('button')].find(b =>
                    b.querySelector('i.google-symbols')?.textContent.trim() === 'arrow_forward'
                );
                if (!editor && !submitBtn) return true;
            }

            return false;
        }

        // ──────────────────────────────────────────────
        // UI HELPERS
        // ──────────────────────────────────────────────

        setStatus(type, msg) {
            const el = document.getElementById('flow-status');
            el.className = 'flow-status ' + type;
            el.innerHTML = msg;
        }

        updateProgress(fraction) {
            const pct = Math.round(fraction * 100);
            document.getElementById('flow-progress-bar').style.width = pct + '%';
            document.getElementById('flow-mini-progress-bar').style.width = pct + '%';
        }

       updateMini(title, sub, fraction, details) {
    const panel = document.getElementById('flow-panel');
    const mini = document.getElementById('flow-mini');
    const sidebar = document.getElementById('flow-sidebar');

    const panelOpen = panel?.classList.contains('active');
    const isAnyAutomationRunning = this.isRunning || this.videoIsRunning;

    if (!panelOpen && isAnyAutomationRunning) {
        if (mini) mini.style.display = 'flex';
        if (sidebar) sidebar.style.display = '';
    } else if (!isAnyAutomationRunning) {
        if (mini) mini.style.display = 'none';
    }

    const statusEl = document.getElementById('flow-mini-status');
    const subEl = document.getElementById('flow-mini-sub');
    const detailsEl = document.getElementById('flow-mini-details');

    if (statusEl) statusEl.textContent = title || 'Processando...';
    if (subEl) subEl.textContent = sub || '';
    if (detailsEl) detailsEl.textContent = details || '';

    this.updateProgress(fraction);
}
        buildPromptList() {
            document.getElementById('flow-prompts-preview-card').style.display = 'block';
            document.getElementById('flow-queue-info').textContent = `${this.prompts.length} prompts na fila`;
            document.getElementById('flow-prompt-list').innerHTML = this.prompts.map((p, i) => {
                const refs = (p.text.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1,-1));
                return `<div class="flow-prompt-item" data-index="${i}">
                    <span class="num">${p.promptNum}</span>
                    <span class="text">${this.esc(p.text.replace(/\[([^\]]+)\]/g, '●$1'))}</span>
                    ${refs.length ? `<span class="refs">${refs.map(r => `<span class="ref-badge">${this.esc(r)}</span>`).join('')}</span>` : ''}
                </div>`;
            }).join('');
        }

        updatePromptItemStatus(index, status, extra = '') {
            const item = document.querySelector(`.flow-prompt-item[data-index="${index}"]`);
            if (!item) return;
            item.className = `flow-prompt-item ${status}`;
            let badge = item.querySelector('.status-badge');
            const icons  = { active:'⚡', done:'✅', error:'❌', retrying:'🔄' };
            const labels = { active:'Gerando', done:'Concluído', error:'Falhou', retrying:'Retentando' };
            const colors = {
                active:   { bg:'#e0f2fe', fg:'#0369a1' },
                done:     { bg:'#d1fae5', fg:'#065f46' },
                error:    { bg:'#fee2e2', fg:'#991b1b' },
                retrying: { bg:'#fef9c3', fg:'#78350f' },
            };
            if (status !== 'active' || extra) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'status-badge'; item.appendChild(badge); }
                badge.textContent = `${icons[status] || ''} ${extra || labels[status] || status}`;
                const clr = colors[status] || colors.active;
                badge.style.background = clr.bg; badge.style.color = clr.fg;
            } else if (badge) { badge.remove(); }
        }

        showCompletionPopup(msg, failedPrompts) {
            const msgEl = document.getElementById('flow-popup-msg');
            if (msgEl) msgEl.textContent = msg || 'Concluído!';
            const failedEl = document.getElementById('flow-popup-failed');
            if (failedEl) {
                if (failedPrompts && failedPrompts.length > 0) {
                    failedEl.style.display = 'block';
                    failedEl.innerHTML = '<div style="font-weight:600;margin-bottom:6px;color:#991b1b;">⚠️ Prompts que falharam:</div>' +
                        failedPrompts.map(p => `<div>#${p.promptNum} — ${this.esc(p.text.substring(0, 80))}${p.text.length > 80 ? '...' : ''}</div>`).join('');
                } else {
                    failedEl.style.display = 'none';
                    failedEl.innerHTML = '';
                }
            }
            // Botão de download das mídias geradas nesta execução
            const dlBtn = document.getElementById('flow-popup-download');
            if (dlBtn) {
                const media = this._lastRunMedia || [];
                if (media.length > 0) {
                    const isVideo = media[0]?.isVideo;
                    const label = isVideo ? 'vídeo(s)' : 'imagem(ns)';
                    dlBtn.textContent = `⬇️ Baixar ${media.length} ${label}`;
                    dlBtn.style.display = '';
                    dlBtn.disabled = false;
                } else {
                    dlBtn.style.display = 'none';
                }
            }
            const overlay = document.getElementById('flow-popup-overlay');
            const popup = document.getElementById('flow-popup');
            if (overlay) overlay.style.display = 'block';
            if (popup) popup.style.display = 'block';
        }

        logDebug(msg, type = 'info') {
            const panel = document.getElementById('flow-debug-panel');
            if (panel) {
                const line = document.createElement('div');
                line.className = `flow-debug-line ${type}`;
                line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
                panel.appendChild(line);
                panel.scrollTop = panel.scrollHeight;
            }
            if      (type === 'error')   log.error(msg);
            else if (type === 'success') log.success(msg);
            else                         log.info(msg);
        }

        // ──────────────────────────────────────────────
        // VIDEO UI HELPERS
        // ──────────────────────────────────────────────

        setVideoStatus(type, msg) {
            const el = document.getElementById('fv-status');
            el.className = 'flow-status ' + type;
            el.innerHTML = msg;
        }

        updateVideoProgress(fraction) {
            const pct = Math.round(fraction * 100);
            document.getElementById('fv-progress-bar').style.width = pct + '%';
            document.getElementById('flow-mini-progress-bar').style.width = pct + '%';
        }

        buildVideoPromptList() {
            document.getElementById('fv-prompts-preview-card').style.display = 'block';
            document.getElementById('fv-queue-info').textContent = `${this.videoPrompts.length} prompts na fila`;
            document.getElementById('fv-prompt-list').innerHTML = this.videoPrompts.map((p, i) => {
                const refs = (p.text.match(/\[([^\]]+)\]/g) || []).map(m => m.slice(1,-1));
                return `<div class="flow-prompt-item" data-index="${i}">
                    <span class="num">${p.promptNum}</span>
                    <span class="text">${this.esc(p.text.replace(/\[([^\]]+)\]/g, '●$1'))}</span>
                    ${refs.length ? `<span class="refs">${refs.map(r => `<span class="ref-badge">${this.esc(r)}</span>`).join('')}</span>` : ''}
                </div>`;
            }).join('');
        }

        updateVideoPromptItemStatus(index, status, extra = '') {
            const item = document.querySelector(`#fv-prompt-list .flow-prompt-item[data-index="${index}"]`);
            if (!item) return;
            item.className = `flow-prompt-item ${status}`;
            let badge = item.querySelector('.status-badge');
            const icons  = { active:'⚡', done:'✅', error:'❌', retrying:'🔄' };
            const labels = { active:'Gerando', done:'Concluído', error:'Falhou', retrying:'Retentando' };
            const colors = {
                active:   { bg:'#e0f2fe', fg:'#0369a1' },
                done:     { bg:'#d1fae5', fg:'#065f46' },
                error:    { bg:'#fee2e2', fg:'#991b1b' },
                retrying: { bg:'#fef9c3', fg:'#78350f' },
            };
            if (status !== 'active' || extra) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'status-badge'; item.appendChild(badge); }
                badge.textContent = `${icons[status] || ''} ${extra || labels[status] || status}`;
                const clr = colors[status] || colors.active;
                badge.style.background = clr.bg; badge.style.color = clr.fg;
            } else if (badge) { badge.remove(); }
        }

        logVideoDebug(msg, type = 'info') {
            const panel = document.getElementById('fv-debug-panel');
            if (panel) {
                const line = document.createElement('div');
                line.className = `flow-debug-line ${type}`;
                line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] 🎬 ${msg}`;
                panel.appendChild(line);
                panel.scrollTop = panel.scrollHeight;
            }
            if      (type === 'error')   log.error(`[Video] ${msg}`);
            else if (type === 'success') log.success(`[Video] ${msg}`);
            else                         log.info(`[Video] ${msg}`);
        }
    }

    // ============================================================
    // INICIALIZA
    // ============================================================
    if (window.__installFlowModern) {
        window.__installFlowModern(FlowAutomation, { CONFIG, parsePrompt, parsePromptsText, extractReferences, parseReferenceHeader });
        delete window.__installFlowModern;
    }
    new FlowAutomation();

    if (window.__CRIADORES_DARK_USER__) {
        const u = window.__CRIADORES_DARK_USER__;
        log.success(`Usuário: ${u.name} (${u.email})`);
    }

})();

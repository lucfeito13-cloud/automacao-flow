/* Criadores Dark - por que o "Enumerar" nao casou? (SO LEITURA) */
(function () {
  'use strict';
  const L = [];
  const say = s => L.push(s);
  const norm = v => String(v || '').replace(/\s+/g, ' ').trim();

  const A = window.FlowAutomationInstance || null;
  const proto = window.FlowAutomation && window.FlowAutomation.prototype;
  const alvo = A || proto;

  say('===== POR QUE O ENUMERAR NAO CASOU =====');
  say('instancia encontrada: ' + !!A + ' | prototype: ' + !!proto);

  // 1. Prompts lidos da caixa
  const ehVideo = !!(alvo && alvo._videoAssignActive);
  const caixa = document.getElementById(ehVideo ? 'fv-prompts-input' : 'flow-prompts-input');
  say('');
  say('--- CAIXA DE PROMPTS (' + (ehVideo ? 'video' : 'imagens') + ') ---');
  say('tem texto? ' + !!(caixa && caixa.value.trim()) + ' | tamanho: ' + ((caixa && caixa.value.length) || 0));
  let prompts = [];
  try {
    prompts = (window.parsePromptsText || alvo.constructor.parsePromptsText || (() => []))(caixa ? caixa.value : '');
  } catch (e) { say('nao consegui usar parsePromptsText: ' + e.message); }
  if (!prompts.length && caixa) {
    prompts = caixa.value.split('\n').map(s => s.trim()).filter(Boolean)
      .map((text, i) => ({ text, promptNum: i + 1 }));
    say('(usei divisao simples por linha para o diagnostico)');
  }
  say('prompts lidos: ' + prompts.length);
  prompts.slice(0, 5).forEach(p => say('  #' + p.promptNum + '  ' + norm(p.text).slice(0, 70)));

  // 2. Titulos das midias na tela
  say('');
  say('--- MIDIAS NA TELA ---');
  const tiles = [...document.querySelectorAll('flow-grid-tile-container, [data-tile-id]')];
  say('tiles encontrados: ' + tiles.length);
  const vistos = new Set();
  let n = 0;
  for (const tile of tiles) {
    const nome = norm(tile.getAttribute('aria-label') || (tile.querySelector('.footer-title') || {}).textContent);
    if (!nome || vistos.has(nome)) continue;
    vistos.add(nome);
    if (n++ >= 12) continue;
    const cortado = /[…]$/.test(nome) || /\.\.\.$/.test(nome);
    const semCorte = nome.replace(/[….]+$/, '').trim().toLowerCase();
    const iguais = prompts.filter(p => norm(p.text).toLowerCase() === semCorte).length;
    const comecam = semCorte.length >= 12
      ? prompts.filter(p => norm(p.text).toLowerCase().startsWith(semCorte)).length : 0;
    let lido = null;
    try { lido = alvo && alvo.lerNome ? alvo.lerNome.call(alvo, nome) : null; } catch (_) {}
    say('');
    say('[' + n + '] titulo: ' + JSON.stringify(nome.slice(0, 80)));
    say('     cortado(…): ' + cortado + ' | ja tem nome de cena? ' + (lido ? JSON.stringify(lido) : 'nao'));
    say('     prompts iguais: ' + iguais + ' | prompts que COMECAM assim: ' + comecam);
  }

  say('');
  say('===== FIM =====');
  const txt = L.join('\n');
  window.__diagEnum = txt;
  console.log(txt);
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    a.download = 'flow-enumerar.txt';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    console.log('>>> SALVO: flow-enumerar.txt em Downloads <<<');
  } catch (e) { console.log('nao salvou: ' + e.message); }
})();

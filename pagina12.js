/**
 * ============================================================
 *  CRAWLER — Página|12 Search Results
 *  Extrai: título, preview, link, data, categoria, autor
 *  Navega automaticamente por todas as páginas via "Siguiente Página"
 * ============================================================
 */

(async function crawler() {

  // ── Utilitários ──────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const NOT_FOUND = '[não encontrado]';

  /**
   * Aguarda um seletor aparecer no DOM.
   * @param {string} selector
   * @param {number} timeout  - ms máximos de espera
   * @param {number} interval - ms entre tentativas
   */
  async function waitForSelector(selector, timeout = 10000, interval = 300) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (document.querySelector(selector)) return true;
      await sleep(interval);
    }
    return false;
  }

  /**
   * Aguarda o container de resultados parar de mudar de tamanho
   * (útil após clicar em "Siguiente Página").
   */
  async function waitForResultsToStabilize(previousCount, timeout = 8000, interval = 400) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = document.querySelectorAll('.p12-article-card-full').length;
      if (current > previousCount) return current;
      await sleep(interval);
    }
    return document.querySelectorAll('.p12-article-card-full').length;
  }

  // ── Extração de um card ───────────────────────────────────
  function extractCard(card) {
    // --- Link ---
    const anchor = card.querySelector('a.p12-article-card-full--inner');
    const link = anchor
      ? (anchor.href || anchor.getAttribute('href') || NOT_FOUND)
      : NOT_FOUND;

    // --- Título ---
    const titleEl = card.querySelector('.p12-article-card-full--content h4, .p12-article-card-full--content h3, .p12-article-card-full--content h2, .p12-article-card-full--content .title');
    const titulo = titleEl ? titleEl.textContent.trim() : NOT_FOUND;

    // --- Preview (lead/bajada) ---
    const previewEl = card.querySelector('.p12-article-card-full--content .lead, .p12-article-card-full--content p');
    const preview = previewEl ? previewEl.textContent.trim() : NOT_FOUND;

    // --- Data ---
    const timeEl = card.querySelector('time');
    const data = timeEl
      ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim() || NOT_FOUND)
      : NOT_FOUND;

    // --- Categoria (alt da img dentro de .logo-wrp) ---
    const logoImg = card.querySelector('.logo-wrp img');
    const categoria = logoImg
      ? (logoImg.getAttribute('alt') || NOT_FOUND)
      : NOT_FOUND;

    // --- Autor ---
    const authorEl = card.querySelector('.p12Author');
    let autor = NOT_FOUND;
    if (authorEl) {
      // Remove o prefixo "Por " se existir
      autor = authorEl.textContent.trim().replace(/^Por\s+/i, '').trim() || NOT_FOUND;
    }

    return { titulo, preview, link, data, categoria, autor };
  }

  // ── Loop principal ────────────────────────────────────────
  console.log('🕷️  Crawler iniciado...');

  // Aguarda os cards iniciais carregarem
  const ready = await waitForSelector('.p12-article-card-full');
  if (!ready) {
    console.error('❌ Nenhum resultado encontrado na página. Encerrando.');
    return;
  }

  const allResults = [];
  let pageNumber = 0;

  while (true) {
    pageNumber++;
    console.log(`\n📄 Processando página ${pageNumber}...`);

    // Pequena pausa para garantir renderização completa
    await sleep(800);

    const cards = document.querySelectorAll('.p12-article-card-full');
    console.log(`   ${cards.length} cards visíveis no total`);

    // Extrai apenas os cards ainda não processados
    const startIndex = allResults.length;
    for (let i = startIndex; i < cards.length; i++) {
      const item = extractCard(cards[i]);
      allResults.push(item);
      console.log(`   ✅ [${i + 1}] ${item.titulo}`);
    }

    // Verifica se existe o botão "Siguiente Página"
    const nextBtn = document.querySelector('.navigation-start');
    if (!nextBtn) {
      console.log('\n🏁 Botão "Siguiente Página" não encontrado. Todas as páginas foram processadas.');
      break;
    }

    // Rola até o botão e clica
    console.log('   ➡️  Clicando em "Siguiente Página"...');
    nextBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(600);

    const countBefore = document.querySelectorAll('.p12-article-card-full').length;
    nextBtn.click();

    // Aguarda novos cards aparecerem
    const countAfter = await waitForResultsToStabilize(countBefore, 12000, 400);
    if (countAfter <= countBefore) {
      console.log('⚠️  Nenhum card novo carregou após o clique. Encerrando.');
      break;
    }

    console.log(`   ✔️  ${countAfter - countBefore} novos cards carregados.`);
    await sleep(500); // pausa de cortesia antes da próxima extração
  }

  // ── Exibição final ────────────────────────────────────────
  console.log('\n\n════════════════════════════════════════════');
  console.log(`📊 TOTAL DE RESULTADOS COLETADOS: ${allResults.length}`);
  console.log('════════════════════════════════════════════\n');
  console.table(allResults);

  // Exporta como JSON no console para fácil cópia
  console.log('\n📋 JSON exportado:\n');
  console.log(JSON.stringify(allResults, null, 2));

  return allResults;

})();
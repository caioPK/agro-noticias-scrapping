/**
 * Web Crawler - G1 Globo Busca de Notícias
 * Extrai: Título, Preview, Link e Data (derivada da URL)
 * 
 * Como usar:
 * 1. Abra a página: https://g1.globo.com/busca/?q=Agroneg%C3%B3cio&species=noticias
 * 2. Abra o DevTools (F12) → aba Console
 * 3. Cole este script e pressione Enter
 * 4. Aguarde a execução. Os resultados serão exibidos no console e baixados como JSON.
 */

(async function G1Crawler() {
  const DELAY_BETWEEN_CLICKS = 2500; // ms entre cliques no "Veja mais"
  const DELAY_AFTER_CLICK = 3000; // ms aguardando novo conteúdo carregar
  const MAX_CLICKS = 500;   // limite de segurança para evitar loop infinito

  // ─── Utilitários ────────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Aguarda até o número de cards crescer ou o timeout esgotar */
  async function waitForNewCards(previousCount, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const current = document.querySelectorAll("li.widget--card.widget--info").length;
      if (current > previousCount) return current;
      await sleep(300);
    }
    return document.querySelectorAll("li.widget--card.widget--info").length;
  }

  // ─── Extração de um card individual ─────────────────────────────────────────

  function extractCard(card) {
    const titleEl = card.querySelector(".widget--info__title");
    const descEl = card.querySelector(".widget--info__description");
    const linkEl = card.querySelector(".widget--info__text-container > a");

    const title = titleEl ? titleEl.textContent.trim() : "[TÍTULO NÃO ENCONTRADO]";
    const preview = descEl ? descEl.textContent.trim() : "[PREVIEW NÃO ENCONTRADO]";
    const link = linkEl ? linkEl.href : "[LINK NÃO ENCONTRADO]";

    // Data derivada da URL  ex: /2026/05/09/ → "09/05/2026"
    let date = "[DATA NÃO ENCONTRADA]";
    if (link !== "[LINK NÃO ENCONTRADO]") {
      const match = link.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (match) date = `${match[3]}/${match[2]}/${match[1]}`;
    }

    return { title, preview, link, date };
  }

  // ─── Extração de todos os cards presentes no DOM ─────────────────────────────

  function extractAllCards() {
    return Array.from(document.querySelectorAll("li.widget--card.widget--info"))
      .map(extractCard);
  }

  // ─── Lógica principal: clica em "Veja mais" até não existir mais ─────────────

  console.log("🔍 G1 Crawler iniciado...\n");

  let clickCount = 0;

  while (clickCount < MAX_CLICKS) {
    const btn = document.querySelector("button.pagination__load-more");

    if (!btn) {
      console.log("✅ Botão 'Veja mais' não encontrado — todos os resultados foram carregados.");
      break;
    }

    const previousCount = document.querySelectorAll("li.widget--card.widget--info").length;
    console.log(`📄 Cards carregados até agora: ${previousCount} | Clicando em "Veja mais" (${clickCount + 1})...`);

    btn.click();
    clickCount++;

    // Aguarda novos cards aparecerem
    const newCount = await waitForNewCards(previousCount, DELAY_AFTER_CLICK);
    console.log(`   ➜ Cards após clique: ${newCount}`);

    // Pequena pausa antes do próximo clique
    await sleep(DELAY_BETWEEN_CLICKS);
  }

  if (clickCount >= MAX_CLICKS) {
    console.warn(`⚠️ Limite de ${MAX_CLICKS} cliques atingido. Encerrando paginação.`);
  }

  // ─── Extração final ──────────────────────────────────────────────────────────

  const results = extractAllCards();

  console.log(`\n✅ Extração concluída! Total de matérias: ${results.length}\n`);

  // Resumo no console
  results.forEach((item, i) => {
    console.group(`📰 [${i + 1}] ${item.title}`);
    console.log("📅 Data   :", item.date);
    console.log("🔗 Link   :", item.link);
    console.log("📝 Preview:", item.preview.substring(0, 150) + "...");
    console.groupEnd();
  });

  // ─── Exportar como JSON e baixar ─────────────────────────────────────────────

  const json = JSON.stringify(results, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "g1_agronegocio_noticias.json";
  anchor.click();
  URL.revokeObjectURL(url);

  console.log('\n💾 Arquivo "g1_agronegocio_noticias.json" baixado com sucesso!');

  // Retorna o array para inspeção direta no console
  return results;

})();
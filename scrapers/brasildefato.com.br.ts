// extrair-bdf.js
// Uso: node extrair-bdf.js
// Requer: npm i puppeteer

import { Page } from 'puppeteer';

export const name = 'Brasildefato.com.br Scraper';
export const description = 'Extrai o conteúdo principal de Brasildefato.com.br';

export default async function exampleScraper(page: Page): Promise<any> {



  try {

    // 1) Bloqueia imagens (e opcionalmente mídia/fontes) e impede navegação
    //    para qualquer outro documento que não seja a URL alvo.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const tipo = req.resourceType();
      const url = req.url();

      // Não carrega imagens, mídia nem fontes.
      if (['image', 'media', 'font'].includes(tipo)) {
        return req.abort();
      }

      // Só permite o documento principal da URL alvo; bloqueia qualquer
      // tentativa de navegar para outros links/páginas.
      // if (tipo === 'document' && url !== URL_ALVO) {
      //   return req.abort();
      // }

      req.continue();
    });

    // Evita que cliques ou scripts abram novas abas/janelas.
    page.on('popup', async (popup: any) => {
      try { await popup.close(); } catch (_) { }
    });


    // 2) Espera o widget que contém o corpo da matéria.
    await page.waitForSelector(
      '.elementor-widget-theme-post-content .elementor-widget-container',
      { timeout: 30000 }
    );

    // 3) Extrai apenas o texto dos parágrafos da matéria, sem data,
    //    autor, editoria, local, legendas, publicidade ou "editado por".
    const textoMateria = await page.evaluate(() => {
      const container = document.querySelector(
        '.elementor-widget-theme-post-content .elementor-widget-container'
      );
      if (!container) return '';

      // Clona para poder remover elementos sem afetar a página.
      const clone: any = container.cloneNode(true);

      // Remove inserts/anúncios/relacionados injetados entre parágrafos
      // e outros elementos que não pertencem ao texto da matéria.
      const seletoresRemover = [
        '[class*="bdf-entity-placement"]',
        '[class*="bdf-apos-paragrafo"]',
        '[class*="bdf-fim-do-conteudo"]',
        '[class*="publicidade"]',
        '[class*="ads"]',
        '[class*="ad-"]',
        'script',
        'style',
        'iframe',
        'figure',
        'figcaption',
        'aside',
        '.wp-caption',
        '.wp-caption-text',
        '.editado-por',
        '[class*="editado"]',
        '[class*="compartilh"]',
        '[class*="newsletter"]',
      ];
      clone
        .querySelectorAll(seletoresRemover.join(','))
        .forEach((el: any) => el.remove());

      // Pega apenas os parágrafos remanescentes (texto da matéria).
      const paragrafos = Array.from(clone.querySelectorAll('p'))
        .map((p: any) => p.innerText.replace(/\s+/g, ' ').trim())
        .filter((t: any) => t.length > 0);

      return paragrafos.join('\n\n');
    });

    console.log(textoMateria);
    return textoMateria;
  } catch (err) {
    console.error('Erro ao extrair a matéria:', err);
    process.exitCode = 1;
  }

  // // Aguarda um seletor específico da página
  // await page.waitForSelector('h1', { timeout: 10000 });

  // // Extrai dados usando page.evaluate()
  // const data = await page.evaluate(() => {
  //   const title = document.querySelector('h1')?.textContent?.trim() || '';
  //   const paragraphs = Array.from(document.querySelectorAll('p'))
  //     .map(p => p.textContent?.trim())
  //     .filter(Boolean)
  //     .join('\n');

  //   return `Título: ${title}\n\nConteúdo:\n${paragraphs}`;
  // });

  // return data;
}


// const URL_ALVO =
//   'https://www.brasildefato.com.br/2022/06/25/o-agronegocio-nao-tem-futuro/';

// (async () => {
//   const browser = await puppeteer.launch({
//     headless: 'new',
//     args: ['--no-sandbox', '--disable-setuid-sandbox'],
//   });
// })();
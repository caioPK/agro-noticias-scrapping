import { Page } from 'puppeteer';

/**
 * Scraper de notícias do G1 (globo.com)
 *
 * Estratégia geral:
 *  - Usa seletores estáveis do CMS do G1 (.content-head__title, .mc-article-body, .content-text__container etc.)
 *  - Possui múltiplos fallbacks para cada campo (DOM → JSON-LD → meta tags → URL)
 *  - Ignora propaganda, comentários, newsletter, leia-mais e blocos de mídia
 *  - Faz uma segunda passagem para garantir que tudo foi capturado e nada foi duplicado
 *  - Quando uma informação não existe, retorna explicitamente "[NÃO ENCONTRADO]"
 */
export default async function g1Scraper(page: Page): Promise<string> {
  // 1) Espera o título da matéria — seletor mais comum no G1
  await page.waitForSelector('h1.content-head__title, h1', { timeout: 15000 });

  // 2) Espera o corpo da matéria carregar (o conteúdo é renderizado em SSR, mas o wall pode demorar)
  await page
    .waitForSelector('.mc-article-body article, .mc-article-body', { timeout: 15000 })
    .catch(() => { /* segue mesmo sem o container — usaremos fallbacks */ });

  // 3) Pequena espera para hidratação de scripts e lazy-load de blocos no fim do artigo
  await new Promise((r) => setTimeout(r, 1500));

  // 4) Faz scroll para o fim para forçar lazy-load de tags/entities semânticas
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      const step = 800;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        y += step;
        if (y >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150);
    });
  });

  // 5) Aguarda possíveis tags semânticas serem injetadas
  await new Promise((r) => setTimeout(r, 1500));

  // 6) Extração no contexto da página
  const data = await page.evaluate(() => {
    const NOT_FOUND = '[NÃO ENCONTRADO]';
    const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

    // ---------- TÍTULO ----------
    const title =
      clean(document.querySelector('h1.content-head__title')?.textContent) ||
      clean(document.querySelector('article h1')?.textContent) ||
      clean(document.querySelector('h1')?.textContent) ||
      clean(document.querySelector('meta[property="og:title"]')?.getAttribute('content')) ||
      NOT_FOUND;

    // ---------- SUBTÍTULO (linha-fina) ----------
    const subtitle =
      clean(document.querySelector('.content-head__subtitle')?.textContent) ||
      clean(document.querySelector('h2.content-head__subtitle')?.textContent) ||
      '';

    // ---------- ANO DE PUBLICAÇÃO ----------
    // Fontes em ordem de prioridade:
    //  1) Segmento de 4 dígitos na URL (ex: /noticia/2024/11/25/...)
    //  2) Texto da classe .content-publication-data__updated (ex: "25/11/2024")
    //  3) Atributo datetime de <time> dentro de .content-publication-data__updated
    //  4) Meta tag article:published_time
    //  5) JSON-LD datePublished
    let publicationYear: string = NOT_FOUND;

    // 1) URL — procura o primeiro segmento que seja um ano válido (4 dígitos, >= 2000)
    const urlYearMatch = location.pathname.match(/\/(\d{4})\//);
    if (urlYearMatch && parseInt(urlYearMatch[1], 10) >= 2000) {
      publicationYear = urlYearMatch[1];
    }

    // 2) Classe .content-publication-data__updated — tenta extrair o ano do texto
    if (publicationYear === NOT_FOUND) {
      const pubDataEl = document.querySelector('.content-publication-data__updated');
      if (pubDataEl) {
        // Tenta primeiro o atributo datetime de um <time> filho
        const timeEl = pubDataEl.querySelector('time');
        const datetime = timeEl?.getAttribute('datetime') || timeEl?.getAttribute('content') || '';
        const datetimeYearMatch = datetime.match(/(\d{4})/);
        if (datetimeYearMatch) {
          publicationYear = datetimeYearMatch[1];
        } else {
          // Fallback: extrai ano do texto visível (formatos: dd/mm/aaaa, aaaa-mm-dd, "25 nov. 2024" etc.)
          const pubText = clean(pubDataEl.textContent);
          const textYearMatch = pubText.match(/\b(20\d{2})\b/);
          if (textYearMatch) publicationYear = textYearMatch[1];
        }
      }
    }

    // 3) Meta tag article:published_time
    if (publicationYear === NOT_FOUND) {
      const metaPublished = document.querySelector(
        'meta[property="article:published_time"]'
      )?.getAttribute('content');
      if (metaPublished) {
        const metaYearMatch = metaPublished.match(/^(\d{4})/);
        if (metaYearMatch) publicationYear = metaYearMatch[1];
      }
    }

    // 4) JSON-LD datePublished
    if (publicationYear === NOT_FOUND) {
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        if (publicationYear !== NOT_FOUND) return;
        try {
          const parsed = JSON.parse(s.textContent || '');
          const list = Array.isArray(parsed) ? parsed : [parsed];
          list.forEach((obj) => {
            if (publicationYear !== NOT_FOUND) return;
            const dateStr: string | undefined = obj?.datePublished || obj?.dateCreated;
            if (dateStr) {
              const jsonYearMatch = String(dateStr).match(/^(\d{4})/);
              if (jsonYearMatch) publicationYear = jsonYearMatch[1];
            }
          });
        } catch { /* ignora json malformado */ }
      });
    }

    // ---------- EDITORIA ----------
    // Fontes em ordem de prioridade:
    //  1) JSON-LD (articleSection)
    //  2) Link da editoria no header
    //  3) Meta tags
    //  4) Segmento da URL
    let editoria: string = NOT_FOUND;

    const jsonLdSections: string[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const parsed = JSON.parse(s.textContent || '');
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach((obj) => {
          if (obj && obj.articleSection) {
            const sec = Array.isArray(obj.articleSection) ? obj.articleSection : [obj.articleSection];
            sec.forEach((v: any) => v && jsonLdSections.push(String(v).trim()));
          }
        });
      } catch { /* ignora json malformado */ }
    });

    if (jsonLdSections.length) {
      const unique = [...new Set(jsonLdSections)];
      const specific = unique.filter((s) => s.toLowerCase() !== 'g1');
      editoria = (specific.length ? specific : unique).join(' / ');
    } else {
      const headerEditoria =
        clean(document.querySelector('.header-editoria--link')?.textContent) ||
        clean(document.querySelector('.header-product__title-link')?.textContent) ||
        clean(document.querySelector('meta[property="article:section"]')?.getAttribute('content')) ||
        clean(document.querySelector('meta[name="section"]')?.getAttribute('content'));

      if (headerEditoria) {
        editoria = headerEditoria;
      } else {
        const segs = location.pathname.split('/').filter(Boolean);
        const first = segs.find((s) => !['noticia', 'videos', 'foto'].includes(s) && !/^\d+$/.test(s) && !s.endsWith('.ghtml'));
        if (first) editoria = first.replace(/-/g, ' ');
      }
    }

    // ---------- TAGS ----------
    const tagSet = new Set<string>();

    document
      .querySelectorAll('.entities__list a, .entities__list-itemLink, .entities__list li')
      .forEach((el) => {
        const t = clean(el.textContent);
        if (t) tagSet.add(t);
      });

    document.querySelectorAll('meta[property="article:tag"]').forEach((m) => {
      const c = clean(m.getAttribute('content'));
      if (c) tagSet.add(c);
    });

    const keywords = clean(document.querySelector('meta[name="keywords"]')?.getAttribute('content'));
    if (keywords) {
      keywords.split(/[,;]/).map((k) => clean(k)).filter(Boolean).forEach((k) => tagSet.add(k));
    }

    const urlSegments = location.pathname.split('/').filter(Boolean).filter((s) => {
      if (s === 'noticia') return false;
      if (/^\d{4}$/.test(s) || /^\d{2}$/.test(s)) return false;
      if (s.endsWith('.ghtml')) return false;
      return true;
    });
    urlSegments.forEach((s) => tagSet.add(s.replace(/-/g, ' ')));

    const tags = [...tagSet];

    // ---------- CONTEÚDO COMPLETO DA NOTÍCIA ----------
    const SKIP_REGEX = /(\b|_)(ads|publicidade|banner|newsletter|comment|related|recomenda|leia[-_ ]?mais|globopop|signature|credito|caption|tagged-content|chamada|widgets?)\b/i;

    const isInsideSkipped = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        const cls = (cur.className && typeof cur.className === 'string') ? cur.className : '';
        if (SKIP_REGEX.test(cls)) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const articleRoot =
      document.querySelector('.mc-article-body article') ||
      document.querySelector('.mc-article-body') ||
      document.querySelector('article');

    const contentParts: string[] = [];
    const seen = new Set<string>();

    if (articleRoot) {
      const blocks = articleRoot.querySelectorAll(
        '.content-text__container, .content-intertitle, h2.content-subtitle, h2, h3, blockquote, ul, ol'
      );

      blocks.forEach((el) => {
        if (isInsideSkipped(el)) return;

        let text = '';
        if (el.tagName === 'UL' || el.tagName === 'OL') {
          const items = Array.from(el.querySelectorAll(':scope > li'))
            .map((li) => clean(li.textContent))
            .filter(Boolean);
          if (items.length) text = items.map((i) => `• ${i}`).join('\n');
        } else {
          text = clean(el.textContent);
        }

        if (!text) return;
        if (/^(VEJA TAMBÉM|LEIA MAIS|VEJA MAIS|ASSISTA|COMPARTILHE)/i.test(text)) return;
        if (text.length < 2) return;
        if (seen.has(text)) return;

        seen.add(text);
        contentParts.push(text);
      });
    }

    // ---------- SEGUNDA PASSAGEM (verificação) ----------
    if (articleRoot) {
      articleRoot.querySelectorAll('.content-text__container').forEach((p) => {
        if (isInsideSkipped(p)) return;
        const text = clean(p.textContent);
        if (text && !seen.has(text)) {
          seen.add(text);
          contentParts.push(text);
        }
      });
    }

    const fullContent = contentParts.length ? contentParts.join('\n\n') : NOT_FOUND;

    return {
      title,
      subtitle,
      editoria,
      publicationYear,
      tags,
      content: fullContent,
      contentBlocks: contentParts.length,
      url: location.href,
    };
  });

  // 7) Monta a saída em texto formatado
  const tagsStr = data.tags.length ? data.tags.join(', ') : '[NÃO ENCONTRADO]';
  const subtitleBlock = data.subtitle ? `Subtítulo: ${data.subtitle}\n` : '';

  const output =
    `Título: ${data.title}
${subtitleBlock}Editoria: ${data.editoria}
Ano de publicação: ${data.publicationYear}
Tags: ${tagsStr}
URL: ${data.url}

Notícia completa (${data.contentBlocks} blocos):
${data.content}`;

  return output;
}
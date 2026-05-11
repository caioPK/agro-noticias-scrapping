import { Page } from 'puppeteer';

/**
 * Scraper de notícias do Infobae (infobae.com)
 *
 * Estratégia geral:
 *  - Seletores estáveis do CMS do Infobae (.body-article, p.paragraph, h2.article-subheadline, etc.)
 *  - Múltiplos fallbacks por campo: JSON-LD (NewsArticle) → meta tags → DOM → URL
 *  - Ignora propagandas, "Te puede interesar", módulos de recomendação, imagens e redes sociais
 *  - Faz scroll completo para forçar lazy-load de tags semânticas
 *  - Segunda passagem para garantir que nenhum parágrafo foi perdido
 *  - Campos ausentes retornam explicitamente "[NÃO ENCONTRADO]"
 */
export default async function infobaeScraper(page: Page): Promise<string> {
  // 1) Aguarda o título — seletor principal do Infobae
  await page.waitForSelector('h1.article-headline, h1', { timeout: 15000 });

  // 2) Aguarda o corpo do artigo
  await page
    .waitForSelector('.body-article', { timeout: 15000 })
    .catch(() => { /* segue com fallback */ });

  // 3) Scroll completo para disparar lazy-load de tags e blocos finais
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let y = 0;
      const step = 900;
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

  // 4) Aguarda possível injeção assíncrona de tags/blocos
  await new Promise((r) => setTimeout(r, 1500));

  // 5) Extração no contexto da página
  const data = await page.evaluate(() => {
    const NOT_FOUND = '[NÃO ENCONTRADO]';
    const clean = (s: string | null | undefined) =>
      (s || '').replace(/\s+/g, ' ').trim();

    // ── TÍTULO ─────────────────────────────────────────────────────────────
    const title =
      clean(document.querySelector('h1.article-headline')?.textContent) ||
      clean(document.querySelector('article h1')?.textContent) ||
      clean(document.querySelector('h1')?.textContent) ||
      clean(document.querySelector('meta[property="og:title"]')?.getAttribute('content')) ||
      NOT_FOUND;

    // ── SUBTÍTULO (deck/bajada) ─────────────────────────────────────────────
    const subtitle =
      clean(document.querySelector('h2.article-subheadline')?.textContent) ||
      clean(document.querySelector('[class*="subheadline"]')?.textContent) ||
      clean(document.querySelector('meta[name="description"]')?.getAttribute('content')) ||
      '';

    // ── JSON-LD: NewsArticle ────────────────────────────────────────────────
    let ldArticle: Record<string, any> | null = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const parsed = JSON.parse(s.textContent || '');
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach((obj) => {
          if (obj && ['NewsArticle', 'Article', 'WebPage'].includes(obj['@type'])) {
            ldArticle = obj;
          }
        });
      } catch { /* json malformado, ignora */ }
    });

    // ── EDITORIA ────────────────────────────────────────────────────────────
    // Prioridade: JSON-LD articleSection → meta article:section → URL
    let editoria: string = NOT_FOUND;

    const ldSection = ldArticle?.articleSection;
    if (ldSection) {
      editoria = Array.isArray(ldSection) ? ldSection.join(' / ') : String(ldSection);
    } else {
      const metaSection =
        clean(document.querySelector('meta[name="article:section"]')?.getAttribute('content')) ||
        clean(document.querySelector('meta[property="article:section"]')?.getAttribute('content'));
      if (metaSection) {
        editoria = metaSection;
      } else {
        // Fallback: primeiro segmento útil da URL
        const segs = location.pathname.split('/').filter((s) => {
          if (!s) return false;
          if (/^\d{4}$/.test(s) || /^\d{2}$/.test(s)) return false; // ano/mês/dia
          if (s.endsWith('.html')) return false;
          return true;
        });
        if (segs[0]) editoria = segs[0].replace(/-/g, ' ');
      }
    }

    // ── TAGS ────────────────────────────────────────────────────────────────
    // Prioridade: .article-tags links → meta[article:tag] → meta[name=keywords] → JSON-LD keywords
    const tagSet = new Set<string>();

    // Tags no DOM (`.article-tags` é o container de "Temas Relacionados")
    document.querySelectorAll('.article-tags a').forEach((a) => {
      const t = clean(a.textContent);
      if (t && t.length < 80) tagSet.add(t);
    });

    // meta[article:tag] (múltiplas)
    document.querySelectorAll('meta[property="article:tag"], meta[name="article:tag"]').forEach((m) => {
      const c = clean(m.getAttribute('content'));
      if (c) tagSet.add(c);
    });

    // meta[keywords] / news_keywords
    const kwMeta =
      clean(document.querySelector('meta[name="keywords"]')?.getAttribute('content')) ||
      clean(document.querySelector('meta[name="news_keywords"]')?.getAttribute('content'));
    if (kwMeta) {
      kwMeta.split(',').map((k) => clean(k)).filter(Boolean).forEach((k) => tagSet.add(k));
    }

    // JSON-LD keywords (fallback)
    if (ldArticle?.keywords && !tagSet.size) {
      String(ldArticle.keywords).split(',').map((k: string) => clean(k)).filter(Boolean).forEach((k: string) => tagSet.add(k));
    }

    const tags = [...tagSet];

    // ── CONTEÚDO COMPLETO ───────────────────────────────────────────────────
    // Estrutura do Infobae dentro de .body-article:
    //  - p.paragraph                     → parágrafos de texto
    //  - H2/H3 com classe "headline"     → intertítulos editoriais
    //  - BLOCKQUOTE                       → citações (excluindo "Te puede interesar")
    //  - UL / OL                          → listas
    //
    // Excluímos: propagandas (.ad-wrapper, dfpAd), módulos de recomendação
    // (.news-module), blocos de imagem (.visual__), botões de share
    // (.second-saved-buttons), container de tags (.article-tags-container).

    const SKIP_REGEX = /ad-wrapper|dfpAd|publicidad|news-module|visual__|second-saved|article-tags|sponsored|recomend/i;

    const isInsideSkipped = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        const cls = typeof cur.className === 'string' ? cur.className : '';
        if (SKIP_REGEX.test(cls)) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    // Verifica se blockquote é "Te puede interesar" (link de recomendação)
    const isRecommendedLink = (el: Element): boolean =>
      /te (puede|interesa)/i.test(el.textContent || '');

    const bodyArticle =
      document.querySelector('.body-article') ||
      document.querySelector('article') ||
      document.querySelector('[class*="article-body"]');

    const contentParts: string[] = [];
    const seen = new Set<string>();

    const addIfNew = (text: string) => {
      if (!text) return;
      if (text.length < 3) return;
      if (seen.has(text)) return;
      seen.add(text);
      contentParts.push(text);
    };

    if (bodyArticle) {
      Array.from(bodyArticle.children).forEach((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';

        // Pular blocos de ruído
        if (SKIP_REGEX.test(cls)) return;

        const tag = el.tagName;
        let text = '';

        if (tag === 'P' && el.classList.contains('paragraph')) {
          // Parágrafo principal
          text = clean(el.textContent);

        } else if ((tag === 'H2' || tag === 'H3') && cls.includes('headline')) {
          // Intertítulo — mantém hierarquia com marcador
          const raw = clean(el.textContent);
          if (raw) text = `[${tag}] ${raw}`;

        } else if (tag === 'BLOCKQUOTE') {
          // Citações reais (não "Te puede interesar")
          if (!isInsideSkipped(el) && !isRecommendedLink(el)) {
            const raw = clean(el.textContent);
            if (raw) text = `"${raw}"`;
          }

        } else if (tag === 'UL' || tag === 'OL') {
          // Listas
          const items = Array.from(el.querySelectorAll(':scope > li'))
            .map((li) => clean(li.textContent))
            .filter(Boolean);
          if (items.length) text = items.map((i) => `• ${i}`).join('\n');

        } else {
          // Para divs genéricas sem classe de ruído: tentar extrair parágrafos internos
          // (cobre variações do CMS em diferentes editorias)
          const innerParas = el.querySelectorAll('p.paragraph');
          if (innerParas.length) {
            innerParas.forEach((p) => {
              if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
            });
          }
        }

        addIfNew(text);
      });
    }

    // ── SEGUNDA PASSAGEM ────────────────────────────────────────────────────
    // Varredura extra para capturar parágrafos que possam estar em divs aninhadas
    if (bodyArticle) {
      bodyArticle.querySelectorAll('p.paragraph').forEach((p) => {
        if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
      });
    }

    const fullContent = contentParts.length ? contentParts.join('\n\n') : NOT_FOUND;

    return {
      title,
      subtitle,
      editoria,
      tags,
      content: fullContent,
      contentBlocks: contentParts.length,
      url: location.href,
    };
  });

  // 6) Monta a saída em texto formatado
  const tagsStr = data.tags.length ? data.tags.join(', ') : '[NÃO ENCONTRADO]';
  const subBlock = data.subtitle ? `Subtítulo: ${data.subtitle}\n` : '';

  const output =
    `Título: ${data.title}
    ${subBlock}Editoria: ${data.editoria}
    Tags: ${tagsStr}
    URL: ${data.url}

    Notícia completa (${data.contentBlocks} blocos):
    ${data.content}`;

  return output;
}
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

    // ── ANO DA PUBLICAÇÃO ───────────────────────────────────────────────────
    // Prioridade: .sharebar-article-date → URL → JSON-LD datePublished → meta[article:published_time]
    let publicationYear: string = NOT_FOUND;

    // 1. Tenta extrair do elemento .sharebar-article-date
    const dateEl = document.querySelector('.sharebar-article-date');
    if (dateEl) {
      // Procura um padrão de 4 dígitos que represente um ano (ex: "2024")
      const yearMatch = (dateEl.getAttribute('datetime') || dateEl.textContent || '').match(/\b(19|20)\d{2}\b/);
      if (yearMatch) publicationYear = yearMatch[0];
    }

    // 2. Fallback: extrai da URL (ex: /2024/08/09/...)
    if (publicationYear === NOT_FOUND) {
      const urlYearMatch = location.pathname.match(/\/(19|20)\d{2}\//);
      if (urlYearMatch) publicationYear = urlYearMatch[0].replace(/\//g, '');
    }

    // 3. Fallback: JSON-LD datePublished
    // @ts-ignore-next-line
    if (publicationYear === NOT_FOUND && ldArticle?.datePublished) {
    // @ts-ignore-next-line
      const ldYearMatch = String(ldArticle.datePublished).match(/\b(19|20)\d{2}\b/);
      if (ldYearMatch) publicationYear = ldYearMatch[0];
    }

    // 4. Fallback: meta tag article:published_time
    if (publicationYear === NOT_FOUND) {
      const metaDate =
        document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
        document.querySelector('meta[name="article:published_time"]')?.getAttribute('content') || '';
      const metaYearMatch = metaDate.match(/\b(19|20)\d{2}\b/);
      if (metaYearMatch) publicationYear = metaYearMatch[0];
    }

    // ── EDITORIA ────────────────────────────────────────────────────────────
    // Prioridade: JSON-LD articleSection → meta article:section → URL
    let editoria: string = NOT_FOUND;
    // @ts-ignore-next-line
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
    const tagSet = new Set<string>();

    document.querySelectorAll('.article-tags a').forEach((a) => {
      const t = clean(a.textContent);
      if (t && t.length < 80) tagSet.add(t);
    });

    document.querySelectorAll('meta[property="article:tag"], meta[name="article:tag"]').forEach((m) => {
      const c = clean(m.getAttribute('content'));
      if (c) tagSet.add(c);
    });

    const kwMeta =
      clean(document.querySelector('meta[name="keywords"]')?.getAttribute('content')) ||
      clean(document.querySelector('meta[name="news_keywords"]')?.getAttribute('content'));
    if (kwMeta) {
      kwMeta.split(',').map((k) => clean(k)).filter(Boolean).forEach((k) => tagSet.add(k));
    }
    // @ts-ignore-next-line
    if (ldArticle?.keywords && !tagSet.size) {
      // @ts-ignore-next-line
      String(ldArticle.keywords).split(',').map((k: string) => clean(k)).filter(Boolean).forEach((k: string) => tagSet.add(k));
    }

    const tags = [...tagSet];

    // ── CONTEÚDO COMPLETO ───────────────────────────────────────────────────
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
        if (SKIP_REGEX.test(cls)) return;

        const tag = el.tagName;
        let text = '';

        if (tag === 'P' && el.classList.contains('paragraph')) {
          text = clean(el.textContent);
        } else if ((tag === 'H2' || tag === 'H3') && cls.includes('headline')) {
          const raw = clean(el.textContent);
          if (raw) text = `[${tag}] ${raw}`;
        } else if (tag === 'BLOCKQUOTE') {
          if (!isInsideSkipped(el) && !isRecommendedLink(el)) {
            const raw = clean(el.textContent);
            if (raw) text = `"${raw}"`;
          }
        } else if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(el.querySelectorAll(':scope > li'))
            .map((li) => clean(li.textContent))
            .filter(Boolean);
          if (items.length) text = items.map((i) => `• ${i}`).join('\n');
        } else {
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
    if (bodyArticle) {
      bodyArticle.querySelectorAll('p.paragraph').forEach((p) => {
        if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
      });
    }

    const fullContent = contentParts.length ? contentParts.join('\n\n') : NOT_FOUND;

    return {
      title,
      subtitle,
      publicationYear, // ── ANO: novo campo retornado
      editoria,
      tags,
      content: fullContent,
      contentBlocks: contentParts.length,
      url: location.href,
    };
  });

  // 6) Monta a saída em texto formatado
  const tagsStr = data.tags.length ? data.tags.join(', ') : '[NÃO ENCONTRADO]';
  const subBlock = data.subtitle ? `${data.subtitle}\n` : '\n';

  const output =
    `**** pais_ag jornal_infobae *ano_${data.publicationYear}\n\n
    
    ${data.title}\n
    ${subBlock}
    \n
    ${data.content}`;

  return output;
}
import { Page } from 'puppeteer';

/**
 * Scraper de notícias do Página|12 (pagina12.com.ar)
 *
 * Estrutura do CMS do P12:
 *  - .b-single-chain__children-stack  → cabeçalho: h1 título, h2 chapeau, h3 bajada, breadcrumb editoria
 *  - article.p12-article-body         → corpo: p.c-paragraph, h2.p12-article-body__h2, blockquote, ul/ol
 *  - .p12ArticleTags                  → "Temas en esta nota" (tags)
 *  - meta[name="p12:section"]         → editoria em slug (fallback)
 *  - meta[name="p12:tag"]             → tags em slug (fallback)
 *  - JSON-LD NewsArticle              → metadados estruturados
 *
 * Pontos de atenção:
 *  - Ignora .ad-slot (propaganda) e .p12TalkComments (comentários)
 *  - Tags deduplica entre DOM (capitalizado) e meta (slug)
 *  - Editoria vem do breadcrumb; fallback via meta[name="p12:section"]
 *  - Campos ausentes retornam "[NÃO ENCONTRADO]"
 */
export default async function pagina12Scraper(page: Page): Promise<string> {
  // 1) Aguarda o título — classe principal do P12
  await page.waitForSelector('h1.p12Header, h1', { timeout: 15000 });

  // 2) Aguarda o corpo do artigo
  await page
    .waitForSelector('article.p12-article-body', { timeout: 15000 })
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

  // 4) Aguarda possível injeção assíncrona de tags
  await new Promise((r) => setTimeout(r, 1500));

  // 5) Extração no contexto da página
  const data = await page.evaluate(() => {
    const NOT_FOUND = '[NÃO ENCONTRADO]';
    const clean = (s: string | null | undefined) =>
      (s || '').replace(/\s+/g, ' ').trim();

    // ── JSON-LD: NewsArticle ────────────────────────────────────────────────
    let ldArticle: Record<string, any> | null = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const parsed = JSON.parse(s.textContent || '');
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach((obj) => {
          if (obj && ['NewsArticle', 'Article'].includes(obj['@type'])) {
            ldArticle = obj;
          }
        });
      } catch { /* json malformado, ignora */ }
    });

    // ── ANO DE PUBLICAÇÃO ───────────────────────────────────────────────────
    // Prioridade: JSON-LD datePublished → meta article:published_time →
    //             meta og:article:published_time → meta[name="date"] →
    //             URL (padrão /YYYY-MM-DD- ou /YYYYMMDD)
    // ── ANO DE PUBLICAÇÃO ───────────────────────────────────────────────────
    // Prioridade: JSON-LD datePublished → meta article:published_time →
    //             meta og:article:published_time → meta[name="date"] →
    //             .p12Date time[datetime] → .p12Date textContent → URL
    let publishYear: string = NOT_FOUND;

    // 1) JSON-LD: campo datePublished ou dateCreated
    // @ts-ignore-next-line
    const ldDate = clean(ldArticle?.datePublished || ldArticle?.dateCreated);
    if (ldDate) {
      const m = ldDate.match(/(\d{4})/);
      if (m) publishYear = m[1];
    }

    // 2) meta article:published_time (Open Graph / Facebook)
    if (publishYear === NOT_FOUND) {
      const metaPubTime = clean(
        document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
        document.querySelector('meta[name="article:published_time"]')?.getAttribute('content')
      );
      if (metaPubTime) {
        const m = metaPubTime.match(/(\d{4})/);
        if (m) publishYear = m[1];
      }
    }

    // 3) meta og:article:published_time
    if (publishYear === NOT_FOUND) {
      const metaOgPub = clean(
        document.querySelector('meta[property="og:article:published_time"]')?.getAttribute('content')
      );
      if (metaOgPub) {
        const m = metaOgPub.match(/(\d{4})/);
        if (m) publishYear = m[1];
      }
    }

    // 4) meta[name="date"] / meta[name="pubdate"] / meta[name="DC.date"]
    if (publishYear === NOT_FOUND) {
      const metaDate = clean(
        document.querySelector('meta[name="date"]')?.getAttribute('content') ||
        document.querySelector('meta[name="pubdate"]')?.getAttribute('content') ||
        document.querySelector('meta[name="DC.date"]')?.getAttribute('content')
      );
      if (metaDate) {
        const m = metaDate.match(/(\d{4})/);
        if (m) publishYear = m[1];
      }
    }

    // 5) .p12Date — elemento nativo do P12
    //    Prefere time[datetime] (ISO 8601, ex: "2024-12-30T03:44:31Z")
    //    e cai no textContent como segurança (ex: "30 de diciembre de 2024 - 0:44")
    if (publishYear === NOT_FOUND) {
      const p12DateEl = document.querySelector('.p12Date time');
      const p12Datetime = clean(p12DateEl?.getAttribute('datetime'));
      const p12Text = clean(p12DateEl?.textContent || document.querySelector('.p12Date')?.textContent);
      const raw = p12Datetime || p12Text;
      if (raw) {
        const m = raw.match(/(\d{4})/);
        if (m) publishYear = m[1];
      }
    }

    // 6) Fallback: extrai o ano diretamente da URL (padrão /YYYY-/)
    if (publishYear === NOT_FOUND) {
      const urlMatch = location.href.match(/\/(\d{4})[-\/]/);
      if (urlMatch) publishYear = urlMatch[1];
    }
    // ── TÍTULO ─────────────────────────────────────────────────────────────
    const title =
      clean(document.querySelector('.b-single-chain__children-stack h1.p12Header')?.textContent) ||
      clean(document.querySelector('h1.p12Header')?.textContent) ||
      clean(document.querySelector('h1')?.textContent) ||
      clean(document.querySelector('meta[property="og:title"]')?.getAttribute('content')) ||
      NOT_FOUND;

    // ── CHAPEAU (h2 = título da nota anterior na chain — contexto editorial)
    const chapeau =
      clean(document.querySelector('.b-single-chain__children-stack h2.p12Header')?.textContent) || '';

    // ── BAJADA / SUBTÍTULO (h3 = supertítulo/volanta/bajada) ───────────────
    const bajada =
      clean(document.querySelector('.b-single-chain__children-stack h3.p12Header')?.textContent) || '';

    // ── EDITORIA ────────────────────────────────────────────────────────────
    let editoria: string = NOT_FOUND;

    const breadcrumbLinks = Array.from(
      document.querySelectorAll('.p12Breadcrumb a')
    );
    const editoriaFromBreadcrumb = breadcrumbLinks
      .filter((a) => {
        const href = (a as HTMLAnchorElement).href;
        return !href.match(/pagina12\.com\.ar\/?$/);
      })
      .map((a) => clean(a.textContent))
      .filter(Boolean)
      .pop();

    if (editoriaFromBreadcrumb) {
      editoria = editoriaFromBreadcrumb;
    } else {
      const metaP12Section = clean(
        document.querySelector('meta[name="p12:section"]')?.getAttribute('content')
      );
      if (metaP12Section) {
        editoria = metaP12Section;
      } else {
        const metaSection = clean(
          document.querySelector('meta[property="article:section"]')?.getAttribute('content') ||
          document.querySelector('meta[name="article:section"]')?.getAttribute('content')
        );
        if (metaSection) editoria = metaSection;
      }
    }

    // ── TAGS ────────────────────────────────────────────────────────────────
    const tagMap = new Map<string, string>();

    document.querySelectorAll('.p12ArticleTags a').forEach((a) => {
      const t = clean(a.textContent);
      if (t && t.length < 80) tagMap.set(t.toLowerCase(), t);
    });

    const p12Tags = clean(
      document.querySelector('meta[name="p12:tag"]')?.getAttribute('content')
    );
    if (p12Tags) {
      p12Tags.split(',').map((k) => clean(k)).filter(Boolean).forEach((k) => {
        if (!tagMap.has(k.toLowerCase())) tagMap.set(k.toLowerCase(), k);
      });
    }

    const kwMeta = clean(
      document.querySelector('meta[name="keywords"]')?.getAttribute('content')
    );
    if (kwMeta) {
      kwMeta.split(',').map((k) => clean(k)).filter(Boolean).forEach((k) => {
        if (!tagMap.has(k.toLowerCase())) tagMap.set(k.toLowerCase(), k);
      });
    }

    const tags = [...tagMap.values()];

    // ── CONTEÚDO COMPLETO ───────────────────────────────────────────────────
    // Estrutura de article.p12-article-body:
    //  - p.c-paragraph              → parágrafos de texto
    //  - h2.p12-article-body__h2   → intertítulos editoriais
    //  - blockquote                 → citações (quando existirem)
    //  - ul / ol                    → listas (quando existirem)
    //  - div.ad-slot                → propagandas → IGNORAR
    //
    // Excluídos: .ad-slot, .p12TalkComments, .p12ArticleTags, .p12-banner

    const SKIP_REGEX = /ad-slot|p12TalkComments|p12ArticleTags|p12-banner|p12-lead-art/i;

    const isInsideSkipped = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur && cur !== document.body) {
        const cls = typeof cur.className === 'string' ? cur.className : '';
        if (SKIP_REGEX.test(cls)) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const articleRoot =
      document.querySelector('article.p12-article-body') ||
      document.querySelector('article') ||
      document.querySelector('[class*="article-body"]');

    const contentParts: string[] = [];
    const seen = new Set<string>();

    const addIfNew = (text: string) => {
      if (!text || text.length < 3) return;
      if (seen.has(text)) return;
      seen.add(text);
      contentParts.push(text);
    };

    if (articleRoot) {
      Array.from(articleRoot.children).forEach((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';

        if (SKIP_REGEX.test(cls)) return;

        const tag = el.tagName;
        let text = '';

        if (tag === 'P' && el.classList.contains('c-paragraph')) {
          text = clean(el.textContent);

        } else if ((tag === 'H2' || tag === 'H3') && cls.includes('p12-article-body')) {
          const raw = clean(el.textContent);
          if (raw) text = `[${tag}] ${raw}`;

        } else if (tag === 'BLOCKQUOTE') {
          if (!isInsideSkipped(el)) {
            const raw = clean(el.textContent);
            if (raw) text = `"${raw}"`;
          }

        } else if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(el.querySelectorAll(':scope > li'))
            .map((li) => clean(li.textContent))
            .filter(Boolean);
          if (items.length) text = items.map((i) => `• ${i}`).join('\n');

        } else if (tag === 'DIV' && !SKIP_REGEX.test(cls)) {
          el.querySelectorAll('p.c-paragraph').forEach((p) => {
            if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
          });
        }

        addIfNew(text);
      });
    }

    // ── SEGUNDA PASSAGEM ────────────────────────────────────────────────────
    if (articleRoot) {
      articleRoot.querySelectorAll('p.c-paragraph').forEach((p) => {
        if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
      });
    }

    const fullContent = contentParts.length ? contentParts.join('\n\n') : NOT_FOUND;

    return {
      title,
      chapeau,
      bajada,
      editoria,
      tags,
      content: fullContent,
      contentBlocks: contentParts.length,
      url: location.href,
      publishYear, // ── ANO: adicionado ao retorno
    };
  });

  // 6) Monta a saída em texto formatado
  const tagsStr = data.tags.length ? data.tags.join(', ') : '[NÃO ENCONTRADO]';
  const chapeauLine = data.chapeau ? `${data.chapeau}\n` : '';
  const bajadaLine = data.bajada ? `${data.bajada}\n` : '';

  const output =
    `**** pais_ag jornal_pagina12 *ano_${data.publishYear}
    
    ${data.title}
    ${chapeauLine}${bajadaLine}

    ${data.content}`;
  return output;
}
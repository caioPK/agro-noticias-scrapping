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

    // ── TÍTULO ─────────────────────────────────────────────────────────────
    // O P12 usa h1.p12Header dentro de .b-single-chain__children-stack
    const title =
      clean(document.querySelector('.b-single-chain__children-stack h1.p12Header')?.textContent) ||
      clean(document.querySelector('h1.p12Header')?.textContent) ||
      clean(document.querySelector('h1')?.textContent) ||
      clean(document.querySelector('meta[property="og:title"]')?.getAttribute('content')) ||
      NOT_FOUND;

    // ── CHAPEAU (h2 = título da nota anterior na chain — contexto editorial)
    // Nota: no P12, o h2 acima do h1 é o "chapeau" ou link de nota relacionada
    const chapeau =
      clean(document.querySelector('.b-single-chain__children-stack h2.p12Header')?.textContent) || '';

    // ── BAJADA / SUBTÍTULO (h3 = supertítulo/volanta/bajada) ───────────────
    const bajada =
      clean(document.querySelector('.b-single-chain__children-stack h3.p12Header')?.textContent) ||
      clean(ldArticle?.description) ||
      '';

    // ── EDITORIA ────────────────────────────────────────────────────────────
    // Prioridade: breadcrumb (.p12Breadcrumb) → meta[p12:section] → URL
    let editoria: string = NOT_FOUND;

    // Breadcrumb: links em ordem → pega o último que não seja "Portada"
    const breadcrumbLinks = Array.from(
      document.querySelectorAll('.p12Breadcrumb a')
    );
    const editoriaFromBreadcrumb = breadcrumbLinks
      .filter((a) => {
        const href = (a as HTMLAnchorElement).href;
        // Exclui a home (termina em .ar/ ou .ar)
        return !href.match(/pagina12\.com\.ar\/?$/);
      })
      .map((a) => clean(a.textContent))
      .filter(Boolean)
      .pop(); // último segmento = mais específico

    if (editoriaFromBreadcrumb) {
      editoria = editoriaFromBreadcrumb;
    } else {
      // Fallback 1: meta p12:section (slug)
      const metaP12Section = clean(
        document.querySelector('meta[name="p12:section"]')?.getAttribute('content')
      );
      if (metaP12Section) {
        editoria = metaP12Section;
      } else {
        // Fallback 2: meta article:section
        const metaSection = clean(
          document.querySelector('meta[property="article:section"]')?.getAttribute('content') ||
          document.querySelector('meta[name="article:section"]')?.getAttribute('content')
        );
        if (metaSection) editoria = metaSection;
      }
    }

    // ── TAGS ────────────────────────────────────────────────────────────────
    // Prioridade: .p12ArticleTags a (DOM, legível) → meta[p12:tag] → meta[keywords]
    // Deduplicação case-insensitive para evitar repetir "OTBN" e "otbn"
    const tagMap = new Map<string, string>(); // key=lowercase → value=versão preferida

    // 1) DOM: "Temas en esta nota" — forma capitalizada, preferida
    document.querySelectorAll('.p12ArticleTags a').forEach((a) => {
      const t = clean(a.textContent);
      if (t && t.length < 80) tagMap.set(t.toLowerCase(), t);
    });

    // 2) meta[name="p12:tag"] — slug separado por vírgulas
    const p12Tags = clean(
      document.querySelector('meta[name="p12:tag"]')?.getAttribute('content')
    );
    if (p12Tags) {
      p12Tags.split(',').map((k) => clean(k)).filter(Boolean).forEach((k) => {
        if (!tagMap.has(k.toLowerCase())) tagMap.set(k.toLowerCase(), k);
      });
    }

    // 3) meta[name="keywords"] — fallback adicional
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

        // Pular blocos de ruído
        if (SKIP_REGEX.test(cls)) return;

        const tag = el.tagName;
        let text = '';

        if (tag === 'P' && el.classList.contains('c-paragraph')) {
          // Parágrafo principal
          text = clean(el.textContent);

        } else if ((tag === 'H2' || tag === 'H3') && cls.includes('p12-article-body')) {
          // Intertítulo editorial
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
          // Divs genéricas sem classe de ruído: tenta extrair parágrafos internos
          // (cobre possíveis variações do CMS em diferentes seções)
          el.querySelectorAll('p.c-paragraph').forEach((p) => {
            if (!isInsideSkipped(p)) addIfNew(clean(p.textContent));
          });
        }

        addIfNew(text);
      });
    }

    // ── SEGUNDA PASSAGEM ────────────────────────────────────────────────────
    // Varredura extra: garante que nenhum parágrafo dentro de sub-divs foi perdido
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
    };
  });

  // 6) Monta a saída em texto formatado
  const tagsStr = data.tags.length ? data.tags.join(', ') : '[NÃO ENCONTRADO]';
  const chapeauLine = data.chapeau ? `Chapeau: ${data.chapeau}\n` : '';
  const bajadaLine = data.bajada ? `Subtítulo: ${data.bajada}\n` : '';

  const output =
    `Título: ${data.title}
${chapeauLine}${bajadaLine}Editoria: ${data.editoria}
Tags: ${tagsStr}
URL: ${data.url}

Notícia completa (${data.contentBlocks} blocos):
${data.content}`;

  return output;
}
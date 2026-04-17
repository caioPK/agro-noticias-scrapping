import { Page } from 'puppeteer';

/**
 * Exemplo de scraper para domínio específico: example.com
 *
 * Este arquivo demonstra como criar um scraper customizado.
 *
 * ─────────────────────────────────────────────────────────────
 * COMO CRIAR SEU PRÓPRIO SCRAPER:
 *
 * 1. Crie um arquivo com o nome do domínio: <dominio>.ts
 *    Exemplos: "google.com.ts", "wikipedia.org.ts", "blog.example.com.ts"
 *
 * 2. O arquivo DEVE exportar uma função `default` que:
 *    - Recebe um objeto `page` do Puppeteer (Page)
 *    - Retorna uma Promise<string> com o texto extraído
 *
 * 3. Dentro da função, use `page.evaluate()` para executar
 *    JavaScript no contexto da página e extrair dados.
 *
 * 4. O scraper é resolvido por ordem de especificidade:
 *    - "sub.example.com.ts" → mais específico
 *    - "example.com.ts"     → domínio principal
 *    - "_default.ts"        → fallback genérico
 * ─────────────────────────────────────────────────────────────
 */

export const name = 'Example.com Scraper';
export const description = 'Extrai o conteúdo principal de example.com';

export default async function exampleScraper(page: Page): Promise<string> {
  // Aguarda um seletor específico da página
  await page.waitForSelector('h1', { timeout: 10000 });

  // Extrai dados usando page.evaluate()
  const data = await page.evaluate(() => {
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map(p => p.textContent?.trim())
      .filter(Boolean)
      .join('\n');

    return `Título: ${title}\n\nConteúdo:\n${paragraphs}`;
  });

  return data;
}

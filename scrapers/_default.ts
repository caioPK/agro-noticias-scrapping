import { Page } from 'puppeteer';

/**
 * Scraper padrão (fallback).
 *
 * Usado quando nenhum scraper específico é encontrado para o domínio.
 * Extrai todo o texto visível da página (document.body.innerText).
 *
 * Para criar um scraper personalizado para um domínio específico,
 * crie um novo arquivo com o nome do domínio (ex: example.com.ts)
 * nesta mesma pasta.
 */

export const name = 'Scraper Padrão';
export const description = 'Extrai todo o texto visível da página';

export default async function defaultScraper(page: Page): Promise<string> {
  // Aguarda o body estar presente
  await page.waitForSelector('body', { timeout: 10000 });

  // Extrai todo o texto visível
  const text = await page.evaluate(() => {
    return document.body.innerText;
  });

  return text;
}

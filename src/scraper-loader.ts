import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { config } from './config';
import { ScraperFunction, ScraperModule } from './types';

/**
 * Cache de scrapers já carregados para evitar reimportação.
 */
const scraperCache = new Map<string, ScraperFunction>();

/**
 * Extrai o domínio de uma URL (sem www. e sem porta).
 * Exemplo: "https://www.example.com/page" → "example.com"
 */
export function extractDomain(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, '');
  } catch {
    throw new Error(`URL inválida: ${urlString}`);
  }
}

/**
 * Busca o scraper mais específico para um dado domínio.
 *
 * Estratégia de resolução (em ordem de prioridade):
 *   1. Correspondência exata: "sub.example.com.ts"
 *   2. Domínio pai: "example.com.ts"
 *   3. Fallback: "_default.ts"
 *
 * Suporta arquivos .ts e .js
 */
export function resolveScraperPath(domain: string): string | null {
  const scrapersDir = config.scrapersDir;

  if (!fs.existsSync(scrapersDir)) {
    console.warn(`⚠️  Diretório de scrapers não encontrado: ${scrapersDir}`);
    return null;
  }

  // Tenta correspondência exata e depois sobe nos subdomínios
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    for (const ext of ['.ts', '.js']) {
      const filePath = path.join(scrapersDir, `${candidate}${ext}`);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
  }

  // Fallback para _default
  for (const ext of ['.ts', '.js']) {
    const defaultPath = path.join(scrapersDir, `_default${ext}`);
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  }

  return null;
}

/**
 * Carrega e retorna a função de scraping para um determinado domínio.
 * Usa cache para evitar reimportação do mesmo módulo.
 */
export async function loadScraper(domain: string): Promise<ScraperFunction> {
  // Verifica cache
  if (scraperCache.has(domain)) {
    return scraperCache.get(domain)!;
  }

  const scraperPath = resolveScraperPath(domain);

  if (!scraperPath) {
    throw new Error(
      `Nenhum scraper encontrado para o domínio "${domain}".\n` +
      `Crie um arquivo em: ${config.scrapersDir}/${domain}.ts\n` +
      `Ou crie um scraper padrão em: ${config.scrapersDir}/_default.ts`
    );
  }

  console.log(`  🔧 Carregando scraper: ${path.basename(scraperPath)}`);

  try {
    // Importa o módulo dinamicamente
    const scraperModule: ScraperModule = require(scraperPath);

    if (typeof scraperModule.default !== 'function') {
      throw new Error(
        `O scraper "${scraperPath}" deve exportar uma função como default.\n` +
        `Exemplo:\n` +
        `  export default async function(page: Page): Promise<string> {\n` +
        `    return await page.evaluate(() => document.body.innerText);\n` +
        `  }`
      );
    }

    const scraperFn = scraperModule.default;

    if (scraperModule.name) {
      console.log(`  📌 Scraper: ${scraperModule.name}`);
    }

    // Cacheia o scraper
    scraperCache.set(domain, scraperFn);

    return scraperFn;
  } catch (error: any) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Erro ao carregar scraper "${scraperPath}": módulo não encontrado.`);
    }
    throw error;
  }
}

/**
 * Lista todos os scrapers disponíveis na pasta de scrapers.
 */
export function listAvailableScrapers(): string[] {
  const scrapersDir = config.scrapersDir;

  if (!fs.existsSync(scrapersDir)) {
    return [];
  }

  return fs.readdirSync(scrapersDir)
    .filter(file => file.endsWith('.ts') || file.endsWith('.js'))
    .filter(file => !file.endsWith('.d.ts'))
    .map(file => file.replace(/\.(ts|js)$/, ''));
}

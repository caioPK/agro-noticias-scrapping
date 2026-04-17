/**
 * Interface que define um scraper customizado por domínio.
 *
 * Cada scraper deve exportar como default uma função que recebe
 * o objeto `page` do Puppeteer e retorna uma string com o texto extraído.
 *
 * O arquivo deve ser nomeado com o domínio (ex: example.com.ts)
 * e colocado na pasta /scrapers.
 */
export interface ScraperFunction {
  (page: import('puppeteer').Page): Promise<string>;
}

/**
 * Interface para o módulo de scraper carregado dinamicamente.
 */
export interface ScraperModule {
  default: ScraperFunction;
  /** Nome opcional do scraper para logging */
  name?: string;
  /** Descrição opcional */
  description?: string;
}

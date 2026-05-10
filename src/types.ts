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

/**
 * Interface abstrata para fonte de dados (Google Sheets ou Excel local).
 *
 * Qualquer backend de planilha deve implementar esses 3 métodos.
 */
export interface DataSource {
  /** Lê as URLs da coluna configurada. Retorna pares {linha, url}. */
  readUrls(): Promise<{ row: number; url: string }[]>;

  /** Escreve o resultado na célula de output correspondente à linha. */
  writeResult(row: number, value: string): Promise<void>;

  /** Escreve uma mensagem de erro na célula de output correspondente. */
  writeError(row: number, error: string): Promise<void>;
}

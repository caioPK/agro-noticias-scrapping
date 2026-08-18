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
 * Opções de leitura de URLs (Fase 2).
 */
export interface ReadUrlsOptions {
  /**
   * Se true, ignora as linhas que já têm conteúdo na coluna de output.
   * Permite retomar um processamento interrompido sem refazer tudo.
   */
  skipFilled?: boolean;
}

/**
 * Interface abstrata para fonte de dados (Google Sheets ou Excel local).
 *
 * Qualquer backend de planilha deve implementar esses métodos.
 */
export interface DataSource {
  /**
   * Define a aba a ser usada, sobrescrevendo SHEET_NAME do .env.
   * Deve ser chamado antes de qualquer leitura/escrita.
   */
  setSheetName(sheetName: string): void;

  /** Lista as abas disponíveis na planilha. */
  listSheetNames(): Promise<string[]>;

  /** Lê as URLs da coluna configurada. Retorna pares {linha, url}. */
  readUrls(options?: ReadUrlsOptions): Promise<{ row: number; url: string }[]>;

  /**
   * Escreve o resultado na célula de output correspondente à linha.
   *
   * Quando o texto excede o limite de uma célula, o excedente é gravado
   * em colunas de overflow (F, G, H, ...) — ver writeResult das implementações.
   */
  writeResult(row: number, value: string, truncated?: boolean): Promise<void>;

  /** Escreve uma mensagem de erro na célula de output correspondente. */
  writeError(row: number, error: string): Promise<void>;

  /**
   * Lê os dados (URL e Conteúdo) da planilha para exportação (ex: Fase 3).
   * O `content` já vem com as colunas de overflow concatenadas.
   */
  readExportData(): Promise<{ row: number; url: string; content: string }[]>;
}

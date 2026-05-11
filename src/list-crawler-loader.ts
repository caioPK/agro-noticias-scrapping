import * as fs from 'fs';
import * as path from 'path';

/**
 * Interface que todo list-crawler deve exportar.
 */
export interface ListCrawlerModule {
  /** Nome amigável do crawler (ex: "Brasil de Fato") */
  crawlerName: string;
  /** Função principal que executa o crawler e salva os resultados */
  run(outputDir: string): Promise<void>;
}

/**
 * Diretório onde ficam os list-crawlers.
 */
const LIST_SCRAPPERS_DIR = path.resolve(__dirname, '..', 'list-scrappers');

/**
 * Lista todos os list-crawlers (.ts) disponíveis na pasta list-scrappers.
 * Retorna objetos com o nome do arquivo e o nome amigável do crawler.
 */
export function listAvailableListCrawlers(): { file: string; name: string }[] {
  if (!fs.existsSync(LIST_SCRAPPERS_DIR)) {
    console.warn(`⚠️  Diretório list-scrappers não encontrado: ${LIST_SCRAPPERS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(LIST_SCRAPPERS_DIR)
    .filter(f => f.startsWith('crawler-') && f.endsWith('.ts') && !f.endsWith('.d.ts'));

  return files.map(file => {
    try {
      const mod: ListCrawlerModule = require(path.join(LIST_SCRAPPERS_DIR, file));
      return { file, name: mod.crawlerName || file.replace(/^crawler-/, '').replace(/\.ts$/, '') };
    } catch {
      return { file, name: file.replace(/^crawler-/, '').replace(/\.ts$/, '') };
    }
  });
}

/**
 * Carrega e executa um list-crawler específico.
 */
export async function runListCrawler(filename: string, outputDir: string): Promise<void> {
  const crawlerPath = path.join(LIST_SCRAPPERS_DIR, filename);

  if (!fs.existsSync(crawlerPath)) {
    throw new Error(`List-crawler não encontrado: ${crawlerPath}`);
  }

  const mod: ListCrawlerModule = require(crawlerPath);

  if (typeof mod.run !== 'function') {
    throw new Error(
      `O list-crawler "${filename}" deve exportar uma função "run(outputDir: string)".`
    );
  }

  // Garante que o diretório de output exista
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await mod.run(outputDir);
}

/**
 * Lista os arquivos de resultado disponíveis na pasta results-list.
 */
export function listResultFiles(resultsDir: string): { file: string; fullPath: string }[] {
  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  return fs.readdirSync(resultsDir)
    .filter(f => f.endsWith('.xlsx') || f.endsWith('.json'))
    .sort()
    .map(file => ({
      file,
      fullPath: path.join(resultsDir, file),
    }));
}

import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from './config';
import { createDataSource } from './data-source';
import { DataSource } from './types';
import { extractDomain, loadScraper, listAvailableScrapers } from './scraper-loader';

/**
 * Delay helper para respeitar limites de taxa.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Processa uma única URL: carrega o scraper do domínio, abre a página e extrai o texto.
 */
async function processUrl(
  browser: Browser,
  dataSource: DataSource,
  url: string,
  row: number
): Promise<void> {
  let page: Page | null = null;

  try {
    const domain = extractDomain(url);
    console.log(`\n🌐 [Linha ${row}] Processando: ${url} (domínio: ${domain})`);

    // Carrega o scraper específico do domínio
    const scraperFn = await loadScraper(domain);

    // Abre nova aba no navegador
    page = await browser.newPage();

    // Configura user agent para evitar bloqueios
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navega até a URL
    console.log(`  ⏳ Carregando página...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.pageTimeout,
    });

    // Executa o scraper do usuário
    console.log(`  🔍 Executando scraper...`);
    const result = await scraperFn(page);

    if (!result || result.trim() === '') {
      console.log(`  ⚠️  Scraper retornou texto vazio`);
      await dataSource.writeResult(row, '[VAZIO] Nenhum conteúdo extraído');
    } else {
      // Trunca se for muito grande (limite ~50k caracteres por célula no Google Sheets / Excel)
      const maxLength = 49000;
      const truncated = result.length > maxLength
        ? result.substring(0, maxLength) + '\n\n[...TRUNCADO]'
        : result;

      console.log(`  ✅ Extraído: ${result.length} caracteres`);
      await dataSource.writeResult(row, truncated);
    }
  } catch (error: any) {
    console.error(`  ❌ Erro na linha ${row}: ${error.message}`);
    await dataSource.writeError(row, error.message.substring(0, 500));
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Ponto de entrada principal do script de web scraping.
 */
async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  Web Scraper — Puppeteer + Planilhas');
  console.log('═══════════════════════════════════════════════════\n');

  // Cria a fonte de dados (Google Sheets ou Excel local)
  const dataSource = createDataSource();

  // Lista scrapers disponíveis
  const availableScrapers = listAvailableScrapers();
  if (availableScrapers.length === 0) {
    console.warn('⚠️  Nenhum scraper encontrado na pasta /scrapers.');
    console.warn('   Crie pelo menos um arquivo _default.ts ou <domínio>.ts\n');
  } else {
    console.log(`📂 Scrapers disponíveis: ${availableScrapers.join(', ')}\n`);
  }

  // Lê as URLs da planilha
  const urls = await dataSource.readUrls();

  if (urls.length === 0) {
    console.log('ℹ️  Nenhuma URL encontrada na planilha. Nada a fazer.');
    return;
  }

  // Lança o navegador headless
  console.log('🚀 Iniciando navegador headless...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  });

  try {
    for (let i = 0; i < urls.length; i++) {
      const { row, url } = urls[i];

      await processUrl(browser, dataSource, url, row);

      // Delay entre requisições (exceto na última)
      if (i < urls.length - 1 && config.delayBetweenRequests > 0) {
        console.log(`  ⏱️  Aguardando ${config.delayBetweenRequests}ms...`);
        await delay(config.delayBetweenRequests);
      }
    }
  } finally {
    console.log('\n🔒 Fechando navegador...');
    await browser.close();
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  ✅ Concluído! ${urls.length} URLs processadas.`);
  console.log('═══════════════════════════════════════════════════\n');
}

// Executa e trata erros fatais
main().catch((error) => {
  console.error('\n💥 Erro fatal:', error.message);
  process.exit(1);
});

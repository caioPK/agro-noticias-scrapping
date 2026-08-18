import puppeteer, { Browser, Page } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';
import { createDataSource } from './data-source';
import { DataSource } from './types';
import { extractDomain, loadScraper, listAvailableScrapers } from './scraper-loader';
import {
  listAvailableListCrawlers,
  runListCrawler,
  listResultFiles,
} from './list-crawler-loader';
import { ExcelDataSource } from './excel';
import { sanitizeForIramuteq, buildCorpusLine } from './iramuteq-sanitizer';
// @inquirer/prompts é ESM-only, precisa de import() dinâmico em CommonJS
async function getInquirer() {
  const mod = await import('@inquirer/prompts');
  return { select: mod.select, confirm: mod.confirm };
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const RESULTS_LIST_DIR = path.resolve(__dirname, '..', 'results-list');

// ─── Utilitários ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Monta a lista de arquivos selecionáveis: planilha principal (.env) +
 * planilhas geradas pela Fase 1 em /results-list.
 */
function buildFileChoices(): { name: string; value: string }[] {
  const resultFiles = listResultFiles(RESULTS_LIST_DIR)
    .filter(f => f.file.endsWith('.xlsx'))
    // Ignora arquivos de lock do Excel (~$nome.xlsx)
    .filter(f => !f.file.startsWith('~$'));

  const choices: { name: string; value: string }[] = [
    {
      name: `📊 Planilha principal (${path.basename(config.excelFilePath)})`,
      value: '__MAIN__',
    },
  ];

  choices.push(
    ...resultFiles.map(f => ({
      name: `📄 ${f.file}  (results-list)`,
      value: f.fullPath,
    }))
  );

  return choices;
}

/**
 * Cria o DataSource para o arquivo escolhido e pergunta qual aba usar.
 *
 * A aba escolhida sobrescreve SHEET_NAME do .env. Se a planilha tiver apenas
 * uma aba, ela é selecionada automaticamente sem perguntar.
 */
async function createDataSourceWithSheet(selectedFile: string): Promise<DataSource> {
  let dataSource: DataSource;

  if (selectedFile === '__MAIN__') {
    // Usa a planilha principal configurada no .env
    dataSource = createDataSource();
  } else {
    // Usa uma planilha da Fase 1
    console.log(`📊 Usando arquivo: ${path.basename(selectedFile)}`);
    dataSource = new ExcelDataSource(selectedFile);
  }

  // Pergunta a aba
  let sheetNames: string[] = [];
  try {
    sheetNames = await dataSource.listSheetNames();
  } catch (err: any) {
    console.warn(`⚠️  Não foi possível listar as abas: ${err.message}`);
    console.warn(`   Usando SHEET_NAME do .env: "${config.sheetName}"`);
    return dataSource;
  }

  if (sheetNames.length === 0) {
    console.warn(`⚠️  Nenhuma aba encontrada. Usando SHEET_NAME do .env: "${config.sheetName}"`);
    return dataSource;
  }

  if (sheetNames.length === 1) {
    console.log(`📑 Aba: ${sheetNames[0]} (única disponível)`);
    dataSource.setSheetName(sheetNames[0]);
    return dataSource;
  }

  const { select } = await getInquirer();
  const chosenSheet = await select({
    message: 'Qual aba deseja trabalhar?',
    choices: sheetNames.map(name => ({
      // Marca a aba configurada no .env como sugestão
      name: name === config.sheetName ? `📑 ${name}  (padrão do .env)` : `📑 ${name}`,
      value: name,
    })),
    default: sheetNames.includes(config.sheetName) ? config.sheetName : sheetNames[0],
  });

  dataSource.setSheetName(chosenSheet);
  console.log(`📑 Aba selecionada: ${chosenSheet}`);

  return dataSource;
}

// ─── Fase 2: Processar URLs (scraping de conteúdo) ────────────────────────────

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
      // O texto completo vai inteiro para o DataSource, que fatia em blocos
      // e distribui o excedente nas colunas de overflow (F, G, H, ...).
      console.log(`  ✅ Extraído: ${result.length} caracteres`);
      await dataSource.writeResult(row, result);
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

// ─── FASE 1: Buscar lista de fontes ───────────────────────────────────────────

async function runFase1(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  📋 FASE 1 — Buscar Lista de Fontes');
  console.log('═══════════════════════════════════════════════════\n');

  const crawlers = listAvailableListCrawlers();

  if (crawlers.length === 0) {
    console.log('❌ Nenhum list-crawler encontrado na pasta /list-scrappers.');
    console.log('   Crie um arquivo crawler-<nome>.ts que exporte crawlerName e run().\n');
    return;
  }

  // Apresenta opções: crawlers individuais + todos
  const choices = [
    ...crawlers.map(c => ({
      name: `🕷️  ${c.name}  (${c.file})`,
      value: c.file,
    })),
    { name: '🚀 Executar TODOS os crawlers', value: '__ALL__' },
  ];

  const { select } = await getInquirer();
  const selected = await select({
    message: 'Qual list-crawler deseja executar?',
    choices,
  });

  // Garante que o diretório de output exista
  if (!fs.existsSync(RESULTS_LIST_DIR)) {
    fs.mkdirSync(RESULTS_LIST_DIR, { recursive: true });
  }

  if (selected === '__ALL__') {
    console.log(`\n🚀 Executando TODOS os ${crawlers.length} list-crawlers...\n`);
    for (const crawler of crawlers) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  Executando: ${crawler.name} (${crawler.file})`);
      console.log(`${'─'.repeat(60)}\n`);
      try {
        await runListCrawler(crawler.file, RESULTS_LIST_DIR);
      } catch (err: any) {
        console.error(`❌ Erro no crawler ${crawler.name}: ${err.message}`);
      }
    }
  } else {
    await runListCrawler(selected, RESULTS_LIST_DIR);
  }

  console.log('\n✅ Fase 1 concluída! Resultados salvos em: results-list/\n');
}

// ─── FASE 2: Processar artigos (scraping de conteúdo) ─────────────────────────

async function runFase2(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  🔍 FASE 2 — Processar Artigos');
  console.log('═══════════════════════════════════════════════════\n');

  // Monta a lista de fontes disponíveis
  const { select, confirm } = await getInquirer();
  const selectedFile = await select({
    message: 'Qual arquivo de URLs deseja processar?',
    choices: buildFileChoices(),
  });

  // Cria o DataSource e escolhe a aba
  const dataSource = await createDataSourceWithSheet(selectedFile);

  // Pergunta se deve pular as linhas já processadas
  const skipFilled = await confirm({
    message:
      `Processar apenas as linhas SEM conteúdo na coluna ` +
      `${config.outputColumn.toUpperCase()}? (pula as já feitas)`,
    default: true,
  });

  // Lista scrapers disponíveis
  const availableScrapers = listAvailableScrapers();
  if (availableScrapers.length === 0) {
    console.warn('⚠️  Nenhum scraper encontrado na pasta /scrapers.');
    console.warn('   Crie pelo menos um arquivo _default.ts ou <domínio>.ts\n');
  } else {
    console.log(`📂 Scrapers disponíveis: ${availableScrapers.join(', ')}\n`);
  }

  // Lê as URLs da planilha
  const urls = await dataSource.readUrls({ skipFilled });

  if (urls.length === 0) {
    console.log(
      skipFilled
        ? 'ℹ️  Nenhuma URL pendente na planilha (todas já processadas). Nada a fazer.'
        : 'ℹ️  Nenhuma URL encontrada na planilha. Nada a fazer.'
    );
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
    // const total = 5;
    const total = urls.length;
    for (let i = 0; i < total; i++) {
      const { row, url } = urls[i];

      await processUrl(browser, dataSource, url, row);

      // Delay entre requisições (exceto na última)
      if (i < total - 1 && config.delayBetweenRequests > 0) {
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

// ─── FASE 3: Exportar para Iramuteq ───────────────────────────────────────────

async function runFase3(): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  📑 FASE 3 — Exportar para Iramuteq');
  console.log('═══════════════════════════════════════════════════\n');

  const { select } = await getInquirer();
  const selectedFile = await select({
    message: 'Qual arquivo deseja exportar?',
    choices: buildFileChoices(),
  });

  // Cria o DataSource e escolhe a aba
  const dataSource = await createDataSourceWithSheet(selectedFile);

  // O content já vem com as colunas de overflow (F, G, ...) concatenadas
  const data = await dataSource.readExportData();

  if (data.length === 0) {
    console.log('ℹ️  Nenhum dado encontrado para exportação.');
    return;
  }

  console.log('⚙️  Processando e higienizando textos...');
  
  const corpusLines: string[] = [];
  let exportados = 0;

  for (const { row, url, content } of data) {
    if (!content || content.startsWith('[ERRO]') || content.startsWith('[VAZIO]')) {
      continue;
    }

    const header = buildCorpusLine(content);
    const sanitizedText = sanitizeForIramuteq(content);
    
    // Iramuteq exige que seja:
    // **** *var1 *var2
    // texto texto texto
    corpusLines.push(header);
    corpusLines.push(sanitizedText);
    corpusLines.push(''); // Linha em branco extra
    exportados++;
  }

  if (exportados === 0) {
    console.log('⚠️  Nenhum texto válido encontrado para exportação (todos vazios ou com erro).');
    return;
  }

  // Garante que o diretório de output exista
  if (!fs.existsSync(RESULTS_LIST_DIR)) {
    fs.mkdirSync(RESULTS_LIST_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
  const outPath = path.join(RESULTS_LIST_DIR, `iramuteq_corpus_${timestamp}.txt`);

  fs.writeFileSync(outPath, corpusLines.join('\n'), 'utf-8');

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  ✅ Exportação concluída!`);
  console.log(`  📄 Arquivo gerado: ${outPath}`);
  console.log(`  📝 Total de documentos exportados: ${exportados}`);
  console.log('═══════════════════════════════════════════════════\n');
}

// ─── MENU PRINCIPAL ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  Web Scraper — Sistema de Coleta de Dados');
  console.log('═══════════════════════════════════════════════════\n');

  let running = true;

  const { select, confirm } = await getInquirer();

  while (running) {
    const fase = await select({
      message: '🎯 Escolha a fase a executar:',
      choices: [
        {
          name: '📋  Fase 1 — Buscar lista de fontes (list-crawlers)',
          value: 'fase1',
        },
        {
          name: '🔍  Fase 2 — Processar artigos (scraping de conteúdo)',
          value: 'fase2',
        },
        {
          name: '📑  Fase 3 — Exportar para Iramuteq (.txt)',
          value: 'fase3',
        },
        {
          name: '🚪  Sair',
          value: 'sair',
        },
      ],
    });

    switch (fase) {
      case 'fase1':
        await runFase1();
        break;
      case 'fase2':
        await runFase2();
        break;
      case 'fase3':
        await runFase3();
        break;
      case 'sair':
        running = false;
        break;
    }

    if (running) {
      const continuar = await confirm({
        message: 'Deseja executar outra fase?',
        default: true,
      });
      if (!continuar) running = false;
    }
  }

  console.log('\n👋 Até a próxima!\n');
}

// Executa e trata erros fatais
main().catch((error) => {
  console.error('\n💥 Erro fatal:', error.message);
  process.exit(1);
});

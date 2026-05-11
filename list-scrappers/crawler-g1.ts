// crawler-g1.ts
// List-crawler para G1 Globo — busca notícias por termo, clicando "Veja mais" até esgotar.
// Exporta crawlerName e run() para integração com o sistema principal.

import puppeteer, { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── Configuração ──────────────────────────────────────────────────────────────

const SEARCH_URL = 'https://g1.globo.com/busca/?q=Agroneg%C3%B3cio&species=noticias';
const DELAY_BETWEEN_CLICKS = 2500;
const DELAY_AFTER_CLICK = 3000;
const MAX_CLICKS = 500;
const NAV_TIMEOUT = 30_000;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

interface Artigo {
  titulo: string;
  preview: string;
  link: string;
  data: string;
}

// ─── Nome público do crawler ──────────────────────────────────────────────────

export const crawlerName = 'G1 Globo';

// ─── Utilitários ───────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function saveJson(results: Artigo[], outputDir: string): void {
  const jsonPath = path.join(outputDir, 'g1.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
}

async function saveExcel(results: Artigo[], outputDir: string): Promise<void> {
  const xlsxPath = path.join(outputDir, 'g1.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resultados');

  sheet.columns = [
    { header: 'Título', key: 'titulo', width: 60 },
    { header: 'Preview', key: 'preview', width: 80 },
    { header: 'Link', key: 'link', width: 80 },
    { header: 'Data', key: 'data', width: 15 },
  ];

  sheet.getRow(1).font = { bold: true };
  results.forEach(r => sheet.addRow(r));
  await workbook.xlsx.writeFile(xlsxPath);
}

// ─── Extração de todos os cards (roda no contexto do browser) ──────────────────

function extractAllCards(): Artigo[] {
  const cards = document.querySelectorAll('li.widget--card.widget--info');
  const results: Artigo[] = [];

  cards.forEach(card => {
    const titleEl = card.querySelector('.widget--info__title');
    const descEl = card.querySelector('.widget--info__description');
    const linkEl = card.querySelector<HTMLAnchorElement>('.widget--info__text-container > a');

    const titulo = titleEl ? titleEl.textContent!.trim() : '[TÍTULO NÃO ENCONTRADO]';
    const preview = descEl ? descEl.textContent!.trim() : '[PREVIEW NÃO ENCONTRADO]';
    const link = linkEl ? linkEl.href : '[LINK NÃO ENCONTRADO]';

    let data = '[DATA NÃO ENCONTRADA]';
    if (link !== '[LINK NÃO ENCONTRADO]') {
      const match = link.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (match) data = `${match[3]}/${match[2]}/${match[1]}`;
    }

    results.push({ titulo, preview, link, data });
  });

  return results;
}

// ─── Função principal exportada ────────────────────────────────────────────────

export async function run(outputDir: string): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  List-Crawler: G1 Globo');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page: Page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  let clickCount = 0;

  try {
    console.log(`🔍 Navegando para: ${SEARCH_URL}`);
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2' });

    // Aguarda os cards iniciais
    try {
      await page.waitForSelector('li.widget--card.widget--info', { timeout: 15_000 });
    } catch {
      console.log('❌ Nenhum resultado encontrado na página.');
      return;
    }

    await sleep(1000);

    // Loop: clica em "Veja mais" até não existir mais
    while (clickCount < MAX_CLICKS) {
      const hasBtn = await page.evaluate(() => {
        return !!document.querySelector('button.pagination__load-more');
      });

      if (!hasBtn) {
        console.log('✅ Botão "Veja mais" não encontrado — todos os resultados foram carregados.');
        break;
      }

      const previousCount = await page.evaluate(() => {
        return document.querySelectorAll('li.widget--card.widget--info').length;
      });

      console.log(`📄 Cards carregados: ${previousCount} | Clicando em "Veja mais" (${clickCount + 1})...`);

      await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('button.pagination__load-more');
        btn?.click();
      });
      clickCount++;

      // Aguarda novos cards
      try {
        await page.waitForFunction(
          (prevCount: number) => {
            return document.querySelectorAll('li.widget--card.widget--info').length > prevCount;
          },
          { timeout: DELAY_AFTER_CLICK + 5000 },
          previousCount
        );
      } catch {
        console.log(`⚠️  Nenhum card novo carregou após o clique ${clickCount}. Encerrando paginação.`);
        break;
      }

      const newCount = await page.evaluate(() => {
        return document.querySelectorAll('li.widget--card.widget--info').length;
      });
      console.log(`   ➜ Cards após clique: ${newCount}`);

      await sleep(DELAY_BETWEEN_CLICKS);
    }

    if (clickCount >= MAX_CLICKS) {
      console.warn(`⚠️ Limite de ${MAX_CLICKS} cliques atingido. Encerrando paginação.`);
    }

    // Extrai todos os cards
    console.log('\n🔍 Extraindo todos os cards...');
    const results = await page.evaluate(extractAllCards);

    console.log(`\n✅ Extração concluída! Total de matérias: ${results.length}`);

    // Salva resultados
    saveJson(results, outputDir);
    await saveExcel(results, outputDir);

  } catch (err) {
    console.error('💥 Erro fatal:', err);
  } finally {
    await browser.close();
    const totalCards = await getJsonCount(outputDir);
    console.log('\n════════════════════════════════════════════');
    console.log(`📊 TOTAL coletado: ${totalCards} matérias`);
    console.log(`💾 Arquivos salvos em: ${outputDir}`);
    console.log('════════════════════════════════════════════');
  }
}

function getJsonCount(outputDir: string): number {
  try {
    const jsonPath = path.join(outputDir, 'g1.json');
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      return Array.isArray(data) ? data.length : 0;
    }
  } catch { }
  return 0;
}

// Permite execução direta: npx ts-node list-scrappers/crawler-g1.ts
if (require.main === module) {
  const outputDir = path.resolve(__dirname, '..', 'results-list');
  run(outputDir).catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
}

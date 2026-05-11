// crawler-pagina12.ts
// List-crawler para Página 12 — busca artigos por termo e faixa de datas.
// Exporta crawlerName e run() para integração com o sistema principal.

import puppeteer, { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── Configuração ────────────────────────────────────────────
const QUERY = 'agronegocio';
const START_DATE = '2022-01-01T03:00:00.000Z';
const END_DATE = '2025-01-01T02:59:59.999Z';

const BASE_URL = 'https://www.pagina12.com.ar/buscar/';

const SLEEP_BETWEEN_PAGES_MS = 1500;
const NAV_TIMEOUT_MS = 30000;
const MAX_PAGES_SAFETY = 500;
const NOT_FOUND = '[não encontrado]';

// ─── Tipos ────────────────────────────────────────────────────

interface Artigo {
  titulo: string;
  preview: string;
  link: string;
  data: string;
  categoria: string;
  autor: string;
}

// ─── Nome público do crawler ──────────────────────────────────

export const crawlerName = 'Página 12';

// ─── Utilitários ──────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function buildUrl(page: number): string {
  const params = new URLSearchParams({
    q: QUERY,
    start_date: START_DATE,
    end_date: END_DATE,
    page: String(page),
  });
  return `${BASE_URL}?${params.toString()}`;
}

function saveJson(results: Artigo[], outputDir: string): void {
  const jsonPath = path.join(outputDir, 'pagina12.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
}

async function saveExcel(results: Artigo[], outputDir: string): Promise<void> {
  const xlsxPath = path.join(outputDir, 'pagina12.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resultados');

  sheet.columns = [
    { header: 'Título', key: 'titulo', width: 60 },
    { header: 'Preview', key: 'preview', width: 80 },
    { header: 'Link', key: 'link', width: 80 },
    { header: 'Data', key: 'data', width: 20 },
    { header: 'Categoria', key: 'categoria', width: 25 },
    { header: 'Autor', key: 'autor', width: 30 },
  ];

  sheet.getRow(1).font = { bold: true };
  results.forEach(r => sheet.addRow(r));
  await workbook.xlsx.writeFile(xlsxPath);
}

// ─── Extração (roda dentro do browser) ────────────────────────

function extractCards(): { cards: Artigo[]; hasNext: boolean } {
  const NF = '[não encontrado]';
  const cardEls = document.querySelectorAll('.p12-article-card-full');
  const out: Artigo[] = [];

  cardEls.forEach(card => {
    const anchor = card.querySelector<HTMLAnchorElement>('a.p12-article-card-full--inner');
    const titleEl = card.querySelector('.p12-article-card-full--content h4, .p12-article-card-full--content h3, .p12-article-card-full--content .title');
    const leadEl = card.querySelector('.p12-article-card-full--content .lead, .p12-article-card-full--content p');
    const timeEl = card.querySelector('time');
    const logoImg = card.querySelector<HTMLImageElement>('.logo-wrp img');
    const authorEl = card.querySelector('.p12Author');

    out.push({
      titulo: titleEl ? titleEl.textContent!.trim() : NF,
      preview: leadEl ? leadEl.textContent!.trim() : NF,
      link: anchor ? anchor.href : NF,
      data: timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent!.trim()) : NF,
      categoria: logoImg ? (logoImg.getAttribute('alt') || NF) : NF,
      autor: authorEl ? authorEl.textContent!.trim().replace(/^Por\s+/i, '') : NF,
    });
  });

  const hasNext = !!document.querySelector('.navigation-start') || !!document.querySelector('.navigation-next');
  return { cards: out, hasNext };
}

// ─── Função principal exportada ───────────────────────────────

export async function run(outputDir: string): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  List-Crawler: Página 12');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  const page: Page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  );
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const allResults: Artigo[] = [];
  let pageNum = 0;

  try {
    while (pageNum < MAX_PAGES_SAFETY) {
      const url = buildUrl(pageNum);
      console.log(`\n📄 Página ${pageNum} → ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (err: any) {
        console.warn(`⚠️  Erro de navegação: ${err.message}. Tentando novamente em 5s...`);
        await sleep(5000);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }

      // Espera os cards aparecerem
      try {
        await page.waitForSelector('.p12-article-card-full', { timeout: 15000 });
      } catch {
        console.log('🏁 Nenhum card carregou nessa página. Encerrando.');
        break;
      }

      const { cards, hasNext } = await page.evaluate(extractCards);
      console.log(`   ✅ ${cards.length} resultados extraídos. Próxima página? ${hasNext}`);

      if (cards.length === 0) {
        console.log('🏁 Página vazia. Encerrando.');
        break;
      }

      allResults.push(...cards);
      saveJson(allResults, outputDir);
      await saveExcel(allResults, outputDir);

      if (!hasNext) {
        console.log('🏁 Botão "Siguiente Página" ausente. Última página alcançada.');
        break;
      }

      pageNum++;
      await sleep(SLEEP_BETWEEN_PAGES_MS);
    }
  } catch (err) {
    console.error('💥 Erro fatal:', err);
  } finally {
    await browser.close();
    console.log(`\n════════════════════════════════════════════`);
    console.log(`📊 TOTAL: ${allResults.length} matérias coletadas`);
    console.log(`💾 Arquivos salvos em: ${outputDir}`);
    console.log(`════════════════════════════════════════════`);
  }
}

// Permite execução direta: npx ts-node list-scrappers/crawler-pagina12.ts
if (require.main === module) {
  const outputDir = path.resolve(__dirname, '..', 'results-list');
  run(outputDir).catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
}
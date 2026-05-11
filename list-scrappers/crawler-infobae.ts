// crawler-infobae.ts
// List-crawler para Infobae — busca artigos por termo via AJAX paginado.
// Exporta crawlerName e run() para integração com o sistema principal.

import puppeteer, { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── Configuração ──────────────────────────────────────────────────────────────

const SEARCH_URL = 'https://www.infobae.com/buscador/?query=agronegocio';
const ANO_MIN = 2022;
const ANO_MAX = 2024;
const SLEEP_MS = 1200;
const AJAX_TIMEOUT_MS = 15_000;
const MAX_PAGES = 500;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

interface Artigo {
  titulo: string;
  data: string;
  linhafina: string;
  link: string;
  ano: string;
}

// ─── Nome público do crawler ──────────────────────────────────────────────────

export const crawlerName = 'Infobae';

// ─── Utilitários ───────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function saveJson(results: Artigo[], outputDir: string): void {
  const jsonPath = path.join(outputDir, 'infobae.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
}

async function saveExcel(results: Artigo[], outputDir: string): Promise<void> {
  const xlsxPath = path.join(outputDir, 'infobae.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resultados');

  sheet.columns = [
    { header: 'Título', key: 'titulo', width: 60 },
    { header: 'Data', key: 'data', width: 15 },
    { header: 'Linha Fina', key: 'linhafina', width: 80 },
    { header: 'Link', key: 'link', width: 80 },
    { header: 'Ano', key: 'ano', width: 10 },
  ];

  sheet.getRow(1).font = { bold: true };
  results.forEach(r => sheet.addRow(r));
  await workbook.xlsx.writeFile(xlsxPath);
}

// ─── Extração de uma página (roda no contexto do browser) ─────────────────────

function extractCurrentPage(anoMin: number, anoMax: number): {
  dados: Artigo[];
  foraDaFaixa: string[];
  hasNextBtn: boolean;
  firstHref: string;
} {
  const container = document.querySelector('#resultdata');
  if (!container) {
    return { dados: [], foraDaFaixa: [], hasNextBtn: false, firstHref: '' };
  }

  const itens = container.querySelectorAll<HTMLElement>('.queryly_item_row');
  const dados: Artigo[] = [];
  const foraDaFaixa: string[] = [];

  console.log('📝⚠️ BUSCANDO EM UM TOTAL DE', itens.length);

  for (let i = 0; i < itens.length; i++) {
    const link = itens[i].querySelectorAll<HTMLAnchorElement>('a')[0];
    if (!link) continue;

    const arrayLink = link.href.split('/');
    const ano = arrayLink[arrayLink.length - 5];

    if (Number(ano) >= anoMin && Number(ano) <= anoMax) {
      const titulo = link.querySelector<HTMLElement>('.queryly_item_title')?.innerHTML?.trim()
        ?? '[não encontrado]';
      const linhafina = link.querySelector<HTMLElement>('.queryly_item_description')?.innerHTML?.trim()
        ?? '[não encontrado]';
      const divs = link.querySelectorAll<HTMLElement>('.queryly_item_advancedcontainer div');
      const dataPura = divs[2]?.innerHTML?.trim() ?? '[não encontrado]';
      const dataObj = new Date(dataPura);
      const data = dataObj.toString() !== 'Invalid Date'
        ? dataObj.toLocaleDateString('pt-BR')
        : dataPura;

      dados.push({ titulo, data, linhafina, link: link.href, ano });
    } else {
      foraDaFaixa.push(link.href);
      console.log(ano, '🚨FORA DO RANGE DE DATAS', link.href);
    }
  }

  const nextBtn = document.querySelector<HTMLElement>('.next_btn');
  const firstHref = (container.querySelector<HTMLAnchorElement>('.queryly_item_row a'))?.href ?? '';

  return { dados, foraDaFaixa, hasNextBtn: !!nextBtn, firstHref };
}

// ─── Função principal exportada ────────────────────────────────────────────────

export async function run(outputDir: string): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  List-Crawler: Infobae');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page: Page = await browser.newPage();
  page.setDefaultNavigationTimeout(30_000);
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  );

  const todasDatas: Artigo[] = [];
  let pageCount = 0;

  try {
    // Carrega a página inicial
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.queryly_item_row', { timeout: 15_000 });
    await sleep(800);

    while (pageCount < MAX_PAGES) {
      pageCount++;
      console.log(`\n📄 Processando página ${pageCount}...`);

      const { dados, foraDaFaixa, hasNextBtn, firstHref } =
        await page.evaluate(extractCurrentPage, ANO_MIN, ANO_MAX);

      console.log(
        `   ✅ ${dados.length} dentro do range | ` +
        `🚨 ${foraDaFaixa.length} fora do range`
      );

      if (dados.length > 0) {
        todasDatas.push(...dados);
        saveJson(todasDatas, outputDir);
        await saveExcel(todasDatas, outputDir);
        console.table(dados.map(d => ({
          titulo: d.titulo.substring(0, 50),
          data: d.data,
          ano: d.ano,
        })));
      }

      // Condições de parada
      if (!hasNextBtn) {
        console.log('🏁 Botão "Siguiente" não encontrado. Fim da paginação.');
        break;
      }
      if (dados.length === 0 && foraDaFaixa.length > 0) {
        const primeiroAnoForaStr = foraDaFaixa[0]?.split('/')?.[foraDaFaixa[0].split('/').length - 5];
        const primeiroAnoFora = Number(primeiroAnoForaStr);
        if (primeiroAnoFora < ANO_MIN) {
          console.log(`🏁 Datas abaixo de ${ANO_MIN}. Encerrando.`);
          break;
        }
      }
      if (dados.length === 0 && foraDaFaixa.length === 0) {
        console.log('🏁 Página vazia. Encerrando.');
        break;
      }

      // Clica em "Siguiente" e aguarda o AJAX
      console.log('   ➡️  Clicando em "Siguiente"...');
      const hrefAntes = firstHref;

      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.next_btn')?.click();
      });

      try {
        await page.waitForFunction(
          (hrefAnterior: string) => {
            const primeiro = document.querySelector<HTMLAnchorElement>(
              '.queryly_item_row a'
            );
            return primeiro?.href !== hrefAnterior;
          },
          { timeout: AJAX_TIMEOUT_MS },
          hrefAntes
        );
      } catch {
        console.warn('⚠️  Timeout aguardando novos itens. Encerrando.');
        break;
      }

      await sleep(SLEEP_MS);
    }

  } catch (err) {
    console.error('💥 Erro fatal:', err);
  } finally {
    await browser.close();
    console.log('\n════════════════════════════════════════════');
    console.log(`📊 TOTAL coletado: ${todasDatas.length} artigos`);
    console.log(`💾 Arquivos salvos em: ${outputDir}`);
    console.log('════════════════════════════════════════════');
  }
}

// Permite execução direta: npx ts-node list-scrappers/crawler-infobae.ts
if (require.main === module) {
  const outputDir = path.resolve(__dirname, '..', 'results-list');
  run(outputDir).catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
}
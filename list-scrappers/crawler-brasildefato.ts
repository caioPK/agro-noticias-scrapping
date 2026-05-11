// crawler-brasildefato.ts
// List-crawler para Brasil de Fato — busca artigos por termo e faixa de datas.
// Exporta crawlerName e run() para integração com o sistema principal.

import puppeteer, { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── Configuração ─────────────────────────────────────────────────────────────

const START_URL = 'https://www.brasildefato.com.br/?s=agronegocio';
const ANO_MIN = 2022;
const ANO_MAX = 2024;
const SLEEP_MS = 1500;
const NAV_TIMEOUT = 30_000;
const MAX_PAGES = 500;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Artigo {
  titulo: string;
  link: string;
  ano: string;
}

interface PageResult {
  dados: Artigo[];
  foraDaFaixa: string[];
  proximaUrl: string | null;
}

// ─── Nome público do crawler ──────────────────────────────────────────────────

export const crawlerName = 'Brasil de Fato';

// ─── Utilitários ──────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function saveJson(results: Artigo[], outputDir: string): void {
  const jsonPath = path.join(outputDir, 'brasildefato.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8');
}

async function saveExcel(results: Artigo[], outputDir: string): Promise<void> {
  const xlsxPath = path.join(outputDir, 'brasildefato.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Resultados');

  sheet.columns = [
    { header: 'Título', key: 'titulo', width: 60 },
    { header: 'Link', key: 'link', width: 80 },
    { header: 'Ano', key: 'ano', width: 10 },
  ];

  // Estilo do cabeçalho
  sheet.getRow(1).font = { bold: true };

  results.forEach(r => sheet.addRow(r));
  await workbook.xlsx.writeFile(xlsxPath);
}

// ─── Extração (roda dentro do browser) ───────────────────────────────────────

function extractPage(anoMin: number, anoMax: number): PageResult {
  const container = document.querySelector(
    '.elementor-loop-container.elementor-grid'
  );

  if (!container) {
    return { dados: [], foraDaFaixa: [], proximaUrl: null };
  }

  const itens = container.querySelectorAll<HTMLElement>(
    '.e-con-inner .elementor-element-24ec411'
  );

  const dados: Artigo[] = [];
  const foraDaFaixa: string[] = [];

  for (let i = 0; i < itens.length; i++) {
    const linkEl = itens[i].querySelectorAll<HTMLAnchorElement>(
      'h2.elementor-heading-title.elementor-size-default a'
    )[1];

    if (!linkEl) continue;

    const ano = linkEl.href
      .replace('https://www.brasildefato.com.br/', '')
      .split('/')[0];

    if (Number(ano) >= anoMin && Number(ano) <= anoMax) {
      dados.push({ titulo: linkEl.innerHTML.trim(), link: linkEl.href, ano });
    } else {
      foraDaFaixa.push(linkEl.href);
      console.log('🚨FORA DO RANGE DE DATAS', linkEl.href);
    }
  }

  const nextBtn = document.querySelector<HTMLAnchorElement>(
    'a.page-numbers.next'
  );
  const proximaUrl = nextBtn ? nextBtn.href : null;

  return { dados, foraDaFaixa, proximaUrl };
}

// ─── Função principal exportada ───────────────────────────────────────────────

export async function run(outputDir: string): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🕷️  List-Crawler: Brasil de Fato');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page: Page = await browser.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  );

  const allResults: Artigo[] = [];
  let currentUrl: string | null = START_URL;
  let pageCount = 0;
  let foundOutOfRange = false;

  try {
    while (currentUrl && pageCount < MAX_PAGES) {
      pageCount++;
      console.log(`\n📄 Página ${pageCount} → ${currentUrl}`);

      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(
          '.elementor-loop-container.elementor-grid',
          { timeout: 15_000 }
        );
      } catch (err) {
        console.warn(`⚠️  Falha: ${(err as Error).message}. Retry em 5s...`);
        await sleep(5_000);
        try {
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector(
            '.elementor-loop-container.elementor-grid',
            { timeout: 15_000 }
          );
        } catch {
          console.error('❌ Segunda tentativa falhou. Encerrando.');
          break;
        }
      }

      const { dados, foraDaFaixa, proximaUrl } =
        await page.evaluate(extractPage, ANO_MIN, ANO_MAX);

      console.log(
        `   ✅ ${dados.length} dentro do range | ` +
        `🚨 ${foraDaFaixa.length} fora do range | ` +
        `➡️  próxima: ${proximaUrl ?? 'nenhuma'}`
      );

      if (dados.length > 0) {
        allResults.push(...dados);
        // Salva incrementalmente
        saveJson(allResults, outputDir);
        await saveExcel(allResults, outputDir);
        console.table(dados);
      }

      // Para quando todos os itens estão abaixo de ANO_MIN
      // if (dados.length === 0 && foraDaFaixa.length > 0) {
      //   const anoFora = Number(
      //     foraDaFaixa[0]
      //       .replace('https://www.brasildefato.com.br/', '')
      //       .split('/')[0]
      //   );
      //   if (anoFora < ANO_MIN) {
      //     console.log(`🏁 Datas abaixo de ${ANO_MIN}. Encerrando.`);
      //     foundOutOfRange = true;
      //     break;
      //   }
      // }

      if (dados.length === 0 && foraDaFaixa.length === 0) {
        console.log('🏁 Página vazia. Encerrando.');
        break;
      }

      currentUrl = proximaUrl;
      await sleep(SLEEP_MS);
    }

  } catch (err) {
    console.error('💥 Erro fatal:', err);
  } finally {
    await browser.close();
    console.log('\n════════════════════════════════════════════');
    console.log(`📊 TOTAL coletado: ${allResults.length} artigos`);
    if (foundOutOfRange) {
      console.log(`ℹ️  Parou fora do range ${ANO_MIN}–${ANO_MAX}`);
    }
    console.log(`💾 Arquivos salvos em: ${outputDir}`);
    console.log('════════════════════════════════════════════');
  }
}

// Permite execução direta: npx ts-node list-scrappers/crawler-brasildefato.ts
if (require.main === module) {
  const outputDir = path.resolve(__dirname, '..', 'results-list');
  run(outputDir).catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
}
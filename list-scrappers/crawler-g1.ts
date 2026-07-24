// crawler-g1.ts
// List-crawler para G1 Globo — busca notícias por termo, clicando "Veja mais" até esgotar.
// Exporta crawlerName e run() para integração com o sistema principal.

import puppeteer, { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';

// ─── Configuração ──────────────────────────────────────────────────────────────

const SEARCH_URL = 'https://g1.globo.com/busca/?q=Agroneg%C3%B3cio&species=noticias&from=2022-01-01T03%3A00%3A00.000Z&to=2025-01-01T02%3A59%3A59.999Z';
const DELAY_BETWEEN_CLICKS = 5000;
const DELAY_AFTER_CLICK = 8000;
const WAIT_NEW_CARDS_TIMEOUT = 20_000; // espera cards crescerem após clique
const RETRIES_ON_STALL = 2;            // re-clica antes de desistir se nada carregar
const MAX_ITEMS = 0;                 // limite de itens a capturar (teste); 0 = sem limite
const MAX_CLICKS = 500;
const NAV_TIMEOUT = 30_000;

// Range de datas aceito (inclusivo)
const DATE_MIN = new Date(2022, 0, 1);   // 01/01/2022
const DATE_MAX = new Date(2024, 11, 31); // 31/12/2024

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

// Converte "DD/MM/YYYY" em Date. Retorna null se formato inválido.
function parseData(data: string): Date | null {
  const m = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const d = new Date(ano, mes - 1, dia);
  // Valida (rejeita 32/13/etc)
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) {
    return null;
  }
  return d;
}

// True se data string está dentro do range [DATE_MIN, DATE_MAX].
function dentroDoRange(data: string): boolean {
  const d = parseData(data);
  if (!d) return false;
  return d >= DATE_MIN && d <= DATE_MAX;
}

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

    // Data: 1º tenta pela URL (/AAAA/MM/DD/); se falhar, cai pra tag <span> em .widget--info__meta
    let data = '[DATA NÃO ENCONTRADA]';
    if (link !== '[LINK NÃO ENCONTRADO]') {
      const urlMatch = link.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (urlMatch) data = `${urlMatch[3]}/${urlMatch[2]}/${urlMatch[1]}`;
    }
    if (data === '[DATA NÃO ENCONTRADA]') {
      // Fallback: span dentro de .widget--info__meta (ex: "05/12/2024 19:04")
      const metaEl = card.querySelector('.widget--info__meta span') || card.querySelector('.widget--info__meta');
      const metaText = metaEl ? metaEl.textContent!.trim() : '';
      const spanMatch = metaText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (spanMatch) data = `${spanMatch[1]}/${spanMatch[2]}/${spanMatch[3]}`;
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

  // Listeners de diagnóstico: capturam crash/erro da aba e desconexão do browser
  page.on('error', (err: unknown) => console.error('🧨 page crash (target closed):', err));
  page.on('pageerror', (err: unknown) => console.error('🧨 erro JS na página:', (err as Error)?.message ?? err));
  browser.on('disconnected', () => console.error('🧨 browser desconectou (crash/OOM?)'));

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

      if (MAX_ITEMS > 0 && previousCount >= MAX_ITEMS) {
        console.log(`🛑 Limite de ${MAX_ITEMS} itens atingido (${previousCount} carregados). Parando paginação.`);
        break;
      }

      console.log(`📄 Cards carregados: ${previousCount} | Clicando em "Veja mais" (${clickCount + 1})...`);

      // Tenta clicar e aguardar novos cards; re-tenta se travar (possível rate-limit).
      let carregou = false;
      for (let tentativa = 0; tentativa <= RETRIES_ON_STALL; tentativa++) {
        if (tentativa > 0) {
          console.log(`   🔁 Nenhum card novo. Re-tentando clique (${tentativa}/${RETRIES_ON_STALL}) após pausa...`);
          await sleep(DELAY_AFTER_CLICK); // pausa extra pra aliviar possível bloqueio
        }

        // Scroll até o botão e clica (garante que está visível/ativo)
        await page.evaluate(() => {
          const btn = document.querySelector<HTMLElement>('button.pagination__load-more');
          btn?.scrollIntoView({ block: 'center' });
          btn?.click();
        });

        try {
          await page.waitForFunction(
            (prevCount: number) => {
              return document.querySelectorAll('li.widget--card.widget--info').length > prevCount;
            },
            { timeout: WAIT_NEW_CARDS_TIMEOUT },
            previousCount
          );
          carregou = true;
          break;
        } catch {
          // stall — loop tenta de novo se ainda houver tentativas
        }
      }

      clickCount++;

      if (!carregou) {
        console.log(`⚠️  Nenhum card novo após ${RETRIES_ON_STALL + 1} tentativas no clique ${clickCount}. Encerrando paginação.`);
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
    const rawFull = await page.evaluate(extractAllCards);
    const raw = MAX_ITEMS > 0 ? rawFull.slice(0, MAX_ITEMS) : rawFull;

    if (MAX_ITEMS > 0 && rawFull.length > MAX_ITEMS) {
      console.log(`✂️  ${rawFull.length} cards extraídos, cortando para ${MAX_ITEMS} (limite de teste).`);
    }

    // Mostra a data encontrada em cada card
    console.log('\n🗓️  Datas encontradas por card:');
    raw.forEach((a, i) => {
      const marca = dentroDoRange(a.data) ? '✅' : '🚫';
      console.log(`   ${marca} [${i + 1}] ${a.data}`);
      // if (a.data === '[DATA NÃO ENCONTRADA]') {
      //   console.log(`      🔗 link sem data: ${a.link}`);
      // }
    });

    // Filtra por range de datas [01/01/2022, 31/12/2024]
    const results = raw.filter(a => dentroDoRange(a.data));
    const foraDoRange = raw.length - results.length;

    console.log(`\n✅ Extração concluída! Total bruto: ${raw.length}`);
    console.log(`🗓️  Fora do range (01/01/2022–31/12/2024): ${foraDoRange} itens descartados`);
    console.log(`📥 Dentro do range: ${results.length} matérias`);

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
  // Captura mortes silenciosas (rejeições/erros não tratados que matam o processo)
  process.on('unhandledRejection', (reason) => {
    console.error('🧨 unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('🧨 uncaughtException:', err);
  });
  process.on('exit', (code) => {
    console.error(`🚪 process.exit chamado com código ${code}`);
  });

  const outputDir = path.resolve(__dirname, '..', 'results-list');
  run(outputDir).catch(err => {
    console.error('💥 Erro fatal:', err);
    process.exit(1);
  });
}

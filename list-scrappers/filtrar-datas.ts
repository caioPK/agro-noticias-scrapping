/// <reference types="node" />
// filtrar-datas.ts
// Script standalone (fora do menu do app): recebe uma planilha .xlsx, percorre a aba
// de dados e separa as URLs pela data extraída da própria URL (padrão /AAAA/MM/DD/).
//
// - URLs COM data dentro de [01/01/2022, 31/12/2024]  -> aba "FILTRADO"
// - URLs COM data FORA desse range (ou sem data)      -> aba "FORA_DO_RANGE"
//
// As abas originais são preservadas; apenas as duas abas de saída são (re)criadas.
//
// Uso:
//   npx ts-node filtrar-datas.ts [caminho-da-planilha.xlsx] [nomeDaAba]
//
// Padrões: arquivo "Webscrapping.xlsx", aba "dados".

import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

// ─── Configuração ────────────────────────────────────────────────────────────

const DEFAULT_FILE = 'Webscrapping.xlsx';
const DEFAULT_SHEET = 'dados';
const OUT_SHEET_IN = 'FILTRADO';       // dentro do range
const OUT_SHEET_OUT = 'FORA_DO_RANGE'; // fora do range
const LINK_HEADER = 'link';            // header da coluna de URL

// Range aceito (inclusivo)
const DATE_MIN = new Date(2022, 0, 1, 0, 0, 0);        // 01/01/2022
const DATE_MAX = new Date(2024, 11, 31, 23, 59, 59);   // 31/12/2024

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normaliza o valor de uma célula em texto (trata hyperlink { text, hyperlink }). */
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const v = value as any;
    if ('hyperlink' in v) return (v.hyperlink || v.text || '').toString();
    if ('text' in v) return v.text.toString();
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('');
    if ('result' in v) return (v.result ?? '').toString();
    return '';
  }
  return value.toString();
}

/** Extrai a data da URL. Aceita /AAAA/MM/DD/ e, como fallback, /AAAA/MM/. */
function extractDateFromUrl(url: string): Date | null {
  const ymd = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) return date;
  }
  const ym = url.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
  if (ym) {
    const [, y, m] = ym;
    const date = new Date(Number(y), Number(m) - 1, 1);
    if (!isNaN(date.getTime())) return date;
  }
  return null;
}

function inRange(date: Date): boolean {
  return date.getTime() >= DATE_MIN.getTime() && date.getTime() <= DATE_MAX.getTime();
}

/** Localiza o índice (1-based) da coluna de link e a linha do header. */
function locateLinkColumn(sheet: ExcelJS.Worksheet): { col: number; headerRow: number } {
  // Procura o header "link" nas 5 primeiras linhas.
  for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= sheet.columnCount; c++) {
      if (cellToText(row.getCell(c).value).trim().toLowerCase() === LINK_HEADER) {
        return { col: c, headerRow: r };
      }
    }
  }
  throw new Error(`Coluna "${LINK_HEADER}" não encontrada nas primeiras linhas da aba.`);
}

// ─── Principal ───────────────────────────────────────────────────────────────

async function main() {
  const filePath = path.resolve(process.argv[2] || DEFAULT_FILE);
  const sheetName = process.argv[3] || DEFAULT_SHEET;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log('  🗂️  Filtro de datas por URL  [01/01/2022–31/12/2024]');
  console.log('═══════════════════════════════════════════════════');
  console.log(`📄 Arquivo: ${path.basename(filePath)}`);
  console.log(`📑 Aba de origem: ${sheetName}\n`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const source = workbook.getWorksheet(sheetName);
  if (!source) {
    const avail = workbook.worksheets.map(w => w.name).join(', ');
    throw new Error(`Aba "${sheetName}" não encontrada. Disponíveis: ${avail}`);
  }

  const { col: linkCol, headerRow } = locateLinkColumn(source);
  console.log(`🔗 Coluna de link: ${linkCol} (header na linha ${headerRow})\n`);

  // Header original (linha do header), pra replicar nas abas de saída.
  const headerValues: ExcelJS.CellValue[] = [];
  const hRow = source.getRow(headerRow);
  for (let c = 1; c <= source.columnCount; c++) {
    headerValues[c - 1] = hRow.getCell(c).value;
  }

  // (Re)cria abas de saída.
  for (const name of [OUT_SHEET_IN, OUT_SHEET_OUT]) {
    const existing = workbook.getWorksheet(name);
    if (existing) workbook.removeWorksheet(existing.id);
  }
  const sheetIn = workbook.addWorksheet(OUT_SHEET_IN);
  const sheetOut = workbook.addWorksheet(OUT_SHEET_OUT);
  sheetIn.getRow(1).values = headerValues as any;
  sheetOut.getRow(1).values = headerValues as any;
  sheetIn.getRow(1).font = { bold: true };
  sheetOut.getRow(1).font = { bold: true };

  let totalUrls = 0;
  let kept = 0;
  let discardedRange = 0;
  let noDate = 0;

  // Percorre a partir da linha logo após o header.
  for (let r = headerRow + 1; r <= source.rowCount; r++) {
    const row = source.getRow(r);
    const url = cellToText(row.getCell(linkCol).value).replace(/^'|'$/g, '').trim();
    if (!url) continue;
    totalUrls++;

    // Cópia dos valores da linha inteira.
    const rowValues: ExcelJS.CellValue[] = [];
    for (let c = 1; c <= source.columnCount; c++) {
      rowValues[c - 1] = row.getCell(c).value;
    }

    const date = extractDateFromUrl(url);
    if (date && inRange(date)) {
      sheetIn.addRow(rowValues);
      kept++;
    } else {
      sheetOut.addRow(rowValues);
      if (!date) noDate++;
      else discardedRange++;
    }
  }

  await workbook.xlsx.writeFile(filePath);

  console.log('─────────────── Resumo ───────────────');
  console.log(`🔢 URLs analisadas:        ${totalUrls}`);
  console.log(`✅ Dentro do range:        ${kept}  -> aba "${OUT_SHEET_IN}"`);
  console.log(`🗓️  Fora do range:          ${discardedRange}  -> aba "${OUT_SHEET_OUT}"`);
  console.log(`❓ Sem data na URL:        ${noDate}  -> aba "${OUT_SHEET_OUT}"`);
  console.log('──────────────────────────────────────');
  console.log(`💾 Salvo em: ${filePath}`);
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});

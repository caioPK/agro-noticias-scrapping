import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { config } from './config';
import { DataSource, ReadUrlsOptions } from './types';

/**
 * Converte letra de coluna para número (A=1, B=2, ..., Z=26, AA=27, etc.)
 */
function columnLetterToNumber(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * Converte número de coluna para letra (1=A, 2=B, ..., 27=AA).
 * Usado apenas para logging legível.
 */
function columnNumberToLetter(num: number): string {
  let result = '';
  let n = num;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode('A'.charCodeAt(0) + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Limite prático de caracteres por célula (Excel permite ~32767, folga aplicada). */
const MAX_CELL_LENGTH = 32000;

/** Quantas colunas de overflow no máximo (evita loop infinito em texto gigante). */
const MAX_OVERFLOW_COLUMNS = 20;

/**
 * Implementação do DataSource usando arquivo Excel local (.xlsx).
 *
 * O arquivo é lido ao chamar readUrls() e salvo após cada writeResult/writeError.
 * Suporta .xlsx (Excel 2007+).
 */
export class ExcelDataSource implements DataSource {
  private workbook: ExcelJS.Workbook | null = null;
  private filePath: string;
  private sheetName: string;

  constructor(customFilePath?: string, sheetName?: string) {
    this.filePath = customFilePath || config.excelFilePath;
    this.sheetName = sheetName || config.sheetName;
  }

  setSheetName(sheetName: string): void {
    this.sheetName = sheetName;
  }

  async listSheetNames(): Promise<string[]> {
    const workbook = await this.getWorkbook();
    return workbook.worksheets.map(ws => ws.name);
  }

  /**
   * Carrega o workbook do disco (lazy, apenas uma vez).
   */
  private async getWorkbook(): Promise<ExcelJS.Workbook> {
    if (this.workbook) return this.workbook;

    if (!fs.existsSync(this.filePath)) {
      throw new Error(
        `Arquivo Excel não encontrado: ${this.filePath}\n` +
        `Crie o arquivo ou ajuste EXCEL_FILE_PATH no .env.`
      );
    }

    this.workbook = new ExcelJS.Workbook();
    await this.workbook.xlsx.readFile(this.filePath);

    console.log(`✅ Arquivo Excel carregado: ${path.basename(this.filePath)}`);
    return this.workbook;
  }

  /**
   * Retorna a worksheet configurada.
   */
  private async getWorksheet(): Promise<ExcelJS.Worksheet> {
    const workbook = await this.getWorkbook();

    const worksheet = workbook.getWorksheet(this.sheetName);
    if (!worksheet) {
      const available = workbook.worksheets.map(ws => ws.name).join(', ');
      throw new Error(
        `Aba "${this.sheetName}" não encontrada no arquivo Excel.\n` +
        `Abas disponíveis: ${available}`
      );
    }

    return worksheet;
  }

  /**
   * Extrai o texto de uma célula, lidando com os vários formatos que o
   * ExcelJS pode devolver (string, hyperlink, rich text, fórmula).
   */
  private cellToText(value: ExcelJS.CellValue): string {
    return this.cellToRawText(value).trim();
  }

  /**
   * Igual a cellToText, mas sem trim — usado ao concatenar blocos de overflow,
   * onde o corte pode ter caído no meio de uma palavra ou num espaço.
   */
  private cellToRawText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';

    if (typeof value === 'object') {
      const obj = value as any;

      // Hyperlink: { text, hyperlink }
      if ('hyperlink' in obj) {
        return (obj.hyperlink || obj.text || '').toString();
      }
      // Rich text: { richText: [{ text }, ...] }
      if ('richText' in obj && Array.isArray(obj.richText)) {
        return obj.richText.map((rt: any) => rt.text).join('');
      }
      // Fórmula: { formula, result }
      if ('result' in obj) {
        return (obj.result ?? '').toString();
      }
      if ('text' in obj) {
        return obj.text.toString();
      }
    }

    return value.toString();
  }

  /**
   * Salva o workbook de volta ao disco.
   */
  private async save(): Promise<void> {
    if (!this.workbook) return;
    await this.workbook.xlsx.writeFile(this.filePath);
  }

  async readUrls(options: ReadUrlsOptions = {}): Promise<{ row: number; url: string }[]> {
    const worksheet = await this.getWorksheet();
    const urlCol = columnLetterToNumber(config.urlColumn.toUpperCase());
    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const results: { row: number; url: string }[] = [];

    const lastRow = worksheet.rowCount;
    let skipped = 0;

    for (let rowNum = config.startRow; rowNum <= lastRow; rowNum++) {
      let url = this.cellToText(worksheet.getCell(rowNum, urlCol).value);

      // Remove aspas simples do início e/ou do fim, se existirem
      url = url.replace(/^'|'$/g, '');

      if (!url) continue;

      // Pula linhas já processadas (coluna de output preenchida)
      if (options.skipFilled) {
        const existing = this.cellToText(worksheet.getCell(rowNum, outputCol).value);
        if (existing) {
          skipped++;
          continue;
        }
      }

      results.push({ row: rowNum, url });
    }

    if (options.skipFilled) {
      console.log(
        `⏭️  ${skipped} linhas puladas (coluna ${config.outputColumn.toUpperCase()} já preenchida)`
      );
    }
    console.log(`📋 ${results.length} URLs a processar no Excel (aba: ${this.sheetName})`);
    return results;
  }

  /**
   * Escreve o resultado, distribuindo o excedente em colunas de overflow.
   *
   * Layout (com OUTPUT_COLUMN=D):
   *   D → primeiro bloco de até MAX_CELL_LENGTH caracteres
   *   E → flag booleana de truncamento
   *   F, G, H, ... → blocos seguintes, na ordem
   */
  async writeResult(row: number, value: string, _truncated = false): Promise<void> {
    const worksheet = await this.getWorksheet();
    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const flagCol = outputCol + 1;
    const overflowStartCol = outputCol + 2;

    // Fatia o texto em blocos que caibam numa célula
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += MAX_CELL_LENGTH) {
      chunks.push(value.substring(i, i + MAX_CELL_LENGTH));
      if (chunks.length >= MAX_OVERFLOW_COLUMNS + 1) break;
    }
    if (chunks.length === 0) chunks.push('');

    // Se ainda sobrou texto além do limite de colunas, marca no último bloco
    const written = chunks.length * MAX_CELL_LENGTH;
    const hardTruncated = value.length > written;
    if (hardTruncated) {
      chunks[chunks.length - 1] += '\n\n[...TRUNCADO]';
    }

    // Bloco principal na coluna de output
    worksheet.getCell(row, outputCol).value = chunks[0];

    // Flag: houve overflow (texto continua em outras colunas)?
    worksheet.getCell(row, flagCol).value = chunks.length > 1;

    // Blocos seguintes nas colunas de overflow
    for (let i = 1; i < chunks.length; i++) {
      worksheet.getCell(row, overflowStartCol + i - 1).value = chunks[i];
    }

    // Limpa colunas de overflow remanescentes de uma execução anterior mais longa
    for (let i = chunks.length; i <= MAX_OVERFLOW_COLUMNS; i++) {
      const cell = worksheet.getCell(row, overflowStartCol + i - 1);
      if (cell.value !== null && cell.value !== undefined) {
        cell.value = null;
      }
    }

    await this.save();

    const outLetter = config.outputColumn.toUpperCase();
    if (chunks.length > 1) {
      const firstOverflow = columnNumberToLetter(overflowStartCol);
      const lastOverflow = columnNumberToLetter(overflowStartCol + chunks.length - 2);
      const overflowRange =
        firstOverflow === lastOverflow ? firstOverflow : `${firstOverflow}-${lastOverflow}`;
      console.log(
        `  📝 Resultado escrito em ${outLetter}${row} + overflow ${overflowRange}${row} ` +
        `(${chunks.length} blocos, ${value.length} chars)` +
        (hardTruncated ? ' ⚠️ TRUNCADO' : '')
      );
    } else {
      console.log(`  📝 Resultado escrito na célula ${outLetter}${row}`);
    }
  }

  async writeError(row: number, error: string): Promise<void> {
    const worksheet = await this.getWorksheet();
    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const overflowStartCol = outputCol + 2;

    worksheet.getCell(row, outputCol).value = `[ERRO] ${error}`;
    worksheet.getCell(row, outputCol + 1).value = false;

    // Limpa overflow de uma execução anterior bem-sucedida
    for (let i = 0; i < MAX_OVERFLOW_COLUMNS; i++) {
      const cell = worksheet.getCell(row, overflowStartCol + i);
      if (cell.value !== null && cell.value !== undefined) {
        cell.value = null;
      }
    }

    await this.save();

    console.log(`  ❌ Erro escrito na célula ${config.outputColumn.toUpperCase()}${row}`);
  }

  async readExportData(): Promise<{ row: number; url: string; content: string }[]> {
    const worksheet = await this.getWorksheet();
    const urlCol = columnLetterToNumber(config.urlColumn.toUpperCase());
    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const overflowStartCol = outputCol + 2;
    const results: { row: number; url: string; content: string }[] = [];

    const lastRow = worksheet.rowCount;
    let withOverflow = 0;

    for (let rowNum = config.startRow; rowNum <= lastRow; rowNum++) {
      let url = this.cellToText(worksheet.getCell(rowNum, urlCol).value);
      url = url.replace(/^'|'$/g, '');

      if (!url) continue;

      // Bloco principal + colunas de overflow (F, G, H, ...) concatenados.
      // Sem trim nas junções: o corte pode ter caído no meio de uma palavra.
      let content = this.cellToRawText(worksheet.getCell(rowNum, outputCol).value);
      let hasOverflow = false;

      for (let i = 0; i < MAX_OVERFLOW_COLUMNS; i++) {
        const raw = worksheet.getCell(rowNum, overflowStartCol + i).value;
        if (raw === null || raw === undefined || raw === '') break;

        const chunk = this.cellToRawText(raw);
        if (!chunk) break;

        content += chunk;
        hasOverflow = true;
      }

      content = content.trim();

      if (hasOverflow) withOverflow++;

      results.push({ row: rowNum, url, content });
    }

    console.log(`📋 ${results.length} registros (URLs + Conteúdo) carregados para exportação.`);
    if (withOverflow > 0) {
      console.log(`🔗 ${withOverflow} registros tiveram colunas de overflow concatenadas.`);
    }
    return results;
  }
}

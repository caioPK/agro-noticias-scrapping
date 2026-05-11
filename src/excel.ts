import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
import { config } from './config';
import { DataSource } from './types';

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
 * Implementação do DataSource usando arquivo Excel local (.xlsx).
 *
 * O arquivo é lido ao chamar readUrls() e salvo após cada writeResult/writeError.
 * Suporta .xlsx (Excel 2007+).
 */
export class ExcelDataSource implements DataSource {
  private workbook: ExcelJS.Workbook | null = null;
  private filePath: string;

  constructor(customFilePath?: string) {
    this.filePath = customFilePath || config.excelFilePath;
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

    const worksheet = workbook.getWorksheet(config.sheetName);
    if (!worksheet) {
      const available = workbook.worksheets.map(ws => ws.name).join(', ');
      throw new Error(
        `Aba "${config.sheetName}" não encontrada no arquivo Excel.\n` +
        `Abas disponíveis: ${available}`
      );
    }

    return worksheet;
  }

  /**
   * Salva o workbook de volta ao disco.
   */
  private async save(): Promise<void> {
    if (!this.workbook) return;
    await this.workbook.xlsx.writeFile(this.filePath);
  }

  async readUrls(): Promise<{ row: number; url: string }[]> {
    const worksheet = await this.getWorksheet();
    const colNumber = columnLetterToNumber(config.urlColumn.toUpperCase());
    const results: { row: number; url: string }[] = [];

    const lastRow = worksheet.rowCount;

    for (let rowNum = config.startRow; rowNum <= lastRow; rowNum++) {
      const cell = worksheet.getCell(rowNum, colNumber);
      const value = cell.value;

      let url = '';
      if (value !== null && value !== undefined) {
        // ExcelJS pode retornar hyperlinks como objetos { text, hyperlink }
        if (typeof value === 'object' && 'hyperlink' in (value as any)) {
          url = ((value as any).hyperlink || (value as any).text || '').toString().trim();
        } else if (typeof value === 'object' && 'text' in (value as any)) {
          url = (value as any).text.toString().trim();
        } else {
          url = value.toString().trim();
        }
      }

      // Remove aspas simples do início e/ou do fim, se existirem
      url = url.replace(/^'|'$/g, '');

      if (url) {
        results.push({ row: rowNum, url });
      }
    }

    console.log(`📋 ${results.length} URLs encontradas no Excel (aba: ${config.sheetName})`);
    return results;
  }

  async writeResult(row: number, value: string, truncated = false): Promise<void> {
    const worksheet = await this.getWorksheet();
    const colNumber = columnLetterToNumber(config.outputColumn.toUpperCase());

    worksheet.getCell(row, colNumber).value = value;
    worksheet.getCell(row, (colNumber + 1)).value = truncated;
    await this.save();

    console.log(`  📝 Resultado escrito na célula ${config.outputColumn}${row}`);
  }

  async writeError(row: number, error: string): Promise<void> {
    const worksheet = await this.getWorksheet();
    const colNumber = columnLetterToNumber(config.outputColumn.toUpperCase());

    worksheet.getCell(row, colNumber).value = `[ERRO] ${error}`;
    await this.save();

    console.log(`  ❌ Erro escrito na célula ${config.outputColumn}${row}`);
  }

  async readExportData(): Promise<{ row: number; url: string; content: string }[]> {
    const worksheet = await this.getWorksheet();
    const urlColNumber = columnLetterToNumber(config.urlColumn.toUpperCase());
    const outputColNumber = columnLetterToNumber(config.outputColumn.toUpperCase());
    const results: { row: number; url: string; content: string }[] = [];

    const lastRow = worksheet.rowCount;

    for (let rowNum = config.startRow; rowNum <= lastRow; rowNum++) {
      const urlCell = worksheet.getCell(rowNum, urlColNumber);
      const urlValue = urlCell.value;

      let url = '';
      if (urlValue !== null && urlValue !== undefined) {
        if (typeof urlValue === 'object' && 'hyperlink' in (urlValue as any)) {
          url = ((urlValue as any).hyperlink || (urlValue as any).text || '').toString().trim();
        } else if (typeof urlValue === 'object' && 'text' in (urlValue as any)) {
          url = (urlValue as any).text.toString().trim();
        } else {
          url = urlValue.toString().trim();
        }
      }

      url = url.replace(/^'|'$/g, '');

      const outputCell = worksheet.getCell(rowNum, outputColNumber);
      const content = outputCell.value ? outputCell.value.toString().trim() : '';

      if (url) {
        results.push({ row: rowNum, url, content });
      }
    }

    console.log(`📋 ${results.length} registros (URLs + Conteúdo) carregados para exportação.`);
    return results;
  }
}

import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { config } from './config';
import { DataSource, ReadUrlsOptions } from './types';

/** Limite prático de caracteres por célula no Google Sheets (máx. 50000). */
const MAX_CELL_LENGTH = 49000;

/** Quantas colunas de overflow no máximo. */
const MAX_OVERFLOW_COLUMNS = 20;

/** Converte letra de coluna para número (A=1, B=2, ..., AA=27). */
function columnLetterToNumber(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/** Converte número de coluna para letra (1=A, 2=B, ..., 27=AA). */
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

let sheetsClient: sheets_v4.Sheets | null = null;

/**
 * Autentica com a API do Google Sheets usando a Service Account
 * e retorna o cliente da Sheets API.
 */
async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;

  if (!config.spreadsheetId) {
    throw new Error(
      'SPREADSHEET_ID não configurado. Defina no arquivo .env.'
    );
  }

  if (!fs.existsSync(config.googleServiceAccountKeyPath)) {
    throw new Error(
      `Arquivo de credenciais não encontrado: ${config.googleServiceAccountKeyPath}\n` +
      'Baixe o JSON da Service Account no Google Cloud Console e salve no caminho configurado.'
    );
  }

  const keyFile = JSON.parse(
    fs.readFileSync(config.googleServiceAccountKeyPath, 'utf-8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();

  sheetsClient = google.sheets({
    version: 'v4',
    auth: authClient as any,
  });

  console.log('✅ Autenticado com Google Sheets API');
  return sheetsClient;
}

/**
 * Implementação do DataSource usando Google Sheets API.
 */
export class GoogleSheetsDataSource implements DataSource {
  private sheetName: string = config.sheetName;

  setSheetName(sheetName: string): void {
    this.sheetName = sheetName;
  }

  async listSheetNames(): Promise<string[]> {
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.get({
      spreadsheetId: config.spreadsheetId,
      fields: 'sheets.properties.title',
    });

    return (response.data.sheets || [])
      .map(s => s.properties?.title || '')
      .filter(Boolean);
  }

  async readUrls(options: ReadUrlsOptions = {}): Promise<{ row: number; url: string }[]> {
    const sheets = await getSheetsClient();

    const urlRange = `${this.sheetName}!${config.urlColumn}${config.startRow}:${config.urlColumn}`;
    const outputRange = `${this.sheetName}!${config.outputColumn}${config.startRow}:${config.outputColumn}`;

    const requests = [
      sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: urlRange }),
    ];
    if (options.skipFilled) {
      requests.push(
        sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: outputRange })
      );
    }

    const [urlResponse, outputResponse] = await Promise.all(requests);

    const rows = urlResponse.data.values || [];
    const outputRows = outputResponse?.data.values || [];
    const results: { row: number; url: string }[] = [];
    let skipped = 0;

    rows.forEach((row, index) => {
      const url = row[0]?.toString().trim();
      if (!url) return;

      if (options.skipFilled) {
        const existing = outputRows[index]?.[0]?.toString().trim();
        if (existing) {
          skipped++;
          return;
        }
      }

      results.push({
        row: config.startRow + index,
        url,
      });
    });

    if (options.skipFilled) {
      console.log(
        `⏭️  ${skipped} linhas puladas (coluna ${config.outputColumn.toUpperCase()} já preenchida)`
      );
    }
    console.log(`📋 ${results.length} URLs a processar (Google Sheets, aba: ${this.sheetName})`);
    return results;
  }

  /**
   * Escreve o resultado, distribuindo o excedente em colunas de overflow.
   *
   * Layout (com OUTPUT_COLUMN=D):
   *   D → primeiro bloco
   *   E → flag de overflow
   *   F, G, H, ... → blocos seguintes
   */
  async writeResult(row: number, value: string): Promise<void> {
    const sheets = await getSheetsClient();

    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const overflowStartCol = outputCol + 2;

    // Fatia o texto em blocos que caibam numa célula
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += MAX_CELL_LENGTH) {
      chunks.push(value.substring(i, i + MAX_CELL_LENGTH));
      if (chunks.length >= MAX_OVERFLOW_COLUMNS + 1) break;
    }
    if (chunks.length === 0) chunks.push('');

    const written = chunks.length * MAX_CELL_LENGTH;
    const hardTruncated = value.length > written;
    if (hardTruncated) {
      chunks[chunks.length - 1] += '\n\n[...TRUNCADO]';
    }

    // Monta uma linha contígua: [output, flag, overflow...] e preenche o
    // resto das colunas de overflow com '' para limpar execuções anteriores.
    const rowValues: any[] = [chunks[0], chunks.length > 1];
    for (let i = 1; i <= MAX_OVERFLOW_COLUMNS; i++) {
      rowValues.push(i < chunks.length ? chunks[i] : '');
    }

    const startLetter = config.outputColumn.toUpperCase();
    const endLetter = columnNumberToLetter(overflowStartCol + MAX_OVERFLOW_COLUMNS - 1);
    const range = `${this.sheetName}!${startLetter}${row}:${endLetter}${row}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowValues],
      },
    });

    if (chunks.length > 1) {
      const firstOverflow = columnNumberToLetter(overflowStartCol);
      const lastOverflow = columnNumberToLetter(overflowStartCol + chunks.length - 2);
      const overflowRange =
        firstOverflow === lastOverflow ? firstOverflow : `${firstOverflow}-${lastOverflow}`;
      console.log(
        `  📝 Resultado escrito em ${startLetter}${row} + overflow ${overflowRange}${row} ` +
        `(${chunks.length} blocos, ${value.length} chars)` +
        (hardTruncated ? ' ⚠️ TRUNCADO' : '')
      );
    } else {
      console.log(`  📝 Resultado escrito na célula ${startLetter}${row}`);
    }
  }

  async writeError(row: number, error: string): Promise<void> {
    const sheets = await getSheetsClient();

    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const overflowStartCol = outputCol + 2;

    // Grava o erro e limpa flag + overflow de execuções anteriores
    const rowValues: any[] = [`[ERRO] ${error}`, false];
    for (let i = 0; i < MAX_OVERFLOW_COLUMNS; i++) {
      rowValues.push('');
    }

    const startLetter = config.outputColumn.toUpperCase();
    const endLetter = columnNumberToLetter(overflowStartCol + MAX_OVERFLOW_COLUMNS - 1);

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: `${this.sheetName}!${startLetter}${row}:${endLetter}${row}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [rowValues],
      },
    });

    console.log(`  ❌ Erro escrito na célula ${startLetter}${row}`);
  }

  async readExportData(): Promise<{ row: number; url: string; content: string }[]> {
    const sheets = await getSheetsClient();

    const outputCol = columnLetterToNumber(config.outputColumn.toUpperCase());
    const overflowStartCol = outputCol + 2;

    // A coluna de URL pode estar antes ou depois da de output, então busca em
    // dois ranges: URLs, e o bloco contíguo [output .. último overflow].
    const urlRange = `${this.sheetName}!${config.urlColumn}${config.startRow}:${config.urlColumn}`;
    const outEndLetter = columnNumberToLetter(overflowStartCol + MAX_OVERFLOW_COLUMNS - 1);
    const outputRange =
      `${this.sheetName}!${config.outputColumn.toUpperCase()}${config.startRow}:` +
      `${outEndLetter}`;

    const [urlResponse, outputResponse] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: urlRange }),
      sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: outputRange })
    ]);

    const urlRows = urlResponse.data.values || [];
    const outputRows = outputResponse.data.values || [];
    const results: { row: number; url: string; content: string }[] = [];
    let withOverflow = 0;

    const maxLen = Math.max(urlRows.length, outputRows.length);

    for (let i = 0; i < maxLen; i++) {
      const url = urlRows[i]?.[0]?.toString().trim() || '';
      if (!url) continue;

      // Índice 0 = coluna de output, 1 = flag, 2+ = overflow (F, G, H, ...)
      const cells = outputRows[i] || [];
      let content = cells[0]?.toString() || '';
      let hasOverflow = false;

      for (let c = 2; c < cells.length; c++) {
        const chunk = cells[c]?.toString() || '';
        if (!chunk) break;
        content += chunk;
        hasOverflow = true;
      }

      if (hasOverflow) withOverflow++;

      results.push({
        row: config.startRow + i,
        url,
        content: content.trim()
      });
    }

    console.log(`📋 ${results.length} registros (URLs + Conteúdo) carregados do Google Sheets para exportação.`);
    if (withOverflow > 0) {
      console.log(`🔗 ${withOverflow} registros tiveram colunas de overflow concatenadas.`);
    }
    return results;
  }
}

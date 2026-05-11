import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { config } from './config';
import { DataSource } from './types';

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
  async readUrls(): Promise<{ row: number; url: string }[]> {
    const sheets = await getSheetsClient();

    const range = `${config.sheetName}!${config.urlColumn}${config.startRow}:${config.urlColumn}`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range,
    });

    const rows = response.data.values || [];
    const results: { row: number; url: string }[] = [];

    rows.forEach((row, index) => {
      const url = row[0]?.toString().trim();
      if (url) {
        results.push({
          row: config.startRow + index,
          url,
        });
      }
    });

    console.log(`📋 ${results.length} URLs encontradas na planilha (Google Sheets)`);
    return results;
  }

  async writeResult(row: number, value: string): Promise<void> {
    const sheets = await getSheetsClient();

    const cell = `${config.sheetName}!${config.outputColumn}${row}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: cell,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[value]],
      },
    });

    console.log(`  📝 Resultado escrito na célula ${cell}`);
  }

  async writeError(row: number, error: string): Promise<void> {
    const sheets = await getSheetsClient();

    const cell = `${config.sheetName}!${config.outputColumn}${row}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.spreadsheetId,
      range: cell,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[`[ERRO] ${error}`]],
      },
    });

    console.log(`  ❌ Erro escrito na célula ${cell}`);
  }

  async readExportData(): Promise<{ row: number; url: string; content: string }[]> {
    const sheets = await getSheetsClient();

    // Fetch both URL and OUTPUT columns. It's usually better to fetch the whole row range between them.
    // Assuming URL_COLUMN comes before OUTPUT_COLUMN or vice-versa, we can fetch A:Z and extract indices.
    // Or we can make two separate requests, but let's fetch a wide range to be safe.
    // To make it simple, we fetch URL_COLUMN and OUTPUT_COLUMN separately or together.
    // Since we don't know the exact order of columns, let's fetch them in two requests.
    const urlRange = `${config.sheetName}!${config.urlColumn}${config.startRow}:${config.urlColumn}`;
    const outputRange = `${config.sheetName}!${config.outputColumn}${config.startRow}:${config.outputColumn}`;

    const [urlResponse, outputResponse] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: urlRange }),
      sheets.spreadsheets.values.get({ spreadsheetId: config.spreadsheetId, range: outputRange })
    ]);

    const urlRows = urlResponse.data.values || [];
    const outputRows = outputResponse.data.values || [];
    const results: { row: number; url: string; content: string }[] = [];

    const maxLen = Math.max(urlRows.length, outputRows.length);

    for (let i = 0; i < maxLen; i++) {
      const url = urlRows[i]?.[0]?.toString().trim() || '';
      const content = outputRows[i]?.[0]?.toString().trim() || '';

      if (url) {
        results.push({
          row: config.startRow + i,
          url,
          content
        });
      }
    }

    console.log(`📋 ${results.length} registros (URLs + Conteúdo) carregados do Google Sheets para exportação.`);
    return results;
  }
}

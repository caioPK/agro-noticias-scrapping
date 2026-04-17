import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import { config } from './config';

let sheetsClient: sheets_v4.Sheets | null = null;

/**
 * Autentica com a API do Google Sheets usando a Service Account
 * e retorna o cliente da Sheets API.
 */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;

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
 * Lê as URLs da coluna configurada na planilha.
 * Retorna um array de objetos com o número da linha e a URL.
 */
export async function readUrls(): Promise<{ row: number; url: string }[]> {
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

  console.log(`📋 ${results.length} URLs encontradas na planilha`);
  return results;
}

/**
 * Escreve o resultado em uma célula específica da coluna de output.
 */
export async function writeResult(row: number, value: string): Promise<void> {
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

/**
 * Escreve um status de erro em uma célula específica.
 */
export async function writeError(row: number, error: string): Promise<void> {
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

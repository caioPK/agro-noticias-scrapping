import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export interface AppConfig {
  spreadsheetId: string;
  sheetName: string;
  urlColumn: string;
  outputColumn: string;
  startRow: number;
  googleServiceAccountKeyPath: string;
  pageTimeout: number;
  delayBetweenRequests: number;
  scrapersDir: string;
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não encontrada: ${key}`);
  }
  return value;
}

export const config: AppConfig = {
  spreadsheetId: getEnvOrThrow('SPREADSHEET_ID'),
  sheetName: process.env.SHEET_NAME || 'Sheet1',
  urlColumn: process.env.URL_COLUMN || 'A',
  outputColumn: process.env.OUTPUT_COLUMN || 'B',
  startRow: parseInt(process.env.START_ROW || '2', 10),
  googleServiceAccountKeyPath: path.resolve(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials.json'
  ),
  pageTimeout: parseInt(process.env.PAGE_TIMEOUT || '30000', 10),
  delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '2000', 10),
  scrapersDir: path.resolve(__dirname, '..', '..', 'scrapers'),
};

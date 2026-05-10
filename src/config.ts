import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export type DataSourceType = 'sheets' | 'excel';

export interface AppConfig {
  /** Fonte de dados: 'sheets' (Google Sheets API) ou 'excel' (arquivo local) */
  dataSource: DataSourceType;

  // ── Google Sheets ──────────────────────────────────────────
  spreadsheetId: string;
  googleServiceAccountKeyPath: string;

  // ── Excel Local ────────────────────────────────────────────
  /** Caminho para o arquivo Excel (.xlsx) */
  excelFilePath: string;

  // ── Comuns ─────────────────────────────────────────────────
  sheetName: string;
  urlColumn: string;
  outputColumn: string;
  startRow: number;
  pageTimeout: number;
  delayBetweenRequests: number;
  scrapersDir: string;
}

export const config: AppConfig = {
  dataSource: (process.env.DATA_SOURCE as DataSourceType) || 'excel',

  // Google Sheets (só obrigatório se DATA_SOURCE=sheets)
  spreadsheetId: process.env.SPREADSHEET_ID || '',
  googleServiceAccountKeyPath: path.resolve(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials.json'
  ),

  // Excel local
  excelFilePath: path.resolve(process.env.EXCEL_FILE_PATH || './data.xlsx'),

  // Comuns
  sheetName: process.env.SHEET_NAME || 'Sheet1',
  urlColumn: process.env.URL_COLUMN || 'A',
  outputColumn: process.env.OUTPUT_COLUMN || 'B',
  startRow: parseInt(process.env.START_ROW || '2', 10),
  pageTimeout: parseInt(process.env.PAGE_TIMEOUT || '30000', 10),
  delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '2000', 10),
  scrapersDir: path.resolve(__dirname, '..', 'scrapers'),
};

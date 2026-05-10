import { config } from './config';
import { DataSource } from './types';
import { GoogleSheetsDataSource } from './sheets';
import { ExcelDataSource } from './excel';

/**
 * Factory que cria o DataSource correto baseado na configuração.
 *
 * - DATA_SOURCE=sheets → Google Sheets API (requer credentials.json + SPREADSHEET_ID)
 * - DATA_SOURCE=excel  → Arquivo Excel local (requer EXCEL_FILE_PATH)
 */
export function createDataSource(): DataSource {
  switch (config.dataSource) {
    case 'sheets':
      console.log('📊 Fonte de dados: Google Sheets');
      return new GoogleSheetsDataSource();

    case 'excel':
      console.log(`📊 Fonte de dados: Excel local (${config.excelFilePath})`);
      return new ExcelDataSource();

    default:
      throw new Error(
        `DATA_SOURCE inválido: "${config.dataSource}". Use "sheets" ou "excel".`
      );
  }
}

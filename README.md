# 🕷️ Web Scraper — Google Sheets + Puppeteer

Script TypeScript que lê URLs de uma planilha Google Sheets, executa scrapers customizados por domínio usando Puppeteer e escreve os textos extraídos de volta na planilha.

## 📁 Estrutura do Projeto

```
web-scrap/
├── src/
│   ├── index.ts           # Ponto de entrada principal
│   ├── config.ts          # Configurações (variáveis de ambiente)
│   ├── sheets.ts          # Conexão e operações com Google Sheets
│   ├── scraper-loader.ts  # Carregamento dinâmico dos scrapers
│   └── types.ts           # Interfaces TypeScript
├── scrapers/              # 📂 SEUS SCRAPERS VÃO AQUI
│   ├── _default.ts        # Scraper fallback (extrai body.innerText)
│   └── example.com.ts     # Exemplo de scraper por domínio
├── .env.example           # Modelo de variáveis de ambiente
├── package.json
└── tsconfig.json
```

## 🚀 Setup Rápido

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar Service Account do Google Cloud

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie ou selecione um projeto
3. Ative a **Google Sheets API**
4. Vá em **IAM & Admin > Service Accounts**
5. Crie uma Service Account
6. Gere uma chave JSON e salve como `credentials.json` na raiz do projeto
7. **Compartilhe a planilha** com o email da Service Account (ex: `scraper@projeto.iam.gserviceaccount.com`)

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env`:

```env
SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
SHEET_NAME=Sheet1
URL_COLUMN=A
OUTPUT_COLUMN=B
START_ROW=2
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials.json
```

### 4. Executar

```bash
# Modo desenvolvimento (executa direto com ts-node)
npm run dev

# Ou compilar e rodar
npm run build
npm start
```

## 🔧 Criando Scrapers Customizados

Cada domínio pode ter seu próprio script de extração. O sistema resolve automaticamente qual scraper usar baseado no domínio da URL.

### Convenção de Nomes

| Arquivo                  | Usado para                           |
|--------------------------|--------------------------------------|
| `example.com.ts`         | Todas as URLs de `example.com`       |
| `blog.example.com.ts`    | Apenas `blog.example.com` (prioritário) |
| `_default.ts`            | Qualquer domínio sem scraper próprio |

### Ordem de Resolução

Para a URL `https://blog.example.com/post/123`:

1. ✅ `blog.example.com.ts` → mais específico
2. ⬇️ `example.com.ts` → domínio pai
3. ⬇️ `_default.ts` → fallback

### Template de Scraper

Crie um arquivo em `scrapers/<dominio>.ts`:

```typescript
import { Page } from 'puppeteer';

// Metadados opcionais
export const name = 'Meu Scraper';
export const description = 'Descrição do que este scraper extrai';

// Função OBRIGATÓRIA — deve ser export default
export default async function(page: Page): Promise<string> {
  // Aguardar um elemento carregar
  await page.waitForSelector('.conteudo-principal', { timeout: 10000 });

  // Extrair dados usando page.evaluate()
  const texto = await page.evaluate(() => {
    const titulo = document.querySelector('h1')?.textContent || '';
    const corpo = document.querySelector('.conteudo-principal')?.textContent || '';
    return `${titulo}\n\n${corpo}`;
  });

  return texto;
}
```

### Exemplos Avançados

#### Extrair tabela como CSV

```typescript
export default async function(page: Page): Promise<string> {
  await page.waitForSelector('table');

  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tr'));
    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      return cells.map(cell => cell.textContent?.trim()).join(',');
    }).join('\n');
  });
}
```

#### Aguardar conteúdo dinâmico (SPA)

```typescript
export default async function(page: Page): Promise<string> {
  // Esperar elemento renderizado por JavaScript
  await page.waitForFunction(
    () => document.querySelector('.dados-carregados') !== null,
    { timeout: 15000 }
  );

  return await page.evaluate(() => {
    return document.querySelector('.dados-carregados')!.textContent || '';
  });
}
```

#### Clicar antes de extrair

```typescript
export default async function(page: Page): Promise<string> {
  // Clicar em "Ver mais"
  await page.click('button.ver-mais');
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    return document.querySelector('.conteudo-expandido')?.textContent || '';
  });
}
```

#### Extrair múltiplos campos formatados

```typescript
export default async function(page: Page): Promise<string> {
  await page.waitForSelector('.produto');

  return await page.evaluate(() => {
    const nome = document.querySelector('.produto-nome')?.textContent?.trim();
    const preco = document.querySelector('.produto-preco')?.textContent?.trim();
    const desc = document.querySelector('.produto-desc')?.textContent?.trim();
    const disponivel = document.querySelector('.estoque')?.textContent?.includes('Disponível');

    return [
      `Nome: ${nome}`,
      `Preço: ${preco}`,
      `Descrição: ${desc}`,
      `Disponível: ${disponivel ? 'Sim' : 'Não'}`,
    ].join('\n');
  });
}
```

## 📋 Formato da Planilha

A planilha deve ter este formato (exemplo com cabeçalho na linha 1):

| A (URL)                        | B (Resultado)             |
|--------------------------------|---------------------------|
| https://example.com/page1      | *(preenchido pelo script)* |
| https://blog.example.com/post  | *(preenchido pelo script)* |
| https://outro-site.com/dados   | *(preenchido pelo script)* |

## ⚙️ Variáveis de Ambiente

| Variável                          | Padrão            | Descrição                                    |
|-----------------------------------|--------------------|----------------------------------------------|
| `SPREADSHEET_ID`                  | *(obrigatório)*    | ID da planilha Google Sheets                 |
| `SHEET_NAME`                      | `Sheet1`           | Nome da aba                                  |
| `URL_COLUMN`                      | `A`                | Coluna com as URLs                           |
| `OUTPUT_COLUMN`                   | `B`                | Coluna para escrever resultados              |
| `START_ROW`                       | `2`                | Linha inicial (2 = pula cabeçalho)           |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | `./credentials.json`| Caminho do JSON da Service Account          |
| `PAGE_TIMEOUT`                    | `30000`            | Timeout de carregamento (ms)                 |
| `DELAY_BETWEEN_REQUESTS`          | `2000`             | Delay entre requests (ms)                    |

## 🛠️ Scripts Disponíveis

```bash
npm run dev          # Executa em modo desenvolvimento
npm run build        # Compila TypeScript para JavaScript
npm start            # Executa a versão compilada
npm run scrapers:list # Lista scrapers disponíveis
```

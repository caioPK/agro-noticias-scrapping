import { extractDomain } from './scraper-loader';

/**
 * Remove tags HTML do texto (ex: <p>, <br>, <a href="...">)
 */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

/**
 * Sanitiza o texto de acordo com as regras do Iramuteq:
 * 1. Remove tags HTML.
 * 2. Converte para minúsculas.
 * 3. Substitui quebras de linha por espaço (um documento = um bloco).
 * 4. Substitui hifens por underline (_) conforme pedido do usuário (para unir palavras compostas).
 * 5. Remove aspas, aspas duplas, e outros caracteres de controle/símbolos indesejados.
 * 6. Mantém a pontuação básica (.,!?).
 * 7. Remove espaços múltiplos.
 */
export function sanitizeForIramuteq(text: string): string {
  if (!text) return '';

  let sanitized = text;

  // Remover a primeira linha antes de sanitizar se for o cabeçalho do corpus
  const lines = sanitized.split('\n');
  if (lines.length > 0 && lines[0].trim().startsWith('****')) {
    lines.shift();
    sanitized = lines.join('\n');
  }

  // 1. Remover tags HTML (caso tenham sobrado)
  sanitized = stripHtmlTags(sanitized);

  // 2. Converter para minúsculas
  sanitized = sanitized.toLowerCase();

  // 3. Remover aspas (simples, duplas, e variações tipográficas)
  sanitized = sanitized.replace(/["'“”‘’]/g, '');

  // 4. Substituir quebras de linha (CR/LF) e tabs por espaço
  sanitized = sanitized.replace(/[\r\n\t]+/g, ' ');

  // 5. Substituir hifens por underline (unir palavras)
  // Alguns casos podem ter travessões (— ou –), substituiremos por espaço, ou o hífen simples (-) por underline
  sanitized = sanitized.replace(/–|—/g, ' '); // En e Em dashes -> espaço
  sanitized = sanitized.replace(/-/g, '_');   // Hífen comum -> underline

  // 6. Remover caracteres especiais estranhos, mantendo letras, números, acentos, 
  // e a pontuação básica (. , ! ? ; : _ @ /)
  // Expressão regular que permite alfanuméricos com acentuação latina, espaços, sublinhado e pontuação
  sanitized = sanitized.replace(/[^\w\sÀ-ÿ.,!?;:\/@_]/g, ' ');

  // 7. Remover espaços duplos criados pelas substituições anteriores
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}

/**
 * Constrói a linha de cabeçalho do corpus para o Iramuteq.
 * Ex: **** *id_1 *dominio_exemplo_com
 */
export function buildCorpusLine(text: string): string {
  if (!text) return '**** *vazio';

  const firstLine = text.split('\n')[0].trim();
  
  if (firstLine.startsWith('****')) {
    return firstLine;
  }

  return `**** *sem_cabecalho`;
}

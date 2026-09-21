/**
 * ocr.js — un seul point d'appel pour le scan de ticket, comme prévu au
 * README ("architecture permettant de changer facilement de fournisseur").
 *
 * Implémentation par défaut : OCR.space (API REST simple, un essai
 * gratuit avec la clé de démo "helloworld", à remplacer par une vraie clé
 * dans VITE_OCR_API_KEY pour un usage réel — voir .env.example).
 *
 * RÈGLE ABSOLUE (§8) : cette fonction ne fait QUE proposer une lecture.
 * Rien n'est jamais enregistré tant que l'utilisateur n'a pas confirmé
 * (ou corrigé) le montant, la date et le commerçant dans ScanReceipt.jsx.
 */

const OCR_API_KEY = import.meta.env.VITE_OCR_API_KEY || 'helloworld';
const OCR_ENDPOINT = 'https://api.ocr.space/parse/image';

/**
 * @param {File} file - photo du ticket (depuis l'appareil photo ou la galerie)
 * @returns {Promise<{amount: number|null, date: string|null, merchant: string|null, rawText: string}>}
 */
export async function scanReceipt(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('apikey', OCR_API_KEY);
  formData.append('language', 'fre');
  formData.append('scale', 'true');
  formData.append('OCREngine', '2');

  const response = await fetch(OCR_ENDPOINT, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('ocr_request_failed');

  const result = await response.json();
  if (result.IsErroredOnProcessing) {
    throw new Error(result.ErrorMessage?.[0] || 'ocr_processing_failed');
  }

  const rawText = result.ParsedResults?.[0]?.ParsedText || '';
  return {
    amount: guessTotalAmount(rawText),
    date: guessDate(rawText),
    merchant: guessMerchant(rawText),
    rawText,
  };
}

/** Cherche la ligne la plus probable pour le TOTAL (souvent le plus grand montant précédé de "TOTAL"). */
function guessTotalAmount(text) {
  const lines = text.split('\n');
  const totalLineRegex = /total|à payer|montant/i;
  const amountRegex = /(\d{1,4}[.,]\d{2})\s*€?/;

  for (const line of lines) {
    if (totalLineRegex.test(line)) {
      const match = line.match(amountRegex);
      if (match) return parseFloat(match[1].replace(',', '.'));
    }
  }

  // Repli : le plus grand montant détecté dans tout le ticket.
  const allAmounts = [...text.matchAll(new RegExp(amountRegex, 'g'))].map((m) =>
    parseFloat(m[1].replace(',', '.'))
  );
  return allAmounts.length ? Math.max(...allAmounts) : null;
}

function guessDate(text) {
  const dateRegex = /(\d{2})[/.-](\d{2})[/.-](\d{2,4})/;
  const match = text.match(dateRegex);
  if (!match) return null;
  const [, day, month, yearRaw] = match;
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day}`;
}

function guessMerchant(text) {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 2 && !/^\d/.test(l));
  return firstLine || null;
}

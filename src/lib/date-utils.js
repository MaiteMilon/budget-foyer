/**
 * date-utils.js — petites fonctions pures partagées entre PrepareMonth.jsx
 * et Dashboard.jsx (bannière "Préparer [mois suivant]").
 */

/** "2026-09-01" → "Septembre 2026" */
export function monthLabel(monthDateISO) {
  const d = new Date(monthDateISO + 'T00:00:00');
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "2026-09-01" + 1 → "2026-10-01" (toujours le 1er du mois) */
export function addMonthsISO(monthDateISO, count) {
  const d = new Date(monthDateISO + 'T00:00:00');
  d.setMonth(d.getMonth() + count);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Nombre de jours restants dans le mois en cours, aujourd'hui inclus. */
export function daysRemainingInMonth(date = new Date()) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return lastDay - date.getDate() + 1;
}

/** true si on est dans les derniers `thresholdDays` jours du mois (par défaut 6). */
export function isNearMonthEnd(thresholdDays = 6, date = new Date()) {
  return daysRemainingInMonth(date) <= thresholdDays;
}

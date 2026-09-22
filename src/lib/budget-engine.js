/**
 * budget-engine.js
 * ----------------------------------------------------------------------
 * Moteur de calcul budgétaire PUR (aucune dépendance réseau / UI).
 * C'est le cœur du produit : répondre en permanence à
 *   "Combien puis-je encore dépenser ce mois-ci sans toucher à l'argent
 *    que j'ai décidé d'épargner ou de réserver ?"
 *
 * Règles clés implémentées :
 *  - §6  : budget disponible = revenus - épargne prévue - charges prévues
 *          - marge de sécurité, PUIS -= dépenses réelles.
 *  - §9  : une dépense ne baisse le budget PERSONNEL que si elle est payée
 *          depuis un compte perso (source_type = 'perso'). Une dépense
 *          payée depuis le compte joint ou une poche baisse le SOLDE de
 *          cette poche, jamais le budget perso une 2e fois.
 *  - §25 : un versement réel vers une poche (pocket_transfer) NE DOIT PAS
 *          re-diminuer le budget disponible : le montant est déjà réservé
 *          dès l'objectif du mois (planned_amount). Le transfert ne fait
 *          que déplacer l'étiquette "prévu -> versé", il ne touche pas au
 *          calcul du budget disponible.
 *
 * Toutes les fonctions sont pures : (données) -> résultat. Elles ne
 * savent rien de Supabase ; le code d'accès aux données (src/lib/data.js)
 * se contente de charger les lignes et de les passer ici.
 * ----------------------------------------------------------------------
 */

/**
 * @typedef {Object} BudgetMonthInput
 * @property {number} safetyMargin
 * @property {{amount:number}[]} incomes
 * @property {{plannedAmount:number}[]} savingsGoals   // uniquement les poches dont owner = cet utilisateur (perso + communes qu'il alimente)
 * @property {{amount:number}[]} fixedCharges           // occurrences du mois, perso + part commune attribuée à cet utilisateur
 * @property {{amount:number, sourceType:'perso'|'pocket'|'compte_joint', pocketUsageType?:'depense'|'epargne'}[]} expenses // dépenses payées PAR cet utilisateur
 */

/** Somme sûre (ignore NaN/undefined) */
function sum(list, pick) {
  return list.reduce((total, item) => {
    const v = Number(pick(item));
    return total + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * Calcule le budget d'un utilisateur pour un mois donné.
 * Retourne le détail complet affiché sur le Dashboard (§10).
 */
export function computeMonthlyBudget(input) {
  const totalIncome = sum(input.incomes, (i) => i.amount);
  const totalPlannedSavings = sum(input.savingsGoals, (g) => g.plannedAmount);
  const totalFixedCharges = sum(input.fixedCharges, (c) => c.amount);
  const safetyMargin = Number(input.safetyMargin) || 0;
  // Report du reste à dépenser du mois précédent (positif ou négatif) —
  // suggéré automatiquement à la préparation du mois suivant, toujours
  // modifiable ensuite (§ demande explicite "automatique mais modifiable").
  const carryoverAmount = Number(input.carryoverAmount) || 0;

  // Budget initial du mois = tout ce qui reste une fois le "prévu" réservé,
  // plus le report éventuel du mois précédent.
  // Important : on utilise planned_amount (l'objectif), PAS actual_paid_in
  // (le réellement versé) — l'argent est bloqué dès l'intention (§3).
  const initialBudget =
    totalIncome - totalPlannedSavings - totalFixedCharges - safetyMargin + carryoverAmount;

  // Compte pour le budget "reste à dépenser" : le compte perso, ET tout
  // compte de type "dépense" (pas de réservation préalable — dépenser
  // dedans, c'est dépenser tout court). Un compte de type "épargne" (dont
  // le compte joint) N'est jamais recompté ici : son montant est déjà
  // réservé en amont via l'objectif du mois (planned_amount) — le
  // dépenser ensuite ne fait que réduire son propre solde, pas re-toucher
  // ce budget (règle anti double-comptage, §9/§25). 'compte_joint' est
  // conservé pour compatibilité avec d'anciennes dépenses, traité comme
  // "épargne" au même titre.
  const personalExpenses = input.expenses.filter(
    (e) => e.sourceType === 'perso' || (e.sourceType === 'pocket' && e.pocketUsageType === 'depense')
  );
  const totalSpent = sum(personalExpenses, (e) => e.amount);

  const remaining = initialBudget - totalSpent;

  return {
    totalIncome,
    totalPlannedSavings,
    totalFixedCharges,
    safetyMargin,
    carryoverAmount,
    initialBudget,
    totalSpent,
    remaining,
    // Ratio pour la barre de progression du dashboard (0 à 1, clampé)
    spentRatio: initialBudget > 0 ? Math.min(1, Math.max(0, totalSpent / initialBudget)) : 0,
  };
}

/**
 * Calcule la progression d'un objectif d'épargne pour l'affichage
 * (§10 "Objectifs du mois" avec barres de progression).
 */
export function computeGoalProgress(goal) {
  const planned = Number(goal.plannedAmount) || 0;
  const paid = Number(goal.actualPaidIn) || 0;
  const remainingToPay = Math.max(0, planned - paid);
  const ratio = planned > 0 ? Math.min(1, paid / planned) : 0;
  return {
    planned,
    paid,
    remainingToPay,
    ratio,
    isComplete: planned > 0 && paid >= planned,
  };
}

/**
 * Applique une dépense au solde d'une poche si elle en provient (§9).
 * Retourne le nouveau solde ; ne fait AUCUN effet de bord — l'appelant
 * est responsable de persister la mise à jour.
 */
export function applyExpenseToPocketBalance(pocketBalance, expenseAmount) {
  return Number(pocketBalance) - Number(expenseAmount);
}

/**
 * Applique un versement réel (pocket_transfer) : augmente le solde de la
 * poche ET incrémente actual_paid_in de l'objectif du mois correspondant.
 * NE TOUCHE JAMAIS au budget disponible (déjà réservé, §25).
 */
export function applyPocketTransfer({ pocketBalance, goalActualPaidIn }, amount) {
  const value = Number(amount) || 0;
  return {
    newPocketBalance: Number(pocketBalance) + value,
    newGoalActualPaidIn: Number(goalActualPaidIn) + value,
  };
}

/**
 * Agrège deux budgets personnels (utilisateur 1 + utilisateur 2) en une
 * vue "Notre foyer" (§11).
 */
export function computeHouseholdView(budgetA, budgetB, pockets) {
  const totalSavingsBalance = sum(pockets, (p) => p.balance);
  return {
    totalIncome: budgetA.totalIncome + budgetB.totalIncome,
    totalSpent: budgetA.totalSpent + budgetB.totalSpent,
    totalPlannedSavings: budgetA.totalPlannedSavings + budgetB.totalPlannedSavings,
    totalSavingsBalance,
    remainingA: budgetA.remaining,
    remainingB: budgetB.remaining,
  };
}

/**
 * Simule l'effet d'un achat "envie" sur le reste disponible, pour le
 * message d'aide à la décision (§15) :
 *  "Si tu achètes cet article à 129 €, ton reste disponible passera de
 *   565 € à 436 €."
 */
export function simulateWishlistPurchase(currentRemaining, itemPrice) {
  const price = Number(itemPrice) || 0;
  return {
    before: currentRemaining,
    after: currentRemaining - price,
  };
}

/**
 * Calcule la date de fin de réflexion pour une envie d'achat (§15).
 * @param {'none'|'24h'|'48h'|'72h'|'7d'} delay
 * @param {Date} [from]
 */
export function computeReflectUntil(delay, from = new Date()) {
  const hoursByDelay = { none: 0, '24h': 24, '48h': 48, '72h': 72, '7d': 24 * 7 };
  const hours = hoursByDelay[delay] ?? 0;
  if (hours === 0) return null;
  return new Date(from.getTime() + hours * 3600 * 1000);
}

/**
 * Répartit un achat en plusieurs fois sur `count` mensualités, à partir de
 * `startDateISO` (date exacte de la première échéance, ex. "2026-09-18" —
 * accepte aussi juste "2026-09-01" pour démarrer au 1er du mois). On peut
 * fournir soit le montant TOTAL, soit le montant MENSUEL — l'autre est
 * déduit. Le dernier versement absorbe l'écart d'arrondi pour que la somme
 * des mensualités retombe exactement sur le montant total (jamais 0,01 €
 * qui manque à l'appel).
 *
 * @param {{totalAmount?: number, monthlyAmount?: number, count: number, startDateISO?: string, startMonthISO?: string}} input
 * @returns {{index: number, amount: number, dueDate: string, month: string}[]}
 */
export function computeInstallmentSchedule({ totalAmount, monthlyAmount, count, startDateISO, startMonthISO }) {
  const baseDateISO = startDateISO || startMonthISO;
  const n = Math.max(1, Math.round(count));
  let total, perMonth;

  if (totalAmount != null) {
    total = round2(totalAmount);
    perMonth = round2(total / n);
  } else {
    perMonth = round2(monthlyAmount);
    total = round2(perMonth * n);
  }

  const schedule = [];
  let runningTotal = 0;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const amount = isLast ? round2(total - runningTotal) : perMonth;
    runningTotal = round2(runningTotal + amount);
    const dueDate = addMonthsClamped(baseDateISO, i);
    schedule.push({ index: i + 1, amount, dueDate, month: firstOfMonth(dueDate) });
  }
  return schedule;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Ajoute `count` mois à une date ISO, en calant sur le dernier jour du mois cible si besoin (ex. 31 janvier + 1 mois -> 28/29 février, jamais mars). */
function addMonthsClamped(dateISO, count) {
  const d = new Date(dateISO + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1); // évite le débordement automatique de setMonth sur les jours 29-31
  d.setMonth(d.getMonth() + count);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth(dateISO) {
  return dateISO.slice(0, 7) + '-01';
}

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
 * @property {{amount:number, sourceType:'perso'|'compte_joint'|'pocket'}[]} expenses // dépenses payées PAR cet utilisateur
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

  // Budget initial du mois = tout ce qui reste une fois le "prévu" réservé.
  // Important : on utilise planned_amount (l'objectif), PAS actual_paid_in
  // (le réellement versé) — l'argent est bloqué dès l'intention (§3).
  const initialBudget =
    totalIncome - totalPlannedSavings - totalFixedCharges - safetyMargin;

  // Seules les dépenses payées depuis un compte PERSO diminuent ce budget.
  // Les dépenses payées depuis le compte joint ou une poche d'épargne
  // diminuent le solde de cette poche, pas ce budget (§9).
  const personalExpenses = input.expenses.filter((e) => e.sourceType === 'perso');
  const totalSpent = sum(personalExpenses, (e) => e.amount);

  const remaining = initialBudget - totalSpent;

  return {
    totalIncome,
    totalPlannedSavings,
    totalFixedCharges,
    safetyMargin,
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

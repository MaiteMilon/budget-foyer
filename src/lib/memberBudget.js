import {
  getBudgetMonthForUser,
  getMonthIncomes,
  getMonthTotalPlannedSavings,
  getMonthFixedCharges,
  getMonthExpenses,
} from './data.js';
import { computeMonthlyBudget } from './budget-engine.js';

/** Charge le budget calculé d'un membre du foyer pour ce mois, ou null s'il n'a rien préparé. */
export async function loadMemberBudget(member, monthISO) {
  const month = await getBudgetMonthForUser(member.id, monthISO);
  if (!month) return { member, month: null, budget: null };

  const [incomes, totalPlannedSavings, charges, expenses] = await Promise.all([
    getMonthIncomes(month.id),
    // Le VRAI total, objectifs privés inclus, même si "qui consulte"
    // n'a pas le droit de voir le détail de ces comptes (§ correctif
    // "Budget initial" gonflé quand l'autre membre du foyer regarde).
    getMonthTotalPlannedSavings(month.id),
    getMonthFixedCharges(month.id),
    getMonthExpenses(month.id, member.id),
  ]);

  const budget = computeMonthlyBudget({
    safetyMargin: month.safety_margin,
    carryoverAmount: month.carryover_amount,
    incomes,
    savingsGoals: [{ plannedAmount: totalPlannedSavings }],
    fixedCharges: charges,
    expenses: expenses.map((e) => ({ amount: e.amount, sourceType: e.source_type, pocketUsageType: e.source_pocket?.usage_type })),
  });

  return { member, month, budget };
}

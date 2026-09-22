import {
  getBudgetMonthForUser,
  getMonthIncomes,
  getMonthSavingsGoals,
  getMonthFixedCharges,
  getMonthExpenses,
} from './data.js';
import { computeMonthlyBudget } from './budget-engine.js';

/** Charge le budget calculé d'un membre du foyer pour ce mois, ou null s'il n'a rien préparé. */
export async function loadMemberBudget(member, monthISO) {
  const month = await getBudgetMonthForUser(member.id, monthISO);
  if (!month) return { member, month: null, budget: null };

  const [incomes, goals, charges, expenses] = await Promise.all([
    getMonthIncomes(month.id),
    getMonthSavingsGoals(month.id),
    getMonthFixedCharges(month.id),
    getMonthExpenses(month.id, member.id),
  ]);

  const budget = computeMonthlyBudget({
    safetyMargin: month.safety_margin,
    incomes,
    savingsGoals: goals.map((g) => ({ plannedAmount: g.planned_amount })),
    fixedCharges: charges,
    expenses: expenses.map((e) => ({ amount: e.amount, sourceType: e.source_type, pocketUsageType: e.source_pocket?.usage_type })),
  });

  return { member, month, budget };
}

import { supabase } from './supabaseClient.js';
import { applyPocketTransfer } from './budget-engine.js';

/**
 * transfers.js — le "réellement versé" du §3 du cahier des charges.
 *
 * Règle anti double-comptage (§25) : cette fonction ne touche JAMAIS au
 * budget disponible. L'argent a déjà été réservé dès la préparation du
 * mois via `savings_goals.planned_amount` (voir budget-engine.js,
 * `computeMonthlyBudget` ne lit que planned_amount, jamais actual_paid_in
 * ni le solde des poches). Enregistrer un versement met seulement à jour
 * deux choses : le solde réel de la poche, et le curseur "versé" de
 * l'objectif du mois (pour les barres de progression) — jamais le calcul
 * du reste à dépenser.
 */
export async function recordPocketTransfer({ householdId, userId, budgetMonthId, pocket, amount }) {
  const { data: goal, error: goalError } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('budget_month_id', budgetMonthId)
    .eq('pocket_id', pocket.id)
    .maybeSingle();
  if (goalError) throw goalError;

  const { newPocketBalance, newGoalActualPaidIn } = applyPocketTransfer(
    { pocketBalance: pocket.balance, goalActualPaidIn: goal?.actual_paid_in || 0 },
    amount
  );

  const { error: transferError } = await supabase.from('pocket_transfers').insert({
    household_id: householdId,
    user_id: userId,
    pocket_id: pocket.id,
    budget_month_id: budgetMonthId,
    amount,
  });
  if (transferError) throw transferError;

  const { error: balanceError } = await supabase
    .from('savings_pockets')
    .update({ balance: newPocketBalance })
    .eq('id', pocket.id);
  if (balanceError) throw balanceError;

  if (goal) {
    const { error } = await supabase
      .from('savings_goals')
      .update({ actual_paid_in: newGoalActualPaidIn })
      .eq('id', goal.id);
    if (error) throw error;
  } else {
    // Verser sans objectif préalable reste possible (ex. dépôt spontané) —
    // on crée alors un objectif à 0 € prévu, pour que le "versé" apparaisse
    // quand même dans les barres de progression du Dashboard.
    const { error } = await supabase.from('savings_goals').insert({
      budget_month_id: budgetMonthId,
      pocket_id: pocket.id,
      planned_amount: 0,
      actual_paid_in: newGoalActualPaidIn,
    });
    if (error) throw error;
  }

  if (!pocket.is_private) {
    await supabase.from('household_activity_log').insert({
      household_id: householdId,
      actor_id: userId,
      kind: 'pocket_transfer',
      message: `${Number(amount).toFixed(2)} € versés dans ${pocket.name}.`,
    });
  }

  return { newPocketBalance, newGoalActualPaidIn };
}

import { supabase } from './supabaseClient.js';

/**
 * savingsGoalTemplates.js — gabarit du versement d'épargne habituel d'une
 * personne sur un compte (§ demande : "on le met déjà, mais on ne le met
 * pas ce mois-ci"). Même principe que charges.js/income.js : un montant
 * qui persiste d'un mois à l'autre, avec une case "actif" pour suspendre
 * un mois précis sans jamais effacer le montant habituel.
 */

/** Mes gabarits, indexés par pocket_id. */
export async function getMyRecurringGoals(userId) {
  const { data, error } = await supabase
    .from('recurring_savings_goals')
    .select('*')
    .eq('owner_id', userId);
  if (error) throw error;
  const map = new Map();
  data.forEach((g) => map.set(g.pocket_id, g));
  return map;
}

/** Crée ou met à jour mon gabarit pour ce compte (montant habituel + actif). */
export async function upsertRecurringGoal({ householdId, userId, pocketId, defaultAmount, isActive }) {
  const { data, error } = await supabase
    .from('recurring_savings_goals')
    .upsert(
      { household_id: householdId, owner_id: userId, pocket_id: pocketId, default_amount: defaultAmount, is_active: isActive },
      { onConflict: 'owner_id,pocket_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

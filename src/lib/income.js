import { supabase } from './supabaseClient.js';

/**
 * income.js — support de données pour l'écran Revenus.jsx.
 *
 * Un revenu est toujours PERSONNEL (pas de notion de "commune" comme pour
 * les charges). Deux formes :
 *  - FIXE : un gabarit dans `recurring_incomes`, suggéré automatiquement
 *    chaque mois tant qu'il est actif — géré ici (créer/modifier/
 *    désactiver/supprimer), sur le même principe que charges.js.
 *  - PONCTUEL : pas de gabarit, une simple ligne ajoutée une fois dans
 *    `incomes` pour le mois en cours (voir addPonctualIncome).
 */

/** Tous les revenus fixes du foyer, siens et ceux de l'autre membre — transparence entre les deux, comme pour les charges. */
export async function getMyRecurringIncomes(householdId) {
  const { data, error } = await supabase
    .from('recurring_incomes')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Gabarits actifs, pour la suggestion automatique dans Préparer mon mois. */
export async function getActiveRecurringIncomes(userId) {
  const { data, error } = await supabase
    .from('recurring_incomes')
    .select('*')
    .eq('owner_id', userId)
    .eq('is_active', true);
  if (error) throw error;
  return data;
}

/** Entrées du mois en cours issues d'un gabarit, indexées par recurring_income_id. */
export async function getCurrentMonthEntriesByIncome(budgetMonthId) {
  const { data, error } = await supabase
    .from('incomes')
    .select('*')
    .eq('budget_month_id', budgetMonthId)
    .not('recurring_income_id', 'is', null);
  if (error) throw error;
  const map = new Map();
  data.forEach((entry) => map.set(entry.recurring_income_id, entry));
  return map;
}

export async function createRecurringIncome(income) {
  const { data, error } = await supabase.from('recurring_incomes').insert(income).select().single();
  if (error) throw error;
  return data;
}

/** Modifie le gabarit : impacte ce mois ET les mois futurs pas encore préparés. */
export async function updateRecurringIncomeTemplate(id, patch) {
  const { data, error } = await supabase
    .from('recurring_incomes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Supprime le gabarit. Les entrées déjà générées (mois passés/en cours) restent, juste détachées. */
export async function deleteRecurringIncomeTemplate(id) {
  const { error } = await supabase.from('recurring_incomes').delete().eq('id', id);
  if (error) throw error;
}

/** Applique un gabarit au mois EN COURS uniquement, sans toucher aux autres mois. */
export async function upsertCurrentMonthIncomeEntry(budgetMonthId, template, { amount, label, kind }) {
  const { data: existing } = await supabase
    .from('incomes')
    .select('id')
    .eq('budget_month_id', budgetMonthId)
    .eq('recurring_income_id', template.id)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('incomes')
      .update({ label, kind, amount })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('incomes')
    .insert({ budget_month_id: budgetMonthId, recurring_income_id: template.id, label, kind, amount })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Retire un revenu fixe du mois EN COURS uniquement (désactivation) — les autres mois ne sont pas touchés. */
export async function removeCurrentMonthIncomeEntry(budgetMonthId, recurringIncomeId) {
  const { error } = await supabase
    .from('incomes')
    .delete()
    .eq('budget_month_id', budgetMonthId)
    .eq('recurring_income_id', recurringIncomeId);
  if (error) throw error;
}

/** Revenu PONCTUEL : une simple ligne pour ce mois, aucun gabarit créé. */
export async function addPonctualIncome(budgetMonthId, { label, kind, amount }) {
  const { data, error } = await supabase
    .from('incomes')
    .insert({ budget_month_id: budgetMonthId, label, kind, amount, recurring_income_id: null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

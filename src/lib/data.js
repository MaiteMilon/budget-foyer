import { supabase } from './supabaseClient.js';

/**
 * data.js — toutes les requêtes Supabase du MVP. Regroupées ici pour que
 * les composants restent des vues pures et que le moteur de calcul
 * (budget-engine.js) reste testable sans réseau.
 */

export async function getCurrentProfile() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function getHouseholdMembers(householdId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
}

/** Récupère (ou crée si absent) le mois budgétaire d'un utilisateur. */
export async function getOrCreateBudgetMonth(householdId, userId, monthDate) {
  const { data: existing, error: readError } = await supabase
    .from('budget_months')
    .select('*')
    .eq('user_id', userId)
    .eq('month', monthDate)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('budget_months')
    .insert({ household_id: householdId, user_id: userId, month: monthDate })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

/**
 * Lecture SEULE du mois budgétaire d'un utilisateur (typiquement le
 * d'un autre membre, pour la vue "Notre foyer") — ne crée jamais de mois pour
 * quelqu'un d'autre ; retourne null si ce membre n'a encore rien préparé.
 */
export async function getBudgetMonthForUser(userId, monthDate) {
  const { data, error } = await supabase
    .from('budget_months')
    .select('*')
    .eq('user_id', userId)
    .eq('month', monthDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMonthIncomes(budgetMonthId) {
  const { data, error } = await supabase
    .from('incomes')
    .select('*')
    .eq('budget_month_id', budgetMonthId);
  if (error) throw error;
  return data;
}

export async function getMonthSavingsGoals(budgetMonthId) {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*, pocket:savings_pockets(*)')
    .eq('budget_month_id', budgetMonthId);
  if (error) throw error;
  return data;
}

export async function getMonthFixedCharges(budgetMonthId) {
  const { data, error } = await supabase
    .from('fixed_charge_entries')
    .select('*')
    .eq('budget_month_id', budgetMonthId);
  if (error) throw error;
  return data;
}

export async function getMonthExpenses(budgetMonthId, paidBy) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, source_pocket:savings_pockets(id, name, icon, usage_type)')
    .eq('budget_month_id', budgetMonthId)
    .eq('paid_by', paidBy)
    .order('spent_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getHouseholdPockets(householdId) {
  const { data, error } = await supabase
    .from('savings_pockets')
    .select('*')
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
}

export async function addPocket(pocket) {
  const { data, error } = await supabase.from('savings_pockets').insert(pocket).select().single();
  if (error) throw error;
  return data;
}

/**
 * Supprime une poche. Aucune validation croisée de l'autre membre n'est
 * demandée (poche commune modifiable/suppressible à égalité par les deux
 * membres) — seule une confirmation de la personne qui agit est requise,
 * et c'est à l'UI de l'afficher juste avant cet appel (window.confirm ou
 * une modale). La trace "qui / quand" est journalisée automatiquement en
 * base par le déclencheur `trg_log_pockets` (voir schema.sql).
 */
export async function deletePocket(pocketId) {
  const { error } = await supabase.from('savings_pockets').delete().eq('id', pocketId);
  if (error) throw error;
}

export async function deleteFixedCharge(chargeId) {
  const { error } = await supabase.from('fixed_charges').delete().eq('id', chargeId);
  if (error) throw error;
}

/**
 * Ajoute une dépense. Si elle provient d'une poche (compte joint / tirelire
 * / épargne), décrémente aussi son solde dans la même opération logique
 * (deux requêtes ; à terme, à déplacer dans une fonction Postgres
 * transactionnelle `add_expense_and_debit_pocket` pour l'atomicité).
 */
export async function addExpense(expense) {
  const { data, error } = await supabase.from('expenses').insert(expense).select().single();
  if (error) throw error;

  if (expense.source_type !== 'perso' && expense.source_pocket_id) {
    const { error: rpcError } = await supabase.rpc('decrement_pocket_balance', {
      pocket_id: expense.source_pocket_id,
      delta: expense.amount,
    });
    if (rpcError) throw rpcError;
  }

  await supabase.from('household_activity_log').insert({
    household_id: expense.household_id,
    actor_id: expense.paid_by,
    kind: 'expense_added',
    message: `Une dépense de ${expense.amount.toFixed(2)} € a été ajoutée.`,
  });

  return data;
}

/** Envies d'achat en attente — toujours filtrées par owner_id = utilisateur courant (RLS + belt-and-braces côté client). */
export async function getMyWishlist(userId) {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .eq('owner_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addWishlistItem(item) {
  const { data, error } = await supabase.from('wishlist_items').insert(item).select().single();
  if (error) throw error;
  return data;
}

/** Marque une envie comme achetée et la relie à la dépense (ou au 1er versement de l'échéancier) qui en résulte. */
export async function markWishlistPurchased(itemId, resultingExpenseId) {
  const { error } = await supabase
    .from('wishlist_items')
    .update({ status: 'purchased', resulting_expense_id: resultingExpenseId || null })
    .eq('id', itemId);
  if (error) throw error;
}

/** Retire une envie de la liste sans jamais l'acheter (ex. "je n'en veux plus"). */
export async function dismissWishlistItem(itemId) {
  const { error } = await supabase
    .from('wishlist_items')
    .update({ status: 'dismissed' })
    .eq('id', itemId);
  if (error) throw error;
}

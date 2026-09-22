import { supabase } from './supabaseClient.js';

/**
 * charges.js — support de données pour l'écran Charges.jsx.
 *
 * Modèle : `fixed_charges` est l'objet CHARGE lui-même (autonome, créé/
 * modifié/supprimé depuis cet écran, indépendamment de "Préparer mon
 * mois"). `fixed_charge_entries` reste l'occurrence pour un mois donné —
 * c'est elle qui compte réellement dans le calcul du budget de ce mois
 * (budget-engine.js) et qui constitue l'historique des mois passés.
 *
 * Règle protégée partout ici : modifier ou supprimer une charge ne
 * touche JAMAIS les entrées des mois AUTRES que le mois en cours (ON
 * DELETE SET NULL sur fixed_charge_entries.fixed_charge_id préserve même
 * le montant historique d'un mois passé si son gabarit est supprimé).
 */

/** Charges visibles par cet utilisateur : les siennes + les communes (jamais les charges personnelles de l'autre membre). */
/** Toutes les charges du foyer, siennes et celles de l'autre membre — l'app est transparente entre les deux (sauf éléments explicitement privés : comptes, projets, envies d'achat). */
export async function getMyCharges(householdId, userId) {
  const { data, error } = await supabase
    .from('fixed_charges')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Entrées du mois en cours, indexées par fixed_charge_id, pour afficher/éditer la valeur réellement appliquée ce mois-ci. */
export async function getCurrentMonthEntriesByCharge(budgetMonthId) {
  const { data, error } = await supabase
    .from('fixed_charge_entries')
    .select('*')
    .eq('budget_month_id', budgetMonthId)
    .not('fixed_charge_id', 'is', null);
  if (error) throw error;
  const map = new Map();
  data.forEach((entry) => map.set(entry.fixed_charge_id, entry));
  return map;
}

export async function createCharge(charge) {
  const { data, error } = await supabase.from('fixed_charges').insert(charge).select().single();
  if (error) throw error;
  return data;
}

/** Modifie le gabarit lui-même : impacte ce mois ET tous les mois futurs qui n'ont pas encore été préparés. */
export async function updateChargeTemplate(chargeId, patch) {
  const { data, error } = await supabase
    .from('fixed_charges')
    .update(patch)
    .eq('id', chargeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Supprime le gabarit. Les entrées déjà générées pour des mois passés ou
 * en cours ne sont PAS supprimées (ON DELETE SET NULL) : elles gardent
 * leur montant, seule la suggestion pour les mois futurs disparaît.
 */
export async function deleteChargeTemplate(chargeId) {
  const { error } = await supabase.from('fixed_charges').delete().eq('id', chargeId);
  if (error) throw error;
}

/**
 * Applique une charge au mois EN COURS uniquement (crée ou met à jour son
 * entrée dans fixed_charge_entries), sans toucher au gabarit ni aux
 * autres mois. C'est le mécanisme derrière "Modifier uniquement ce mois"
 * et derrière la mise à jour immédiate du budget quand on ajoute/édite
 * une charge en cours de mois.
 */
export async function upsertCurrentMonthEntry(budgetMonthId, charge, { amount, label, category, dueDate, sourcePocketId }) {
  const { data: existing } = await supabase
    .from('fixed_charge_entries')
    .select('id')
    .eq('budget_month_id', budgetMonthId)
    .eq('fixed_charge_id', charge.id)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('fixed_charge_entries')
      .update({ label, category, amount, due_date: dueDate, source_pocket_id: sourcePocketId ?? null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('fixed_charge_entries')
    .insert({
      budget_month_id: budgetMonthId,
      fixed_charge_id: charge.id,
      label,
      category,
      amount,
      due_date: dueDate,
      source_pocket_id: sourcePocketId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Coche/décoche une charge comme réellement payée. Ne touche JAMAIS au
 * budget disponible (déjà réservé via la charge elle-même) — décompte
 * uniquement, si un compte est associé, le solde réel de ce compte, dans
 * un sens ou dans l'autre selon l'état visé. Même principe que le
 * "réellement versé" de l'épargne (§3) : prévu ≠ effectif.
 */
export async function setEntryPaid(entry, isPaid) {
  const { error } = await supabase
    .from('fixed_charge_entries')
    .update({ is_paid: isPaid })
    .eq('id', entry.id);
  if (error) throw error;

  if (entry.source_pocket_id) {
    const delta = isPaid ? Number(entry.amount) : -Number(entry.amount);
    const { error: rpcError } = await supabase.rpc('decrement_pocket_balance', {
      pocket_id: entry.source_pocket_id,
      delta,
    });
    if (rpcError) throw rpcError;
  }
}

/** Retire une charge du mois EN COURS uniquement (désactivation) — les autres mois ne sont pas touchés. */
export async function removeCurrentMonthEntry(budgetMonthId, chargeId) {
  const { error } = await supabase
    .from('fixed_charge_entries')
    .delete()
    .eq('budget_month_id', budgetMonthId)
    .eq('fixed_charge_id', chargeId);
  if (error) throw error;
}

/**
 * Journalise manuellement une action sur une charge COMMUNE quand elle ne
 * passe pas par une modification du gabarit (ex. "ce mois uniquement"),
 * donc pas couverte par le déclencheur SQL `trg_log_fixed_charges` qui
 * n'observe que la table `fixed_charges`.
 */
export async function logSharedChargeAction(householdId, actorId, message) {
  await supabase.from('household_activity_log').insert({
    household_id: householdId,
    actor_id: actorId,
    kind: 'fixed_charges_entry_update',
    message,
  });
}

import { supabase } from './supabaseClient.js';

/**
 * month-prep.js — support de données pour PrepareMonth.jsx.
 *
 * Principe de sauvegarde : les revenus et les charges d'un mois donné
 * n'ont aucune clé étrangère venant des dépenses (`expenses` ne référence
 * que `budget_month_id`, jamais une ligne de revenu ou de charge). On
 * peut donc les remplacer entièrement (delete-then-insert) à chaque
 * sauvegarde de cet écran sans jamais perdre une dépense déjà enregistrée
 * — c'est la garantie demandée : "revenir modifier la préparation du mois
 * en cours [...] sans perdre les dépenses déjà enregistrées".
 */

/** Le mois budgétaire précédent de cet utilisateur (pour pré-remplir), s'il existe. */
export async function getPreviousBudgetMonth(userId, monthDateISO) {
  const { data, error } = await supabase
    .from('budget_months')
    .select('*')
    .eq('user_id', userId)
    .lt('month', monthDateISO)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Gabarits de charges récurrentes visibles par cet utilisateur (les siennes + les communes). */
export async function getRecurringChargeTemplates(householdId, userId) {
  const { data, error } = await supabase
    .from('fixed_charges')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_recurring', true)
    .eq('is_active', true)
    .or(`is_shared.eq.true,owner_id.eq.${userId}`);
  if (error) throw error;
  return data;
}

/**
 * Sauvegarde complète de la préparation du mois, en une suite d'opérations
 * scopées au SEUL budget_month_id concerné (jamais aux dépenses).
 *
 * @param {object} args
 * @param {string} args.budgetMonthId
 * @param {number} args.safetyMargin
 * @param {{kind:string,label:string,amount:number}[]} args.incomes
 * @param {{label:string,category:string,amount:number,isRecurring:boolean,fixedChargeId:string|null,dueDate:string|null}[]} args.chargeEntries
 * @param {{pocketId:string, plannedAmount:number}[]} args.savingsGoals
 * @param {string} args.householdId
 * @param {string} args.userId
 * @param {boolean} args.markStarted - passe started_at à maintenant si ce n'est pas déjà fait
 */
export async function saveMonthPreparation({
  budgetMonthId,
  safetyMargin,
  incomes,
  chargeEntries,
  savingsGoals,
  householdId,
  userId,
  markStarted,
}) {
  // 1. Revenus : remplacement complet, propre à ce mois.
  const { error: delIncomesError } = await supabase
    .from('incomes')
    .delete()
    .eq('budget_month_id', budgetMonthId);
  if (delIncomesError) throw delIncomesError;

  if (incomes.length > 0) {
    const { error: insIncomesError } = await supabase.from('incomes').insert(
      incomes.map((i) => ({
        budget_month_id: budgetMonthId,
        kind: i.kind,
        label: i.label || labelForKind(i.kind),
        amount: i.amount,
      }))
    );
    if (insIncomesError) throw insIncomesError;
  }

  // 2. Charges : pour toute charge cochée "récurrente" sans gabarit lié,
  // on crée d'abord le gabarit (fixed_charges) pour qu'elle soit
  // proposée automatiquement les mois suivants.
  const resolvedEntries = [];
  for (const entry of chargeEntries) {
    let fixedChargeId = entry.fixedChargeId;
    if (entry.isRecurring && !fixedChargeId) {
      const { data: template, error: templateError } = await supabase
        .from('fixed_charges')
        .insert({
          household_id: householdId,
          owner_id: entry.isShared ? null : userId,
          label: entry.label,
          category: entry.category,
          is_shared: entry.isShared,
          is_recurring: true,
          default_amount: entry.amount,
        })
        .select()
        .single();
      if (templateError) throw templateError;
      fixedChargeId = template.id;
    }
    resolvedEntries.push({ ...entry, fixedChargeId });
  }

  const { error: delChargesError } = await supabase
    .from('fixed_charge_entries')
    .delete()
    .eq('budget_month_id', budgetMonthId);
  if (delChargesError) throw delChargesError;

  if (resolvedEntries.length > 0) {
    const { error: insChargesError } = await supabase.from('fixed_charge_entries').insert(
      resolvedEntries.map((e) => ({
        budget_month_id: budgetMonthId,
        fixed_charge_id: e.fixedChargeId || null,
        label: e.label,
        category: e.category,
        amount: e.amount,
        due_date: e.dueDate || null,
      }))
    );
    if (insChargesError) throw insChargesError;
  }

  // 3. Objectifs d'épargne : upsert par poche (clé unique budget_month_id + pocket_id).
  if (savingsGoals.length > 0) {
    const { error: goalsError } = await supabase.from('savings_goals').upsert(
      savingsGoals.map((g) => ({
        budget_month_id: budgetMonthId,
        pocket_id: g.pocketId,
        planned_amount: g.plannedAmount,
      })),
      { onConflict: 'budget_month_id,pocket_id' }
    );
    if (goalsError) throw goalsError;
  }

  // 4. Marge de sécurité + démarrage du mois.
  const update = { safety_margin: safetyMargin };
  if (markStarted) update.started_at = new Date().toISOString();
  const { data: month, error: monthError } = await supabase
    .from('budget_months')
    .update(update)
    .eq('id', budgetMonthId)
    .select()
    .single();
  if (monthError) throw monthError;

  return month;
}

function labelForKind(kind) {
  return { salaire: 'Salaire', autre_revenu: 'Autre revenu', remboursement: 'Remboursement', exceptionnel: 'Revenu exceptionnel' }[kind] || 'Revenu';
}

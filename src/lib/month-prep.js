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
  carryoverAmount,
  incomes,
  chargeEntries,
  savingsGoals,
  householdId,
  userId,
  markStarted,
}) {
  // 1. Revenus : pour tout revenu coché "fixe / récurrent" sans gabarit
  // lié, on crée d'abord le gabarit (recurring_incomes) pour qu'il soit
  // proposé automatiquement les mois suivants et retrouvable dans
  // l'écran Revenus — même principe que les charges ci-dessous.
  const resolvedIncomes = [];
  for (const income of incomes) {
    let recurringIncomeId = income.recurringIncomeId;
    if (income.isRecurring && !recurringIncomeId) {
      const { data: template, error: templateError } = await supabase
        .from('recurring_incomes')
        .insert({
          household_id: householdId,
          owner_id: userId,
          label: income.label || labelForKind(income.kind),
          kind: income.kind,
          default_amount: income.amount,
          is_active: true,
        })
        .select()
        .single();
      if (templateError) throw templateError;
      recurringIncomeId = template.id;
    }
    resolvedIncomes.push({ ...income, recurringIncomeId });
  }

  // Remplacement complet, propre à ce mois.
  const { error: delIncomesError } = await supabase
    .from('incomes')
    .delete()
    .eq('budget_month_id', budgetMonthId);
  if (delIncomesError) throw delIncomesError;

  if (resolvedIncomes.length > 0) {
    const { error: insIncomesError } = await supabase.from('incomes').insert(
      resolvedIncomes.map((i) => ({
        budget_month_id: budgetMonthId,
        kind: i.kind,
        label: i.label || labelForKind(i.kind),
        amount: i.amount,
        recurring_income_id: i.recurringIncomeId || null,
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
        source_pocket_id: e.sourcePocketId || null,
      }))
    );
    if (insChargesError) throw insChargesError;
  }

  // 3. Objectifs d'épargne : le gabarit (montant habituel) est toujours
  // tenu à jour avec le dernier montant saisi, actif ou non — c'est ce
  // qui permet de suspendre un mois précis ("pas ce mois-ci") sans
  // jamais perdre le montant habituel pour la prochaine fois. Seuls les
  // objectifs ACTIFS ce mois-ci obtiennent une ligne dans savings_goals
  // (sinon ils ne compteraient pas dans le budget disponible).
  const activeGoals = [];
  const inactivePocketIds = [];
  for (const goal of savingsGoals) {
    const { data: template, error: templateError } = await supabase
      .from('recurring_savings_goals')
      .upsert(
        {
          household_id: householdId,
          owner_id: userId,
          pocket_id: goal.pocketId,
          default_amount: goal.plannedAmount,
          is_active: goal.isActive,
        },
        { onConflict: 'owner_id,pocket_id' }
      )
      .select()
      .single();
    if (templateError) throw templateError;

    if (goal.isActive) {
      activeGoals.push({ pocketId: goal.pocketId, plannedAmount: goal.plannedAmount, recurringGoalId: template.id });
    } else {
      inactivePocketIds.push(goal.pocketId);
    }
  }

  if (activeGoals.length > 0) {
    const { error: goalsError } = await supabase.from('savings_goals').upsert(
      activeGoals.map((g) => ({
        budget_month_id: budgetMonthId,
        pocket_id: g.pocketId,
        planned_amount: g.plannedAmount,
        recurring_goal_id: g.recurringGoalId,
      })),
      { onConflict: 'budget_month_id,pocket_id' }
    );
    if (goalsError) throw goalsError;
  }
  if (inactivePocketIds.length > 0) {
    const { error: delGoalsError } = await supabase
      .from('savings_goals')
      .delete()
      .eq('budget_month_id', budgetMonthId)
      .in('pocket_id', inactivePocketIds);
    if (delGoalsError) throw delGoalsError;
  }

  // 4. Marge de sécurité + démarrage du mois.
  const update = { safety_margin: safetyMargin, carryover_amount: carryoverAmount ?? 0 };
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

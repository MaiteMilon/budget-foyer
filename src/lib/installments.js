import { supabase } from './supabaseClient.js';
import { computeInstallmentSchedule } from './budget-engine.js';
import { getOrCreateBudgetMonth } from './data.js';

/**
 * installments.js — achats en plusieurs fois.
 *
 * Règle protégée partout ici, comme pour les charges (charges.js) : une
 * mensualité dont le mois est déjà passé ou en cours ne doit JAMAIS être
 * modifiée ou supprimée automatiquement — seules les mensualités dont le
 * mois est STRICTEMENT après le mois en cours sont "révisables".
 */

function currentMonthISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Crée le plan + génère chaque mensualité comme une vraie dépense, dans le bon mois de chacun. */
export async function createInstallmentPlan({
  householdId,
  userId,
  label,
  category,
  merchant,
  sourceType,
  sourcePocketId,
  isShared,
  totalAmount,
  monthlyAmount,
  count,
  startDateISO,
}) {
  const schedule = computeInstallmentSchedule({ totalAmount, monthlyAmount, count, startDateISO });
  const planTotal = schedule.reduce((s, x) => s + x.amount, 0);

  const { data: plan, error: planError } = await supabase
    .from('installment_plans')
    .insert({
      household_id: householdId,
      created_by: userId,
      label,
      category,
      merchant: merchant || null,
      source_type: sourceType,
      source_pocket_id: sourcePocketId || null,
      is_shared: isShared,
      total_amount: planTotal,
      installment_count: schedule.length,
    })
    .select()
    .single();
  if (planError) throw planError;

  for (const installment of schedule) {
    const month = await getOrCreateBudgetMonth(householdId, userId, installment.month);
    const { error } = await supabase.from('expenses').insert({
      household_id: householdId,
      paid_by: userId,
      budget_month_id: month.id,
      source_type: sourceType,
      source_pocket_id: sourcePocketId || null,
      amount: installment.amount,
      spent_at: installment.dueDate,
      category,
      merchant: merchant || null,
      comment: `${label} — échéance ${installment.index}/${schedule.length}`,
      installment_plan_id: plan.id,
      installment_index: installment.index,
    });
    if (error) throw error;
  }

  if (isShared) {
    await supabase.from('household_activity_log').insert({
      household_id: householdId,
      actor_id: userId,
      kind: 'installment_plan_created',
      message: `Achat en ${schedule.length} fois ajouté : ${label} (${planTotal.toFixed(2)} €).`,
    });
  }

  return plan;
}

export async function getMyInstallmentPlans(householdId) {
  const { data, error } = await supabase
    .from('installment_plans')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Toutes les mensualités d'un plan, avec un indicateur "verrouillée" (mois <= mois en cours). */
export async function getPlanInstallments(planId) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('installment_plan_id', planId)
    .order('installment_index', { ascending: true });
  if (error) throw error;

  const currentMonth = currentMonthISO().slice(0, 7); // "YYYY-MM"
  return data.map((e) => ({ ...e, isLocked: e.spent_at.slice(0, 7) <= currentMonth }));
}

/**
 * Révise les mensualités FUTURES d'un plan (nouveau montant et/ou nouveau
 * nombre de mensualités restantes). Les mensualités déjà passées ou du
 * mois en cours ne sont jamais touchées.
 */
export async function reviseRemainingInstallments(planId, { householdId, userId, newMonthlyAmount, newCount }) {
  const installments = await getPlanInstallments(planId);
  const locked = installments.filter((i) => i.isLocked);
  const future = installments.filter((i) => !i.isLocked);
  if (future.length === 0) throw new Error('no_future_installments');

  const { error: delError } = await supabase
    .from('expenses')
    .delete()
    .in('id', future.map((f) => f.id));
  if (delError) throw delError;

  const nextDate = future[0].spent_at; // premier jour futur, pour reprendre la suite sans trou
  const schedule = computeInstallmentSchedule({
    monthlyAmount: newMonthlyAmount,
    count: newCount,
    startDateISO: nextDate,
  });

  const plan = installments[0]
    ? { category: installments[0].category, merchant: installments[0].merchant, source_type: installments[0].source_type, source_pocket_id: installments[0].source_pocket_id }
    : null;
  const label = installments[0]?.comment?.split(' — échéance')[0] || 'Achat en plusieurs fois';
  const baseIndex = locked.length;

  for (const installment of schedule) {
    const month = await getOrCreateBudgetMonth(householdId, userId, installment.month);
    const { error } = await supabase.from('expenses').insert({
      household_id: householdId,
      paid_by: userId,
      budget_month_id: month.id,
      source_type: plan.source_type,
      source_pocket_id: plan.source_pocket_id,
      amount: installment.amount,
      spent_at: installment.dueDate,
      category: plan.category,
      merchant: plan.merchant,
      comment: `${label} — échéance ${baseIndex + installment.index}/${baseIndex + schedule.length}`,
      installment_plan_id: planId,
      installment_index: baseIndex + installment.index,
    });
    if (error) throw error;
  }

  const newTotal =
    locked.reduce((s, l) => s + Number(l.amount), 0) + schedule.reduce((s, x) => s + x.amount, 0);
  await supabase
    .from('installment_plans')
    .update({ installment_count: baseIndex + schedule.length, total_amount: newTotal })
    .eq('id', planId);
}

/** Solde immédiatement : annule les mensualités futures et crée une seule dépense pour le reste, aujourd'hui. */
export async function settleRemainingNow(planId, { householdId, userId, currentBudgetMonthId }) {
  const installments = await getPlanInstallments(planId);
  const future = installments.filter((i) => !i.isLocked);
  if (future.length === 0) throw new Error('no_future_installments');

  const remainingTotal = future.reduce((s, f) => s + Number(f.amount), 0);
  const ref = future[0];

  const { error: delError } = await supabase
    .from('expenses')
    .delete()
    .in('id', future.map((f) => f.id));
  if (delError) throw delError;

  const { error: insError } = await supabase.from('expenses').insert({
    household_id: householdId,
    paid_by: userId,
    budget_month_id: currentBudgetMonthId,
    source_type: ref.source_type,
    source_pocket_id: ref.source_pocket_id,
    amount: Math.round(remainingTotal * 100) / 100,
    spent_at: new Date().toISOString().slice(0, 10),
    category: ref.category,
    merchant: ref.merchant,
    comment: `${ref.comment?.split(' — échéance')[0] || 'Achat en plusieurs fois'} — solde anticipé`,
    installment_plan_id: planId,
    installment_index: null,
  });
  if (insError) throw insError;

  await supabase.from('installment_plans').update({ status: 'settled' }).eq('id', planId);
}

/** Annule les mensualités futures sans les remplacer (ex. article rendu) — celles déjà passées restent. */
export async function cancelRemainingInstallments(planId) {
  const installments = await getPlanInstallments(planId);
  const future = installments.filter((i) => !i.isLocked);
  if (future.length === 0) throw new Error('no_future_installments');

  const { error } = await supabase
    .from('expenses')
    .delete()
    .in('id', future.map((f) => f.id));
  if (error) throw error;

  await supabase.from('installment_plans').update({ status: 'cancelled' }).eq('id', planId);
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { computeMonthlyBudget } from '../lib/budget-engine.js';
import { monthLabel } from '../lib/date-utils.js';
import QuickAddPocketForm, { POCKET_KINDS } from '../components/QuickAddPocketForm.jsx';
import {
  getOrCreateBudgetMonth,
  getMonthIncomes,
  getMonthSavingsGoals,
  getMonthFixedCharges,
  getMonthExpenses,
  getHouseholdPockets,
  addPocket,
} from '../lib/data.js';
import {
  getPreviousBudgetMonth,
  getRecurringChargeTemplates,
  saveMonthPreparation,
} from '../lib/month-prep.js';
import { getActiveRecurringIncomes } from '../lib/income.js';
import { getMyRecurringGoals } from '../lib/savingsGoalTemplates.js';

const INCOME_KINDS = [
  { id: 'salaire', label: 'Salaire' },
  { id: 'autre_revenu', label: 'Autre revenu' },
  { id: 'remboursement', label: 'Remboursement' },
  { id: 'exceptionnel', label: 'Revenu exceptionnel' },
];

const CHARGE_CATEGORIES = [
  'téléphone', 'assurance', 'abonnement', 'transport', 'crédit',
  'école', 'logement', 'énergie', 'internet', 'mutuelle', 'autre',
];

function uid() {
  return crypto.randomUUID();
}


export default function PrepareMonth() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedMonth = searchParams.get('month'); // ex. 2026-10-01, optionnel

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [month, setMonth] = useState(null); // ligne budget_months courante
  const [wasAlreadyStarted, setWasAlreadyStarted] = useState(false);

  const [incomes, setIncomes] = useState([]);
  const [charges, setCharges] = useState([]);
  const [goals, setGoals] = useState([]); // [{pocketId, pocket, plannedAmount}]
  const [pockets, setPockets] = useState([]);
  const [safetyMargin, setSafetyMargin] = useState('0');
  const [carryoverAmount, setCarryoverAmount] = useState('0');

  const [showAddPocket, setShowAddPocket] = useState(false);
  const [openSection, setOpenSection] = useState(null); // null | 'revenus' | 'charges' | 'epargne' | 'marge' | 'report'

  function toggleSection(name) {
    setOpenSection((prev) => (prev === name ? null : name));
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const targetMonthISO = requestedMonth || currentBudgetMonth.month;
      const targetMonth =
        targetMonthISO === currentBudgetMonth.month
          ? currentBudgetMonth
          : await getOrCreateBudgetMonth(profile.household_id, profile.id, targetMonthISO);

      const [existingIncomes, existingGoals, existingCharges, householdPockets, previousMonth] =
        await Promise.all([
          getMonthIncomes(targetMonth.id),
          getMonthSavingsGoals(targetMonth.id),
          getMonthFixedCharges(targetMonth.id),
          getHouseholdPockets(profile.household_id),
          getPreviousBudgetMonth(profile.id, targetMonthISO),
        ]);

      const monthAlreadyPrepared = existingGoals.length > 0 || existingIncomes.length > 0 || existingCharges.length > 0;

      let prevIncomes = [];
      let prevGoalsByPocket = new Map();
      let suggestedCarryover = 0;
      if (previousMonth) {
        const [pIncomes, pGoals] = await Promise.all([
          getMonthIncomes(previousMonth.id),
          getMonthSavingsGoals(previousMonth.id),
        ]);
        prevIncomes = pIncomes;
        pGoals.forEach((g) => prevGoalsByPocket.set(g.pocket_id, g.planned_amount));

        // Report suggéré = le vrai reste à dépenser du mois précédent
        // (§ demande : "automatique mais modifiable") — calculé uniquement
        // la première fois qu'on prépare CE mois-ci ; une fois préparé,
        // on respecte la valeur (éventuellement corrigée à la main) déjà
        // enregistrée sur ce mois, sans la recalculer à chaque ouverture.
        if (!monthAlreadyPrepared) {
          const [pCharges, pExpenses] = await Promise.all([
            getMonthFixedCharges(previousMonth.id),
            getMonthExpenses(previousMonth.id, profile.id),
          ]);
          const prevBudget = computeMonthlyBudget({
            safetyMargin: previousMonth.safety_margin,
            carryoverAmount: previousMonth.carryover_amount,
            incomes: pIncomes,
            savingsGoals: pGoals.map((g) => ({ plannedAmount: g.planned_amount })),
            fixedCharges: pCharges,
            expenses: pExpenses.map((e) => ({ amount: e.amount, sourceType: e.source_type, pocketUsageType: e.source_pocket?.usage_type })),
          });
          suggestedCarryover = prevBudget.remaining;
        }
      }
      setCarryoverAmount(String(monthAlreadyPrepared ? (targetMonth.carryover_amount ?? 0) : suggestedCarryover));

      const recurringChargeTemplates =
        existingCharges.length === 0
          ? await getRecurringChargeTemplates(profile.household_id, profile.id)
          : [];
      const recurringIncomeTemplates =
        existingIncomes.length === 0 ? await getActiveRecurringIncomes(profile.id) : [];
      const recurringGoalsByPocket = await getMyRecurringGoals(profile.id);

      if (cancelled) return;

      setMonth(targetMonth);
      setWasAlreadyStarted(Boolean(targetMonth.started_at));
      setSafetyMargin(String(targetMonth.safety_margin ?? 0));
      setPockets(householdPockets);

      if (existingIncomes.length > 0) {
        setIncomes(
          existingIncomes.map((i) => ({
            id: i.id, kind: i.kind, label: i.label, amount: String(i.amount),
            recurringIncomeId: i.recurring_income_id || null,
            isRecurring: Boolean(i.recurring_income_id),
          }))
        );
      } else if (recurringIncomeTemplates.length > 0) {
        // Uniquement les revenus fixes ACTIFS — un revenu désactivé ne doit
        // plus jamais être reproposé (même correctif que pour les charges).
        setIncomes(
          recurringIncomeTemplates.map((t) => ({
            id: uid(), kind: t.kind, label: t.label, amount: String(t.default_amount),
            recurringIncomeId: t.id, isRecurring: true,
          }))
        );
      } else if (prevIncomes.length > 0) {
        // Repli pour un mois préparé avant l'écran Revenus (aucun gabarit encore créé).
        setIncomes(
          prevIncomes.map((i) => ({ id: uid(), kind: i.kind, label: i.label, amount: String(i.amount), recurringIncomeId: null, isRecurring: false }))
        );
      } else {
        setIncomes([{ id: uid(), kind: 'salaire', label: 'Salaire', amount: '', recurringIncomeId: null, isRecurring: false }]);
      }

      if (existingCharges.length > 0) {
        setCharges(
          existingCharges.map((c) => ({
            id: c.id,
            label: c.label,
            category: c.category,
            amount: String(c.amount),
            isRecurring: Boolean(c.fixed_charge_id),
            isShared: false,
            fixedChargeId: c.fixed_charge_id,
            sourcePocketId: c.source_pocket_id || '',
            dueDate: c.due_date || '',
          }))
        );
      } else {
        setCharges(
          recurringChargeTemplates.map((t) => ({
            id: uid(),
            label: t.label,
            category: t.category,
            amount: String(t.default_amount),
            isRecurring: true,
            isShared: t.is_shared,
            fixedChargeId: t.id,
            sourcePocketId: t.source_pocket_id || '',
            dueDate: '',
          }))
        );
      }

      const existingGoalByPocket = new Map(existingGoals.map((g) => [g.pocket_id, g.planned_amount]));
      setGoals(
        householdPockets
          .filter((p) => p.usage_type !== 'depense') // un compte "dépense" n'a pas de réservation mensuelle
          .map((p) => {
            const template = recurringGoalsByPocket.get(p.id);
            if (existingGoalByPocket.has(p.id)) {
              // Actif ce mois-ci : une ligne existe déjà.
              return { pocketId: p.id, pocket: p, plannedAmount: String(existingGoalByPocket.get(p.id)), isActive: true };
            }
            if (monthAlreadyPrepared) {
              // Ce mois a déjà été préparé, mais ce compte a été désactivé
              // ("pas ce mois-ci") — on garde le montant habituel visible,
              // juste décoché.
              return {
                pocketId: p.id, pocket: p,
                plannedAmount: String(template?.default_amount ?? prevGoalsByPocket.get(p.id) ?? 0),
                isActive: false,
              };
            }
            // Mois jamais préparé : on part du gabarit (montant + actif).
            return {
              pocketId: p.id, pocket: p,
              plannedAmount: String(template?.default_amount ?? prevGoalsByPocket.get(p.id) ?? 0),
              isActive: template ? template.is_active : true,
            };
          })
      );

      setLoading(false);
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err.message);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedMonth, currentBudgetMonth?.id]);

  const liveBudget = useMemo(() => {
    return computeMonthlyBudget({
      safetyMargin: Number(String(safetyMargin).replace(',', '.')) || 0,
      carryoverAmount: Number(String(carryoverAmount).replace(',', '.')) || 0,
      incomes: incomes.map((i) => ({ amount: Number(String(i.amount).replace(',', '.')) || 0 })),
      savingsGoals: goals.filter((g) => g.isActive).map((g) => ({ plannedAmount: Number(String(g.plannedAmount).replace(',', '.')) || 0 })),
      fixedCharges: charges.map((c) => ({ amount: Number(String(c.amount).replace(',', '.')) || 0 })),
      expenses: [],
    });
  }, [incomes, goals, charges, safetyMargin, carryoverAmount]);

  function updateIncome(id, patch) {
    setIncomes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function addIncomeRow() {
    setIncomes((prev) => [...prev, { id: uid(), kind: 'autre_revenu', label: '', amount: '', isRecurring: false, recurringIncomeId: null }]);
  }
  function removeIncomeRow(id) {
    setIncomes((prev) => prev.filter((i) => i.id !== id));
  }

  function updateCharge(id, patch) {
    setCharges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function addChargeRow() {
    setCharges((prev) => [
      ...prev,
      { id: uid(), label: '', category: 'autre', amount: '', isRecurring: false, isShared: false, fixedChargeId: null, dueDate: '' },
    ]);
  }
  function removeChargeRow(id) {
    setCharges((prev) => prev.filter((c) => c.id !== id));
  }

  function updateGoal(pocketId, patch) {
    setGoals((prev) => prev.map((g) => (g.pocketId === pocketId ? { ...g, ...patch } : g)));
  }

  async function handleQuickAddPocket(formData) {
    const pocket = await addPocket({
      household_id: profile.household_id,
      owner_id: formData.isPrivate ? profile.id : null,
      name: formData.name,
      icon: POCKET_KINDS.find((k) => k.id === formData.kind)?.icon || '💶',
      kind: formData.kind,
      usage_type: formData.usageType,
      is_private: formData.isPrivate,
      target_amount: formData.targetAmount,
      target_date: formData.targetDate,
      balance: 0,
    });
    setPockets((prev) => [...prev, pocket]);
    // Un compte "dépense" n'apparaît pas dans les objectifs du mois (pas de réservation).
    if (formData.usageType !== 'depense') {
      setGoals((prev) => [...prev, {
        pocketId: pocket.id, pocket,
        plannedAmount: formData.monthlyAmount ? String(formData.monthlyAmount) : '0',
        isActive: true,
      }]);
    }
    setShowAddPocket(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await saveMonthPreparation({
        budgetMonthId: month.id,
        householdId: profile.household_id,
        userId: profile.id,
        safetyMargin: Number(String(safetyMargin).replace(',', '.')) || 0,
        carryoverAmount: Number(String(carryoverAmount).replace(',', '.')) || 0,
        incomes: incomes
          .filter((i) => i.amount !== '')
          .map((i) => ({ kind: i.kind, label: i.label, amount: Number(String(i.amount).replace(',', '.')) || 0, recurringIncomeId: i.recurringIncomeId || null, isRecurring: i.isRecurring })),
        chargeEntries: charges
          .filter((c) => c.amount !== '')
          .map((c) => ({
            label: c.label,
            category: c.category,
            amount: Number(String(c.amount).replace(',', '.')) || 0,
            isRecurring: c.isRecurring,
            isShared: c.isShared,
            fixedChargeId: c.fixedChargeId,
            sourcePocketId: c.sourcePocketId || null,
            dueDate: c.dueDate || null,
          })),
        savingsGoals: goals.map((g) => ({
          pocketId: g.pocketId,
          plannedAmount: Number(String(g.plannedAmount).replace(',', '.')) || 0,
          isActive: g.isActive,
        })),
        markStarted: true,
      });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  if (error && !month) {
    return (
      <div className="text-center mt-20 px-4">
        <p className="text-4xl mb-2">⚠️</p>
        <p className="font-semibold mb-2">Impossible de charger Préparer mon mois</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 break-words">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="text-2xl font-bold">Préparer mon mois</h1>
        <p className="text-ink/60 text-sm mt-1">{monthLabel(month.month)}</p>
      </header>

      <section className="sticky top-0 z-10 bg-teal text-white rounded-card p-5 shadow-md">
        <p className="text-sm text-white/80 font-medium">Budget disponible pour les dépenses</p>
        <p className="text-4xl font-extrabold mt-1">
          {liveBudget.initialBudget.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
        </p>
        <p className="text-xs text-white/70 mt-2">
          {liveBudget.totalIncome.toLocaleString('fr-FR')} € de revenus
          {liveBudget.carryoverAmount !== 0 && (liveBudget.carryoverAmount > 0
            ? ` + ${liveBudget.carryoverAmount.toLocaleString('fr-FR')} € de report`
            : ` − ${Math.abs(liveBudget.carryoverAmount).toLocaleString('fr-FR')} € de report`)}
          {' '}− {liveBudget.totalPlannedSavings.toLocaleString('fr-FR')} € d'épargne prévue − {liveBudget.totalFixedCharges.toLocaleString('fr-FR')} € de charges − {liveBudget.safetyMargin.toLocaleString('fr-FR')} € de marge
        </p>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <button onClick={() => toggleSection('revenus')} className="w-full flex justify-between items-center">
          <h2 className="font-semibold">Mes revenus</h2>
          <span className="flex items-center gap-2 text-sm text-ink/60">
            {liveBudget.totalIncome.toLocaleString('fr-FR')} €
            <span className="text-ink/40 text-xs">{openSection === 'revenus' ? '▲' : '▼'}</span>
          </span>
        </button>
        {openSection === 'revenus' && (
        <div className="space-y-3 mt-3 pt-3 border-t border-teal-light">
          {incomes.map((income) => (
            <div key={income.id} className="border border-teal-light rounded-2xl p-3 space-y-2">
              <div className="flex gap-2 items-center">
                <select
                  value={income.kind}
                  onChange={(e) => updateIncome(income.id, { kind: e.target.value })}
                  className="bg-cream rounded-xl px-2 py-2 border border-teal-light text-sm w-28 shrink-0"
                >
                  {INCOME_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
                <input
                  value={income.label}
                  onChange={(e) => updateIncome(income.id, { label: e.target.value })}
                  placeholder="Libellé"
                  className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm min-w-0"
                />
                <input
                  inputMode="decimal"
                  value={income.amount}
                  onChange={(e) => updateIncome(income.id, { amount: e.target.value })}
                  placeholder="0"
                  className="w-20 bg-cream rounded-xl px-2 py-2 border border-teal-light text-sm text-right"
                />
                <button onClick={() => removeIncomeRow(income.id)} className="text-coral text-lg shrink-0" aria-label="Supprimer">
                  ×
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={income.isRecurring}
                  onChange={(e) => updateIncome(income.id, { isRecurring: e.target.checked })}
                />
                Fixe / récurrent (proposé automatiquement les mois suivants — retrouvable dans "Revenus")
              </label>
            </div>
          ))}
        </div>
        )}
        {openSection === 'revenus' && (
        <button onClick={addIncomeRow} className="mt-3 text-teal text-sm font-medium">
          + Ajouter un revenu
        </button>
        )}
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <button onClick={() => toggleSection('charges')} className="w-full flex justify-between items-center">
          <h2 className="font-semibold">Charges fixes et ponctuelles</h2>
          <span className="flex items-center gap-2 text-sm text-ink/60">
            {liveBudget.totalFixedCharges.toLocaleString('fr-FR')} €
            <span className="text-ink/40 text-xs">{openSection === 'charges' ? '▲' : '▼'}</span>
          </span>
        </button>
        {openSection === 'charges' && (
        <div className="space-y-3 mt-3 pt-3 border-t border-teal-light">
          {charges.map((charge) => (
            <div key={charge.id} className="border border-teal-light rounded-2xl p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={charge.label}
                  onChange={(e) => updateCharge(charge.id, { label: e.target.value })}
                  placeholder="Libellé (ex. Loyer)"
                  className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm min-w-0"
                />
                <input
                  inputMode="decimal"
                  value={charge.amount}
                  onChange={(e) => updateCharge(charge.id, { amount: e.target.value })}
                  placeholder="0"
                  className="w-20 bg-cream rounded-xl px-2 py-2 border border-teal-light text-sm text-right"
                />
                <button onClick={() => removeChargeRow(charge.id)} className="text-coral text-lg shrink-0" aria-label="Supprimer">
                  ×
                </button>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <select
                  value={charge.category}
                  onChange={(e) => updateCharge(charge.id, { category: e.target.value })}
                  className="bg-cream rounded-xl px-2 py-1.5 border border-teal-light text-xs"
                >
                  {CHARGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={charge.isRecurring}
                    onChange={(e) => updateCharge(charge.id, { isRecurring: e.target.checked })}
                  />
                  Récurrente
                </label>
                <label className="flex items-center gap-1 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={charge.isShared}
                    onChange={(e) => updateCharge(charge.id, { isShared: e.target.checked })}
                  />
                  Commune
                </label>
              </div>
            </div>
          ))}
        </div>
        )}
        {openSection === 'charges' && (
        <button onClick={addChargeRow} className="mt-3 text-teal text-sm font-medium">
          + Ajouter une charge
        </button>
        )}
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <button onClick={() => toggleSection('epargne')} className="w-full flex justify-between items-center">
          <h2 className="font-semibold">Ce que je prévois de mettre de côté</h2>
          <span className="flex items-center gap-2 text-sm text-ink/60">
            {liveBudget.totalPlannedSavings.toLocaleString('fr-FR')} €
            <span className="text-ink/40 text-xs">{openSection === 'epargne' ? '▲' : '▼'}</span>
          </span>
        </button>
        {openSection === 'epargne' && (
        <>
        {goals.length === 0 && !showAddPocket && (
          <p className="text-sm text-ink/40 mt-3 pt-3 border-t border-teal-light">Aucun compte pour l'instant.</p>
        )}
        <div className="space-y-3 mt-3 pt-3 border-t border-teal-light">
          {goals.map((g) => (
            <div key={g.pocketId} className="border border-teal-light rounded-2xl p-3 space-y-2">
              <div className="flex justify-between items-center gap-3">
                <span className="text-sm font-medium">
                  {g.pocket.icon} {g.pocket.name}
                  {g.pocket.is_private && <span className="text-ink/30"> · privée</span>}
                </span>
                <div className="relative w-28 shrink-0">
                  <input
                    inputMode="decimal"
                    value={g.plannedAmount}
                    onChange={(e) => updateGoal(g.pocketId, { plannedAmount: e.target.value })}
                    className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm text-right"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={g.isActive}
                  onChange={(e) => updateGoal(g.pocketId, { isActive: e.target.checked })}
                />
                Actif ce mois-ci (décochez si vous ne pourrez pas verser ce montant habituel ce mois-ci — le montant reste enregistré pour la prochaine fois)
              </label>
            </div>
          ))}
        </div>

        {showAddPocket ? (
          <QuickAddPocketForm onCancel={() => setShowAddPocket(false)} onSubmit={handleQuickAddPocket} />
        ) : (
          <button onClick={() => setShowAddPocket(true)} className="mt-3 text-teal text-sm font-medium">
            + Ajouter un compte
          </button>
        )}
        </>
        )}
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <button onClick={() => toggleSection('report')} className="w-full flex justify-between items-center">
          <h2 className="font-semibold">Report du mois précédent</h2>
          <span className="flex items-center gap-2 text-sm text-ink/60">
            {(Number(String(carryoverAmount).replace(',', '.')) || 0).toLocaleString('fr-FR')} €
            <span className="text-ink/40 text-xs">{openSection === 'report' ? '▲' : '▼'}</span>
          </span>
        </button>
        {openSection === 'report' && (
        <div className="mt-3 pt-3 border-t border-teal-light">
          <p className="text-xs text-ink/50 mb-2">
            Suggéré automatiquement à partir de votre reste à dépenser réel du mois précédent (positif ou négatif) — toujours modifiable ici, y compris pour le mettre à 0 si vous ne voulez pas de report.
          </p>
          <div className="relative w-32">
            <input
              inputMode="decimal"
              value={carryoverAmount}
              onChange={(e) => setCarryoverAmount(e.target.value)}
              className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm text-right"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
          </div>
        </div>
        )}
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <button onClick={() => toggleSection('marge')} className="w-full flex justify-between items-center">
          <h2 className="font-semibold">Marge de sécurité</h2>
          <span className="flex items-center gap-2 text-sm text-ink/60">
            {(Number(String(safetyMargin).replace(',', '.')) || 0).toLocaleString('fr-FR')} €
            <span className="text-ink/40 text-xs">{openSection === 'marge' ? '▲' : '▼'}</span>
          </span>
        </button>
        {openSection === 'marge' && (
        <div className="mt-3 pt-3 border-t border-teal-light">
          <p className="text-xs text-ink/50 mb-2">Un montant que vous préférez ne pas toucher, par précaution.</p>
          <div className="relative w-32">
            <input
              inputMode="decimal"
              value={safetyMargin}
              onChange={(e) => setSafetyMargin(e.target.value)}
              className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm text-right"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
          </div>
        </div>
        )}
      </section>

      {error && <p className="text-coral text-sm text-center">{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : wasAlreadyStarted ? 'Enregistrer les modifications' : 'Démarrer mon mois'}
      </button>
      {wasAlreadyStarted && (
        <p className="text-xs text-center text-ink/40">
          Les dépenses déjà enregistrées ce mois-ci ne sont pas affectées.
        </p>
      )}
    </div>
  );
}

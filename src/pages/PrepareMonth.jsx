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
  getHouseholdPockets,
  addPocket,
} from '../lib/data.js';
import {
  getPreviousBudgetMonth,
  getRecurringChargeTemplates,
  saveMonthPreparation,
} from '../lib/month-prep.js';
import { getActiveRecurringIncomes } from '../lib/income.js';

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

  const [showAddPocket, setShowAddPocket] = useState(false);

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

      let prevIncomes = [];
      let prevGoalsByPocket = new Map();
      if (previousMonth) {
        const [pIncomes, pGoals] = await Promise.all([
          getMonthIncomes(previousMonth.id),
          getMonthSavingsGoals(previousMonth.id),
        ]);
        prevIncomes = pIncomes;
        pGoals.forEach((g) => prevGoalsByPocket.set(g.pocket_id, g.planned_amount));
      }

      const recurringChargeTemplates =
        existingCharges.length === 0
          ? await getRecurringChargeTemplates(profile.household_id, profile.id)
          : [];
      const recurringIncomeTemplates =
        existingIncomes.length === 0 ? await getActiveRecurringIncomes(profile.id) : [];

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
          }))
        );
      } else if (recurringIncomeTemplates.length > 0) {
        // Uniquement les revenus fixes ACTIFS — un revenu désactivé ne doit
        // plus jamais être reproposé (même correctif que pour les charges).
        setIncomes(
          recurringIncomeTemplates.map((t) => ({
            id: uid(), kind: t.kind, label: t.label, amount: String(t.default_amount),
            recurringIncomeId: t.id,
          }))
        );
      } else if (prevIncomes.length > 0) {
        // Repli pour un mois préparé avant l'écran Revenus (aucun gabarit encore créé).
        setIncomes(
          prevIncomes.map((i) => ({ id: uid(), kind: i.kind, label: i.label, amount: String(i.amount), recurringIncomeId: null }))
        );
      } else {
        setIncomes([{ id: uid(), kind: 'salaire', label: 'Salaire', amount: '', recurringIncomeId: null }]);
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
          .map((p) => ({
            pocketId: p.id,
            pocket: p,
            plannedAmount: String(
              existingGoalByPocket.get(p.id) ?? prevGoalsByPocket.get(p.id) ?? 0
            ),
          }))
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
      incomes: incomes.map((i) => ({ amount: Number(String(i.amount).replace(',', '.')) || 0 })),
      savingsGoals: goals.map((g) => ({ plannedAmount: Number(String(g.plannedAmount).replace(',', '.')) || 0 })),
      fixedCharges: charges.map((c) => ({ amount: Number(String(c.amount).replace(',', '.')) || 0 })),
      expenses: [],
    });
  }, [incomes, goals, charges, safetyMargin]);

  function updateIncome(id, patch) {
    setIncomes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function addIncomeRow() {
    setIncomes((prev) => [...prev, { id: uid(), kind: 'autre_revenu', label: '', amount: '' }]);
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

  function updateGoal(pocketId, plannedAmount) {
    setGoals((prev) => prev.map((g) => (g.pocketId === pocketId ? { ...g, plannedAmount } : g)));
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
      setGoals((prev) => [...prev, { pocketId: pocket.id, pocket, plannedAmount: '0' }]);
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
        incomes: incomes
          .filter((i) => i.amount !== '')
          .map((i) => ({ kind: i.kind, label: i.label, amount: Number(String(i.amount).replace(',', '.')) || 0, recurringIncomeId: i.recurringIncomeId || null })),
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
          {liveBudget.totalIncome.toLocaleString('fr-FR')} € de revenus − {liveBudget.totalPlannedSavings.toLocaleString('fr-FR')} € d'épargne prévue − {liveBudget.totalFixedCharges.toLocaleString('fr-FR')} € de charges − {liveBudget.safetyMargin.toLocaleString('fr-FR')} € de marge
        </p>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Mes revenus</h2>
        <div className="space-y-3">
          {incomes.map((income) => (
            <div key={income.id} className="flex gap-2 items-center">
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
          ))}
        </div>
        <button onClick={addIncomeRow} className="mt-3 text-teal text-sm font-medium">
          + Ajouter un revenu
        </button>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Charges fixes et ponctuelles</h2>
        <div className="space-y-3">
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
        <button onClick={addChargeRow} className="mt-3 text-teal text-sm font-medium">
          + Ajouter une charge
        </button>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Ce que je prévois de mettre de côté</h2>
        {goals.length === 0 && !showAddPocket && (
          <p className="text-sm text-ink/40 mb-3">Aucun compte pour l'instant.</p>
        )}
        <div className="space-y-3">
          {goals.map((g) => (
            <div key={g.pocketId} className="flex justify-between items-center gap-3">
              <span className="text-sm font-medium">
                {g.pocket.icon} {g.pocket.name}
                {g.pocket.is_private && <span className="text-ink/30"> · privée</span>}
              </span>
              <div className="relative w-28 shrink-0">
                <input
                  inputMode="decimal"
                  value={g.plannedAmount}
                  onChange={(e) => updateGoal(g.pocketId, e.target.value)}
                  className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm text-right"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
              </div>
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
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-2">Marge de sécurité</h2>
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

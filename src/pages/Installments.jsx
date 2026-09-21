import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getHouseholdPockets } from '../lib/data.js';
import {
  createInstallmentPlan,
  getMyInstallmentPlans,
  getPlanInstallments,
  reviseRemainingInstallments,
  settleRemainingNow,
  cancelRemainingInstallments,
} from '../lib/installments.js';

const CATEGORIES = [
  'courses', 'essence', 'restaurants', 'enfants', 'maison', 'vetements',
  'loisirs', 'sante', 'beaute', 'achats_perso', 'vacances', 'autres',
];

function emptyForm() {
  return {
    label: '',
    amountMode: 'total', // 'total' | 'monthly'
    amount: '',
    count: '3',
    startDate: new Date().toISOString().slice(0, 10),
    category: 'achats_perso',
    accountId: 'perso',
  };
}

export default function Installments({ onDone }) {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [form, setForm] = useState(emptyForm());
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [expandedPlanId, setExpandedPlanId] = useState(null);
  const [expandedInstallments, setExpandedInstallments] = useState([]);
  const [revising, setRevising] = useState(null); // planId en cours de révision

  async function loadPlans() {
    setLoadingPlans(true);
    const data = await getMyInstallmentPlans(profile.household_id);
    setPlans(data.filter((p) => p.status === 'active'));
    setLoadingPlans(false);
  }

  useEffect(() => {
    loadPlans();
    getHouseholdPockets(profile.household_id).then(setAccounts);
  }, [profile.household_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    const amountValue = Number(String(form.amount).replace(',', '.'));
    const count = Number(form.count);
    if (!form.label || !amountValue || amountValue <= 0 || count < 1) return;

    const account = accounts.find((a) => a.id === form.accountId);

    setSaving(true);
    setError('');
    try {
      await createInstallmentPlan({
        householdId: profile.household_id,
        userId: profile.id,
        label: form.label,
        category: form.category,
        merchant: null,
        sourceType: form.accountId === 'perso' ? 'perso' : 'pocket',
        sourcePocketId: form.accountId === 'perso' ? null : form.accountId,
        isShared: Boolean(account && !account.owner_id), // commune si le compte n'a pas de propriétaire perso
        totalAmount: form.amountMode === 'total' ? amountValue : undefined,
        monthlyAmount: form.amountMode === 'monthly' ? amountValue : undefined,
        count,
        startDateISO: form.startDate,
      });
      setForm(emptyForm());
      await loadPlans();
      await refresh();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleExpand(plan) {
    if (expandedPlanId === plan.id) {
      setExpandedPlanId(null);
      return;
    }
    const installments = await getPlanInstallments(plan.id);
    setExpandedInstallments(installments);
    setExpandedPlanId(plan.id);
  }

  async function handleSettle(plan) {
    const ok = window.confirm(
      `Solder "${plan.label}" maintenant ? Les mensualités futures seront remplacées par un seul paiement du solde restant, ce mois-ci.`
    );
    if (!ok) return;
    try {
      await settleRemainingNow(plan.id, {
        householdId: profile.household_id,
        userId: profile.id,
        currentBudgetMonthId: currentBudgetMonth.id,
      });
      await loadPlans();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCancel(plan) {
    const ok = window.confirm(
      `Annuler les mensualités restantes de "${plan.label}" ? Celles déjà passées ne sont pas touchées.`
    );
    if (!ok) return;
    try {
      await cancelRemainingInstallments(plan.id);
      await loadPlans();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="bg-white rounded-card p-5 shadow-sm space-y-3">
        <h2 className="font-semibold">Nouvel achat en plusieurs fois</h2>

        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Nom de l'achat (ex. Lave-linge)"
          required
          className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        />

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setForm({ ...form, amountMode: 'total' })}
            className={`flex-1 rounded-xl py-2 font-medium border ${form.amountMode === 'total' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
          >
            Montant total
          </button>
          <button
            type="button"
            onClick={() => setForm({ ...form, amountMode: 'monthly' })}
            className={`flex-1 rounded-xl py-2 font-medium border ${form.amountMode === 'monthly' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
          >
            Montant mensuel
          </button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={form.amountMode === 'total' ? 'Montant total' : 'Montant mensuel'}
              required
              className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
          </div>
          <input
            type="number"
            min="1"
            value={form.count}
            onChange={(e) => setForm({ ...form, count: e.target.value })}
            placeholder="Nb de fois"
            className="w-24 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm text-center"
          />
        </div>

        {form.amount && form.count > 0 && (
          <p className="text-xs text-ink/50">
            {form.amountMode === 'total'
              ? `≈ ${(Number(String(form.amount).replace(',', '.')) / Number(form.count)).toFixed(2)} € / mois sur ${form.count} mois`
              : `≈ ${(Number(String(form.amount).replace(',', '.')) * Number(form.count)).toFixed(2)} € au total sur ${form.count} mois`}
          </p>
        )}

        <div>
          <label className="text-xs text-ink/60">Date de la 1ʳᵉ échéance</label>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          />
          <p className="text-xs text-ink/40 mt-1">
            Aujourd'hui par défaut — changez-la si le magasin propose un premier prélèvement différé.
          </p>
        </div>

        <div className="flex gap-2">
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          >
            <option value="perso">Mon compte perso</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-coral text-sm text-center">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-teal text-white font-semibold rounded-card py-3 disabled:opacity-50"
        >
          {saving ? 'Création…' : "Créer l'échéancier"}
        </button>
      </form>

      <section>
        <h2 className="font-semibold mb-3">Achats en cours</h2>
        {loadingPlans && <p className="text-sm text-ink/40">Chargement…</p>}
        {!loadingPlans && plans.length === 0 && (
          <p className="text-sm text-ink/40">Aucun achat en plusieurs fois en cours.</p>
        )}
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id} className="bg-white rounded-card p-4 shadow-sm">
              <button onClick={() => toggleExpand(plan)} className="w-full text-left">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{plan.label}</span>
                  <span className="font-semibold">{Number(plan.total_amount).toLocaleString('fr-FR')} €</span>
                </div>
                <p className="text-xs text-ink/50 mt-0.5">{plan.installment_count} mensualités</p>
              </button>

              {expandedPlanId === plan.id && (
                <div className="mt-3 space-y-2">
                  <ul className="text-xs text-ink/60 space-y-1">
                    {expandedInstallments.map((i) => (
                      <li key={i.id} className="flex justify-between">
                        <span>
                          {i.installment_index ? `Échéance ${i.installment_index}` : 'Solde'} —{' '}
                          {new Date(i.spent_at).toLocaleDateString('fr-FR')}
                          {i.isLocked && ' ✓'}
                        </span>
                        <span>{Number(i.amount).toLocaleString('fr-FR')} €</span>
                      </li>
                    ))}
                  </ul>

                  {revising === plan.id ? (
                    <ReviseForm
                      onCancel={() => setRevising(null)}
                      onSubmit={async ({ newMonthlyAmount, newCount }) => {
                        await reviseRemainingInstallments(plan.id, {
                          householdId: profile.household_id,
                          userId: profile.id,
                          newMonthlyAmount,
                          newCount,
                        });
                        setRevising(null);
                        setExpandedPlanId(null);
                        await loadPlans();
                        await refresh();
                      }}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-3 text-xs pt-1">
                      <button onClick={() => setRevising(plan.id)} className="text-teal font-semibold">
                        Réviser les mensualités restantes
                      </button>
                      <button onClick={() => handleSettle(plan)} className="text-amber font-semibold">
                        Solder maintenant
                      </button>
                      <button onClick={() => handleCancel(plan)} className="text-coral font-semibold">
                        Annuler le reste
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReviseForm({ onSubmit, onCancel }) {
  const [newMonthlyAmount, setNewMonthlyAmount] = useState('');
  const [newCount, setNewCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const amount = Number(String(newMonthlyAmount).replace(',', '.'));
    const count = Number(newCount);
    if (!amount || !count) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ newMonthlyAmount: amount, newCount: count });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-teal-light rounded-2xl p-3 space-y-2">
      <p className="text-xs text-ink/60">Nouveau montant et durée, à partir de la prochaine échéance non encore passée :</p>
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={newMonthlyAmount}
          onChange={(e) => setNewMonthlyAmount(e.target.value)}
          placeholder="Nouveau montant / mois"
          className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        />
        <input
          type="number"
          min="1"
          value={newCount}
          onChange={(e) => setNewCount(e.target.value)}
          placeholder="Nb de fois"
          className="w-24 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm text-center"
        />
      </div>
      {error && <p className="text-coral text-xs">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 text-xs text-ink/50 py-2">Annuler</button>
        <button type="submit" disabled={submitting} className="flex-1 bg-teal text-white text-xs font-semibold rounded-xl py-2 disabled:opacity-50">
          {submitting ? 'Enregistrement…' : 'Confirmer'}
        </button>
      </div>
    </form>
  );
}

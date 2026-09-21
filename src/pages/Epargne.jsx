import { useEffect, useState } from 'react';
import { getHouseholdPockets, deletePocket, addPocket, getMonthSavingsGoals } from '../lib/data.js';
import { recordPocketTransfer } from '../lib/transfers.js';
import { computeGoalProgress } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';

const POCKET_KINDS = [
  { id: 'compte_joint', label: 'Compte joint', icon: '🏦' },
  { id: 'tirelire', label: 'Tirelire / espèces', icon: '🐷' },
  { id: 'epargne', label: 'Compte épargne', icon: '💶' },
  { id: 'vacances', label: 'Vacances', icon: '🏖️' },
  { id: 'precaution', label: 'Épargne de précaution', icon: '🛟' },
  { id: 'projet', label: 'Projet particulier', icon: '🎯' },
  { id: 'autre', label: 'Autre', icon: '➕' },
];

export default function Epargne() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [pockets, setPockets] = useState([]);
  const [goalsByPocket, setGoalsByPocket] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddPocket, setShowAddPocket] = useState(false);
  const [transferringId, setTransferringId] = useState(null); // id de la poche dont le formulaire de versement est ouvert
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const [pocketsList, goals] = await Promise.all([
      getHouseholdPockets(profile.household_id),
      getMonthSavingsGoals(currentBudgetMonth.id),
    ]);
    setPockets(pocketsList);
    setGoalsByPocket(new Map(goals.map((g) => [g.pocket_id, g])));
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile.household_id, currentBudgetMonth.id]);

  async function handleDelete(pocket) {
    const ok = window.confirm(`Supprimer la poche "${pocket.name}" ? Cette action est irréversible.`);
    if (!ok) return;
    await deletePocket(pocket.id);
    await load();
  }

  async function handleAddPocket({ name, kind, isPrivate }) {
    setError('');
    try {
      await addPocket({
        household_id: profile.household_id,
        owner_id: isPrivate ? profile.id : null,
        name,
        icon: POCKET_KINDS.find((k) => k.id === kind)?.icon || '💶',
        kind,
        is_private: isPrivate,
        balance: 0,
      });
      setShowAddPocket(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTransfer(pocket, amount) {
    setError('');
    try {
      await recordPocketTransfer({
        householdId: profile.household_id,
        userId: profile.id,
        budgetMonthId: currentBudgetMonth.id,
        pocket,
        amount,
      });
      setTransferringId(null);
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  const total = pockets.reduce((sum, p) => sum + Number(p.balance), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Notre épargne</h1>
      </header>

      <section className="bg-teal text-white rounded-card p-6 shadow-sm">
        <p className="text-sm text-white/80 font-medium">Total épargne du foyer</p>
        <p className="text-4xl font-extrabold mt-1">{total.toLocaleString('fr-FR')} €</p>
      </section>

      {error && <p className="text-coral text-sm text-center">{error}</p>}

      <ul className="space-y-3">
        {pockets.map((p) => {
          const goal = goalsByPocket.get(p.id);
          const progress = goal
            ? computeGoalProgress({ plannedAmount: goal.planned_amount, actualPaidIn: goal.actual_paid_in })
            : null;
          const canManage = !p.is_private || p.owner_id === profile.id;

          return (
            <li key={p.id} className="bg-white rounded-card p-4 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="font-medium">
                  {p.icon} {p.name}
                  {p.is_private && <span className="text-ink/30 text-xs"> · privée</span>}
                </span>
                <span className="font-semibold">{Number(p.balance).toLocaleString('fr-FR')} €</span>
              </div>

              {progress && progress.planned > 0 && (
                <>
                  <div className="flex justify-between text-xs text-ink/50 mt-2 mb-1">
                    <span>Versé ce mois-ci</span>
                    <span>{progress.paid.toLocaleString('fr-FR')} € / {progress.planned.toLocaleString('fr-FR')} €</span>
                  </div>
                  <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                    <div
                      className="h-full bg-amber rounded-full"
                      style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                    />
                  </div>
                </>
              )}

              {canManage && (
                <div className="flex justify-between items-center mt-3">
                  <button
                    onClick={() => setTransferringId(transferringId === p.id ? null : p.id)}
                    className="text-teal text-xs font-semibold"
                  >
                    {transferringId === p.id ? 'Annuler' : '+ Verser'}
                  </button>
                  <button
                    onClick={() => handleDelete(p)}
                    className="text-coral text-xs underline"
                    aria-label={`Supprimer ${p.name}`}
                  >
                    Supprimer
                  </button>
                </div>
              )}

              {transferringId === p.id && (
                <TransferForm onSubmit={(amount) => handleTransfer(p, amount)} />
              )}
            </li>
          );
        })}
        {pockets.length === 0 && (
          <p className="text-center text-ink/40 text-sm py-6">Aucune poche pour l'instant.</p>
        )}
      </ul>

      {showAddPocket ? (
        <QuickAddPocket onCancel={() => setShowAddPocket(false)} onSubmit={handleAddPocket} />
      ) : (
        <button
          onClick={() => setShowAddPocket(true)}
          className="w-full bg-white border border-teal-light text-teal font-semibold rounded-card py-4"
        >
          + Ajouter une poche
        </button>
      )}
    </div>
  );
}

function TransferForm({ onSubmit }) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) return;
    setSubmitting(true);
    await onSubmit(value);
    setSubmitting(false);
    setAmount('');
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
      <div className="relative flex-1">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant réellement versé"
          autoFocus
          className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-teal text-white text-sm font-semibold rounded-xl px-4 disabled:opacity-50"
      >
        OK
      </button>
    </form>
  );
}

function QuickAddPocket({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('epargne');
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    await onSubmit({ name, kind, isPrivate });
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-card p-5 shadow-sm space-y-3">
      <h2 className="font-semibold">Nouvelle poche</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom de la poche"
        required
        autoFocus
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      >
        {POCKET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-ink/60">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Poche privée (visible de moi seul·e)
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 text-sm text-ink/50 py-2">
          Annuler
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-teal text-white text-sm font-semibold rounded-xl py-2 disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>
    </form>
  );
}

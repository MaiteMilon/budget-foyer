import { useEffect, useState } from 'react';
import { getHouseholdPockets, deletePocket, addPocket, updatePocket, correctPocketBalance, getMonthSavingsGoals, getMonthExpenses } from '../lib/data.js';
import { recordPocketTransfer } from '../lib/transfers.js';
import { computeGoalProgress } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';
import QuickAddPocketForm, { POCKET_KINDS } from '../components/QuickAddPocketForm.jsx';

export default function Epargne() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [pockets, setPockets] = useState([]);
  const [goalsByPocket, setGoalsByPocket] = useState(new Map());
  const [spentByPocket, setSpentByPocket] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddPocket, setShowAddPocket] = useState(false);
  const [editingPocket, setEditingPocket] = useState(null); // null | poche en cours de modification
  const [transferringId, setTransferringId] = useState(null);
  const [correctingId, setCorrectingId] = useState(null); // null | poche dont on corrige le solde réel
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [pocketsList, goals, expenses] = await Promise.all([
        getHouseholdPockets(profile.household_id),
        getMonthSavingsGoals(currentBudgetMonth.id),
        getMonthExpenses(currentBudgetMonth.id, profile.id),
      ]);
      setPockets(pocketsList);
      setGoalsByPocket(new Map(goals.map((g) => [g.pocket_id, g])));

      const spentMap = new Map();
      expenses.forEach((e) => {
        if (!e.source_pocket_id) return;
        spentMap.set(e.source_pocket_id, (spentMap.get(e.source_pocket_id) || 0) + Number(e.amount));
      });
      setSpentByPocket(spentMap);
    } catch (err) {
      setLoadError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [profile.household_id, currentBudgetMonth.id]);

  async function handleDelete(pocket) {
    const ok = window.confirm(`Supprimer le compte "${pocket.name}" ? Cette action est irréversible.`);
    if (!ok) return;
    await deletePocket(pocket.id);
    await load();
  }

  function openEdit(pocket) {
    setShowAddPocket(false);
    setEditingPocket(pocket);
  }

  async function handleAddPocket({ name, kind, usageType, isPrivate, targetAmount, targetDate }) {
    setError('');
    try {
      await addPocket({
        household_id: profile.household_id,
        owner_id: isPrivate ? profile.id : null,
        name,
        icon: POCKET_KINDS.find((k) => k.id === kind)?.icon || '💶',
        kind,
        usage_type: usageType,
        is_private: isPrivate,
        target_amount: targetAmount,
        target_date: targetDate,
        balance: 0,
      });
      setShowAddPocket(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdatePocket({ name, kind, usageType, isPrivate, targetAmount, targetDate }) {
    setError('');
    try {
      await updatePocket(editingPocket.id, {
        owner_id: isPrivate ? profile.id : null,
        name,
        icon: POCKET_KINDS.find((k) => k.id === kind)?.icon || editingPocket.icon,
        kind,
        usage_type: usageType,
        is_private: isPrivate,
        target_amount: targetAmount,
        target_date: targetDate,
      });
      setEditingPocket(null);
      await load();
      await refresh();
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

  async function handleCorrectBalance(pocket, newBalance) {
    setError('');
    try {
      await correctPocketBalance(pocket.id, newBalance);
      setCorrectingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loadError) {
    return (
      <div className="text-center mt-20 px-4">
        <p className="text-4xl mb-2">⚠️</p>
        <p className="font-semibold mb-2">Impossible de charger Épargne</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 break-words">{loadError}</p>
      </div>
    );
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  const depenseAccounts = pockets.filter((p) => p.usage_type === 'depense');
  const epargneAccounts = pockets.filter((p) => p.usage_type !== 'depense');
  const totalEpargne = epargneAccounts.reduce((sum, p) => sum + Number(p.balance), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Nos comptes</h1>
      </header>

      <section className="bg-teal text-white rounded-card p-6 shadow-sm">
        <p className="text-sm text-white/80 font-medium">Total épargne du foyer</p>
        <p className="text-4xl font-extrabold mt-1">{totalEpargne.toLocaleString('fr-FR')} €</p>
      </section>

      {error && <p className="text-coral text-sm text-center">{error}</p>}

      {editingPocket && (
        <QuickAddPocketForm
          initial={editingPocket}
          onCancel={() => setEditingPocket(null)}
          onSubmit={handleUpdatePocket}
        />
      )}

      <section>
        <h2 className="font-semibold mb-3">Comptes de dépense</h2>
        <ul className="space-y-3">
          {depenseAccounts.map((p) => {
            const spentThisMonth = spentByPocket.get(p.id) || 0;
            const hasEnvelope = p.target_amount && Number(p.target_amount) > 0;
            const remaining = hasEnvelope ? Number(p.target_amount) - spentThisMonth : null;
            const canManage = !p.is_private || p.owner_id === profile.id;

            return (
              <li key={p.id} className="bg-white rounded-card p-4 shadow-sm">
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    {p.icon} {p.name}
                    {p.is_private && <span className="text-ink/30 text-xs"> · privé</span>}
                  </span>
                  <span className="font-semibold">{Number(p.balance).toLocaleString('fr-FR')} €</span>
                </div>

                {hasEnvelope && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-ink/50 mb-1">
                      <span>Enveloppe du mois</span>
                      <span>{spentThisMonth.toLocaleString('fr-FR')} € / {Number(p.target_amount).toLocaleString('fr-FR')} €</span>
                    </div>
                    <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                      <div
                        className="h-full bg-amber rounded-full"
                        style={{ width: `${Math.min(100, Math.round((spentThisMonth / p.target_amount) * 100))}%` }}
                      />
                    </div>
                    <p className="text-xs text-ink/40 mt-1">
                      {remaining >= 0 ? `Il reste ${remaining.toLocaleString('fr-FR')} €` : `Dépassement de ${Math.abs(remaining).toLocaleString('fr-FR')} €`}
                    </p>
                  </div>
                )}

                {canManage && (
                  <div className="flex justify-between items-center mt-3">
                    <button
                      onClick={() => setTransferringId(transferringId === p.id ? null : p.id)}
                      className="text-teal text-xs font-semibold"
                    >
                      {transferringId === p.id ? 'Annuler' : '+ Approvisionner'}
                    </button>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => setCorrectingId(correctingId === p.id ? null : p.id)} className="text-ink/50 font-medium">Corriger le solde</button>
                      <button onClick={() => openEdit(p)} className="text-teal font-medium">Modifier</button>
                      <button onClick={() => handleDelete(p)} className="text-coral font-medium">Supprimer</button>
                    </div>
                  </div>
                )}

                {transferringId === p.id && (
                  <TransferForm onSubmit={(amount) => handleTransfer(p, amount)} />
                )}
                {correctingId === p.id && (
                  <CorrectBalanceForm currentBalance={p.balance} onSubmit={(value) => handleCorrectBalance(p, value)} />
                )}
              </li>
            );
          })}
          {depenseAccounts.length === 0 && (
            <p className="text-center text-ink/40 text-sm py-4">Aucun compte de dépense pour l'instant.</p>
          )}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Notre épargne</h2>
        <ul className="space-y-3">
          {epargneAccounts.map((p) => {
            const goal = goalsByPocket.get(p.id);
            const monthlyProgress = goal
              ? computeGoalProgress({ plannedAmount: goal.planned_amount, actualPaidIn: goal.actual_paid_in })
              : null;
            const hasTarget = p.target_amount && Number(p.target_amount) > 0;
            const targetRatio = hasTarget ? Math.min(1, Number(p.balance) / Number(p.target_amount)) : 0;
            const remainingToTarget = hasTarget ? Math.max(0, Number(p.target_amount) - Number(p.balance)) : 0;
            const canManage = !p.is_private || p.owner_id === profile.id;

            return (
              <li key={p.id} className="bg-white rounded-card p-4 shadow-sm">
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    {p.icon} {p.name}
                    {p.is_private && <span className="text-ink/30 text-xs"> · privé</span>}
                  </span>
                  <span className="font-semibold">{Number(p.balance).toLocaleString('fr-FR')} €</span>
                </div>

                {hasTarget && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-ink/50 mb-1">
                      <span>
                        Objectif : {Number(p.target_amount).toLocaleString('fr-FR')} €
                        {p.target_date && ` · ${new Date(p.target_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`}
                      </span>
                      <span>reste {remainingToTarget.toLocaleString('fr-FR')} €</span>
                    </div>
                    <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                      <div className="h-full bg-teal rounded-full" style={{ width: `${Math.round(targetRatio * 100)}%` }} />
                    </div>
                  </div>
                )}

                {monthlyProgress && monthlyProgress.planned > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-ink/50 mb-1">
                      <span>Versé ce mois-ci</span>
                      <span>{monthlyProgress.paid.toLocaleString('fr-FR')} € / {monthlyProgress.planned.toLocaleString('fr-FR')} €</span>
                    </div>
                    <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                      <div className="h-full bg-amber rounded-full" style={{ width: `${Math.round(monthlyProgress.ratio * 100)}%` }} />
                    </div>
                  </div>
                )}

                {canManage && (
                  <div className="flex justify-between items-center mt-3">
                    <button
                      onClick={() => setTransferringId(transferringId === p.id ? null : p.id)}
                      className="text-teal text-xs font-semibold"
                    >
                      {transferringId === p.id ? 'Annuler' : '+ Verser'}
                    </button>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => setCorrectingId(correctingId === p.id ? null : p.id)} className="text-ink/50 font-medium">Corriger le solde</button>
                      <button onClick={() => openEdit(p)} className="text-teal font-medium">Modifier</button>
                      <button onClick={() => handleDelete(p)} className="text-coral font-medium">Supprimer</button>
                    </div>
                  </div>
                )}

                {transferringId === p.id && (
                  <TransferForm onSubmit={(amount) => handleTransfer(p, amount)} />
                )}
                {correctingId === p.id && (
                  <CorrectBalanceForm currentBalance={p.balance} onSubmit={(value) => handleCorrectBalance(p, value)} />
                )}
              </li>
            );
          })}
          {epargneAccounts.length === 0 && (
            <p className="text-center text-ink/40 text-sm py-4">Aucun compte d'épargne pour l'instant.</p>
          )}
        </ul>
      </section>

      {showAddPocket ? (
        <QuickAddPocketForm onCancel={() => setShowAddPocket(false)} onSubmit={handleAddPocket} />
      ) : (
        !editingPocket && (
          <button
            onClick={() => setShowAddPocket(true)}
            className="w-full bg-white border border-teal-light text-teal font-semibold rounded-card py-4"
          >
            + Ajouter un compte
          </button>
        )
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

/**
 * Distinct de "+Verser" : fixe directement le solde réel du compte (ex.
 * rattraper de l'argent déjà mis de côté avant d'utiliser l'app), sans
 * jamais toucher l'objectif ni le "versé" d'aucun mois.
 */
function CorrectBalanceForm({ currentBalance, onSubmit }) {
  const [amount, setAmount] = useState(String(currentBalance ?? ''));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const value = Number(String(amount).replace(',', '.'));
    if (Number.isNaN(value) || value < 0) return;
    setSubmitting(true);
    await onSubmit(value);
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2">
      <p className="text-xs text-ink/50">
        Solde réel actuel du compte — ne compte dans le "versé" d'aucun mois, sert juste à rattraper la réalité.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Solde réel"
            autoFocus
            className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-ink/70 text-white text-sm font-semibold rounded-xl px-4 disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </form>
  );
}

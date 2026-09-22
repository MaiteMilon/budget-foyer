import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { computeGoalProgress } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';
import { signOut } from '../lib/auth.js';
import { addMonthsISO, monthLabel, isNearMonthEnd } from '../lib/date-utils.js';
import {
  getMonthSavingsGoals,
  getMonthExpenses,
  getBudgetMonthForUser,
  getHouseholdPockets,
  getHouseholdMembers,
} from '../lib/data.js';
import { loadMemberBudget } from '../lib/memberBudget.js';
import { getHouseholdProjects, createProject, contributeToProject } from '../lib/projects.js';
import { recordPocketTransfer } from '../lib/transfers.js';

export default function Dashboard() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [memberBudgets, setMemberBudgets] = useState([]);
  const [combinedGoals, setCombinedGoals] = useState([]);
  const [depenseAccounts, setDepenseAccounts] = useState([]);
  const [spentByPocket, setSpentByPocket] = useState(new Map());
  const [projects, setProjects] = useState([]);
  const [nextMonthToPrep, setNextMonthToPrep] = useState(null); // '2026-10-01' si à préparer, sinon null
  const [transferringGoalId, setTransferringGoalId] = useState(null);
  const [goalError, setGoalError] = useState('');

  async function handleGoalTransfer(pocket, amount) {
    setGoalError('');
    try {
      await recordPocketTransfer({
        householdId: profile.household_id,
        userId: profile.id,
        budgetMonthId: currentBudgetMonth.id,
        pocket,
        amount,
      });
      setTransferringGoalId(null);
      await load();
      await refresh();
    } catch (err) {
      setGoalError(err.message);
    }
  }

  async function loadProjects() {
    const data = await getHouseholdProjects(profile.household_id);
    setProjects(data);
  }

  async function load() {
    if (!currentBudgetMonth) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [members, expenses, pockets, projectsList] = await Promise.all([
        getHouseholdMembers(profile.household_id),
        getMonthExpenses(currentBudgetMonth.id, profile.id),
        getHouseholdPockets(profile.household_id),
        getHouseholdProjects(profile.household_id),
      ]);

      const budgets = await Promise.all(
        members.map((m) => loadMemberBudget(m, currentBudgetMonth.month))
      );
      setMemberBudgets(budgets);

      // Objectifs du mois : pour un compte COMMUN, on combine l'objectif
      // et le "versé" des deux membres (chacun a son propre objectif
      // stocké dans son propre mois budgétaire) — avec le détail par
      // personne. Pour un compte privé, uniquement le sien.
      const goalsByMember = await Promise.all(
        members.map(async (m) => {
          const month = await getBudgetMonthForUser(m.id, currentBudgetMonth.month);
          if (!month) return { member: m, goals: [] };
          const goals = await getMonthSavingsGoals(month.id);
          return { member: m, goals };
        })
      );

      const combined = pockets
        .filter((p) => p.usage_type !== 'depense')
        .map((p) => {
          const perMember = goalsByMember
            .filter(({ member }) => !p.is_private || member.id === profile.id)
            .map(({ member, goals }) => {
              const g = goals.find((g) => g.pocket_id === p.id);
              return { member, planned: Number(g?.planned_amount) || 0, paid: Number(g?.actual_paid_in) || 0 };
            });
          const totalPlanned = perMember.reduce((s, x) => s + x.planned, 0);
          const totalPaid = perMember.reduce((s, x) => s + x.paid, 0);
          return { pocket: p, totalPlanned, totalPaid, perMember };
        })
        .filter((g) => g.totalPlanned > 0);
      setCombinedGoals(combined);

      setDepenseAccounts(pockets.filter((p) => p.usage_type === 'depense'));
      setProjects(projectsList);

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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBudgetMonth, profile]);

  // Bannière "Préparer [mois suivant]" : seulement dans les derniers jours
  // du mois, seulement si le mois EN COURS est déjà préparé (pas de sens
  // sinon), et seulement si le mois suivant n'est pas déjà démarré.
  useEffect(() => {
    let cancelled = false;
    async function checkNextMonth() {
      if (!currentBudgetMonth?.started_at || !isNearMonthEnd()) {
        setNextMonthToPrep(null);
        return;
      }
      const nextMonthISO = addMonthsISO(currentBudgetMonth.month, 1);
      const nextMonth = await getBudgetMonthForUser(profile.id, nextMonthISO);
      if (cancelled) return;
      setNextMonthToPrep(!nextMonth || !nextMonth.started_at ? nextMonthISO : null);
    }
    checkNextMonth();
    return () => { cancelled = true; };
  }, [currentBudgetMonth, profile]);

  if (loadError) {
    return (
      <div className="text-center mt-20 px-4">
        <p className="text-4xl mb-2">⚠️</p>
        <p className="font-semibold mb-2">Impossible de charger l'Accueil</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 break-words">{loadError}</p>
      </div>
    );
  }

  if (loading) {
    return <p className="text-center text-ink/50 mt-20">Chargement…</p>;
  }

  const prepared = memberBudgets.filter((b) => b.budget);
  const householdTotals = prepared.length > 0
    ? {
        initialBudget: prepared.reduce((s, b) => s + b.budget.initialBudget, 0),
        totalSpent: prepared.reduce((s, b) => s + b.budget.totalSpent, 0),
        remaining: prepared.reduce((s, b) => s + b.budget.remaining, 0),
      }
    : null;
  const spentRatio = householdTotals && householdTotals.initialBudget > 0
    ? Math.min(1, Math.max(0, householdTotals.totalSpent / householdTotals.initialBudget))
    : 0;

  return (
    <div className="space-y-5">
      <header className="flex justify-between items-start">
        <div>
          <p className="text-ink/60 text-sm">Bonjour</p>
          <h1 className="text-2xl font-bold">{profile.display_name}</h1>
        </div>
        <button
          onClick={async () => { await signOut(); await refresh(); }}
          className="text-xs text-ink/40 underline mt-2"
        >
          Déconnexion
        </button>
      </header>

      {!currentBudgetMonth.started_at && (
        <Link
          to="/preparer"
          className="block bg-amber-light text-amber rounded-card px-4 py-3 text-sm font-semibold"
        >
          Préparez votre mois pour voir votre budget disponible →
        </Link>
      )}

      {nextMonthToPrep && (
        <Link
          to={`/preparer?month=${nextMonthToPrep}`}
          className="block bg-teal-light text-teal-dark rounded-card px-4 py-3 text-sm font-semibold"
        >
          Préparer {monthLabel(nextMonthToPrep)} →
        </Link>
      )}

      <section className="bg-teal text-white rounded-card p-6 shadow-sm">
        <p className="text-sm text-white/80 font-medium">Reste à dépenser du foyer</p>
        {householdTotals ? (
          <>
            <p className="text-5xl font-extrabold tracking-tight mt-1">
              {householdTotals.remaining.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
            </p>
            <div className="mt-4 h-2 rounded-full bg-white/20 overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${Math.round(spentRatio * 100)}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-white/70">Budget initial</dt>
                <dd className="font-semibold">{householdTotals.initialBudget.toLocaleString('fr-FR')} €</dd>
              </div>
              <div>
                <dt className="text-white/70">Dépensé</dt>
                <dd className="font-semibold">{householdTotals.totalSpent.toLocaleString('fr-FR')} €</dd>
              </div>
              <div>
                <dt className="text-white/70">Reste</dt>
                <dd className="font-semibold">{householdTotals.remaining.toLocaleString('fr-FR')} €</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-2xl font-bold mt-1">— €</p>
        )}
        {prepared.length < memberBudgets.length && (
          <p className="text-xs text-white/70 mt-3">
            {prepared.length === 0
              ? "Personne n'a encore préparé ce mois-ci."
              : "L'autre membre n'a pas encore préparé son mois — ce total ne compte que ce qui est déjà prêt."}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-white/20 space-y-3">
          {memberBudgets.map(({ member, budget }) => (
            <div key={member.id}>
              <p className="text-sm font-medium mb-1">{member.display_name}</p>
              {budget ? (
                <dl className="grid grid-cols-3 gap-2 text-xs text-white/80">
                  <div>
                    <dt>Budget initial</dt>
                    <dd className="font-semibold text-white">{budget.initialBudget.toLocaleString('fr-FR')} €</dd>
                  </div>
                  <div>
                    <dt>Dépensé</dt>
                    <dd className="font-semibold text-white">{budget.totalSpent.toLocaleString('fr-FR')} €</dd>
                  </div>
                  <div>
                    <dt>Reste</dt>
                    <dd className="font-semibold text-white">{budget.remaining.toLocaleString('fr-FR')} €</dd>
                  </div>
                </dl>
              ) : (
                <span className="text-white/60 text-xs">Mois non préparé</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {depenseAccounts.length > 0 && (
        <section className="bg-white rounded-card p-5 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Nos comptes</h2>
            <Link to="/epargne" className="text-xs text-teal underline">Gérer</Link>
          </div>
          <ul className="space-y-3">
            {depenseAccounts.map((a) => {
              const spent = spentByPocket.get(a.id) || 0;
              const hasEnvelope = a.target_amount && Number(a.target_amount) > 0;
              return (
                <li key={a.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{a.icon} {a.name}</span>
                    <span className="text-ink/60">{Number(a.balance).toLocaleString('fr-FR')} €</span>
                  </div>
                  {hasEnvelope && (
                    <p className="text-xs text-ink/40 mt-0.5">
                      {spent.toLocaleString('fr-FR')} € dépensés / {Number(a.target_amount).toLocaleString('fr-FR')} € ce mois-ci
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Objectifs du mois</h2>
        {combinedGoals.length === 0 && (
          <p className="text-sm text-ink/40">Aucun objectif défini pour ce mois — ajoutez vos comptes d'épargne.</p>
        )}
        <ul className="space-y-4">
          {combinedGoals.map(({ pocket, totalPlanned, totalPaid, perMember }) => {
            const progress = computeGoalProgress({ plannedAmount: totalPlanned, actualPaidIn: totalPaid });
            return (
              <li key={pocket.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{pocket.icon} {pocket.name}</span>
                  <span className="text-ink/60">
                    {progress.paid.toLocaleString('fr-FR')} € / {progress.planned.toLocaleString('fr-FR')} €
                    {progress.isComplete ? ' ✓' : ''}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                  <div
                    className="h-full bg-amber rounded-full transition-all"
                    style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-ink/40 mt-1">
                  Solde actuel du compte : {Number(pocket.balance).toLocaleString('fr-FR')} €
                </p>
                {perMember.length > 1 && (
                  <ul className="text-xs text-ink/50 mt-1 space-y-0.5">
                    {perMember.map(({ member, paid }) => (
                      <li key={member.id}>{paid.toLocaleString('fr-FR')} € versés par {member.display_name}</li>
                    ))}
                  </ul>
                )}
                <button
                  onClick={() => setTransferringGoalId(transferringGoalId === pocket.id ? null : pocket.id)}
                  className="text-teal text-xs font-semibold mt-1"
                >
                  {transferringGoalId === pocket.id ? 'Annuler' : '+ Verser'}
                </button>
                {transferringGoalId === pocket.id && (
                  <ContributeForm onSubmit={(amount) => handleGoalTransfer(pocket, amount)} />
                )}
              </li>
            );
          })}
        </ul>
        {goalError && <p className="text-coral text-xs text-center mt-2">{goalError}</p>}
      </section>

      <ProjectsCard profile={profile} projects={projects} onChanged={loadProjects} />

      {memberBudgets.length > 0 && (
        <section className="bg-white rounded-card p-5 shadow-sm">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Budget</h2>
            <Link to="/preparer" className="text-xs text-teal underline">
              Modifier ma préparation
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-normal text-ink/50 text-xs pb-2"></th>
                  {memberBudgets.map(({ member }) => (
                    <th key={member.id} className="text-right font-medium text-xs pb-2 pl-3">{member.display_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-light">
                <BudgetRow label="Revenus" memberBudgets={memberBudgets} getValue={(b) => b.totalIncome} />
                <BudgetRow label="Charges fixes" memberBudgets={memberBudgets} getValue={(b) => -b.totalFixedCharges} />
                <BudgetRow label="Épargne prévue" memberBudgets={memberBudgets} getValue={(b) => -b.totalPlannedSavings} />
                <BudgetRow label="Marge de sécurité" memberBudgets={memberBudgets} getValue={(b) => -b.safetyMargin} />
                <BudgetRow label="Dépenses" memberBudgets={memberBudgets} getValue={(b) => -b.totalSpent} strong />
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function BudgetRow({ label, memberBudgets, getValue, strong }) {
  return (
    <tr>
      <td className={`py-2 ${strong ? 'font-semibold' : 'text-ink/70'}`}>{label}</td>
      {memberBudgets.map(({ member, budget }) => {
        if (!budget) {
          return <td key={member.id} className="py-2 pl-3 text-right text-ink/30 text-xs">—</td>;
        }
        const value = getValue(budget);
        const positive = value >= 0;
        return (
          <td key={member.id} className={`py-2 pl-3 text-right font-medium ${positive ? 'text-teal' : 'text-coral'}`}>
            {positive ? '+' : ''}{value.toLocaleString('fr-FR')} €
          </td>
        );
      })}
    </tr>
  );
}

/**
 * "Mes projets" — totalement indépendant des comptes et d'"Objectifs du
 * mois" (§ demande explicite après confusion). Un simple but chiffré,
 * qu'on alimente manuellement (ex. argent physique mis de côté dans une
 * boîte à la maison) ; ne touche jamais le budget ni aucun compte.
 */
function ProjectsCard({ profile, projects, onChanged }) {
  const [creating, setCreating] = useState(false);
  const [contributingId, setContributingId] = useState(null);
  const [error, setError] = useState('');

  async function handleCreate({ name, targetAmount, targetDate, isPrivate }) {
    setError('');
    try {
      await createProject({
        householdId: profile.household_id,
        ownerId: profile.id,
        name,
        targetAmount,
        targetDate,
        isPrivate,
      });
      setCreating(false);
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleContribute(project, amount) {
    setError('');
    try {
      await contributeToProject(project, amount);
      setContributingId(null);
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="bg-white rounded-card p-5 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Mes projets</h2>
        <button onClick={() => setCreating(!creating)} className="text-lg" aria-label="Ajouter un projet">
          ✏️
        </button>
      </div>

      {error && <p className="text-coral text-xs text-center mb-2">{error}</p>}

      {creating && (
        <ProjectForm onCancel={() => setCreating(false)} onSubmit={handleCreate} />
      )}

      {projects.length === 0 && !creating && (
        <p className="text-sm text-ink/40">Aucun projet pour l'instant — appuyez sur ✏️ pour en créer un.</p>
      )}

      <ul className="space-y-4">
        {projects.map((p) => {
          const ratio = Math.min(1, Number(p.current_amount) / Number(p.target_amount));
          const remaining = Math.max(0, Number(p.target_amount) - Number(p.current_amount));
          const canManage = !p.is_private || p.owner_id === profile.id;
          return (
            <li key={p.id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">
                  {p.name}
                  {p.is_private && <span className="text-ink/30 text-xs"> · privé</span>}
                  {p.target_date && (
                    <span className="text-ink/40 font-normal">
                      {' '}· {new Date(p.target_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                    </span>
                  )}
                </span>
                <span className="text-ink/60">
                  {Number(p.current_amount).toLocaleString('fr-FR')} € / {Number(p.target_amount).toLocaleString('fr-FR')} €
                </span>
              </div>
              <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                <div className="h-full bg-teal rounded-full transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
              {remaining > 0 && (
                <p className="text-xs text-ink/40 mt-1">Il reste {remaining.toLocaleString('fr-FR')} € à mettre de côté</p>
              )}
              {canManage && (
                <>
                  <button
                    onClick={() => setContributingId(contributingId === p.id ? null : p.id)}
                    className="text-teal text-xs font-semibold mt-1"
                  >
                    {contributingId === p.id ? 'Annuler' : '+ Verser'}
                  </button>
                  {contributingId === p.id && (
                    <ContributeForm onSubmit={(amount) => handleContribute(p, amount)} />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProjectForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const value = Number(targetAmount.replace(',', '.'));
    if (!name || !value) return;
    setSubmitting(true);
    await onSubmit({ name, targetAmount: value, targetDate, isPrivate });
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="border border-teal-light rounded-2xl p-3 space-y-2 mb-4">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du projet (ex. Achat tablette)"
        required
        autoFocus
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      />
      <div className="relative">
        <input
          inputMode="decimal"
          value={targetAmount}
          onChange={(e) => setTargetAmount(e.target.value)}
          placeholder="Somme visée"
          required
          className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
      </div>
      <div>
        <label className="text-xs text-ink/60">Date limite (optionnel)</label>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink/60">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Projet privé (visible de moi seul·e)
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 text-sm text-ink/50 py-2">Annuler</button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-teal text-white text-sm font-semibold rounded-xl py-2 disabled:opacity-50"
        >
          Créer
        </button>
      </div>
    </form>
  );
}

function ContributeForm({ onSubmit }) {
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
    <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
      <div className="relative flex-1">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Montant versé"
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

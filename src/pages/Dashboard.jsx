import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { computeMonthlyBudget, computeGoalProgress } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';
import { signOut } from '../lib/auth.js';
import { addMonthsISO, monthLabel, isNearMonthEnd } from '../lib/date-utils.js';
import {
  getMonthIncomes,
  getMonthSavingsGoals,
  getMonthFixedCharges,
  getMonthExpenses,
  getBudgetMonthForUser,
  getHouseholdPockets,
} from '../lib/data.js';

export default function Dashboard() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [budget, setBudget] = useState(null);
  const [goals, setGoals] = useState([]);
  const [pocketsWithTarget, setPocketsWithTarget] = useState([]);
  const [depenseAccounts, setDepenseAccounts] = useState([]);
  const [spentByPocket, setSpentByPocket] = useState(new Map());
  const [nextMonthToPrep, setNextMonthToPrep] = useState(null); // '2026-10-01' si à préparer, sinon null

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!currentBudgetMonth) return;
      setLoading(true);
      setLoadError(null);
      try {
        const [incomes, monthGoals, charges, expenses, pockets] = await Promise.all([
          getMonthIncomes(currentBudgetMonth.id),
          getMonthSavingsGoals(currentBudgetMonth.id),
          getMonthFixedCharges(currentBudgetMonth.id),
          getMonthExpenses(currentBudgetMonth.id, profile.id),
          getHouseholdPockets(profile.household_id),
        ]);
        if (cancelled) return;

        setBudget(
          computeMonthlyBudget({
            safetyMargin: currentBudgetMonth.safety_margin,
            incomes,
            savingsGoals: monthGoals.map((g) => ({ plannedAmount: g.planned_amount })),
            fixedCharges: charges,
            expenses: expenses.map((e) => ({ amount: e.amount, sourceType: e.source_type, pocketUsageType: e.source_pocket?.usage_type })),
          })
        );
        setGoals(
          monthGoals.map((g) => ({
            pocket: g.pocket,
            plannedAmount: g.planned_amount,
            actualPaidIn: g.actual_paid_in,
          }))
        );
        setPocketsWithTarget(pockets.filter((p) => p.target_amount && Number(p.target_amount) > 0 && p.usage_type !== 'depense'));
        setDepenseAccounts(pockets.filter((p) => p.usage_type === 'depense'));

        const spentMap = new Map();
        expenses.forEach((e) => {
          if (!e.source_pocket_id) return;
          spentMap.set(e.source_pocket_id, (spentMap.get(e.source_pocket_id) || 0) + Number(e.amount));
        });
        setSpentByPocket(spentMap);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
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

  if (loading || !budget) {
    return <p className="text-center text-ink/50 mt-20">Chargement…</p>;
  }

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
        <p className="text-sm text-white/80 font-medium">Reste à dépenser ce mois-ci</p>
        <p className="text-5xl font-extrabold tracking-tight mt-1">
          {budget.remaining.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
        </p>

        <div className="mt-4 h-2 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-white rounded-full transition-all"
            style={{ width: `${Math.round(budget.spentRatio * 100)}%` }}
          />
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-white/70">Budget initial</dt>
            <dd className="font-semibold">{budget.initialBudget.toLocaleString('fr-FR')} €</dd>
          </div>
          <div>
            <dt className="text-white/70">Dépensé</dt>
            <dd className="font-semibold">{budget.totalSpent.toLocaleString('fr-FR')} €</dd>
          </div>
          <div>
            <dt className="text-white/70">Reste</dt>
            <dd className="font-semibold">{budget.remaining.toLocaleString('fr-FR')} €</dd>
          </div>
        </dl>
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
        {goals.length === 0 && (
          <p className="text-sm text-ink/40">Aucun objectif défini pour ce mois — ajoutez vos comptes d'épargne.</p>
        )}
        <ul className="space-y-4">
          {goals.map((g, i) => {
            const progress = computeGoalProgress({
              plannedAmount: g.plannedAmount,
              actualPaidIn: g.actualPaidIn,
            });
            return (
              <li key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{g.pocket?.icon} {g.pocket?.name}</span>
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
              </li>
            );
          })}
        </ul>
      </section>

      {pocketsWithTarget.length > 0 && (
        <section className="bg-white rounded-card p-5 shadow-sm">
          <h2 className="font-semibold mb-3">Objectifs d'épargne</h2>
          <ul className="space-y-4">
            {pocketsWithTarget.map((p) => {
              const ratio = Math.min(1, Number(p.balance) / Number(p.target_amount));
              const remaining = Math.max(0, Number(p.target_amount) - Number(p.balance));
              return (
                <li key={p.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">
                      {p.icon} {p.name}
                      {p.target_date && (
                        <span className="text-ink/40 font-normal">
                          {' '}· {new Date(p.target_date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                        </span>
                      )}
                    </span>
                    <span className="text-ink/60">
                      {Number(p.balance).toLocaleString('fr-FR')} € / {Number(p.target_amount).toLocaleString('fr-FR')} €
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-teal-light overflow-hidden">
                    <div
                      className="h-full bg-teal rounded-full transition-all"
                      style={{ width: `${Math.round(ratio * 100)}%` }}
                    />
                  </div>
                  {remaining > 0 && (
                    <p className="text-xs text-ink/40 mt-1">Il reste {remaining.toLocaleString('fr-FR')} € à mettre de côté</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="bg-white rounded-card p-5 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Mon budget</h2>
          <Link to="/preparer" className="text-xs text-teal underline">
            Modifier ma préparation
          </Link>
        </div>
        <dl className="text-sm divide-y divide-teal-light">
          <Row label="Revenus" value={budget.totalIncome} />
          <Row label="Charges fixes" value={-budget.totalFixedCharges} />
          <Row label="Épargne prévue" value={-budget.totalPlannedSavings} />
          <Row label="Marge de sécurité" value={-budget.safetyMargin} />
          <Row label="Dépenses" value={-budget.totalSpent} strong />
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value, strong }) {
  const positive = value >= 0;
  return (
    <div className="flex justify-between py-2">
      <span className={strong ? 'font-semibold' : 'text-ink/70'}>{label}</span>
      <span className={`font-medium ${positive ? 'text-teal' : 'text-coral'}`}>
        {positive ? '+' : ''}{value.toLocaleString('fr-FR')} €
      </span>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getHouseholdActivity, inviteLink, createInvite } from '../lib/household.js';
import { useApp } from '../context/AppContext.jsx';
import {
  getHouseholdMembers,
  getBudgetMonthForUser,
  getMonthIncomes,
  getMonthSavingsGoals,
  getMonthFixedCharges,
  getMonthExpenses,
  getHouseholdPockets,
} from '../lib/data.js';
import { computeMonthlyBudget, computeHouseholdView } from '../lib/budget-engine.js';

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

/** Charge le budget calculé d'un membre pour ce mois, ou null s'il n'a rien préparé. */
async function loadMemberBudget(member, monthISO) {
  const month = await getBudgetMonthForUser(member.id, monthISO);
  if (!month) return { member, month: null, budget: null };

  const [incomes, goals, charges, expenses] = await Promise.all([
    getMonthIncomes(month.id),
    getMonthSavingsGoals(month.id),
    getMonthFixedCharges(month.id),
    getMonthExpenses(month.id, member.id),
  ]);

  const budget = computeMonthlyBudget({
    safetyMargin: month.safety_margin,
    incomes,
    savingsGoals: goals.map((g) => ({ plannedAmount: g.planned_amount })),
    fixedCharges: charges,
    expenses: expenses.map((e) => ({ amount: e.amount, sourceType: e.source_type })),
  });

  return { member, month, budget };
}

export default function Foyer() {
  const { profile, currentBudgetMonth } = useApp();
  const [members, setMembers] = useState([]);
  const [memberBudgets, setMemberBudgets] = useState([]);
  const [pockets, setPockets] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteMsg, setInviteMsg] = useState('');

  async function load() {
    setLoading(true);
    const [householdMembers, householdPockets, activityLog] = await Promise.all([
      getHouseholdMembers(profile.household_id),
      getHouseholdPockets(profile.household_id),
      getHouseholdActivity(profile.household_id),
    ]);
    setMembers(householdMembers);
    setPockets(householdPockets);
    setActivity(activityLog);

    const budgets = await Promise.all(
      householdMembers.map((m) => loadMemberBudget(m, currentBudgetMonth.month))
    );
    setMemberBudgets(budgets);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile.household_id, currentBudgetMonth.month]);

  async function handleNewInvite() {
    const invite = await createInvite(profile.household_id, profile.id);
    await navigator.clipboard?.writeText(inviteLink(invite.code));
    setInviteMsg(`Lien copié — code ${invite.code}`);
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  const prepared = memberBudgets.filter((b) => b.budget);
  const householdView =
    prepared.length === 2
      ? computeHouseholdView(prepared[0].budget, prepared[1].budget, pockets)
      : null;
  const totalSavingsBalance = pockets.reduce((sum, p) => sum + Number(p.balance), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Notre foyer</h1>
        <p className="text-ink/60 text-sm mt-1">
          Revenus, dépenses et épargne cumulés des deux membres.
        </p>
      </header>

      {householdView ? (
        <section className="bg-teal text-white rounded-card p-6 shadow-sm space-y-3">
          <div>
            <p className="text-sm text-white/80 font-medium">Revenus du foyer ce mois-ci</p>
            <p className="text-3xl font-extrabold mt-1">
              {householdView.totalIncome.toLocaleString('fr-FR')} €
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-white/20">
            <div>
              <dt className="text-white/70">Dépensé ce mois-ci</dt>
              <dd className="font-semibold">{householdView.totalSpent.toLocaleString('fr-FR')} €</dd>
            </div>
            <div>
              <dt className="text-white/70">Épargne prévue ce mois-ci</dt>
              <dd className="font-semibold">{householdView.totalPlannedSavings.toLocaleString('fr-FR')} €</dd>
            </div>
            <div>
              <dt className="text-white/70">Épargne totale du foyer</dt>
              <dd className="font-semibold">{totalSavingsBalance.toLocaleString('fr-FR')} €</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section className="bg-amber-light text-amber rounded-card p-4 text-sm">
          {prepared.length === 0
            ? "Personne n'a encore préparé ce mois-ci."
            : `${members.length - prepared.length} membre(s) n'a/n'ont pas encore préparé ce mois-ci — la vue combinée s'affichera dès que tout le monde l'aura fait.`}
        </section>
      )}

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Reste disponible par personne</h2>
        <ul className="space-y-3">
          {memberBudgets.map(({ member, budget }) => (
            <li key={member.id} className="flex justify-between items-center">
              <span className="font-medium">{member.display_name}</span>
              {budget ? (
                <span className="font-semibold text-teal">{budget.remaining.toLocaleString('fr-FR')} €</span>
              ) : (
                <span className="text-xs text-ink/40">Mois non préparé</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Nos poches d'épargne</h2>
        <ul className="space-y-2">
          {pockets.map((p) => (
            <li key={p.id} className="flex justify-between text-sm">
              <span>{p.icon} {p.name}</span>
              <span className="font-medium">{Number(p.balance).toLocaleString('fr-FR')} €</span>
            </li>
          ))}
          {pockets.length === 0 && <p className="text-sm text-ink/40">Aucune poche pour l'instant.</p>}
        </ul>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold">Historique des actions communes</h2>
          <button onClick={handleNewInvite} className="text-xs text-teal underline">
            Inviter
          </button>
        </div>
        {inviteMsg && <p className="text-xs text-teal mb-2">{inviteMsg}</p>}

        <ul className="space-y-3">
          {activity.map((entry) => (
            <li key={entry.id} className="text-sm flex justify-between gap-2">
              <span>
                <span className="font-medium">{entry.actor?.display_name || "Quelqu'un"}</span>{' '}
                — {entry.message}
              </span>
              <span className="text-ink/40 whitespace-nowrap text-xs mt-0.5">
                {timeAgo(entry.created_at)}
              </span>
            </li>
          ))}
          {activity.length === 0 && (
            <p className="text-sm text-ink/40">Aucune action commune pour l'instant.</p>
          )}
        </ul>
        <p className="text-xs text-ink/30 mt-3">
          Les envies d'achat privées n'apparaissent jamais ici, quel que soit le membre.
        </p>
      </section>
    </div>
  );
}

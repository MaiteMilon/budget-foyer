import { useEffect, useState } from 'react';
import { getHouseholdActivity, inviteLink, createInvite, getActiveInvite } from '../lib/household.js';
import { useApp } from '../context/AppContext.jsx';
import {
  getHouseholdMembers,
  getHouseholdPockets,
} from '../lib/data.js';
import { loadMemberBudget } from '../lib/memberBudget.js';
import { computeHouseholdView } from '../lib/budget-engine.js';

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

export default function Foyer() {
  const { profile, currentBudgetMonth } = useApp();
  const [members, setMembers] = useState([]);
  const [memberBudgets, setMemberBudgets] = useState([]);
  const [pockets, setPockets] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [activeInvite, setActiveInvite] = useState(null);
  const [inviteMsg, setInviteMsg] = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [householdMembers, householdPockets, activityLog, invite] = await Promise.all([
        getHouseholdMembers(profile.household_id),
        getHouseholdPockets(profile.household_id),
        getHouseholdActivity(profile.household_id),
        getActiveInvite(profile.household_id),
      ]);
      setMembers(householdMembers);
      setPockets(householdPockets);
      setActivity(activityLog);
      setActiveInvite(invite);

      const budgets = await Promise.all(
        householdMembers.map((m) => loadMemberBudget(m, currentBudgetMonth.month))
      );
      setMemberBudgets(budgets);
    } catch (err) {
      setLoadError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [profile.household_id, currentBudgetMonth.month]);

  async function handleNewInvite() {
    setGeneratingInvite(true);
    setInviteMsg('');
    try {
      const invite = await createInvite(profile.household_id, profile.id);
      setActiveInvite(invite);
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function handleCopyInvite() {
    if (!activeInvite) return;
    await navigator.clipboard?.writeText(inviteLink(activeInvite.code));
    setInviteMsg('Lien copié !');
  }

  if (loadError) {
    return (
      <div className="text-center mt-20 px-4">
        <p className="text-4xl mb-2">⚠️</p>
        <p className="font-semibold mb-2">Impossible de charger Foyer</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 break-words">{loadError}</p>
      </div>
    );
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  // "Notre foyer" est la vue COMMUNE : un compte privé n'y apparaît
  // jamais, même le sien propre — c'est justement ce que "privé" veut
  // dire, y compris dans les totaux affichés ici.
  const sharedPockets = pockets.filter((p) => !p.is_private);

  const prepared = memberBudgets.filter((b) => b.budget);
  const householdView =
    prepared.length === 2
      ? computeHouseholdView(prepared[0].budget, prepared[1].budget, sharedPockets)
      : null;
  const totalSavingsBalance = sharedPockets.reduce((sum, p) => sum + Number(p.balance), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Notre foyer</h1>
        <p className="text-ink/60 text-sm mt-1">
          Revenus, dépenses et épargne cumulés des deux membres.
        </p>
      </header>

      {members.length < 2 && (
        <section className="bg-white rounded-card p-5 shadow-sm">
          <h2 className="font-semibold mb-1">Inviter l'autre membre du foyer</h2>
          <p className="text-xs text-ink/50 mb-3">
            Le lien expire après 7 jours — régénérez-en un nouveau s'il ne fonctionne plus.
          </p>

          {activeInvite ? (
            <>
              <div className="bg-teal-light rounded-2xl p-4 text-center mb-3">
                <p className="text-xs text-ink/50 mb-1">Code d'invitation</p>
                <p className="text-3xl font-extrabold tracking-widest text-teal">{activeInvite.code}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopyInvite}
                  className="flex-1 bg-teal text-white text-sm font-semibold rounded-xl py-3"
                >
                  Copier le lien
                </button>
                <button
                  onClick={handleNewInvite}
                  disabled={generatingInvite}
                  className="flex-1 bg-white border border-teal-light text-teal text-sm font-semibold rounded-xl py-3 disabled:opacity-50"
                >
                  {generatingInvite ? '…' : 'Nouveau code'}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={handleNewInvite}
              disabled={generatingInvite}
              className="w-full bg-teal text-white font-semibold rounded-card py-3 disabled:opacity-50"
            >
              {generatingInvite ? 'Génération…' : "Générer un code d'invitation"}
            </button>
          )}
          {inviteMsg && <p className="text-xs text-teal text-center mt-2">{inviteMsg}</p>}
        </section>
      )}

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
        <h2 className="font-semibold mb-3">Nos comptes</h2>
        <ul className="space-y-2">
          {sharedPockets.map((p) => (
            <li key={p.id} className="flex justify-between text-sm">
              <span>{p.icon} {p.name}</span>
              <span className="font-medium">{Number(p.balance).toLocaleString('fr-FR')} €</span>
            </li>
          ))}
          {sharedPockets.length === 0 && <p className="text-sm text-ink/40">Aucun compte pour l'instant.</p>}
        </ul>
      </section>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Historique des actions communes</h2>

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

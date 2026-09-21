import { useEffect, useState } from 'react';
import {
  getMyWishlist,
  addWishlistItem,
  markWishlistPurchased,
  dismissWishlistItem,
  getHouseholdPockets,
  addExpense,
  getMonthIncomes,
  getMonthSavingsGoals,
  getMonthFixedCharges,
  getMonthExpenses,
} from '../lib/data.js';
import { createInstallmentPlan } from '../lib/installments.js';
import { computeReflectUntil, computeMonthlyBudget } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';
import { signOut } from '../lib/auth.js';

const DELAYS = [
  { id: 'none', label: 'Aucun délai' },
  { id: '24h', label: '24 h' },
  { id: '48h', label: '48 h' },
  { id: '72h', label: '72 h' },
  { id: '7d', label: '7 jours' },
];

const CATEGORIES = [
  'courses', 'essence', 'restaurants', 'enfants', 'maison', 'vetements',
  'loisirs', 'sante', 'beaute', 'achats_perso', 'vacances', 'autres',
];

export default function MonEspace() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [delay, setDelay] = useState('48h');
  const [openItemId, setOpenItemId] = useState(null); // envie dont le simulateur/achat est ouvert

  async function loadWishlist() {
    const data = await getMyWishlist(profile.id);
    setItems(data);
  }

  async function loadBudget() {
    const [incomes, goals, charges, expenses] = await Promise.all([
      getMonthIncomes(currentBudgetMonth.id),
      getMonthSavingsGoals(currentBudgetMonth.id),
      getMonthFixedCharges(currentBudgetMonth.id),
      getMonthExpenses(currentBudgetMonth.id, profile.id),
    ]);
    const budget = computeMonthlyBudget({
      safetyMargin: currentBudgetMonth.safety_margin,
      incomes,
      savingsGoals: goals.map((g) => ({ plannedAmount: g.planned_amount })),
      fixedCharges: charges,
      expenses: expenses.map((e) => ({ amount: e.amount, sourceType: e.source_type, pocketUsageType: e.source_pocket?.usage_type })),
    });
    setRemaining(budget.remaining);
  }

  useEffect(() => {
    loadWishlist();
    loadBudget();
    getHouseholdPockets(profile.household_id).then(setAccounts);
  }, [profile.id, currentBudgetMonth.id]);

  async function handleAdd(e) {
    e.preventDefault();
    const value = Number(price.replace(',', '.'));
    if (!name || !value) return;

    const saved = await addWishlistItem({
      owner_id: profile.id,
      household_id: profile.household_id,
      name,
      price: value,
      reflection_delay: delay,
      reflect_until: computeReflectUntil(delay),
    });
    setItems((prev) => [saved, ...prev]);
    setName('');
    setPrice('');
  }

  async function handleDismiss(item) {
    await dismissWishlistItem(item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  async function handlePurchased(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setOpenItemId(null);
    await loadBudget();
    await refresh();
  }

  return (
    <div className="space-y-5">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Mon espace</h1>
          <p className="text-ink/60 text-sm mt-1">
            Tes envies d'achat sont privées — personne d'autre dans le foyer ne les voit.
          </p>
        </div>
        <button
          onClick={async () => { await signOut(); await refresh(); }}
          className="text-xs text-ink/40 underline mt-2 shrink-0"
        >
          Déconnexion
        </button>
      </header>

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Nouvelle envie</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Quel objet ?"
            className="w-full bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Prix (€)"
            className="w-full bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
          />
          <select
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            className="w-full bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
          >
            {DELAYS.map((d) => (
              <option key={d.id} value={d.id}>Délai de réflexion : {d.label}</option>
            ))}
          </select>

          <button className="w-full bg-teal text-white font-semibold rounded-card py-3">
            Ajouter à mes envies
          </button>
        </form>
      </section>

      <ul className="space-y-3">
        {items.map((item) => (
          <WishlistCard
            key={item.id}
            item={item}
            remaining={remaining}
            accounts={accounts}
            profile={profile}
            currentBudgetMonth={currentBudgetMonth}
            isOpen={openItemId === item.id}
            onToggle={() => setOpenItemId(openItemId === item.id ? null : item.id)}
            onDismiss={() => handleDismiss(item)}
            onPurchased={() => handlePurchased(item)}
          />
        ))}
        {items.length === 0 && (
          <p className="text-center text-ink/40 text-sm py-6">Aucune envie enregistrée pour l'instant.</p>
        )}
      </ul>
    </div>
  );
}

function WishlistCard({ item, remaining, accounts, profile, currentBudgetMonth, isOpen, onToggle, onDismiss, onPurchased }) {
  const [mode, setMode] = useState('comptant'); // 'comptant' | 'plusieurs_fois'
  const [count, setCount] = useState('3');
  const [accountId, setAccountId] = useState('perso');
  const [category, setCategory] = useState('achats_perso');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const price = Number(item.price) || 0;
  const n = Math.max(1, Number(count) || 1);
  const monthly = mode === 'plusieurs_fois' ? price / n : price;
  const impactedRemaining = remaining != null ? remaining - monthly : null;

  async function handleConfirmPurchase() {
    setSaving(true);
    setError('');
    try {
      const sourceType = accountId === 'perso' ? 'perso' : 'pocket';
      const sourcePocketId = accountId === 'perso' ? null : accountId;

      let resultingExpenseId = null;
      if (mode === 'comptant') {
        const expense = await addExpense({
          household_id: profile.household_id,
          paid_by: profile.id,
          budget_month_id: currentBudgetMonth.id,
          source_type: sourceType,
          source_pocket_id: sourcePocketId,
          amount: price,
          category,
          merchant: item.name,
          comment: `Envie d'achat concrétisée : ${item.name}`,
        });
        resultingExpenseId = expense.id;
      } else {
        await createInstallmentPlan({
          householdId: profile.household_id,
          userId: profile.id,
          label: item.name,
          category,
          merchant: null,
          sourceType,
          sourcePocketId,
          isShared: Boolean(accounts.find((a) => a.id === accountId && !a.owner_id)),
          totalAmount: price,
          count: n,
          startDateISO: new Date().toISOString().slice(0, 10),
        });
      }

      await markWishlistPurchased(item.id, resultingExpenseId);
      onPurchased();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="bg-white rounded-card p-4 shadow-sm">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex justify-between items-center">
          <p className="font-medium">{item.name}</p>
          <span className="font-semibold">{price.toLocaleString('fr-FR')} €</span>
        </div>
        <p className="text-xs text-ink/50 mt-0.5">
          {item.reflection_delay !== 'none' ? `Réflexion : ${item.reflection_delay}` : 'Sans délai'}
        </p>
      </button>

      {isOpen && (
        <div className="mt-3 pt-3 border-t border-teal-light space-y-3">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setMode('comptant')}
              className={`flex-1 rounded-xl py-2 font-medium border ${mode === 'comptant' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
            >
              Comptant
            </button>
            <button
              onClick={() => setMode('plusieurs_fois')}
              className={`flex-1 rounded-xl py-2 font-medium border ${mode === 'plusieurs_fois' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
            >
              En plusieurs fois
            </button>
          </div>

          {mode === 'plusieurs_fois' && (
            <div>
              <label className="text-xs text-ink/60">Nombre de fois</label>
              <input
                type="number"
                min="2"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
              />
            </div>
          )}

          {remaining != null && (
            <p className="text-xs bg-coral-light text-coral rounded-xl px-3 py-2">
              {mode === 'comptant'
                ? <>Ton reste à dépenser passerait de <strong>{remaining.toLocaleString('fr-FR')} €</strong> à <strong>{impactedRemaining.toLocaleString('fr-FR')} €</strong> ce mois-ci.</>
                : <>À {monthly.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €/mois sur {n} mois : ton reste à dépenser passerait de <strong>{remaining.toLocaleString('fr-FR')} €</strong> à <strong>{impactedRemaining.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €</strong> ce mois-ci, et resterait réduit d'autant chaque mois suivant pendant {n - 1} mois de plus.</>
              }
            </p>
          )}

          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
            >
              <option value="perso">Mon compte perso</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-coral text-xs text-center">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={onDismiss}
              className="flex-1 text-ink/50 text-xs py-2"
            >
              Je n'en veux plus
            </button>
            <button
              onClick={handleConfirmPurchase}
              disabled={saving}
              className="flex-1 bg-teal text-white text-sm font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : "J'ai acheté"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

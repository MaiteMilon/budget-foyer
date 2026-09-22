import { useEffect, useState } from 'react';
import { addExpense, getHouseholdPockets } from '../lib/data.js';
import { useApp } from '../context/AppContext.jsx';
import ScanReceipt from './ScanReceipt.jsx';
import Installments from './Installments.jsx';

const CATEGORIES = [
  { id: 'courses', label: 'Courses', icon: '🛒' },
  { id: 'essence', label: 'Essence', icon: '⛽' },
  { id: 'restaurants', label: 'Restaurants', icon: '🍽️' },
  { id: 'enfants', label: 'Enfants', icon: '🧸' },
  { id: 'maison', label: 'Maison', icon: '🏡' },
  { id: 'vetements', label: 'Vêtements', icon: '👕' },
  { id: 'loisirs', label: 'Loisirs', icon: '🎮' },
  { id: 'sante', label: 'Santé', icon: '💊' },
  { id: 'beaute', label: 'Beauté', icon: '💄' },
  { id: 'achats_perso', label: 'Achats perso', icon: '🎁' },
  { id: 'vacances', label: 'Vacances', icon: '🏖️' },
  { id: 'autres', label: 'Autres', icon: '➕' },
];

export default function AddExpense() {
  const { profile, currentBudgetMonth } = useApp();
  const [mode, setMode] = useState('manual'); // manual | scan | installments
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('courses');
  const [accountId, setAccountId] = useState('perso'); // 'perso' ou l'id d'un compte
  const [accounts, setAccounts] = useState([]);
  const [merchant, setMerchant] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState({ state: 'idle' });

  useEffect(() => {
    getHouseholdPockets(profile.household_id).then(setAccounts);
  }, [profile.household_id]);

  async function handleSubmit(e) {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) return;
    if (!currentBudgetMonth) {
      setStatus({ state: 'error', message: 'Aucun mois budgétaire actif.' });
      return;
    }

    setStatus({ state: 'saving' });
    try {
      await addExpense({
        household_id: profile.household_id,
        paid_by: profile.id,
        budget_month_id: currentBudgetMonth.id,
        source_type: accountId === 'perso' ? 'perso' : 'pocket',
        source_pocket_id: accountId === 'perso' ? null : accountId,
        amount: value,
        category,
        merchant: merchant || null,
        comment: comment || null,
      });

      setStatus({ state: 'done' });
      setAmount('');
      setMerchant('');
      setComment('');
    } catch (err) {
      setStatus({ state: 'error', message: err.message });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Ajouter une dépense</h1>
        <p className="text-ink/60 text-sm mt-1">Saisie rapide — quelques secondes suffisent.</p>
      </header>

      <div className="flex bg-white rounded-2xl p-1 border border-teal-light text-xs">
        <button
          onClick={() => setMode('scan')}
          className={`flex-1 rounded-xl py-2 font-semibold ${mode === 'scan' ? 'bg-teal text-white' : 'text-ink/60'}`}
        >
          📸 Scanner
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`flex-1 rounded-xl py-2 font-semibold ${mode === 'manual' ? 'bg-teal text-white' : 'text-ink/60'}`}
        >
          ✍️ Manuelle
        </button>
        <button
          onClick={() => setMode('installments')}
          className={`flex-1 rounded-xl py-2 font-semibold ${mode === 'installments' ? 'bg-teal text-white' : 'text-ink/60'}`}
        >
          🔁 Plusieurs fois
        </button>
      </div>

      {mode === 'scan' && <ScanReceipt onDone={() => setMode('manual')} accounts={accounts} />}
      {mode === 'installments' && <Installments onDone={() => setMode('manual')} />}

      {mode === 'manual' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-ink/70">Montant</label>
            <div className="relative mt-1">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className="w-full text-3xl font-bold bg-white rounded-card px-4 py-4 pr-12 border border-teal-light focus:border-teal outline-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl text-ink/40">€</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-ink/70">Catégorie</label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-xs font-medium border ${
                    category === c.id
                      ? 'bg-teal text-white border-teal'
                      : 'bg-white text-ink/70 border-teal-light'
                  }`}
                >
                  <span className="text-lg">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-ink/70">Payé depuis</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full mt-1 bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
            >
              <option value="perso">Mon compte perso</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.icon} {a.name}{a.usage_type === 'epargne' ? ' (épargne)' : ''}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Commerçant (optionnel)"
            className="w-full bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
          />
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Commentaire (optionnel)"
            className="w-full bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
          />

          <button
            type="submit"
            disabled={status.state === 'saving'}
            className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
          >
            {status.state === 'saving' ? 'Enregistrement…' : 'Ajouter la dépense'}
          </button>

          {status.state === 'done' && (
            <p className="text-teal text-sm text-center">Dépense ajoutée ✓</p>
          )}
          {status.state === 'error' && (
            <p className="text-coral text-sm text-center">{status.message}</p>
          )}
        </form>
      )}
    </div>
  );
}

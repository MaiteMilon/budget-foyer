import { useEffect, useState } from 'react';
import { getMyWishlist, addWishlistItem } from '../lib/data.js';
import { simulateWishlistPurchase, computeReflectUntil } from '../lib/budget-engine.js';
import { useApp } from '../context/AppContext.jsx';
import { signOut } from '../lib/auth.js';

const DELAYS = [
  { id: 'none', label: 'Aucun délai' },
  { id: '24h', label: '24 h' },
  { id: '48h', label: '48 h' },
  { id: '72h', label: '72 h' },
  { id: '7d', label: '7 jours' },
];

export default function MonEspace() {
  const { profile, refresh } = useApp();
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [delay, setDelay] = useState('48h');
  const currentRemaining = 565; // à remplacer par le vrai "reste disponible" du contexte partagé (phase 2)

  useEffect(() => {
    getMyWishlist(profile.id).then(setItems);
  }, [profile.id]);

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

  return (
    <div className="space-y-5">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Mon espace</h1>
          <p className="text-ink/60 text-sm mt-1">
            Tes envies d'achat sont privées — ton conjoint ne les voit jamais.
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

          {price && !Number.isNaN(Number(price.replace(',', '.'))) && (
            <p className="text-xs text-coral bg-coral-light rounded-xl px-3 py-2">
              Si tu achètes cet article, ton reste disponible passera de{' '}
              {simulateWishlistPurchase(currentRemaining, price).before} € à{' '}
              {simulateWishlistPurchase(currentRemaining, price).after} €.
            </p>
          )}

          <button className="w-full bg-teal text-white font-semibold rounded-card py-3">
            Ajouter à mes envies
          </button>
        </form>
      </section>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="bg-white rounded-card p-4 shadow-sm flex justify-between items-center">
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="text-xs text-ink/50">
                {item.reflection_delay !== 'none' ? `Réflexion : ${item.reflection_delay}` : 'Sans délai'}
              </p>
            </div>
            <span className="font-semibold">{Number(item.price).toLocaleString('fr-FR')} €</span>
          </li>
        ))}
        {items.length === 0 && (
          <p className="text-center text-ink/40 text-sm py-6">Aucune envie enregistrée pour l'instant.</p>
        )}
      </ul>
    </div>
  );
}

import { useState } from 'react';

export const POCKET_KINDS = [
  { id: 'compte_joint', label: 'Compte joint', icon: '🏦' },
  { id: 'tirelire', label: 'Tirelire / espèces', icon: '🐷' },
  { id: 'epargne', label: 'Compte épargne', icon: '💶' },
  { id: 'vacances', label: 'Vacances', icon: '🏖️' },
  { id: 'precaution', label: 'Épargne de précaution', icon: '🛟' },
  { id: 'projet', label: 'Projet particulier', icon: '🎯' },
  { id: 'autre', label: 'Autre', icon: '➕' },
];

/**
 * Formulaire de création de compte, partagé entre Épargne.jsx et
 * PrepareMonth.jsx.
 *
 * usage_type distingue deux comportements budgétaires bien différents :
 * - "depense" : un moyen de paiement du quotidien, sans réservation
 *   préalable — dépenser dedans réduit directement le reste à dépenser,
 *   comme le compte perso. L'objectif chiffré devient une simple
 *   enveloppe mensuelle informative (ex. "100 € sur ce compte ce mois-ci").
 * - "epargne" : de l'argent mis de côté via un objectif/versement prévu
 *   chaque mois (dont le compte joint) — le dépenser ne re-diminue JAMAIS
 *   le budget disponible, déjà réservé en amont.
 *
 * Le nom du compte est TOUJOURS saisi librement ici, jamais suggéré ou
 * codé en dur (chaque personne du foyer a ses propres comptes).
 */
export default function QuickAddPocketForm({ onSubmit, onCancel, initial }) {
  const isEditing = Boolean(initial);
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState(initial?.kind || 'epargne');
  const [usageType, setUsageType] = useState(initial?.usage_type || 'epargne');
  const [isPrivate, setIsPrivate] = useState(initial?.is_private || false);
  const [targetAmount, setTargetAmount] = useState(initial?.target_amount ? String(initial.target_amount) : '');
  const [targetDate, setTargetDate] = useState(initial?.target_date || '');
  const [monthlyAmount, setMonthlyAmount] = useState(initial?.monthlyAmount ? String(initial.monthlyAmount) : '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name) return;
    setSubmitting(true);
    await onSubmit({
      name,
      kind,
      usageType,
      isPrivate,
      targetAmount: targetAmount ? Number(targetAmount.replace(',', '.')) : null,
      targetDate: usageType === 'epargne' && targetDate ? targetDate : null,
      monthlyAmount: usageType === 'epargne' && monthlyAmount ? Number(monthlyAmount.replace(',', '.')) : null,
    });
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-card p-5 shadow-sm space-y-3">
      <h2 className="font-semibold">{isEditing ? 'Modifier le compte' : 'Nouveau compte'}</h2>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom du compte (ex. Compte joint, Livret A...)"
        required
        autoFocus
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      />

      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setUsageType('depense')}
          className={`flex-1 rounded-xl py-2 font-medium border ${usageType === 'depense' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
        >
          💳 Dépense
        </button>
        <button
          type="button"
          onClick={() => setUsageType('epargne')}
          className={`flex-1 rounded-xl py-2 font-medium border ${usageType === 'epargne' ? 'bg-teal text-white border-teal' : 'bg-cream border-teal-light text-ink/60'}`}
        >
          🐷 Épargne
        </button>
      </div>
      <p className="text-xs text-ink/40 -mt-1">
        {usageType === 'depense'
          ? "Un moyen de paiement du quotidien — dépenser dessus réduit votre reste à dépenser."
          : "De l'argent mis de côté — dépenser dessus ne touche pas votre reste à dépenser (déjà réservé)."}
      </p>

      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      >
        {POCKET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
      </select>

      {usageType === 'epargne' && (
        <div>
          <label className="text-xs text-ink/60">Montant que je compte mettre chaque mois (optionnel)</label>
          <div className="relative mt-1">
            <input
              inputMode="decimal"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              placeholder="ex. 50"
              className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
          </div>
          <p className="text-xs text-ink/40 mt-1">
            Apparaîtra directement dans "Préparer mon mois" — modifiable, ou désactivable un mois précis, à tout moment.
          </p>
        </div>
      )}

      <div>
        <label className="text-xs text-ink/60">
          {usageType === 'depense' ? 'Enveloppe mensuelle (optionnel)' : 'Objectif chiffré (optionnel)'}
        </label>
        <div className="relative mt-1">
          <input
            inputMode="decimal"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            placeholder={usageType === 'depense' ? 'ex. 100' : 'ex. 2000'}
            className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
        </div>
      </div>

      {usageType === 'epargne' && targetAmount && (
        <div>
          <label className="text-xs text-ink/60">Date cible (optionnel)</label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-ink/60">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        Compte privé (visible de moi seul·e)
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
          {submitting ? 'Enregistrement…' : isEditing ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </form>
  );
}

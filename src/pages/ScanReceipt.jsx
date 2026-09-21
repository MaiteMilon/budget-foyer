import { useRef, useState } from 'react';
import { scanReceipt } from '../lib/ocr.js';
import { uploadReceiptPhoto } from '../lib/storage.js';
import { addExpense } from '../lib/data.js';
import { useApp } from '../context/AppContext.jsx';

const CATEGORIES = [
  'courses', 'essence', 'restaurants', 'enfants', 'maison', 'vetements',
  'loisirs', 'sante', 'beaute', 'achats_perso', 'vacances', 'autres',
];

export default function ScanReceipt({ onDone }) {
  const { profile, currentBudgetMonth } = useApp();
  const fileInputRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [stage, setStage] = useState('idle'); // idle | scanning | confirming | saving | error
  const [detected, setDetected] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setStage('scanning');
    try {
      const result = await scanReceipt(file);
      setDetected({
        amount: result.amount ?? '',
        date: result.date ?? new Date().toISOString().slice(0, 10),
        merchant: result.merchant ?? '',
        category: 'courses',
        keepPhoto: true,
      });
      setStage('confirming');
    } catch (err) {
      // Repli explicite : la saisie manuelle reste toujours disponible (§8).
      setDetected({
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        merchant: '',
        category: 'courses',
        keepPhoto: true,
      });
      setErrorMessage("La lecture automatique a échoué — vérifiez et complétez les champs ci-dessous.");
      setStage('confirming');
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setStage('saving');
    try {
      let receiptPhotoUrl = null;
      if (detected.keepPhoto && photo) {
        receiptPhotoUrl = await uploadReceiptPhoto(profile.household_id, photo);
      }

      await addExpense({
        household_id: profile.household_id,
        paid_by: profile.id,
        budget_month_id: currentBudgetMonth.id,
        source_type: 'perso',
        amount: Number(detected.amount),
        spent_at: detected.date,
        category: detected.category,
        merchant: detected.merchant || null,
        receipt_photo_url: receiptPhotoUrl,
      });

      setStage('done');
      onDone?.();
    } catch (err) {
      setErrorMessage(err.message);
      setStage('confirming');
    }
  }

  if (stage === 'idle') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex flex-col items-center gap-2 bg-amber-light text-amber font-semibold rounded-card py-10"
        >
          <span className="text-3xl">📸</span>
          Prendre ou choisir une photo du ticket
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>
    );
  }

  if (stage === 'scanning') {
    return <p className="text-center text-ink/50 mt-10">Lecture du ticket…</p>;
  }

  if (stage === 'done') {
    return <p className="text-center text-teal font-medium mt-10">Dépense enregistrée ✓</p>;
  }

  // confirming / saving : RIEN n'est encore enregistré — l'utilisateur
  // doit valider ou corriger chaque champ détecté (règle absolue §8).
  return (
    <form onSubmit={handleConfirm} className="space-y-4">
      <div className="bg-white rounded-card p-4 shadow-sm">
        <p className="text-xs text-ink/50 mb-2">J'ai détecté ceci — vérifiez avant de confirmer :</p>

        <label className="text-sm font-medium text-ink/70">Commerçant</label>
        <input
          value={detected.merchant}
          onChange={(e) => setDetected({ ...detected, merchant: e.target.value })}
          className="w-full mt-1 mb-3 bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
        />

        <label className="text-sm font-medium text-ink/70">Date</label>
        <input
          type="date"
          value={detected.date}
          onChange={(e) => setDetected({ ...detected, date: e.target.value })}
          className="w-full mt-1 mb-3 bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
        />

        <label className="text-sm font-medium text-ink/70">Total</label>
        <div className="relative mt-1 mb-3">
          <input
            type="text"
            inputMode="decimal"
            value={detected.amount}
            onChange={(e) => setDetected({ ...detected, amount: e.target.value })}
            className="w-full text-2xl font-bold bg-cream rounded-2xl px-4 py-3 pr-10 border border-teal-light outline-none"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink/40">€</span>
        </div>

        <label className="text-sm font-medium text-ink/70">Catégorie</label>
        <select
          value={detected.category}
          onChange={(e) => setDetected({ ...detected, category: e.target.value })}
          className="w-full mt-1 bg-cream rounded-2xl px-4 py-3 border border-teal-light outline-none"
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label className="flex items-center gap-2 mt-3 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={detected.keepPhoto}
            onChange={(e) => setDetected({ ...detected, keepPhoto: e.target.checked })}
          />
          Conserver la photo du ticket
        </label>
      </div>

      {errorMessage && <p className="text-coral text-sm text-center">{errorMessage}</p>}

      <button
        type="submit"
        disabled={stage === 'saving' || !detected.amount}
        className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
      >
        {stage === 'saving' ? 'Enregistrement…' : 'Confirmer'}
      </button>
    </form>
  );
}

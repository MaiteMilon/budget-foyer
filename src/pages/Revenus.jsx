import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import {
  getMyRecurringIncomes,
  getCurrentMonthEntriesByIncome,
  createRecurringIncome,
  updateRecurringIncomeTemplate,
  deleteRecurringIncomeTemplate,
  upsertCurrentMonthIncomeEntry,
  removeCurrentMonthIncomeEntry,
  addPonctualIncome,
} from '../lib/income.js';

const KINDS = [
  { id: 'salaire', label: 'Salaire' },
  { id: 'autre_revenu', label: 'Autre revenu' },
  { id: 'remboursement', label: 'Remboursement' },
  { id: 'exceptionnel', label: 'Revenu exceptionnel' },
];

function emptyForm() {
  return { label: '', amount: '', kind: 'salaire', isRecurring: true, isActive: true };
}

export default function Revenus() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [incomes, setIncomes] = useState([]);
  const [entriesByIncome, setEntriesByIncome] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = création
  const [form, setForm] = useState(emptyForm());
  const [pendingScopeChoice, setPendingScopeChoice] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ponctualDone, setPonctualDone] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, entries] = await Promise.all([
        getMyRecurringIncomes(profile.id),
        getCurrentMonthEntriesByIncome(currentBudgetMonth.id),
      ]);
      setIncomes(list);
      setEntriesByIncome(entries);
    } catch (err) {
      setLoadError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [profile.id, currentBudgetMonth.id]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setPonctualDone(false);
    setFormOpen(true);
  }

  function openEdit(income) {
    setEditing(income);
    setForm({
      label: income.label,
      amount: String(income.default_amount),
      kind: income.kind,
      isRecurring: true,
      isActive: income.is_active,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setPendingScopeChoice(null);
  }

  async function applyChange(currentForm, scope) {
    setSaving(true);
    setError('');
    try {
      const amount = Number(String(currentForm.amount).replace(',', '.')) || 0;

      if (!currentForm.isRecurring) {
        await addPonctualIncome(currentBudgetMonth.id, {
          label: currentForm.label,
          kind: currentForm.kind,
          amount,
        });
        setPonctualDone(true);
        await refresh();
        setSaving(false);
        return;
      }

      let template = editing;
      if (!template) {
        template = await createRecurringIncome({
          household_id: profile.household_id,
          owner_id: profile.id,
          label: currentForm.label,
          kind: currentForm.kind,
          default_amount: amount,
          is_active: currentForm.isActive,
        });
      } else if (scope === 'future') {
        template = await updateRecurringIncomeTemplate(template.id, {
          label: currentForm.label,
          kind: currentForm.kind,
          default_amount: amount,
          is_active: currentForm.isActive,
        });
      }

      if (currentForm.isActive) {
        await upsertCurrentMonthIncomeEntry(currentBudgetMonth.id, template, {
          amount,
          label: currentForm.label,
          kind: currentForm.kind,
        });
      } else {
        await removeCurrentMonthIncomeEntry(currentBudgetMonth.id, template.id);
      }

      await load();
      await refresh();
      closeForm();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.label || form.amount === '') return;

    if (editing) {
      setPendingScopeChoice(form);
    } else {
      applyChange(form, null);
    }
  }

  async function handleToggleActive(income) {
    const nextActive = !income.is_active;
    setSaving(true);
    try {
      await updateRecurringIncomeTemplate(income.id, { is_active: nextActive });
      if (nextActive) {
        await upsertCurrentMonthIncomeEntry(currentBudgetMonth.id, income, {
          amount: income.default_amount,
          label: income.label,
          kind: income.kind,
        });
      } else {
        await removeCurrentMonthIncomeEntry(currentBudgetMonth.id, income.id);
      }
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(income) {
    const ok = window.confirm(
      `Supprimer le revenu "${income.label}" ? Il ne sera plus proposé les mois suivants ; les mois déjà préparés ne changent pas.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      await removeCurrentMonthIncomeEntry(currentBudgetMonth.id, income.id);
      await deleteRecurringIncomeTemplate(income.id);
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="text-center mt-20 px-4">
        <p className="text-4xl mb-2">⚠️</p>
        <p className="font-semibold mb-2">Impossible de charger Revenus</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 break-words">{loadError}</p>
      </div>
    );
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  const active = incomes.filter((i) => i.is_active);
  const inactive = incomes.filter((i) => !i.is_active);

  return (
    <div className="space-y-5 pb-4">
      <header>
        <h1 className="text-2xl font-bold">Mes revenus</h1>
        <p className="text-ink/60 text-sm mt-1">
          Toute modification s'applique immédiatement au budget de ce mois-ci.
        </p>
      </header>

      {!formOpen && (
        <button onClick={openCreate} className="w-full bg-teal text-white font-semibold rounded-card py-3">
          + Nouveau revenu
        </button>
      )}

      {formOpen && !pendingScopeChoice && !ponctualDone && (
        <IncomeForm
          form={form}
          setForm={setForm}
          isEditing={Boolean(editing)}
          onCancel={closeForm}
          onSubmit={handleSubmit}
          saving={saving}
        />
      )}

      {ponctualDone && (
        <div className="bg-white rounded-card p-5 shadow-sm text-center space-y-3">
          <p className="text-teal font-medium">Revenu ponctuel ajouté à ce mois-ci ✓</p>
          <button onClick={closeForm} className="text-sm text-ink/50">Fermer</button>
        </div>
      )}

      {pendingScopeChoice && (
        <div className="bg-white rounded-card p-5 shadow-sm space-y-3">
          <p className="text-sm font-medium">Ce revenu est fixe. Appliquer la modification :</p>
          <button
            onClick={() => applyChange(pendingScopeChoice, 'this_month')}
            disabled={saving}
            className="w-full bg-teal text-white font-semibold rounded-card py-3 disabled:opacity-50"
          >
            Modifier uniquement ce mois
          </button>
          <button
            onClick={() => applyChange(pendingScopeChoice, 'future')}
            disabled={saving}
            className="w-full bg-white border border-teal-light text-teal font-semibold rounded-card py-3 disabled:opacity-50"
          >
            Modifier également les prochains mois
          </button>
          <button onClick={closeForm} className="w-full text-ink/50 text-sm py-1">Annuler</button>
        </div>
      )}

      {error && <p className="text-coral text-sm text-center">{error}</p>}

      <section className="bg-white rounded-card p-5 shadow-sm">
        <h2 className="font-semibold mb-3">Revenus fixes</h2>
        {incomes.length === 0 && <p className="text-sm text-ink/40">Aucun revenu fixe pour l'instant.</p>}
        <ul className="space-y-2">
          {active.map((i) => (
            <IncomeRow key={i.id} income={i} entry={entriesByIncome.get(i.id)} onEdit={openEdit} onDelete={handleDelete} onToggleActive={handleToggleActive} />
          ))}
        </ul>
        {inactive.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-ink/40 cursor-pointer">{inactive.length} revenu(s) inactif(s)</summary>
            <ul className="space-y-2 mt-2">
              {inactive.map((i) => (
                <IncomeRow key={i.id} income={i} entry={entriesByIncome.get(i.id)} onEdit={openEdit} onDelete={handleDelete} onToggleActive={handleToggleActive} dimmed />
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-ink/30 mt-3">
          Pour un revenu ponctuel (sans suite les mois suivants), utilisez "+ Nouveau revenu" et choisissez "Ponctuel" — il n'apparaîtra pas dans cette liste, seulement dans le mois en cours.
        </p>
      </section>
    </div>
  );
}

function IncomeRow({ income, entry, onEdit, onDelete, onToggleActive, dimmed }) {
  const displayedAmount = entry ? entry.amount : income.default_amount;
  const overridden = entry && Number(entry.amount) !== Number(income.default_amount);
  const kindLabel = KINDS.find((k) => k.id === income.kind)?.label || income.kind;

  return (
    <li className={`border border-teal-light rounded-2xl p-3 ${dimmed ? 'opacity-50' : ''}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{income.label}</p>
          <p className="text-xs text-ink/50">
            {kindLabel}{overridden && ' · modifié ce mois-ci'}
          </p>
        </div>
        <span className="font-semibold shrink-0 text-teal">+{Number(displayedAmount).toLocaleString('fr-FR')} €</span>
      </div>
      <div className="flex justify-between items-center mt-2">
        <label className="flex items-center gap-1.5 text-xs text-ink/60">
          <input type="checkbox" checked={income.is_active} onChange={() => onToggleActive(income)} />
          Actif
        </label>
        <div className="flex gap-3 text-xs">
          <button onClick={() => onEdit(income)} className="text-teal font-medium">Modifier</button>
          <button onClick={() => onDelete(income)} className="text-coral font-medium">Supprimer</button>
        </div>
      </div>
    </li>
  );
}

function IncomeForm({ form, setForm, isEditing, onCancel, onSubmit, saving }) {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-card p-5 shadow-sm space-y-3">
      <h2 className="font-semibold">{isEditing ? 'Modifier le revenu' : 'Nouveau revenu'}</h2>

      <input
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
        placeholder="Nom (ex. Salaire)"
        required
        className="w-full bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Montant"
            required
            className="w-full bg-cream rounded-xl px-3 py-2 pr-6 border border-teal-light text-sm"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 text-xs">€</span>
        </div>
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        >
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </div>

      {!isEditing && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={form.isRecurring} onChange={() => setForm({ ...form, isRecurring: true })} />
            Fixe
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!form.isRecurring} onChange={() => setForm({ ...form, isRecurring: false })} />
            Ponctuel
          </label>
        </div>
      )}

      {form.isRecurring && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          Actif (compté dans le budget de ce mois-ci)
        </label>
      )}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 text-sm text-ink/50 py-3">Annuler</button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-teal text-white text-sm font-semibold rounded-xl py-3 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

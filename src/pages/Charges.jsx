import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getHouseholdPockets, getHouseholdMembers, getBudgetMonthForUser } from '../lib/data.js';
import {
  getMyCharges,
  getCurrentMonthEntriesByCharge,
  createCharge,
  updateChargeTemplate,
  deleteChargeTemplate,
  upsertCurrentMonthEntry,
  removeCurrentMonthEntry,
  logSharedChargeAction,
  setEntryPaid,
} from '../lib/charges.js';

const CATEGORIES = [
  'téléphone', 'assurance', 'abonnement', 'transport', 'crédit',
  'école', 'logement', 'énergie', 'internet', 'mutuelle', 'autre',
];

function emptyForm() {
  return {
    label: '',
    amount: '',
    category: 'autre',
    isShared: false,
    isRecurring: true,
    dueDay: '5',
    oneOffDate: new Date().toISOString().slice(0, 10),
    isActive: true,
    sourcePocketId: '',
  };
}

function formatSchedule(charge) {
  if (charge.is_recurring) {
    return charge.due_day ? `Récurrente · le ${charge.due_day}` : 'Récurrente';
  }
  return charge.one_off_date
    ? `Ponctuelle · ${new Date(charge.one_off_date).toLocaleDateString('fr-FR')}`
    : 'Ponctuelle';
}

export default function Charges() {
  const { profile, currentBudgetMonth, refresh } = useApp();
  const [charges, setCharges] = useState([]);
  const [entriesByCharge, setEntriesByCharge] = useState(new Map());
  const [accounts, setAccounts] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCharge, setEditingCharge] = useState(null); // null = création
  const [form, setForm] = useState(emptyForm());
  const [pendingScopeChoice, setPendingScopeChoice] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [chargesList, entries, accountsList, householdMembers] = await Promise.all([
      getMyCharges(profile.household_id, profile.id),
      getCurrentMonthEntriesByCharge(currentBudgetMonth.id),
      getHouseholdPockets(profile.household_id),
      getHouseholdMembers(profile.household_id),
    ]);

    // Les entrées du mois de l'AUTRE membre vivent dans SON propre mois
    // budgétaire (un budget_months par personne) — il faut les récupérer
    // séparément pour afficher ses charges avec leurs vraies valeurs.
    const otherPerson = householdMembers.find((m) => m.id !== profile.id);
    let mergedEntries = entries;
    if (otherPerson) {
      const otherMonth = await getBudgetMonthForUser(otherPerson.id, currentBudgetMonth.month);
      if (otherMonth) {
        const otherEntries = await getCurrentMonthEntriesByCharge(otherMonth.id);
        mergedEntries = new Map([...entries, ...otherEntries]);
      }
    }

    setCharges(chargesList);
    setEntriesByCharge(mergedEntries);
    setAccounts(accountsList);
    setMembers(householdMembers);
    setLoading(false);
  }

  useEffect(() => { load(); }, [profile.household_id, currentBudgetMonth.id]);

  const grouped = useMemo(() => {
    const shared = charges.filter((c) => c.is_shared);
    const mine = charges.filter((c) => !c.is_shared && c.owner_id === profile.id);
    const others = charges.filter((c) => !c.is_shared && c.owner_id !== profile.id);
    return { shared, mine, others };
  }, [charges, profile.id]);

  const otherMember = members.find((m) => m.id !== profile.id);

  function openCreate() {
    setEditingCharge(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(charge) {
    setEditingCharge(charge);
    setForm({
      label: charge.label,
      amount: String(charge.default_amount),
      category: charge.category,
      isShared: charge.is_shared,
      isRecurring: charge.is_recurring,
      dueDay: String(charge.due_day || 5),
      oneOffDate: charge.one_off_date || new Date().toISOString().slice(0, 10),
      isActive: charge.is_active,
      sourcePocketId: charge.source_pocket_id || '',
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingCharge(null);
    setPendingScopeChoice(null);
  }

  async function applyChange(currentForm, scope) {
    setSaving(true);
    setError('');
    try {
      const amount = Number(String(currentForm.amount).replace(',', '.')) || 0;
      const sourcePocketId = currentForm.sourcePocketId || null;
      let charge = editingCharge;

      if (!charge) {
        charge = await createCharge({
          household_id: profile.household_id,
          owner_id: currentForm.isShared ? null : profile.id,
          label: currentForm.label,
          category: currentForm.category,
          is_shared: currentForm.isShared,
          is_recurring: currentForm.isRecurring,
          default_amount: amount,
          due_day: currentForm.isRecurring ? Number(currentForm.dueDay) : null,
          one_off_date: currentForm.isRecurring ? null : currentForm.oneOffDate,
          is_active: currentForm.isActive,
          source_pocket_id: sourcePocketId,
        });
      } else if (scope === 'future' || !charge.is_recurring) {
        charge = await updateChargeTemplate(charge.id, {
          label: currentForm.label,
          category: currentForm.category,
          is_shared: currentForm.isShared,
          owner_id: currentForm.isShared ? null : profile.id,
          default_amount: amount,
          due_day: currentForm.isRecurring ? Number(currentForm.dueDay) : null,
          one_off_date: currentForm.isRecurring ? null : currentForm.oneOffDate,
          is_active: currentForm.isActive,
          source_pocket_id: sourcePocketId,
        });
      } else {
        if (charge.is_shared) {
          await logSharedChargeAction(
            profile.household_id,
            profile.id,
            `Charge modifiée pour ce mois uniquement : ${currentForm.label}`
          );
        }
      }

      if (currentForm.isActive) {
        await upsertCurrentMonthEntry(currentBudgetMonth.id, charge, {
          amount,
          label: currentForm.label,
          category: currentForm.category,
          dueDate: currentForm.isRecurring ? null : currentForm.oneOffDate,
          sourcePocketId,
        });
      } else {
        await removeCurrentMonthEntry(currentBudgetMonth.id, charge.id);
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

    if (editingCharge && editingCharge.is_recurring) {
      setPendingScopeChoice(form);
    } else {
      applyChange(form, null);
    }
  }

  async function handleToggleActive(charge) {
    const nextActive = !charge.is_active;
    setSaving(true);
    try {
      await updateChargeTemplate(charge.id, { is_active: nextActive });
      if (nextActive) {
        await upsertCurrentMonthEntry(currentBudgetMonth.id, charge, {
          amount: charge.default_amount,
          label: charge.label,
          category: charge.category,
          dueDate: charge.is_recurring ? null : charge.one_off_date,
          sourcePocketId: charge.source_pocket_id,
        });
      } else {
        await removeCurrentMonthEntry(currentBudgetMonth.id, charge.id);
      }
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePaid(entry) {
    setSaving(true);
    setError('');
    try {
      await setEntryPaid(entry, !entry.is_paid);
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(charge) {
    const ok = window.confirm(
      `Supprimer la charge "${charge.label}" ? Elle ne sera plus proposée les mois suivants ; les mois déjà préparés ne changent pas.`
    );
    if (!ok) return;
    setSaving(true);
    try {
      await removeCurrentMonthEntry(currentBudgetMonth.id, charge.id);
      await deleteChargeTemplate(charge.id);
      await load();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-center text-ink/50 mt-20">Chargement…</p>;

  return (
    <div className="space-y-5 pb-4">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Mes charges</h1>
          <p className="text-ink/60 text-sm mt-1">
            Toute modification s'applique immédiatement au budget de ce mois-ci.
          </p>
        </div>
      </header>

      {!formOpen && (
        <button
          onClick={openCreate}
          className="w-full bg-teal text-white font-semibold rounded-card py-3"
        >
          + Nouvelle charge
        </button>
      )}

      {formOpen && !pendingScopeChoice && (
        <ChargeForm
          form={form}
          setForm={setForm}
          categories={CATEGORIES}
          accounts={accounts}
          isEditing={Boolean(editingCharge)}
          onCancel={closeForm}
          onSubmit={handleSubmit}
          saving={saving}
        />
      )}

      {pendingScopeChoice && (
        <div className="bg-white rounded-card p-5 shadow-sm space-y-3">
          <p className="text-sm font-medium">
            Cette charge est récurrente. Appliquer la modification :
          </p>
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
          <button onClick={closeForm} className="w-full text-ink/50 text-sm py-1">
            Annuler
          </button>
        </div>
      )}

      {error && <p className="text-coral text-sm text-center">{error}</p>}

      <ChargeGroup
        title="Charges communes"
        charges={grouped.shared}
        entriesByCharge={entriesByCharge}
        onEdit={openEdit}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
        onTogglePaid={handleTogglePaid}
      />
      <ChargeGroup
        title="Mes charges personnelles"
        charges={grouped.mine}
        entriesByCharge={entriesByCharge}
        onEdit={openEdit}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
        onTogglePaid={handleTogglePaid}
      />
      <ChargeGroup
        title={`Charges ${otherMember ? `de ${otherMember.display_name}` : "de l'autre membre"}`}
        charges={grouped.others}
        entriesByCharge={entriesByCharge}
        readOnly
      />
    </div>
  );
}

function ChargeGroup({ title, charges, entriesByCharge, onEdit, onDelete, onToggleActive, onTogglePaid, readOnly }) {
  const active = charges.filter((c) => c.is_active);
  const inactive = charges.filter((c) => !c.is_active);

  return (
    <section className="bg-white rounded-card p-5 shadow-sm">
      <h2 className="font-semibold mb-3">{title}</h2>
      {charges.length === 0 && <p className="text-sm text-ink/40">{readOnly ? 'Aucune charge renseignée.' : "Aucune charge pour l'instant."}</p>}

      <ul className="space-y-2">
        {active.map((c) => (
          <ChargeRow key={c.id} charge={c} entry={entriesByCharge.get(c.id)} onEdit={onEdit} onDelete={onDelete} onToggleActive={onToggleActive} onTogglePaid={onTogglePaid} readOnly={readOnly} />
        ))}
      </ul>

      {inactive.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-ink/40 cursor-pointer">
            {inactive.length} charge(s) inactive(s)
          </summary>
          <ul className="space-y-2 mt-2">
            {inactive.map((c) => (
              <ChargeRow key={c.id} charge={c} entry={entriesByCharge.get(c.id)} onEdit={onEdit} onDelete={onDelete} onToggleActive={onToggleActive} onTogglePaid={onTogglePaid} dimmed readOnly={readOnly} />
            ))}
          </ul>
        </details>
      )}
      {readOnly && charges.length > 0 && (
        <p className="text-xs text-ink/30 mt-3">Lecture seule — chacun gère uniquement ses propres charges.</p>
      )}
    </section>
  );
}

function ChargeRow({ charge, entry, onEdit, onDelete, onToggleActive, onTogglePaid, dimmed, readOnly }) {
  const displayedAmount = entry ? entry.amount : charge.default_amount;
  const overridden = entry && Number(entry.amount) !== Number(charge.default_amount);

  return (
    <li className={`border border-teal-light rounded-2xl p-3 ${dimmed ? 'opacity-50' : ''}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{charge.label}</p>
          <p className="text-xs text-ink/50">
            {formatSchedule(charge)} · {charge.category}
            {overridden && ' · modifiée ce mois-ci'}
          </p>
        </div>
        <span className="font-semibold shrink-0">{Number(displayedAmount).toLocaleString('fr-FR')} €</span>
      </div>
      {readOnly ? (
        <p className="text-xs text-ink/40 mt-2">
          {charge.is_active ? 'Active' : 'Inactive'}{entry?.is_paid && ' · payée ce mois-ci'}
        </p>
      ) : (
        <>
          <div className="flex justify-between items-center mt-2">
            <label className="flex items-center gap-1.5 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={charge.is_active}
                onChange={() => onToggleActive(charge)}
              />
              Active
            </label>
            <div className="flex gap-3 text-xs">
              <button onClick={() => onEdit(charge)} className="text-teal font-medium">Modifier</button>
              <button onClick={() => onDelete(charge)} className="text-coral font-medium">Supprimer</button>
            </div>
          </div>
          {entry && (
            <div className="mt-2 pt-2 border-t border-teal-light/60 flex justify-between items-center">
              <label className="flex items-center gap-1.5 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={entry.is_paid}
                  onChange={() => onTogglePaid(entry)}
                />
                Payée ce mois-ci
              </label>
              {entry.source_pocket_id && (
                <span className="text-xs text-ink/40">Prélevée sur un compte suivi</span>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

function ChargeForm({ form, setForm, categories, accounts, isEditing, onCancel, onSubmit, saving }) {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-card p-5 shadow-sm space-y-3">
      <h2 className="font-semibold">{isEditing ? 'Modifier la charge' : 'Nouvelle charge'}</h2>

      <input
        value={form.label}
        onChange={(e) => setForm({ ...form, label: e.target.value })}
        placeholder="Nom (ex. Loyer)"
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
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="flex-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs text-ink/60">Compte de prélèvement (optionnel)</label>
        <select
          value={form.sourcePocketId}
          onChange={(e) => setForm({ ...form, sourcePocketId: e.target.value })}
          className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
        >
          <option value="">Non suivi (juste réservé dans le budget)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
          ))}
        </select>
        <p className="text-xs text-ink/40 mt-1">
          Ne change rien au budget réservé — sert seulement à décompter le solde réel de ce compte une fois la charge cochée "payée".
        </p>
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!form.isShared}
            onChange={() => setForm({ ...form, isShared: false })}
          />
          Personnelle
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={form.isShared}
            onChange={() => setForm({ ...form, isShared: true })}
          />
          Commune
        </label>
      </div>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={form.isRecurring}
            onChange={() => setForm({ ...form, isRecurring: true })}
          />
          Récurrente
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!form.isRecurring}
            onChange={() => setForm({ ...form, isRecurring: false })}
          />
          Ponctuelle
        </label>
      </div>

      {form.isRecurring ? (
        <div>
          <label className="text-xs text-ink/60">Jour prévu de prélèvement</label>
          <input
            type="number"
            min="1"
            max="31"
            value={form.dueDay}
            onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
            className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          />
        </div>
      ) : (
        <div>
          <label className="text-xs text-ink/60">Date</label>
          <input
            type="date"
            value={form.oneOffDate}
            onChange={(e) => setForm({ ...form, oneOffDate: e.target.value })}
            className="w-full mt-1 bg-cream rounded-xl px-3 py-2 border border-teal-light text-sm"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        Active (comptée dans le budget de ce mois-ci)
      </label>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 text-sm text-ink/50 py-3">
          Annuler
        </button>
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

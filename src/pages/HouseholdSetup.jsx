import { useState, useEffect } from 'react';
import { createHousehold, createInvite, inviteLink, joinHouseholdWithCode } from '../lib/household.js';
import { useApp } from '../context/AppContext.jsx';

export default function HouseholdSetup() {
  const { profile, refresh } = useApp();
  const [choice, setChoice] = useState(null); // 'create' | 'join' | null
  const [code, setCode] = useState('');
  const [status, setStatus] = useState({ state: 'idle' });
  const [invite, setInvite] = useState(null);

  // Si l'URL contient déjà ?code=... (lien d'invitation cliqué), on
  // présente directement l'écran "rejoindre" pré-rempli.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code');
    if (urlCode) {
      setChoice('join');
      setCode(urlCode);
    }
  }, []);

  async function handleCreate() {
    setStatus({ state: 'loading' });
    try {
      const household = await createHousehold(profile.id, `Foyer de ${profile.display_name}`);
      const inv = await createInvite(household.id, profile.id);
      setInvite(inv);
      setStatus({ state: 'created' });
    } catch (err) {
      setStatus({ state: 'error', message: err.message });
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    setStatus({ state: 'loading' });
    try {
      await joinHouseholdWithCode(code);
      await refresh();
    } catch (err) {
      setStatus({ state: 'error', message: err.message });
    }
  }

  async function handleContinue() {
    await refresh();
  }

  if (status.state === 'created' && invite) {
    const link = inviteLink(invite.code);
    return (
      <div className="min-h-screen flex flex-col justify-center px-6 max-w-md mx-auto space-y-5">
        <h1 className="text-2xl font-bold">Votre foyer est créé 🎉</h1>
        <p className="text-ink/60">Partagez ce code ou ce lien avec votre conjoint pour qu'il·elle rejoigne le foyer.</p>

        <div className="bg-white rounded-card p-6 text-center shadow-sm">
          <p className="text-xs text-ink/50 mb-1">Code d'invitation</p>
          <p className="text-4xl font-extrabold tracking-widest text-teal">{invite.code}</p>
        </div>

        <button
          onClick={() => navigator.clipboard?.writeText(link)}
          className="w-full bg-white border border-teal-light text-teal font-semibold rounded-card py-3 text-sm"
        >
          Copier le lien d'invitation
        </button>

        <button
          onClick={handleContinue}
          className="w-full bg-teal text-white font-semibold rounded-card py-4"
        >
          Continuer sans attendre
        </button>
        <p className="text-xs text-center text-ink/40">
          Le code reste valable 7 jours ; votre conjoint pourra le saisir plus tard.
        </p>
      </div>
    );
  }

  if (choice === 'join') {
    return (
      <div className="min-h-screen flex flex-col justify-center px-6 max-w-md mx-auto space-y-5">
        <h1 className="text-2xl font-bold">Rejoindre un foyer</h1>
        <p className="text-ink/60">Entrez le code reçu de votre conjoint.</p>
        <form onSubmit={handleJoin} className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ex. BLEU-4F2K"
            required
            className="w-full text-center text-2xl font-bold tracking-widest bg-white rounded-card px-4 py-4 border border-teal-light outline-none"
          />
          <button
            type="submit"
            disabled={status.state === 'loading'}
            className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
          >
            {status.state === 'loading' ? 'Un instant…' : 'Rejoindre le foyer'}
          </button>
          {status.state === 'error' && (
            <p className="text-coral text-sm text-center">{status.message}</p>
          )}
        </form>
        <button onClick={() => setChoice(null)} className="text-teal text-sm text-center">
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 max-w-md mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Bienvenue {profile?.display_name} 👋</h1>
      <p className="text-ink/60 mb-2">Pour commencer, créez votre foyer ou rejoignez celui de votre conjoint.</p>

      <button
        onClick={handleCreate}
        disabled={status.state === 'loading'}
        className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
      >
        Créer mon foyer
      </button>
      <button
        onClick={() => setChoice('join')}
        className="w-full bg-white border border-teal-light text-teal font-semibold rounded-card py-4"
      >
        J'ai un code d'invitation
      </button>
      {status.state === 'error' && (
        <p className="text-coral text-sm text-center">{status.message}</p>
      )}
    </div>
  );
}

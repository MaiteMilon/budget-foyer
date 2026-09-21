import { useState } from 'react';
import { signUp, signIn } from '../lib/auth.js';
import { useApp } from '../context/AppContext.jsx';

export default function Auth() {
  const { refresh } = useApp();
  const [mode, setMode] = useState('signup'); // signup | login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState({ state: 'idle' });

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus({ state: 'loading' });
    try {
      if (mode === 'signup') {
        const result = await signUp({ email, password, displayName });
        if (!result.session) {
          // Confirmation par e-mail requise avant de pouvoir créer le profil.
          setStatus({
            state: 'check_email',
            message: 'Vérifiez votre boîte mail pour confirmer votre compte, puis revenez ici.',
          });
          return;
        }
      } else {
        await signIn({ email, password });
      }
      await refresh();
    } catch (err) {
      setStatus({ state: 'error', message: translateError(err.message) });
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 max-w-md mx-auto">
      <h1 className="text-3xl font-extrabold text-teal mb-1">Budget Foyer</h1>
      <p className="text-ink/60 mb-8">
        {mode === 'signup' ? 'Créez votre compte pour commencer.' : 'Reconnectez-vous à votre foyer.'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'signup' && (
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Votre prénom"
            required
            className="w-full bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          required
          className="w-full bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          required
          minLength={6}
          className="w-full bg-white rounded-2xl px-4 py-3 border border-teal-light outline-none"
        />

        <button
          type="submit"
          disabled={status.state === 'loading'}
          className="w-full bg-teal text-white font-semibold rounded-card py-4 disabled:opacity-50"
        >
          {status.state === 'loading' ? 'Un instant…' : mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}
        </button>

        {status.state === 'check_email' && (
          <p className="text-teal text-sm text-center">{status.message}</p>
        )}
        {status.state === 'error' && (
          <p className="text-coral text-sm text-center">{status.message}</p>
        )}
      </form>

      <button
        onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}
        className="text-teal text-sm text-center mt-6"
      >
        {mode === 'signup' ? 'Déjà un compte ? Se connecter' : "Pas encore de compte ? S'inscrire"}
      </button>
    </div>
  );
}

function translateError(message) {
  if (message?.includes('Invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (message?.includes('User already registered')) return 'Un compte existe déjà avec cet e-mail.';
  return message || 'Une erreur est survenue.';
}

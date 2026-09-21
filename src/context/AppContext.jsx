import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { getOrCreateBudgetMonth } from '../lib/data.js';
import { ensureProfileExists } from '../lib/auth.js';

const AppContext = createContext(null);

function currentMonthISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function AppProvider({ children }) {
  const [state, setState] = useState({
    status: 'loading', // loading | signed_out | needs_household | ready | error
    session: null,
    profile: null,
    currentBudgetMonth: null,
    errorMessage: null,
  });

  const loadForSession = useCallback(async (session) => {
    if (!session) {
      setState({ status: 'signed_out', session: null, profile: null, currentBudgetMonth: null, errorMessage: null });
      return;
    }

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!profile) {
        // Session valide mais profil pas encore créé — typiquement juste
        // après avoir cliqué le lien de confirmation d'e-mail. On tente de
        // le créer automatiquement avec le prénom mis de côté au moment de
        // l'inscription (voir auth.js) plutôt que de bloquer l'utilisateur.
        try {
          const created = await ensureProfileExists();
          if (created) {
            await routeFromProfile(session, created);
            return;
          }
        } catch {
          // pas grave : on retombe sur l'écran de connexion ci-dessous
        }
        setState({ status: 'signed_out', session, profile: null, currentBudgetMonth: null, errorMessage: null });
        return;
      }

      await routeFromProfile(session, profile);
    } catch (err) {
      // Avant : une erreur ici restait invisible et l'app bloquait
      // indéfiniment sur "Chargement…". Désormais le message exact
      // s'affiche, pour pouvoir diagnostiquer au lieu de deviner.
      setState({
        status: 'error',
        session,
        profile: null,
        currentBudgetMonth: null,
        errorMessage: err.message || String(err),
      });
    }
  }, []);

  async function routeFromProfile(session, profile) {
    if (!profile.household_id) {
      setState({ status: 'needs_household', session, profile, currentBudgetMonth: null });
      return;
    }

    const month = await getOrCreateBudgetMonth(
      profile.household_id,
      profile.id,
      currentMonthISO()
    );

    setState({ status: 'ready', session, profile, currentBudgetMonth: month });
  }

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await loadForSession(data.session);
  }, [loadForSession]);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      loadForSession(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh, loadForSession]);

  return (
    <AppContext.Provider value={{ ...state, refresh }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp doit être utilisé sous <AppProvider>');
  return ctx;
}

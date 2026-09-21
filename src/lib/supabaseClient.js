import { createClient } from '@supabase/supabase-js';

// À renseigner dans un fichier .env (voir .env.example) — jamais en dur.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // On échoue tôt et clairement plutôt que de laisser des erreurs réseau
  // opaques apparaître plus tard dans l'app.
  console.error(
    'Variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquantes. ' +
      'Copiez .env.example vers .env et renseignez votre projet Supabase.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

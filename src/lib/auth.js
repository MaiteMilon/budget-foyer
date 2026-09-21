import { supabase } from './supabaseClient.js';

/**
 * Inscription : crée le compte Supabase Auth PUIS la ligne `profiles`
 * avec le prénom saisi par l'utilisateur (jamais codé en dur, §1).
 * Le foyer n'est PAS créé ici — l'étape suivante (HouseholdSetup) laisse
 * choisir entre "créer mon foyer" et "rejoindre avec un code".
 */
export async function signUp({ email, password, displayName }) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  if (data.session) {
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      display_name: displayName,
    });
    if (profileError) throw profileError;
  } else {
    // Confirmation par e-mail requise : la session (et donc la possibilité
    // de créer le profil) n'existera qu'après le clic sur le lien reçu par
    // mail. On garde le prénom de côté pour ne pas le perdre d'ici là —
    // voir AppContext.jsx, qui le consomme automatiquement dès qu'une
    // session apparaît sans profil associé.
    localStorage.setItem('pending_display_name', displayName);
  }

  return data;
}

/** À appeler juste après la confirmation d'e-mail si le profil n'a pas encore été créé. */
export async function ensureProfileExists(displayName) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (existing) return existing;

  const pendingName = localStorage.getItem('pending_display_name');
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: auth.user.id, display_name: displayName || pendingName || 'Moi' })
    .select()
    .single();
  if (error) throw error;
  localStorage.removeItem('pending_display_name');
  return data;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

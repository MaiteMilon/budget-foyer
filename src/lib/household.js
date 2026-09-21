import { supabase } from './supabaseClient.js';

/** Génère un code court, facile à dicter à l'oral ("BLEU-4F2K"). */
function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I ambigus
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

/**
 * Crée le foyer et y rattache le créateur — tout se passe dans la
 * fonction RPC `create_household` (SECURITY DEFINER), seul chemin
 * autorisé à écrire household_id sur son propre profil (voir l'audit
 * sécurité dans schema.sql : un simple insert+update côté client était
 * jusqu'ici possible mais dangereux, désormais bloqué par un déclencheur).
 */
export async function createHousehold(userId, householdName = 'Notre foyer') {
  const { data, error } = await supabase.rpc('create_household', { p_name: householdName });
  if (error) throw error;
  return data;
}

/** Crée un lien/code d'invitation valable 7 jours. */
export async function createInvite(householdId, userId) {
  const code = generateInviteCode();
  const { data, error } = await supabase
    .from('household_invites')
    .insert({ household_id: householdId, created_by: userId, code })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export function inviteLink(code) {
  return `${window.location.origin}/rejoindre?code=${code}`;
}

/** Le code d'invitation actif (non utilisé, non expiré) le plus récent du foyer, s'il y en a un. */
export async function getActiveInvite(householdId) {
  const { data, error } = await supabase
    .from('household_invites')
    .select('*')
    .eq('household_id', householdId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Rejoint un foyer via le code — toute la validation se fait côté base (RPC SECURITY DEFINER). */
export async function joinHouseholdWithCode(code) {
  const { data, error } = await supabase.rpc('accept_household_invite', {
    p_code: code.trim().toUpperCase(),
  });
  if (error) {
    if (error.message?.includes('invite_invalid_or_expired')) {
      throw new Error("Ce code est invalide ou a expiré. Demandez un nouveau lien à l'autre membre du foyer.");
    }
    throw error;
  }
  return data;
}

export async function getHouseholdActivity(householdId, limit = 20) {
  const { data, error } = await supabase
    .from('household_activity_log')
    .select('*, actor:profiles(display_name)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

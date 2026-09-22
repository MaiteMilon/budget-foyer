import { supabase } from './supabaseClient.js';

/**
 * projects.js — "Mes projets" (§ demande explicite : à ne JAMAIS confondre
 * avec les comptes d'épargne ni avec "Objectifs du mois"). Un projet est
 * un simple but chiffré (ex. "Achat tablette"), avec un solde qu'on met à
 * jour manuellement — ça ne touche jamais le budget disponible ni le
 * solde d'aucun compte, c'est un suivi personnel, rien de plus.
 */

export async function getHouseholdProjects(householdId) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createProject({ householdId, ownerId, name, targetAmount, targetDate, isPrivate }) {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      household_id: householdId,
      owner_id: isPrivate ? ownerId : null,
      name,
      target_amount: targetAmount,
      target_date: targetDate || null,
      is_private: isPrivate,
      current_amount: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(id, patch) {
  const { data, error } = await supabase.from('projects').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

/** Enregistre un versement manuel (ex. argent physique mis de côté) — augmente juste le solde suivi. */
export async function contributeToProject(project, amount) {
  const { data, error } = await supabase
    .from('projects')
    .update({ current_amount: Number(project.current_amount) + Number(amount) })
    .eq('id', project.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

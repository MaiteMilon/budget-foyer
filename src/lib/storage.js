import { supabase } from './supabaseClient.js';

/**
 * Téléverse une photo de ticket dans le bucket privé "receipts", sous
 * "<household_id>/<horodatage>-<nom>" — la RLS du bucket (schema.sql)
 * n'autorise que les membres de ce foyer à la lire.
 */
export async function uploadReceiptPhoto(householdId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${householdId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  // Bucket privé : on stocke le chemin, et on génère une URL signée à
  // l'affichage plutôt qu'une URL publique permanente.
  return path;
}

export async function getReceiptSignedUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

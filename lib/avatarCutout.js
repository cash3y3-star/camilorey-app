// ============================================================
// CAMILOREY — recorte de fondo de las fotos de jugadores
// Corre 100% local (sin API externa, sin cuenta, sin costo) usando
// @imgly/background-removal-node — un modelo de IA que se descarga
// una vez y corre en el propio runner de GitHub Actions.
//
// Se procesa UNA sola vez por jugador (se guarda el resultado en
// Supabase Storage y se cachea en players.avatar_cutout_url) — no en
// cada corrida del sync, porque el recorte tarda varios segundos por
// imagen y no tiene sentido repetirlo si ya lo tenemos.
// ============================================================

const BUCKET = 'avatars';

async function ensureBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`storage.listBuckets: ${error.message}`);
  if ((buckets || []).some((b) => b.name === BUCKET)) return;

  const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (createErr && !createErr.message.includes('already exists')) {
    throw new Error(`storage.createBucket: ${createErr.message}`);
  }
}

// Devuelve la URL pública del recorte (nueva o ya existente), o null
// si no se pudo procesar. No lanza — un fallo acá no debe tumbar el
// resto del sync, solo nos quedamos sin el recorte para ese jugador.
async function ensureAvatarCutout(supabase, playerId, avatarUrl) {
  if (!avatarUrl) return null;

  const { data: existing, error: selErr } = await supabase
    .from('players')
    .select('avatar_cutout_url')
    .eq('id', playerId)
    .maybeSingle();
  if (selErr) {
    console.error(`No se pudo revisar avatar_cutout_url(${playerId}): ${selErr.message}`);
    return null;
  }
  if (existing?.avatar_cutout_url) return existing.avatar_cutout_url;

  try {
    const { removeBackground } = require('@imgly/background-removal-node');
    const blob = await removeBackground(avatarUrl);
    const buffer = Buffer.from(await blob.arrayBuffer());

    await ensureBucket(supabase);

    const path = `${playerId}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: 'image/png',
      upsert: true
    });
    if (upErr) throw new Error(`storage.upload: ${upErr.message}`);

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const cutoutUrl = pub?.publicUrl;
    if (!cutoutUrl) return null;

    const { error: updErr } = await supabase.from('players').update({ avatar_cutout_url: cutoutUrl }).eq('id', playerId);
    if (updErr) throw new Error(`update players avatar_cutout_url: ${updErr.message}`);

    console.log(`Recorte de fondo listo para jugador ${playerId}`);
    return cutoutUrl;
  } catch (e) {
    console.error(`No se pudo recortar el fondo del jugador ${playerId}: ${e.message}`);
    return null;
  }
}

module.exports = { ensureAvatarCutout };

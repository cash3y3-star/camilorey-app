// ============================================================
// CZECH IA AGENTS — el admin corrige a mano un pick PENDIENTE: elige cuál
// de los dos jugadores del partido es el favorito y/o ajusta la confianza
// publicada. Pedido explícito 2026-08-04: esto es SOLO para corregir lo
// que se ve en el sitio — el modelo ML (lib/ml-model.js) sigue
// entrenándose exclusivamente con el ganador REAL del partido + los
// factors ya guardados (scripts/sync.js:trainPredictionModel), esta
// corrección manual no se guarda como dato de entrenamiento.
// Mismo patrón de auth que admin-tipster-pick.js.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '../../lib/adminAuth';

// Mismo piso que MIN_CONFIDENCE_TO_PUBLISH en scripts/sync.js:generatePick
// — no está exportado como constante compartida, así que se repite acá a
// propósito (si se cambia allá, hay que cambiarlo acá también).
const MIN_CONFIDENCE_TO_PUBLISH = 60;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { user, isAdmin, displayName } = await checkAdmin(supabase, token);
  if (!isAdmin) {
    return res.status(403).json({ error: 'solo un admin puede editar picks' });
  }

  const { pickId, predictedWinnerId, confidence } = req.body || {};
  if (!pickId) return res.status(400).json({ error: 'falta el pick' });
  if (!predictedWinnerId) return res.status(400).json({ error: 'falta elegir el favorito' });
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return res.status(400).json({ error: 'falta la confianza' });
  }

  const { data: pick, error: pickErr } = await supabase
    .from('picks')
    .select('id, match_id, result, predicted_winner_id, odds')
    .eq('id', pickId)
    .maybeSingle();
  if (pickErr) return res.status(500).json({ error: pickErr.message });
  if (!pick) return res.status(404).json({ error: 'pick no encontrado' });
  if (pick.result !== 'pending') {
    return res.status(400).json({ error: 'solo se pueden editar picks pendientes' });
  }

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('player_a_id, player_b_id')
    .eq('id', pick.match_id)
    .maybeSingle();
  if (matchErr) return res.status(500).json({ error: matchErr.message });
  if (!match) return res.status(404).json({ error: 'no se encontró el partido de este pick' });
  if (predictedWinnerId !== match.player_a_id && predictedWinnerId !== match.player_b_id) {
    return res.status(400).json({ error: 'ese jugador no juega este partido' });
  }

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('id, name')
    .in('id', [match.player_a_id, match.player_b_id]);
  if (playersErr) return res.status(500).json({ error: playersErr.message });
  const favoredPlayer = (players || []).find((p) => p.id === predictedWinnerId);
  if (!favoredPlayer) return res.status(404).json({ error: 'no se encontró al jugador elegido' });

  // Mismo clamp 50-92 que usa lib/confidence.js — para que el número que
  // guarda esto quede en la misma escala que el resto de los picks
  // (piso de publicación, umbral viejo de Exclusivo, badges de la UI).
  const clampedConfidence = Math.max(50, Math.min(92, Math.round(confidence)));

  const winnerChanged = predictedWinnerId !== pick.predicted_winner_id;

  const { data: updated, error: updateErr } = await supabase
    .from('picks')
    .update({
      predicted_winner_id: predictedWinnerId,
      confidence: clampedConfidence,
      market: `${favoredPlayer.name} gana`,
      published: clampedConfidence >= MIN_CONFIDENCE_TO_PUBLISH,
      // picks.odds guarda la cuota de UN solo lado (el del favorito) — si
      // el favorito cambió, esa cuota vieja ya no corresponde a nadie
      // real. No se recalcula acá: scripts/sync.js:backfillMissingOdds ya
      // reintenta rellenar cualquier pick pendiente con odds=null en cada
      // corrida, así que alcanza con vaciarla.
      odds: winnerChanged ? null : pick.odds,
      prediction_source: 'manual',
      // Para que el resto de los admins vean quién corrigió el pick (ver
      // migration_040_pick_edited_by.sql) — edited_by_name queda
      // desnormalizado con el mismo displayName que ya resuelve
      // checkAdmin, no hace falta un join después para mostrarlo.
      edited_by: user.id,
      edited_by_name: displayName || user.email,
      edited_at: new Date().toISOString()
    })
    .eq('id', pickId)
    .select('id, predicted_winner_id, confidence, market, published, odds, prediction_source, edited_by_name, edited_at')
    .maybeSingle();
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  return res.status(200).json({ pick: updated });
}

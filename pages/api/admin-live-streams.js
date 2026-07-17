// ============================================================
// CAMILOREY — administra las transmisiones de YouTube por torneo
// Los streams cambian de video CADA DÍA (no son canales fijos), así
// que esto es lo que el admin usa desde el panel para actualizar el
// código -> id de video sin tener que tocar código. Mismo patrón de
// auth que send-promo.js (JWT + NEXT_PUBLIC_ADMIN_EMAIL).
// ============================================================

import { createClient } from '@supabase/supabase-js';

// Acepta tanto un id de video pelado como una URL completa de
// YouTube (watch?v=, youtu.be/, /live/, /embed/) — así el admin puede
// pegar el link tal cual lo copia del navegador.
function extractVideoId(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [/[?&]v=([a-zA-Z0-9_-]{11})/, /youtu\.be\/([a-zA-Z0-9_-]{11})/, /\/(?:live|embed)\/([a-zA-Z0-9_-]{11})/];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede administrar los streams' });
  }

  if (req.method === 'POST') {
    const code = (req.body?.tournament_code || '').trim().toUpperCase();
    const videoId = extractVideoId(req.body?.youtube_video_id_or_url);
    if (!code) return res.status(400).json({ error: 'falta el código del torneo (ej. A17)' });
    if (!videoId) return res.status(400).json({ error: 'no se pudo leer el id del video — pega la URL completa o el id de 11 caracteres' });

    const { error } = await supabase
      .from('live_streams')
      .upsert({ tournament_code: code, youtube_video_id: videoId, updated_at: new Date().toISOString() }, { onConflict: 'tournament_code' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, tournament_code: code, youtube_video_id: videoId });
  }

  if (req.method === 'DELETE') {
    const code = (req.body?.tournament_code || req.query.tournament_code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'falta el código del torneo' });
    const { error } = await supabase.from('live_streams').delete().eq('tournament_code', code);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

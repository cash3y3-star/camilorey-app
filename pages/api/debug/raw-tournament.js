// ============================================================
// CAMILOREY — debug temporal: trae el JSON crudo de un torneo directo
// de tt.league-pro.com (vía lib/tt.js) para revisar qué campos trae
// de verdad (ej. si hay detalle de bolas/puntos por set en partidos
// ya terminados, no solo en vivo). Protegido con CRON_SECRET.
// Si no se pasa ?id=, toma el torneo más reciente de nuestra propia
// tabla tournaments.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { fetchNuxtData } from '../../../lib/tt';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let id = req.query.id;
  if (!id) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await supabase
      .from('tournaments')
      .select('id, status')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return res.status(404).json({ error: 'no hay torneos en la base' });
    id = data.id;
  }

  try {
    const detail = await fetchNuxtData(`/en/tournaments/${id}`);
    const pageData = detail['tournament-page']?.pageData;
    return res.status(200).json({ id, pageData });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

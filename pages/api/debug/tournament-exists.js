// ============================================================
// CAMILOREY — verificación temporal: ¿un torneo puntual ya está en
// nuestra base? Se borra después de usarlo.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const ids = (req.query.ids || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'faltan ids' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.from('tournaments').select('id, name, status').in('id', ids);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ requested: ids, found: data });
}

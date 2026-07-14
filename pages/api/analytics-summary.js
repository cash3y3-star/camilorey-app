// ============================================================
// CAMILOREY — resumen de analítica propia (solo admin)
// Mismo patrón de auth que /api/error-log y /api/model-stats: se
// verifica el JWT de quien pide esto en el servidor, no un token de
// query. Agrega analytics_events de los últimos 7 días por
// event_name y por view, sin exponer filas individuales (nada de
// user_id ni timestamps por fila al cliente).
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede ver esto' });
  }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('analytics_events')
    .select('event_name, view, user_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20000);
  if (error) return res.status(500).json({ error: error.message });

  const byEvent = new Map();
  const byView = new Map();
  const uniqueUsers = new Set();
  for (const r of rows || []) {
    byEvent.set(r.event_name, (byEvent.get(r.event_name) || 0) + 1);
    if (r.view) byView.set(r.view, (byView.get(r.view) || 0) + 1);
    if (r.user_id) uniqueUsers.add(r.user_id);
  }

  const sortDesc = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

  return res.status(200).json({
    totalEvents: rows?.length || 0,
    uniqueLoggedInUsers: uniqueUsers.size,
    sinceDays: 7,
    byEvent: sortDesc(byEvent),
    byView: sortDesc(byView)
  });
}

// ============================================================
// CAMILOREY — preferencias de notificaciones del usuario
// GET  → trae la fila de notification_prefs (o los defaults si el
//        usuario todavía no tiene una, sin crearla hasta que guarde algo).
// POST → upsert de los campos que mande el cliente.
// Mismo patrón que push-subscribe.js: se verifica el token contra
// auth.getUser() y se opera con service_role (evita depender de RLS
// del lado del cliente para esto).
// ============================================================

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PREFS = {
  push_enabled: true,
  new_picks: true,
  high_confidence: true,
  pick_results: true,
  streak_alerts: true,
  promotions: true,
  analytics_shared: true
};

const PREF_KEYS = Object.keys(DEFAULT_PREFS);

export default async function handler(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'token inválido' });

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('notification_prefs').select('*').eq('user_id', user.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ...DEFAULT_PREFS, ...(data || {}) });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const update = { user_id: user.id, updated_at: new Date().toISOString() };
    for (const key of PREF_KEYS) {
      if (typeof body[key] === 'boolean') update[key] = body[key];
    }
    const { error } = await supabase.from('notification_prefs').upsert(update, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

// ============================================================
// CAMILOREY — activar/quitar premium a mano (solo admin)
// El pago pasa por fuera del sitio (link de TipsterPage) — cuando le
// avisan al admin que alguien pagó (correo o Telegram), esto marca a
// esa cuenta como premium por N días. Mismo patrón de auth real que
// /api/error-log, /api/model-stats, /api/bankroll-log.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede hacer esto' });
  }

  const { email, days } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'falta el correo' });

  // days=0 (o negativo) se usa para QUITAR el premium ya, sin esperar
  // a que venza solo.
  const numDays = Number(days);
  const premiumUntil =
    Number.isFinite(numDays) && numDays > 0 ? new Date(Date.now() + numDays * 24 * 3600 * 1000).toISOString() : null;

  const { data, error } = await supabase
    .from('profiles')
    .update({ premium_until: premiumUntil })
    .ilike('email', email.trim())
    .select('id, email, premium_until');

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'no hay ninguna cuenta registrada con ese correo' });
  }

  return res.status(200).json({ profile: data[0] });
}

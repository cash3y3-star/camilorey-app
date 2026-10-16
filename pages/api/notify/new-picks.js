// ============================================================
// CZECH IA AGENTS — avisa picks EXCLUSIVOS nuevos (ruta manual)
// La lógica vive en lib/pushNotify.js. En régimen normal la corre
// scripts/sync.js directo desde GitHub Actions (sin pasar por Vercel,
// para no gastar CPU del plan Hobby); esta ruta queda como respaldo —
// sync.js la usa solo si a Actions le faltan las llaves VAPID.
// Body: { picks: [{ id, player, opponent, market, confidence, odds, tournament }] }
// Protegido con CRON_SECRET.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { setupWebPush, notifyNewExclusivePicks } from '../../../lib/pushNotify';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  if (picks.length === 0) return res.status(200).json({ sent: 0, reason: 'sin picks exclusivos nuevos' });

  if (!setupWebPush()) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return res.status(200).json(await notifyNewExclusivePicks(supabase, picks));
}

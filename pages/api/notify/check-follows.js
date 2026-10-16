// ============================================================
// CZECH IA AGENTS — vigilante de notificaciones push (ruta manual)
// La lógica vive en lib/pushNotify.js. En régimen normal la corre
// scripts/sync.js directo desde GitHub Actions (sin pasar por Vercel,
// para no gastar CPU del plan Hobby); esta ruta queda para dispararla a
// mano / respaldo, protegida con CRON_SECRET. ?reset=<matchId> reinicia
// los contadores de un partido para depurar un aviso que no llegó.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { setupWebPush, runCheckFollows } from '../../../lib/pushNotify';

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!setupWebPush()) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const result = await runCheckFollows(supabase, { reset: req.query.reset });
  return res.status(result.error ? 502 : 200).json(result);
}

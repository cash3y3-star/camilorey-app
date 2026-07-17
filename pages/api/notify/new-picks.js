// ============================================================
// CAMILOREY — avisa picks nuevos generados en la última corrida de sync.js
// Lo llama scripts/sync.js al final de cada corrida (no un cron
// aparte) con { newPicks, highConfidence }, protegido con CRON_SECRET
// (mismo secreto que usa notify/check-follows.js para el cron
// externo). Un usuario sin fila en notification_prefs todavía cuenta
// como "todo activado" (son los defaults de la tabla).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { newPicks, highConfidence } = req.body || {};
  if (!newPicks || newPicks <= 0) return res.status(200).json({ sent: 0, reason: 'sin picks nuevos' });

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }
  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('push_subscriptions').select('*'),
    supabase.from('notification_prefs').select('user_id, push_enabled, new_picks, high_confidence')
  ]);
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, reason: 'sin suscripciones' });

  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));
  const getPref = (userId, key) => {
    const row = prefsByUser.get(userId);
    return row ? row[key] !== false : true; // sin fila = defaults (todo activado)
  };

  const errors = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      if (!getPref(sub.user_id, 'push_enabled')) return;
      const wantsHighConfidence = highConfidence > 0 && getPref(sub.user_id, 'high_confidence');
      const wantsNewPicks = getPref(sub.user_id, 'new_picks');
      if (!wantsHighConfidence && !wantsNewPicks) return;

      const payload = wantsHighConfidence
        ? {
            title: '🔥 Picks de alta confianza',
            body: `${highConfidence} pick${highConfidence === 1 ? '' : 's'} nuevo${highConfidence === 1 ? '' : 's'} con 85%+ de confianza ya está${highConfidence === 1 ? '' : 'n'} disponible${highConfidence === 1 ? '' : 's'}.`,
            tag: 'new-picks',
            renotify: true,
            url: '/#picks'
          }
        : {
            title: '🎾 Nuevos picks IA',
            body: `${newPicks} pick${newPicks === 1 ? '' : 's'} nuevo${newPicks === 1 ? '' : 's'} ya está${newPicks === 1 ? '' : 'n'} disponible${newPicks === 1 ? '' : 's'}.`,
            tag: 'new-picks',
            renotify: true,
            url: '/#picks'
          };

      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        errors.push({ endpoint: sub.endpoint.slice(-24), statusCode: e.statusCode, message: e.message });
        const isVapidMismatch = e.statusCode === 403 && /vapid credentials/i.test(e.body || '');
        if (e.statusCode === 404 || e.statusCode === 410 || isVapidMismatch) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    })
  );

  return res.status(200).json({ sent, errors });
}

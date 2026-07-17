// ============================================================
// CAMILOREY — envía una notificación de promoción/novedad a todos los
// usuarios con esa categoría activada. A diferencia de check-follows.js
// y new-picks.js (que dispara un cron o sync.js), esta la llama el
// admin a mano cuando quiere anunciar algo — mismo patrón de auth que
// /api/analytics-summary.js (JWT verificado en el servidor contra
// NEXT_PUBLIC_ADMIN_EMAIL, no un secreto de cron).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede mandar promociones' });
  }

  const { title, body, url } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'faltan title y body' });

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }
  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const [{ data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('push_subscriptions').select('*'),
    supabase.from('notification_prefs').select('user_id, push_enabled, promotions')
  ]);
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, reason: 'sin suscripciones' });

  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));
  const allows = (userId, key) => {
    const row = prefsByUser.get(userId);
    return row ? row[key] !== false : true;
  };

  const payload = { title, body, tag: 'promo', renotify: true, url: url || '/' };
  let sent = 0;
  const errors = [];
  await Promise.all(
    subs
      .filter((sub) => allows(sub.user_id, 'push_enabled') && allows(sub.user_id, 'promotions'))
      .map(async (sub) => {
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

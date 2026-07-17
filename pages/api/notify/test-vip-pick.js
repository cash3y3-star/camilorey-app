// ============================================================
// CAMILOREY — prueba el aviso de "Pick Exclusivo nuevo" en el propio
// dispositivo del admin, con datos REALES (el Exclusivo más reciente
// publicado), sin esperar a que sync.js genere uno nuevo. Mismo
// patrón de auth que send-promo.js (JWT + NEXT_PUBLIC_ADMIN_EMAIL).
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
    return res.status(403).json({ error: 'solo el admin puede probar esto' });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }
  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', user.id);
  if (!subs || subs.length === 0) {
    return res.status(400).json({ error: 'esta cuenta no tiene notificaciones activadas en este navegador todavía' });
  }

  const { data: recentPick } = await supabase
    .from('picks')
    .select('market, confidence, odds')
    .eq('is_exclusive', true)
    .eq('published', true)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  const pick = recentPick || { market: 'Jugador Ejemplo gana', confidence: 90, odds: 1.75 };
  const oddsTxt = pick.odds ? ` · cuota ${Number(pick.odds).toFixed(2)}` : '';
  const payload = {
    title: '🔒 Pick Exclusivo nuevo (prueba)',
    body: `${pick.market} — ${pick.confidence}% de Índice IA${oddsTxt}.`,
    tag: 'new-picks',
    renotify: true,
    url: '/#picks'
  };

  let sent = 0;
  const errors = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        errors.push({ statusCode: e.statusCode, message: e.message });
      }
    })
  );

  return res.status(200).json({ sent, errors, preview: payload });
}

// ============================================================
// CAMILOREY — avisa picks EXCLUSIVOS nuevos, solo a Exclusivo/Premium
// Lo llama scripts/sync.js al final de cada corrida (no un cron
// aparte) con { picks: [{ player, opponent, market, confidence, odds,
// tournament }, ...] } — solo picks que ya calificaron como
// Exclusivo. Pedido 2026-07-16: "solo va avisar de picks vips a los
// usuarios exclusivos" — antes avisaba de TODO pick nuevo a quien
// tuviera el toggle prendido, sin mirar si la cuenta era premium.
// Protegido con CRON_SECRET, mismo patrón que check-follows.js.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// Título + cuerpo con los datos reales del pick — mismo nivel de
// detalle que la referencia guardada (jugador, mercado, confianza,
// cuota), pero sin inventar metodología que no usamos (nada de
// "simulaciones Monte Carlo": nuestro Índice IA es real, esa frase no).
function formatSinglePick(pick) {
  const oddsTxt = pick.odds ? ` · cuota ${Number(pick.odds).toFixed(2)}` : '';
  const tourTxt = pick.tournament ? ` (${pick.tournament})` : '';
  return {
    title: '🔒 Pick Exclusivo nuevo',
    body: `${pick.market} — ${pick.confidence}% de Índice IA${oddsTxt}${tourTxt}.`
  };
}

function formatMultiPick(picks) {
  const names = picks.slice(0, 3).map((p) => p.player).join(', ');
  return {
    title: `🔒 ${picks.length} picks Exclusivos nuevos`,
    body: `${names}${picks.length > 3 ? ' y más' : ''} — revisa tu ventaja en Exclusivo.`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  if (picks.length === 0) return res.status(200).json({ sent: 0, reason: 'sin picks exclusivos nuevos' });

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }
  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Audiencia: Exclusivo/Premium activo, o el admin (para poder ver
  // avisos reales sin tener que activarse premium a sí mismo).
  const nowIso = new Date().toISOString();
  const [{ data: premiumProfiles }, { data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('profiles').select('id, email').gt('premium_until', nowIso),
    supabase.from('push_subscriptions').select('*'),
    supabase.from('notification_prefs').select('user_id, push_enabled, new_picks, high_confidence')
  ]);
  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0, reason: 'sin suscripciones' });

  const premiumUserIds = new Set((premiumProfiles || []).map((p) => p.id));
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  let adminUserId = null;
  if (adminEmail) {
    const { data: adminUser } = await supabase.from('profiles').select('id').eq('email', adminEmail).maybeSingle();
    adminUserId = adminUser?.id || null;
  }

  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));
  const allows = (userId, key) => {
    const row = prefsByUser.get(userId);
    return row ? row[key] !== false : true;
  };

  const eligibleSubs = subs.filter((sub) => {
    const isExclusiveUser = premiumUserIds.has(sub.user_id) || sub.user_id === adminUserId;
    if (!isExclusiveUser) return false;
    if (!allows(sub.user_id, 'push_enabled')) return false;
    return allows(sub.user_id, 'new_picks') || allows(sub.user_id, 'high_confidence');
  });
  if (eligibleSubs.length === 0) return res.status(200).json({ sent: 0, reason: 'sin exclusivos suscritos' });

  const payload = picks.length === 1 ? formatSinglePick(picks[0]) : formatMultiPick(picks);
  payload.tag = 'new-picks';
  payload.renotify = true;
  payload.url = '/#picks';

  let sent = 0;
  const errors = [];
  await Promise.all(
    eligibleSubs.map(async (sub) => {
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

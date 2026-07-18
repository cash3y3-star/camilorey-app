// ============================================================
// CAMILOREY — el admin marca a mano "el pick de CAMILOREY" (el
// tipster del sitio) sobre un partido puntual. Solo puede haber uno
// activo a la vez (pendiente) — marcar uno nuevo reemplaza al
// anterior, salvo que ya se haya resuelto (ese conserva la marca como
// historial). Al marcar uno nuevo, dispara push a Exclusivo/Premium —
// mismo criterio de audiencia que /api/notify/new-picks.js
// (premium_until vigente + notification_prefs.push_enabled) — y queda
// visible en Inicio, salvo que el pick sea is_exclusive=true, en cuyo
// caso solo lo ve quien tenga Exclusivo (mismo candado que el resto
// del sitio).
//
// El body manda el ESTADO DESTINO explícito ({ pickId, tipsterPick:
// true|false }), no un "toggle" que el servidor decide leyendo la fila
// actual — a propósito: un toggle server-side no es seguro ante una
// petición duplicada (doble tap, reintento de red porque esta misma
// función tarda unos segundos mandando los push antes de responder,
// dos pestañas abiertas, etc.) — la segunda llamada, al ver que ya
// quedó marcado por la primera, lo desmarcaba sola (bug real
// reportado: "se siguen desmarcando los picks que le doy destacar").
// Con el estado destino explícito, una llamada duplicada pide lo
// MISMO de nuevo — no-op, sin importar cuántas veces llegue.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

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

  const { pickId, tipsterPick: wantMarked } = req.body || {};
  if (!pickId) return res.status(400).json({ error: 'falta el pick' });

  const { data: pick, error: pickErr } = await supabase
    .from('picks')
    .select('id, market, odds, predicted_winner_id, tipster_pick')
    .eq('id', pickId)
    .maybeSingle();
  if (pickErr) return res.status(500).json({ error: pickErr.message });
  if (!pick) return res.status(404).json({ error: 'pick no encontrado' });

  if (!wantMarked) {
    if (pick.tipster_pick) {
      const { error } = await supabase.from('picks').update({ tipster_pick: false, tipster_pick_at: null }).eq('id', pickId);
      if (error) return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ tipsterPick: false });
  }

  // Ya estaba marcado — una llamada duplicada no debe reenviar el push
  // ni tocar nada de nuevo.
  if (pick.tipster_pick) {
    return res.status(200).json({ tipsterPick: true });
  }

  // Solo se limpia el pick PENDIENTE que estuviera activo antes — uno
  // que ya se resolvió conserva el tipster_pick que tenía (mismo
  // criterio que picks.featured en sync.js), así queda como historial
  // real de qué se destacó para Exclusivos y cómo salió, en vez de
  // perderse cada vez que se marca uno nuevo.
  await supabase.from('picks').update({ tipster_pick: false, tipster_pick_at: null }).eq('tipster_pick', true).eq('result', 'pending');
  const nowIso = new Date().toISOString();
  const { error: setErr } = await supabase.from('picks').update({ tipster_pick: true, tipster_pick_at: nowIso }).eq('id', pickId);
  if (setErr) return res.status(500).json({ error: setErr.message });

  // El aviso push es "mejor esfuerzo" — si falla, el pick ya quedó
  // marcado igual, no se revierte por esto.
  try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      const { data: favoredPlayer } = pick.predicted_winner_id
        ? await supabase.from('players').select('name').eq('id', pick.predicted_winner_id).maybeSingle()
        : { data: null };

      const [{ data: premiumProfiles }, { data: subs }, { data: prefs }, { data: adminUser }] = await Promise.all([
        supabase.from('profiles').select('id').gt('premium_until', nowIso),
        supabase.from('push_subscriptions').select('*'),
        supabase.from('notification_prefs').select('user_id, push_enabled'),
        process.env.NEXT_PUBLIC_ADMIN_EMAIL
          ? supabase.from('profiles').select('id').eq('email', process.env.NEXT_PUBLIC_ADMIN_EMAIL).maybeSingle()
          : Promise.resolve({ data: null })
      ]);

      if (subs && subs.length) {
        // Mismo criterio que /api/notify/new-picks.js: el admin también
        // entra en la audiencia (aunque su perfil no tenga premium_until)
        // para poder ver el aviso real al probarlo, sin tener que
        // activarse premium a sí mismo.
        const premiumUserIds = new Set((premiumProfiles || []).map((p) => p.id));
        if (adminUser?.id) premiumUserIds.add(adminUser.id);
        const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));
        const pushAllowed = (userId) => {
          const row = prefsByUser.get(userId);
          return row ? row.push_enabled !== false : true;
        };
        const eligibleSubs = subs.filter((sub) => premiumUserIds.has(sub.user_id) && pushAllowed(sub.user_id));

        if (eligibleSubs.length) {
          webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
          const oddsTxt = pick.odds ? ` · cuota ${Number(pick.odds).toFixed(2)}` : '';
          const payload = JSON.stringify({
            title: '🎯 CAMILOREY marcó un pick',
            body: `${favoredPlayer?.name ? favoredPlayer.name + ' — ' : ''}${pick.market}${oddsTxt}`,
            tag: 'tipster-pick',
            renotify: true,
            url: '/#picks'
          });
          await Promise.all(
            eligibleSubs.map((sub) =>
              webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(() => {})
            )
          );
        }
      }
    }
  } catch (e) {
    console.error('No se pudo avisar el pick del tipster:', e.message);
  }

  return res.status(200).json({ tipsterPick: true });
}

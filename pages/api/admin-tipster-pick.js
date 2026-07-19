// ============================================================
// CAMILOREY — el admin marca a mano "el pick de CAMILOREY" (el
// tipster del sitio) sobre un partido puntual. Pueden estar destacados
// varios picks pendientes a la vez (pedido 2026-07-19: "marque dos
// pendientes" — antes marcar uno nuevo le quitaba la marca al
// pendiente anterior, y eso se sentía como un bug, no como el límite
// que era) — cada uno se marca y se resuelve por separado, sin pisarse
// entre sí. Al marcar uno nuevo, dispara push a Exclusivo/Premium —
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
import { sendTelegramPhoto, buildPickCardUrl, buildPickCaption } from '../../lib/telegram';

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
    .select('id, match_id, market, odds, confidence, predicted_winner_id, tipster_pick, result')
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

  const nowIso = new Date().toISOString();
  const { error: setErr } = await supabase.from('picks').update({ tipster_pick: true, tipster_pick_at: nowIso }).eq('id', pickId);
  if (setErr) return res.status(500).json({ error: setErr.message });

  // El aviso push es "mejor esfuerzo" — si falla, el pick ya quedó
  // marcado igual, no se revierte por esto. Si el pick YA estaba
  // resuelto (marcado a mano después, para recuperar historial —
  // ej. uno que se destacó antes del arreglo que preserva destacados
  // resueltos, y perdió la marca), no tiene sentido avisar "pick
  // nuevo" de un partido que ya terminó hace rato.
  try {
    if (pick.result === 'pending') {
      const { data: favoredPlayer } = pick.predicted_winner_id
        ? await supabase.from('players').select('name, avatar_url, avatar_cutout_url').eq('id', pick.predicted_winner_id).maybeSingle()
        : { data: null };

      // Para armar la tarjeta hace falta también el rival — pick no lo
      // guarda directo, se saca del match (player_a/player_b, el que
      // no sea el predicted_winner_id).
      const { data: matchRow } = pick.match_id
        ? await supabase.from('matches').select('player_a_id, player_b_id').eq('id', pick.match_id).maybeSingle()
        : { data: null };
      const rivalId = matchRow
        ? matchRow.player_a_id === pick.predicted_winner_id
          ? matchRow.player_b_id
          : matchRow.player_a_id
        : null;
      const { data: rivalPlayer } = rivalId
        ? await supabase.from('players').select('name, avatar_url, avatar_cutout_url').eq('id', rivalId).maybeSingle()
        : { data: null };

      // Telegram va aparte del push — no depende de VAPID ni de que
      // haya suscriptores, es "mejor esfuerzo" propio.
      const cardUrl = buildPickCardUrl({
        favName: favoredPlayer?.name,
        favAvatar: favoredPlayer?.avatar_cutout_url || favoredPlayer?.avatar_url,
        rivalName: rivalPlayer?.name,
        rivalAvatar: rivalPlayer?.avatar_cutout_url || rivalPlayer?.avatar_url,
        market: pick.market,
        confidence: pick.confidence,
        odds: pick.odds
      });
      const caption = buildPickCaption({
        label: '🎯 CAMILOREY destacó un pick',
        favName: favoredPlayer?.name,
        rivalName: rivalPlayer?.name,
        odds: pick.odds
      });
      await sendTelegramPhoto(cardUrl, caption);

      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
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
              url: `/#pick-${pickId}`
            });
            await Promise.all(
              eligibleSubs.map((sub) =>
                webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload).catch(() => {})
              )
            );
          }
        }
      }
    }
  } catch (e) {
    console.error('No se pudo avisar el pick del tipster:', e.message);
  }

  return res.status(200).json({ tipsterPick: true });
}

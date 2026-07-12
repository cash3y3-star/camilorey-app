// ============================================================
// CAMILOREY — vigilante de notificaciones push
// Lo dispara un cronjob externo (cron-job.org) cada 30-60s con un
// token secreto. Revisa SOLO los partidos que alguien esté siguiendo
// (nunca todos), y manda una notificación push cuando:
//   - se cierra un set nuevo
//   - el partido termina
// Guarda en matches.notified_sets_count / notified_finished hasta
// dónde ya avisó, para no repetir la misma notificación dos veces.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { fetchLiveTableTennis, findLiveEvent } from '../../../lib/rushbet';

const STARTED_GRACE_MS = 40 * 60 * 1000; // margen amplio: duración típica de un cruce + demora en aparecer/salir del tablero en vivo

function extractSets(event, swapped) {
  const rawSets = event.liveData?.statistics?.sets;
  if (!rawSets) return [];
  return rawSets.home
    .map((h, i) => ({ a: h, b: rawSets.away[i] }))
    .filter((s) => s.a !== -1 || s.b !== -1)
    .map((s) => (swapped ? { a: s.b, b: s.a } : s));
}

async function notifyFollowers(supabase, match, playerAName, playerBName, payload) {
  const { data: follows } = await supabase.from('followed_picks').select('user_id').eq('match_id', match.id);
  const userIds = [...new Set((follows || []).map((f) => f.user_id))];
  if (userIds.length === 0) return { followers: 0, subs: 0, errors: [] };

  const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', userIds);
  const errors = [];
  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (e) {
        errors.push({
          endpoint: sub.endpoint.slice(-24),
          statusCode: e.statusCode,
          message: e.message,
          body: e.body || null
        });
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    })
  );
  return { followers: userIds.length, subs: (subs || []).length, errors };
}

export default async function handler(req, res) {
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'faltan las llaves VAPID en el servidor' });
  }

  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Debug: reinicia el contador de un partido para forzar que se
  // vuelva a intentar el aviso en esta misma corrida (para ver el
  // error real de por qué no llegó, sin esperar al próximo set).
  if (req.query.reset) {
    await supabase
      .from('matches')
      .update({ notified_sets_count: 0, notified_finished: false })
      .eq('id', Number(req.query.reset));
  }

  const { data: follows } = await supabase.from('followed_picks').select('match_id');
  const matchIds = [...new Set((follows || []).map((f) => f.match_id))];
  if (matchIds.length === 0) return res.status(200).json({ checked: 0 });

  const { data: matches } = await supabase
    .from('matches')
    .select('id, source_id, player_a_id, player_b_id, scheduled_at, notified_started, notified_sets_count, notified_finished')
    .in('id', matchIds)
    .eq('notified_finished', false);

  if (!matches || matches.length === 0) return res.status(200).json({ checked: 0 });

  const playerIds = [...new Set(matches.flatMap((m) => [m.player_a_id, m.player_b_id]).filter(Boolean))];
  const { data: players } = await supabase.from('players').select('id, name').in('id', playerIds);
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  let liveEvents = [];
  try {
    liveEvents = await fetchLiveTableTennis();
  } catch (e) {
    console.error('No se pudo leer el tablero en vivo de Rushbet:', e.message);
    return res.status(502).json({ error: e.message });
  }

  let checked = 0;
  const debug = [];
  for (const match of matches) {
    checked += 1;
    const playerA = playersById.get(match.player_a_id);
    const playerB = playersById.get(match.player_b_id);
    if (!playerA || !playerB) {
      debug.push({ matchId: match.id, issue: 'falta jugador A o B en players' });
      continue;
    }
    const label = `${playerA.name} vs ${playerB.name}`;

    const found = findLiveEvent(liveEvents, playerA.name, playerB.name);

    if (found && found.event.event?.state === 'STARTED') {
      if (!match.notified_started) {
        const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
          title: '¡Comenzó el partido!',
          body: label,
          tag: `match-${match.id}-started`,
          url: '/#seguidos'
        });
        await supabase.from('matches').update({ notified_started: true }).eq('id', match.id);
        debug.push({ matchId: match.id, label, found: true, event: 'partido arrancó', ...r });
      }

      const sets = extractSets(found.event, found.swapped);
      // Un set queda decidido en 11 (o más, en caso de deuce) con al menos 2 de ventaja —
      // si no, un set en curso tipo 11-10 se contaría como cerrado sin estarlo.
      const closedSets = sets.filter((s) => (s.a >= 11 || s.b >= 11) && Math.abs(s.a - s.b) >= 2);
      if (closedSets.length > match.notified_sets_count) {
        const lastSet = closedSets[closedSets.length - 1];
        const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
          title: 'Set terminado',
          body: `${label} · Set ${closedSets.length}: ${lastSet.a}-${lastSet.b}`,
          tag: `match-${match.id}-set-${closedSets.length}`,
          url: '/#calendario'
        });
        await supabase.from('matches').update({ notified_sets_count: closedSets.length }).eq('id', match.id);
        debug.push({ matchId: match.id, label, found: true, event: 'set cerrado', ...r });
      } else {
        debug.push({
          matchId: match.id,
          label,
          found: true,
          state: 'STARTED',
          closedSets: closedSets.length,
          notifiedSetsCount: match.notified_sets_count,
          event: 'sin novedad'
        });
      }
      continue;
    }

    if (found) {
      // El evento sigue en el tablero pero Kambi ya no lo marca como en curso: terminó.
      const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
        title: 'Partido finalizado',
        body: label,
        tag: `match-${match.id}-final`,
        url: '/#calendario'
      });
      await supabase.from('matches').update({ notified_finished: true }).eq('id', match.id);
      debug.push({ matchId: match.id, label, found: true, event: 'partido terminado (kambi)', ...r });
      continue;
    }

    const scheduledMs = new Date(match.scheduled_at).getTime();
    const startedLongAgo = Date.now() - scheduledMs > STARTED_GRACE_MS;
    const wasSeenLive = match.notified_sets_count > 0;
    if (wasSeenLive || startedLongAgo) {
      const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
        title: 'Partido finalizado',
        body: label,
        tag: `match-${match.id}-final`,
        url: '/#calendario'
      });
      await supabase.from('matches').update({ notified_finished: true }).eq('id', match.id);
      debug.push({ matchId: match.id, label, found: false, event: 'partido terminado (no en kambi)', ...r });
    } else {
      debug.push({ matchId: match.id, label, found: false, event: 'todavía no visto en vivo, esperando' });
    }
  }

  return res.status(200).json({ checked, debug });
}

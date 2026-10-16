// ============================================================
// CZECH IA AGENTS — notificaciones push (lógica compartida)
// Antes vivía solo dentro de pages/api/notify/check-follows.js y
// new-picks.js, y scripts/sync.js las llamaba por HTTP a Vercel al
// final de cada corrida (cada ~1 min). Eso gastaba CPU de Vercel en
// cada sync — el plan Hobby se pausó por "Fluid Active CPU" en
// sep-2026. Ahora sync.js (GitHub Actions, gratis) llama estas
// funciones directo; las rutas de Vercel quedan como envoltorio fino
// para pruebas manuales / respaldo.
// ============================================================

const webpush = require('web-push');
const { fetchLiveTableTennis, findLiveEvent } = require('./rushbet');

// Configura web-push con las llaves VAPID. Devuelve false si faltan.
function setupWebPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails('mailto:lospeepff@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  return true;
}

const STARTED_GRACE_MS = 40 * 60 * 1000; // margen amplio: duración típica de un cruce + demora en aparecer/salir del tablero en vivo

function extractSets(event, swapped) {
  const rawSets = event.liveData?.statistics?.sets;
  if (!rawSets) return [];
  return rawSets.home
    .map((h, i) => ({ a: h, b: rawSets.away[i] }))
    .filter((s) => s.a !== -1 || s.b !== -1)
    .map((s) => (swapped ? { a: s.b, b: s.a } : s));
}

// Sin fila en notification_prefs = defaults (todo activado) — mismo
// criterio que /api/notify/new-picks.js.
function prefAllows(prefsByUser, userId, key) {
  const row = prefsByUser.get(userId);
  return row ? row[key] !== false : true;
}

// El aviso de "partido terminado" antes no decía si el pick ganó o
// perdió — solo que el partido acabó, dejando que cada quien entrara
// a revisar. Si sync.js ya resolvió el pick de este partido (picks.
// result), se arma un título/cuerpo distinto según acertó o no; si
// todavía está 'pending' (sync.js no ha corrido de nuevo), se manda
// el aviso genérico de siempre — no se bloquea la notificación
// esperando la resolución.
async function buildFinishedPayload(supabase, match, label) {
  const { data: pick } = await supabase.from('picks').select('id, result').eq('match_id', match.id).maybeSingle();
  const url = pick?.id ? `/#pick-${pick.id}` : '/#seguidos';
  if (pick?.result === 'hit') {
    return { title: '🎉 ¡Pick acertado!', body: `${label} — tu pick ganó.`, resolved: true, url };
  }
  if (pick?.result === 'miss') {
    return { title: 'Pick fallado', body: `${label} — esta vez no se dio.`, resolved: true, url };
  }
  return { title: 'Partido finalizado', body: label, resolved: false, url };
}

// Segunda pasada, siempre corre (como checkStreaks): partidos que ya
// se avisaron como "terminados" pero en ese momento el pick todavía
// estaba 'pending' — si sync.js ya lo resolvió desde entonces, manda
// el aviso de acertó/falló que se quedó pendiente. Mismo tag que el
// aviso de "terminado" (renotify:true), así en el navegador/celular
// reemplaza esa notificación en vez de apilar una nueva al lado.
async function checkPendingResults(supabase) {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, player_a_id, player_b_id')
    .eq('notified_finished', true)
    .eq('notified_result', false);
  if (!matches || matches.length === 0) return { checked: 0, resolved: 0 };

  const matchIds = matches.map((m) => m.id);
  const { data: follows } = await supabase.from('followed_picks').select('match_id').in('match_id', matchIds);
  const followedMatchIds = new Set((follows || []).map((f) => f.match_id));
  const relevantMatches = matches.filter((m) => followedMatchIds.has(m.id));
  if (relevantMatches.length === 0) {
    // Nadie sigue estos partidos (ya no importa el resultado para
    // nadie) — se marcan resueltos igual para no revisarlos por
    // siempre en cada corrida.
    await supabase.from('matches').update({ notified_result: true }).in('id', matches.map((m) => m.id));
    return { checked: matches.length, resolved: 0 };
  }

  const playerIds = [...new Set(relevantMatches.flatMap((m) => [m.player_a_id, m.player_b_id]).filter(Boolean))];
  const { data: players } = await supabase.from('players').select('id, name').in('id', playerIds);
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  let resolved = 0;
  for (const match of relevantMatches) {
    const { data: pick } = await supabase.from('picks').select('id, result').eq('match_id', match.id).maybeSingle();
    if (pick?.result !== 'hit' && pick?.result !== 'miss') continue;

    const playerA = playersById.get(match.player_a_id);
    const playerB = playersById.get(match.player_b_id);
    const label = playerA && playerB ? `${playerA.name} vs ${playerB.name}` : `Partido ${match.id}`;
    const payload =
      pick.result === 'hit'
        ? { title: '🎉 ¡Pick acertado!', body: `${label} — tu pick ganó.` }
        : { title: 'Pick fallado', body: `${label} — esta vez no se dio.` };

    await notifyFollowers(supabase, match, playerA?.name, playerB?.name, {
      ...payload,
      tag: `match-${match.id}`,
      renotify: true,
      url: pick.id ? `/#pick-${pick.id}` : '/#seguidos'
    });
    await supabase.from('matches').update({ notified_result: true }).eq('id', match.id);
    resolved++;
  }

  return { checked: relevantMatches.length, resolved };
}

async function notifyFollowers(supabase, match, playerAName, playerBName, payload) {
  const { data: follows } = await supabase.from('followed_picks').select('user_id').eq('match_id', match.id);
  let userIds = [...new Set((follows || []).map((f) => f.user_id))];
  if (userIds.length === 0) return { followers: 0, subs: 0, errors: [] };

  const { data: prefs } = await supabase
    .from('notification_prefs')
    .select('user_id, push_enabled, pick_results')
    .in('user_id', userIds);
  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));
  userIds = userIds.filter((id) => prefAllows(prefsByUser, id, 'push_enabled') && prefAllows(prefsByUser, id, 'pick_results'));
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
        // 404/410 = el navegador ya no tiene esa suscripción. 403 con
        // "VAPID credentials... do not correspond" = quedó creada con
        // una llave pública vieja (se regeneraron las llaves VAPID
        // después) — nunca va a funcionar sola, hay que borrarla para
        // que la persona la vuelva a crear con la llave actual.
        const isVapidMismatch = e.statusCode === 403 && /vapid credentials/i.test(e.body || '');
        if (e.statusCode === 404 || e.statusCode === 410 || isVapidMismatch) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    })
  );
  return { followers: userIds.length, subs: (subs || []).length, errors };
}

// Racha personal de cada usuario sobre SUS picks seguidos ya resueltos
// (hit/miss), ordenados por cuándo se jugó el partido — no por cuándo
// los siguió. Se corre una vez por cron (no por partido): recalcular
// la racha completa es barato para el volumen que maneja esta app, y
// evita tener que engancharse a cada resolución individual. Solo
// avisa cuando la racha CAMBIÓ de largo desde el último aviso
// (notified_streaks), para no repetir "llevas 3 seguidas" en cada
// corrida mientras la racha sigue en 3.
async function checkStreaks(supabase) {
  const { data: follows } = await supabase.from('followed_picks').select('user_id, pick_id, match_id');
  if (!follows || follows.length === 0) return { usersChecked: 0, notified: 0 };

  const pickIds = [...new Set(follows.map((f) => f.pick_id))];
  const matchIds = [...new Set(follows.map((f) => f.match_id))];
  const [{ data: picks }, { data: matches }, { data: prefs }] = await Promise.all([
    supabase.from('picks').select('id, result').in('id', pickIds),
    supabase.from('matches').select('id, scheduled_at').in('id', matchIds),
    supabase.from('notification_prefs').select('user_id, push_enabled, streak_alerts').in(
      'user_id',
      [...new Set(follows.map((f) => f.user_id))]
    )
  ]);
  const resultByPick = new Map((picks || []).map((p) => [p.id, p.result]));
  const scheduledByMatch = new Map((matches || []).map((m) => [m.id, m.scheduled_at]));
  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));

  const byUser = new Map();
  for (const f of follows) {
    const result = resultByPick.get(f.pick_id);
    if (result !== 'hit' && result !== 'miss') continue;
    if (!byUser.has(f.user_id)) byUser.set(f.user_id, []);
    byUser.get(f.user_id).push({ result, scheduledAt: scheduledByMatch.get(f.match_id) });
  }

  const { data: notifiedRows } = await supabase.from('notified_streaks').select('user_id, last_length');
  const lastLengthByUser = new Map((notifiedRows || []).map((r) => [r.user_id, r.last_length]));

  let notified = 0;
  for (const [userId, resolved] of byUser) {
    if (!prefAllows(prefsByUser, userId, 'push_enabled') || !prefAllows(prefsByUser, userId, 'streak_alerts')) continue;
    resolved.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    let streak = 0;
    let streakResult = null;
    for (let i = resolved.length - 1; i >= 0; i--) {
      if (streakResult === null) {
        streakResult = resolved[i].result;
        streak = 1;
      } else if (resolved[i].result === streakResult) {
        streak++;
      } else {
        break;
      }
    }

    const lastNotified = lastLengthByUser.get(userId) || 0;
    if (streak < 3 || streak === lastNotified) continue;

    const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
    if (!subs || subs.length === 0) continue;

    const payload =
      streakResult === 'hit'
        ? { title: '🔥 Racha ganadora', body: `Llevas ${streak} picks seguidos acertados.`, tag: 'streak', renotify: true, url: '/#seguidos' }
        : { title: '📉 Alerta de racha', body: `Llevas ${streak} picks seguidos fallados.`, tag: 'streak', renotify: true, url: '/#seguidos' };

    for (const sub of subs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      } catch (e) {
        const isVapidMismatch = e.statusCode === 403 && /vapid credentials/i.test(e.body || '');
        if (e.statusCode === 404 || e.statusCode === 410 || isVapidMismatch) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
    await supabase.from('notified_streaks').upsert({ user_id: userId, last_length: streak, updated_at: new Date().toISOString() });
    notified++;
  }

  return { usersChecked: byUser.size, notified };
}

// Pedido 2026-07-21: avisar al usuario 1 día antes de que le venza el
// Premium, para que renueve a tiempo. Corre en cada llamada de este
// cron (cada 30-60s) — profiles.premium_expiry_notified_for guarda
// PARA QUÉ premium_until ya se mandó el aviso, así una cuenta dentro
// de la ventana de 1 día no recibe el mismo push en cada corrida; si
// renueva, premium_until cambia y el aviso se habilita solo de nuevo.
async function checkPremiumExpiring(supabase) {
  const nowIso = new Date().toISOString();
  const in1DayIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: expiring } = await supabase
    .from('profiles')
    .select('id, premium_until, premium_expiry_notified_for')
    .not('premium_until', 'is', null)
    .gt('premium_until', nowIso)
    .lte('premium_until', in1DayIso);
  if (!expiring || expiring.length === 0) return { checked: 0, notified: 0 };

  const pending = expiring.filter((p) => p.premium_expiry_notified_for !== p.premium_until);
  if (pending.length === 0) return { checked: expiring.length, notified: 0 };

  const userIds = pending.map((p) => p.id);
  const [{ data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('push_subscriptions').select('*').in('user_id', userIds),
    supabase.from('notification_prefs').select('user_id, push_enabled, promotions').in('user_id', userIds)
  ]);
  const subsByUser = new Map();
  for (const sub of subs || []) {
    if (!subsByUser.has(sub.user_id)) subsByUser.set(sub.user_id, []);
    subsByUser.get(sub.user_id).push(sub);
  }
  const prefsByUser = new Map((prefs || []).map((p) => [p.user_id, p]));

  let notified = 0;
  for (const profile of pending) {
    // Se marca como "ya avisado" pase lo que pase con este vencimiento
    // puntual (sin push activo, sin suscripción, o mandado) — si no,
    // un usuario sin push seguiría evaluándose en cada corrida hasta
    // que le venza, sin necesidad.
    const markDone = () => supabase.from('profiles').update({ premium_expiry_notified_for: profile.premium_until }).eq('id', profile.id);

    if (!prefAllows(prefsByUser, profile.id, 'push_enabled') || !prefAllows(prefsByUser, profile.id, 'promotions')) {
      await markDone();
      continue;
    }
    const userSubs = subsByUser.get(profile.id) || [];
    if (userSubs.length === 0) {
      await markDone();
      continue;
    }

    const payload = JSON.stringify({
      title: '⏰ Tu Premium vence mañana',
      body: 'Renová para no perderte los picks Exclusivos y el resto de las ventajas Premium.',
      tag: 'premium-expiring',
      renotify: true,
      url: '/#picks'
    });

    let sentAny = false;
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sentAny = true;
      } catch (e) {
        const isVapidMismatch = e.statusCode === 403 && /vapid credentials/i.test(e.body || '');
        if (e.statusCode === 404 || e.statusCode === 410 || isVapidMismatch) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        }
      }
    }
    await markDone();
    if (sentAny) notified++;
  }

  return { checked: expiring.length, notified };
}


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

// Vigilante de partidos seguidos (antes: handler de check-follows.js).
// Requiere setupWebPush() antes. Devuelve el mismo objeto que antes
// respondía la ruta; { error } si no se pudo leer el tablero en vivo.
async function runCheckFollows(supabase, { reset } = {}) {
  // Debug: reinicia el contador de un partido para forzar que se
  // vuelva a intentar el aviso en esta misma corrida (para ver el
  // error real de por qué no llegó, sin esperar al próximo set).
  if (reset) {
    await supabase
      .from('matches')
      .update({ notified_sets_count: 0, notified_finished: false, notified_result: false })
      .eq('id', Number(reset));
  }

  // Corre siempre, antes que nada de lo de abajo — las rachas dependen
  // del historial completo de picks seguidos ya resueltos, no de si
  // queda algún partido pendiente por avisar.
  let streaks = null;
  try {
    streaks = await checkStreaks(supabase);
  } catch (e) {
    console.error('Error revisando rachas:', e.message);
  }

  let pendingResults = null;
  try {
    pendingResults = await checkPendingResults(supabase);
  } catch (e) {
    console.error('Error revisando resultados pendientes de avisar:', e.message);
  }

  let premiumExpiring = null;
  try {
    premiumExpiring = await checkPremiumExpiring(supabase);
  } catch (e) {
    console.error('Error revisando premium por vencer:', e.message);
  }

  const { data: follows } = await supabase.from('followed_picks').select('match_id');
  const matchIds = [...new Set((follows || []).map((f) => f.match_id))];
  if (matchIds.length === 0) return { checked: 0, streaks, pendingResults, premiumExpiring };

  const { data: matches } = await supabase
    .from('matches')
    .select('id, source_id, player_a_id, player_b_id, scheduled_at, status, notified_started, notified_sets_count, notified_finished')
    .in('id', matchIds)
    .eq('notified_finished', false);

  if (!matches || matches.length === 0) return { checked: 0, streaks, pendingResults, premiumExpiring };

  const playerIds = [...new Set(matches.flatMap((m) => [m.player_a_id, m.player_b_id]).filter(Boolean))];
  const { data: players } = await supabase.from('players').select('id, name').in('id', playerIds);
  const playersById = new Map((players || []).map((p) => [p.id, p]));

  // Un solo round-trip para el pick de CADA partido de este lote.
  const { data: matchPicks } = await supabase.from('picks').select('id, match_id').in('match_id', matches.map((m) => m.id));
  const pickIdByMatchId = new Map((matchPicks || []).map((p) => [p.match_id, p.id]));

  let liveEvents = [];
  try {
    liveEvents = await fetchLiveTableTennis();
  } catch (e) {
    console.error('No se pudo leer el tablero en vivo de Rushbet:', e.message);
    return { error: e.message };
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
    // El pick de este partido — cada aviso lleva directo al detalle de
    // ESE pick (/#pick-{id}) en vez de a una pestaña genérica.
    const matchPickId = pickIdByMatchId.get(match.id);
    const pickUrl = matchPickId ? `/#pick-${matchPickId}` : '/#seguidos';

    if (found && found.event.event?.state === 'STARTED') {
      if (!match.notified_started) {
        const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
          title: '¡Comenzó el partido!',
          body: label,
          tag: `match-${match.id}`,
          url: pickUrl
        });
        await supabase.from('matches').update({ notified_started: true }).eq('id', match.id);
        debug.push({ matchId: match.id, label, found: true, event: 'partido arrancó', ...r });
      }

      const sets = extractSets(found.event, found.swapped);
      // Un set queda decidido en 11 (o más, en caso de deuce) con al menos 2 de ventaja.
      const closedSets = sets.filter((s) => (s.a >= 11 || s.b >= 11) && Math.abs(s.a - s.b) >= 2);
      if (closedSets.length > match.notified_sets_count) {
        const lastSet = closedSets[closedSets.length - 1];
        const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
          title: 'Set terminado',
          body: `${label} · Set ${closedSets.length}: ${lastSet.a}-${lastSet.b}`,
          tag: `match-${match.id}`,
          url: pickUrl
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
      const { resolved, ...finishedPayload } = await buildFinishedPayload(supabase, match, label);
      const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
        ...finishedPayload,
        tag: `match-${match.id}`
      });
      await supabase.from('matches').update({ notified_finished: true, notified_result: resolved }).eq('id', match.id);
      debug.push({ matchId: match.id, label, found: true, event: 'partido terminado (kambi)', ...r });
      continue;
    }

    // Kambi no lo tiene en el tablero — solo se manda "terminó" cuando
    // ya lo vimos en vivo y desapareció (wasSeenLive), nuestro sync ya
    // lo marcó 'finished', o pasó muchísimo tiempo (último respaldo).
    // scheduled_at no es de fiar: con mesas corridas los partidos
    // arrancan tarde muy seguido (ver historial de check-follows.js).
    const wasSeenLive = match.notified_sets_count > 0;
    const ourDataSaysFinished = match.status === 'finished';
    const scheduledMs = new Date(match.scheduled_at).getTime();
    const wayPastSchedule = Date.now() - scheduledMs > STARTED_GRACE_MS * 3;
    if (wasSeenLive || ourDataSaysFinished || wayPastSchedule) {
      const { resolved, ...finishedPayload } = await buildFinishedPayload(supabase, match, label);
      const r = await notifyFollowers(supabase, match, playerA.name, playerB.name, {
        ...finishedPayload,
        tag: `match-${match.id}`
      });
      await supabase.from('matches').update({ notified_finished: true, notified_result: resolved }).eq('id', match.id);
      debug.push({ matchId: match.id, label, found: false, event: 'partido terminado (no en kambi)', ...r });
    } else {
      debug.push({ matchId: match.id, label, found: false, event: 'todavía no visto en vivo, esperando' });
    }
  }

  return { checked, debug, streaks, pendingResults, premiumExpiring };
}

// Aviso de picks EXCLUSIVOS nuevos, solo a Exclusivo/Premium (antes:
// handler de new-picks.js). Requiere setupWebPush() antes.
// picks: [{ id, player, opponent, market, confidence, odds, tournament }]
async function notifyNewExclusivePicks(supabase, picks) {
  if (!Array.isArray(picks) || picks.length === 0) return { sent: 0, reason: 'sin picks exclusivos nuevos' };

  // Audiencia: Exclusivo/Premium activo, o el admin (para poder ver
  // avisos reales sin tener que activarse premium a sí mismo).
  const nowIso = new Date().toISOString();
  const [{ data: premiumProfiles }, { data: subs }, { data: prefs }] = await Promise.all([
    supabase.from('profiles').select('id, email').gt('premium_until', nowIso),
    supabase.from('push_subscriptions').select('*'),
    supabase.from('notification_prefs').select('user_id, push_enabled, new_picks, high_confidence')
  ]);
  if (!subs || subs.length === 0) return { sent: 0, reason: 'sin suscripciones' };

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
  if (eligibleSubs.length === 0) return { sent: 0, reason: 'sin exclusivos suscritos' };

  const payload = picks.length === 1 ? formatSinglePick(picks[0]) : formatMultiPick(picks);
  payload.tag = 'new-picks';
  payload.renotify = true;
  // Con un solo pick nuevo, manda directo a su detalle — con varios no
  // hay un único pick al que apuntar, así que cae a la pestaña Picks.
  payload.url = picks.length === 1 && picks[0].id ? `/#pick-${picks[0].id}` : '/#picks';

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

  return { sent, errors };
}

module.exports = { setupWebPush, runCheckFollows, notifyNewExclusivePicks };

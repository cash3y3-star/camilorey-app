import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabaseClient } from '../lib/supabaseClient';

const VIEWS = ['inicio', 'calendario', 'picks', 'seguidos', 'bankroll', 'grupos'];
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// El navegador pide la llave pública del servidor push en este
// formato (Uint8Array), pero VAPID la da como base64 url-safe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : '';
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Pide permiso de notificaciones, registra el service worker y guarda
// la suscripción en Supabase. Se llama la primera vez que alguien
// sigue un pick (silencioso) y también desde el botón de campana del
// header (ahí sí con feedback, ver bell-btn) — por eso devuelve un
// estado en vez de tragarse el resultado.
async function ensurePushSubscription(user) {
  if (!supabaseClient || !user) return 'error';
  if (!VAPID_PUBLIC_KEY) return 'unsupported';
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    typeof Notification === 'undefined'
  ) {
    return 'unsupported';
  }
  // El navegador NO vuelve a preguntar si ya se bloqueó una vez —
  // hay que decirle a la persona que lo active a mano desde los
  // permisos del sitio, en vez de quedarnos callados otra vez.
  if (Notification.permission === 'denied') return 'denied';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const registration = await navigator.serviceWorker.register('/sw.js');
    // getSubscription() devuelve la existente sin importar si quedó
    // creada con una llave VAPID vieja — si las llaves se regeneran
    // (como pasó una vez), el navegador se queda pegado reusando la
    // suscripción muerta para siempre. Se descarta y se crea siempre
    // una nueva con la llave actual, para no depender de que coincida.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const json = subscription.toJSON();
    // Se guarda vía API (service_role) en vez de insert/upsert directo
    // del cliente: el endpoint identifica al NAVEGADOR, no al usuario,
    // así que si alguien más ya usó este mismo navegador antes, el
    // upsert cae en un UPDATE que la política de RLS rechaza (no es
    // dueño de esa fila). El servidor no tiene esa restricción.
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        userId: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('No se pudo guardar la suscripción push:', body.error);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('No se pudo activar notificaciones push:', e.message);
    return 'error';
  }
}

// ============================================================
// Server-side: trae todo lo que la página necesita de Supabase.
// Es SSR (no getStaticProps) porque los picks/resultados cambian
// cada 30 min con el sync — siempre queremos la última data.
// ============================================================
function confidenceTier(confidence) {
  if (confidence >= 85) return 'alta';
  if (confidence >= 70) return 'media';
  return 'baja';
}

function streakLabelFromHistory(history) {
  if (!history || history.length === 0) return null;
  const last = history[history.length - 1];
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] === last) count++;
    else break;
  }
  return `${count}${last === 1 ? 'W' : 'L'}`;
}

export async function getServerSideProps({ query }) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ data: players }, { data: pendingPicks }] = await Promise.all([
    supabase.from('players').select('id, name, avatar_url, avatar_cutout_url, rating'),
    supabase.from('picks').select('*').eq('result', 'pending').order('confidence', { ascending: false })
  ]);

  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const pendingMatchIds = (pendingPicks || []).map((p) => p.match_id);
  const { data: pendingMatches } = pendingMatchIds.length
    ? await supabase.from('matches').select('*').in('id', pendingMatchIds)
    : { data: [] };
  const matchesById = new Map((pendingMatches || []).map((m) => [m.id, m]));

  const tournamentIds = [...new Set((pendingMatches || []).map((m) => m.tournament_id).filter(Boolean))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  // Forma reciente (victoria/derrota) del jugador favorito de cada
  // pick, para el gráfico del modal de detalle y para derivar la
  // racha ("3W"/"2L") sin hacer una consulta aparte.
  async function recentForm(playerId) {
    if (!playerId) return [];
    const { data } = await supabase
      .from('matches')
      .select('winner_id, player_a_id, player_b_id')
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .eq('status', 'finished')
      .order('scheduled_at', { ascending: false })
      .limit(10);
    return (data || []).map((m) => (m.winner_id === playerId ? 1 : 0)).reverse();
  }

  // Cruce directo histórico entre los dos jugadores de un pick, real
  // (no viene de picks.factors porque ahí solo se guarda el puntaje
  // normalizado, no el marcador "6-1" que se ve en la tarjeta).
  async function h2hRecord(idA, idB) {
    if (!idA || !idB) return { winsA: 0, winsB: 0 };
    const { data } = await supabase
      .from('matches')
      .select('winner_id')
      .eq('status', 'finished')
      .or(`and(player_a_id.eq.${idA},player_b_id.eq.${idB}),and(player_a_id.eq.${idB},player_b_id.eq.${idA})`)
      .limit(20);
    return {
      winsA: (data || []).filter((m) => m.winner_id === idA).length,
      winsB: (data || []).filter((m) => m.winner_id === idB).length
    };
  }

  // Un pick deja de mostrarse como "próximo" un rato ANTES de que
  // arranque el partido (no justo cuando ya casi empieza), y por
  // supuesto también una vez que ya arrancó o terminó.
  const HIDE_BEFORE_START_MS = 3 * 60 * 1000;

  // Un round-trip por pick (recentForm + h2hRecord) en serie se nota
  // mucho en el tiempo de carga apenas hay varios picks activos — se
  // lanzan todos en paralelo con Promise.all en vez de un for..await.
  const pickResults = await Promise.all(
    (pendingPicks || []).map(async (pick) => {
      const match = matchesById.get(pick.match_id);
      if (!match) return null;
      if (match.scheduled_at && new Date(match.scheduled_at).getTime() - Date.now() < HIDE_BEFORE_START_MS) return null;
      const playerA = playersById.get(match.player_a_id);
      const playerB = playersById.get(match.player_b_id);
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent = pick.predicted_winner_id === match.player_a_id ? playerB : playerA;
      // Si falta cualquiera de los dos jugadores, es un pick con datos
      // incompletos (probablemente de antes del cierre hit/miss) — mejor
      // no mostrarlo que mostrar una tarjeta rota.
      if (!favored || !opponent) return null;
      const tournament = tournamentsById.get(match.tournament_id);
      const confidence = Math.round(pick.confidence);
      const [history, h2h] = await Promise.all([recentForm(pick.predicted_winner_id), h2hRecord(favored.id, opponent.id)]);

      return {
        id: pick.id,
        matchId: match.id,
        day: dayLabel(match.scheduled_at),
        scheduledAt: new Date(match.scheduled_at).getTime(),
        player: favored?.name || '—',
        initials: initialsOf(favored?.name),
        avatarUrl: favored?.avatar_cutout_url || favored?.avatar_url || null,
        hasCutout: Boolean(favored?.avatar_cutout_url),
        opponent: opponent?.name || '—',
        opponentInitials: initialsOf(opponent?.name),
        opponentAvatarUrl: opponent?.avatar_cutout_url || opponent?.avatar_url || null,
        opponentHasCutout: Boolean(opponent?.avatar_cutout_url),
        time: timeLabel(match.scheduled_at),
        tournament: tournament?.name || 'Torneo',
        market: pick.market,
        confidence,
        tier: confidenceTier(confidence),
        odds: pick.odds ? Number(pick.odds) : null,
        analysis: buildAnalysis(pick.factors),
        history,
        streakLabel: streakLabelFromHistory(history),
        h2h: `${h2h.winsA}-${h2h.winsB}`,
        h2hTotal: h2h.winsA + h2h.winsB,
        result: 'pending'
      };
    })
  );
  const picks = pickResults.filter(Boolean);
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  // El pick destacado prioriza cuota real arriba de 1.60 — entre esos,
  // el de mayor confianza. Si ninguno tiene cuota >1.60 (o cuota del
  // todo), cae al de mayor confianza general para no dejar Inicio sin
  // destacado solo porque el cruce con Rushbet no encontró esa cuota.
  const picksWithGoodOdds = picks.filter((p) => p.odds && p.odds > 1.6);
  const topConfidence =
    (picksWithGoodOdds.length ? picksWithGoodOdds : picks).slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

  // Tabla de grupo por torneo — igual a como tt.league-pro.com la
  // muestra dentro de cada torneo: los jugadores de ESE grupo se
  // enfrentan todos contra todos, y la tabla es el cruce de
  // resultados (sets a favor/en contra por rival) + total de sets +
  // puesto. Se reconstruye 100% desde nuestros propios "matches" del
  // torneo (no hace falta un campo nuevo de scraping) — solo se arma
  // para los torneos que tienen AL MENOS un partido en vivo ahora
  // mismo, no todos los que tengan un pick pendiente (eso incluía
  // torneos que ni siquiera habían arrancado, saturando Inicio).
  const tournamentGroups = (
    await Promise.all(
      tournamentIds.map(async (tId) => {
        const { data: groupMatches } = await supabase
          .from('matches')
          .select('player_a_id, player_b_id, sets_a, sets_b, set_scores, status, scheduled_at')
          .eq('tournament_id', tId);
        if (!groupMatches || groupMatches.length === 0) return null;

        const now = Date.now();
        const isLive = groupMatches.some(
          (m) => m.status === 'live' || (m.status !== 'finished' && m.scheduled_at && new Date(m.scheduled_at).getTime() <= now)
        );
        if (!isLive) return null;

        const groupPlayerIds = [...new Set(groupMatches.flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
        if (groupPlayerIds.length < 3) return null;

        const missingIds = groupPlayerIds.filter((id) => !playersById.has(id));
        if (missingIds.length) {
          const { data: extra } = await supabase
            .from('players')
            .select('id, name, avatar_url, avatar_cutout_url, rating')
            .in('id', missingIds);
          for (const p of extra || []) playersById.set(p.id, p);
        }

        // matchupByPlayer.get(idA).get(idB) = sets de A contra B, visto desde A.
        // ballsByPlayer = puntos (bolas) ganados/perdidos, solo sumando los
        // partidos donde SÍ tenemos el detalle punto a punto (set_scores) —
        // no todos los partidos lo tienen, solo los que alguien vio en vivo
        // mientras se jugaban, así que puede quedar incompleto.
        const matchupByPlayer = new Map(groupPlayerIds.map((id) => [id, new Map()]));
        const ballsByPlayer = new Map(groupPlayerIds.map((id) => [id, { for: 0, against: 0, hasData: false }]));
        for (const m of groupMatches) {
          if (m.sets_a == null || m.sets_b == null) continue;
          matchupByPlayer.get(m.player_a_id)?.set(m.player_b_id, { for: m.sets_a, against: m.sets_b });
          matchupByPlayer.get(m.player_b_id)?.set(m.player_a_id, { for: m.sets_b, against: m.sets_a });

          if (Array.isArray(m.set_scores) && m.set_scores.length > 0) {
            const ballsA = m.set_scores.reduce((s, set) => s + (set.a || 0), 0);
            const ballsB = m.set_scores.reduce((s, set) => s + (set.b || 0), 0);
            const ba = ballsByPlayer.get(m.player_a_id);
            const bb = ballsByPlayer.get(m.player_b_id);
            if (ba) {
              ba.for += ballsA;
              ba.against += ballsB;
              ba.hasData = true;
            }
            if (bb) {
              bb.for += ballsB;
              bb.against += ballsA;
              bb.hasData = true;
            }
          }
        }

        const rows = groupPlayerIds.map((id) => {
          const p = playersById.get(id);
          let wins = 0;
          let losses = 0;
          let setsFor = 0;
          let setsAgainst = 0;
          for (const res of matchupByPlayer.get(id).values()) {
            setsFor += res.for;
            setsAgainst += res.against;
            if (res.for > res.against) wins++;
            else losses++;
          }
          const balls = ballsByPlayer.get(id);
          return {
            id,
            name: p?.name || '—',
            initials: initialsOf(p?.name),
            avatarUrl: p?.avatar_cutout_url || p?.avatar_url || null,
            rating: p?.rating != null ? Math.round(Number(p.rating)) : null,
            wins,
            setsFor,
            setsAgainst,
            // 2 puntos por partido ganado, 1 por perdido (igual al criterio
            // que usa tt.league-pro.com en su propia tabla de grupo).
            points: wins * 2 + losses,
            ballsFor: balls.hasData ? balls.for : null,
            ballsAgainst: balls.hasData ? balls.against : null
          };
        });
        rows.sort((a, b) => b.wins - a.wins || b.setsFor - b.setsAgainst - (a.setsFor - a.setsAgainst));
        rows.forEach((r, i) => (r.place = i + 1));

        const matchup = {};
        for (const id of groupPlayerIds) {
          matchup[id] = {};
          for (const [oppId, res] of matchupByPlayer.get(id)) {
            matchup[id][oppId] = `${res.for}:${res.against}`;
          }
        }

        const tournament = tournamentsById.get(tId);
        return { tournamentId: tId, name: tournament?.name || 'Torneo', players: rows, matchup };
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Picks ya resueltos (para las pestañas Ganados/Perdidos de la
  // sección Picks) — no se les calcula H2H/racha/forma reciente para
  // no multiplicar consultas por algo que ya no es accionable.
  const { data: resolvedPicksRaw } = await supabase
    .from('picks')
    .select('*')
    .neq('result', 'pending')
    .order('created_at', { ascending: false })
    .limit(60);

  const resolvedMatchIds = [...new Set((resolvedPicksRaw || []).map((p) => p.match_id))];
  const { data: resolvedMatchesRaw } = resolvedMatchIds.length
    ? await supabase.from('matches').select('*').in('id', resolvedMatchIds)
    : { data: [] };
  const resolvedMatchesById = new Map((resolvedMatchesRaw || []).map((m) => [m.id, m]));

  const resolvedExtraPlayerIds = [
    ...new Set((resolvedMatchesRaw || []).flatMap((m) => [m.player_a_id, m.player_b_id]))
  ].filter((id) => id && !playersById.has(id));
  if (resolvedExtraPlayerIds.length) {
    const { data: extra } = await supabase
      .from('players')
      .select('id, name, avatar_url, avatar_cutout_url')
      .in('id', resolvedExtraPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const resolvedExtraTournamentIds = [...new Set((resolvedMatchesRaw || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (resolvedExtraTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', resolvedExtraTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  const resolvedPicks = [];
  for (const pick of resolvedPicksRaw || []) {
    const match = resolvedMatchesById.get(pick.match_id);
    if (!match) continue;
    const favored = playersById.get(pick.predicted_winner_id);
    const opponent =
      pick.predicted_winner_id === match.player_a_id
        ? playersById.get(match.player_b_id)
        : playersById.get(match.player_a_id);
    if (!favored || !opponent) continue;
    const tournament = tournamentsById.get(match.tournament_id);
    const confidence = Math.round(pick.confidence);

    resolvedPicks.push({
      id: pick.id,
      matchId: match.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
      player: favored.name,
      initials: initialsOf(favored.name),
      avatarUrl: favored.avatar_cutout_url || favored.avatar_url || null,
      hasCutout: Boolean(favored.avatar_cutout_url),
      opponent: opponent.name,
      opponentInitials: initialsOf(opponent.name),
      opponentAvatarUrl: opponent.avatar_cutout_url || opponent.avatar_url || null,
      opponentHasCutout: Boolean(opponent.avatar_cutout_url),
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      analysis: buildAnalysis(pick.factors),
      history: [],
      streakLabel: null,
      h2h: null,
      h2hTotal: 0,
      result: pick.result
    });
  }
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

  // Resultados: por default una ventana de "ahora mismo" (unas horas
  // atrás hasta mañana). Si viene ?date=YYYY-MM-DD, se muestra ese
  // día completo (hora Colombia) en su lugar, para poder navegar
  // resultados de otros días.
  const bogotaDateStr = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const selectedDate = typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;

  let windowStart, windowEnd;
  if (selectedDate) {
    windowStart = new Date(`${selectedDate}T00:00:00-05:00`).toISOString();
    windowEnd = new Date(`${selectedDate}T23:59:59-05:00`).toISOString();
  } else {
    windowStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    windowEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  }

  const currentDateStr = selectedDate || bogotaDateStr(new Date());
  const prevDateStr = bogotaDateStr(new Date(new Date(`${currentDateStr}T12:00:00-05:00`).getTime() - 24 * 3600 * 1000));
  const nextDateStr = bogotaDateStr(new Date(new Date(`${currentDateStr}T12:00:00-05:00`).getTime() + 24 * 3600 * 1000));

  const { data: windowMatches } = await supabase
    .from('matches')
    .select('*')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(150);

  const missingPlayerIds = [...new Set((windowMatches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(
    (id) => id && !playersById.has(id)
  );
  if (missingPlayerIds.length) {
    const { data: extra } = await supabase
      .from('players')
      .select('id, name, avatar_url, avatar_cutout_url')
      .in('id', missingPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const missingTournamentIds = [...new Set((windowMatches || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (missingTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', missingTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  // Para pintar de verde/rojo el resultado del partido según si
  // nuestro pick acertó o falló (no según quién ganó a secas), y para
  // poder seguir el pick directo desde la tarjeta de Calendario.
  const windowMatchIds = (windowMatches || []).map((m) => m.id);
  const { data: windowPicks } = windowMatchIds.length
    ? await supabase.from('picks').select('id, match_id, result').in('match_id', windowMatchIds)
    : { data: [] };
  const pickResultByMatchId = new Map((windowPicks || []).map((p) => [p.match_id, p.result]));
  const pendingPickIdByMatchId = new Map(
    (windowPicks || []).filter((p) => p.result === 'pending').map((p) => [p.match_id, p.id])
  );

  const matches = (windowMatches || []).map((m) => {
    const a = playersById.get(m.player_a_id);
    const b = playersById.get(m.player_b_id);
    const t = tournamentsById.get(m.tournament_id);
    let status = 'soon';
    if (m.status === 'finished') status = 'done';
    else if (m.status === 'live') status = 'live';
    else if (new Date(m.scheduled_at) <= new Date()) status = 'live';
    const pickResult = pickResultByMatchId.get(m.id);
    return {
      matchId: m.id,
      pickId: pendingPickIdByMatchId.get(m.id) || null,
      time: timeLabel(m.scheduled_at),
      tournament: t?.name || 'Torneo',
      players: `${a?.name || '?'} vs ${b?.name || '?'}`,
      playerA: a?.name || null,
      playerB: b?.name || null,
      playerAInitials: initialsOf(a?.name),
      playerBInitials: initialsOf(b?.name),
      playerAAvatar: a?.avatar_cutout_url || a?.avatar_url || null,
      playerBAvatar: b?.avatar_cutout_url || b?.avatar_url || null,
      playerAHasCutout: Boolean(a?.avatar_cutout_url),
      playerBHasCutout: Boolean(b?.avatar_cutout_url),
      tournamentId: m.tournament_id,
      sourceId: m.source_id,
      status,
      score: status === 'done' && m.sets_a != null && m.sets_b != null ? `${m.sets_a}-${m.sets_b}` : null,
      setScores: status === 'done' ? m.set_scores || null : null,
      pickResult: status === 'done' && (pickResult === 'hit' || pickResult === 'miss') ? pickResult : null
    };
  });

  // Bankroll.
  const { data: bankrollRows } = await supabase
    .from('bankroll_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
  const { data: bkPicks } = bkPickIds.length
    ? await supabase.from('picks').select('id, market, odds').in('id', bkPickIds)
    : { data: [] };
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const bankrollLog = (bankrollRows || []).map((r) => {
    const pick = bkPicksById.get(r.pick_id);
    return {
      fecha: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', timeZone: 'America/Bogota' }).format(
        new Date(r.created_at)
      ),
      pick: pick?.market || 'Pick',
      u: `${Number(r.units) >= 0 ? '+' : ''}${Number(r.units).toFixed(1)}u`,
      ok: Number(r.units) >= 0,
      balance: `${Number(r.balance) >= 0 ? '+' : ''}${Number(r.balance).toFixed(1)}u`
    };
  });

  // Serie cronológica (más viejo primero) del balance, para el
  // gráfico de evolución — bankrollRows viene ordenado más nuevo
  // primero, así que se invierte solo para el gráfico.
  const bankrollSeries = [...(bankrollRows || [])].reverse().map((r) => Number(r.balance));

  const hits = (bankrollRows || []).filter((r) => Number(r.units) > 0).length;
  const misses = (bankrollRows || []).filter((r) => Number(r.units) < 0).length;
  const efectividad = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;

  let racha = 0;
  for (const r of bankrollRows || []) {
    const won = Number(r.units) > 0;
    if (racha === 0) racha = won ? 1 : -1;
    else if (racha > 0 === won) racha += won ? 1 : -1;
    else break;
  }

  // ROI = ganancia neta / total apostado. bankroll_log.units ya es la
  // ganancia/pérdida neta de cada apuesta, no el monto arriesgado, así
  // que el monto arriesgado se reconstruye desde la cuota real cuando
  // la tenemos (units = stake * (odds-1) en un acierto), y cae a 1:1
  // si no hay cuota — mismo criterio que usa scripts/sync.js al pagar.
  function stakeOf(r) {
    const units = Number(r.units);
    if (units < 0) return -units;
    const pick = bkPicksById.get(r.pick_id);
    const odds = pick?.odds ? Number(pick.odds) : null;
    return odds && odds > 1 ? units / (odds - 1) : units;
  }
  const totalStake = (bankrollRows || []).reduce((sum, r) => sum + stakeOf(r), 0);
  const totalProfit = (bankrollRows || []).reduce((sum, r) => sum + Number(r.units), 0);
  const roi = totalStake > 0 ? Math.round((totalProfit / totalStake) * 1000) / 10 : 0;
  const unidades = bankrollRows && bankrollRows.length ? Number(bankrollRows[0].balance) : 0;

  const picksWithOdds = picks.filter((p) => p.odds);
  const cuotaProm = picksWithOdds.length
    ? Math.round((picksWithOdds.reduce((sum, p) => sum + p.odds, 0) / picksWithOdds.length) * 100) / 100
    : null;

  const { count: userCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true });

  return {
    props: {
      stats: { efectividad, racha, cuotaProm, roi, unidades },
      picks,
      resolvedPicks,
      tournamentGroups,
      matches,
      bankrollLog,
      bankrollSeries,
      currentDateStr,
      prevDateStr,
      nextDateStr,
      isToday: !selectedDate,
      userCount: userCount || 0
    }
  };
}

// Nivel del chat (estilo AiScore) — solo define el color/tier visual
// de la insignia; el número de nivel ya viene calculado desde la
// base de datos (migration_010, curva de raíz cuadrada por mensajes).
function levelTier(level) {
  if (level >= 10) return 'legend';
  if (level >= 6) return 'fan';
  if (level >= 3) return 'active';
  return 'new';
}

function initialsOf(name) {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function timeLabel(iso) {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

function dayLabel(iso) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const target = fmt(new Date(iso));
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 24 * 3600 * 1000));
  if (target === today) return 'hoy';
  if (target === tomorrow) return 'mañana';
  return 'otro';
}

// Frase corta y honesta armada a partir de los factores reales de
// lib/confidence.js — nada inventado, solo traduce los números.
function buildAnalysis(factors) {
  if (!factors) return 'Pick generado sin desglose disponible.';
  const pct = (x) => Math.round(Math.abs(x) * 100);
  const bits = [];
  if (factors.ratingScore) bits.push(`rating (${pct(factors.ratingScore)}%)`);
  if (factors.streakScore) bits.push(`racha reciente (${pct(factors.streakScore)}%)`);
  if (factors.h2hScore) bits.push(`cruce directo (${pct(factors.h2hScore)}%)`);
  if (bits.length === 0) return 'Pick generado sin suficiente historial todavía.';
  return `Favorito según ${bits.join(', ')}.`;
}

const TIER_LABEL = { alta: 'Alta confianza', media: 'Media confianza', baja: 'Confianza baja' };

const SIDE_TONE = { left: 'var(--court)', right: 'var(--blue)' };

function PlayerAvatar({ name, avatarUrl, initials, side = 'left', className = '' }) {
  return (
    <div className={`avatar ${className}`} style={{ '--tone': SIDE_TONE[side] }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        initials
      )}
    </div>
  );
}

function PickCard({ pick, onClick, followed, onToggleFollow, featured }) {
  // Solo los picks que vienen de /api/followed-detail traen matchStatus
  // + sourceId — para los demás (Inicio/Picks normales) esto no hace
  // nada y el centro sigue mostrando "VS" como siempre.
  const live = useLiveScore({
    status: pick.matchStatus,
    playerA: pick.player,
    playerB: pick.opponent,
    tournamentId: pick.tournamentId,
    sourceId: pick.sourceId
  });
  let liveSetsWonA = null;
  let liveSetsWonB = null;
  if (pick.matchStatus === 'live' && live) {
    if (live.source === 'kambi') {
      liveSetsWonA = (live.sets || []).filter((s) => s.a > s.b).length;
      liveSetsWonB = (live.sets || []).filter((s) => s.b > s.a).length;
    } else if (live.source === 'tt' && live.scoreOne != null) {
      liveSetsWonA = live.scoreOne;
      liveSetsWonB = live.scoreTwo;
    }
  }

  return (
    <div className={`pick-card ${featured ? 'pick-card-featured' : ''}`} onClick={onClick}>
      {onToggleFollow ? (
        <button
          className={`follow-btn ${followed ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFollow(pick);
          }}
          title={followed ? 'Dejar de seguir este pick' : 'Seguir este pick'}
        >
          {followed ? '★' : '☆'}
        </button>
      ) : null}
      <div className="pc-head">
        {featured ? (
          <span className="tier-badge tier-featured">★ Pick destacado del día</span>
        ) : (
          <span className={`tier-badge tier-${pick.tier}`}>{TIER_LABEL[pick.tier]}</span>
        )}
        <span className="pc-head-right">
          <span className="pc-meta">
            {pick.tournament} · {pick.time}
          </span>
          {pick.matchStatus === 'live' ? (
            <span className="status live">En vivo</span>
          ) : pick.matchStatus === 'done' ? (
            <span className="status done">Finalizado</span>
          ) : null}
        </span>
      </div>
      <div className="pc-vs">
        <div className="pc-player">
          <PlayerAvatar name={pick.player} avatarUrl={pick.avatarUrl} initials={pick.initials} side="left" />
          <span className="pc-player-name">{pick.player}</span>
        </div>
        {liveSetsWonA != null ? (
          <span className="pc-vs-badge pc-vs-live num">
            {liveSetsWonA}-{liveSetsWonB}
          </span>
        ) : pick.matchStatus === 'live' ? (
          <span className="pc-vs-badge pc-vs-live num">···</span>
        ) : pick.matchStatus === 'done' && pick.score ? (
          <span
            className="pc-vs-badge pc-vs-live num"
            style={{ color: pick.result === 'hit' ? 'var(--hit)' : pick.result === 'miss' ? 'var(--miss)' : 'var(--court)' }}
          >
            {pick.score}
          </span>
        ) : (
          <span className="pc-vs-badge">VS</span>
        )}
        <div className="pc-player">
          <PlayerAvatar name={pick.opponent} avatarUrl={pick.opponentAvatarUrl} initials={pick.opponentInitials} side="right" />
          <span className="pc-player-name">{pick.opponent}</span>
        </div>
      </div>
      {pick.matchStatus === 'live' && live?.source === 'kambi' && live.sets?.length > 0 ? (
        <div className="mc-live-score">
          {live.sets.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
          {live.current ? (
            <span className="mc-set mc-set-current num">
              {live.current.a}-{live.current.b}
            </span>
          ) : null}
        </div>
      ) : null}
      {pick.matchStatus === 'done' && pick.setScores && pick.setScores.length > 0 ? (
        <div className="mc-live-score mc-live-score-small">
          {pick.setScores.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
        </div>
      ) : null}
      {pick.streakLabel || pick.h2hTotal > 0 ? (
        <div className="pc-stats-row">
          {pick.h2hTotal > 0 ? (
            <div className="pc-stat">
              <span className="l">H2H</span>
              <span className="v num">{pick.h2h}</span>
            </div>
          ) : null}
          {pick.streakLabel ? (
            <div className="pc-stat">
              <span className="l">Racha</span>
              <span className="v num">{pick.streakLabel}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="pc-ia-row">
        <span className="pc-ia-label">Índice IA</span>
        <span className="pc-ia-val num">{pick.confidence}%</span>
      </div>
      <div className="ia-bar-track">
        <div className={`ia-bar-fill tier-${pick.tier}`} style={{ width: `${pick.confidence}%` }}></div>
      </div>
      <div className="pc-foot">
        <span className="odd-mini num">{pick.odds ? pick.odds.toFixed(2) : 'Cuota N/D'}</span>
        {featured ? (
          <button
            className="btn btn-ball"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            Ver análisis completo →
          </button>
        ) : pick.result && pick.result !== 'pending' ? (
          <span className={`result-pill ${pick.result}`}>{pick.result === 'hit' ? 'Acierto' : 'Fallo'}</span>
        ) : null}
      </div>
    </div>
  );
}

// Mientras el partido está en vivo, consulta el marcador real cada
// 8s (mismo endpoint que usa el modal de detalle) para mostrarlo
// directo en la tarjeta de Calendario, sin tener que abrirla.
function useLiveScore(m) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (m.status !== 'live') {
      setLive(null);
      return undefined;
    }
    let cancelled = false;

    async function poll() {
      const params = new URLSearchParams();
      if (m.playerA) params.set('playerA', m.playerA);
      if (m.playerB) params.set('playerB', m.playerB);
      if (m.tournamentId) params.set('tournamentId', m.tournamentId);
      if (m.sourceId) params.set('matchId', m.sourceId);
      try {
        const res = await fetch(`/api/live-match?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLive(data);
      } catch (e) {
        // silencioso — se queda con el último dato válido hasta el próximo intento
      }
    }

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [m.status, m.playerA, m.playerB, m.tournamentId, m.sourceId]);

  return live;
}

// Tarjeta de doble foto.
function MatchRow({ m, onClick, followed, onToggleFollow }) {
  const label = m.status === 'live' ? 'En vivo' : m.status === 'done' ? 'Finalizado' : 'Pendiente';
  const live = useLiveScore(m);

  // Mientras está en vivo, el centro de la tarjeta muestra sets
  // ganados por cada lado en vez de "VS" — se cuenta a partir de los
  // sets ya cerrados que trae el marcador en vivo.
  let liveSetsWonA = null;
  let liveSetsWonB = null;
  if (m.status === 'live' && live) {
    if (live.source === 'kambi') {
      liveSetsWonA = (live.sets || []).filter((s) => s.a > s.b).length;
      liveSetsWonB = (live.sets || []).filter((s) => s.b > s.a).length;
    } else if (live.source === 'tt' && live.scoreOne != null) {
      liveSetsWonA = live.scoreOne;
      liveSetsWonB = live.scoreTwo;
    }
  }

  return (
    <div className="match-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      {m.pickId && onToggleFollow ? (
        <button
          className={`follow-btn ${followed ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFollow({ id: m.pickId, matchId: m.matchId });
          }}
          title={followed ? 'Dejar de seguir este pick' : 'Seguir este pick'}
        >
          {followed ? '★' : '☆'}
        </button>
      ) : null}
      <div className="mc-head">
        <span className="pc-meta">
          {m.time} · {m.tournament}
        </span>
        <span className={`status ${m.status}`}>{label}</span>
      </div>
      <div className="pc-vs">
        <div className="pc-player">
          <PlayerAvatar name={m.playerA} avatarUrl={m.playerAAvatar} initials={m.playerAInitials} side="left" />
          <span className="pc-player-name">
            <span className="flag">🇨🇿</span> {m.playerA}
          </span>
        </div>
        {liveSetsWonA != null ? (
          <span className="pc-vs-badge pc-vs-live num">
            {liveSetsWonA}-{liveSetsWonB}
          </span>
        ) : m.status === 'done' && m.score ? (
          <span
            className="pc-vs-badge pc-vs-live num"
            style={{
              color: m.pickResult === 'hit' ? 'var(--hit)' : m.pickResult === 'miss' ? 'var(--miss)' : 'var(--court)'
            }}
          >
            {m.score}
          </span>
        ) : (
          <span className="pc-vs-badge">VS</span>
        )}
        <div className="pc-player">
          <PlayerAvatar name={m.playerB} avatarUrl={m.playerBAvatar} initials={m.playerBInitials} side="right" />
          <span className="pc-player-name">
            <span className="flag">🇨🇿</span> {m.playerB}
          </span>
        </div>
      </div>
      {m.status === 'done' && m.setScores && m.setScores.length > 0 ? (
        <div className="mc-live-score mc-live-score-small">
          {m.setScores.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
        </div>
      ) : null}
      {m.status === 'live' ? (
        <div className="mc-live-score">
          {live?.source === 'kambi' ? (
            <>
              {(live.sets || []).map((s, i) => (
                <span className="mc-set num" key={i}>
                  {s.a}-{s.b}
                </span>
              ))}
              {live.current ? (
                <span className="mc-set mc-set-current num">
                  {live.current.a}-{live.current.b}
                </span>
              ) : null}
            </>
          ) : live?.source === 'tt' && live.scoreOne != null ? (
            <span className="num">
              Sets: {live.scoreOne}-{live.scoreTwo}
            </span>
          ) : (
            <span className="mc-live-loading">Buscando marcador…</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Chat en vivo del partido — un cuarto por match_source_id. Cualquiera
// puede leer; escribir requiere sesión iniciada. Usa Supabase Realtime
// para que los mensajes nuevos aparezcan solos, sin refrescar.
function LiveChat({ matchSourceId, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!supabaseClient || !matchSourceId) return undefined;
    let cancelled = false;

    supabaseClient
      .from('chat_messages')
      .select('id, user_name, user_avatar, message, created_at, sender_level')
      .eq('match_source_id', matchSourceId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data);
      });

    const channel = supabaseClient
      .channel(`chat:${matchSourceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `match_source_id=eq.${matchSourceId}` },
        (payload) => setMessages((prev) => [...prev, payload.new])
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabaseClient.removeChannel(channel);
    };
  }, [matchSourceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !user || !supabaseClient) return;
    setSending(true);
    const { error } = await supabaseClient.from('chat_messages').insert({
      match_source_id: matchSourceId,
      user_id: user.id,
      user_name: user.user_metadata?.full_name || user.email,
      user_avatar: user.user_metadata?.avatar_url || null,
      message: trimmed.slice(0, 300)
    });
    setSending(false);
    if (!error) setText('');
  };

  return (
    <div className="live-chat">
      <div className="hist-title">
        <span>Chat en vivo</span>
      </div>
      <div className="live-chat-list">
        {messages.length === 0 ? (
          <p className="page-sub" style={{ margin: 0 }}>
            Nadie ha escrito todavía — sé el primero.
          </p>
        ) : (
          messages.map((msg) => (
            <div className="live-chat-msg" key={msg.id}>
              {msg.user_avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.user_avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="live-chat-avatar-fallback">{(msg.user_name || '?')[0].toUpperCase()}</span>
              )}
              <div>
                <div className="live-chat-name">
                  {msg.user_name || 'Anónimo'}
                  {msg.sender_level ? (
                    <span className={`level-badge tier-${levelTier(msg.sender_level)}`}>Nv.{msg.sender_level}</span>
                  ) : null}
                </div>
                <div className="live-chat-text">{msg.message}</div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {user ? (
        <form className="live-chat-form" onSubmit={send}>
          <input
            type="text"
            placeholder="Escribe algo..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
          />
          <button type="submit" disabled={sending || !text.trim()}>
            Enviar
          </button>
        </form>
      ) : (
        <p className="page-sub" style={{ margin: '10px 0 0' }}>
          Inicia sesión con Google (arriba a la derecha) para escribir en el chat.
        </p>
      )}
    </div>
  );
}

// Modal de detalle de un partido. Solo mientras está abierto (y solo
// si el partido sigue en vivo) consulta cada 8s el marcador real —
// primero contra Rushbet (set por set + reloj), y si no lo tiene,
// contra tt.league-pro.com directo.
function MatchDetailModal({ m, onClose, user }) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    if (m.status !== 'live') return undefined;
    let cancelled = false;

    async function poll() {
      const params = new URLSearchParams();
      if (m.playerA) params.set('playerA', m.playerA);
      if (m.playerB) params.set('playerB', m.playerB);
      if (m.tournamentId) params.set('tournamentId', m.tournamentId);
      if (m.sourceId) params.set('matchId', m.sourceId);
      try {
        const res = await fetch(`/api/live-match?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLive(data);
      } catch (e) {
        // silencioso — se queda con el último dato válido hasta el próximo intento
      }
    }

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [m.status, m.playerA, m.playerB, m.tournamentId, m.sourceId]);

  const nowFinished = live?.status === 'finished';

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="sub">
              {m.tournament} · {m.time}
            </div>
            <h3>{m.players}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {nowFinished ? (
          <div className="modal-market">Partido terminado — recarga la página para ver el resultado final.</div>
        ) : m.status === 'live' && live?.source === 'kambi' ? (
          <>
            {live.clock ? (
              <div className="live-clock">
                ⏱ {live.clock.minute}:{String(live.clock.second).padStart(2, '0')}
                {live.clock.running ? ' · corriendo' : ' · pausado'}
              </div>
            ) : null}
            <div className="live-sets-grid">
              {(live.sets || []).map((s, i) => (
                <div className="live-set-col" key={i}>
                  <div className="live-set-label">Set {i + 1}</div>
                  <div className="live-set-score">
                    {s.a}-{s.b}
                  </div>
                </div>
              ))}
              {live.current ? (
                <div className="live-set-col current">
                  <div className="live-set-label">Ahora</div>
                  <div className="live-set-score">
                    {live.current.a}-{live.current.b}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : m.status === 'live' && live?.source === 'tt' ? (
          <>
            <p className="page-sub">
              Rushbet no tiene este partido en su tablero en vivo — mostrando el marcador de tt.league-pro.com (menos
              detallado, sin punto a punto).
            </p>
            {live.scoreOne != null ? (
              <div className="modal-market">
                Sets: {live.scoreOne}-{live.scoreTwo}
              </div>
            ) : (
              <p className="page-sub">Este partido está en curso, todavía sin sets cerrados.</p>
            )}
          </>
        ) : m.status === 'live' ? (
          <p className="page-sub">Buscando marcador en vivo…</p>
        ) : m.status === 'done' && m.score ? (
          <>
            <div className="modal-market">Resultado final: {m.score}</div>
            {m.setScores && m.setScores.length > 0 ? (
              <div className="live-sets-grid">
                {m.setScores.map((s, i) => (
                  <div className="live-set-col" key={i}>
                    <div className="live-set-label">Set {i + 1}</div>
                    <div className="live-set-score">
                      {s.a}-{s.b}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="page-sub">
                No tenemos el detalle punto a punto de este partido — solo se guarda para los que alguien vio en vivo
                mientras se jugaban.
              </p>
            )}
          </>
        ) : (
          <p className="page-sub">Este partido todavía no empieza.</p>
        )}

        {m.status === 'live' && !nowFinished ? <LiveChat matchSourceId={m.sourceId} user={user} /> : null}
      </div>
    </div>
  );
}

function DonutChart({ wins, total }) {
  if (!total) return null;
  const pct = wins / total;
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <svg viewBox="0 0 100 100" className="donut">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-alt)" strokeWidth="12" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--hit)"
        strokeWidth="12"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="48" textAnchor="middle" className="donut-pct num" style={{ fill: 'var(--ink)' }}>
        {Math.round(pct * 100)}%
      </text>
      <text x="50" y="65" textAnchor="middle" className="donut-sub" style={{ fill: 'var(--muted)' }}>
        {wins}/{total}
      </text>
    </svg>
  );
}

function LineChart({ series }) {
  if (!series || series.length < 2) {
    return <p className="page-sub">Todavía no hay suficiente historial para graficar.</p>;
  }
  const w = 100;
  const h = 40;
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const range = max - min || 1;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg className="line-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 2" />
      <polyline points={points} fill="none" stroke="var(--court)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Tabla de grupo de un torneo — todos contra todos, igual a como la
// muestra tt.league-pro.com dentro de cada torneo: una fila por
// jugador, una columna por cada rival con el marcador de sets de ese
// cruce, y el total de sets + puesto a la derecha.
function GroupTable({ group }) {
  return (
    <div className="standings-card">
      <div className="standings-head">{group.name}</div>
      <div className="group-table-wrap">
        <table className="group-table">
          <thead>
            <tr>
              <th></th>
              <th>Jugador</th>
              <th>Rating</th>
              {group.players.map((p) => (
                <th key={p.id} className="num">
                  {p.name.split(' ')[0]}
                </th>
              ))}
              <th>Sets</th>
              <th>Bolas</th>
              <th>Puntos</th>
              <th>Puesto</th>
            </tr>
          </thead>
          <tbody>
            {group.players.map((row) => (
              <tr key={row.id}>
                <td>
                  <PlayerAvatar name={row.name} avatarUrl={row.avatarUrl} initials={row.initials} className="standings-avatar" />
                </td>
                <td className="group-player-name">{row.name}</td>
                <td className="num">{row.rating ?? '—'}</td>
                {group.players.map((col) =>
                  col.id === row.id ? (
                    <td key={col.id} className="num group-self">
                      ·
                    </td>
                  ) : (
                    <td key={col.id} className="num">
                      {group.matchup[row.id]?.[col.id] || '—'}
                    </td>
                  )
                )}
                <td className="num">
                  {row.setsFor}-{row.setsAgainst}
                </td>
                <td className="num">{row.ballsFor != null ? `${row.ballsFor}-${row.ballsAgainst}` : '—'}</td>
                <td className="num">{row.points}</td>
                <td className="num">{row.place}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Home({
  stats: initialStats,
  picks: initialPicks,
  resolvedPicks: initialResolvedPicks,
  tournamentGroups: initialTournamentGroups,
  matches: initialMatches,
  bankrollLog,
  bankrollSeries,
  currentDateStr,
  userCount
}) {
  const [view, setView] = useState('inicio');
  const [pickTab, setPickTab] = useState('todos');
  const [stats, setStats] = useState(initialStats);
  const [picks, setPicks] = useState(initialPicks);
  const [resolvedPicks, setResolvedPicks] = useState(initialResolvedPicks);
  const [tournamentGroups, setTournamentGroups] = useState(initialTournamentGroups);
  const [matches, setMatches] = useState(initialMatches);
  const [matchFilter, setMatchFilter] = useState(initialMatches.some((m) => m.status === 'live') ? 'vivo' : 'todos');
  const [modalPick, setModalPick] = useState(null);
  const [modalMatch, setModalMatch] = useState(null);
  const [user, setUser] = useState(null);
  const [followedPickIds, setFollowedPickIds] = useState(new Set());
  const [followedDetail, setFollowedDetail] = useState([]);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      setView(VIEWS.includes(h) ? h : 'inicio');
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // Calendario no se actualizaba solo — había que recargar la página
  // para que un partido pasara de "Próximo" a "En vivo". Mientras esa
  // vista esté abierta, se vuelve a consultar el estado del día cada
  // 20s (estilo Sofascore/Flashscore), sin recargar nada más.
  useEffect(() => {
    if (view !== 'calendario') return undefined;
    let cancelled = false;

    async function load() {
      try {
        const params = currentDateStr ? `?date=${currentDateStr}` : '';
        const r = await fetch(`/api/matches-status${params}`);
        const data = await r.json();
        if (!cancelled && data.matches) setMatches(data.matches);
      } catch (e) {
        console.error('Error actualizando Calendario:', e);
      }
    }

    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, currentDateStr]);

  // Mismo problema en Inicio (pick destacado + tablas de torneos en
  // vivo) y Picks (pendientes/ganados/perdidos): sin esto, un pick que
  // arranca, se resuelve, o un torneo que empieza/termina, se quedaba
  // congelado hasta refrescar. Se repite cada 20s mientras cualquiera
  // de esas dos vistas esté abierta.
  useEffect(() => {
    if (view !== 'inicio' && view !== 'picks') return undefined;
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch('/api/refresh-data');
        const data = await r.json();
        if (cancelled) return;
        if (data.stats) setStats(data.stats);
        if (data.picks) setPicks(data.picks);
        if (data.resolvedPicks) setResolvedPicks(data.resolvedPicks);
        if (data.tournamentGroups) setTournamentGroups(data.tournamentGroups);
      } catch (e) {
        console.error('Error actualizando Inicio/Picks:', e);
      }
    }

    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view]);

  useEffect(() => {
    if (!supabaseClient) return undefined;
    supabaseClient.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loginWithGoogle = () => {
    if (!supabaseClient) return;
    supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };
  const logout = () => supabaseClient?.auth.signOut();

  useEffect(() => {
    if (!supabaseClient || !user) {
      setFollowedPickIds(new Set());
      return undefined;
    }
    let cancelled = false;
    supabaseClient
      .from('followed_picks')
      .select('pick_id')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) console.error('Error cargando seguidos:', error);
        if (!cancelled && data) setFollowedPickIds(new Set(data.map((r) => r.pick_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Detalle completo de los picks seguidos — aparte del array "picks"
  // de la SSR, que oculta un pick apenas el partido está por arrancar
  // o ya arrancó (regla pensada para "Picks", no para lo que alguien
  // sigue a propósito para recibir la notificación). Se repite cada
  // 15s mientras haya algo seguido, para que el estado (soon → live →
  // done) se refleje solo, sin tener que recargar la página.
  useEffect(() => {
    if (followedPickIds.size === 0) {
      setFollowedDetail([]);
      return undefined;
    }
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch(`/api/followed-detail?ids=${[...followedPickIds].join(',')}`);
        const data = await r.json();
        if (!cancelled) setFollowedDetail(data.picks || []);
      } catch (e) {
        console.error('Error cargando detalle de seguidos:', e);
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [followedPickIds]);

  const toggleFollow = async (pick) => {
    if (!supabaseClient) return;
    if (!user) {
      loginWithGoogle();
      return;
    }
    const already = followedPickIds.has(pick.id);
    if (already) {
      const { error } = await supabaseClient.from('followed_picks').delete().eq('user_id', user.id).eq('pick_id', pick.id);
      if (error) {
        console.error('Error dejando de seguir:', error);
        alert('No se pudo dejar de seguir: ' + error.message);
        return;
      }
      setFollowedPickIds((prev) => {
        const next = new Set(prev);
        next.delete(pick.id);
        return next;
      });
    } else {
      const { error } = await supabaseClient
        .from('followed_picks')
        .insert({ user_id: user.id, pick_id: pick.id, match_id: pick.matchId });
      if (error) {
        console.error('Error siguiendo pick:', error);
        alert('No se pudo seguir el pick: ' + error.message);
        return;
      }
      setFollowedPickIds((prev) => new Set(prev).add(pick.id));
      ensurePushSubscription(user);
    }
  };

  const isAdmin = Boolean(user?.email && user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL);
  const featured = picks.find((p) => p.featured) || picks[0] || null;

  const tabPicks =
    pickTab === 'pendientes'
      ? picks
      : pickTab === 'ganados'
      ? resolvedPicks.filter((p) => p.result === 'hit')
      : pickTab === 'perdidos'
      ? resolvedPicks.filter((p) => p.result === 'miss')
      : [...picks, ...resolvedPicks];

  // Tira de 7 días (hoy + los próximos 6) para navegar Calendario —
  // son links reales a "/?date=YYYY-MM-DD#calendario" (no hash-routing
  // puro), así que getServerSideProps trae ese día completo al hacer
  // click, igual que ya soporta ?date= desde antes.
  const dayStrip = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
    const weekday = i === 0 ? 'Hoy' : new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'America/Bogota' }).format(d);
    const dayNum = new Intl.DateTimeFormat('es-CO', { day: '2-digit', timeZone: 'America/Bogota' }).format(d);
    return { dateStr, weekday: weekday.replace('.', ''), dayNum };
  });

  const liveCount = matches.filter((m) => m.status === 'live').length;
  const filteredMatches =
    matchFilter === 'vivo'
      ? matches.filter((m) => m.status === 'live')
      : matchFilter === 'finalizados'
      ? matches.filter((m) => m.status === 'done')
      : matchFilter === 'proximos'
      ? matches.filter((m) => m.status === 'soon')
      : matches;

  const greetingName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || null;
  const todayLabel = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'America/Bogota'
  }).format(new Date());

  const navLink = (v, label) => (
    <a href={`#${v}`} data-view={v} className={view === v ? 'active' : ''}>
      {label}
    </a>
  );

  return (
    <>
      <Head>
        <title>CAMILOREY · Picks Liga Pro Checa de tenis de mesa</title>
        <meta name="description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/svg+xml" href="/icon-master.svg" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0E0D0C" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{CSS}</style>
      </Head>

      <header className="site">
        <a href="#inicio" className="logo">
          CAMILOREY
          <span className="dot"></span>
        </a>
        <nav className="top-nav">
          {navLink('inicio', 'Inicio')}
          {navLink('calendario', 'Calendario')}
          {navLink('picks', 'Picks')}
          {navLink('seguidos', 'Seguidos')}
          {isAdmin ? navLink('bankroll', 'Bankroll') : null}
          {isAdmin ? navLink('grupos', 'Grupos') : null}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span className="badge18">+18 · Juega con cabeza</span>
          {user ? (
            <button
              className="bell-btn"
              onClick={async () => {
                const result = await ensurePushSubscription(user);
                if (result === 'ok') alert('Notificaciones activadas ✅ — te avisaremos cuando termine un set o un partido que sigas.');
                else if (result === 'denied')
                  alert(
                    'Tienes las notificaciones bloqueadas para este sitio. Actívalas desde la configuración/permisos del navegador para este dominio y vuelve a intentar.'
                  );
                else if (result === 'unsupported') alert('Tu navegador no soporta notificaciones push.');
                else alert('No se pudo activar las notificaciones, intenta de nuevo.');
              }}
              title="Activar notificaciones push"
            >
              🔔
            </button>
          ) : null}
          {!supabaseClient ? null : user ? (
            <div className="user-chip" onClick={logout} title="Cerrar sesión">
              {user.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="user-chip-fallback">{(user.email || '?')[0].toUpperCase()}</span>
              )}
            </div>
          ) : (
            <button className="login-btn" onClick={loginWithGoogle}>
              <svg viewBox="0 0 48 48" width="14" height="14">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.9 27 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C40.9 36.6 44 30.8 44 24c0-1.3-.1-2.7-.4-3.5z"
                />
              </svg>
              Entrar
            </button>
          )}
        </div>
      </header>
      {userCount > 0 && isAdmin && (
        <div className="user-count-strip">
          {userCount} {userCount === 1 ? 'persona registrada' : 'personas registradas'} (solo tú ves esto)
        </div>
      )}

      <main>
        <section className={`view ${view === 'inicio' ? 'active' : ''}`}>
          {greetingName ? (
            <div className="greeting">
              <div className="greeting-hi">Hola, {greetingName} 👋</div>
              <div className="greeting-date">{todayLabel}</div>
            </div>
          ) : (
            <>
              <span className="eyebrow">Liga Pro Checa · Tenis de mesa</span>
              <h1 className="page-title">Picks del día</h1>
            </>
          )}
          <p className="page-sub">Análisis propio sobre partidos de la Liga Pro Checa, contrastado con nuestro propio historial.</p>

          <a href="https://t.me/+q_JbStqxCsFhYWE8" target="_blank" rel="noopener noreferrer" className="tg-banner">
            <div className="tg-banner-text">
              <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
                <path d="M21.9 2.6c-.3-.2-.7-.3-1.1-.1L2.4 9.9c-.5.2-.8.6-.8 1.1 0 .5.4.9.9 1l4.9 1.5 1.9 6c.1.4.5.7.9.7.3 0 .5-.1.7-.3l2.7-2.6 4.8 3.5c.2.2.5.2.7.2.2 0 .4 0 .5-.1.4-.2.6-.5.7-.9l3.2-15.5c.1-.4-.1-.8-.5-1z" />
              </svg>
              <div>
                <div className="tg-banner-title">Únete al canal de Telegram</div>
                <div className="tg-banner-sub">Picks, avisos y novedades en tiempo real</div>
              </div>
            </div>
            <span className="tg-banner-cta">Entrar →</span>
          </a>

          <div className="stat-strip stat-strip-4">
            <div className="stat-card">
              <div className="label">Efectividad</div>
              <div className="value hit num">{stats.efectividad}%</div>
            </div>
            <div className="stat-card">
              <div className="label">Racha actual</div>
              <div className="value num">
                {stats.racha === 0 ? '—' : `${Math.abs(stats.racha)}${stats.racha > 0 ? 'W' : 'L'}`}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">ROI</div>
              <div className={`value num ${stats.roi >= 0 ? 'hit' : 'miss'}`}>
                {stats.roi >= 0 ? '+' : ''}
                {stats.roi}%
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Unidades</div>
              <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>
                {stats.unidades >= 0 ? '+' : ''}
                {stats.unidades.toFixed(1)}U
              </div>
            </div>
          </div>

          {featured ? (
            <>
              <div className="section-head">
                <h2>Pick destacado del día</h2>
              </div>
              <PickCard
                pick={featured}
                onClick={() => setModalPick(featured)}
                followed={followedPickIds.has(featured.id)}
                onToggleFollow={toggleFollow}
                featured
              />
            </>
          ) : (
            <p className="page-sub">No hay picks activos en este momento.</p>
          )}

          <div className="section-head">
            <a href="#picks" className="see-all">
              Ver todos los picks →
            </a>
          </div>
        </section>

        <section className={`view ${view === 'picks' ? 'active' : ''}`}>
          <span className="eyebrow">Todos los picks</span>
          <h1 className="page-title">Picks</h1>
          <p className="page-sub">{tabPicks.length} picks en esta categoría</p>
          <div className="tabs">
            {[
              ['todos', 'Todos'],
              ['pendientes', 'Pendientes'],
              ['ganados', 'Ganados'],
              ['perdidos', 'Perdidos']
            ].map(([key, label]) => (
              <div key={key} className={`tab ${pickTab === key ? 'active' : ''}`} onClick={() => setPickTab(key)}>
                {label}
              </div>
            ))}
          </div>
          <div className="pick-grid">
            {tabPicks.length === 0 ? (
              <p className="page-sub">No hay picks en esta categoría todavía.</p>
            ) : (
              tabPicks.map((p) => (
                <PickCard
                  key={p.id}
                  pick={p}
                  onClick={() => setModalPick(p)}
                  followed={followedPickIds.has(p.id)}
                  onToggleFollow={p.result === 'pending' ? toggleFollow : undefined}
                />
              ))
            )}
          </div>
        </section>

        <section className={`view ${view === 'calendario' ? 'active' : ''}`}>
          <span className="eyebrow">Liga Pro Checa</span>
          <h1 className="page-title">Calendario</h1>
          <p className="page-sub">Toca un partido en vivo para ver el marcador set por set en tiempo real.</p>
          <div className="day-strip">
            {dayStrip.map((d) => (
              <a
                key={d.dateStr}
                href={`/?date=${d.dateStr}#calendario`}
                className={`day-chip ${currentDateStr === d.dateStr ? 'active' : ''}`}
              >
                <span className="day-chip-weekday">{d.weekday}</span>
                <span className="day-chip-num num">{d.dayNum}</span>
              </a>
            ))}
          </div>
          <div className="match-filter-row">
            <div
              className={`match-filter-btn live ${matchFilter === 'vivo' ? 'active' : ''}`}
              onClick={() => setMatchFilter('vivo')}
            >
              <span className="live-dot"></span> EN VIVO{liveCount > 0 ? ` (${liveCount})` : ''}
            </div>
            <div className={`match-filter-btn ${matchFilter === 'proximos' ? 'active' : ''}`} onClick={() => setMatchFilter('proximos')}>
              PRÓXIMOS
            </div>
            <div
              className={`match-filter-btn ${matchFilter === 'finalizados' ? 'active' : ''}`}
              onClick={() => setMatchFilter('finalizados')}
            >
              FINALIZADOS
            </div>
            <div className={`match-filter-btn ${matchFilter === 'todos' ? 'active' : ''}`} onClick={() => setMatchFilter('todos')}>
              TODOS
            </div>
          </div>
          <div className="section-head">
            <h2>Partidos {currentDateStr === dayStrip[0].dateStr ? 'de hoy' : ''}</h2>
          </div>
          <div>
            {filteredMatches.length === 0 ? (
              <p className="page-sub">No hay partidos en esta categoría para este día.</p>
            ) : (
              filteredMatches.map((m, i) => (
                <MatchRow
                  m={m}
                  key={i}
                  onClick={() => setModalMatch(m)}
                  followed={m.pickId ? followedPickIds.has(m.pickId) : false}
                  onToggleFollow={toggleFollow}
                />
              ))
            )}
          </div>
        </section>

        {isAdmin && (
        <section className={`view ${view === 'bankroll' ? 'active' : ''}`}>
          <span className="eyebrow">Gestión de unidades</span>
          <h1 className="page-title">Bankroll</h1>
          <p className="page-sub">Seguimiento en unidades (u), no en dinero real, para medir el rendimiento de forma responsable.</p>

          <div className="balance-hero">
            <div className="balance-hero-label">Balance actual</div>
            <div className={`balance-hero-value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>
              {stats.unidades >= 0 ? '+' : ''}
              {stats.unidades.toFixed(2)}U
            </div>
          </div>

          <div className="stat-strip stat-strip-3">
            <div className="stat-card">
              <div className="label">ROI</div>
              <div className={`value num ${stats.roi >= 0 ? 'hit' : 'miss'}`}>
                {stats.roi >= 0 ? '+' : ''}
                {stats.roi}%
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Efectividad</div>
              <div className="value hit num">{stats.efectividad}%</div>
            </div>
            <div className="stat-card">
              <div className="label">Unidades</div>
              <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>
                {stats.unidades >= 0 ? '+' : ''}
                {stats.unidades.toFixed(1)}U
              </div>
            </div>
          </div>

          <div className="bankroll-card">
            <strong>Evolución</strong>
            <LineChart series={bankrollSeries} />
          </div>

          <div className="bankroll-card">
            <strong>¿Cómo se mide?</strong>
            <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6' }}>
              Cada pick arriesga entre 0.5u y 2u según la confianza del modelo (ver lib/staking.js). El pago sí usa
              la cuota real de Rushbet cuando logramos cruzar el partido en su feed; si no la encontramos, se calcula
              1:1. Ajusta siempre el tamaño de tus apuestas a lo que puedas permitirte perder.
            </p>
          </div>

          <div className="bankroll-card">
            <table className="bk">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Pick</th>
                  <th>Unidades</th>
                  <th>Resultado</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {bankrollLog.map((r, i) => (
                  <tr key={i}>
                    <td>{r.fecha}</td>
                    <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.pick}</td>
                    <td className={r.ok ? 'hit' : 'miss'}>{r.u}</td>
                    <td className={r.ok ? 'hit' : 'miss'}>{r.ok ? 'Acierto' : 'Fallo'}</td>
                    <td>{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'grupos' ? 'active' : ''}`}>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Grupos</h1>
          <p className="page-sub">Tablas de los torneos que están en vivo ahora mismo.</p>
          {tournamentGroups.length === 0 ? (
            <p className="page-sub">No hay ningún torneo en vivo en este momento.</p>
          ) : (
            tournamentGroups.map((g) => <GroupTable group={g} key={g.tournamentId} />)
          )}
        </section>
        )}

        <section className={`view ${view === 'seguidos' ? 'active' : ''}`}>
          <span className="eyebrow">Tus picks seguidos</span>
          <h1 className="page-title">Seguidos</h1>
          <p className="page-sub">
            Sigue un pick tocando la estrella y te avisamos con una notificación cuando termine un set o el partido.
          </p>
          {!user ? (
            <p className="page-sub">Inicia sesión con Google (arriba a la derecha) para seguir picks.</p>
          ) : (
            (() => {
              if (followedDetail.length === 0) {
                return <p className="page-sub">Todavía no sigues ningún pick — toca la ☆ en cualquier tarjeta.</p>;
              }
              return (
                <div className="pick-grid">
                  {followedDetail.map((p) => (
                    <PickCard
                      key={p.id}
                      pick={p}
                      onClick={() => setModalPick(p)}
                      followed={true}
                      onToggleFollow={toggleFollow}
                    />
                  ))}
                </div>
              );
            })()
          )}
        </section>
      </main>

      <footer className="site">
        <strong>CAMILOREY</strong> ofrece análisis y opiniones propias con fines informativos y de entretenimiento
        sobre la Liga Pro Checa de tenis de mesa. No garantizamos resultados y no gestionamos apuestas ni fondos de
        terceros. Servicio dirigido exclusivamente a mayores de 18 años. Si sientes que el juego deja de ser un
        entretenimiento, busca ayuda profesional. Juega siempre con responsabilidad.
      </footer>

      <nav className="bottom-nav">
        <a href="#inicio" className={view === 'inicio' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
          </svg>
          Inicio
        </a>
        <a href="#calendario" className={view === 'calendario' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          Calendario
        </a>
        <a href="#picks" className={view === 'picks' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v18M3 12h18" />
          </svg>
          Picks
        </a>
        <a href="#seguidos" className={view === 'seguidos' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 17.3l-6.2 3.6 1.6-7-5.3-4.6 7-.6L12 2l2.9 6.7 7 .6-5.3 4.6 1.6 7z" />
          </svg>
          Seguidos
        </a>
        {isAdmin ? (
          <a href="#bankroll" className={view === 'bankroll' ? 'active' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <path d="M3 10h18M15 14h3" />
            </svg>
            Bankroll
          </a>
        ) : null}
        {isAdmin ? (
          <a href="#grupos" className={view === 'grupos' ? 'active' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Grupos
          </a>
        ) : null}
      </nav>

      {modalPick && (
        <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && setModalPick(null)}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {modalPick.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="featured-avatar" src={modalPick.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : null}
                <div>
                  <div className="sub">
                    {modalPick.tournament} · {modalPick.time}
                  </div>
                  <h3>
                    <span className="flag">🇨🇿</span> {modalPick.player}
                  </h3>
                  <div className="sub">vs {modalPick.opponent}</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setModalPick(null)}>
                ✕
              </button>
            </div>
            <div className="modal-market">{modalPick.market}</div>

            <div className="kpis">
              <div className="kpi">
                <div className="l">Índice IA</div>
                <div className="v num">{modalPick.confidence}%</div>
              </div>
              <div className="kpi">
                <div className="l">Cuota (Rushbet)</div>
                <div className="v num">{modalPick.odds ? modalPick.odds.toFixed(2) : 'No disponible'}</div>
              </div>
            </div>

            {modalPick.history.length > 0 ? (
              <>
                <div className="hist-title">
                  <span>Últimos {modalPick.history.length} partidos</span>
                </div>
                <div className="donut-row">
                  <DonutChart wins={modalPick.history.filter((v) => v === 1).length} total={modalPick.history.length} />
                  <div className="chart">
                    {modalPick.history.map((v, i) => (
                      <div key={i} className={`bar ${v === 1 ? 'hit' : 'miss'}`} style={{ height: '60px' }}></div>
                    ))}
                  </div>
                </div>
                <div className="legend">
                  <span>
                    <i className="sw" style={{ background: 'var(--hit)' }}></i>Victoria
                  </span>
                  <span>
                    <i className="sw" style={{ background: 'var(--miss)' }}></i>Derrota
                  </span>
                </div>
              </>
            ) : (
              <p className="page-sub">Sin historial reciente todavía.</p>
            )}

            {modalPick.h2hTotal > 0 ? (
              <>
                <div className="hist-title">
                  <span>H2H contra {modalPick.opponent}</span>
                  <span className="num">{modalPick.h2h}</span>
                </div>
                <div className="h2h-bar-track">
                  <div
                    className="h2h-bar-fill"
                    style={{ width: `${(Number(modalPick.h2h.split('-')[0]) / modalPick.h2hTotal) * 100}%` }}
                  ></div>
                </div>
              </>
            ) : null}

            <div className="analysis">{modalPick.analysis}</div>
          </div>
        </div>
      )}

      {modalMatch && <MatchDetailModal m={modalMatch} onClose={() => setModalMatch(null)} user={user} />}
    </>
  );
}

const CSS = `
  :root{
    --bg:#0E0D0C;
    --bg-alt:#171513;
    --card:#1B1917;
    --ink:#F5F1EC;
    --muted:#948C83;
    --line:#2B2724;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#2E1817;
    --ball:#FF7A45;
    --ball-dark:#D85A30;
    --hit:#5DCAA5;
    --miss:#F09595;
    --blue:#3B82C4;
    --blue-dark:#245A8C;
    --font-display:'Big Shoulders Display', sans-serif;
    --font-body:'Manrope', sans-serif;
    --font-mono:'IBM Plex Mono', monospace;
    --radius:16px;
    --shadow:0 2px 12px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3);
  }
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:var(--font-body);
    -webkit-font-smoothing:antialiased;
    padding-bottom:76px;
  }
  a{color:inherit;}
  .num{font-family:var(--font-mono); font-variant-numeric:tabular-nums;}

  header.site{
    position:sticky; top:0; z-index:40;
    background:rgba(14,13,12,0.88);
    backdrop-filter:blur(10px);
    border-bottom:1px solid var(--line);
    padding:14px 20px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .logo{
    font-family:var(--font-display);
    font-weight:800;
    font-size:22px;
    letter-spacing:0.5px;
    text-decoration:none;
    color:var(--ink);
    display:flex; align-items:center; gap:6px;
  }
  .logo .dot{
    width:9px; height:9px; border-radius:50%;
    background:var(--court);
    display:inline-block;
    animation: pulse-dot 1.8s ease-in-out infinite;
  }
  @keyframes pulse-dot{
    0%, 100%{transform:scale(1); box-shadow:0 0 0 3px var(--court-soft), 0 0 6px rgba(226,68,74,.6);}
    50%{transform:scale(1.25); box-shadow:0 0 0 5px rgba(226,68,74,.15), 0 0 10px rgba(226,68,74,.9);}
  }
  nav.top-nav{display:flex; gap:6px;}
  nav.top-nav a{
    font-size:14px; font-weight:600;
    padding:8px 14px; border-radius:999px;
    text-decoration:none; color:var(--muted);
    transition:background .15s, color .15s;
  }
  nav.top-nav a.active, nav.top-nav a:hover{background:var(--court); color:#fff;}
  .badge18{
    font-family:var(--font-mono); font-size:11px; font-weight:600;
    color:#FAC7C7; background:var(--court-soft);
    border-radius:999px; padding:4px 9px; margin-left:8px;
  }
  .login-btn{
    display:inline-flex; align-items:center; gap:6px;
    font-family:var(--font-body); font-size:12px; font-weight:700; color:var(--ink);
    background:var(--card); border:1px solid var(--line); border-radius:999px;
    padding:6px 12px; cursor:pointer;
  }
  .login-btn:hover{border-color:var(--court);}
  .user-chip{
    width:28px; height:28px; border-radius:50%; overflow:hidden; cursor:pointer;
    border:1px solid var(--line); flex:none;
  }
  .user-chip img{width:100%; height:100%; object-fit:cover;}
  .user-chip-fallback{
    width:100%; height:100%; display:flex; align-items:center; justify-content:center;
    background:var(--court); color:#fff; font-weight:800; font-size:13px;
  }
  .user-count-strip{
    text-align:center; font-family:var(--font-mono); font-size:11px; color:var(--muted);
    padding:6px; border-bottom:1px solid var(--line);
  }

  .tg-banner{
    display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;
    background:linear-gradient(135deg, #26A5E4, #1B87BF);
    border-radius:16px; padding:16px 20px; margin:16px 0 22px;
    text-decoration:none; color:#fff;
    box-shadow:0 8px 20px rgba(38,165,228,.3);
  }
  .tg-banner-text{display:flex; align-items:center; gap:12px;}
  .tg-banner-text svg{flex:none;}
  .tg-banner-title{font-weight:800; font-size:15px;}
  .tg-banner-sub{font-size:12.5px; opacity:.9;}
  .tg-banner-cta{
    font-size:13px; font-weight:700; background:rgba(255,255,255,.2);
    border-radius:999px; padding:8px 16px; flex:none; white-space:nowrap;
  }

  main{max-width:980px; margin:0 auto; padding:24px 20px 60px;}
  .view{display:none;}
  .view.active{display:block; animation:fade .35s ease;}
  @keyframes fade{from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:none;}}

  h1.page-title{
    font-family:var(--font-display); font-weight:800;
    font-size:38px; line-height:1; letter-spacing:.3px;
    margin:4px 0 4px;
  }
  .page-sub{color:var(--muted); font-size:14px; margin-bottom:22px;}
  .eyebrow{
    font-family:var(--font-mono); font-size:11px; letter-spacing:1.5px;
    text-transform:uppercase; color:var(--court); font-weight:600;
  }

  .stat-strip{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0 26px;}
  .stat-strip-4{grid-template-columns:repeat(4,1fr);}
  .stat-strip-3{grid-template-columns:repeat(3,1fr);}
  .stat-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow);
  }
  .stat-card .label{font-size:12px; color:var(--muted); margin-bottom:4px;}
  .stat-card .value{font-family:var(--font-mono); font-size:20px; font-weight:600;}
  .stat-card .value.hit{color:var(--hit);}
  .stat-card .value.miss{color:var(--miss);}

  .standings-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow); margin-bottom:14px;
  }
  .standings-head{
    font-family:var(--font-mono); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    color:var(--court); padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid var(--line);
  }
  .standings-avatar{width:28px; height:28px; font-size:10px;}
  .group-table-wrap{overflow-x:auto;}
  table.group-table{width:100%; border-collapse:collapse; font-size:12.5px; white-space:nowrap;}
  table.group-table th{
    text-align:center; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:var(--muted);
    padding:6px 8px; border-bottom:1px solid var(--line); font-weight:700;
  }
  table.group-table td{padding:7px 8px; border-bottom:1px solid var(--line); text-align:center;}
  table.group-table tr:last-child td{border-bottom:none;}
  .group-player-name{text-align:left !important; font-weight:600; font-size:13px;}
  .group-self{color:var(--muted);}

  .greeting-hi{font-family:var(--font-display); font-weight:800; font-size:28px; line-height:1.1;}
  .greeting-date{color:var(--muted); font-size:13px; text-transform:capitalize; margin-top:2px;}
  .bell-btn{
    background:var(--card); border:1px solid var(--line); border-radius:50%;
    width:32px; height:32px; cursor:pointer; font-size:14px;
    display:flex; align-items:center; justify-content:center;
  }
  .bell-btn:hover{border-color:var(--court);}
  .featured-avatar{
    width:64px; height:64px; border-radius:14px; flex:none; object-fit:cover;
    border:2px solid rgba(255,255,255,.18); box-shadow:0 4px 14px rgba(0,0,0,.4);
  }
  .btn{
    font-family:var(--font-body); font-weight:700; font-size:14px;
    border:none; border-radius:999px; padding:10px 18px; cursor:pointer;
    display:inline-flex; align-items:center; gap:6px;
    transition:transform .12s ease;
  }
  .btn:hover{transform:translateY(-1px);}
  .btn-ball{background:var(--court); color:#fff;}
  .btn-ghost{background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.25);}

  .section-head{display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 14px;}
  .section-head h2{font-family:var(--font-display); font-size:22px; font-weight:700; margin:0;}
  .see-all{font-size:13px; font-weight:700; color:var(--court); text-decoration:none;}

  .pick-grid{display:grid; gap:12px;}
  .pick-card, .match-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:16px; box-shadow:var(--shadow); cursor:pointer; position:relative;
    transition:border-color .15s, transform .12s;
  }
  .pick-card:hover, .match-card:hover{border-color:var(--court); transform:translateY(-1px);}
  .pick-card-featured{border-color:var(--court); box-shadow:0 8px 22px rgba(226,68,74,.18);}
  .follow-btn{
    position:absolute; top:12px; right:12px; z-index:2;
    background:none; border:none; cursor:pointer; padding:4px;
    font-size:20px; line-height:1; color:var(--muted);
    transition:color .15s, transform .12s;
  }
  .follow-btn:hover{transform:scale(1.15);}
  .follow-btn.active{color:var(--ball);}

  .pc-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding-right:24px;}
  .pc-head-right{display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;}
  .pc-meta{font-size:11px; color:var(--muted); font-family:var(--font-mono);}
  .tier-badge{
    font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.3px;
    padding:4px 9px; border-radius:999px; white-space:nowrap;
  }
  .tier-badge.tier-alta{background:rgba(93,202,165,.16); color:var(--hit);}
  .tier-badge.tier-media{background:rgba(255,193,7,.16); color:#FFC845;}
  .tier-badge.tier-baja{background:var(--bg-alt); color:var(--muted);}
  .tier-badge.tier-featured{background:rgba(255,122,69,.18); color:var(--ball);}

  .pc-vs{display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:12px;}
  .pc-player{display:flex; flex-direction:column; align-items:center; gap:6px; flex:1; min-width:0;}
  .pc-player-name{font-size:12.5px; font-weight:700; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;}
  .pc-vs-badge{
    font-family:var(--font-display); font-weight:800; font-size:13px; color:var(--muted);
    flex:none;
  }
  .pc-vs-live{
    color:var(--court); font-size:17px; background:var(--court-soft); border-radius:8px; padding:3px 10px;
  }
  .avatar{
    width:56px; height:56px; border-radius:50%; flex:none;
    display:flex; align-items:center; justify-content:center;
    font-family:var(--font-display); font-weight:800; font-size:16px; color:#fff;
    position:relative; overflow:hidden;
    background:linear-gradient(150deg, var(--tone,var(--court)), #14100F 130%);
    border:2px solid rgba(255,255,255,.1);
  }
  .avatar img{width:100%; height:100%; object-fit:cover; display:block;}
  .avatar::after{
    content:""; position:absolute; inset:0; border-radius:50%;
    background:linear-gradient(155deg, rgba(255,255,255,.16), transparent 55%);
    pointer-events:none;
  }

  .pc-stats-row{display:flex; gap:18px; justify-content:center; margin-bottom:12px; padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line);}
  .pc-stat{display:flex; flex-direction:column; align-items:center; gap:2px;}
  .pc-stat .l{font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px;}
  .pc-stat .v{font-size:13px; font-weight:700;}

  .pc-ia-row{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px;}
  .pc-ia-label{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px;}
  .pc-ia-val{font-size:15px; font-weight:800;}
  .ia-bar-track{height:6px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin-bottom:14px;}
  .ia-bar-fill{height:100%; border-radius:999px;}
  .ia-bar-fill.tier-alta{background:var(--hit);}
  .ia-bar-fill.tier-media{background:#FFC845;}
  .ia-bar-fill.tier-baja{background:var(--muted);}

  .pc-foot{display:flex; align-items:center; justify-content:space-between; gap:10px;}
  .odd-mini{font-family:var(--font-mono); font-size:13px; color:var(--muted); font-weight:600;}
  .result-pill{font-size:11px; font-weight:800; padding:4px 10px; border-radius:999px;}
  .result-pill.hit{background:rgba(93,202,165,.16); color:var(--hit);}
  .result-pill.miss{background:rgba(240,149,149,.16); color:var(--miss);}
  .flag{font-size:11px;}

  .mc-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding-right:24px;}
  .mc-score{text-align:center; font-size:13px; font-weight:700; margin-top:2px;}

  .day-strip{display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:18px;}
  .day-chip{
    flex:none; display:flex; flex-direction:column; align-items:center; gap:4px;
    background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:10px 14px; text-decoration:none; color:var(--muted); min-width:52px;
  }
  .day-chip.active{background:var(--court); border-color:var(--court); color:#fff;}
  .day-chip-weekday{font-size:10.5px; font-weight:700; text-transform:uppercase;}
  .day-chip-num{font-size:15px; font-weight:800;}

  .match-filter-row{display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;}
  .match-filter-btn{
    font-family:var(--font-mono); font-size:11px; font-weight:700; letter-spacing:.4px;
    padding:8px 14px; border-radius:999px; border:1px solid var(--line); background:var(--card);
    color:var(--muted); cursor:pointer; display:flex; align-items:center; gap:6px;
  }
  .match-filter-btn.active{background:var(--court); border-color:var(--court); color:#fff;}
  .match-filter-btn.live .live-dot{
    width:7px; height:7px; border-radius:50%; background:var(--court);
    animation:pulse-dot 1.8s ease-in-out infinite;
  }
  .match-filter-btn.live.active .live-dot{background:#fff; box-shadow:none;}

  .balance-hero{
    background:linear-gradient(135deg, var(--court), var(--court-dark));
    border-radius:20px; padding:20px 22px; margin:16px 0; color:#fff;
    box-shadow:0 10px 24px rgba(226,68,74,.3);
  }
  .balance-hero-label{font-size:12px; opacity:.85; margin-bottom:4px;}
  .balance-hero-value{font-family:var(--font-display); font-weight:800; font-size:32px;}
  .balance-hero-value.hit, .balance-hero-value.miss{color:#fff;}

  .donut-row{display:flex; align-items:center; gap:18px; margin-bottom:6px;}
  .donut{width:96px; height:96px; flex:none;}
  .donut-pct{font-family:var(--font-mono); font-size:17px; font-weight:800;}
  .donut-sub{font-size:9px;}
  .h2h-bar-track{height:8px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin:6px 0 16px;}
  .h2h-bar-fill{height:100%; border-radius:999px; background:var(--hit);}
  .line-chart{width:100%; height:120px; margin-top:10px;}

  .tabs{display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;}
  .tab{
    font-size:13px; font-weight:700; padding:8px 16px; border-radius:999px;
    border:1px solid var(--line); background:var(--card); cursor:pointer; color:var(--muted);
  }
  .tab.active{background:var(--court); color:#fff; border-color:var(--court);}

  .status{font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; flex:none;}
  .status.live{background:rgba(226,68,74,.18); color:var(--court); border:1px solid rgba(226,68,74,.5);}
  .status.soon{background:var(--court-soft); color:#FAC7C7;}
  .status.done{background:var(--bg-alt); color:var(--muted);}

  .mc-live-score{
    display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;
    margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  }
  .mc-set{
    background:var(--bg-alt); border-radius:8px; padding:5px 10px; font-size:13px; font-weight:700; color:var(--ink);
  }
  .mc-set-current{background:var(--court-soft); color:#FAC7C7; border:1px solid rgba(226,68,74,.45);}
  .mc-live-loading{font-size:12px; color:var(--muted);}
  .mc-live-score-small{margin-top:8px; padding-top:8px; gap:5px;}
  .mc-live-score-small .mc-set{padding:3px 7px; font-size:11px; background:transparent; border:1px solid var(--line); color:var(--muted);}

  .live-clock{
    font-family:var(--font-mono); font-size:13px; color:var(--ball); font-weight:700;
    margin:12px 0 4px;
  }
  .live-sets-grid{display:flex; flex-wrap:wrap; gap:10px; margin:12px 0;}
  .live-set-col{
    background:var(--bg-alt); border-radius:10px; padding:10px 14px; text-align:center; min-width:64px;
  }
  .live-set-col.current{background:var(--court-soft); border:1px solid rgba(226,68,74,.45);}
  .live-set-label{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;}
  .live-set-score{font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--ink);}

  .live-chat{margin-top:18px; border-top:1px solid var(--line); padding-top:14px;}
  .live-chat-list{
    display:flex; flex-direction:column; gap:10px;
    max-height:220px; overflow-y:auto; margin-bottom:10px;
  }
  .live-chat-msg{display:flex; align-items:flex-start; gap:8px;}
  .live-chat-msg img{width:26px; height:26px; border-radius:50%; object-fit:cover; flex:none;}
  .live-chat-avatar-fallback{
    width:26px; height:26px; border-radius:50%; flex:none;
    display:flex; align-items:center; justify-content:center;
    background:var(--court); color:#fff; font-size:11px; font-weight:800;
  }
  .live-chat-name{font-size:11px; font-weight:700; color:var(--muted); display:flex; align-items:center; gap:6px;}
  .level-badge{
    font-family:var(--font-mono); font-size:9.5px; font-weight:800;
    padding:1px 6px; border-radius:999px; letter-spacing:.3px;
  }
  .level-badge.tier-new{background:var(--bg-alt); color:var(--muted);}
  .level-badge.tier-active{background:rgba(93,202,165,.15); color:var(--hit);}
  .level-badge.tier-fan{background:rgba(255,122,69,.18); color:var(--ball);}
  .level-badge.tier-legend{background:linear-gradient(135deg, #FFD700, #FF7A45); color:#1a1a1a;}
  .live-chat-text{font-size:13.5px; color:var(--ink); line-height:1.4; word-break:break-word;}
  .live-chat-form{display:flex; gap:8px;}
  .live-chat-form input{
    flex:1; min-width:0; background:var(--bg-alt); border:1px solid var(--line); border-radius:999px;
    padding:9px 14px; color:var(--ink); font-family:var(--font-body); font-size:13px;
  }
  .live-chat-form input:focus{outline:none; border-color:var(--court);}
  .live-chat-form button{
    font-family:var(--font-body); font-weight:700; font-size:13px; color:#fff;
    background:var(--court); border:none; border-radius:999px; padding:9px 16px; cursor:pointer;
  }
  .live-chat-form button:disabled{opacity:.5; cursor:not-allowed;}

  .bankroll-card{background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); margin-bottom:18px;}
  table.bk{width:100%; border-collapse:collapse; font-size:13.5px;}
  table.bk th{text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); border-bottom:1px solid var(--line); padding:8px 6px;}
  table.bk td{padding:9px 6px; border-bottom:1px solid var(--line); font-family:var(--font-mono);}
  table.bk td.hit{color:var(--hit); font-weight:700;}
  table.bk td.miss{color:var(--miss); font-weight:700;}

  #overlay{
    position:fixed; inset:0; background:rgba(0,0,0,.65); backdrop-filter:blur(2px);
    display:flex; align-items:flex-end; justify-content:center; z-index:100;
  }
  .modal{
    background:var(--card); width:100%; max-width:480px; border-radius:20px 20px 0 0;
    padding:22px 22px 26px; max-height:88vh; overflow-y:auto;
    animation:slideup .25s ease;
  }
  @media(min-width:640px){
    #overlay{align-items:center;}
    .modal{border-radius:20px; margin-bottom:0;}
  }
  @keyframes slideup{from{transform:translateY(30px); opacity:0;} to{transform:none; opacity:1;}}
  .modal-head{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;}
  .modal-close{
    background:var(--bg-alt); border:1px solid var(--line); width:30px; height:30px; border-radius:50%;
    cursor:pointer; font-size:16px; color:var(--muted);
  }
  .modal h3{font-family:var(--font-display); font-size:24px; margin:2px 0 2px; color:var(--ink);}
  .modal .sub{color:var(--muted); font-size:13px;}
  .modal-market{
    display:inline-block; margin:12px 0; font-weight:700; font-size:14px;
    background:var(--court-soft); color:#FAC7C7; padding:8px 14px; border-radius:10px;
  }
  .hist-title{font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:18px 0 8px; display:flex; justify-content:space-between;}
  .chart{display:flex; align-items:flex-end; gap:5px; height:90px; border-bottom:1px dashed var(--line); position:relative; margin-bottom:6px;}
  .bar{flex:1; border-radius:4px 4px 0 0; min-height:6px;}
  .bar.hit{background:var(--hit);}
  .bar.miss{background:var(--miss);}
  .legend{display:flex; gap:14px; font-size:11.5px; color:var(--muted); margin-bottom:16px;}
  .legend span{display:inline-flex; align-items:center; gap:5px;}
  .legend .sw{width:8px; height:8px; border-radius:50%;}
  .kpis{display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:14px 0;}
  .kpi{background:var(--bg-alt); border-radius:10px; padding:10px 12px;}
  .kpi .l{font-size:11px; color:var(--muted);}
  .kpi .v{font-family:var(--font-mono); font-weight:700; font-size:18px;}
  .analysis{font-size:13.5px; line-height:1.55; color:var(--ink); background:var(--bg-alt); border-radius:12px; padding:14px; margin-top:6px; border:1px solid var(--line);}

  footer.site{
    max-width:980px; margin:0 auto; padding:20px 20px 40px; color:var(--muted); font-size:12px; line-height:1.6;
  }
  footer.site strong{color:var(--ink);}

  nav.bottom-nav{
    display:none; position:fixed; bottom:0; left:0; right:0; z-index:50;
    background:var(--card); border-top:1px solid var(--line);
    padding:8px 6px calc(8px + env(safe-area-inset-bottom));
    justify-content:space-around;
  }
  nav.bottom-nav a{
    display:flex; flex-direction:column; align-items:center; gap:3px;
    text-decoration:none; color:var(--muted); font-size:10.5px; font-weight:600; flex:1;
  }
  nav.bottom-nav a.active{color:var(--court);}
  nav.bottom-nav svg{width:20px; height:20px;}

  @media (max-width:640px){
    header.site nav.top-nav{display:none;}
    nav.bottom-nav{display:flex;}
    h1.page-title{font-size:30px;}
    .stat-strip-4{grid-template-columns:repeat(2,1fr);}
    .pc-player-name{font-size:11.5px;}
  }
`;

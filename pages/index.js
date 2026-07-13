import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabaseClient } from '../lib/supabaseClient';
import { logError } from '../lib/logError';

const VIEWS = ['inicio', 'calendario', 'picks', 'seguidos', 'bankroll', 'grupos', 'modelo', 'errores', 'mibankroll'];
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const THEME_KEY = 'camilorey_theme';

// pref es lo que la persona eligió ('oscuro'/'claro'/'sistema') — si
// es 'sistema', el tema real a pintar depende de las preferencias del
// SO en ese momento (prefers-color-scheme), no de un valor fijo.
function effectiveTheme(pref) {
  if (pref === 'claro') return 'light';
  if (pref === 'oscuro') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function applyTheme(pref) {
  if (typeof document === 'undefined') return;
  const effective = effectiveTheme(pref);
  document.documentElement.setAttribute('data-theme', effective);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'light' ? '#FDFBFA' : '#0E0D0C');
}

// El navegador pide la llave pública del servidor push en este
// formato (Uint8Array), pero VAPID la da como base64 url-safe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : '';
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// iOS/iPadOS (Safari o cualquier navegador ahí, todos corren sobre
// WebKit) solo expone la API de push cuando el sitio está agregado a
// la pantalla de inicio (PWA instalada) — en una pestaña normal de
// Safari, 'PushManager' in window da false aunque el dispositivo sea
// moderno. Sin distinguir este caso, el mensaje "no soportado" es
// engañoso: sí funciona, solo falta instalarlo.
function isIosNotInstalled() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIos && !isStandalone;
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
    return isIosNotInstalled() ? 'ios-needs-install' : 'unsupported';
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

// history viene del más reciente al más viejo (index 0 = último
// partido jugado) — la racha se cuenta desde el principio del array.
function streakLabelFromHistory(history) {
  if (!history || history.length === 0) return null;
  const last = history[0].win;
  let count = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].win === last) count++;
    else break;
  }
  return `${count}${last ? 'W' : 'L'}`;
}

export async function getServerSideProps({ query }) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
  // Calendario, Bankroll y el conteo de usuarios no dependen de nada
  // de la cadena de picks/resolvedPicks/tournamentGroups de abajo —
  // antes se pedían en secuencia DESPUÉS de toda esa cadena, sumando
  // varios round-trips más al tiempo de carga. Se disparan ya (sin
  // esperarlos todavía) para que corran en paralelo con todo lo demás,
  // y se resuelven más abajo, justo donde se necesitan.
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

  const windowMatchesPromise = supabase
    .from('matches')
    .select('*')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(1000);

  const bankrollPromise = (async () => {
    const { data: bankrollRows } = await supabase
      .from('bankroll_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
    const { data: bkPicks } = bkPickIds.length
      ? await supabase.from('picks').select('id, market, odds').in('id', bkPickIds)
      : { data: [] };
    return { bankrollRows, bkPicks };
  })();

  const userCountPromise = supabase.from('profiles').select('id', { count: 'exact', head: true });

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

  // Picks ya resueltos (para las pestañas Ganados/Perdidos de la
  // sección Picks). Se trae antes de armar "picks"/"resolvedPicks"
  // porque ambos comparten UNA sola consulta de forma/H2H más abajo.
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

  // Un pick deja de mostrarse como "próximo" un rato ANTES de que
  // arranque el partido (no justo cuando ya casi empieza), y por
  // supuesto también una vez que ya arrancó o terminó.
  const HIDE_BEFORE_START_MS = 3 * 60 * 1000;

  const pendingPrelim = (pendingPicks || [])
    .map((pick) => {
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
      return { pick, match, favored, opponent, tournament: tournamentsById.get(match.tournament_id) };
    })
    .filter(Boolean);

  const resolvedPrelim = (resolvedPicksRaw || [])
    .map((pick) => {
      const match = resolvedMatchesById.get(pick.match_id);
      if (!match) return null;
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent =
        pick.predicted_winner_id === match.player_a_id
          ? playersById.get(match.player_b_id)
          : playersById.get(match.player_a_id);
      if (!favored || !opponent) return null;

      // El resultado final se guarda relativo a jugador A/B, no a
      // favorito/rival — hay que reordenarlo a favor del favorito
      // (izquierda en la tarjeta), igual que en followed-detail.js.
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const score =
        match.sets_a != null && match.sets_b != null
          ? favoredIsA
            ? `${match.sets_a}-${match.sets_b}`
            : `${match.sets_b}-${match.sets_a}`
          : null;
      const setScores = Array.isArray(match.set_scores)
        ? favoredIsA
          ? match.set_scores
          : match.set_scores.map((s) => ({ a: s.b, b: s.a }))
        : null;

      return { pick, match, favored, opponent, tournament: tournamentsById.get(match.tournament_id), score, setScores };
    })
    .filter(Boolean);

  // Antes, cada pick disparaba 2 consultas propias a Supabase (forma
  // reciente + H2H) — con decenas de picks pendientes y resueltos a la
  // vez, eso eran cientos de round-trips en CADA carga de página, y
  // era la causa real de que el sitio se sintiera cada vez más lento
  // a medida que crecía el historial. Ahora se trae en una sola
  // consulta TODOS los partidos terminados de TODOS los jugadores
  // involucrados (pendientes + resueltos juntos), y la forma reciente
  // + el cruce directo de cada pick se calculan en memoria a partir de
  // ese único resultado.
  async function buildFormAndH2H(pairs) {
    const result = new Map();
    const allIds = [...new Set(pairs.flatMap((p) => [p.favoredId, p.opponentId]).filter(Boolean))];
    if (allIds.length === 0) return result;

    const idList = allIds.join(',');
    const { data } = await supabase
      .from('matches')
      .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
      .eq('status', 'finished')
      .or(`player_a_id.in.(${idList}),player_b_id.in.(${idList})`)
      .order('scheduled_at', { ascending: false })
      .limit(5000);
    const rows = data || [];

    const missingOpponentIds = [...new Set(rows.flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(
      (id) => id && !playersById.has(id)
    );
    if (missingOpponentIds.length) {
      const { data: extra } = await supabase
        .from('players')
        .select('id, name, avatar_url, avatar_cutout_url')
        .in('id', missingOpponentIds);
      for (const p of extra || []) playersById.set(p.id, p);
    }

    const byPlayer = new Map(allIds.map((id) => [id, []]));
    for (const m of rows) {
      if (byPlayer.has(m.player_a_id)) byPlayer.get(m.player_a_id).push(m);
      if (byPlayer.has(m.player_b_id)) byPlayer.get(m.player_b_id).push(m);
    }

    for (const { pickId, favoredId, opponentId, opponentName } of pairs) {
      const playerMatches = byPlayer.get(favoredId) || [];
      const history = playerMatches.slice(0, 10).map((m) => {
        const isA = m.player_a_id === favoredId;
        const oppId = isA ? m.player_b_id : m.player_a_id;
        return {
          date: m.scheduled_at,
          opponent: playersById.get(oppId)?.name || '?',
          setsFor: isA ? m.sets_a : m.sets_b,
          setsAgainst: isA ? m.sets_b : m.sets_a,
          win: m.winner_id === favoredId
        };
      });
      const h2hMatches = playerMatches
        .filter((m) => m.player_a_id === opponentId || m.player_b_id === opponentId)
        .slice(0, 20)
        .map((m) => {
          const isA = m.player_a_id === favoredId;
          return {
            date: m.scheduled_at,
            opponent: opponentName,
            setsFor: isA ? m.sets_a : m.sets_b,
            setsAgainst: isA ? m.sets_b : m.sets_a,
            win: m.winner_id === favoredId
          };
        });
      const winsFavored = h2hMatches.filter((m) => m.win).length;
      result.set(pickId, {
        history,
        streakLabel: streakLabelFromHistory(history),
        h2h: `${winsFavored}-${h2hMatches.length - winsFavored}`,
        h2hTotal: h2hMatches.length,
        h2hMatches
      });
    }
    return result;
  }

  const formByPickId = await buildFormAndH2H([
    ...pendingPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    })),
    ...resolvedPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    }))
  ]);
  const EMPTY_FORM = { history: [], streakLabel: null, h2h: '0-0', h2hTotal: 0, h2hMatches: [] };

  const picks = pendingPrelim.map(({ pick, match, favored, opponent, tournament }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
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
      history: form.history,
      streakLabel: form.streakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score: null,
      setScores: null,
      result: 'pending'
    };
  });
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  // El pick destacado prioriza cuota real arriba de 1.60 — entre esos,
  // el de mayor confianza. Si ninguno tiene cuota >1.60 (o cuota del
  // todo), cae al de mayor confianza general para no dejar Inicio sin
  // destacado solo porque el cruce con Rushbet no encontró esa cuota.
  const picksWithGoodOdds = picks.filter((p) => p.odds && p.odds > 1.6);
  const topConfidence =
    (picksWithGoodOdds.length ? picksWithGoodOdds : picks).slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

  const resolvedPicks = resolvedPrelim.map(({ pick, match, favored, opponent, tournament, score, setScores }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
    return {
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
      history: form.history,
      streakLabel: form.streakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score,
      setScores,
      result: pick.result
    };
  });
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

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

  // Calendario: windowMatches ya se disparó al principio de la
  // función (ver windowMatchesPromise) — aquí solo se espera.
  const { data: windowMatches } = await windowMatchesPromise;

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
      playerAId: m.player_a_id,
      playerBId: m.player_b_id,
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

  // Bankroll: bankrollRows/bkPicks ya se dispararon al principio de
  // la función (ver bankrollPromise) — aquí solo se espera.
  const { bankrollRows, bkPicks } = await bankrollPromise;
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const bankrollLog = (bankrollRows || []).map((r) => {
    const pick = bkPicksById.get(r.pick_id);
    return {
      fecha: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', timeZone: 'America/Bogota' }).format(
        new Date(r.created_at)
      ),
      pick: pick?.market || 'Pick',
      u: formatCOP(Number(r.units), true),
      ok: Number(r.units) >= 0,
      balance: formatCOP(Number(r.balance))
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

  const { count: userCount } = await userCountPromise;

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
  } catch (err) {
    // Si CUALQUIER cosa de arriba truena, antes se caía el sitio
    // entero (pantalla de error de Next.js) — mejor registrar el
    // error y devolver props vacíos/seguros para que la página cargue
    // igual (aunque sea sin datos) mientras se investiga.
    console.error('Error en getServerSideProps:', err);
    await logError(supabase, {
      source: 'getServerSideProps',
      message: err.message,
      stack: err.stack,
      context: { query }
    });
    const fallbackDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    return {
      props: {
        stats: { efectividad: 0, racha: 0, cuotaProm: null, roi: 0, unidades: 0 },
        picks: [],
        resolvedPicks: [],
        tournamentGroups: [],
        matches: [],
        bankrollLog: [],
        bankrollSeries: [],
        currentDateStr: fallbackDate,
        prevDateStr: fallbackDate,
        nextDateStr: fallbackDate,
        isToday: true,
        userCount: 0
      }
    };
  }
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

// Fecha corta para las filas de "últimos partidos" (d/m/aa), estilo
// Sofascore.
function shortDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

// Bankroll en pesos colombianos, banco inicial $2.000.000 (ver
// scripts/convert-bankroll-to-pesos.js). withSign se usa para
// ganancia/pérdida de una apuesta puntual; el balance total no lleva
// signo (siempre positivo salvo que el banco se acabe del todo).
function formatCOP(n, withSign = false) {
  const abs = Math.round(Math.abs(n)).toLocaleString('es-CO');
  const sign = withSign ? (n >= 0 ? '+' : '-') : '';
  return `${sign}$${abs}`;
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
  const [form, setForm] = useState(null);

  // Forma reciente + H2H de los dos, una sola vez al abrir el modal —
  // no cambia mientras está abierto (a diferencia del marcador en
  // vivo), así que no hace falta repetir la consulta.
  useEffect(() => {
    if (!m.playerAId || !m.playerBId) return;
    let cancelled = false;
    fetch(`/api/player-form?playerAId=${m.playerAId}&playerBId=${m.playerBId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setForm(data);
      })
      .catch((e) => console.error('Error cargando forma reciente:', e));
    return () => {
      cancelled = true;
    };
  }, [m.playerAId, m.playerBId]);

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

        {form ? (
          <>
            <div className="hist-title">
              <span>Forma reciente · {m.playerA}</span>
            </div>
            <RecentFormList history={form.historyA.slice(0, 5)} />

            <div className="hist-title">
              <span>Forma reciente · {m.playerB}</span>
            </div>
            <RecentFormList history={form.historyB.slice(0, 5)} />

            {form.h2hTotal > 0 ? (
              <>
                <div className="hist-title">
                  <span>
                    H2H {m.playerA} vs {m.playerB}
                  </span>
                  <span className="num">{form.h2h}</span>
                </div>
                <div className="h2h-bar-track">
                  <div
                    className="h2h-bar-fill"
                    style={{ width: `${(Number(form.h2h.split('-')[0]) / form.h2hTotal) * 100}%` }}
                  ></div>
                </div>
              </>
            ) : null}
          </>
        ) : null}

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

// Lista de "últimos partidos" estilo Sofascore/AiScore: una fila por
// partido real, con fecha, contra quién, el marcador de sets de ESE
// cruce, y un círculo verde/rojo de victoria o derrota — no puntos ni
// barras abstractas.
function RecentFormList({ history }) {
  if (!history || history.length === 0) {
    return <p className="page-sub">Sin historial reciente todavía.</p>;
  }
  return (
    <div className="form-list">
      {history.map((m, i) => (
        <div className="form-list-row" key={i}>
          <div className="form-list-meta">
            <span className="form-list-date">{shortDate(m.date)}</span>
            <span className="form-list-ft">FT</span>
          </div>
          <div className="form-list-opp">
            vs {m.opponent}
            <span className="form-list-score num">
              {m.setsFor}-{m.setsAgainst}
            </span>
          </div>
          <span className={`form-list-badge ${m.win ? 'win' : 'loss'}`}>{m.win ? 'W' : 'L'}</span>
        </div>
      ))}
    </div>
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

// Modal de detalle de un pick — "partido detallado" con el jugador y
// su rival de frente (marcador real si ya se jugó, VS si todavía no),
// y 4 pestañas: Resumen (sets si los tenemos + los datos clave de un
// vistazo), Estadísticas (forma reciente con selector L5/L10),
// Análisis (el texto de por qué es favorito) y H2H (cruce directo
// partido por partido). Todo lo que se muestra sale de datos reales
// que ya calculamos — no se inventa ningún número.
function PickDetailModal({ pick, onClose }) {
  const [tab, setTab] = useState('resumen');
  const [formView, setFormView] = useState('l10');

  // history viene del más reciente al más viejo (index 0 = último
  // partido) — L5 son los primeros 5 elementos, no los últimos.
  const displayHistory = formView === 'l5' ? pick.history.slice(0, 5) : pick.history;
  const hitsInView = displayHistory.filter((m) => m.win).length;

  const isDone = pick.result === 'hit' || pick.result === 'miss';
  const won = pick.result === 'hit';

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <span className="eyebrow">Partido detallado</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="match-hero">
          <div className="match-hero-side">
            <PlayerAvatar name={pick.player} avatarUrl={pick.avatarUrl} initials={pick.initials} side="left" className="match-hero-avatar" />
            <span className="match-hero-name">
              <span className="flag">🇨🇿</span> {pick.player}
            </span>
          </div>

          <div className="match-hero-center">
            {isDone && pick.score ? (
              <div className="match-hero-score num">{pick.score}</div>
            ) : (
              <div className="match-hero-vs">VS</div>
            )}
            <div className="match-hero-meta">
              {pick.tournament} · {pick.time}
            </div>
            {isDone ? (
              <span className={`match-hero-pill ${won ? 'win' : 'loss'}`}>{won ? 'Acertado' : 'Fallado'}</span>
            ) : (
              <span className="match-hero-pill pending">{pick.market}</span>
            )}
          </div>

          <div className="match-hero-side">
            <PlayerAvatar
              name={pick.opponent}
              avatarUrl={pick.opponentAvatarUrl}
              initials={pick.opponentInitials}
              side="right"
              className="match-hero-avatar"
            />
            <span className="match-hero-name">
              <span className="flag">🇨🇿</span> {pick.opponent}
            </span>
          </div>
        </div>

        <div className="tabs">
          <div className={`tab ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setTab('resumen')}>
            Resumen
          </div>
          <div className={`tab ${tab === 'estadisticas' ? 'active' : ''}`} onClick={() => setTab('estadisticas')}>
            Estadísticas
          </div>
          <div className={`tab ${tab === 'analisis' ? 'active' : ''}`} onClick={() => setTab('analisis')}>
            Análisis
          </div>
          <div className={`tab ${tab === 'h2h' ? 'active' : ''}`} onClick={() => setTab('h2h')}>
            H2H
          </div>
        </div>

        {tab === 'resumen' ? (
          <>
            {pick.setScores && pick.setScores.length > 0 ? (
              <>
                <div className="hist-title">
                  <span>Sets</span>
                </div>
                <div className="live-sets-grid">
                  {pick.setScores.map((s, i) => (
                    <div className="live-set-col" key={i}>
                      <div className="live-set-label">Set {i + 1}</div>
                      <div className="live-set-score">
                        {s.a}-{s.b}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <div className="stat-rows">
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">📊 Índice IA</span>
                  <span className="stat-row-value num">{pick.confidence}%</span>
                </div>
                <div className="stat-row-bar">
                  <div className="stat-row-bar-fill" style={{ width: `${pick.confidence}%` }}></div>
                </div>
              </div>
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">🎯 Cuota (Rushbet)</span>
                  <span className="stat-row-value num">{pick.odds ? pick.odds.toFixed(2) : 'No disponible'}</span>
                </div>
              </div>
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">🔥 Racha</span>
                  <span className="stat-row-value num">{pick.streakLabel || '—'}</span>
                </div>
              </div>
              {pick.h2hTotal > 0 ? (
                <div className="stat-row">
                  <div className="stat-row-top">
                    <span className="stat-row-label">⚔️ H2H</span>
                    <span className="stat-row-value num">{pick.h2h}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : tab === 'estadisticas' ? (
          <>
            <div className="tabs" style={{ marginBottom: '14px' }}>
              <div className={`tab ${formView === 'l5' ? 'active' : ''}`} onClick={() => setFormView('l5')}>
                L5
              </div>
              <div className={`tab ${formView === 'l10' ? 'active' : ''}`} onClick={() => setFormView('l10')}>
                L10
              </div>
            </div>

            {displayHistory.length > 0 ? (
              <>
                <div className="donut-row">
                  <DonutChart wins={hitsInView} total={displayHistory.length} />
                  <div>
                    <div className="hist-title" style={{ margin: 0 }}>
                      <span>Últimos {displayHistory.length} partidos</span>
                    </div>
                    <p className="page-sub" style={{ margin: '4px 0 0' }}>
                      {hitsInView} victorias, {displayHistory.length - hitsInView} derrotas
                    </p>
                  </div>
                </div>
                <RecentFormList history={displayHistory} />
              </>
            ) : (
              <p className="page-sub">Sin historial reciente todavía.</p>
            )}
          </>
        ) : tab === 'analisis' ? (
          <div className="analysis">{pick.analysis}</div>
        ) : pick.h2hTotal > 0 ? (
          <>
            <div className="hist-title">
              <span>H2H contra {pick.opponent}</span>
              <span className="num">{pick.h2h}</span>
            </div>
            <div className="h2h-bar-track">
              <div
                className="h2h-bar-fill"
                style={{ width: `${(Number(pick.h2h.split('-')[0]) / pick.h2hTotal) * 100}%` }}
              ></div>
            </div>
            <RecentFormList history={pick.h2hMatches} />
          </>
        ) : (
          <p className="page-sub">Todavía no se han enfrentado.</p>
        )}
      </div>
    </div>
  );
}

// Tabla de grupo de un torneo — todos contra todos, igual a como la
// muestra tt.league-pro.com dentro de cada torneo: una fila por
// jugador, una columna por cada rival con el marcador de sets de ese
// cruce, y el total de sets + puesto a la derecha.
const MODEL_FACTOR_LABEL = { ratingScore: 'Rating', streakScore: 'Racha', h2hScore: 'H2H' };

// Si el intervalo de confianza 95% (Wilson) NO cruza el 50%, el
// resultado ya es estadísticamente distinguible de una moneda al aire
// (para bien o para mal). Si lo cruza, todavía no hay muestra
// suficiente para saberlo — no es lo mismo que "no funciona".
function ModelStatsView({ stats }) {
  const [loWilson, hiWilson] = stats.wilson95;
  const verdict = loWilson > 0.5 ? 'better' : hiWilson < 0.5 ? 'worse' : 'unknown';
  const verdictLabel =
    verdict === 'better'
      ? '✅ Mejor que el azar (estadísticamente)'
      : verdict === 'worse'
      ? '⚠️ Peor que el azar (estadísticamente)'
      : '⏳ Todavía no se puede distinguir del azar';

  return (
    <>
      <div className="stat-strip stat-strip-3">
        <div className="stat-card">
          <div className="label">Picks resueltos</div>
          <div className="value num">{stats.n}</div>
        </div>
        <div className="stat-card">
          <div className="label">Efectividad</div>
          <div className="value hit num">{Math.round(stats.hitRate * 100)}%</div>
        </div>
        <div className="stat-card">
          <div className="label">IC 95% (Wilson)</div>
          <div className="value num">
            {Math.round(loWilson * 100)}–{Math.round(hiWilson * 100)}%
          </div>
        </div>
      </div>

      <div className={`model-verdict model-verdict-${verdict}`}>{verdictLabel}</div>

      <div className="section-head">
        <h2>Por rango de confianza</h2>
      </div>
      <div className="stat-rows">
        {stats.buckets.map((b) => (
          <div className="stat-row" key={b.range}>
            <div className="stat-row-top">
              <span className="stat-row-label">Confianza {b.range}%</span>
              <span className="stat-row-value num">
                {b.n === 0 ? 'Sin datos' : `${Math.round(b.hitRate * 100)}% (n=${b.n})`}
              </span>
            </div>
            {b.n > 0 ? (
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: `${Math.round(b.hitRate * 100)}%` }}></div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Peso de cada factor</h2>
      </div>
      <p className="page-sub">Promedio del aporte de cada factor cuando el pick acertó vs. cuando falló.</p>
      <div className="stat-rows">
        {Object.entries(stats.factorAvg).map(([key, v]) => (
          <div className="stat-row" key={key}>
            <div className="stat-row-top">
              <span className="stat-row-label">{MODEL_FACTOR_LABEL[key] || key}</span>
              <span className="stat-row-value num">
                acierto {v.avgOnHit.toFixed(2)} · fallo {v.avgOnMiss.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Últimos {stats.recentSequence.length} resueltos</h2>
      </div>
      <div className="form-list">
        {stats.recentSequence.map((r, i) => (
          <div className="form-list-row" key={i}>
            <div className="form-list-meta">
              <span className="form-list-date">{shortDate(r.date)}</span>
              <span className="form-list-ft">Índice IA</span>
            </div>
            <div className="form-list-opp">
              confianza
              <span className="form-list-score num">{r.confidence}%</span>
            </div>
            <span className={`form-list-badge ${r.win ? 'win' : 'loss'}`}>{r.win ? 'W' : 'L'}</span>
          </div>
        ))}
      </div>
    </>
  );
}

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

// Banco de consejos — cada vez que se dispara el modal se eligen 3 al
// azar (sin repetir dentro de la misma aparición), para que no se
// sienta como el mismo aviso copiado y pegado cada vez que alguien
// pasa de 3 seguidos.
const RISK_TIPS = [
  {
    icon: '📉',
    title: 'Protege tu bankroll',
    body: 'Reparte tu banco entre las selecciones que sigues. Evita concentrar más de lo que te sientas cómodo gestionando en un solo día.'
  },
  {
    icon: '📚',
    title: 'Mantén una jornada enfocada',
    body: 'Seguir menos selecciones facilita revisar el rendimiento y controlar mejor la exposición diaria.'
  },
  {
    icon: '🛡️',
    title: 'Define un límite diario de asignación',
    body: 'Usa el planificador Kelly en la pestaña Bankroll como referencia para no arriesgar más de la cuenta.'
  },
  {
    icon: '🎯',
    title: 'Prioriza calidad sobre cantidad',
    body: 'Entre más picks sigas a la vez, más difícil es darle seguimiento real a cada uno cuando estén en vivo.'
  },
  {
    icon: '📊',
    title: 'Ninguna racha dura para siempre',
    body: 'Ajusta el tamaño de lo que arriesgas según tu propio límite, no solo según qué tan segura se vea la confianza del modelo.'
  },
  {
    icon: '🔍',
    title: 'Revisa el historial real primero',
    body: 'Antes de subir el monto que arriesgas por pick, mira el acierto real acumulado en la pestaña Bankroll.'
  },
  {
    icon: '🎲',
    title: 'Diversifica entre torneos',
    body: 'Seguir picks de un solo torneo hace que un resultado inesperado pese más sobre tu banco completo.'
  },
  {
    icon: '⛔',
    title: 'Nunca sigas "para recuperar"',
    body: 'Cada pick es independiente — seguir uno más solo porque el anterior falló no cambia sus probabilidades reales.'
  },
  {
    icon: '⏸️',
    title: 'El impulso es una señal',
    body: 'Si notas que estás siguiendo picks muy rápido, sin revisarlos, es buen momento para bajar el ritmo un rato.'
  }
];

function pickRandomTips(n = 3) {
  const shuffled = [...RISK_TIPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Se dispara cada vez que la cantidad de picks seguidos SUBE y pasa de
// 3 (no solo la primera vez) — ver el useEffect que llama a esto en
// Home. Los 3 consejos salen al azar del banco de arriba.
function RiskModal({ count, tips, onClose }) {
  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal risk-modal">
        <div className="risk-modal-head">
          <div className="risk-modal-icon">🛡️</div>
          <div>
            <div className="risk-modal-eyebrow">Gestión de riesgo</div>
            <h3>
              Estás siguiendo {count} pick{count === 1 ? '' : 's'}
            </h3>
          </div>
        </div>

        {tips.map((tip) => (
          <div className="risk-tip" key={tip.title}>
            <span className="risk-tip-icon">{tip.icon}</span>
            <div>
              <strong>{tip.title}</strong>
              <p>{tip.body}</p>
            </div>
          </div>
        ))}

        <button className="btn btn-ball risk-modal-btn" onClick={onClose}>
          ✓ Entendido
        </button>
        <p className="risk-modal-disclaimer">Esto no es asesoría financiera. Usa estos datos con responsabilidad.</p>
      </div>
    </div>
  );
}

// Decoración pura (mesa en perspectiva + pelota rebotando en loop) en
// los márgenes — SOLO existe visualmente a partir de 1400px de ancho
// (ver .table-decor en el CSS, display:none por debajo de eso), que
// es donde sobra espacio vacío a los lados del contenido (max-width
// 980px). "side" solo decide si se espeja con CSS (mismo SVG para los
// dos lados, con id único por lado para que el <mpath> de cada uno no
// choque) — no cambia el dibujo. pointer-events:none + aria-hidden
// porque es 100% decorativo, no debe interferir con nada ni leerse
// por un lector de pantalla.
function TableDecor({ side }) {
  const pathId = `table-decor-path-${side}`;
  return (
    <div className={`table-decor table-decor-${side}`} aria-hidden="true">
      <svg viewBox="0 0 200 500" width="200" height="500" fill="none">
        <path d="M14 90 L166 250 L14 420" stroke="var(--court)" strokeWidth="1.2" opacity="0.5" />
        <path d="M14 250 L200 250" stroke="var(--court)" strokeWidth="1" opacity="0.35" />
        <path
          id={pathId}
          d="M14,250 A78,118 0 1,0 170,250 A78,118 0 1,0 14,250 Z"
          stroke="var(--court)"
          strokeWidth="1"
          strokeDasharray="3 7"
          opacity="0.4"
        />
        <circle r="6" fill="var(--decor-ball)">
          <animateMotion dur="5s" repeatCount="indefinite">
            <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
          </animateMotion>
        </circle>
      </svg>
    </div>
  );
}

function GoogleGIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size}>
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
  );
}

// Modal de login — se abre desde el botón "Entrar" del header o
// cuando alguien intenta seguir un pick sin haber iniciado sesión.
// El sitio se navega libre sin cuenta (Inicio/Picks/Calendario); esto
// solo reemplaza el clic directo a Google por una pantalla intermedia
// con el branding de CAMILOREY, para que quede claro qué se está
// autorizando antes de saltar a la ventana de Google.
function LoginModal({ onClose, onLogin }) {
  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal login-modal">
        <button className="modal-close login-modal-close" onClick={onClose}>
          ✕
        </button>
        <div className="login-modal-icon">🔒</div>
        <h3 className="login-modal-title">Iniciar sesión</h3>
        <p className="login-modal-sub">
          Utiliza tu cuenta de <strong>Google</strong> para continuar
        </p>
        <button className="google-btn" onClick={onLogin}>
          <GoogleGIcon size={20} />
          Iniciar sesión con Google
        </button>
        <div className="login-modal-note">
          <span>🛡️</span>
          No almacenamos tu contraseña. Autenticación segura con Google.
        </div>
      </div>
    </div>
  );
}

function ProfileModal({ user, isAdmin, onClose, onLogout, themePref, onChangeTheme }) {
  const [notifStatus, setNotifStatus] = useState('unknown');

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof Notification !== 'undefined') {
      setNotifStatus(Notification.permission);
    }
  }, []);

  const handleActivateNotifs = async () => {
    const result = await ensurePushSubscription(user);
    if (result === 'ok') {
      setNotifStatus('granted');
      alert('Notificaciones activadas ✅');
    } else if (result === 'denied') {
      setNotifStatus('denied');
      alert('Tienes las notificaciones bloqueadas para este sitio. Actívalas desde la configuración del navegador.');
    } else if (result === 'ios-needs-install') {
      alert(
        'En iPhone/iPad, las notificaciones solo funcionan si agregas CAMILOREY a tu pantalla de inicio primero: toca Compartir (el cuadrito con la flecha) → "Agregar a pantalla de inicio", y abre la app desde ese ícono en vez de Safari.'
      );
    } else if (result === 'unsupported') {
      alert('Tu navegador no soporta notificaciones push.');
    } else {
      alert('No se pudo activar las notificaciones, intenta de nuevo.');
    }
  };

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {user.user_metadata?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="featured-avatar" src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="featured-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--court)', fontWeight: 800 }}>
                {(user.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <h3 style={{ fontSize: '18px' }}>{user.user_metadata?.full_name || user.email}</h3>
              <div className="sub">
                {user.email}
                {isAdmin ? ' · Admin' : ''}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="profile-row" onClick={handleActivateNotifs}>
          <span className="profile-row-icon">🔔</span>
          <div className="profile-row-body">
            <strong>Notificaciones</strong>
            <p>
              {notifStatus === 'granted'
                ? 'Activadas — te avisamos de tus picks seguidos'
                : notifStatus === 'denied'
                ? 'Bloqueadas en el navegador — toca para ver cómo activarlas'
                : 'Toca para activar avisos de tus picks seguidos'}
            </p>
          </div>
          <span className={`status ${notifStatus === 'granted' ? 'live' : 'soon'}`}>
            {notifStatus === 'granted' ? 'Activas' : 'Activar'}
          </span>
        </div>

        <div className="profile-row profile-row-theme">
          <span className="profile-row-icon">🎨</span>
          <div className="profile-row-body">
            <strong>Tema</strong>
            <p>Elige cómo se ve CAMILOREY en este dispositivo.</p>
            <div className="theme-switch">
              {[
                ['oscuro', '🌙 Oscuro'],
                ['claro', '☀️ Claro'],
                ['sistema', '⚙️ Sistema']
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`theme-switch-btn ${themePref === key ? 'active' : ''}`}
                  onClick={() => onChangeTheme(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          className="btn btn-ghost risk-modal-btn"
          style={{ marginTop: '18px' }}
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// Kelly: fracción óptima del banco a arriesgar dado el edge real
// (confianza como probabilidad, cuota real de Rushbet) — f* = (b·p - q) / b,
// b = cuota-1, p = confianza/100, q = 1-p. Si f* <= 0 el modelo no ve
// ventaja real (la cuota no compensa el riesgo) y Kelly dice no
// apostar. multiplier ajusta qué tan agresivo se aplica ese f* puro —
// 1/4, 1/2 o completo, según el nivel de riesgo elegido.
function kellyFraction(confidence, odds, multiplier = 0.5) {
  if (!odds || odds <= 1) return 0;
  const p = confidence / 100;
  const q = 1 - p;
  const b = odds - 1;
  const f = (b * p - q) / b;
  return Math.max(0, f * multiplier);
}

const RISK_LEVELS = {
  seguro: { label: 'Seguro', sub: '1/4 Kelly', multiplier: 0.25 },
  equilibrado: { label: 'Equilibrado', sub: '1/2 Kelly', multiplier: 0.5 },
  agresivo: { label: 'Agresivo', sub: 'Kelly completo', multiplier: 1 }
};

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
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [riskTips, setRiskTips] = useState([]);
  const prevFollowedCountRef = useRef(0);
  const [bankrollTab, setBankrollTab] = useState('slip');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  // Banco de PLANEACIÓN (para el Slip Kelly) — separado del balance
  // real de "Rendimiento". Arranca igual al balance real, pero es
  // editable a mano para simular con otro monto. Se guarda en el
  // navegador (localStorage), no en la base de datos — es solo una
  // herramienta de planeación personal, no cambia el bankroll real.
  const [bankPlan, setBankPlan] = useState(initialStats.unidades);
  const [riskLevel, setRiskLevel] = useState('equilibrado');
  const [slipMode, setSlipMode] = useState('individual');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('camilorey_bankplan') : null;
    if (saved != null && !Number.isNaN(Number(saved))) setBankPlan(Number(saved));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('camilorey_bankplan', String(bankPlan));
  }, [bankPlan]);

  // "Mi Bankroll" — simulador personal para cualquier usuario (no
  // solo admin). No hay una bitácora nueva: el balance/evolución se
  // recalcula cada vez a partir de followedDetail (los picks que la
  // persona sigue, ya resueltos o no) con la misma fórmula de Kelly
  // del Bankroll del admin. Lo único que se guarda de verdad es el
  // banco inicial y el nivel de riesgo, por cuenta (no por navegador,
  // a diferencia del bankPlan del admin de arriba).
  const [myBankPlan, setMyBankPlan] = useState(2000000);
  const [myRiskLevel, setMyRiskLevel] = useState('equilibrado');
  const [myBankLoaded, setMyBankLoaded] = useState(false);

  useEffect(() => {
    if (!user || !supabaseClient) {
      setMyBankLoaded(false);
      return;
    }
    let cancelled = false;
    supabaseClient
      .from('user_bankroll_settings')
      .select('starting_bank, risk_level')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('Error cargando Mi Bankroll:', error);
        if (data) {
          setMyBankPlan(Number(data.starting_bank));
          setMyRiskLevel(data.risk_level);
        }
        setMyBankLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const saveMyBankSettings = async (patch) => {
    if (!user || !supabaseClient) return;
    const { error } = await supabaseClient
      .from('user_bankroll_settings')
      .upsert({ user_id: user.id, starting_bank: myBankPlan, risk_level: myRiskLevel, ...patch, updated_at: new Date() });
    if (error) console.error('Error guardando Mi Bankroll:', error);
  };

  // Tema: oscuro / claro / sistema (según el SO). "sistema" es el
  // default para quien nunca lo tocó. Se aplica al <html> vía atributo
  // (ver applyTheme) para que todo el CSS existente, que ya usa
  // variables como --bg/--ink, cambie de color sin tocar componentes.
  const [themePref, setThemePref] = useState('sistema');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
    const pref = saved || 'sistema';
    setThemePref(pref);
    applyTheme(pref);
  }, []);

  useEffect(() => {
    if (themePref !== 'sistema' || typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('sistema');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  const changeTheme = (pref) => {
    setThemePref(pref);
    if (typeof window !== 'undefined') window.localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
  };

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

  // No es "una vez por sesión" — se dispara cada vez que la cantidad
  // de seguidos SUBE y queda en más de 3 (seguir 1 más estando ya en 4,
  // 5, etc. también lo dispara de nuevo), con consejos al azar.
  useEffect(() => {
    const count = followedPickIds.size;
    if (count > 3 && count > prevFollowedCountRef.current) {
      setRiskTips(pickRandomTips());
      setShowRiskModal(true);
    }
    prevFollowedCountRef.current = count;
  }, [followedPickIds]);

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
      setShowLoginModal(true);
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

  // Estadísticas del modelo (¿la confianza que calculamos de verdad
  // predice mejor que una moneda al aire?) — solo se consulta cuando
  // el admin entra a esa pestaña, no en cada carga de página.
  const [modelStats, setModelStats] = useState(null);
  const [modelStatsError, setModelStatsError] = useState(null);
  useEffect(() => {
    if (view !== 'modelo' || !isAdmin || !supabaseClient) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      try {
        const r = await fetch('/api/model-stats', { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) setModelStatsError(data.error || 'Error cargando estadísticas del modelo.');
        else setModelStats(data);
      } catch (e) {
        if (!cancelled) setModelStatsError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, isAdmin]);

  // Errores de la app (getServerSideProps, rutas API) — mismo patrón
  // que Modelo: solo se consulta al entrar a esa pestaña.
  const [errorLog, setErrorLog] = useState(null);
  const [errorLogError, setErrorLogError] = useState(null);
  useEffect(() => {
    if (view !== 'errores' || !isAdmin || !supabaseClient) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      try {
        const r = await fetch('/api/error-log', { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) setErrorLogError(data.error || 'Error cargando el registro de errores.');
        else setErrorLog(data.errors);
      } catch (e) {
        if (!cancelled) setErrorLogError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, isAdmin]);

  const tabPicks =
    pickTab === 'pendientes'
      ? picks
      : pickTab === 'ganados'
      ? resolvedPicks.filter((p) => p.result === 'hit')
      : pickTab === 'perdidos'
      ? resolvedPicks.filter((p) => p.result === 'miss')
      : [...picks, ...resolvedPicks];

  // "Mi Bankroll": mismo cálculo de Kelly que el Bankroll del admin,
  // pero corriendo solo sobre los picks que ESTA persona sigue (no
  // los del sitio entero). followedDetail ya trae confianza/cuota/
  // resultado de cada uno — no hace falta pedir nada más.
  const myMultiplier = RISK_LEVELS[myRiskLevel].multiplier;
  const myResolvedFollowed = followedDetail
    .filter((p) => (p.result === 'hit' || p.result === 'miss') && p.odds)
    .slice()
    .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
  const myPendingFollowed = followedDetail.filter((p) => p.result === 'pending' && p.odds);

  let myRunningBalance = myBankPlan;
  const myHistory = myResolvedFollowed.map((p) => {
    const fraction = kellyFraction(p.confidence, p.odds, myMultiplier);
    const stake = fraction * myBankPlan;
    const units = p.result === 'hit' ? stake * (p.odds - 1) : -stake;
    myRunningBalance += units;
    return { ...p, stake, units, balance: myRunningBalance };
  });
  const myHits = myHistory.filter((h) => h.units > 0).length;
  const myEfectividad = myHistory.length ? Math.round((myHits / myHistory.length) * 100) : 0;
  const myTotalStake = myHistory.reduce((s, h) => s + h.stake, 0);
  const myTotalProfit = myHistory.reduce((s, h) => s + h.units, 0);
  const myRoi = myTotalStake > 0 ? Math.round((myTotalProfit / myTotalStake) * 1000) / 10 : 0;
  const myFinalBalance = myHistory.length ? myHistory[myHistory.length - 1].balance : myBankPlan;
  const mySeries = [myBankPlan, ...myHistory.map((h) => h.balance)];
  const myPendingStake = myPendingFollowed.reduce(
    (sum, p) => sum + kellyFraction(p.confidence, p.odds, myMultiplier) * myBankPlan,
    0
  );

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
        <link rel="canonical" href="https://camilorey-app.vercel.app/" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CAMILOREY" />
        <meta property="og:title" content="CAMILOREY · Picks Liga Pro Checa de tenis de mesa" />
        <meta property="og:description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <meta property="og:url" content="https://camilorey-app.vercel.app/" />
        <meta property="og:image" content="https://camilorey-app.vercel.app/icon-512x512.png" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="CAMILOREY · Picks Liga Pro Checa de tenis de mesa" />
        <meta name="twitter:description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <meta name="twitter:image" content="https://camilorey-app.vercel.app/icon-512x512.png" />
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
        {/* Aplica el tema guardado ANTES del primer render — si no,
            todo el mundo ve un parpadeo del tema oscuro por defecto
            durante una fracción de segundo antes de que React monte
            y el useEffect de arriba corrija a claro. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var pref=localStorage.getItem('${THEME_KEY}')||'sistema';
              var light=pref==='claro'||(pref==='sistema'&&window.matchMedia('(prefers-color-scheme: light)').matches);
              document.documentElement.setAttribute('data-theme', light?'light':'dark');
            }catch(e){}})();`
          }}
        />
      </Head>

      <TableDecor side="left" />
      <TableDecor side="right" />

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
          {navLink('mibankroll', 'Mi Bankroll')}
          {isAdmin ? navLink('bankroll', 'Bankroll') : null}
          {isAdmin ? navLink('grupos', 'Grupos') : null}
          {isAdmin ? navLink('modelo', 'Modelo') : null}
          {isAdmin ? navLink('errores', 'Errores') : null}
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
                else if (result === 'ios-needs-install')
                  alert(
                    'En iPhone/iPad, las notificaciones solo funcionan si agregas CAMILOREY a tu pantalla de inicio primero: toca Compartir (el cuadrito con la flecha) → "Agregar a pantalla de inicio", y abre la app desde ese ícono en vez de Safari.'
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
            <div className="user-chip" onClick={() => setShowProfileModal(true)} title="Perfil">
              {user.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.user_metadata.avatar_url} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="user-chip-fallback">{(user.email || '?')[0].toUpperCase()}</span>
              )}
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowLoginModal(true)}>
              <GoogleGIcon size={14} />
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
              <div className="label">Balance</div>
              <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
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
          <span className="eyebrow">🛡️ Planificación con Kelly</span>
          <h1 className="page-title">Bankroll</h1>

          <div className="tabs">
            <div className={`tab ${bankrollTab === 'slip' ? 'active' : ''}`} onClick={() => setBankrollTab('slip')}>
              📋 Slip
            </div>
            <div
              className={`tab ${bankrollTab === 'rendimiento' ? 'active' : ''}`}
              onClick={() => setBankrollTab('rendimiento')}
            >
              📈 Rendimiento
            </div>
          </div>

          {bankrollTab === 'slip' ? (
            (() => {
              const slipPicks = followedDetail.filter((p) => p.matchStatus !== 'done' && p.odds);
              const multiplier = RISK_LEVELS[riskLevel].multiplier;
              const rows = slipPicks.map((p) => ({
                ...p,
                fraction: kellyFraction(p.confidence, p.odds, multiplier)
              }));
              const asignado = rows.reduce((sum, r) => sum + r.fraction * bankPlan, 0);
              const potencial = rows.reduce((sum, r) => sum + r.fraction * bankPlan * (r.odds - 1), 0);
              const pctAsignado = bankPlan > 0 ? Math.min(100, Math.round((asignado / bankPlan) * 100)) : 0;

              return (
                <>
                  <div className="bankroll-card">
                    <div className="slip-label">TU BANKROLL</div>
                    <div className="slip-bank-row">
                      <span className="slip-bank-currency">$</span>
                      <input
                        type="number"
                        className="slip-bank-input"
                        value={bankPlan}
                        onChange={(e) => setBankPlan(Number(e.target.value) || 0)}
                      />
                      <span className="slip-bank-tag">COP</span>
                    </div>
                    <div className="slip-asignado-row">
                      <span>Asignado</span>
                      <span className="num">
                        {formatCOP(asignado)} ({pctAsignado}%)
                      </span>
                    </div>
                    <div className="ia-bar-track">
                      <div className="ia-bar-fill tier-alta" style={{ width: `${pctAsignado}%` }}></div>
                    </div>

                    <div className="slip-label" style={{ marginTop: 18 }}>
                      NIVEL DE RIESGO
                    </div>
                    <div className="risk-level-row">
                      {Object.entries(RISK_LEVELS).map(([key, rl]) => (
                        <div
                          key={key}
                          className={`risk-level-btn ${riskLevel === key ? 'active' : ''}`}
                          onClick={() => setRiskLevel(key)}
                        >
                          <div className="risk-level-label">{rl.label}</div>
                          <div className="risk-level-sub">{rl.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="tabs">
                    <div className={`tab ${slipMode === 'combinado' ? 'active' : ''}`} onClick={() => setSlipMode('combinado')}>
                      Combinado
                    </div>
                    <div className={`tab ${slipMode === 'individual' ? 'active' : ''}`} onClick={() => setSlipMode('individual')}>
                      Individual
                    </div>
                  </div>

                  <div className="stat-strip stat-strip-3">
                    <div className="stat-card">
                      <div className="label">Picks</div>
                      <div className="value num">{rows.length}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Asignación</div>
                      <div className="value num">{formatCOP(asignado)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Potencial</div>
                      <div className="value hit num">{formatCOP(potencial)}</div>
                    </div>
                  </div>

                  <div className="section-head">
                    <h2>Selecciones individuales</h2>
                    <span className="see-all">{rows.length} picks</span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="page-sub">Sigue algunos picks para ver sugerencias de planificación con Kelly aquí.</p>
                  ) : (
                    <table className="bk">
                      <thead>
                        <tr>
                          <th>Pick</th>
                          <th>Confianza</th>
                          <th>Cuota</th>
                          <th>Kelly</th>
                          <th>Sugerido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.player}</td>
                            <td className="num">{r.confidence}%</td>
                            <td className="num">{r.odds.toFixed(2)}</td>
                            <td className="num">{r.fraction > 0 ? `${(r.fraction * 100).toFixed(1)}%` : 'Sin ventaja'}</td>
                            <td className="num">{r.fraction > 0 ? formatCOP(r.fraction * bankPlan) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <p className="page-sub" style={{ marginTop: 14 }}>
                    "{slipMode === 'combinado' ? 'Combinado' : 'Individual'}" es solo cómo se agrupa la vista — el
                    banco de planeación no cambia el bankroll real, es una simulación tuya. El sistema sigue
                    apostando el monto fijo de siempre (ver Rendimiento).
                  </p>
                </>
              );
            })()
          ) : (
            <>
              <div className="balance-hero">
                <div className="balance-hero-label">Balance actual</div>
                <div className={`balance-hero-value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
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
                  <div className="label">Balance</div>
                  <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
                </div>
              </div>

              <div className="bankroll-card">
                <strong>Evolución</strong>
                <LineChart series={bankrollSeries} />
              </div>

              <div className="bankroll-card">
                <strong>¿Cómo se mide?</strong>
                <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6' }}>
                  Cada pick arriesga entre $100.000 y $250.000 según la confianza del modelo (ver lib/staking.js). El
                  pago sí usa la cuota real de Rushbet cuando logramos cruzar el partido en su feed; si no la
                  encontramos, se calcula 1:1. Ajusta siempre el tamaño de tus apuestas a lo que puedas permitirte
                  perder. El banco arrancó en $2.000.000.
                </p>
              </div>

              <div className="bankroll-card">
                <table className="bk">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Pick</th>
                      <th>Monto</th>
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
            </>
          )}
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

        {isAdmin && (
        <section className={`view ${view === 'modelo' ? 'active' : ''}`}>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Modelo</h1>
          <p className="page-sub">¿La confianza que calculamos de verdad predice mejor que una moneda al aire?</p>
          {modelStatsError ? (
            <p className="page-sub">Error: {modelStatsError}</p>
          ) : !modelStats ? (
            <p className="page-sub">Cargando…</p>
          ) : modelStats.n === 0 ? (
            <p className="page-sub">Todavía no hay picks resueltos.</p>
          ) : (
            <ModelStatsView stats={modelStats} />
          )}
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'errores' ? 'active' : ''}`}>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Errores</h1>
          <p className="page-sub">Últimos 50 errores de la app (no de los cronjobs — esos avisan por su cuenta).</p>
          {errorLogError ? (
            <p className="page-sub">Error: {errorLogError}</p>
          ) : !errorLog ? (
            <p className="page-sub">Cargando…</p>
          ) : errorLog.length === 0 ? (
            <p className="page-sub">Sin errores registrados. 🎉</p>
          ) : (
            <div className="stat-rows" style={{ gap: 0 }}>
              {errorLog.map((e) => (
                <div className="error-row" key={e.id}>
                  <div className="error-row-top">
                    <span className="error-row-source">{e.source}</span>
                    <span className="error-row-date">
                      {new Intl.DateTimeFormat('es-CO', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Bogota'
                      }).format(new Date(e.created_at))}
                    </span>
                  </div>
                  <div className="error-row-message">{e.message}</div>
                  {e.context ? <div className="error-row-context">{JSON.stringify(e.context)}</div> : null}
                </div>
              ))}
            </div>
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

        <section className={`view ${view === 'mibankroll' ? 'active' : ''}`}>
          <span className="eyebrow">Simulador personal</span>
          <h1 className="page-title">Mi Bankroll</h1>
          <p className="page-sub">
            Cómo te habría ido apostando con Kelly solo en los picks que sigues — no es dinero real, es para que
            practiques el tamaño de apuesta antes de arriesgar el tuyo.
          </p>
          {!user ? (
            <p className="page-sub">Inicia sesión con Google (arriba a la derecha) para armar tu bankroll.</p>
          ) : !myBankLoaded ? (
            <p className="page-sub">Cargando…</p>
          ) : (
            <>
              <div className="bankroll-card">
                <div className="slip-label">TU BANCO INICIAL</div>
                <div className="slip-bank-row">
                  <span className="slip-bank-currency">$</span>
                  <input
                    type="number"
                    className="slip-bank-input"
                    value={myBankPlan}
                    onChange={(e) => setMyBankPlan(Number(e.target.value) || 0)}
                    onBlur={() => saveMyBankSettings({ starting_bank: myBankPlan })}
                  />
                  <span className="slip-bank-tag">COP</span>
                </div>

                <div className="slip-label" style={{ marginTop: 18 }}>
                  NIVEL DE RIESGO
                </div>
                <div className="risk-level-row">
                  {Object.entries(RISK_LEVELS).map(([key, rl]) => (
                    <div
                      key={key}
                      className={`risk-level-btn ${myRiskLevel === key ? 'active' : ''}`}
                      onClick={() => {
                        setMyRiskLevel(key);
                        saveMyBankSettings({ risk_level: key });
                      }}
                    >
                      <div className="risk-level-label">{rl.label}</div>
                      <div className="risk-level-sub">{rl.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {myHistory.length === 0 ? (
                <p className="page-sub">
                  Todavía no tienes picks seguidos que ya se hayan jugado — sigue algunos desde Picks o Calendario y
                  vuelve cuando terminen.
                </p>
              ) : (
                <>
                  <div className="balance-hero">
                    <div className="balance-hero-label">Balance simulado</div>
                    <div className={`balance-hero-value num ${myFinalBalance >= myBankPlan ? 'hit' : 'miss'}`}>
                      {formatCOP(myFinalBalance)}
                    </div>
                  </div>

                  <div className="stat-strip stat-strip-3">
                    <div className="stat-card">
                      <div className="label">ROI</div>
                      <div className={`value num ${myRoi >= 0 ? 'hit' : 'miss'}`}>
                        {myRoi >= 0 ? '+' : ''}
                        {myRoi}%
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Efectividad</div>
                      <div className="value hit num">{myEfectividad}%</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Picks jugados</div>
                      <div className="value num">{myHistory.length}</div>
                    </div>
                  </div>

                  <div className="bankroll-card">
                    <strong>Evolución</strong>
                    <LineChart series={mySeries} />
                  </div>

                  {myPendingFollowed.length > 0 ? (
                    <div className="bankroll-card">
                      <strong>Picks seguidos por jugarse</strong>
                      <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6', margin: '6px 0 0' }}>
                        {myPendingFollowed.length} pick{myPendingFollowed.length === 1 ? '' : 's'} pendiente
                        {myPendingFollowed.length === 1 ? '' : 's'} — si aciertas todos, arriesgarías en total{' '}
                        <strong className="num">{formatCOP(myPendingStake)}</strong> de tu banco.
                      </p>
                    </div>
                  ) : null}

                  <div className="bankroll-card">
                    <table className="bk">
                      <thead>
                        <tr>
                          <th>Pick</th>
                          <th>Monto</th>
                          <th>Resultado</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myHistory
                          .slice()
                          .reverse()
                          .map((h) => (
                            <tr key={h.id}>
                              <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{h.market}</td>
                              <td className={h.stake === 0 ? '' : h.units >= 0 ? 'hit' : 'miss'} style={h.stake === 0 ? { color: 'var(--muted)' } : undefined}>
                                {formatCOP(h.units, true)}
                              </td>
                              <td
                                className={h.stake === 0 ? '' : h.units >= 0 ? 'hit' : 'miss'}
                                style={h.stake === 0 ? { color: 'var(--muted)' } : undefined}
                              >
                                {h.stake === 0 ? 'Sin ventaja — Kelly no apostó' : h.units >= 0 ? 'Acierto' : 'Fallo'}
                              </td>
                              <td>{formatCOP(h.balance)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="site">
        <strong>CAMILOREY</strong> ofrece análisis y opiniones propias con fines informativos y de entretenimiento
        sobre la Liga Pro Checa de tenis de mesa. No garantizamos resultados y no gestionamos apuestas ni fondos de
        terceros. Servicio dirigido exclusivamente a mayores de 18 años. Si sientes que el juego deja de ser un
        entretenimiento, busca ayuda profesional. Juega siempre con responsabilidad.
        <div style={{ marginTop: '10px' }}>
          <a href="/privacidad">Política de Privacidad</a>
        </div>
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
        <a href="#mibankroll" className={view === 'mibankroll' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="6" width="18" height="13" rx="2" />
            <path d="M3 10h18M8 15h1" />
          </svg>
          Mi Bankroll
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
        {isAdmin ? (
          <a href="#modelo" className={view === 'modelo' ? 'active' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M7 14l4-5 4 3 5-7" />
            </svg>
            Modelo
          </a>
        ) : null}
        {isAdmin ? (
          <a href="#errores" className={view === 'errores' ? 'active' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            Errores
          </a>
        ) : null}
      </nav>

      {modalPick && <PickDetailModal pick={modalPick} onClose={() => setModalPick(null)} />}

      {modalMatch && <MatchDetailModal m={modalMatch} onClose={() => setModalMatch(null)} user={user} />}

      {showRiskModal && (
        <RiskModal count={followedPickIds.size} tips={riskTips} onClose={() => setShowRiskModal(false)} />
      )}

      {showProfileModal && user && (
        <ProfileModal
          user={user}
          isAdmin={isAdmin}
          onClose={() => setShowProfileModal(false)}
          onLogout={logout}
          themePref={themePref}
          onChangeTheme={changeTheme}
        />
      )}

      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} onLogin={loginWithGoogle} />
      )}
    </>
  );
}

const CSS = `
  :root{
    --bg:#0E0D0C;
    --bg-rgb:14,13,12;
    --bg-alt:#171513;
    --card:#1B1917;
    --ink:#F5F1EC;
    --muted:#948C83;
    --line:#2B2724;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#2E1817;
    --court-soft-text:#FAC7C7;
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
    --decor-ball:#D4A24C;
  }
  /* Tema claro — mismos nombres de variable, el resto del CSS ya las
     usa en todos lados, así que basta con redefinirlas acá para que
     todo el sitio cambie de color sin tocar cada componente. Se activa
     poniendo data-theme="light" en <html> (ver applyTheme en el JS). */
  :root[data-theme="light"]{
    --bg:#FDFBFA;
    --bg-rgb:253,251,250;
    --bg-alt:#F5EFEC;
    --card:#FFFFFF;
    --ink:#1E1815;
    --muted:#8A7F78;
    --line:#E9E0DB;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#FBE2E2;
    --court-soft-text:#A32D2D;
    --ball:#E85E2C;
    --ball-dark:#B8481F;
    --hit:#1E9C74;
    --miss:#C23A3A;
    --blue:#2E6CA8;
    --blue-dark:#1E4A73;
    --shadow:0 2px 12px rgba(20,15,12,0.08), 0 1px 2px rgba(20,15,12,0.06);
    --decor-ball:#B8860B;
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
    background:rgba(var(--bg-rgb),0.88);
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
    color:var(--court-soft-text); background:var(--court-soft);
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

  /* Decoración de mesa + pelota — SOLO en desktop ancho (1400px+),
     donde sobra espacio vacío a los lados del contenido (980px
     máximo). display:none por defecto cubre mobile/tablet/laptops
     angostas sin depender de que el navegador soporte bien la media
     query — si algo falla, el default seguro es "oculto". */
  .table-decor{
    display:none; position:fixed; top:50%; transform:translateY(-50%);
    width:200px; height:500px; z-index:1; pointer-events:none;
  }
  .table-decor-left{left:0;}
  .table-decor-right{right:0; transform:translateY(-50%) scaleX(-1);}
  @media (min-width:1400px){
    .table-decor{display:block;}
  }
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

  .slip-label{font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px;}
  .slip-bank-row{display:flex; align-items:baseline; gap:6px; margin-bottom:12px;}
  .slip-bank-currency{font-family:var(--font-display); font-weight:800; font-size:28px; color:var(--ink);}
  .slip-bank-input{
    flex:1; min-width:0; font-family:var(--font-display); font-weight:800; font-size:28px; color:var(--ink);
    background:none; border:none; border-bottom:2px solid var(--line); padding:2px 0; outline:none;
  }
  .slip-bank-input:focus{border-color:var(--court);}
  .slip-bank-tag{font-family:var(--font-mono); font-size:11px; color:var(--muted); background:var(--bg-alt); border-radius:999px; padding:3px 9px; flex:none;}
  .slip-asignado-row{display:flex; justify-content:space-between; font-size:13px; color:var(--muted); margin-bottom:6px;}
  .risk-level-row{display:grid; grid-template-columns:repeat(3,1fr); gap:8px;}
  .risk-level-btn{
    background:var(--bg-alt); border:1px solid var(--line); border-radius:12px; padding:10px 6px;
    text-align:center; cursor:pointer;
  }
  .risk-level-btn.active{background:var(--court); border-color:var(--court);}
  .risk-level-label{font-size:12.5px; font-weight:700; color:var(--ink);}
  .risk-level-sub{font-size:10.5px; color:var(--muted); margin-top:2px;}
  .risk-level-btn.active .risk-level-sub{color:rgba(255,255,255,.85);}

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
  .status.soon{background:var(--court-soft); color:var(--court-soft-text);}
  .status.done{background:var(--bg-alt); color:var(--muted);}

  .mc-live-score{
    display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;
    margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  }
  .mc-set{
    background:var(--bg-alt); border-radius:8px; padding:5px 10px; font-size:13px; font-weight:700; color:var(--ink);
  }
  .mc-set-current{background:var(--court-soft); color:var(--court-soft-text); border:1px solid rgba(226,68,74,.45);}
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
    padding:22px 22px 26px; max-height:88vh; overflow-y:auto; position:relative;
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

  .risk-modal-head{display:flex; align-items:center; gap:14px; margin-bottom:18px;}
  .risk-modal-icon{
    width:44px; height:44px; border-radius:12px; flex:none; font-size:20px;
    display:flex; align-items:center; justify-content:center;
    background:var(--court-soft); border:1px solid rgba(226,68,74,.4);
  }
  .risk-modal-eyebrow{font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--court); margin-bottom:2px;}
  .risk-tip{display:flex; gap:12px; padding:14px 0; border-top:1px solid var(--line);}
  .risk-tip-icon{font-size:20px; flex:none; width:30px; text-align:center;}
  .risk-tip strong{display:block; font-size:14px; margin-bottom:3px;}
  .risk-tip p{margin:0; font-size:13px; color:var(--muted); line-height:1.5;}
  .risk-modal-btn{width:100%; justify-content:center; margin-top:16px; padding:13px;}
  .risk-modal-disclaimer{font-size:11px; color:var(--muted); text-align:center; margin:10px 0 0;}

  .profile-row{display:flex; align-items:center; gap:12px; padding:14px 0; border-top:1px solid var(--line); cursor:pointer;}
  .profile-row-icon{font-size:20px; flex:none; width:30px; text-align:center;}
  .profile-row-body{flex:1; min-width:0;}
  .profile-row-body strong{display:block; font-size:14px; margin-bottom:2px;}
  .profile-row-body p{margin:0; font-size:12.5px; color:var(--muted); line-height:1.4;}
  .profile-row-theme{cursor:default;}
  .theme-switch{display:flex; gap:6px; margin-top:10px;}
  .theme-switch-btn{
    flex:1; font-family:var(--font-body); font-size:11.5px; font-weight:700; color:var(--muted);
    background:var(--bg-alt); border:1px solid var(--line); border-radius:8px; padding:8px 4px; cursor:pointer;
  }
  .theme-switch-btn.active{background:var(--court); border-color:var(--court); color:#fff;}

  .login-modal{text-align:center; padding-top:36px;}
  .login-modal-close{position:absolute; top:16px; right:16px;}
  .login-modal-icon{
    width:64px; height:64px; margin:0 auto 18px; border-radius:50%; font-size:26px;
    display:flex; align-items:center; justify-content:center;
    background:var(--court-soft); border:1px solid rgba(226,68,74,.4);
  }
  .login-modal-title{font-family:var(--font-display); font-size:24px; margin:0 0 8px;}
  .login-modal-sub{color:var(--muted); font-size:14px; margin:0 0 24px;}
  .login-modal-sub strong{color:var(--ink);}
  .google-btn{
    width:100%; display:flex; align-items:center; justify-content:center; gap:12px;
    background:var(--bg-alt); border:1px solid var(--line); border-radius:12px;
    padding:14px; font-family:var(--font-body); font-weight:700; font-size:14.5px; color:var(--ink);
    cursor:pointer;
  }
  .google-btn:hover{border-color:var(--court);}
  .login-modal-note{
    display:flex; align-items:center; justify-content:center; gap:8px; margin-top:20px;
    font-size:12px; color:var(--muted); text-align:left;
  }
  .modal-market{
    display:inline-block; margin:12px 0; font-weight:700; font-size:14px;
    background:var(--court-soft); color:var(--court-soft-text); padding:8px 14px; border-radius:10px;
  }
  .hist-title{font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:18px 0 8px; display:flex; justify-content:space-between;}
  .chart{display:flex; align-items:flex-end; gap:5px; height:90px; border-bottom:1px dashed var(--line); position:relative; margin-bottom:6px;}
  .bar{flex:1; border-radius:4px 4px 0 0; min-height:6px;}
  .bar.hit{background:var(--hit);}
  .bar.miss{background:var(--miss);}
  .form-list{display:flex; flex-direction:column;}
  .form-list-row{display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--line);}
  .form-list-row:last-child{border-bottom:none;}
  .form-list-meta{display:flex; flex-direction:column; align-items:flex-start; gap:1px; width:56px; flex:none;}
  .form-list-date{font-family:var(--font-mono); font-size:10.5px; color:var(--muted);}
  .form-list-ft{font-family:var(--font-mono); font-size:9.5px; color:var(--muted); text-transform:uppercase;}
  .form-list-opp{flex:1; min-width:0; font-size:13px; font-weight:600; display:flex; justify-content:space-between; align-items:center; gap:8px;}
  .form-list-score{color:var(--muted); font-weight:700;}
  .form-list-badge{
    width:22px; height:22px; border-radius:50%; flex:none; font-size:11px; font-weight:800;
    display:flex; align-items:center; justify-content:center;
  }
  .form-list-badge.win{background:rgba(93,202,165,.16); color:var(--hit);}
  .form-list-badge.loss{background:rgba(240,149,149,.16); color:var(--miss);}
  .legend{display:flex; gap:14px; font-size:11.5px; color:var(--muted); margin-bottom:16px;}
  .legend span{display:inline-flex; align-items:center; gap:5px;}
  .legend .sw{width:8px; height:8px; border-radius:50%;}
  .analysis{font-size:13.5px; line-height:1.55; color:var(--ink); background:var(--bg-alt); border-radius:12px; padding:14px; margin-top:6px; border:1px solid var(--line);}

  .match-hero{display:flex; align-items:flex-start; justify-content:space-between; gap:6px; margin:4px 0 16px;}
  .match-hero-side{display:flex; flex-direction:column; align-items:center; gap:8px; flex:1; min-width:0;}
  .match-hero-avatar{width:56px; height:56px; font-size:16px;}
  .match-hero-name{
    font-size:12.5px; font-weight:700; text-align:center; display:flex; align-items:center; gap:4px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;
  }
  .match-hero-center{display:flex; flex-direction:column; align-items:center; gap:6px; flex:none; padding-top:8px;}
  .match-hero-score{font-family:var(--font-display); font-size:26px; font-weight:800; color:var(--ink); line-height:1;}
  .match-hero-vs{font-family:var(--font-mono); font-size:14px; font-weight:800; color:var(--muted);}
  .match-hero-meta{font-size:10.5px; color:var(--muted); text-align:center; white-space:nowrap;}
  .match-hero-pill{
    font-size:10.5px; font-weight:800; padding:4px 12px; border-radius:999px;
    text-transform:uppercase; letter-spacing:.4px; text-align:center;
  }
  .match-hero-pill.win{background:rgba(93,202,165,.16); color:var(--hit);}
  .match-hero-pill.loss{background:rgba(240,149,149,.16); color:var(--miss);}
  .match-hero-pill.pending{
    background:var(--court-soft); color:var(--court-soft-text); text-transform:none; font-weight:700; max-width:150px;
    white-space:normal; line-height:1.3;
  }

  .stat-rows{display:flex; flex-direction:column; gap:14px; background:var(--bg-alt); border:1px solid var(--line); border-radius:12px; padding:14px 16px;}
  .stat-row-top{display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px;}
  .stat-row-label{color:var(--muted); font-weight:600;}
  .stat-row-value{color:var(--ink); font-weight:800; font-size:14px;}
  .stat-row-bar{height:6px; border-radius:999px; background:var(--line); overflow:hidden; margin-top:6px;}
  .stat-row-bar-fill{height:100%; border-radius:999px; background:var(--court);}

  .model-verdict{
    font-weight:700; font-size:14px; padding:12px 16px; border-radius:12px; margin:4px 0 22px;
  }
  .model-verdict-better{background:rgba(93,202,165,.14); color:var(--hit);}
  .model-verdict-worse{background:rgba(240,149,149,.14); color:var(--miss);}
  .model-verdict-unknown{background:var(--bg-alt); color:var(--muted); border:1px solid var(--line);}

  .error-row{padding:12px 0; border-bottom:1px solid var(--line);}
  .error-row:last-child{border-bottom:none;}
  .error-row-top{display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:4px;}
  .error-row-source{
    font-family:var(--font-mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.4px;
    color:var(--miss); font-weight:700;
  }
  .error-row-date{font-family:var(--font-mono); font-size:11px; color:var(--muted); flex:none;}
  .error-row-message{font-size:13.5px; color:var(--ink); line-height:1.4;}
  .error-row-context{font-family:var(--font-mono); font-size:11px; color:var(--muted); margin-top:4px; word-break:break-all;}

  footer.site{
    max-width:980px; margin:0 auto; padding:20px 20px 40px; color:var(--muted); font-size:12px; line-height:1.6;
  }
  footer.site strong{color:var(--ink);}
  footer.site a{color:var(--court); text-decoration:none;}

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

// ============================================================
// CAMILOREY — marcador set por set de partidos ya terminados
// (Sofascore, API pública sin login)
//
// Ni Rushbet (borra el partido de su tablero en vivo en cuanto
// termina) ni tt.league-pro.com (su campo period_scores siempre
// viene null) guardan el detalle punto a punto después de que el
// partido ya pasó. Sofascore sí lo conserva — confirmamos que cubre
// esta misma liga ("Czech Liga Pro", id 19039) cruzando jugadores
// que ya conocíamos de tt.league-pro.com y Rushbet (ej. "Stolfa J.").
// ============================================================

const TOURNAMENT_ID = 19039;

function stripAccents(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Nuestro formato: "Apellido I" (short_name_en de tt.league-pro.com).
function ourNameSignature(name) {
  const parts = stripAccents(name).toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return `${parts[0]}|${(parts[1] || '')[0] || ''}`;
}

// Sofascore normalmente trae "Apellido I." (con punto), pero a veces
// "Nombre Apellido" completo para jugadores sin abreviación cargada.
// Si la última palabra es de una sola letra, es la inicial y la
// primera palabra es el apellido; si no, asumimos "Nombre Apellido".
function sofaNameSignature(name) {
  const parts = stripAccents(name).toLowerCase().replace(/\./g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return `${parts[0]}|`;
  const last = parts[parts.length - 1];
  if (last.length === 1) return `${parts[0]}|${last}`;
  return `${last}|${parts[0][0]}`;
}

// Sofascore bloquea con 403 los user-agents genéricos/de bot — hay
// que parecerse a un navegador real.
const SOFASCORE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.sofascore.com/'
};

async function fetchRecentFinishedEvents() {
  const seasonsRes = await fetch(`https://api.sofascore.com/api/v1/unique-tournament/${TOURNAMENT_ID}/seasons`, {
    headers: SOFASCORE_HEADERS
  });
  if (!seasonsRes.ok) throw new Error(`Fetch failed sofascore seasons: ${seasonsRes.status}`);
  const seasons = await seasonsRes.json();
  const seasonId = seasons.seasons?.[0]?.id;
  if (!seasonId) return [];

  const events = [];
  for (const page of [0, 1]) {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/unique-tournament/${TOURNAMENT_ID}/season/${seasonId}/events/last/${page}`,
      { headers: SOFASCORE_HEADERS }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!data.events || data.events.length === 0) break;
    events.push(...data.events);
    if (!data.hasNextPage) break;
  }
  return events;
}

// Devuelve [{a, b}, ...] (uno por set jugado, ya orientado a nuestros
// jugadores A/B) o null si no encontramos el partido.
function findSetScores(events, playerAName, playerBName) {
  const sigA = ourNameSignature(playerAName);
  const sigB = ourNameSignature(playerBName);

  for (const e of events) {
    if (e.status?.type !== 'finished') continue;
    const homeSig = sofaNameSignature(e.homeTeam?.name);
    const awaySig = sofaNameSignature(e.awayTeam?.name);

    let swapped = null;
    if (homeSig === sigA && awaySig === sigB) swapped = false;
    else if (homeSig === sigB && awaySig === sigA) swapped = true;
    if (swapped === null) continue;

    const home = e.homeScore || {};
    const away = e.awayScore || {};
    const sets = [];
    for (let i = 1; i <= 7; i++) {
      const h = home[`period${i}`];
      const aw = away[`period${i}`];
      if (h == null && aw == null) continue;
      sets.push(swapped ? { a: aw ?? 0, b: h ?? 0 } : { a: h ?? 0, b: aw ?? 0 });
    }
    if (sets.length > 0) return sets;
  }
  return null;
}

module.exports = { fetchRecentFinishedEvents, findSetScores };

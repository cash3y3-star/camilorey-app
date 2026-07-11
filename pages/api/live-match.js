// ============================================================
// CAMILOREY — marcador en vivo
// El navegador llama esto cada ~8 segundos mientras hay un partido
// en vivo en pantalla. No toca Supabase — lee directo de la fuente,
// para no depender del ciclo de 30 min del sync (esto es lo único en
// todo el proyecto que necesita de verdad tiempo real).
//
// Fuente principal: el feed en vivo de Rushbet/Kambi — trae reloj y
// marcador set por set, se actualiza mucho más rápido que
// tt.league-pro.com porque es lo que usan ellos mismos para fijar
// las cuotas en vivo.
// Respaldo: tt.league-pro.com directo, por si Rushbet no tiene ese
// partido específico en su tablero en vivo — menos detallado (solo
// sets ganados, no marcador punto a punto), pero siempre funciona
// para cualquier partido que estemos trackeando.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { fetchLiveTableTennis, findLiveEvent } from '../../lib/rushbet';
import { fetchNuxtData } from '../../lib/tt';

// Guarda el marcador set por set que ya tenemos en este momento, para
// que sobreviva después de que el partido termine y desaparezca del
// tablero en vivo de Rushbet. Best-effort: si falla, no rompe la
// respuesta al navegador — el marcador en vivo sigue funcionando.
async function persistSetScores(matchId, sets) {
  if (!matchId || !sets || sets.length === 0) return;
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from('matches').update({ set_scores: sets }).eq('source_id', matchId);
  } catch (e) {
    console.error('No se pudo guardar set_scores:', e.message);
  }
}

export default async function handler(req, res) {
  const { playerA, playerB, tournamentId, matchId } = req.query;

  res.setHeader('Cache-Control', 'no-store');

  if (playerA && playerB) {
    try {
      const liveEvents = await fetchLiveTableTennis();
      const found = findLiveEvent(liveEvents, playerA, playerB);
      if (found) {
        const { event, swapped } = found;
        const rawSets = event.liveData?.statistics?.sets;
        const sets = rawSets
          ? rawSets.home
              .map((h, i) => ({ a: h, b: rawSets.away[i] }))
              .filter((s) => s.a !== -1 || s.b !== -1)
              .map((s) => (swapped ? { a: s.b, b: s.a } : s))
          : [];
        const scoreHome = Number(event.liveData?.score?.home ?? 0);
        const scoreAway = Number(event.liveData?.score?.away ?? 0);

        if (matchId) await persistSetScores(matchId, sets);

        return res.status(200).json({
          source: 'kambi',
          status: event.event?.state === 'STARTED' ? 'live' : 'finished',
          current: swapped ? { a: scoreAway, b: scoreHome } : { a: scoreHome, b: scoreAway },
          sets,
          clock: event.liveData?.matchClock || null
        });
      }
    } catch (e) {
      console.error('Rushbet en vivo falló, usando respaldo:', e.message);
    }
  }

  if (tournamentId && matchId) {
    try {
      const detail = await fetchNuxtData(`/en/tournaments/${tournamentId}`);
      const matches = detail['tournament-page']?.pageData?.widgets?.matches || [];
      const match = matches.find((m) => String(m.id) === String(matchId));
      if (match) {
        return res.status(200).json({
          source: 'tt',
          status: match.status === 3 ? 'finished' : match.status === 2 ? 'live' : 'scheduled',
          current: null,
          sets: [],
          scoreOne: match.status >= 2 ? match.results?.score_one ?? null : null,
          scoreTwo: match.status >= 2 ? match.results?.score_two ?? null : null
        });
      }
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'No se encontró el partido en ninguna fuente' });
}

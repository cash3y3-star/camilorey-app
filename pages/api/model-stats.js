// ============================================================
// CAMILOREY — estadísticas del modelo de confianza (solo admin)
// Mismo análisis que scripts/analyze-confidence.js / el debug
// confidence-stats.js, pero servido detrás de la pestaña "Modelo"
// del sitio (verificando el JWT del admin) en vez de un token de
// query — así no hace falta pedirlo a mano cada vez.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function wilsonInterval(hits, n) {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede ver esto' });
  }

  // Picks pendientes (todavía no jugados) — para poder revisar ANTES
  // de que se jueguen cuáles quedaron publicados con el piso de
  // confianza nuevo, no solo verlos después de que ya se resolvieron.
  // Se traen TODOS (publicados y descartados) y se separan acá: los
  // descartados (confianza < piso) nunca se muestran en público, pero
  // acá sí, en su propia lista, para que el admin vea que el modelo SÍ
  // los evaluó.
  const { data: pendingPicks, error: pendingErr } = await supabase
    .from('picks')
    .select('id, confidence, odds, market, match_id, published')
    .eq('result', 'pending')
    .order('confidence', { ascending: false });
  if (pendingErr) return res.status(500).json({ error: pendingErr.message });

  const pendingMatchIds = [...new Set((pendingPicks || []).map((p) => p.match_id))];
  const { data: pendingMatches } = pendingMatchIds.length
    ? await supabase.from('matches').select('id, scheduled_at').in('id', pendingMatchIds)
    : { data: [] };
  const pendingMatchById = new Map((pendingMatches || []).map((m) => [m.id, m]));

  const mapPending = (p) => ({
    id: p.id,
    market: p.market,
    confidence: p.confidence,
    odds: p.odds ? Number(p.odds) : null,
    scheduledAt: pendingMatchById.get(p.match_id)?.scheduled_at || null
  });
  const byScheduledAt = (a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0);
  const pending = (pendingPicks || [])
    .filter((p) => p.published !== false)
    .map(mapPending)
    .sort(byScheduledAt);
  const discardedPending = (pendingPicks || [])
    .filter((p) => p.published === false)
    .map(mapPending)
    .sort(byScheduledAt);

  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, confidence, factors, predicted_winner_id, result, match_id, created_at, market, published')
    .in('result', ['hit', 'miss'])
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!picks || picks.length === 0) return res.status(200).json({ n: 0, pending, discardedPending, discardedResolved: [] });

  const matchIds = [...new Set(picks.map((p) => p.match_id))];
  const { data: matches } = await supabase.from('matches').select('id, player_a_id, scheduled_at').in('id', matchIds);
  const matchById = new Map((matches || []).map((m) => [m.id, m]));

  // Resueltos DESCARTADOS (confianza < piso, ya jugados) — lista
  // aparte, simple, sin entrar en las estadísticas/buckets de abajo
  // (esos siguen midiendo solo el track record publicado real).
  const discardedResolved = picks
    .filter((p) => p.published === false)
    .map((p) => ({
      id: p.id,
      win: p.result === 'hit',
      market: p.market,
      confidence: p.confidence,
      scheduledAt: matchById.get(p.match_id)?.scheduled_at || null
    }))
    .sort((a, b) => new Date(b.scheduledAt || 0) - new Date(a.scheduledAt || 0))
    .slice(0, 20);

  const rows = picks
    .filter((p) => p.published !== false)
    .map((p) => {
      const match = matchById.get(p.match_id);
      if (!match || !p.factors) return null;
      const sign = p.predicted_winner_id === match.player_a_id ? 1 : -1;
      return {
        id: p.id,
        hit: p.result === 'hit',
        confidence: p.confidence,
        createdAt: p.created_at,
        scheduledAt: match.scheduled_at,
        market: p.market,
        ratingScore: (p.factors.ratingScore ?? 0) * sign,
        streakScore: (p.factors.streakScore ?? 0) * sign,
        h2hScore: (p.factors.h2hScore ?? 0) * sign,
        altScore: (p.factors.altScore ?? 0) * sign
      };
    })
    .filter(Boolean);

  const n = rows.length;
  const hits = rows.filter((r) => r.hit).length;
  const [lo, hi] = wilsonInterval(hits, n);

  const buckets = [
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 92]
  ].map(([lo_, hi_]) => {
    const inBucket = rows.filter((r) => r.confidence >= lo_ && r.confidence <= hi_);
    const bHits = inBucket.filter((r) => r.hit).length;
    return { range: `${lo_}-${hi_}`, n: inBucket.length, hitRate: inBucket.length ? bHits / inBucket.length : null };
  });

  const factorAvg = {};
  for (const key of ['ratingScore', 'streakScore', 'h2hScore', 'altScore']) {
    const withHit = rows.filter((r) => r.hit).map((r) => r[key]);
    const withMiss = rows.filter((r) => !r.hit).map((r) => r[key]);
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    factorAvg[key] = { avgOnHit: avg(withHit), avgOnMiss: avg(withMiss) };
  }

  // Últimos 20 resueltos, más reciente primero (mismo orden que el
  // resto del sitio usa para "forma reciente").
  const recent = rows
    .slice(-20)
    .reverse()
    .map((r) => ({
      id: r.id,
      win: r.hit,
      date: r.createdAt,
      scheduledAt: r.scheduledAt,
      confidence: r.confidence,
      market: r.market
    }));

  return res.status(200).json({
    n,
    hits,
    misses: n - hits,
    hitRate: n > 0 ? hits / n : null,
    wilson95: [lo, hi],
    buckets,
    factorAvg,
    recentSequence: recent,
    pending,
    discardedPending,
    discardedResolved
  });
}

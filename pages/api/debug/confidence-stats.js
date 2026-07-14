// ============================================================
// CAMILOREY — mismo análisis que scripts/analyze-confidence.js, pero
// como endpoint de solo lectura para poder revisarlo sin disparar un
// workflow de GitHub Actions cada vez. Protegido con el mismo
// CRON_SECRET que ya existe para el vigilante de notificaciones.
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
  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, confidence, factors, predicted_winner_id, result, match_id, created_at')
    .in('result', ['hit', 'miss'])
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  if (!picks || picks.length === 0) return res.status(200).json({ message: 'Todavía no hay picks resueltos.' });

  const matchIds = [...new Set(picks.map((p) => p.match_id))];
  const { data: matches } = await supabase.from('matches').select('id, player_a_id').in('id', matchIds);
  const matchById = new Map((matches || []).map((m) => [m.id, m]));

  const rows = picks
    .map((p) => {
      const match = matchById.get(p.match_id);
      if (!match || !p.factors) return null;
      const sign = p.predicted_winner_id === match.player_a_id ? 1 : -1;
      return {
        hit: p.result === 'hit',
        confidence: p.confidence,
        createdAt: p.created_at,
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

  // Últimos 20 resueltos en orden cronológico, para ver rachas reales
  // (no solo el promedio general).
  const recent = rows.slice(-20).map((r) => ({ hit: r.hit, confidence: r.confidence, createdAt: r.createdAt }));

  return res.status(200).json({
    n,
    hits,
    misses: n - hits,
    hitRate: hits / n,
    wilson95: [lo, hi],
    buckets,
    factorAvg,
    recentSequence: recent
  });
}

// ============================================================
// CAMILOREY — historial de todo lo que salió alguna vez en "Picks VIP"
// (solo admin). Un pick es "exclusivo"/VIP si confidence >= 85 y
// odds >= 1.60 — mismo criterio que isExclusivePick en
// pages/index.js y pages/api/refresh-data.js, calculado siempre
// igual a partir de confidence/odds (no hay columna aparte).
// ============================================================

import { createClient } from '@supabase/supabase-js';

const EXCLUSIVE_MIN_CONFIDENCE = 85;
const EXCLUSIVE_MIN_ODDS = 1.6;

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

  const { data: picks, error } = await supabase
    .from('picks')
    .select('id, market, confidence, odds, result, created_at')
    .gte('confidence', EXCLUSIVE_MIN_CONFIDENCE)
    .gte('odds', EXCLUSIVE_MIN_ODDS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  const resolved = (picks || []).filter((p) => p.result === 'hit' || p.result === 'miss');
  const hits = resolved.filter((p) => p.result === 'hit').length;

  return res.status(200).json({
    n: resolved.length,
    hits,
    misses: resolved.length - hits,
    hitRate: resolved.length ? hits / resolved.length : null,
    picks: picks || []
  });
}

// ============================================================
// CAMILOREY — balance de los picks EXCLUSIVOS (solo premium/admin)
// Un pick es "exclusivo" si confidence >= 85 (tier alta) y odds >= 1.60
// — mismo criterio que isExclusivePick en pages/index.js y
// pages/api/refresh-data.js. bankroll_log.balance es el acumulado
// GENERAL (todos los picks juntos), así que acá no lo reusamos: se
// recalcula un balance aparte, solo con las filas de bankroll_log
// cuyo pick es exclusivo, en orden cronológico desde 0.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const EXCLUSIVE_MIN_CONFIDENCE = 85;
const EXCLUSIVE_MIN_ODDS = 1.6;
function isExclusivePick(confidence, odds) {
  return confidence >= EXCLUSIVE_MIN_CONFIDENCE && Boolean(odds) && Number(odds) >= EXCLUSIVE_MIN_ODDS;
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
  if (authError || !user) return res.status(401).json({ error: 'sesión inválida' });

  const isAdmin = user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (!isAdmin) {
    const { data: profile } = await supabase.from('profiles').select('premium_until').eq('id', user.id).maybeSingle();
    const isPremium = Boolean(profile?.premium_until && new Date(profile.premium_until) > new Date());
    if (!isPremium) return res.status(403).json({ error: 'función exclusiva para cuentas premium' });
  }

  const { data: bankrollRows, error } = await supabase
    .from('bankroll_log')
    .select('pick_id, units, created_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!bankrollRows || bankrollRows.length === 0) {
    return res.status(200).json({ n: 0, hits: 0, misses: 0, hitRate: null, balance: 0, racha: 0, recent: [] });
  }

  const pickIds = [...new Set(bankrollRows.map((r) => r.pick_id).filter(Boolean))];
  const { data: picks } = await supabase.from('picks').select('id, confidence, odds, market').in('id', pickIds);
  const picksById = new Map((picks || []).map((p) => [p.id, p]));

  const exclusiveRows = bankrollRows.filter((r) => {
    const pick = picksById.get(r.pick_id);
    return pick && isExclusivePick(Number(pick.confidence), pick.odds ? Number(pick.odds) : null);
  });

  let balance = 0;
  const withBalance = exclusiveRows.map((r) => {
    balance += Number(r.units);
    const pick = picksById.get(r.pick_id);
    return { pickId: r.pick_id, market: pick?.market || null, units: Number(r.units), balance, createdAt: r.created_at };
  });

  const hits = withBalance.filter((r) => r.units > 0).length;
  const misses = withBalance.filter((r) => r.units < 0).length;
  const n = hits + misses;

  let racha = 0;
  for (let i = withBalance.length - 1; i >= 0; i--) {
    const won = withBalance[i].units > 0;
    if (racha === 0) racha = won ? 1 : -1;
    else if (racha > 0 === won) racha += won ? 1 : -1;
    else break;
  }

  return res.status(200).json({
    n,
    hits,
    misses,
    hitRate: n > 0 ? hits / n : null,
    balance,
    racha,
    recent: withBalance.slice(-20).reverse()
  });
}

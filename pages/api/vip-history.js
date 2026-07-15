// ============================================================
// CAMILOREY — historial de todo lo que salió alguna vez en "Picks VIP"
// (solo admin). Un pick es "exclusivo"/VIP si picks.is_exclusive es
// true — decidido una sola vez al generarse, por el modelo de ML de
// lib/ml-exclusive.js (o el criterio viejo confidence>=85+odds>=1.60
// mientras la muestra de entrenamiento sea chica), ver sync.js.
// ============================================================

import { createClient } from '@supabase/supabase-js';

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
    .select('id, market, confidence, ml_confidence, odds, result, created_at')
    .eq('is_exclusive', true)
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

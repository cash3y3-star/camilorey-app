// ============================================================
// CAMILOREY — historial de picks que fueron "destacados" (solo admin)
// picks.featured se marca en scripts/sync.js con el mismo criterio
// que el pick destacado de Inicio (cuota real >1.60 preferida, luego
// mayor confianza) y queda fijo una vez el pick se resuelve — así
// esto es un registro real de "qué destacamos y cómo salió", no un
// cálculo en vivo que se pierde cada vez que cambian los pendientes.
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
    .select('id, market, confidence, odds, result, created_at')
    .eq('featured', true)
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

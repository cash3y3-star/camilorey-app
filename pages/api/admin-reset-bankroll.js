// ============================================================
// CAMILOREY — el admin reinicia a mano "Mi Bankroll" de una cuenta
// (solo admin), dejándola como si nunca la hubiera usado. "Mi
// Bankroll" no guarda una bitácora propia — el balance/evolución
// siempre se recalcula en el cliente a partir de followed_picks +
// picks (ver pages/index.js), así que reiniciarlo de verdad significa
// DOS cosas juntas: borrar user_bankroll_settings (banco inicial +
// riesgo elegidos — sin fila, el cliente vuelve a los valores por
// defecto, $2.000.000/equilibrado) Y borrar followed_picks (si no,
// aunque el banco vuelva a $2.000.000, la simulación seguiría
// recalculando ganancias/pérdidas de todo lo que esa cuenta venía
// siguiendo, no arrancaría realmente en cero).
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede hacer esto' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'falta el correo' });

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, email')
    .ilike('email', email.trim())
    .maybeSingle();
  if (profileErr) return res.status(500).json({ error: profileErr.message });
  if (!profile) return res.status(404).json({ error: 'no hay ninguna cuenta registrada con ese correo' });

  const { error: delErr } = await supabase.from('user_bankroll_settings').delete().eq('user_id', profile.id);
  if (delErr) return res.status(500).json({ error: delErr.message });

  const { error: followsErr, count: followsRemoved } = await supabase
    .from('followed_picks')
    .delete({ count: 'exact' })
    .eq('user_id', profile.id);
  if (followsErr) return res.status(500).json({ error: followsErr.message });

  return res.status(200).json({ email: profile.email, followsRemoved: followsRemoved || 0 });
}

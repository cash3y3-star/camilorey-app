// ============================================================
// CAMILOREY — registro de usuarios registrados (correo, nombre, desde
// cuándo, si tiene premium) — solo admin. Mismo patrón de auth que
// error-log.js/model-stats.js: verifica el JWT del que llama.
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

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, display_name, created_at, premium_until')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) return res.status(500).json({ error: error.message });

  const nowIso = new Date().toISOString();
  const users = (data || []).map((p) => ({
    id: p.id,
    email: p.email,
    name: p.display_name || p.full_name || null,
    createdAt: p.created_at,
    isPremium: Boolean(p.premium_until && p.premium_until > nowIso)
  }));

  return res.status(200).json({ users });
}

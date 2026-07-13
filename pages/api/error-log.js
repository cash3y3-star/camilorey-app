// ============================================================
// CAMILOREY — últimos errores registrados de la app (solo admin)
// Mismo patrón de auth que model-stats.js: verifica el JWT del que
// llama en vez de un token de query.
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
    .from('error_log')
    .select('id, source, message, stack, context, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ errors: data || [] });
}

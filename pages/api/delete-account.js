// ============================================================
// CAMILOREY — el usuario elimina su propia cuenta (zona de peligro
// en Perfil → Cuenta → Eliminar Cuenta). Borra sus datos ligados en
// la base y luego la cuenta de auth con la service role key. Mismo
// patrón de auth real que /api/admin-activate-premium, pero acá
// cualquier usuario autenticado puede borrarse a sí mismo (no solo admin).
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
  if (authError || !user) return res.status(401).json({ error: 'sesión inválida' });

  // Best-effort: si alguna de estas tablas no existe o no tiene filas
  // del usuario, seguimos igual — lo único que no puede fallar es el
  // borrado de la cuenta de auth.
  await supabase.from('followed_picks').delete().eq('user_id', user.id);
  await supabase.from('user_bankroll_settings').delete().eq('user_id', user.id);
  await supabase.from('profiles').delete().eq('id', user.id);

  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) return res.status(500).json({ error: deleteError.message });

  return res.status(200).json({ ok: true });
}

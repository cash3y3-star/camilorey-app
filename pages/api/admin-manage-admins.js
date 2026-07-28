// ============================================================
// CZECH IA AGENTS — otorgar/quitar acceso al panel admin a otra
// cuenta (profiles.is_admin). A propósito NO usa checkAdmin() de
// lib/adminAuth.js — este endpoint es el ÚNICO que exige el email
// EXACTO de NEXT_PUBLIC_ADMIN_EMAIL (superAdmin), nunca alcanza con
// is_admin=true. Así ningún admin "de a pie" puede darse a sí mismo
// más permisos, quitarle el acceso a otro admin, ni mucho menos
// tocar al superAdmin — solo la cuenta dueña del sitio administra
// quién entra al panel.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'método no permitido' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo la cuenta dueña del sitio puede gestionar accesos admin' });
  }

  if (req.method === 'GET') {
    const { data: admins, error: listError } = await supabase
      .from('profiles')
      .select('email, display_name')
      .eq('is_admin', true)
      .order('email');
    if (listError) return res.status(500).json({ error: listError.message });
    return res.status(200).json({ admins: admins || [] });
  }

  const { email, grant } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'falta el correo' });
  const targetEmail = email.trim();

  // No tiene sentido (ni se puede) tocar el propio acceso del
  // superAdmin acá — el suyo sale del email, no de esta columna.
  if (targetEmail.toLowerCase() === (process.env.NEXT_PUBLIC_ADMIN_EMAIL || '').toLowerCase()) {
    return res.status(400).json({ error: 'esa es tu propia cuenta, no hace falta otorgarte nada' });
  }

  // .ilike en vez de .eq (mismo criterio que admin-activate-premium.js):
  // el correo que escribe el superAdmin a mano puede no coincidir en
  // mayúsculas/minúsculas con el que quedó guardado al loguearse.
  const { data: profile, error: findError } = await supabase
    .from('profiles')
    .select('id, email, is_admin')
    .ilike('email', targetEmail)
    .maybeSingle();
  if (findError) return res.status(500).json({ error: findError.message });
  if (!profile) return res.status(404).json({ error: 'no hay ninguna cuenta registrada con ese correo' });

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ is_admin: Boolean(grant) })
    .eq('id', profile.id)
    .select('email, is_admin')
    .maybeSingle();
  if (updateError) return res.status(500).json({ error: updateError.message });

  return res.status(200).json({ ok: true, profile: updated });
}

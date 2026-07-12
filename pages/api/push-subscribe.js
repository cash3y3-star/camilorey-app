// ============================================================
// CAMILOREY — guarda la suscripción push del navegador
// El insert/upsert directo desde el cliente (supabaseClient, con RLS)
// falla cuando el mismo endpoint (identifica al navegador, no al
// usuario) ya estaba guardado a nombre de otra cuenta — el UPSERT
// hace un UPDATE en ese caso, y la política de RLS para UPDATE exige
// ser el dueño de esa fila. Pasa perfectamente cuando alguien prueba
// con más de una cuenta en el mismo navegador. Este endpoint hace el
// upsert con la service_role (sin RLS), así que un navegador siempre
// puede "reclamar" su endpoint para el usuario que esté logueado
// ahora — verificando primero que el token sí sea de ese usuario.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { userId, endpoint, p256dh, auth } = req.body || {};
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!userId || !endpoint || !p256dh || !auth || !token) {
    return res.status(400).json({ error: 'faltan campos' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser(token);
  if (authError || !user || user.id !== userId) {
    return res.status(401).json({ error: 'token inválido' });
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: userId, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}

// ============================================================
// CZECH IA AGENTS — buzón de "Solicitudes de cambios" del panel admin.
// Cualquier cuenta admin (superAdmin o profiles.is_admin=true, ver
// lib/adminAuth.js) puede crear pedidos y cambiar el estado de
// cualquiera, no solo el propio — es un buzón compartido entre socios.
// Mismo patrón de auth por JWT que error-log.js/admin-live-streams.js.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '../../lib/adminAuth';

const VALID_PRIORITIES = ['baja', 'media', 'alta'];
const VALID_STATUSES = ['pendiente', 'en_progreso', 'hecha', 'descartada'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'falta token' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { user, isAdmin } = await checkAdmin(supabase, token);
  if (!isAdmin) {
    return res.status(403).json({ error: 'solo un admin puede usar el buzón de solicitudes' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('change_requests').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ requests: data || [] });
  }

  if (req.method === 'POST') {
    const title = (req.body?.title || '').trim();
    const description = (req.body?.description || '').trim();
    const priority = VALID_PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'media';
    if (!title) return res.status(400).json({ error: 'falta el título' });
    if (!description) return res.status(400).json({ error: 'falta la descripción' });

    const { data, error } = await supabase
      .from('change_requests')
      .insert({ title, description, priority, created_by: user.id, created_by_email: user.email })
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ request: data });
  }

  if (req.method === 'PATCH') {
    const id = req.body?.id;
    const status = req.body?.status;
    if (!id) return res.status(400).json({ error: 'falta el id de la solicitud' });
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'estado no válido' });

    const { data, error } = await supabase
      .from('change_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'esa solicitud no existe' });
    return res.status(200).json({ request: data });
  }

  return res.status(405).json({ error: 'método no permitido' });
}

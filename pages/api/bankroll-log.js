// ============================================================
// CAMILOREY — log detallado del bankroll (solo admin)
// bankrollLog/bankrollSeries (apuesta por apuesta, con montos reales)
// vivían antes en getServerSideProps y en /api/refresh-data, así que
// CUALQUIER visitante los recibía sin login — la pestaña "Bankroll"
// solo los ocultaba en la interfaz, no eran datos realmente privados.
// Mismo patrón de auth que /api/error-log y /api/model-stats: se
// verifica el JWT de quien pide esto en el servidor, no solo el
// email que manda el cliente.
// ============================================================

import { createClient } from '@supabase/supabase-js';

function formatCOP(n, withSign = false) {
  const abs = Math.round(Math.abs(n)).toLocaleString('es-CO');
  const sign = withSign ? (n >= 0 ? '+' : '-') : '';
  return `${sign}$${abs}`;
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
  if (authError || !user || user.email !== process.env.NEXT_PUBLIC_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'solo el admin puede ver esto' });
  }

  const { data: bankrollRows, error } = await supabase
    .from('bankroll_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return res.status(500).json({ error: error.message });

  const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
  const { data: bkPicks } = bkPickIds.length
    ? await supabase.from('picks').select('id, market').in('id', bkPickIds)
    : { data: [] };
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const bankrollLog = (bankrollRows || []).map((r) => {
    const pick = bkPicksById.get(r.pick_id);
    return {
      fecha: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', timeZone: 'America/Bogota' }).format(
        new Date(r.created_at)
      ),
      pick: pick?.market || 'Pick',
      u: formatCOP(Number(r.units), true),
      ok: Number(r.units) >= 0,
      balance: formatCOP(Number(r.balance))
    };
  });
  const bankrollSeries = [...(bankrollRows || [])].reverse().map((r) => Number(r.balance));

  return res.status(200).json({ bankrollLog, bankrollSeries });
}

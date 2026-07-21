// ============================================================
// PRUEBA TEMPORAL 2026-07-20 — lee el resultado que scripts/sync.js
// guarda en error_log (source='aiscore-test') para confirmar si
// AiScore bloquea las IPs de GitHub Actions antes de invertir en un
// scraper de H2H. Sin auth a propósito (nada sensible, solo un
// status HTTP) — se borra este archivo apenas se tenga la respuesta.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from('error_log')
    .select('message, created_at')
    .eq('source', 'aiscore-test')
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ results: data });
}

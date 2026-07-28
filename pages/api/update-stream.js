// ============================================================
// CZECH IA AGENTS — detecta solo qué mesas de LigaPro están en vivo
// AHORA MISMO en YouTube y actualiza live_streams, sin que nadie
// tenga que copiar/pegar el link a mano cada vez que el stream corta
// (pasa cada 3-4 horas). Pensado para un cronjob externo (cron-job.org,
// mismo patrón que /api/notify/check-follows) cada 15 minutos — no
// menos: search.list cuesta 100 unidades de cuota por llamada, y el
// límite gratis de YouTube es 10.000/día (96 llamadas de 15 min =
// 9.600, con margen; cada 5-10 min se pasa de cuota a media tarde).
//
// Los títulos de LigaPro son del estilo "TT LigaPro A17 28.07 00:00 -
// 06:00" — TITLE_CODE_PATTERN saca el código de mesa (A17) de ahí. Si
// el formato de título cambia alguna vez y deja de tener ese patrón,
// esa mesa simplemente no se detecta (no revienta nada, solo no
// actualiza esa fila).
// ============================================================

import { createClient } from '@supabase/supabase-js';

const TITLE_CODE_PATTERN = /\b([A-Z]{1,2}\d{1,4})\b/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const token = req.query.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!apiKey || !channelId) {
    return res.status(500).json({ error: 'falta YOUTUBE_API_KEY o YOUTUBE_CHANNEL_ID en las variables de entorno' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // "Mejor esfuerzo" con YouTube — si la API falla (cuota agotada,
  // caída momentánea), no se toca lo que ya había en Supabase: mejor
  // un video que siga un rato de más que borrar todo y mostrar
  // "volverá pronto" de golpe en las mesas que en realidad siguen en
  // vivo.
  let items;
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`YouTube API HTTP ${r.status}: ${body}`);
    }
    const data = await r.json();
    items = data.items || [];
  } catch (e) {
    console.error('Error consultando YouTube:', e.message);
    return res.status(200).json({ ok: false, error: e.message, skipped: true });
  }

  const liveByCode = new Map();
  for (const item of items) {
    const title = item.snippet?.title || '';
    const match = title.match(TITLE_CODE_PATTERN);
    if (!match) continue;
    liveByCode.set(match[1].toUpperCase(), item.id.videoId);
  }

  const nowIso = new Date().toISOString();
  const rows = [...liveByCode.entries()].map(([tournament_code, youtube_video_id]) => ({
    tournament_code,
    youtube_video_id,
    updated_at: nowIso
  }));

  if (rows.length) {
    const { error: upsertErr } = await supabase
      .from('live_streams')
      .upsert(rows, { onConflict: 'tournament_code' });
    if (upsertErr) return res.status(500).json({ error: upsertErr.message });
  }

  // Mesas que estaban guardadas de una corrida anterior pero YA NO
  // están en vivo (cortó y no arrancó una nueva todavía, o cambió de
  // mesa) — se borran para que el sitio muestre "la transmisión
  // volverá pronto" en vez de un video viejo/muerto.
  const { data: existingRows, error: listErr } = await supabase.from('live_streams').select('tournament_code');
  if (listErr) return res.status(500).json({ error: listErr.message });
  const staleCodes = (existingRows || []).map((r) => r.tournament_code).filter((code) => !liveByCode.has(code));
  if (staleCodes.length) {
    const { error: deleteErr } = await supabase.from('live_streams').delete().in('tournament_code', staleCodes);
    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
  }

  return res.status(200).json({ ok: true, live: [...liveByCode.keys()], removed: staleCodes });
}

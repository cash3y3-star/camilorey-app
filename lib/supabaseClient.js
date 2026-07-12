// ============================================================
// CAMILOREY — cliente de Supabase para el navegador
// Usa la anon key (segura para exponer al público) — nunca la
// service_role key, esa es solo para el servidor (getServerSideProps,
// sync.js, las API routes). Se usa para el login con Google.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

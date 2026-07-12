// ============================================================
// CAMILOREY — cliente de Supabase para el navegador
// Usa la anon key (segura para exponer al público) — nunca la
// service_role key, esa es solo para el servidor (getServerSideProps,
// sync.js, las API routes). Se usa para el login con Google.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// createClient() lanza un error inmediato si faltan estos valores —
// si eso pasara a nivel de módulo, se cae TODO el sitio en vez de
// solo el botón de login. Mejor null y que el login se desactive solo.
export const supabaseClient = url && anonKey ? createClient(url, anonKey) : null;

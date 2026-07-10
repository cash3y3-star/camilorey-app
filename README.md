# CAMILOREY — app real (Next.js + Supabase + Vercel)

## Qué es esto
El backend base de tu app: base de datos, fórmula de confianza, y el
proceso automático que va a leer tt.league-pro.com cada 30 minutos.
El frontend visual (el diseño negro/rojo que ya vimos) se conecta en
el siguiente paso, una vez esta parte esté corriendo.

## Paso 1 — Supabase
1. Entra a tu proyecto en supabase.com
2. Ve a "SQL Editor" → pega el contenido de `supabase/schema.sql` → Run
3. Ve a "Project Settings" → "API" y copia:
   - `Project URL`
   - `service_role key` (no la "anon", esa no sirve para escribir datos)

## Paso 2 — Subir el proyecto a GitHub
Necesitas un repo en GitHub con esta carpeta. Si no sabes cómo, dime y
te guío paso a paso (o lo subo yo si me das acceso).

## Paso 3 — Vercel
1. "Add New Project" → importa el repo de GitHub
2. En "Environment Variables" agrega:
   - `SUPABASE_URL` = tu Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = tu service_role key
   - `CRON_SECRET` = una contraseña que inventes tú (ej. una cadena larga random)
3. Deploy

Vercel va a leer `vercel.json` y programar el cron automáticamente
cada 30 minutos, llamando `/api/cron/sync`.

## Cosas importantes que debes saber (honestidad primero)

1. **El scraper (`pages/api/cron/sync.js`) es un punto de partida, no
   producto terminado.** Escribí los selectores mirando el contenido
   de la página desde mi entorno, pero no puedo probarlo en vivo desde
   aquí. La primera vez que corra en Vercel, revisamos juntos los logs
   ("Logs" en el dashboard de Vercel) y ajustamos lo que falle.

2. **No sabemos todavía si el H2H/racha predice bien** en esta liga,
   porque son torneos cortos automatizados (ver conversación anterior).
   Vamos a dejar que corra, acumular resultados reales en
   `bankroll_log`, y ahí sí medir el acierto real — no antes.

3. **Cron cada 30 min es el plan gratis de Vercel** (mínimo permitido).
   Si luego quieres algo más frecuente, hay que pasar a plan pago o
   mover el cron a otro sitio (ej. GitHub Actions, gratis, sin límite
   de frecuencia razonable).

## Siguiente paso
Cuando tengas Supabase y Vercel con las variables listas, dime y
seguimos con:
- Conectar el frontend (el diseño que ya tienes) a estos datos reales
- Revisar juntos los primeros logs del cron para ajustar el scraper

# CAMILOREY — app real (Next.js + Supabase + Vercel)

## Qué es esto
El backend base de tu app: base de datos, fórmula de confianza, y el
proceso automático que va a leer tt.league-pro.com cada 30 minutos.
El frontend visual (el diseño negro/rojo que ya vimos) se conecta en
el siguiente paso, una vez esta parte esté corriendo.

## Paso 1 — Supabase
1. Entra a tu proyecto en supabase.com
2. Ve a "SQL Editor" → pega el contenido de `supabase/schema.sql` → Run
3. Corre también las migraciones en orden (`supabase/migration_001_...sql`,
   `migration_002_...sql`) — cada una tiene un comentario arriba explicando
   qué arregla.
4. Ve a "Project Settings" → "API" y copia:
   - `Project URL`
   - `service_role key` (no la "anon", esa no sirve para escribir datos)

## Paso 2 — Subir el proyecto a GitHub
Necesitas un repo en GitHub con esta carpeta. Si no sabes cómo, dime y
te guío paso a paso (o lo subo yo si me das acceso).

## Paso 3 — Vercel (solo para el frontend)
1. "Add New Project" → importa el repo de GitHub
2. En "Environment Variables" agrega:
   - `SUPABASE_URL` = tu Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = tu service_role key
3. Deploy

Vercel solo sirve el sitio Next.js (frontend). La sincronización de
datos **no** corre ahí — corre por GitHub Actions (ver abajo), que es
gratis y sin límite de frecuencia razonable.

## Cómo se sincronizan los datos
`scripts/sync.js` corre cada 30 min vía GitHub Actions
(`.github/workflows/sync.yml`). En cada corrida:
1. Lee `tt.league-pro.com/en` — es una app con SSR (Nuxt), así que
   cada página trae embebido un `<script id="__NUXT_DATA__">` con toda
   la data ya estructurada en JSON (torneos, jugadores, partidos,
   resultados). El script hace un `fetch` normal y lee ese JSON
   directamente — no usa navegador ni selectores CSS, así que no se
   rompe con un rediseño del sitio.
2. Guarda cada partido del torneo con su propio row estable (no se
   sobreescriben entre corridas). Si el partido ya tiene resultado
   real, lo cierra: marca `matches.status = 'finished'`, resuelve el
   pick contra el ganador real (`picks.result = 'hit' | 'miss'`) y
   registra la apuesta sintética en `bankroll_log` (unidades según
   `lib/staking.js`, escaladas por la confianza del pick).
3. Si el partido todavía no se juega y no tiene pick, genera uno con
   `lib/confidence.js`.

Puedes disparar una corrida manual desde GitHub → Actions → "Sync
CAMILOREY picks" → "Run workflow", y revisar los logs ahí mismo.

## Cosas importantes que debes saber (honestidad primero)

1. **Cubre la ventana de torneos "recientes/próximos" de la portada**,
   no todo el calendario de la liga. Si hace falta cubrir más adelante
   en el tiempo, hay que agregar paginación sobre `/en/tournaments`.

2. **No sabemos todavía si el H2H/racha predice bien** en esta liga,
   porque son torneos cortos automatizados. Vamos a dejar que corra,
   acumular resultados reales, y ahí sí medir el acierto real — no
   antes.

3. **El staking es una convención nuestra, no una cuota real** — el
   sitio no publica momios. `lib/staking.js` escala unidades entre 0.5
   y 2 según la confianza del pick; es un punto de partida, ajustable
   cuando haya más historial.

## Siguiente paso
- Conectar el frontend (el diseño que ya tienes) a estos datos reales
- Con hit/miss ya acumulando datos, ajustar los pesos de
  `confidence.js` cuando haya suficiente historial

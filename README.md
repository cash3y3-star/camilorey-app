# CAMILOREY — app real (Next.js + Supabase + Vercel)

## Qué es esto
App completa: base de datos, fórmula de confianza, el proceso
automático que lee tt.league-pro.com cada 30 minutos, y el frontend
(diseño negro/rojo) en `pages/index.js`, ya conectado a los datos
reales de Supabase.

## Paso 1 — Supabase
1. Entra a tu proyecto en supabase.com
2. Ve a "SQL Editor" → pega el contenido de `supabase/schema.sql` → Run
3. Corre también las migraciones en orden (`migration_001` a
   `migration_004`) — cada una tiene un comentario arriba explicando
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

## El frontend (`pages/index.js`)
Es una sola página (Inicio / Predicciones / Calendario / Bankroll) que
trae los datos con `getServerSideProps` en cada visita — siempre
muestra lo último que dejó el último sync, sin caché. Muestra la cuota
real de Rushbet cuando la encontramos (ver abajo); si no, dice "N/D".
El análisis de cada pick se arma en texto a partir de los factores
reales de `lib/confidence.js` (rating, racha, cruce directo) — no hay
texto inventado.

## Cuotas reales (`lib/rushbet.js`)
Rushbet (la casa con licencia Coljuegos en Colombia — concesión
C1972) corre sobre la plataforma Kambi, que expone su tablero de
cuotas en un JSON público sin login:

```
https://us.offering-api.kambicdn.com/offering/v2018/rsico/listView/table_tennis.json
```

De ahí filtramos el grupo `"Liga Pro checa"` (la misma liga que
tt.league-pro.com) y cruzamos cada partido por nombre de jugador +
hora contra nuestros propios partidos. El cruce por nombre es *best
effort*: tt.league-pro.com da los nombres como "Apellido Inicial"
(ej. "Levicky M") y Rushbet como "Nombre Apellido" (ej. "Matej
Levicky") — `lib/rushbet.js` normaliza ambos a apellido+inicial para
compararlos, pero apellidos compuestos pueden fallar el cruce. Cuando
no encontramos el partido, el pick se genera igual, solo que sin
cuota (`picks.odds = null`).

**Deliberadamente NO usamos 1xBet**: no tiene licencia de Coljuegos
en Colombia (solo licencia de Curaçao) y solo es alcanzable por
dominios "espejo" no oficiales — no vamos a construir scraping
apuntado a eso.

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
   registra la apuesta en `bankroll_log` — unidades arriesgadas según
   `lib/staking.js` (escaladas por confianza), pago según la cuota
   real de Rushbet si la tenemos, si no 1:1.
3. Si el partido todavía no se juega y no tiene pick, genera uno con
   `lib/confidence.js` y le busca cuota real en `lib/rushbet.js`.

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

3. **El tamaño de la apuesta sigue siendo convención nuestra** —
   `lib/staking.js` escala unidades entre 0.5 y 2 según la confianza
   del pick, eso no viene de ningún lado externo. Lo que sí es real es
   la cuota (cuando el cruce con Rushbet funciona) y por lo tanto el
   pago de cada apuesta resuelta.

4. **El cruce de nombres con Rushbet no es perfecto** — es best effort
   por apellido+inicial (ver sección de arriba). Si `picks.odds` sale
   null en varios picks seguidos, vale la pena revisar los logs del
   sync para ver qué nombres no están cruzando.

## Siguiente paso
- Conectar el frontend (el diseño que ya tienes) a estos datos reales
- Con hit/miss ya acumulando datos, ajustar los pesos de
  `confidence.js` cuando haya suficiente historial

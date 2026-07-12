# CAMILOREY — app real (Next.js + Supabase + Vercel)

## Qué es esto
App completa para picks de la Liga Pro Checa de tenis de mesa: base de
datos, fórmula de confianza, el proceso automático que lee
tt.league-pro.com, cuotas reales de Rushbet, marcador en vivo,
login con Google, chat en vivo por partido, la función de "seguir un
pick" con notificaciones push del navegador, y el frontend (diseño
estilo app móvil) en `pages/index.js`, todo conectado a datos reales
de Supabase — nada de texto o números inventados.

## Paso 1 — Supabase
1. Entra a tu proyecto en supabase.com
2. Ve a "SQL Editor" → pega el contenido de `supabase/schema.sql` → Run
3. Corre también las migraciones en orden, de `migration_001` hasta
   `migration_011` — cada una tiene un comentario arriba explicando
   qué arregla o qué función nueva habilita.
4. Ve a "Project Settings" → "API" y copia:
   - `Project URL`
   - `service_role key` (para el servidor/scraper — nunca se expone al navegador)
   - `anon` / `publishable key` (para el login y el chat del lado del navegador)
5. Ve a "Authentication" → "Sign In / Providers" → activa **Google** y
   sigue el flujo de OAuth de Google Cloud Console.
6. Ve a "Authentication" → "URL Configuration" → pon como Site URL
   `https://camilorey-app.vercel.app` (no `localhost`, o el login se
   cae con "localhost rechazó la conexión").

## Paso 2 — GitHub
El repo ya está subido y conectado. `scripts/sync.js` corre desde ahí
vía GitHub Actions — es gratis y sin límite de minutos porque el repo
es público.

## Paso 3 — Vercel (el frontend)
1. "Add New Project" → importa el repo de GitHub
2. En "Environment Variables" agrega:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — igual que en Actions
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — para el login y el chat
   - `NEXT_PUBLIC_ADMIN_EMAIL` — tu correo, para ver el contador de usuarios registrados (nadie más lo ve)
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — para las notificaciones push (ver abajo cómo generarlas)
   - `CRON_SECRET` — cualquier clave larga inventada, protege los endpoints de cron
3. Deploy

Vercel solo sirve el sitio Next.js. La sincronización de datos **no**
corre ahí — corre por GitHub Actions.

## El frontend (`pages/index.js`)
Una sola página con 5 secciones (Inicio / Calendario / Picks / Seguidos
/ Bankroll), estilo app móvil, con `getServerSideProps` en cada visita
— siempre lo último que dejó el sync, sin caché. Entre lo que trae:

- **Pick destacado del día** + tablas de posiciones de los torneos que
  están en vivo ahora mismo (ver "Tablas de grupo" abajo).
- **Calendario** con selector de 7 días y filtros rápidos (En vivo /
  Próximos / Finalizados / Todos), marcador de sets en vivo actualizado
  cada 8s directo en la tarjeta.
- **Picks** con pestañas Todos / Pendientes / Ganados / Perdidos.
- **Seguidos**: picks que el usuario marcó con la estrella — se les
  manda notificación push cuando cierra un set o termina el partido
  (ver abajo).
- **Bankroll** con balance, ROI real, y gráfico de evolución.

El análisis de cada pick se arma en texto a partir de los factores
reales de `lib/confidence.js` — no hay texto inventado.

## Login y chat
Login con Google vía Supabase Auth (`lib/supabaseClient.js`, guardado
defensivamente: si faltan las env vars, el botón simplemente no
aparece en vez de tumbar el build entero). Cada usuario logueado tiene
un row en `profiles` (trigger automático al crearse la cuenta). Cada
partido en vivo tiene su propio chat (`chat_messages`, vía Supabase
Realtime) con un sistema de nivel estilo AiScore según cuánto escribe
cada quien (`migration_010`).

## Seguir picks + notificaciones push (`migration_011`)
Cualquiera logueado puede tocar la ☆ en un pick para seguirlo
(`followed_picks`). La primera vez que sigue uno, se le pide permiso
de notificaciones del navegador y se guarda su suscripción
(`push_subscriptions`). Un vigilante aparte
(`pages/api/notify/check-follows.js`) revisa **solo** los partidos
seguidos — no todos — contra el tablero en vivo de Rushbet, y manda
la notificación cuando se cierra un set o termina el partido. Hace
falta:

1. Generar las llaves VAPID una vez (`.github/workflows/generate-vapid-keys.yml`, corrida manual, o `npx web-push generate-vapid-keys`).
2. Un cronjob externo (cron-job.org, plan gratis, mínimo 1 minuto) pegándole a `https://camilorey-app.vercel.app/api/notify/check-follows?token=EL_CRON_SECRET` cada 1-5 minutos.

Seguidos usa `pages/api/followed-detail.js` para mostrar el pick
aunque el partido ya haya arrancado — la lista normal de "Picks" oculta
un pick 3 minutos antes de que empiece el partido, pero eso no aplica
a lo que alguien sigue a propósito.

## Cuotas reales (`lib/rushbet.js`)
Rushbet (licencia Coljuegos en Colombia — concesión C1972) corre sobre
Kambi, que expone su tablero de cuotas y su feed en vivo en JSON
público sin login. Cruzamos cada partido por nombre de jugador + hora
(best effort, normalizado a apellido+inicial). Si en el momento en que
se genera el pick Rushbet todavía no lista ese partido, el sync
**reintenta el cruce en cada corrida siguiente** (`backfillMissingOdds`
en `scripts/sync.js`) hasta encontrarlo — antes se intentaba una sola
vez y se quedaba en `null` para siempre.

**Deliberadamente NO usamos 1xBet**: no tiene licencia de Coljuegos en
Colombia, solo es alcanzable por dominios espejo no oficiales.

## Marcador en vivo
`pages/api/live-match.js` consulta primero el feed en vivo de Rushbet
(reloj + set por set), y si no tiene el partido, cae a
tt.league-pro.com directo (menos detalle). Se usa para el marcador que
aparece en las tarjetas de Calendario mientras un partido está en vivo
(poll cada 8s, solo mientras `status === 'live'`).

## Tablas de grupo (torneos en vivo)
En Inicio, debajo del pick destacado, se arma la tabla de cada torneo
que tenga al menos un partido en vivo ahora mismo — igual a como
tt.league-pro.com la muestra dentro de cada torneo: todos contra
todos, con el marcador de cada cruce, Sets, Bolas, Puntos y Puesto.
Se reconstruye 100% de nuestros propios `matches` (no hace falta
scraping nuevo):
- **Puntos**: 2 por partido ganado, 1 por perdido — confirmado que es
  exactamente el criterio real del sitio (se validó contra su JSON
  directo).
- **Bolas**: solo se puede calcular cuando tenemos el detalle punto a
  punto (`matches.set_scores`), que solo se guarda cuando alguien vio
  ese partido en vivo por nuestro sitio — ni el propio
  tt.league-pro.com guarda ese detalle después de que el partido
  termina, así que la cobertura completa no es posible sin encontrar
  su feed en vivo interno (no investigado todavía).

## Fotos de jugadores sin fondo
`lib/avatarCutout.js` usa `@imgly/background-removal-node` (local, sin
API externa) para recortar el fondo de cada foto la primera vez que
aparece un jugador nuevo, y guarda el resultado en Supabase Storage
(`players.avatar_cutout_url`).

## Cómo se sincronizan los datos
`scripts/sync.js` corre vía GitHub Actions (`.github/workflows/sync.yml`),
disparado por un cronjob externo en cron-job.org que llama a la API de
`workflow_dispatch` de GitHub — el `schedule:` nativo del workflow es
solo un respaldo (GitHub a veces lo corre con horas de retraso). Ahora
mismo corre cada **~1 minuto**. El workflow tiene un `concurrency`
guard para que una corrida no se pise con la siguiente si tarda más
del intervalo. En cada corrida:
1. Lee tt.league-pro.com (JSON embebido `__NUXT_DATA__`, sin navegador
   ni selectores CSS — no se rompe con un rediseño del sitio).
2. Cierra los partidos que ya tienen resultado real: `matches.status =
   'finished'`, resuelve el pick (`hit`/`miss`) y registra la apuesta
   en `bankroll_log`.
3. Genera picks nuevos para partidos sin pick todavía.
4. Reintenta la cuota de Rushbet para picks pendientes que aún no la
   tengan.

## Fórmula de confianza (`lib/confidence.js`)
Ajustada el 2026-07-12 con datos reales (108 picks resueltos, vía
`/api/debug/confidence-stats?token=...`): `rating` 75%, `racha` 15%,
`h2h` 10%. Antes era 50/30/20 — se bajó `h2h` porque salía en 0.000
exacto en el 100% de los casos (esta liga casi nunca repite el mismo
cruce de jugadores) y se bajó `racha` porque no mostró señal a favor
del acierto real. `rating` fue el único factor con señal real. Acierto
general medido en ese momento: 57.4% (IC 95%: 48%-66%, todavía no
distinguible de una moneda al aire con esta muestra) — vale la pena
volver a correr el análisis cuando haya más historial con los pesos
nuevos.

## Cosas importantes que debes saber (honestidad primero)
1. El tamaño de apuesta en Bankroll sigue siendo convención nuestra
   (`lib/staking.js`, 0.5u-2u según confianza) — lo que sí es real es
   la cuota y el pago cuando el cruce con Rushbet funciona.
2. El cruce de nombres con Rushbet no es perfecto (best effort por
   apellido+inicial) — si `picks.odds` sale null en varios picks
   seguidos, revisa los logs del sync.
3. La fórmula de confianza todavía no está probada estadísticamente
   mejor que el azar — se sigue midiendo con `/api/debug/confidence-stats`.
4. "Bolas" en las tablas de grupo va a salir "—" para la mayoría de
   partidos que nadie vio en vivo — es una limitación real de los
   datos, no un bug.

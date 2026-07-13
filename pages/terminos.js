import Head from 'next/head';

// ============================================================
// CAMILOREY — Términos y Condiciones
// Página estática aparte del SPA principal (mismo patrón que
// pages/privacidad.js) — describe con exactitud lo que el sitio es y
// no es: análisis propio de entretenimiento, no un operador de
// apuestas, no gestiona dinero real.
// ============================================================

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'cash3y3@gmail.com';

export default function Terminos() {
  return (
    <>
      <Head>
        <title>Términos y Condiciones · CAMILOREY</title>
        <meta name="description" content="Condiciones de uso del sitio CAMILOREY." />
        <meta name="robots" content="index,follow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root{
            --bg:#0E0D0C; --card:#1B1917; --ink:#F5F1EC; --muted:#948C83; --line:#2B2724; --court:#E2444A;
            --font-display:'Big Shoulders Display', sans-serif; --font-body:'Manrope', sans-serif;
          }
          *{box-sizing:border-box;}
          body{margin:0; background:var(--bg); color:var(--ink); font-family:var(--font-body); line-height:1.6;}
          .wrap{max-width:720px; margin:0 auto; padding:32px 20px 60px;}
          a{color:var(--court);}
          a.back{display:inline-block; margin-bottom:20px; font-size:14px; text-decoration:none; color:var(--muted);}
          h1{font-family:var(--font-display); font-weight:800; font-size:32px; margin:0 0 6px;}
          .updated{color:var(--muted); font-size:13px; margin-bottom:28px;}
          h2{font-family:var(--font-display); font-weight:700; font-size:20px; margin:32px 0 10px; color:var(--ink);}
          p, li{color:#D8D2CA; font-size:14.5px;}
          ul{padding-left:20px;}
          li{margin-bottom:6px;}
          .card{background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin:18px 0;}
          footer{margin-top:40px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:12.5px;}
        `}</style>
      </Head>
      <div className="wrap">
        <a className="back" href="/">
          ← Volver a CAMILOREY
        </a>
        <h1>Términos y Condiciones</h1>
        <p className="updated">Última actualización: julio de 2026</p>

        <p>
          Al usar CAMILOREY aceptas estos términos. Léelos con calma — están escritos para que quede claro qué es
          este sitio (y qué no es) antes de que sigas ningún pick.
        </p>

        <h2>Qué es CAMILOREY</h2>
        <p>
          CAMILOREY es un sitio informativo y de entretenimiento que publica análisis y opiniones propias sobre
          partidos de la Liga Pro Checa de tenis de mesa (tt.league-pro.com), generados a partir de un modelo
          estadístico propio (rating, racha reciente y enfrentamientos directos de cada jugador).
        </p>
        <div className="card">
          <p style={{ margin: 0 }}>
            <strong>CAMILOREY no es una casa de apuestas.</strong> No procesamos pagos, no gestionamos apuestas ni
            fondos de terceros, y no movemos dinero real en ningún momento. "Mi Bankroll" es un simulador con números
            que tú mismo escribes — no representa saldo, depósito ni ganancia real.
          </p>
        </div>

        <h2>Sin garantía de resultados</h2>
        <p>
          El "Índice IA" y el análisis de cada pick reflejan qué tan favorito creemos que es un jugador según
          nuestro modelo — no es una garantía de resultado ni asesoría financiera. Ningún pick, por alto que sea su
          porcentaje de confianza, asegura un desenlace. La sección Modelo muestra públicamente el acierto real
          medido del sistema, incluyendo cuando ese acierto es bajo.
        </p>

        <h2>Cuotas de terceros</h2>
        <p>
          Las cuotas que se muestran junto a cada pick provienen de Rushbet, un operador con licencia de Coljuegos
          en Colombia (concesión C1972) — las mostramos solo como referencia informativa, cruzadas automáticamente
          por nombre de jugador y horario. CAMILOREY no opera, controla ni se responsabiliza por Rushbet ni por
          ninguna otra casa de apuestas; cualquier apuesta real que decidas hacer es una decisión tuya, en la
          plataforma de terceros que elijas, bajo sus propios términos.
        </p>

        <h2>Edad mínima y juego responsable</h2>
        <p>
          El acceso a CAMILOREY está dirigido exclusivamente a mayores de 18 años, por el contenido relacionado a
          apuestas deportivas que analizamos. Si sientes que el juego deja de ser un entretenimiento, busca ayuda
          profesional — juega siempre con responsabilidad.
        </p>

        <h2>Tu cuenta</h2>
        <ul>
          <li>Inicias sesión con tu cuenta de Google — no creamos ni almacenamos contraseñas propias.</li>
          <li>Sos responsable de mantener el acceso a tu cuenta de Google segura.</li>
          <li>Podés cerrar sesión o pedir que borremos tu cuenta y tus datos en cualquier momento (ver la Política de Privacidad).</li>
        </ul>

        <h2>Chat en vivo</h2>
        <p>
          Los mensajes que escribas en el chat de un partido son públicos para cualquiera que abra ese partido. No
          está permitido publicar contenido ofensivo, spam, ni promoción de terceros. Nos reservamos el derecho de
          borrar mensajes o restringir el acceso al chat a quien incumpla esto.
        </p>

        <h2>Propiedad</h2>
        <p>
          El análisis, el modelo de confianza, el diseño y la marca "CAMILOREY" son propios de este sitio. Los
          nombres de jugadores, torneos y datos de partidos provienen de tt.league-pro.com, un tercero — CAMILOREY
          no reclama ser su fuente original ni tiene afiliación con ellos.
        </p>

        <h2>Disponibilidad del servicio</h2>
        <p>
          Hacemos lo posible por mantener el sitio, los picks y las notificaciones funcionando correctamente, pero
          no garantizamos disponibilidad ininterrumpida — puede haber interrupciones por mantenimiento, fallas de
          terceros (por ejemplo, si tt.league-pro.com o Rushbet no responden) u otras causas fuera de nuestro
          control. Funciones marcadas como "próximamente" (como las suscripciones premium) todavía no existen y
          pueden cambiar antes de lanzarse.
        </p>

        <h2>Límite de responsabilidad</h2>
        <p>
          CAMILOREY no se hace responsable por pérdidas económicas derivadas de apuestas que hagas en base a
          nuestro análisis, en ninguna plataforma. El contenido es informativo y de entretenimiento — la decisión y
          el riesgo de cualquier apuesta real son enteramente tuyos.
        </p>

        <h2>Cambios a estos términos</h2>
        <p>Si actualizamos estas condiciones, publicamos la nueva versión en esta misma página con la fecha arriba.</p>

        <h2>Contacto</h2>
        <p>
          Cualquier pregunta sobre estos términos: <a href={`mailto:${ADMIN_EMAIL}`}>{ADMIN_EMAIL}</a>. También
          podés ver la <a href="/privacidad">Política de Privacidad</a>.
        </p>

        <footer>
          <strong>CAMILOREY</strong> ofrece análisis y opiniones propias con fines informativos y de entretenimiento
          sobre la Liga Pro Checa de tenis de mesa. No garantizamos resultados y no gestionamos apuestas ni fondos de
          terceros. Servicio dirigido exclusivamente a mayores de 18 años. Si sientes que el juego deja de ser un
          entretenimiento, busca ayuda profesional. Juega siempre con responsabilidad.
        </footer>
      </div>
    </>
  );
}

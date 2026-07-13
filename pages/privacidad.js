import Head from 'next/head';

// ============================================================
// CAMILOREY — Política de Privacidad
// Página estática aparte del SPA principal (no pasa por
// getServerSideProps ni por el estado de la app) — describe en
// español, y con exactitud a lo que el código realmente hace, qué
// datos se guardan y para qué. Se actualiza a mano cada vez que se
// agregue una tabla nueva que guarde algo de un usuario.
// ============================================================

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'cash3y3@gmail.com';

export default function Privacidad() {
  return (
    <>
      <Head>
        <title>Política de Privacidad · CAMILOREY</title>
        <meta name="description" content="Qué datos recopila CAMILOREY y cómo los usa." />
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
        <h1>Política de Privacidad</h1>
        <p className="updated">Última actualización: julio de 2026</p>

        <p>
          CAMILOREY es un sitio informativo y de entretenimiento sobre picks y análisis de la Liga Pro Checa de tenis
          de mesa. No gestionamos apuestas ni fondos de terceros — no procesamos pagos ni movemos dinero real. Esta
          página explica qué datos personales recopilamos cuando usas el sitio, para qué los usamos, y cómo puedes
          controlarlos.
        </p>

        <h2>Qué datos recopilamos</h2>
        <p>Solo recopilamos datos cuando decides iniciar sesión con tu cuenta de Google. Sin iniciar sesión, puedes navegar Inicio, Picks, Calendario y ver el chat en vivo sin que guardemos nada tuyo.</p>
        <div className="card">
          <ul>
            <li><strong>De tu cuenta de Google:</strong> nombre, correo electrónico y foto de perfil (Google los comparte con nosotros cuando aceptas iniciar sesión — no vemos ni guardamos tu contraseña, eso lo maneja Google directamente).</li>
            <li><strong>Picks que sigues:</strong> qué picks marcaste con la estrella (☆), para mostrártelos en "Seguidos" y avisarte cuando cambien.</li>
            <li><strong>Suscripción a notificaciones push:</strong> si activas la campana 🔔, tu navegador genera una suscripción (una dirección técnica + llaves de cifrado) que guardamos para poder enviarte avisos — no incluye tu ubicación ni nada del dispositivo más allá de eso.</li>
            <li><strong>Mensajes del chat en vivo:</strong> si escribes en el chat de un partido, tu nombre, foto y mensaje quedan visibles públicamente para cualquiera que abra ese partido (con o sin sesión iniciada).</li>
            <li><strong>Tu banco personal simulado ("Mi Bankroll"):</strong> el monto y nivel de riesgo que elijas para el simulador — es un valor que tú mismo escribes, no dinero real.</li>
          </ul>
        </div>

        <h2>Para qué los usamos</h2>
        <ul>
          <li>Mostrar tu sesión iniciada (tu nombre/foto en el ícono de perfil).</li>
          <li>Guardar y mostrarte los picks que sigues, incluso después de que el partido termine.</li>
          <li>Enviarte una notificación cuando cierre un set o termine un partido que sigues (solo si activaste la campana).</li>
          <li>Mostrar el chat en vivo de cada partido.</li>
          <li>Calcular tu balance simulado en "Mi Bankroll" a partir de los picks que sigues.</li>
          <li>Contar cuántas personas están registradas (solo un número total, sin exponer quién eres — visible únicamente para el administrador del sitio).</li>
        </ul>

        <h2>Con quién compartimos tus datos</h2>
        <p>No vendemos ni compartimos tus datos con nadie fuera de los proveedores que hacen funcionar el sitio:</p>
        <ul>
          <li><strong>Google</strong> — solo para el inicio de sesión (OAuth). No le mandamos tu actividad dentro del sitio.</li>
          <li><strong>Supabase</strong> — nuestra base de datos y autenticación (aloja todo lo descrito arriba).</li>
          <li><strong>Vercel</strong> — aloja el sitio web en sí.</li>
        </ul>

        <h2>Cookies y almacenamiento local</h2>
        <p>
          Usamos el almacenamiento local de tu navegador (localStorage) para recordar tu preferencia de tema
          (oscuro/claro/sistema) y tu sesión de Google (a través de Supabase Auth), no para rastrearte en otros
          sitios ni para publicidad — CAMILOREY no muestra anuncios de terceros.
        </p>

        <h2>Tus derechos</h2>
        <p>
          Puedes cerrar sesión en cualquier momento desde tu perfil. Si quieres que eliminemos tu cuenta y todos los
          datos asociados (picks seguidos, suscripción de notificaciones, configuración de Mi Bankroll), escríbenos a{' '}
          <a href={`mailto:${ADMIN_EMAIL}`}>{ADMIN_EMAIL}</a> y lo hacemos manualmente.
        </p>

        <h2>Edad mínima</h2>
        <p>CAMILOREY está dirigido exclusivamente a mayores de 18 años, en línea con el contenido relacionado a apuestas deportivas que analizamos.</p>

        <h2>Cambios a esta política</h2>
        <p>Si cambiamos qué datos recopilamos o para qué los usamos, actualizamos esta página con la nueva fecha arriba.</p>

        <h2>Contacto</h2>
        <p>
          Cualquier pregunta sobre esta política o tus datos: <a href={`mailto:${ADMIN_EMAIL}`}>{ADMIN_EMAIL}</a>.
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

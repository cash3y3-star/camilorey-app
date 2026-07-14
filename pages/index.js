import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { supabaseClient } from '../lib/supabaseClient';
import { logError } from '../lib/logError';

const VIEWS = [
  'inicio',
  'calendario',
  'picks',
  'seguidos',
  'bankroll',
  'grupos',
  'modelo',
  'errores',
  'mibankroll',
  'actividad',
  'admin'
];
// Las 5 vistas que antes vivían sueltas en el menú, ahora agrupadas
// bajo un solo botón "Admin" (ver la sección admin más abajo).
const ADMIN_VIEWS = ['bankroll', 'grupos', 'modelo', 'errores', 'actividad'];
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const THEME_KEY = 'camilorey_theme';
const LANG_KEY = 'camilorey_lang';

// Sistema de idiomas — español (default, SSR siempre lo usa) + inglés.
// t('clave', {var:valor}) devuelve el texto de TRANSLATIONS[lang] (o
// español si falta la clave en el idioma elegido, para que nunca
// aparezca un hueco en blanco si algo queda sin traducir todavía).
// Primera pasada: cubre el menú, encabezados de cada vista, Perfil
// completo y los textos comunes (botones, disclaimer). El contenido
// que viene de la base (nombres de jugadores, torneos, análisis de
// picks) se arma con esta misma función donde ya se puede — el resto
// se traduce en una segunda pasada.
const TRANSLATIONS = {
  es: {
    navInicio: 'Inicio',
    navCalendario: 'Calendario',
    navPicks: 'Picks',
    navSeguidos: 'Seguidos',
    navMiBankroll: 'Mi Bankroll',
    navBankroll: 'Bankroll',
    navGrupos: 'Grupos',
    navModelo: 'Modelo',
    navErrores: 'Errores',
    entrar: 'Entrar',
    cerrarSesion: 'Cerrar sesión',
    cargando: 'Cargando…',
    tuNombre: 'Tu nombre',
    notifActivadas: 'Activadas — te avisamos de tus picks seguidos',
    notifBloqueadas: 'Bloqueadas en el navegador — toca para ver cómo activarlas',
    notifToca: 'Toca para activar avisos de tus picks seguidos',
    statusActivas: 'Activas',
    statusActivar: 'Activar',
    guardar: 'Guardar',

    inicioEyebrow: 'Liga Pro Checa · Tenis de mesa',
    inicioTitle: 'Picks del día',
    inicioSub: 'Análisis propio sobre partidos de la Liga Pro Checa, contrastado con nuestro propio historial.',
    holaSaludo: 'Hola',
    statEfectividad: 'Efectividad',
    statRachaActual: 'Racha actual',
    statROI: 'ROI',
    statBalance: 'Balance',
    enVivoAhora: 'En vivo ahora',
    pickDestacado: 'Pick destacado del día',
    noHayPicksActivos: 'No hay picks activos en este momento.',
    verTodosPicks: 'Ver todos los picks →',

    picksEyebrow: 'Todos los picks',
    picksTitle: 'Picks',
    picksEnEstaCategoria: 'picks en esta categoría',
    tabTodos: 'Todos',
    tabPendientes: 'Pendientes',
    tabGanados: 'Ganados',
    tabPerdidos: 'Perdidos',
    noHayPicksCategoria: 'No hay picks en esta categoría todavía.',

    calendarioEyebrow: 'Liga Pro Checa',
    calendarioTitle: 'Calendario',
    calendarioSub: 'Partidos próximos y finalizados. Los que están en vivo ahora mismo están en Inicio.',
    filtroProximos: 'PRÓXIMOS',
    filtroFinalizados: 'FINALIZADOS',
    filtroTodos: 'TODOS',
    partidosDeHoy: 'Partidos de hoy',
    partidos: 'Partidos',
    noHayPartidosCategoria: 'No hay partidos en esta categoría para este día.',

    seguidosEyebrow: 'Tus picks seguidos',
    seguidosTitle: 'Seguidos',
    seguidosSub: 'Sigue un pick tocando la estrella y te avisamos con una notificación cuando termine un set o el partido.',
    iniciaSesionSeguir: 'Inicia sesión con Google (arriba a la derecha) para seguir picks.',
    noSiguesNingunPick: 'Todavía no sigues ningún pick — toca la ☆ en cualquier tarjeta.',

    miBankrollEyebrow: 'Simulador personal',
    miBankrollTitle: 'Mi Bankroll',
    miBankrollSub:
      'Cómo te habría ido apostando con Kelly solo en los picks que sigues — no es dinero real, es para que practiques el tamaño de apuesta antes de arriesgar el tuyo.',
    iniciaSesionBankroll: 'Inicia sesión con Google (arriba a la derecha) para armar tu bankroll.',
    funcionPremium: 'Función premium',
    funcionPremiumDesc:
      'Mi Bankroll va a estar disponible próximamente para cuentas premium — todavía no hay nada que pagar, solo estamos avisando antes de abrirlo.',
    miBankrollVacioTitle: 'Sin historial todavía',
    miBankrollVacioDesc:
      'Todavía no tienes picks seguidos que ya se hayan jugado — sigue algunos desde Picks o Calendario y vuelve cuando terminen.',
    miBankrollTrialMsg: '🎁 Gratis por tiempo limitado — Mi Bankroll será una función premium a partir del {date}.',

    perfilPlanGratuito: 'Plan gratuito',
    perfilPlanPremium: 'Plan premium',
    perfilMiembroDesde: 'Miembro desde',
    mejoraTuPlan: 'Mejora tu plan',
    mejoraTuPlanDesc: 'Mi Bankroll y más funciones premium',
    verPlanes: 'Ver Planes ›',
    plansTitle: 'Elige tu plan Premium',
    plansBullet1: 'Detección de cuotas con valor (edge) frente al mercado',
    plansBullet2: 'Mi Bankroll, H2H completo y análisis con IA sin límites',
    plansBullet3: 'Cancela cuando quieras, sin letra chica',
    plansCardBadge: 'ACCESO COMPLETO',
    plansCardName: 'CAMILOREY Premium',
    plansCardDesc: 'Para quien sigue los picks en serio',
    plansFeatRacha: 'Racha reciente',
    plansFeatPrecision: 'Precisión de acierto',
    plansFeatCuotas: 'Cuotas en vivo (Rushbet)',
    plansFeatEdge: 'Edge % frente al mercado',
    plansFeatHistorico: 'Historial L5 · L10 · L20',
    plansFeatKelly: 'Bankroll con criterio de Kelly',
    plansFeatLocalVisitante: 'Forma de local y visitante',
    plansFeatIA: 'Análisis con IA por partido',
    plansFeatH2H: 'Head-to-head completo',
    plansFeatAlertas: 'Alertas de picks en tiempo real',
    plansCta: 'Suscribirme',
    plansCtaNote:
      'El pago se hace fuera del sitio, en un link seguro. Cuando termines, escríbenos al correo o por Telegram con el correo de tu cuenta CAMILOREY y activamos tu acceso premium en minutos.',
    plansSoon: 'Muy pronto vas a poder mejorar tu plan — todavía no hay nada que pagar, solo estamos avisando antes de abrirlo.',
    plansToggleMensual: 'Mensual',
    plansToggleAnual: 'Anual (-50%)',
    plansPeriodMensual: 'mes',
    plansPeriodAnual: 'año',
    plansSavingsAnual: ' — Ahorras US$100.00 (50%)',
    plansCancelaCuandoQuieras: 'Cancela cuando quieras',
    cuentaTitle: 'Cuenta',
    cuentaCambiarFoto: 'Cambiar Foto',
    cuentaFotoSoon: 'Muy pronto vas a poder cambiar tu foto de perfil.',
    cuentaNombreCompleto: 'Nombre Completo',
    cuentaEmail: 'Email',
    cuentaMiembroDesde: 'Miembro Desde',
    cuentaIdUsuario: 'ID de Usuario',
    editar: 'Editar',
    cuentaEliminarBtn: 'Eliminar Cuenta',
    cuentaEmailEditNota: 'Te vamos a mandar un correo de confirmación a la dirección nueva antes de hacer el cambio.',
    delEyebrow: 'CAMILOREY · ZONA DE PELIGRO',
    delTitle: 'Esto no se puede deshacer',
    delDesc: 'Una vez que elimines tu cuenta, todos tus datos se eliminan permanentemente y no se pueden recuperar.',
    delQueSeElimina: 'QUÉ SE ELIMINARÁ',
    delItem1Title: 'Todos tus picks seguidos',
    delItem1Desc: 'Tu bankroll, tus picks seguidos y todo tu historial se eliminarán permanentemente.',
    delItem2Title: 'Notificaciones canceladas',
    delItem2Desc: 'Todas las alertas y notificaciones programadas se detendrán inmediatamente.',
    delItem3Title: 'Suscripción cancelada',
    delItem3Desc: 'Cualquier suscripción activa será cancelada sin reembolso por el tiempo restante.',
    delItem4Title: 'Cuenta bloqueada',
    delItem4Desc: 'Se cerrará tu sesión inmediatamente y no podrás recuperar la cuenta.',
    delConfirmarEliminacion: 'CONFIRMAR ELIMINACIÓN',
    delCheckboxLabel: 'Entiendo que esta acción es permanente y no se puede revertir',
    delEscribePara: 'Escribe {word} para confirmar',
    delPlaceholder: 'Escribe {word} aquí',
    delBoton: 'Eliminar Mi Cuenta',
    delEliminando: 'Eliminando...',
    delPalabraConfirmacion: 'ELIMINAR',
    delErrorGenerico: 'No se pudo eliminar la cuenta, intenta de nuevo.',
    ajustes: 'AJUSTES',
    filaNotificaciones: 'Notificaciones',
    filaSuscripcion: 'Suscripción',
    filaSuscripcionDesc: 'Administra tu plan',
    filaCuotas: 'Formato de Cuotas',
    filaTema: 'Tema',
    filaTemaDesc: 'Elige cómo se ve CAMILOREY en este dispositivo.',
    filaIdioma: 'Idioma',
    filaPrivacidad: 'Privacidad',
    filaPrivacidadDesc: 'Qué datos guardamos y cómo los usamos',
    filaTerminosDesc: 'Qué es CAMILOREY y qué no es',
    filaAyuda: 'Ayuda y Soporte',
    filaAyudaDesc: 'Escríbenos si algo no funciona o tienes una duda',
    ayudaFaqTitle: 'Ayuda y FAQ',
    ayudaFaqDesc: 'Encuentra respuestas o contacta a nuestro equipo',
    soporteEmail: 'Soporte por Email',
    respuesta24h: 'respuesta en 24h',
    preguntasFrecuentes: 'PREGUNTAS FRECUENTES',

    temaOscuro: 'Oscuro',
    temaOscuroDesc: 'Siempre usar modo oscuro',
    temaClaro: 'Claro',
    temaClaroDesc: 'Siempre usar modo claro',
    temaSistema: 'Sistema',
    temaSistemaDesc: 'Seguir ajustes del dispositivo',
    vistaPrevia: 'Vista previa',

    idiomaEspanol: 'Español',
    idiomaIngles: 'Inglés',
    idiomaPortugues: 'Portugués',
    oddsDecimal: 'Decimal',
    oddsAmericano: 'Americano',
    oddsFraccional: 'Fraccional',
    oddsHongkong: 'Hong Kong',
    oddsIndonesio: 'Indonesio',

    footerDisclaimer:
      'ofrece análisis y opiniones propias con fines informativos y de entretenimiento sobre la Liga Pro Checa de tenis de mesa. No garantizamos resultados y no gestionamos apuestas ni fondos de terceros. Servicio dirigido exclusivamente a mayores de 18 años. Si sientes que el juego deja de ser un entretenimiento, busca ayuda profesional. Juega siempre con responsabilidad.',
    politicaPrivacidad: 'Política de Privacidad',
    terminosCondiciones: 'Términos y Condiciones',

    loginTitle: 'Iniciar sesión',
    loginSub: 'Utiliza tu cuenta de Google para continuar',
    loginBtnGoogle: 'Iniciar sesión con Google',
    loginNote: 'No almacenamos tu contraseña. Autenticación segura con Google.',

    privacyEyebrow: 'CAMILOREY · PRIVACIDAD',
    privacyTitle: 'Tus datos, tu decisión',
    privacyIntro:
      'Guardamos lo mínimo para que el sitio funcione. Nada de esto se vende ni se comparte con nadie fuera de Google, Supabase y Vercel (quienes hacen funcionar el sitio).',
    privacy1Title: 'Qué recopilamos',
    privacy1Desc:
      'Tu nombre, correo y foto de Google al iniciar sesión, los picks que sigues, y lo que personalices en tu perfil. No pedimos datos de tarjetas ni gestionamos apuestas.',
    privacy2Title: 'Cómo lo usamos',
    privacy2Desc:
      'Para mostrar tu sesión, tus picks seguidos, avisarte cuando termine un partido que sigues, y el chat en vivo. Nada más.',
    privacy3Title: 'Tu control',
    privacy3Desc: 'Cambia tu nombre, foto o notificaciones cuando quieras desde tu Perfil. Escríbenos si quieres que borremos tu cuenta.',
    aceptar: 'Aceptar',
    privacyFootnote: 'Puedes ver el detalle completo en la',

    riskEyebrow: 'Gestión de riesgo',
    riskSiguiendo: 'Estás siguiendo',
    riskPick: 'pick',
    riskPicks: 'picks',
    entendido: 'Entendido',
    riskDisclaimer: 'Esto no es asesoría financiera. Usa estos datos con responsabilidad.',

    tabResumen: 'Resumen',
    tabEstadisticas: 'Estadísticas',
    tabAnalisis: 'Análisis',
    tabH2H: 'H2H',
    sets: 'Sets',
    indiceIA: 'Índice IA',
    cuotaRushbet: 'Cuota (Rushbet)',
    racha: 'Racha',
    noDisponible: 'No disponible',
    sinVentaja: 'Sin ventaja — Kelly no apostó',
    acierto: 'Acierto',
    fallado: 'Fallado',
    ultimos: 'Últimos',
    partidosPl: 'partidos',
    victorias: 'victorias',
    derrotas: 'derrotas',
    sinHistorial: 'Sin historial reciente todavía.',
    h2hContra: 'H2H contra',
    sinEnfrentamientos: 'Todavía no se han enfrentado.',
    buscandoMarcador: 'Buscando marcador…',
    resultadoFinal: 'Resultado final:',
    partidoNoEmpieza: 'Este partido todavía no empieza.',
    formaReciente: 'Forma reciente ·',
    partidoDetallado: 'Partido detallado',
    partidoTerminadoRecarga: 'Partido terminado — recarga la página para ver el resultado final.',
    corriendo: 'corriendo',
    pausado: 'pausado',
    ahora: 'Ahora',
    rushbetSinTablero: 'Rushbet no tiene este partido en su tablero en vivo — mostrando el marcador de tt.league-pro.com (menos detallado, sin punto a punto).',
    setsDosPuntos: 'Sets:',
    sinSetsCerrados: 'Este partido está en curso, todavía sin sets cerrados.',
    buscandoMarcadorVivo: 'Buscando marcador en vivo…',
    sinDetallePuntoAPunto: 'No tenemos el detalle punto a punto de este partido — solo se guarda para los que alguien vio en vivo mientras se jugaban.',

    analisisForma: 'En sus últimos {n} partidos, {player} ganó {wins} ({pct}%).',
    analisisSinHistorial: 'Todavía no tenemos suficiente historial reciente de {player}.',
    analisisRacha: 'Llega con una racha de {streak}.',
    analisisH2H: 'En los enfrentamientos directos contra {opponent}, tiene un récord de {record}.',
    analisisCuotaValor: 'La cuota de Rushbet ({odds}) implica una probabilidad de {implied}% — nuestro modelo le da {confidence}%.',
    analisisSinCuota: 'Todavía no tenemos la cuota real de Rushbet para este partido.',

    onboarding1Title: 'Picks basados en datos reales',
    onboarding1Desc:
      'Analizamos el rating, la racha reciente y los enfrentamientos directos de cada jugador de la Liga Pro Checa — nada de números inventados.',
    onboarding2Title: '¿Qué es el Índice IA?',
    onboarding2Desc:
      'Es el % de confianza que arma nuestro modelo combinando esos factores. No es una garantía — mirá la pestaña Modelo para ver el acierto real medido, incluso cuando es bajo.',
    onboarding3Title: 'Mi Bankroll: practicá sin arriesgar',
    onboarding3Desc:
      'Simulá cuánto apostarías con el criterio de Kelly en los picks que seguís — no es dinero real, es para practicar el tamaño de tus apuestas antes de arriesgar el tuyo.',
    onboardingSiguiente: 'Siguiente',
    onboardingEntendido: 'Entendido',
    onboardingSaltar: 'Saltar'
  },
  en: {
    navInicio: 'Home',
    navCalendario: 'Schedule',
    navPicks: 'Picks',
    navSeguidos: 'Following',
    navMiBankroll: 'My Bankroll',
    navBankroll: 'Bankroll',
    navGrupos: 'Groups',
    navModelo: 'Model',
    navErrores: 'Errors',
    entrar: 'Sign in',
    cerrarSesion: 'Sign out',
    cargando: 'Loading…',
    tuNombre: 'Your name',
    notifActivadas: "Enabled — we'll notify you about your followed picks",
    notifBloqueadas: 'Blocked in your browser — tap to see how to enable them',
    notifToca: 'Tap to enable alerts for your followed picks',
    statusActivas: 'On',
    statusActivar: 'Enable',
    guardar: 'Save',

    inicioEyebrow: 'Czech Liga Pro · Table tennis',
    inicioTitle: "Today's picks",
    inicioSub: 'Our own analysis of Czech Liga Pro matches, checked against our own track record.',
    holaSaludo: 'Hi',
    statEfectividad: 'Accuracy',
    statRachaActual: 'Current streak',
    statROI: 'ROI',
    statBalance: 'Balance',
    enVivoAhora: 'Live now',
    pickDestacado: "Today's featured pick",
    noHayPicksActivos: 'No active picks right now.',
    verTodosPicks: 'See all picks →',

    picksEyebrow: 'All picks',
    picksTitle: 'Picks',
    picksEnEstaCategoria: 'picks in this category',
    tabTodos: 'All',
    tabPendientes: 'Pending',
    tabGanados: 'Won',
    tabPerdidos: 'Lost',
    noHayPicksCategoria: 'No picks in this category yet.',

    calendarioEyebrow: 'Czech Liga Pro',
    calendarioTitle: 'Schedule',
    calendarioSub: 'Upcoming and finished matches. Anything live right now is on the Home tab.',
    filtroProximos: 'UPCOMING',
    filtroFinalizados: 'FINISHED',
    filtroTodos: 'ALL',
    partidosDeHoy: "Today's matches",
    partidos: 'Matches',
    noHayPartidosCategoria: 'No matches in this category for this day.',

    seguidosEyebrow: 'Your followed picks',
    seguidosTitle: 'Following',
    seguidosSub: 'Follow a pick by tapping the star and we’ll notify you when a set or the match ends.',
    iniciaSesionSeguir: 'Sign in with Google (top right) to follow picks.',
    noSiguesNingunPick: "You aren't following any picks yet — tap the ☆ on any card.",

    miBankrollEyebrow: 'Personal simulator',
    miBankrollTitle: 'My Bankroll',
    miBankrollSub:
      "How you'd have done betting Kelly stakes only on the picks you follow — not real money, just practice sizing your bets before risking your own.",
    iniciaSesionBankroll: 'Sign in with Google (top right) to set up your bankroll.',
    funcionPremium: 'Premium feature',
    funcionPremiumDesc:
      "My Bankroll will be available soon for premium accounts — there's nothing to pay yet, we're just giving you a heads up before it opens.",
    miBankrollVacioTitle: 'No history yet',
    miBankrollVacioDesc:
      "You don't have any followed picks that have already been played yet — follow some from Picks or Schedule and come back once they finish.",
    miBankrollTrialMsg: '🎁 Free for a limited time — My Bankroll becomes a premium feature starting {date}.',

    perfilPlanGratuito: 'Free plan',
    perfilPlanPremium: 'Premium plan',
    perfilMiembroDesde: 'Member since',
    mejoraTuPlan: 'Upgrade your plan',
    mejoraTuPlanDesc: 'My Bankroll and more premium features',
    verPlanes: 'See Plans ›',
    plansTitle: 'Choose your Premium plan',
    plansBullet1: 'Value-edge odds detection against the market',
    plansBullet2: 'My Bankroll, full H2H, and unlimited AI analysis',
    plansBullet3: 'Cancel anytime, no fine print',
    plansCardBadge: 'FULL ACCESS',
    plansCardName: 'CAMILOREY Premium',
    plansCardDesc: 'For people who follow picks seriously',
    plansFeatRacha: 'Recent streak',
    plansFeatPrecision: 'Hit accuracy',
    plansFeatCuotas: 'Live odds (Rushbet)',
    plansFeatEdge: 'Edge % against the market',
    plansFeatHistorico: 'L5 · L10 · L20 history',
    plansFeatKelly: 'Kelly-criterion bankroll',
    plansFeatLocalVisitante: 'Home and away form',
    plansFeatIA: 'AI analysis per match',
    plansFeatH2H: 'Full head-to-head',
    plansFeatAlertas: 'Real-time pick alerts',
    plansCta: 'Subscribe',
    plansCtaNote:
      "Payment happens off-site, through a secure link. Once you're done, write to us by email or Telegram with your CAMILOREY account email and we'll activate your premium access within minutes.",
    plansSoon: "You'll be able to upgrade your plan very soon — there's nothing to pay yet, we're just giving you a heads up before it opens.",
    plansToggleMensual: 'Monthly',
    plansToggleAnual: 'Yearly (-50%)',
    plansPeriodMensual: 'mo',
    plansPeriodAnual: 'yr',
    plansSavingsAnual: ' — Save US$100.00 (50%)',
    plansCancelaCuandoQuieras: 'Cancel anytime',
    cuentaTitle: 'Account',
    cuentaCambiarFoto: 'Change Photo',
    cuentaFotoSoon: "You'll be able to change your profile photo very soon.",
    cuentaNombreCompleto: 'Full Name',
    cuentaEmail: 'Email',
    cuentaMiembroDesde: 'Member Since',
    cuentaIdUsuario: 'User ID',
    editar: 'Edit',
    cuentaEliminarBtn: 'Delete Account',
    cuentaEmailEditNota: "We'll send a confirmation email to your new address before making the change.",
    delEyebrow: 'CAMILOREY · DANGER ZONE',
    delTitle: "This can't be undone",
    delDesc: 'Once you delete your account, all your data is permanently erased and cannot be recovered.',
    delQueSeElimina: "WHAT WILL BE DELETED",
    delItem1Title: 'All your followed picks',
    delItem1Desc: 'Your bankroll, followed picks, and entire history will be permanently deleted.',
    delItem2Title: 'Notifications canceled',
    delItem2Desc: 'All scheduled alerts and notifications will stop immediately.',
    delItem3Title: 'Subscription canceled',
    delItem3Desc: 'Any active subscription will be canceled with no refund for remaining time.',
    delItem4Title: 'Account locked',
    delItem4Desc: "You'll be signed out immediately and the account cannot be recovered.",
    delConfirmarEliminacion: 'CONFIRM DELETION',
    delCheckboxLabel: 'I understand this action is permanent and cannot be reversed',
    delEscribePara: 'Type {word} to confirm',
    delPlaceholder: 'Type {word} here',
    delBoton: 'Delete My Account',
    delEliminando: 'Deleting...',
    delPalabraConfirmacion: 'DELETE',
    delErrorGenerico: "Couldn't delete the account, try again.",
    ajustes: 'SETTINGS',
    filaNotificaciones: 'Notifications',
    filaSuscripcion: 'Subscription',
    filaSuscripcionDesc: 'Manage your plan',
    filaCuotas: 'Odds Format',
    filaTema: 'Theme',
    filaTemaDesc: 'Choose how CAMILOREY looks on this device.',
    filaIdioma: 'Language',
    filaPrivacidad: 'Privacy',
    filaPrivacidadDesc: 'What data we store and how we use it',
    filaTerminosDesc: 'What CAMILOREY is and isn’t',
    filaAyuda: 'Help & Support',
    filaAyudaDesc: "Write to us if something's not working or you have a question",
    ayudaFaqTitle: 'Help & FAQ',
    ayudaFaqDesc: 'Find answers or contact our team',
    soporteEmail: 'Email Support',
    respuesta24h: 'reply within 24h',
    preguntasFrecuentes: 'FREQUENTLY ASKED QUESTIONS',

    temaOscuro: 'Dark',
    temaOscuroDesc: 'Always use dark mode',
    temaClaro: 'Light',
    temaClaroDesc: 'Always use light mode',
    temaSistema: 'System',
    temaSistemaDesc: 'Follow device settings',
    vistaPrevia: 'Preview',

    idiomaEspanol: 'Spanish',
    idiomaIngles: 'English',
    idiomaPortugues: 'Portuguese',
    oddsDecimal: 'Decimal',
    oddsAmericano: 'American',
    oddsFraccional: 'Fractional',
    oddsHongkong: 'Hong Kong',
    oddsIndonesio: 'Indonesian',

    footerDisclaimer:
      "provides our own analysis and opinions for informational and entertainment purposes about the Czech Liga Pro table tennis league. We don't guarantee results and we don't handle bets or funds on anyone's behalf. Service intended exclusively for adults 18 and over. If gambling stops being entertainment for you, seek professional help. Always play responsibly.",
    politicaPrivacidad: 'Privacy Policy',
    terminosCondiciones: 'Terms and Conditions',

    loginTitle: 'Sign in',
    loginSub: 'Use your Google account to continue',
    loginBtnGoogle: 'Sign in with Google',
    loginNote: "We don't store your password. Secure authentication via Google.",

    privacyEyebrow: 'CAMILOREY · PRIVACY',
    privacyTitle: 'Your data, your choice',
    privacyIntro:
      "We keep the minimum needed for the site to work. None of this is sold or shared with anyone outside Google, Supabase, and Vercel (who run the site).",
    privacy1Title: 'What we collect',
    privacy1Desc:
      "Your name, email, and photo from Google when you sign in, the picks you follow, and whatever you personalize in your profile. We don't ask for card details or handle bets.",
    privacy2Title: 'How we use it',
    privacy2Desc: "To show your session, your followed picks, notify you when a match you follow ends, and the live chat. Nothing else.",
    privacy3Title: 'Your control',
    privacy3Desc: 'Change your name, photo, or notifications anytime from your Profile. Write to us if you want your account deleted.',
    aceptar: 'Accept',
    privacyFootnote: 'You can see the full details in the',

    riskEyebrow: 'Risk management',
    riskSiguiendo: "You're following",
    riskPick: 'pick',
    riskPicks: 'picks',
    entendido: 'Got it',
    riskDisclaimer: 'This is not financial advice. Use this data responsibly.',

    tabResumen: 'Summary',
    tabEstadisticas: 'Stats',
    tabAnalisis: 'Analysis',
    tabH2H: 'H2H',
    sets: 'Sets',
    indiceIA: 'AI Score',
    cuotaRushbet: 'Odds (Rushbet)',
    racha: 'Streak',
    noDisponible: 'Not available',
    sinVentaja: "No edge — Kelly didn't bet",
    acierto: 'Hit',
    fallado: 'Miss',
    ultimos: 'Last',
    partidosPl: 'matches',
    victorias: 'wins',
    derrotas: 'losses',
    sinHistorial: 'No recent history yet.',
    h2hContra: 'H2H vs',
    sinEnfrentamientos: "They haven't played each other yet.",
    buscandoMarcador: 'Looking for the score…',
    resultadoFinal: 'Final result:',
    partidoNoEmpieza: "This match hasn't started yet.",
    formaReciente: 'Recent form ·',
    partidoDetallado: 'Match details',
    partidoTerminadoRecarga: 'Match finished — reload the page to see the final result.',
    corriendo: 'running',
    pausado: 'paused',
    ahora: 'Now',
    rushbetSinTablero: "Rushbet doesn't have this match on their live board — showing the score from tt.league-pro.com instead (less detail, no point-by-point).",
    setsDosPuntos: 'Sets:',
    sinSetsCerrados: 'This match is in progress, no sets closed yet.',
    buscandoMarcadorVivo: 'Looking for the live score…',
    sinDetallePuntoAPunto: "We don't have point-by-point detail for this match — that's only saved for matches someone watched live on our site.",

    analisisForma: 'In their last {n} matches, {player} won {wins} ({pct}%).',
    analisisSinHistorial: "We don't have enough recent history for {player} yet.",
    analisisRacha: 'They come in on a {streak} streak.',
    analisisH2H: 'Head-to-head against {opponent}, the record is {record}.',
    analisisCuotaValor: 'Rushbet odds ({odds}) imply a {implied}% probability — our model gives them {confidence}%.',
    analisisSinCuota: "We don't have real Rushbet odds for this match yet.",

    onboarding1Title: 'Picks backed by real data',
    onboarding1Desc:
      "We analyze each Czech Liga Pro player's rating, recent streak, and head-to-head record — nothing made up.",
    onboarding2Title: 'What is the AI Score?',
    onboarding2Desc:
      "It's the confidence % our model builds by combining those factors. It's not a guarantee — check the Model tab to see the real measured accuracy, even when it's low.",
    onboarding3Title: 'My Bankroll: practice without risk',
    onboarding3Desc:
      "Simulate how much you'd bet using the Kelly criterion on the picks you follow — not real money, just practice sizing your bets before risking your own.",
    onboardingSiguiente: 'Next',
    onboardingEntendido: 'Got it',
    onboardingSaltar: 'Skip'
  },
  pt: {
    navInicio: 'Início',
    navCalendario: 'Calendário',
    navPicks: 'Picks',
    navSeguidos: 'Seguindo',
    navMiBankroll: 'Minha Banca',
    navBankroll: 'Banca',
    navGrupos: 'Grupos',
    navModelo: 'Modelo',
    navErrores: 'Erros',
    entrar: 'Entrar',
    cerrarSesion: 'Sair',
    cargando: 'Carregando…',
    tuNombre: 'Seu nome',
    notifActivadas: 'Ativadas — vamos te avisar sobre os picks que você segue',
    notifBloqueadas: 'Bloqueadas no navegador — toque para ver como ativá-las',
    notifToca: 'Toque para ativar avisos dos picks que você segue',
    statusActivas: 'Ativas',
    statusActivar: 'Ativar',
    guardar: 'Salvar',

    inicioEyebrow: 'Liga Pro Checa · Tênis de mesa',
    inicioTitle: 'Picks do dia',
    inicioSub: 'Nossa própria análise dos jogos da Liga Pro Checa, comparada com nosso histórico real.',
    holaSaludo: 'Olá',
    statEfectividad: 'Efetividade',
    statRachaActual: 'Sequência atual',
    statROI: 'ROI',
    statBalance: 'Saldo',
    enVivoAhora: 'Ao vivo agora',
    pickDestacado: 'Pick em destaque do dia',
    noHayPicksActivos: 'Não há picks ativos no momento.',
    verTodosPicks: 'Ver todos os picks →',

    picksEyebrow: 'Todos os picks',
    picksTitle: 'Picks',
    picksEnEstaCategoria: 'picks nesta categoria',
    tabTodos: 'Todos',
    tabPendientes: 'Pendentes',
    tabGanados: 'Ganhos',
    tabPerdidos: 'Perdidos',
    noHayPicksCategoria: 'Ainda não há picks nesta categoria.',

    calendarioEyebrow: 'Liga Pro Checa',
    calendarioTitle: 'Calendário',
    calendarioSub: 'Jogos próximos e finalizados. Os que estão ao vivo agora estão na aba Início.',
    filtroProximos: 'PRÓXIMOS',
    filtroFinalizados: 'FINALIZADOS',
    filtroTodos: 'TODOS',
    partidosDeHoy: 'Jogos de hoje',
    partidos: 'Jogos',
    noHayPartidosCategoria: 'Não há jogos nesta categoria para este dia.',

    seguidosEyebrow: 'Seus picks seguidos',
    seguidosTitle: 'Seguindo',
    seguidosSub: 'Siga um pick tocando na estrela e vamos te avisar quando um set ou a partida terminar.',
    iniciaSesionSeguir: 'Entre com o Google (canto superior direito) para seguir picks.',
    noSiguesNingunPick: 'Você ainda não segue nenhum pick — toque no ☆ em qualquer cartão.',

    miBankrollEyebrow: 'Simulador pessoal',
    miBankrollTitle: 'Minha Banca',
    miBankrollSub:
      'Como teria sido apostando com Kelly só nos picks que você segue — não é dinheiro real, é para praticar o tamanho das apostas antes de arriscar o seu.',
    iniciaSesionBankroll: 'Entre com o Google (canto superior direito) para montar sua banca.',
    funcionPremium: 'Função premium',
    funcionPremiumDesc:
      'Minha Banca estará disponível em breve para contas premium — ainda não há nada para pagar, só estamos avisando antes de abrir.',
    miBankrollVacioTitle: 'Ainda sem histórico',
    miBankrollVacioDesc:
      'Você ainda não tem picks seguidos que já tenham sido jogados — siga alguns em Picks ou Calendário e volte quando terminarem.',
    miBankrollTrialMsg: '🎁 Grátis por tempo limitado — Minha Banca vai virar uma função premium a partir de {date}.',

    perfilPlanGratuito: 'Plano gratuito',
    perfilPlanPremium: 'Plano premium',
    perfilMiembroDesde: 'Membro desde',
    mejoraTuPlan: 'Melhore seu plano',
    mejoraTuPlanDesc: 'Minha Banca e mais funções premium',
    verPlanes: 'Ver Planos ›',
    plansTitle: 'Escolha seu plano Premium',
    plansBullet1: 'Detecção de odds com valor (edge) frente ao mercado',
    plansBullet2: 'Minha Banca, H2H completo e análise com IA sem limites',
    plansBullet3: 'Cancele quando quiser, sem letras miúdas',
    plansCardBadge: 'ACESSO COMPLETO',
    plansCardName: 'CAMILOREY Premium',
    plansCardDesc: 'Para quem acompanha os picks a sério',
    plansFeatRacha: 'Sequência recente',
    plansFeatPrecision: 'Precisão de acerto',
    plansFeatCuotas: 'Odds ao vivo (Rushbet)',
    plansFeatEdge: 'Edge % frente ao mercado',
    plansFeatHistorico: 'Histórico L5 · L10 · L20',
    plansFeatKelly: 'Banca com critério de Kelly',
    plansFeatLocalVisitante: 'Forma como mandante e visitante',
    plansFeatIA: 'Análise com IA por partida',
    plansFeatH2H: 'Head-to-head completo',
    plansFeatAlertas: 'Alertas de picks em tempo real',
    plansCta: 'Assinar',
    plansCtaNote:
      'O pagamento é feito fora do site, em um link seguro. Quando terminar, escreva para nós por e-mail ou Telegram com o e-mail da sua conta CAMILOREY e ativamos seu acesso premium em minutos.',
    plansSoon: 'Muito em breve você vai poder melhorar seu plano — ainda não há nada para pagar, só estamos avisando antes de abrir.',
    plansToggleMensual: 'Mensal',
    plansToggleAnual: 'Anual (-50%)',
    plansPeriodMensual: 'mês',
    plansPeriodAnual: 'ano',
    plansSavingsAnual: ' — Economize US$100.00 (50%)',
    plansCancelaCuandoQuieras: 'Cancele quando quiser',
    cuentaTitle: 'Conta',
    cuentaCambiarFoto: 'Trocar Foto',
    cuentaFotoSoon: 'Muito em breve você vai poder trocar sua foto de perfil.',
    cuentaNombreCompleto: 'Nome Completo',
    cuentaEmail: 'Email',
    cuentaMiembroDesde: 'Membro Desde',
    cuentaIdUsuario: 'ID de Usuário',
    editar: 'Editar',
    cuentaEliminarBtn: 'Excluir Conta',
    cuentaEmailEditNota: 'Vamos enviar um e-mail de confirmação para o novo endereço antes de fazer a mudança.',
    delEyebrow: 'CAMILOREY · ZONA DE PERIGO',
    delTitle: 'Isso não pode ser desfeito',
    delDesc: 'Depois que você excluir sua conta, todos os seus dados são apagados permanentemente e não podem ser recuperados.',
    delQueSeElimina: 'O QUE SERÁ EXCLUÍDO',
    delItem1Title: 'Todos os seus picks seguidos',
    delItem1Desc: 'Sua banca, seus picks seguidos e todo o seu histórico serão excluídos permanentemente.',
    delItem2Title: 'Notificações canceladas',
    delItem2Desc: 'Todos os alertas e notificações programadas serão interrompidos imediatamente.',
    delItem3Title: 'Assinatura cancelada',
    delItem3Desc: 'Qualquer assinatura ativa será cancelada sem reembolso pelo tempo restante.',
    delItem4Title: 'Conta bloqueada',
    delItem4Desc: 'Sua sessão será encerrada imediatamente e a conta não poderá ser recuperada.',
    delConfirmarEliminacion: 'CONFIRMAR EXCLUSÃO',
    delCheckboxLabel: 'Entendo que essa ação é permanente e não pode ser revertida',
    delEscribePara: 'Digite {word} para confirmar',
    delPlaceholder: 'Digite {word} aqui',
    delBoton: 'Excluir Minha Conta',
    delEliminando: 'Excluindo...',
    delPalabraConfirmacion: 'EXCLUIR',
    delErrorGenerico: 'Não foi possível excluir a conta, tente de novo.',
    ajustes: 'AJUSTES',
    filaNotificaciones: 'Notificações',
    filaSuscripcion: 'Assinatura',
    filaSuscripcionDesc: 'Gerencie seu plano',
    filaCuotas: 'Formato de Odds',
    filaTema: 'Tema',
    filaTemaDesc: 'Escolha a aparência do CAMILOREY neste dispositivo.',
    filaIdioma: 'Idioma',
    filaPrivacidad: 'Privacidade',
    filaPrivacidadDesc: 'Quais dados guardamos e como os usamos',
    filaTerminosDesc: 'O que o CAMILOREY é e o que não é',
    filaAyuda: 'Ajuda e Suporte',
    filaAyudaDesc: 'Escreva para nós se algo não funcionar ou tiver dúvidas',
    ayudaFaqTitle: 'Ajuda e FAQ',
    ayudaFaqDesc: 'Encontre respostas ou fale com nossa equipe',
    soporteEmail: 'Suporte por Email',
    respuesta24h: 'resposta em 24h',
    preguntasFrecuentes: 'PERGUNTAS FREQUENTES',

    temaOscuro: 'Escuro',
    temaOscuroDesc: 'Sempre usar modo escuro',
    temaClaro: 'Claro',
    temaClaroDesc: 'Sempre usar modo claro',
    temaSistema: 'Sistema',
    temaSistemaDesc: 'Seguir configurações do dispositivo',
    vistaPrevia: 'Pré-visualização',

    idiomaEspanol: 'Espanhol',
    idiomaIngles: 'Inglês',
    idiomaPortugues: 'Português',
    oddsDecimal: 'Decimal',
    oddsAmericano: 'Americano',
    oddsFraccional: 'Fracionário',
    oddsHongkong: 'Hong Kong',
    oddsIndonesio: 'Indonésio',

    footerDisclaimer:
      'oferece análises e opiniões próprias com fins informativos e de entretenimento sobre a Liga Pro Checa de tênis de mesa. Não garantimos resultados e não administramos apostas nem fundos de terceiros. Serviço destinado exclusivamente a maiores de 18 anos. Se sentir que o jogo deixou de ser entretenimento, procure ajuda profissional. Jogue sempre com responsabilidade.',
    politicaPrivacidad: 'Política de Privacidade',
    terminosCondiciones: 'Termos e Condições',

    loginTitle: 'Entrar',
    loginSub: 'Use sua conta do Google para continuar',
    loginBtnGoogle: 'Entrar com o Google',
    loginNote: 'Não armazenamos sua senha. Autenticação segura com o Google.',

    privacyEyebrow: 'CAMILOREY · PRIVACIDADE',
    privacyTitle: 'Seus dados, sua decisão',
    privacyIntro:
      'Guardamos o mínimo necessário para o site funcionar. Nada disso é vendido nem compartilhado com ninguém fora do Google, Supabase e Vercel (que fazem o site funcionar).',
    privacy1Title: 'O que coletamos',
    privacy1Desc:
      'Seu nome, e-mail e foto do Google ao entrar, os picks que você segue, e o que você personalizar no seu perfil. Não pedimos dados de cartão nem administramos apostas.',
    privacy2Title: 'Como usamos',
    privacy2Desc:
      'Para mostrar sua sessão, seus picks seguidos, avisar quando terminar uma partida que você segue, e o chat ao vivo. Nada além disso.',
    privacy3Title: 'Seu controle',
    privacy3Desc: 'Altere seu nome, foto ou notificações quando quiser no seu Perfil. Escreva para nós se quiser que a gente exclua sua conta.',
    aceptar: 'Aceitar',
    privacyFootnote: 'Você pode ver os detalhes completos na',

    riskEyebrow: 'Gestão de risco',
    riskSiguiendo: 'Você está seguindo',
    riskPick: 'pick',
    riskPicks: 'picks',
    entendido: 'Entendi',
    riskDisclaimer: 'Isto não é consultoria financeira. Use estes dados com responsabilidade.',

    tabResumen: 'Resumo',
    tabEstadisticas: 'Estatísticas',
    tabAnalisis: 'Análise',
    tabH2H: 'H2H',
    sets: 'Sets',
    indiceIA: 'Índice IA',
    cuotaRushbet: 'Odd (Rushbet)',
    racha: 'Sequência',
    noDisponible: 'Não disponível',
    sinVentaja: 'Sem vantagem — Kelly não apostou',
    acierto: 'Acerto',
    fallado: 'Erro',
    ultimos: 'Últimos',
    partidosPl: 'jogos',
    victorias: 'vitórias',
    derrotas: 'derrotas',
    sinHistorial: 'Ainda sem histórico recente.',
    h2hContra: 'H2H contra',
    sinEnfrentamientos: 'Ainda não se enfrentaram.',
    buscandoMarcador: 'Buscando placar…',
    resultadoFinal: 'Resultado final:',
    partidoNoEmpieza: 'Esta partida ainda não começou.',
    formaReciente: 'Forma recente ·',
    partidoDetallado: 'Partida detalhada',
    partidoTerminadoRecarga: 'Partida encerrada — recarregue a página para ver o resultado final.',
    corriendo: 'em andamento',
    pausado: 'pausado',
    ahora: 'Agora',
    rushbetSinTablero: 'A Rushbet não tem esta partida no placar ao vivo — mostrando o placar do tt.league-pro.com (menos detalhado, sem ponto a ponto).',
    setsDosPuntos: 'Sets:',
    sinSetsCerrados: 'Esta partida está em andamento, ainda sem sets fechados.',
    buscandoMarcadorVivo: 'Buscando placar ao vivo…',
    sinDetallePuntoAPunto: 'Não temos o detalhe ponto a ponto desta partida — só é salvo para partidas que alguém assistiu ao vivo pelo nosso site.',

    analisisForma: 'Nos últimos {n} jogos, {player} venceu {wins} ({pct}%).',
    analisisSinHistorial: 'Ainda não temos histórico recente suficiente de {player}.',
    analisisRacha: 'Chega com uma sequência de {streak}.',
    analisisH2H: 'No confronto direto contra {opponent}, o retrospecto é {record}.',
    analisisCuotaValor: 'A odd da Rushbet ({odds}) implica uma probabilidade de {implied}% — nosso modelo dá {confidence}%.',
    analisisSinCuota: 'Ainda não temos a odd real da Rushbet para esta partida.',

    onboarding1Title: 'Picks baseados em dados reais',
    onboarding1Desc:
      'Analisamos o rating, a sequência recente e os confrontos diretos de cada jogador da Liga Pro Checa — nada inventado.',
    onboarding2Title: 'O que é o Índice IA?',
    onboarding2Desc:
      'É a porcentagem de confiança que nosso modelo calcula combinando esses fatores. Não é garantia — veja a aba Modelo para o acerto real medido, mesmo quando é baixo.',
    onboarding3Title: 'Minha Banca: pratique sem arriscar',
    onboarding3Desc:
      'Simule quanto você apostaria usando o critério de Kelly nos picks que você segue — não é dinheiro real, é para praticar o tamanho das suas apostas antes de arriscar a sua.',
    onboardingSiguiente: 'Próximo',
    onboardingEntendido: 'Entendi',
    onboardingSaltar: 'Pular'
  }
};

// Contenido real de la sub-pantalla "Ayuda y FAQ" del Perfil — cada
// respuesta describe cómo funciona CAMILOREY de verdad (mismos
// factores de lib/confidence.js, mismo origen de cuotas de
// lib/rushbet.js), nada de texto genérico de relleno.
const HELP_FAQ = {
  es: [
    {
      icon: 'chart',
      title: 'Predicciones',
      items: [
        {
          q: '¿Cómo se generan los picks?',
          a: 'Se generan automáticamente comparando el rating de cada jugador, su racha reciente y el historial de enfrentamientos directos (H2H) contra su rival, con datos reales de la Liga Pro Checa — no hay texto ni números inventados.'
        },
        {
          q: '¿Qué significa el Índice IA?',
          a: 'Es el porcentaje de confianza que calcula nuestro modelo combinando esos tres factores (ahora mismo con más peso en el rating del jugador). No es una garantía de resultado, solo indica qué tan favorito creemos que es.'
        },
        {
          q: '¿Los picks se actualizan en tiempo real?',
          a: 'Sí. Mientras un partido está en vivo, el marcador se actualiza cada pocos segundos, y en cuanto termina, el pick se resuelve automáticamente como acertado o fallado.'
        },
        {
          q: '¿Vendrán más deportes además de tenis de mesa?',
          a: 'Todavía no — por ahora CAMILOREY cubre solo la Liga Pro Checa de tenis de mesa. Si eso cambia, lo vas a ver anunciado aquí primero.'
        }
      ]
    },
    {
      icon: 'user',
      title: 'Cuenta',
      items: [
        {
          q: '¿Cómo cambio mi nombre, idioma o tema?',
          a: 'Desde tu Perfil, en la sección Ajustes, puedes cambiar tu nombre, idioma, tema (oscuro/claro/sistema) y formato de cuotas cuando quieras.'
        },
        {
          q: '¿Cómo activo las notificaciones?',
          a: 'Toca "Notificaciones" en tu Perfil y acepta el permiso que te pide el navegador. Te avisamos cuando se cierra un set o termina un partido de un pick que sigues.'
        }
      ]
    },
    {
      icon: 'dollar',
      title: 'Predicciones y cuotas',
      items: [
        {
          q: '¿De dónde salen las cuotas?',
          a: 'De Rushbet (licencia Coljuegos en Colombia). Cruzamos cada partido con su cuota real por nombre de jugador y hora.'
        },
        {
          q: '¿Por qué a veces no aparece la cuota de un pick?',
          a: 'Porque en el momento en que se generó el pick, Rushbet todavía no había listado ese partido en su tablero. Lo seguimos intentando en cada actualización hasta encontrarla.'
        }
      ]
    },
    {
      icon: 'tool',
      title: 'Técnico',
      items: [
        {
          q: '¿Qué hago si algo no funciona?',
          a: 'Escríbenos por email contándonos qué pasó, en qué pantalla y, si puedes, con una captura de pantalla — respondemos en menos de 24h.'
        }
      ]
    }
  ],
  en: [
    {
      icon: 'chart',
      title: 'Predictions',
      items: [
        {
          q: 'How are picks generated?',
          a: "They're generated automatically by comparing each player's rating, their recent streak, and their head-to-head record against the opponent, using real Czech Liga Pro data — nothing is made up."
        },
        {
          q: 'What does the AI Score mean?',
          a: "It's the confidence percentage our model calculates by combining those three factors (rating currently weighted the most). It's not a guarantee of the result, just how big a favorite we think a player is."
        },
        {
          q: 'Do picks update in real time?',
          a: 'Yes. While a match is live, the score updates every few seconds, and as soon as it ends, the pick is automatically resolved as a hit or a miss.'
        },
        {
          q: 'Will more sports be added besides table tennis?',
          a: "Not yet — for now CAMILOREY only covers Czech Liga Pro table tennis. If that changes, you'll see it announced here first."
        }
      ]
    },
    {
      icon: 'user',
      title: 'Account',
      items: [
        {
          q: 'How do I change my name, language, or theme?',
          a: 'From your Profile, under Settings, you can change your name, language, theme (dark/light/system), and odds format whenever you want.'
        },
        {
          q: 'How do I enable notifications?',
          a: "Tap \"Notifications\" in your Profile and accept the browser permission prompt. We'll notify you when a set closes or a match you follow ends."
        }
      ]
    },
    {
      icon: 'dollar',
      title: 'Predictions & odds',
      items: [
        {
          q: 'Where do the odds come from?',
          a: 'From Rushbet (licensed by Coljuegos in Colombia). We match each match to its real odds by player name and time.'
        },
        {
          q: "Why don't some picks show odds?",
          a: "Because at the moment the pick was generated, Rushbet hadn't listed that match on their board yet. We keep retrying on every update until we find it."
        }
      ]
    },
    {
      icon: 'tool',
      title: 'Technical',
      items: [
        {
          q: "What do I do if something isn't working?",
          a: 'Email us and tell us what happened, on which screen, and a screenshot if you can — we reply within 24h.'
        }
      ]
    }
  ],
  pt: [
    {
      icon: 'chart',
      title: 'Previsões',
      items: [
        {
          q: 'Como os picks são gerados?',
          a: 'São gerados automaticamente comparando o rating de cada jogador, sua sequência recente e o histórico de confrontos diretos (H2H) contra o adversário, com dados reais da Liga Pro Checa — nada de texto ou números inventados.'
        },
        {
          q: 'O que significa o Índice IA?',
          a: 'É a porcentagem de confiança que nosso modelo calcula combinando esses três fatores (agora com mais peso no rating do jogador). Não é garantia de resultado, só indica o quão favorito achamos que ele é.'
        },
        {
          q: 'Os picks são atualizados em tempo real?',
          a: 'Sim. Enquanto uma partida está ao vivo, o placar é atualizado a cada poucos segundos, e assim que termina, o pick é resolvido automaticamente como acerto ou erro.'
        },
        {
          q: 'Vão adicionar mais esportes além do tênis de mesa?',
          a: 'Ainda não — por enquanto o CAMILOREY cobre só a Liga Pro Checa de tênis de mesa. Se isso mudar, você vai ver anunciado aqui primeiro.'
        }
      ]
    },
    {
      icon: 'user',
      title: 'Conta',
      items: [
        {
          q: 'Como mudo meu nome, idioma ou tema?',
          a: 'No seu Perfil, na seção Ajustes, você pode mudar seu nome, idioma, tema (escuro/claro/sistema) e formato de odds quando quiser.'
        },
        {
          q: 'Como ativo as notificações?',
          a: 'Toque em "Notificações" no seu Perfil e aceite a permissão do navegador. Avisamos quando um set fecha ou termina uma partida que você segue.'
        }
      ]
    },
    {
      icon: 'dollar',
      title: 'Previsões e odds',
      items: [
        {
          q: 'De onde vêm as odds?',
          a: 'Da Rushbet (licença Coljuegos na Colômbia). Cruzamos cada partida com sua odd real por nome do jogador e horário.'
        },
        {
          q: 'Por que às vezes um pick não mostra a odd?',
          a: 'Porque no momento em que o pick foi gerado, a Rushbet ainda não tinha listado essa partida no placar. Continuamos tentando a cada atualização até encontrar.'
        }
      ]
    },
    {
      icon: 'tool',
      title: 'Técnico',
      items: [
        {
          q: 'O que faço se algo não estiver funcionando?',
          a: 'Escreva para nós por email contando o que aconteceu, em qual tela e, se puder, com uma captura de tela — respondemos em menos de 24h.'
        }
      ]
    }
  ]
};

function useTranslate(lang) {
  return (key, vars) => {
    let str = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.es[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
    }
    return str;
  };
}

// pref es lo que la persona eligió ('oscuro'/'claro'/'sistema') — si
// es 'sistema', el tema real a pintar depende de las preferencias del
// SO en ese momento (prefers-color-scheme), no de un valor fijo.
function effectiveTheme(pref) {
  if (pref === 'claro') return 'light';
  if (pref === 'oscuro') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function applyTheme(pref) {
  if (typeof document === 'undefined') return;
  const effective = effectiveTheme(pref);
  document.documentElement.setAttribute('data-theme', effective);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', effective === 'light' ? '#FDFBFA' : '#0E0D0C');
}

// El navegador pide la llave pública del servidor push en este
// formato (Uint8Array), pero VAPID la da como base64 url-safe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : '';
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// iOS/iPadOS (Safari o cualquier navegador ahí, todos corren sobre
// WebKit) solo expone la API de push cuando el sitio está agregado a
// la pantalla de inicio (PWA instalada) — en una pestaña normal de
// Safari, 'PushManager' in window da false aunque el dispositivo sea
// moderno. Sin distinguir este caso, el mensaje "no soportado" es
// engañoso: sí funciona, solo falta instalarlo.
function isIosNotInstalled() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIos && !isStandalone;
}

// Pide permiso de notificaciones, registra el service worker y guarda
// la suscripción en Supabase. Se llama la primera vez que alguien
// sigue un pick (silencioso) y también desde el botón de campana del
// header (ahí sí con feedback, ver bell-btn) — por eso devuelve un
// estado en vez de tragarse el resultado.
async function ensurePushSubscription(user) {
  if (!supabaseClient || !user) return 'error';
  if (!VAPID_PUBLIC_KEY) return 'unsupported';
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    typeof Notification === 'undefined'
  ) {
    return isIosNotInstalled() ? 'ios-needs-install' : 'unsupported';
  }
  // El navegador NO vuelve a preguntar si ya se bloqueó una vez —
  // hay que decirle a la persona que lo active a mano desde los
  // permisos del sitio, en vez de quedarnos callados otra vez.
  if (Notification.permission === 'denied') return 'denied';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
    const registration = await navigator.serviceWorker.register('/sw.js');
    // getSubscription() devuelve la existente sin importar si quedó
    // creada con una llave VAPID vieja — si las llaves se regeneran
    // (como pasó una vez), el navegador se queda pegado reusando la
    // suscripción muerta para siempre. Se descarta y se crea siempre
    // una nueva con la llave actual, para no depender de que coincida.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const json = subscription.toJSON();
    // Se guarda vía API (service_role) en vez de insert/upsert directo
    // del cliente: el endpoint identifica al NAVEGADOR, no al usuario,
    // así que si alguien más ya usó este mismo navegador antes, el
    // upsert cae en un UPDATE que la política de RLS rechaza (no es
    // dueño de esa fila). El servidor no tiene esa restricción.
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        userId: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth
      })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('No se pudo guardar la suscripción push:', body.error);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('No se pudo activar notificaciones push:', e.message);
    return 'error';
  }
}

// ============================================================
// Server-side: trae todo lo que la página necesita de Supabase.
// Es SSR (no getStaticProps) porque los picks/resultados cambian
// cada 30 min con el sync — siempre queremos la última data.
// ============================================================
function confidenceTier(confidence) {
  if (confidence >= 85) return 'alta';
  if (confidence >= 70) return 'media';
  return 'baja';
}

// history viene del más reciente al más viejo (index 0 = último
// partido jugado) — la racha se cuenta desde el principio del array.
function streakLabelFromHistory(history) {
  if (!history || history.length === 0) return null;
  const last = history[0].win;
  let count = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].win === last) count++;
    else break;
  }
  return `${count}${last ? 'W' : 'L'}`;
}

export async function getServerSideProps({ query }) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
  // Calendario, Bankroll y el conteo de usuarios no dependen de nada
  // de la cadena de picks/resolvedPicks/tournamentGroups de abajo —
  // antes se pedían en secuencia DESPUÉS de toda esa cadena, sumando
  // varios round-trips más al tiempo de carga. Se disparan ya (sin
  // esperarlos todavía) para que corran en paralelo con todo lo demás,
  // y se resuelven más abajo, justo donde se necesitan.
  const bogotaDateStr = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const selectedDate = typeof query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : null;
  let windowStart, windowEnd;
  if (selectedDate) {
    windowStart = new Date(`${selectedDate}T00:00:00-05:00`).toISOString();
    windowEnd = new Date(`${selectedDate}T23:59:59-05:00`).toISOString();
  } else {
    windowStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    windowEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  }
  const currentDateStr = selectedDate || bogotaDateStr(new Date());
  const prevDateStr = bogotaDateStr(new Date(new Date(`${currentDateStr}T12:00:00-05:00`).getTime() - 24 * 3600 * 1000));
  const nextDateStr = bogotaDateStr(new Date(new Date(`${currentDateStr}T12:00:00-05:00`).getTime() + 24 * 3600 * 1000));

  const windowMatchesPromise = supabase
    .from('matches')
    .select('*')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(1000);

  const bankrollPromise = (async () => {
    const { data: bankrollRows } = await supabase
      .from('bankroll_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
    const { data: bkPicks } = bkPickIds.length
      ? await supabase.from('picks').select('id, market, odds').in('id', bkPickIds)
      : { data: [] };
    return { bankrollRows, bkPicks };
  })();

  const userCountPromise = supabase.from('profiles').select('id', { count: 'exact', head: true });

  const [{ data: players }, { data: pendingPicks }] = await Promise.all([
    supabase.from('players').select('id, name, avatar_url, avatar_cutout_url, rating'),
    supabase.from('picks').select('*').eq('result', 'pending').order('confidence', { ascending: false })
  ]);

  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const pendingMatchIds = (pendingPicks || []).map((p) => p.match_id);
  const { data: pendingMatches } = pendingMatchIds.length
    ? await supabase.from('matches').select('*').in('id', pendingMatchIds)
    : { data: [] };
  const matchesById = new Map((pendingMatches || []).map((m) => [m.id, m]));

  const tournamentIds = [...new Set((pendingMatches || []).map((m) => m.tournament_id).filter(Boolean))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  // Picks ya resueltos (para las pestañas Ganados/Perdidos de la
  // sección Picks). Se trae antes de armar "picks"/"resolvedPicks"
  // porque ambos comparten UNA sola consulta de forma/H2H más abajo.
  const { data: resolvedPicksRaw } = await supabase
    .from('picks')
    .select('*')
    .neq('result', 'pending')
    .order('created_at', { ascending: false })
    .limit(60);

  const resolvedMatchIds = [...new Set((resolvedPicksRaw || []).map((p) => p.match_id))];
  const { data: resolvedMatchesRaw } = resolvedMatchIds.length
    ? await supabase.from('matches').select('*').in('id', resolvedMatchIds)
    : { data: [] };
  const resolvedMatchesById = new Map((resolvedMatchesRaw || []).map((m) => [m.id, m]));

  const resolvedExtraPlayerIds = [
    ...new Set((resolvedMatchesRaw || []).flatMap((m) => [m.player_a_id, m.player_b_id]))
  ].filter((id) => id && !playersById.has(id));
  if (resolvedExtraPlayerIds.length) {
    const { data: extra } = await supabase
      .from('players')
      .select('id, name, avatar_url, avatar_cutout_url')
      .in('id', resolvedExtraPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const resolvedExtraTournamentIds = [...new Set((resolvedMatchesRaw || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (resolvedExtraTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', resolvedExtraTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  // Un pick deja de mostrarse como "próximo" un rato ANTES de que
  // arranque el partido (no justo cuando ya casi empieza), y por
  // supuesto también una vez que ya arrancó o terminó.
  const HIDE_BEFORE_START_MS = 3 * 60 * 1000;

  const pendingPrelim = (pendingPicks || [])
    .map((pick) => {
      const match = matchesById.get(pick.match_id);
      if (!match) return null;
      if (match.scheduled_at && new Date(match.scheduled_at).getTime() - Date.now() < HIDE_BEFORE_START_MS) return null;
      const playerA = playersById.get(match.player_a_id);
      const playerB = playersById.get(match.player_b_id);
      const favored = playersById.get(pick.predicted_winner_id);
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const opponent = favoredIsA ? playerB : playerA;
      // Si falta cualquiera de los dos jugadores, es un pick con datos
      // incompletos (probablemente de antes del cierre hit/miss) — mejor
      // no mostrarlo que mostrar una tarjeta rota.
      if (!favored || !opponent) return null;
      return { pick, match, favored, opponent, favoredIsA, tournament: tournamentsById.get(match.tournament_id) };
    })
    .filter(Boolean);

  const resolvedPrelim = (resolvedPicksRaw || [])
    .map((pick) => {
      const match = resolvedMatchesById.get(pick.match_id);
      if (!match) return null;
      const favored = playersById.get(pick.predicted_winner_id);
      const opponent =
        pick.predicted_winner_id === match.player_a_id
          ? playersById.get(match.player_b_id)
          : playersById.get(match.player_a_id);
      if (!favored || !opponent) return null;

      // El resultado final se guarda relativo a jugador A/B, no a
      // favorito/rival — hay que reordenarlo a favor del favorito
      // (izquierda en la tarjeta), igual que en followed-detail.js.
      const favoredIsA = pick.predicted_winner_id === match.player_a_id;
      const score =
        match.sets_a != null && match.sets_b != null
          ? favoredIsA
            ? `${match.sets_a}-${match.sets_b}`
            : `${match.sets_b}-${match.sets_a}`
          : null;
      const setScores = Array.isArray(match.set_scores)
        ? favoredIsA
          ? match.set_scores
          : match.set_scores.map((s) => ({ a: s.b, b: s.a }))
        : null;

      return { pick, match, favored, opponent, favoredIsA, tournament: tournamentsById.get(match.tournament_id), score, setScores };
    })
    .filter(Boolean);

  // Antes, cada pick disparaba 2 consultas propias a Supabase (forma
  // reciente + H2H) — con decenas de picks pendientes y resueltos a la
  // vez, eso eran cientos de round-trips en CADA carga de página, y
  // era la causa real de que el sitio se sintiera cada vez más lento
  // a medida que crecía el historial. Ahora se trae en una sola
  // consulta TODOS los partidos terminados de TODOS los jugadores
  // involucrados (pendientes + resueltos juntos), y la forma reciente
  // + el cruce directo de cada pick se calculan en memoria a partir de
  // ese único resultado.
  async function buildFormAndH2H(pairs) {
    const result = new Map();
    const allIds = [...new Set(pairs.flatMap((p) => [p.favoredId, p.opponentId]).filter(Boolean))];
    if (allIds.length === 0) return result;

    // Forma reciente de cada jugador: consulta directa y acotada por
    // jugador (antes salía de UN lote compartido entre TODOS los
    // jugadores de TODOS los picks a la vez, con un límite fijo — un
    // jugador poco activo terminaba con 1 solo partido en su
    // historial en vez de sus 10 reales, porque el límite se llenaba
    // con la actividad de jugadores más activos antes de llegar a
    // él). Se piden todas en paralelo, cada una acotada a 10 filas.
    const rawHistoryByPlayer = new Map();
    await Promise.all(
      allIds.map(async (id) => {
        const { data } = await supabase
          .from('matches')
          .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
          .eq('status', 'finished')
          .or(`player_a_id.eq.${id},player_b_id.eq.${id}`)
          .order('scheduled_at', { ascending: false })
          .limit(10);
        rawHistoryByPlayer.set(id, data || []);
      })
    );

    const missingOpponentIds = [
      ...new Set([...rawHistoryByPlayer.values()].flat().flatMap((m) => [m.player_a_id, m.player_b_id]))
    ].filter((id) => id && !playersById.has(id));
    if (missingOpponentIds.length) {
      const { data: extra } = await supabase
        .from('players')
        .select('id, name, avatar_url, avatar_cutout_url')
        .in('id', missingOpponentIds);
      for (const p of extra || []) playersById.set(p.id, p);
    }

    const historyFor = (playerId) =>
      (rawHistoryByPlayer.get(playerId) || []).map((m) => {
        const isA = m.player_a_id === playerId;
        const oppId = isA ? m.player_b_id : m.player_a_id;
        return {
          date: m.scheduled_at,
          opponent: playersById.get(oppId)?.name || '?',
          setsFor: isA ? m.sets_a : m.sets_b,
          setsAgainst: isA ? m.sets_b : m.sets_a,
          win: m.winner_id === playerId
        };
      });

    // H2H: mismo problema que la forma reciente de arriba tenía antes
    // (un lote compartido con límite fijo se quedaba corto para
    // parejas poco activas — confirmado: un cruce con 20 partidos
    // reales salía como "0 enfrentamientos"). Esta consulta va directo
    // por cada pareja exacta (favorito↔rival), en lotes de 15 para no
    // armar una sola consulta gigante.
    const pairKey = (id1, id2) => (id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`);
    const uniquePairKeys = [
      ...new Set(pairs.filter((p) => p.favoredId && p.opponentId).map((p) => pairKey(p.favoredId, p.opponentId)))
    ];
    const h2hRowsByPair = new Map();
    if (uniquePairKeys.length > 0) {
      const CHUNK = 15;
      const chunks = [];
      for (let i = 0; i < uniquePairKeys.length; i += CHUNK) chunks.push(uniquePairKeys.slice(i, i + CHUNK));
      const chunkResults = await Promise.all(
        chunks.map(async (keys) => {
          const orClauses = keys
            .map((k) => {
              const [a, b] = k.split(':');
              return `and(player_a_id.eq.${a},player_b_id.eq.${b}),and(player_a_id.eq.${b},player_b_id.eq.${a})`;
            })
            .join(',');
          const { data: h2hData } = await supabase
            .from('matches')
            .select('scheduled_at, winner_id, player_a_id, player_b_id, sets_a, sets_b')
            .eq('status', 'finished')
            .or(orClauses)
            .order('scheduled_at', { ascending: false })
            .limit(5000);
          return h2hData || [];
        })
      );
      for (const m of chunkResults.flat()) {
        const key = pairKey(m.player_a_id, m.player_b_id);
        if (!h2hRowsByPair.has(key)) h2hRowsByPair.set(key, []);
        h2hRowsByPair.get(key).push(m);
      }
    }

    for (const { pickId, favoredId, opponentId, opponentName } of pairs) {
      const history = historyFor(favoredId);
      const opponentHistory = historyFor(opponentId);
      const h2hMatches = (h2hRowsByPair.get(pairKey(favoredId, opponentId)) || [])
        .slice(0, 20)
        .map((m) => {
          const isA = m.player_a_id === favoredId;
          return {
            date: m.scheduled_at,
            opponent: opponentName,
            setsFor: isA ? m.sets_a : m.sets_b,
            setsAgainst: isA ? m.sets_b : m.sets_a,
            win: m.winner_id === favoredId
          };
        });
      const winsFavored = h2hMatches.filter((m) => m.win).length;
      result.set(pickId, {
        history,
        streakLabel: streakLabelFromHistory(history),
        opponentHistory,
        opponentStreakLabel: streakLabelFromHistory(opponentHistory),
        h2h: `${winsFavored}-${h2hMatches.length - winsFavored}`,
        h2hTotal: h2hMatches.length,
        h2hMatches
      });
    }
    return result;
  }

  const formByPickId = await buildFormAndH2H([
    ...pendingPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    })),
    ...resolvedPrelim.map(({ pick, favored, opponent }) => ({
      pickId: pick.id,
      favoredId: favored.id,
      opponentId: opponent.id,
      opponentName: opponent.name
    }))
  ]);
  const EMPTY_FORM = {
    history: [],
    streakLabel: null,
    opponentHistory: [],
    opponentStreakLabel: null,
    h2h: '0-0',
    h2hTotal: 0,
    h2hMatches: []
  };

  const picks = pendingPrelim.map(({ pick, match, favored, opponent, favoredIsA, tournament }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
    return {
      id: pick.id,
      matchId: match.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
      player: favored?.name || '—',
      initials: initialsOf(favored?.name),
      avatarUrl: favored?.avatar_cutout_url || favored?.avatar_url || null,
      hasCutout: Boolean(favored?.avatar_cutout_url),
      opponent: opponent?.name || '—',
      opponentInitials: initialsOf(opponent?.name),
      opponentAvatarUrl: opponent?.avatar_cutout_url || opponent?.avatar_url || null,
      opponentHasCutout: Boolean(opponent?.avatar_cutout_url),
      favoredIsA,
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      analysis: buildAnalysis(pick.factors),
      history: form.history,
      streakLabel: form.streakLabel,
      opponentHistory: form.opponentHistory,
      opponentStreakLabel: form.opponentStreakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score: null,
      setScores: null,
      result: 'pending'
    };
  });
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  // El pick destacado prioriza cuota real arriba de 1.60 — entre esos,
  // el de mayor confianza. Si ninguno tiene cuota >1.60 (o cuota del
  // todo), cae al de mayor confianza general para no dejar Inicio sin
  // destacado solo porque el cruce con Rushbet no encontró esa cuota.
  const picksWithGoodOdds = picks.filter((p) => p.odds && p.odds > 1.6);
  const topConfidence =
    (picksWithGoodOdds.length ? picksWithGoodOdds : picks).slice().sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

  const resolvedPicks = resolvedPrelim.map(({ pick, match, favored, opponent, favoredIsA, tournament, score, setScores }) => {
    const form = formByPickId.get(pick.id) || EMPTY_FORM;
    const confidence = Math.round(pick.confidence);
    return {
      id: pick.id,
      matchId: match.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
      player: favored.name,
      initials: initialsOf(favored.name),
      avatarUrl: favored.avatar_cutout_url || favored.avatar_url || null,
      hasCutout: Boolean(favored.avatar_cutout_url),
      opponent: opponent.name,
      opponentInitials: initialsOf(opponent.name),
      opponentAvatarUrl: opponent.avatar_cutout_url || opponent.avatar_url || null,
      opponentHasCutout: Boolean(opponent.avatar_cutout_url),
      favoredIsA,
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence,
      tier: confidenceTier(confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      analysis: buildAnalysis(pick.factors),
      history: form.history,
      streakLabel: form.streakLabel,
      opponentHistory: form.opponentHistory,
      opponentStreakLabel: form.opponentStreakLabel,
      h2h: form.h2h,
      h2hTotal: form.h2hTotal,
      h2hMatches: form.h2hMatches,
      score,
      setScores,
      result: pick.result,
      matchStatus: 'done'
    };
  });
  resolvedPicks.sort((a, b) => b.scheduledAt - a.scheduledAt);

  // Tabla de grupo por torneo — igual a como tt.league-pro.com la
  // muestra dentro de cada torneo: los jugadores de ESE grupo se
  // enfrentan todos contra todos, y la tabla es el cruce de
  // resultados (sets a favor/en contra por rival) + total de sets +
  // puesto. Se reconstruye 100% desde nuestros propios "matches" del
  // torneo (no hace falta un campo nuevo de scraping) — solo se arma
  // para los torneos que tienen AL MENOS un partido en vivo ahora
  // mismo, no todos los que tengan un pick pendiente (eso incluía
  // torneos que ni siquiera habían arrancado, saturando Inicio).
  const tournamentGroups = (
    await Promise.all(
      tournamentIds.map(async (tId) => {
        const { data: groupMatches } = await supabase
          .from('matches')
          .select('player_a_id, player_b_id, sets_a, sets_b, set_scores, status, scheduled_at')
          .eq('tournament_id', tId);
        if (!groupMatches || groupMatches.length === 0) return null;

        const now = Date.now();
        const isLive = groupMatches.some(
          (m) => m.status === 'live' || (m.status !== 'finished' && m.scheduled_at && new Date(m.scheduled_at).getTime() <= now)
        );
        if (!isLive) return null;

        const groupPlayerIds = [...new Set(groupMatches.flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(Boolean);
        if (groupPlayerIds.length < 3) return null;

        const missingIds = groupPlayerIds.filter((id) => !playersById.has(id));
        if (missingIds.length) {
          const { data: extra } = await supabase
            .from('players')
            .select('id, name, avatar_url, avatar_cutout_url, rating')
            .in('id', missingIds);
          for (const p of extra || []) playersById.set(p.id, p);
        }

        // matchupByPlayer.get(idA).get(idB) = sets de A contra B, visto desde A.
        // ballsByPlayer = puntos (bolas) ganados/perdidos, solo sumando los
        // partidos donde SÍ tenemos el detalle punto a punto (set_scores) —
        // no todos los partidos lo tienen, solo los que alguien vio en vivo
        // mientras se jugaban, así que puede quedar incompleto.
        const matchupByPlayer = new Map(groupPlayerIds.map((id) => [id, new Map()]));
        const ballsByPlayer = new Map(groupPlayerIds.map((id) => [id, { for: 0, against: 0, hasData: false }]));
        for (const m of groupMatches) {
          if (m.sets_a == null || m.sets_b == null) continue;
          matchupByPlayer.get(m.player_a_id)?.set(m.player_b_id, { for: m.sets_a, against: m.sets_b });
          matchupByPlayer.get(m.player_b_id)?.set(m.player_a_id, { for: m.sets_b, against: m.sets_a });

          if (Array.isArray(m.set_scores) && m.set_scores.length > 0) {
            const ballsA = m.set_scores.reduce((s, set) => s + (set.a || 0), 0);
            const ballsB = m.set_scores.reduce((s, set) => s + (set.b || 0), 0);
            const ba = ballsByPlayer.get(m.player_a_id);
            const bb = ballsByPlayer.get(m.player_b_id);
            if (ba) {
              ba.for += ballsA;
              ba.against += ballsB;
              ba.hasData = true;
            }
            if (bb) {
              bb.for += ballsB;
              bb.against += ballsA;
              bb.hasData = true;
            }
          }
        }

        const rows = groupPlayerIds.map((id) => {
          const p = playersById.get(id);
          let wins = 0;
          let losses = 0;
          let setsFor = 0;
          let setsAgainst = 0;
          for (const res of matchupByPlayer.get(id).values()) {
            setsFor += res.for;
            setsAgainst += res.against;
            if (res.for > res.against) wins++;
            else losses++;
          }
          const balls = ballsByPlayer.get(id);
          return {
            id,
            name: p?.name || '—',
            initials: initialsOf(p?.name),
            avatarUrl: p?.avatar_cutout_url || p?.avatar_url || null,
            rating: p?.rating != null ? Math.round(Number(p.rating)) : null,
            wins,
            setsFor,
            setsAgainst,
            // 2 puntos por partido ganado, 1 por perdido (igual al criterio
            // que usa tt.league-pro.com en su propia tabla de grupo).
            points: wins * 2 + losses,
            ballsFor: balls.hasData ? balls.for : null,
            ballsAgainst: balls.hasData ? balls.against : null
          };
        });
        rows.sort((a, b) => b.wins - a.wins || b.setsFor - b.setsAgainst - (a.setsFor - a.setsAgainst));
        rows.forEach((r, i) => (r.place = i + 1));

        const matchup = {};
        for (const id of groupPlayerIds) {
          matchup[id] = {};
          for (const [oppId, res] of matchupByPlayer.get(id)) {
            matchup[id][oppId] = `${res.for}:${res.against}`;
          }
        }

        const tournament = tournamentsById.get(tId);
        return { tournamentId: tId, name: tournament?.name || 'Torneo', players: rows, matchup };
      })
    )
  )
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Calendario: windowMatches ya se disparó al principio de la
  // función (ver windowMatchesPromise) — aquí solo se espera.
  const { data: windowMatches } = await windowMatchesPromise;

  const missingPlayerIds = [...new Set((windowMatches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(
    (id) => id && !playersById.has(id)
  );
  if (missingPlayerIds.length) {
    const { data: extra } = await supabase
      .from('players')
      .select('id, name, avatar_url, avatar_cutout_url')
      .in('id', missingPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const missingTournamentIds = [...new Set((windowMatches || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (missingTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', missingTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  // Para pintar de verde/rojo el resultado del partido según si
  // nuestro pick acertó o falló (no según quién ganó a secas), y para
  // poder seguir el pick directo desde la tarjeta de Calendario.
  const windowMatchIds = (windowMatches || []).map((m) => m.id);
  const { data: windowPicks } = windowMatchIds.length
    ? await supabase.from('picks').select('id, match_id, result').in('match_id', windowMatchIds)
    : { data: [] };
  const pickResultByMatchId = new Map((windowPicks || []).map((p) => [p.match_id, p.result]));
  const pendingPickIdByMatchId = new Map(
    (windowPicks || []).filter((p) => p.result === 'pending').map((p) => [p.match_id, p.id])
  );

  const matches = (windowMatches || []).map((m) => {
    const a = playersById.get(m.player_a_id);
    const b = playersById.get(m.player_b_id);
    const t = tournamentsById.get(m.tournament_id);
    let status = 'soon';
    if (m.status === 'finished') status = 'done';
    else if (m.status === 'live') status = 'live';
    else if (new Date(m.scheduled_at) <= new Date()) status = 'live';
    const pickResult = pickResultByMatchId.get(m.id);
    return {
      matchId: m.id,
      pickId: pendingPickIdByMatchId.get(m.id) || null,
      time: timeLabel(m.scheduled_at),
      tournament: t?.name || 'Torneo',
      players: `${a?.name || '?'} vs ${b?.name || '?'}`,
      playerA: a?.name || null,
      playerB: b?.name || null,
      playerAId: m.player_a_id,
      playerBId: m.player_b_id,
      playerAInitials: initialsOf(a?.name),
      playerBInitials: initialsOf(b?.name),
      playerAAvatar: a?.avatar_cutout_url || a?.avatar_url || null,
      playerBAvatar: b?.avatar_cutout_url || b?.avatar_url || null,
      playerAHasCutout: Boolean(a?.avatar_cutout_url),
      playerBHasCutout: Boolean(b?.avatar_cutout_url),
      tournamentId: m.tournament_id,
      sourceId: m.source_id,
      status,
      score: status === 'done' && m.sets_a != null && m.sets_b != null ? `${m.sets_a}-${m.sets_b}` : null,
      setScores: status === 'done' ? m.set_scores || null : null,
      pickResult: status === 'done' && (pickResult === 'hit' || pickResult === 'miss') ? pickResult : null
    };
  });

  // Bankroll: bankrollRows/bkPicks ya se dispararon al principio de
  // la función (ver bankrollPromise) — aquí solo se espera.
  //
  // OJO: el log detallado (bankrollLog/bankrollSeries, apuesta por
  // apuesta) YA NO se calcula ni se manda acá — antes viajaba a
  // CUALQUIER visitante en el HTML inicial de la página, sin login,
  // aunque la interfaz lo ocultara a quien no fuera admin (el
  // "candado" era solo visual). Ahora ese detalle se sirve aparte en
  // /api/bankroll-log, con el mismo login verificado de verdad en el
  // servidor que ya usan /api/error-log y /api/model-stats. Las
  // estadísticas AGREGADAS de abajo (efectividad/racha/ROI/balance)
  // sí siguen siendo públicas a propósito — es la transparencia del
  // modelo que se muestra en Inicio para todos.
  const { bankrollRows, bkPicks } = await bankrollPromise;
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const hits = (bankrollRows || []).filter((r) => Number(r.units) > 0).length;
  const misses = (bankrollRows || []).filter((r) => Number(r.units) < 0).length;
  const efectividad = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;

  let racha = 0;
  for (const r of bankrollRows || []) {
    const won = Number(r.units) > 0;
    if (racha === 0) racha = won ? 1 : -1;
    else if (racha > 0 === won) racha += won ? 1 : -1;
    else break;
  }

  // ROI = ganancia neta / total apostado. bankroll_log.units ya es la
  // ganancia/pérdida neta de cada apuesta, no el monto arriesgado, así
  // que el monto arriesgado se reconstruye desde la cuota real cuando
  // la tenemos (units = stake * (odds-1) en un acierto), y cae a 1:1
  // si no hay cuota — mismo criterio que usa scripts/sync.js al pagar.
  function stakeOf(r) {
    const units = Number(r.units);
    if (units < 0) return -units;
    const pick = bkPicksById.get(r.pick_id);
    const odds = pick?.odds ? Number(pick.odds) : null;
    return odds && odds > 1 ? units / (odds - 1) : units;
  }
  const totalStake = (bankrollRows || []).reduce((sum, r) => sum + stakeOf(r), 0);
  const totalProfit = (bankrollRows || []).reduce((sum, r) => sum + Number(r.units), 0);
  const roi = totalStake > 0 ? Math.round((totalProfit / totalStake) * 1000) / 10 : 0;
  const unidades = bankrollRows && bankrollRows.length ? Number(bankrollRows[0].balance) : 0;

  const picksWithOdds = picks.filter((p) => p.odds);
  const cuotaProm = picksWithOdds.length
    ? Math.round((picksWithOdds.reduce((sum, p) => sum + p.odds, 0) / picksWithOdds.length) * 100) / 100
    : null;

  const { count: userCount } = await userCountPromise;

  return {
    props: {
      stats: { efectividad, racha, cuotaProm, roi, unidades },
      picks,
      resolvedPicks,
      tournamentGroups,
      matches,
      currentDateStr,
      prevDateStr,
      nextDateStr,
      isToday: !selectedDate,
      userCount: userCount || 0
    }
  };
  } catch (err) {
    // Si CUALQUIER cosa de arriba truena, antes se caía el sitio
    // entero (pantalla de error de Next.js) — mejor registrar el
    // error y devolver props vacíos/seguros para que la página cargue
    // igual (aunque sea sin datos) mientras se investiga.
    console.error('Error en getServerSideProps:', err);
    await logError(supabase, {
      source: 'getServerSideProps',
      message: err.message,
      stack: err.stack,
      context: { query }
    });
    const fallbackDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    return {
      props: {
        stats: { efectividad: 0, racha: 0, cuotaProm: null, roi: 0, unidades: 0 },
        picks: [],
        resolvedPicks: [],
        tournamentGroups: [],
        matches: [],
        currentDateStr: fallbackDate,
        prevDateStr: fallbackDate,
        nextDateStr: fallbackDate,
        isToday: true,
        userCount: 0
      }
    };
  }
}

// Nivel del chat (estilo AiScore) — solo define el color/tier visual
// de la insignia; el número de nivel ya viene calculado desde la
// base de datos (migration_010, curva de raíz cuadrada por mensajes).
function levelTier(level) {
  if (level >= 10) return 'legend';
  if (level >= 6) return 'fan';
  if (level >= 3) return 'active';
  return 'new';
}

function initialsOf(name) {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function timeLabel(iso) {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

function dayLabel(iso) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const target = fmt(new Date(iso));
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 24 * 3600 * 1000));
  if (target === today) return 'hoy';
  if (target === tomorrow) return 'mañana';
  return 'otro';
}

// Fecha corta para las filas de "últimos partidos" (d/m/aa), estilo
// Sofascore.
function shortDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'numeric',
    year: '2-digit',
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

// Bankroll en pesos colombianos, banco inicial $2.000.000 (ver
// scripts/convert-bankroll-to-pesos.js). withSign se usa para
// ganancia/pérdida de una apuesta puntual; el balance total no lleva
// signo (siempre positivo salvo que el banco se acabe del todo).
function formatCOP(n, withSign = false) {
  const abs = Math.round(Math.abs(n)).toLocaleString('es-CO');
  const sign = withSign ? (n >= 0 ? '+' : '-') : '';
  return `${sign}$${abs}`;
}

// Todas las cuotas se guardan en decimal (lo que da Rushbet) — esto
// solo convierte para MOSTRAR, según la preferencia de cada quien.
// Fórmulas estándar de conversión entre formatos de cuotas reales.
function formatOdds(decimal, format = 'decimal') {
  if (!decimal || decimal <= 1) return 'N/D';
  if (format === 'americano') {
    const v = decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
    const r = Math.round(v);
    return r > 0 ? `+${r}` : `${r}`;
  }
  if (format === 'fraccional') {
    const frac = decimal - 1;
    let bestNum = 1;
    let bestDen = 1;
    let bestErr = Infinity;
    for (let den = 1; den <= 20; den++) {
      const num = Math.round(frac * den);
      if (num <= 0) continue;
      const err = Math.abs(frac - num / den);
      if (err < bestErr) {
        bestErr = err;
        bestNum = num;
        bestDen = den;
      }
    }
    return `${bestNum}/${bestDen}`;
  }
  if (format === 'hongkong') {
    return (decimal - 1).toFixed(2);
  }
  if (format === 'indonesio') {
    const v = decimal >= 2 ? decimal - 1 : -1 / (decimal - 1);
    return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
  }
  return decimal.toFixed(2);
}

// Frase corta y honesta armada a partir de los factores reales de
// lib/confidence.js — nada inventado, solo traduce los números.
function buildAnalysis(factors) {
  if (!factors) return 'Pick generado sin desglose disponible.';
  const pct = (x) => Math.round(Math.abs(x) * 100);
  const bits = [];
  if (factors.ratingScore) bits.push(`rating (${pct(factors.ratingScore)}%)`);
  if (factors.streakScore) bits.push(`racha reciente (${pct(factors.streakScore)}%)`);
  if (factors.h2hScore) bits.push(`cruce directo (${pct(factors.h2hScore)}%)`);
  if (bits.length === 0) return 'Pick generado sin suficiente historial todavía.';
  return `Favorito según ${bits.join(', ')}.`;
}

const TIER_LABEL = { alta: 'Alta confianza', media: 'Media confianza', baja: 'Confianza baja' };

const SIDE_TONE = { left: 'var(--court)', right: 'var(--blue)' };

// Avatar de un USUARIO del sitio (no de un jugador de tenis de mesa)
// — prioridad emoji > foto propia/de Google > iniciales, la misma en
// todos los lugares donde se muestra (chip del header, Perfil,
// mensajes del chat).
function UserAvatar({ emoji, url, initials, className = '' }) {
  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      {emoji ? (
        <span aria-hidden="true" style={{ fontSize: '85%', lineHeight: 1 }}>
          {emoji}
        </span>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials
      )}
    </div>
  );
}

function PlayerAvatar({ name, avatarUrl, initials, side = 'left', className = '' }) {
  return (
    <div className={`avatar ${className}`} style={{ '--tone': SIDE_TONE[side] }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        initials
      )}
    </div>
  );
}

// "live" llega como prop, ya resuelto por Home en un solo poller
// compartido (ver liveScores más abajo) — antes cada PickCard/MatchRow
// en pantalla pedía su propio marcador cada 8s por separado, así que
// con varios partidos en vivo a la vez se disparaban pedidos
// duplicados al mismo endpoint una y otra vez.
function PickCard({ pick, onClick, followed, onToggleFollow, featured, oddsFormat = 'decimal', live }) {
  let liveSetsWonA = null;
  let liveSetsWonB = null;
  if (pick.matchStatus === 'live' && live) {
    if (live.source === 'kambi') {
      liveSetsWonA = (live.sets || []).filter((s) => s.a > s.b).length;
      liveSetsWonB = (live.sets || []).filter((s) => s.b > s.a).length;
    } else if (live.source === 'tt' && live.scoreOne != null) {
      liveSetsWonA = live.scoreOne;
      liveSetsWonB = live.scoreTwo;
    }
  }

  // pick.player/pick.opponent están ordenados por favorito/rival, no
  // por local/visitante — pero el local SIEMPRE va a la izquierda con
  // camiseta roja, y el visitante a la derecha con camiseta azul
  // (mismo criterio que MatchRow), sin importar a quién le apostamos.
  const leftIsFavored = pick.favoredIsA !== false;
  const leftPlayer = leftIsFavored
    ? { name: pick.player, avatarUrl: pick.avatarUrl, initials: pick.initials }
    : { name: pick.opponent, avatarUrl: pick.opponentAvatarUrl, initials: pick.opponentInitials };
  const rightPlayer = leftIsFavored
    ? { name: pick.opponent, avatarUrl: pick.opponentAvatarUrl, initials: pick.opponentInitials }
    : { name: pick.player, avatarUrl: pick.avatarUrl, initials: pick.initials };

  return (
    <div className={`pick-card ${featured ? 'pick-card-featured' : ''}`} onClick={onClick}>
      {onToggleFollow ? (
        <button
          className={`follow-btn ${followed ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFollow(pick);
          }}
          title={followed ? 'Dejar de seguir este pick' : 'Seguir este pick'}
        >
          {followed ? '★' : '☆'}
        </button>
      ) : null}
      <div className="pc-head">
        {featured ? (
          <span className="tier-badge tier-featured">★ Pick destacado del día</span>
        ) : (
          <span className={`tier-badge tier-${pick.tier}`}>{TIER_LABEL[pick.tier]}</span>
        )}
        <span className="pc-head-right">
          <span className="pc-meta">
            {pick.tournament} · {pick.time}
          </span>
          {pick.matchStatus === 'live' ? (
            <span className="status live">En vivo</span>
          ) : pick.matchStatus === 'done' ? (
            <span className="status done">Finalizado</span>
          ) : null}
        </span>
      </div>
      <div className="pc-vs">
        <div className="pc-player">
          <PlayerAvatar name={leftPlayer.name} avatarUrl={leftPlayer.avatarUrl} initials={leftPlayer.initials} side="left" />
          <span className="pc-player-name">{leftPlayer.name}</span>
        </div>
        {liveSetsWonA != null ? (
          <span className="pc-vs-badge pc-vs-live num">
            {liveSetsWonA}-{liveSetsWonB}
          </span>
        ) : pick.matchStatus === 'live' ? (
          <span className="pc-vs-badge pc-vs-live num">···</span>
        ) : pick.matchStatus === 'done' && pick.score ? (
          <span
            className="pc-vs-badge pc-vs-live num"
            style={{ color: pick.result === 'hit' ? 'var(--hit)' : pick.result === 'miss' ? 'var(--miss)' : 'var(--court)' }}
          >
            {pick.score}
          </span>
        ) : (
          <span className="pc-vs-badge">VS</span>
        )}
        <div className="pc-player">
          <PlayerAvatar name={rightPlayer.name} avatarUrl={rightPlayer.avatarUrl} initials={rightPlayer.initials} side="right" />
          <span className="pc-player-name">{rightPlayer.name}</span>
        </div>
      </div>
      {pick.matchStatus === 'live' && live?.source === 'kambi' && live.sets?.length > 0 ? (
        <div className="mc-live-score">
          {live.sets.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
          {live.current ? (
            <span className="mc-set mc-set-current num">
              {live.current.a}-{live.current.b}
            </span>
          ) : null}
        </div>
      ) : null}
      {pick.matchStatus === 'done' && pick.setScores && pick.setScores.length > 0 ? (
        <div className="mc-live-score mc-live-score-small">
          {pick.setScores.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
        </div>
      ) : null}
      {pick.streakLabel || pick.h2hTotal > 0 ? (
        <div className="pc-stats-row">
          {pick.h2hTotal > 0 ? (
            <div className="pc-stat">
              <span className="l">H2H</span>
              <span className="v num">{pick.h2h}</span>
            </div>
          ) : null}
          {pick.streakLabel ? (
            <div className="pc-stat">
              <span className="l">Racha</span>
              <span className="v num">{pick.streakLabel}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="pc-ia-row">
        <span className="pc-ia-label">Índice IA</span>
        <span className="pc-ia-val num">{pick.confidence}%</span>
      </div>
      <div className="ia-bar-track">
        <div className={`ia-bar-fill tier-${pick.tier}`} style={{ width: `${pick.confidence}%` }}></div>
      </div>
      <div className="pc-foot">
        <span className="odd-mini num">{pick.odds ? formatOdds(pick.odds, oddsFormat) : 'Cuota N/D'}</span>
        {featured ? (
          <button
            className="btn btn-ball"
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            Ver análisis completo →
          </button>
        ) : pick.result && pick.result !== 'pending' ? (
          <span className={`result-pill ${pick.result}`}>{pick.result === 'hit' ? 'Acierto' : 'Fallo'}</span>
        ) : null}
      </div>
    </div>
  );
}

// Tarjeta de "Seguidos" — a diferencia de PickCard (que muestra los
// DOS jugadores lado a lado con "VS"), esta muestra una sola foto
// grande del jugador favorito (a quien le apostamos), estilo tarjeta
// de picks de otra app que se pidió replicar tal cual: foto grande
// arriba, insignia de acierto/fallo encima en una esquina, nombre +
// contra quién abajo, la selección en una píldora de color, y la
// barra del Índice IA como "barra de progreso" en la parte de abajo.
function FollowedPickCard({ pick, onClick, followed, onToggleFollow }) {
  const resultClass = pick.result === 'hit' ? 'hit' : pick.result === 'miss' ? 'miss' : 'pending';
  return (
    <div className="followed-card" onClick={onClick}>
      <div className="followed-photo">
        {pick.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pick.avatarUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
        ) : (
          <span className="followed-photo-initials">{pick.initials}</span>
        )}
        {onToggleFollow ? (
          <button
            className={`follow-btn followed-star ${followed ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFollow(pick);
            }}
            title={followed ? 'Dejar de seguir este pick' : 'Seguir este pick'}
          >
            {followed ? '★' : '☆'}
          </button>
        ) : null}
        <span className="followed-flag-badge">🇨🇿</span>
        {pick.result === 'hit' ? (
          <span className="followed-result-badge hit">
            <ProfileIcon name="check" size={16} />
          </span>
        ) : pick.result === 'miss' ? (
          <span className="followed-result-badge miss">✕</span>
        ) : pick.matchStatus === 'live' ? (
          <span className="followed-result-badge live">
            <span className="live-dot"></span>
          </span>
        ) : null}
      </div>

      <div className="followed-body">
        <span className="followed-tournament">{pick.tournament}</span>
        <strong className="followed-name">{pick.player}</strong>
        <span className="followed-meta">
          vs {pick.opponent} · {pick.time}
        </span>
        <span className={`followed-pill ${resultClass}`}>{pick.market}</span>
        <div className="followed-bar-row">
          <div className="followed-bar-track">
            <div className={`followed-bar-fill ${resultClass}`} style={{ width: `${pick.confidence}%` }}></div>
          </div>
          <span className="followed-bar-val num">{pick.confidence}</span>
        </div>
      </div>
    </div>
  );
}

// Tarjeta de doble foto.
function MatchRow({ m, onClick, followed, onToggleFollow, live }) {
  const label = m.status === 'live' ? 'En vivo' : m.status === 'done' ? 'Finalizado' : 'Pendiente';

  // Mientras está en vivo, el centro de la tarjeta muestra sets
  // ganados por cada lado en vez de "VS" — se cuenta a partir de los
  // sets ya cerrados que trae el marcador en vivo.
  let liveSetsWonA = null;
  let liveSetsWonB = null;
  if (m.status === 'live' && live) {
    if (live.source === 'kambi') {
      liveSetsWonA = (live.sets || []).filter((s) => s.a > s.b).length;
      liveSetsWonB = (live.sets || []).filter((s) => s.b > s.a).length;
    } else if (live.source === 'tt' && live.scoreOne != null) {
      liveSetsWonA = live.scoreOne;
      liveSetsWonB = live.scoreTwo;
    }
  }

  return (
    <div className="match-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      {m.pickId && onToggleFollow ? (
        <button
          className={`follow-btn ${followed ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFollow({ id: m.pickId, matchId: m.matchId });
          }}
          title={followed ? 'Dejar de seguir este pick' : 'Seguir este pick'}
        >
          {followed ? '★' : '☆'}
        </button>
      ) : null}
      <div className="mc-head">
        <span className="pc-meta">
          {m.time} · {m.tournament}
        </span>
        <span className={`status ${m.status}`}>{label}</span>
      </div>
      <div className="pc-vs">
        <div className="pc-player">
          <PlayerAvatar name={m.playerA} avatarUrl={m.playerAAvatar} initials={m.playerAInitials} side="left" />
          <span className="pc-player-name">
            <span className="flag">🇨🇿</span> {m.playerA}
          </span>
        </div>
        {liveSetsWonA != null ? (
          <span className="pc-vs-badge pc-vs-live num">
            {liveSetsWonA}-{liveSetsWonB}
          </span>
        ) : m.status === 'done' && m.score ? (
          <span
            className="pc-vs-badge pc-vs-live num"
            style={{
              color: m.pickResult === 'hit' ? 'var(--hit)' : m.pickResult === 'miss' ? 'var(--miss)' : 'var(--court)'
            }}
          >
            {m.score}
          </span>
        ) : (
          <span className="pc-vs-badge">VS</span>
        )}
        <div className="pc-player">
          <PlayerAvatar name={m.playerB} avatarUrl={m.playerBAvatar} initials={m.playerBInitials} side="right" />
          <span className="pc-player-name">
            <span className="flag">🇨🇿</span> {m.playerB}
          </span>
        </div>
      </div>
      {m.status === 'done' && m.setScores && m.setScores.length > 0 ? (
        <div className="mc-live-score mc-live-score-small">
          {m.setScores.map((s, i) => (
            <span className="mc-set num" key={i}>
              {s.a}-{s.b}
            </span>
          ))}
        </div>
      ) : null}
      {m.status === 'live' ? (
        <div className="mc-live-score">
          {live?.source === 'kambi' ? (
            <>
              {(live.sets || []).map((s, i) => (
                <span className="mc-set num" key={i}>
                  {s.a}-{s.b}
                </span>
              ))}
              {live.current ? (
                <span className="mc-set mc-set-current num">
                  {live.current.a}-{live.current.b}
                </span>
              ) : null}
            </>
          ) : live?.source === 'tt' && live.scoreOne != null ? (
            <span className="num">
              Sets: {live.scoreOne}-{live.scoreTwo}
            </span>
          ) : (
            <span className="mc-live-loading">Buscando marcador…</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Chat en vivo del partido — un cuarto por match_source_id. Cualquiera
// puede leer; escribir requiere sesión iniciada. Usa Supabase Realtime
// para que los mensajes nuevos aparezcan solos, sin refrescar.
function LiveChat({ matchSourceId, user, profile }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!supabaseClient || !matchSourceId) return undefined;
    let cancelled = false;

    supabaseClient
      .from('chat_messages')
      .select('id, user_name, user_avatar, user_avatar_emoji, message, created_at, sender_level')
      .eq('match_source_id', matchSourceId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data);
      });

    const channel = supabaseClient
      .channel(`chat:${matchSourceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `match_source_id=eq.${matchSourceId}` },
        (payload) => setMessages((prev) => [...prev, payload.new])
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabaseClient.removeChannel(channel);
    };
  }, [matchSourceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !user || !supabaseClient) return;
    setSending(true);
    const { error } = await supabaseClient.from('chat_messages').insert({
      match_source_id: matchSourceId,
      user_id: user.id,
      user_name: profile?.displayName || user.user_metadata?.full_name || user.email,
      user_avatar: profile?.avatarEmoji ? null : profile?.avatarUrl || user.user_metadata?.avatar_url || null,
      user_avatar_emoji: profile?.avatarEmoji || null,
      message: trimmed.slice(0, 300)
    });
    setSending(false);
    if (!error) setText('');
  };

  return (
    <div className="live-chat">
      <div className="hist-title">
        <span>Chat en vivo</span>
      </div>
      <div className="live-chat-list">
        {messages.length === 0 ? (
          <p className="page-sub" style={{ margin: 0 }}>
            Nadie ha escrito todavía — sé el primero.
          </p>
        ) : (
          messages.map((msg) => (
            <div className="live-chat-msg" key={msg.id}>
              <div className="live-chat-avatar">
                <UserAvatar
                  emoji={msg.user_avatar_emoji}
                  url={msg.user_avatar}
                  initials={<span className="live-chat-avatar-fallback">{(msg.user_name || '?')[0].toUpperCase()}</span>}
                />
              </div>
              <div>
                <div className="live-chat-name">
                  {msg.user_name || 'Anónimo'}
                  {msg.sender_level ? (
                    <span className={`level-badge tier-${levelTier(msg.sender_level)}`}>Nv.{msg.sender_level}</span>
                  ) : null}
                </div>
                <div className="live-chat-text">{msg.message}</div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      {user ? (
        <form className="live-chat-form" onSubmit={send}>
          <input
            type="text"
            placeholder="Escribe algo..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
          />
          <button type="submit" disabled={sending || !text.trim()}>
            Enviar
          </button>
        </form>
      ) : (
        <p className="page-sub" style={{ margin: '10px 0 0' }}>
          Inicia sesión con Google (arriba a la derecha) para escribir en el chat.
        </p>
      )}
    </div>
  );
}

// Modal de detalle de un partido. Solo mientras está abierto (y solo
// si el partido sigue en vivo) consulta cada 8s el marcador real —
// primero contra Rushbet (set por set + reloj), y si no lo tiene,
// contra tt.league-pro.com directo.
function MatchDetailModal({ m, onClose, user, profile, lang }) {
  const t = useTranslate(lang);
  const [live, setLive] = useState(null);
  const [form, setForm] = useState(null);

  // Forma reciente + H2H de los dos, una sola vez al abrir el modal —
  // no cambia mientras está abierto (a diferencia del marcador en
  // vivo), así que no hace falta repetir la consulta.
  useEffect(() => {
    if (!m.playerAId || !m.playerBId) return;
    let cancelled = false;
    fetch(`/api/player-form?playerAId=${m.playerAId}&playerBId=${m.playerBId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setForm(data);
      })
      .catch((e) => console.error('Error cargando forma reciente:', e));
    return () => {
      cancelled = true;
    };
  }, [m.playerAId, m.playerBId]);

  useEffect(() => {
    if (m.status !== 'live') return undefined;
    let cancelled = false;

    async function poll() {
      if (document.visibilityState === 'hidden') return;
      const params = new URLSearchParams();
      if (m.playerA) params.set('playerA', m.playerA);
      if (m.playerB) params.set('playerB', m.playerB);
      if (m.tournamentId) params.set('tournamentId', m.tournamentId);
      if (m.sourceId) params.set('matchId', m.sourceId);
      try {
        const res = await fetch(`/api/live-match?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLive(data);
      } catch (e) {
        // silencioso — se queda con el último dato válido hasta el próximo intento
      }
    }

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [m.status, m.playerA, m.playerB, m.tournamentId, m.sourceId]);

  const nowFinished = live?.status === 'finished';

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="sub">
              {m.tournament} · {m.time}
            </div>
            <h3>{m.players}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {nowFinished ? (
          <div className="modal-market">{t('partidoTerminadoRecarga')}</div>
        ) : m.status === 'live' && live?.source === 'kambi' ? (
          <>
            {live.clock ? (
              <div className="live-clock">
                ⏱ {live.clock.minute}:{String(live.clock.second).padStart(2, '0')}
                {live.clock.running ? ` · ${t('corriendo')}` : ` · ${t('pausado')}`}
              </div>
            ) : null}
            <div className="live-sets-grid">
              {(live.sets || []).map((s, i) => (
                <div className="live-set-col" key={i}>
                  <div className="live-set-label">Set {i + 1}</div>
                  <div className="live-set-score">
                    {s.a}-{s.b}
                  </div>
                </div>
              ))}
              {live.current ? (
                <div className="live-set-col current">
                  <div className="live-set-label">{t('ahora')}</div>
                  <div className="live-set-score">
                    {live.current.a}-{live.current.b}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : m.status === 'live' && live?.source === 'tt' ? (
          <>
            <p className="page-sub">{t('rushbetSinTablero')}</p>
            {live.scoreOne != null ? (
              <div className="modal-market">
                {t('setsDosPuntos')} {live.scoreOne}-{live.scoreTwo}
              </div>
            ) : (
              <p className="page-sub">{t('sinSetsCerrados')}</p>
            )}
          </>
        ) : m.status === 'live' ? (
          <p className="page-sub">{t('buscandoMarcadorVivo')}</p>
        ) : m.status === 'done' && m.score ? (
          <>
            <div className="modal-market">{t('resultadoFinal')} {m.score}</div>
            {m.setScores && m.setScores.length > 0 ? (
              <div className="live-sets-grid">
                {m.setScores.map((s, i) => (
                  <div className="live-set-col" key={i}>
                    <div className="live-set-label">Set {i + 1}</div>
                    <div className="live-set-score">
                      {s.a}-{s.b}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="page-sub">{t('sinDetallePuntoAPunto')}</p>
            )}
          </>
        ) : (
          <p className="page-sub">{t('partidoNoEmpieza')}</p>
        )}

        {form ? (
          <>
            <div className="hist-title">
              <span>{t('formaReciente')} {m.playerA}</span>
            </div>
            <RecentFormList history={form.historyA.slice(0, 5)} />

            <div className="hist-title">
              <span>{t('formaReciente')} {m.playerB}</span>
            </div>
            <RecentFormList history={form.historyB.slice(0, 5)} />

            {form.h2hTotal > 0 ? (
              <>
                <div className="hist-title">
                  <span>
                    H2H {m.playerA} vs {m.playerB}
                  </span>
                  <span className="num">{form.h2h}</span>
                </div>
                <div className="h2h-bar-track">
                  <div
                    className="h2h-bar-fill"
                    style={{ width: `${(Number(form.h2h.split('-')[0]) / form.h2hTotal) * 100}%` }}
                  ></div>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {m.status === 'live' && !nowFinished ? (
          <LiveChat matchSourceId={m.sourceId} user={user} profile={profile} />
        ) : null}
      </div>
    </div>
  );
}

function DonutChart({ wins, total }) {
  if (!total) return null;
  const pct = wins / total;
  const r = 40;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <svg viewBox="0 0 100 100" className="donut">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-alt)" strokeWidth="12" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--hit)"
        strokeWidth="12"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="48" textAnchor="middle" className="donut-pct num" style={{ fill: 'var(--ink)' }}>
        {Math.round(pct * 100)}%
      </text>
      <text x="50" y="65" textAnchor="middle" className="donut-sub" style={{ fill: 'var(--muted)' }}>
        {wins}/{total}
      </text>
    </svg>
  );
}

// Lista de "últimos partidos" estilo Sofascore/AiScore: una fila por
// partido real, con fecha, contra quién, el marcador de sets de ESE
// cruce, y un círculo verde/rojo de victoria o derrota — no puntos ni
// barras abstractas.
function RecentFormList({ history }) {
  if (!history || history.length === 0) {
    return <p className="page-sub">Sin historial reciente todavía.</p>;
  }
  return (
    <div className="form-list">
      {history.map((m, i) => (
        <div className="form-list-row" key={i}>
          <div className="form-list-meta">
            <span className="form-list-date">{shortDate(m.date)}</span>
            <span className="form-list-ft">FT</span>
          </div>
          <div className="form-list-opp">
            vs {m.opponent}
            <span className="form-list-score num">
              {m.setsFor}-{m.setsAgainst}
            </span>
          </div>
          <span className={`form-list-badge ${m.win ? 'win' : 'loss'}`}>{m.win ? 'W' : 'L'}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ series }) {
  if (!series || series.length < 2) {
    return <p className="page-sub">Todavía no hay suficiente historial para graficar.</p>;
  }
  const w = 100;
  const h = 40;
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const range = max - min || 1;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg className="line-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 2" />
      <polyline points={points} fill="none" stroke="var(--court)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Análisis de apoyo real para la pestaña "Análisis" — además de la
// frase de buildAnalysis (de qué factores sale el % de confianza),
// arma oraciones extra con datos que YA tenemos en el pick (forma
// reciente, racha, H2H, y la probabilidad implícita de la cuota real
// de Rushbet comparada con nuestra confianza) — nada inventado, cada
// línea sale de un número que ya se le muestra al usuario en otra
// parte de la misma tarjeta.
function buildRichAnalysis(pick, t) {
  const lines = [];

  if (pick.history && pick.history.length > 0) {
    const wins = pick.history.filter((h) => h.win).length;
    const pct = Math.round((wins / pick.history.length) * 100);
    lines.push(t('analisisForma', { n: pick.history.length, player: pick.player, wins, pct }));
  } else {
    lines.push(t('analisisSinHistorial', { player: pick.player }));
  }

  if (pick.streakLabel) {
    lines.push(t('analisisRacha', { streak: pick.streakLabel }));
  }

  if (pick.h2hTotal > 0) {
    lines.push(t('analisisH2H', { opponent: pick.opponent, record: pick.h2h }));
  }

  if (pick.odds && pick.odds > 1) {
    const implied = Math.round((1 / pick.odds) * 100);
    lines.push(t('analisisCuotaValor', { odds: pick.odds.toFixed(2), implied, confidence: pick.confidence }));
  } else {
    lines.push(t('analisisSinCuota'));
  }

  return lines;
}

// Modal de detalle de un pick — "partido detallado" con el jugador y
// su rival de frente (marcador real si ya se jugó, VS si todavía no),
// y 4 pestañas: Resumen (sets si los tenemos + los datos clave de un
// vistazo), Estadísticas (forma reciente con selector L5/L10),
// Análisis (el texto de por qué es favorito) y H2H (cruce directo
// partido por partido). Todo lo que se muestra sale de datos reales
// que ya calculamos — no se inventa ningún número.
function PickDetailModal({ pick, onClose, oddsFormat = 'decimal', lang }) {
  const t = useTranslate(lang);
  const [tab, setTab] = useState('resumen');
  // "Estadísticas" ahora es un solo tab con 3 botones (local/H2H/
  // visitante) y un selector de cantidad aparte — L5/L10 para forma
  // reciente, L5/L10/L20 para H2H (el H2H suelto que había antes se
  // fusionó acá).
  const [statSide, setStatSide] = useState('local');
  const [statRange, setStatRange] = useState(10);

  // Local (camiseta roja) siempre a la izquierda, visitante (azul) a
  // la derecha — pick.player/pick.opponent están ordenados por
  // favorito/rival, no por local/visitante, así que se reordena acá.
  const leftIsFavored = pick.favoredIsA !== false;
  const leftPlayer = leftIsFavored
    ? { name: pick.player, avatarUrl: pick.avatarUrl, initials: pick.initials }
    : { name: pick.opponent, avatarUrl: pick.opponentAvatarUrl, initials: pick.opponentInitials };
  const rightPlayer = leftIsFavored
    ? { name: pick.opponent, avatarUrl: pick.opponentAvatarUrl, initials: pick.opponentInitials }
    : { name: pick.player, avatarUrl: pick.avatarUrl, initials: pick.initials };

  // Forma reciente de CADA jugador (antes solo se guardaba/mostraba
  // la del favorito) — se arma acá la del local y la del visitante
  // por separado, respetando el selector de cantidad.
  const leftHistoryFull = leftIsFavored ? pick.history : pick.opponentHistory;
  const rightHistoryFull = leftIsFavored ? pick.opponentHistory : pick.history;
  const displayLeftHistory = leftHistoryFull.slice(0, Math.min(statRange, 10));
  const displayRightHistory = rightHistoryFull.slice(0, Math.min(statRange, 10));
  const hitsLeft = displayLeftHistory.filter((m) => m.win).length;
  const hitsRight = displayRightHistory.filter((m) => m.win).length;
  const displayH2H = pick.h2hMatches.slice(0, statRange);
  const hitsH2H = displayH2H.filter((m) => m.win).length;

  const isDone = pick.result === 'hit' || pick.result === 'miss';
  const won = pick.result === 'hit';

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <span className="eyebrow">{t('partidoDetallado')}</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="match-hero">
          <div className="match-hero-side">
            <PlayerAvatar name={leftPlayer.name} avatarUrl={leftPlayer.avatarUrl} initials={leftPlayer.initials} side="left" className="match-hero-avatar" />
            <span className="match-hero-name">
              <span className="flag">🇨🇿</span> {leftPlayer.name}
            </span>
          </div>

          <div className="match-hero-center">
            {isDone && pick.score ? (
              <div className="match-hero-score num">{pick.score}</div>
            ) : (
              <div className="match-hero-vs">VS</div>
            )}
            <div className="match-hero-meta">
              {pick.tournament} · {pick.time}
            </div>
            {isDone ? (
              <span className={`match-hero-pill ${won ? 'win' : 'loss'}`}>{won ? t('acierto') : t('fallado')}</span>
            ) : (
              <span className="match-hero-pill pending">{pick.market}</span>
            )}
          </div>

          <div className="match-hero-side">
            <PlayerAvatar
              name={rightPlayer.name}
              avatarUrl={rightPlayer.avatarUrl}
              initials={rightPlayer.initials}
              side="right"
              className="match-hero-avatar"
            />
            <span className="match-hero-name">
              <span className="flag">🇨🇿</span> {rightPlayer.name}
            </span>
          </div>
        </div>

        <div className="tabs">
          <div className={`tab ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setTab('resumen')}>
            {t('tabResumen')}
          </div>
          <div className={`tab ${tab === 'estadisticas' ? 'active' : ''}`} onClick={() => setTab('estadisticas')}>
            {t('tabEstadisticas')}
          </div>
          <div className={`tab ${tab === 'analisis' ? 'active' : ''}`} onClick={() => setTab('analisis')}>
            {t('tabAnalisis')}
          </div>
        </div>

        {tab === 'resumen' ? (
          <>
            {pick.setScores && pick.setScores.length > 0 ? (
              <>
                <div className="hist-title">
                  <span>{t('sets')}</span>
                </div>
                <div className="live-sets-grid">
                  {pick.setScores.map((s, i) => (
                    <div className="live-set-col" key={i}>
                      <div className="live-set-label">Set {i + 1}</div>
                      <div className="live-set-score">
                        {s.a}-{s.b}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <div className="stat-rows">
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">📊 {t('indiceIA')}</span>
                  <span className="stat-row-value num">{pick.confidence}%</span>
                </div>
                <div className="stat-row-bar">
                  <div className="stat-row-bar-fill" style={{ width: `${pick.confidence}%` }}></div>
                </div>
              </div>
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">🎯 {t('cuotaRushbet')}</span>
                  <span className="stat-row-value num">{pick.odds ? formatOdds(pick.odds, oddsFormat) : t('noDisponible')}</span>
                </div>
              </div>
              <div className="stat-row">
                <div className="stat-row-top">
                  <span className="stat-row-label">🔥 {t('racha')}</span>
                  <span className="stat-row-value num">{pick.streakLabel || '—'}</span>
                </div>
              </div>
              {pick.h2hTotal > 0 ? (
                <div className="stat-row">
                  <div className="stat-row-top">
                    <span className="stat-row-label">⚔️ H2H</span>
                    <span className="stat-row-value num">{pick.h2h}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : tab === 'estadisticas' ? (
          <>
            <div className="tabs" style={{ marginBottom: '10px' }}>
              <div className={`tab ${statSide === 'local' ? 'active' : ''}`} onClick={() => setStatSide('local')}>
                {leftPlayer.name}
              </div>
              <div className={`tab ${statSide === 'h2h' ? 'active' : ''}`} onClick={() => setStatSide('h2h')}>
                H2H
              </div>
              <div className={`tab ${statSide === 'visitante' ? 'active' : ''}`} onClick={() => setStatSide('visitante')}>
                {rightPlayer.name}
              </div>
            </div>

            <div className="tabs" style={{ marginBottom: '14px' }}>
              <div className={`tab ${statRange === 5 ? 'active' : ''}`} onClick={() => setStatRange(5)}>
                L5
              </div>
              <div className={`tab ${statRange === 10 ? 'active' : ''}`} onClick={() => setStatRange(10)}>
                L10
              </div>
              {statSide === 'h2h' ? (
                <div className={`tab ${statRange === 20 ? 'active' : ''}`} onClick={() => setStatRange(20)}>
                  L20
                </div>
              ) : null}
            </div>

            {statSide === 'local' ? (
              displayLeftHistory.length > 0 ? (
                <>
                  <div className="donut-row">
                    <DonutChart wins={hitsLeft} total={displayLeftHistory.length} />
                    <div>
                      <div className="hist-title" style={{ margin: 0 }}>
                        <span>{t('ultimos')} {displayLeftHistory.length} {t('partidosPl')}</span>
                      </div>
                      <p className="page-sub" style={{ margin: '4px 0 0' }}>
                        {hitsLeft} {t('victorias')}, {displayLeftHistory.length - hitsLeft} {t('derrotas')}
                      </p>
                    </div>
                  </div>
                  <RecentFormList history={displayLeftHistory} />
                </>
              ) : (
                <p className="page-sub">{t('sinHistorial')}</p>
              )
            ) : statSide === 'visitante' ? (
              displayRightHistory.length > 0 ? (
                <>
                  <div className="donut-row">
                    <DonutChart wins={hitsRight} total={displayRightHistory.length} />
                    <div>
                      <div className="hist-title" style={{ margin: 0 }}>
                        <span>{t('ultimos')} {displayRightHistory.length} {t('partidosPl')}</span>
                      </div>
                      <p className="page-sub" style={{ margin: '4px 0 0' }}>
                        {hitsRight} {t('victorias')}, {displayRightHistory.length - hitsRight} {t('derrotas')}
                      </p>
                    </div>
                  </div>
                  <RecentFormList history={displayRightHistory} />
                </>
              ) : (
                <p className="page-sub">{t('sinHistorial')}</p>
              )
            ) : displayH2H.length > 0 ? (
              <>
                <div className="hist-title">
                  <span>{t('h2hContra')} {pick.opponent}</span>
                  <span className="num">
                    {hitsH2H}-{displayH2H.length - hitsH2H}
                  </span>
                </div>
                <div className="h2h-bar-track">
                  <div className="h2h-bar-fill" style={{ width: `${(hitsH2H / displayH2H.length) * 100}%` }}></div>
                </div>
                <RecentFormList history={displayH2H} />
              </>
            ) : (
              <p className="page-sub">{t('sinEnfrentamientos')}</p>
            )}
          </>
        ) : tab === 'analisis' ? (
          <div className="analysis">
            <p>{pick.analysis}</p>
            {buildRichAnalysis(pick, t).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Tabla de grupo de un torneo — todos contra todos, igual a como la
// muestra tt.league-pro.com dentro de cada torneo: una fila por
// jugador, una columna por cada rival con el marcador de sets de ese
// cruce, y el total de sets + puesto a la derecha.
const MODEL_FACTOR_LABEL = { ratingScore: 'Rating', streakScore: 'Racha', h2hScore: 'H2H' };

// Si el intervalo de confianza 95% (Wilson) NO cruza el 50%, el
// resultado ya es estadísticamente distinguible de una moneda al aire
// (para bien o para mal). Si lo cruza, todavía no hay muestra
// suficiente para saberlo — no es lo mismo que "no funciona".
function ModelStatsView({ stats }) {
  const [loWilson, hiWilson] = stats.wilson95;
  const verdict = loWilson > 0.5 ? 'better' : hiWilson < 0.5 ? 'worse' : 'unknown';
  const verdictLabel =
    verdict === 'better'
      ? '✅ Mejor que el azar (estadísticamente)'
      : verdict === 'worse'
      ? '⚠️ Peor que el azar (estadísticamente)'
      : '⏳ Todavía no se puede distinguir del azar';

  return (
    <>
      <div className="stat-strip stat-strip-3">
        <div className="stat-card">
          <div className="label">Picks resueltos</div>
          <div className="value num">{stats.n}</div>
        </div>
        <div className="stat-card">
          <div className="label">Efectividad</div>
          <div className="value hit num">{Math.round(stats.hitRate * 100)}%</div>
        </div>
        <div className="stat-card">
          <div className="label">IC 95% (Wilson)</div>
          <div className="value num">
            {Math.round(loWilson * 100)}–{Math.round(hiWilson * 100)}%
          </div>
        </div>
      </div>

      <div className={`model-verdict model-verdict-${verdict}`}>{verdictLabel}</div>

      <div className="section-head">
        <h2>Por rango de confianza</h2>
      </div>
      <div className="stat-rows">
        {stats.buckets.map((b) => (
          <div className="stat-row" key={b.range}>
            <div className="stat-row-top">
              <span className="stat-row-label">Confianza {b.range}%</span>
              <span className="stat-row-value num">
                {b.n === 0 ? 'Sin datos' : `${Math.round(b.hitRate * 100)}% (n=${b.n})`}
              </span>
            </div>
            {b.n > 0 ? (
              <div className="stat-row-bar">
                <div className="stat-row-bar-fill" style={{ width: `${Math.round(b.hitRate * 100)}%` }}></div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Peso de cada factor</h2>
      </div>
      <p className="page-sub">Promedio del aporte de cada factor cuando el pick acertó vs. cuando falló.</p>
      <div className="stat-rows">
        {Object.entries(stats.factorAvg).map(([key, v]) => (
          <div className="stat-row" key={key}>
            <div className="stat-row-top">
              <span className="stat-row-label">{MODEL_FACTOR_LABEL[key] || key}</span>
              <span className="stat-row-value num">
                acierto {v.avgOnHit.toFixed(2)} · fallo {v.avgOnMiss.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>Últimos {stats.recentSequence.length} resueltos</h2>
      </div>
      <div className="form-list">
        {stats.recentSequence.map((r, i) => (
          <div className="form-list-row" key={i}>
            <div className="form-list-meta">
              <span className="form-list-date">{shortDate(r.date)}</span>
              <span className="form-list-ft">Índice IA</span>
            </div>
            <div className="form-list-opp">
              confianza
              <span className="form-list-score num">{r.confidence}%</span>
            </div>
            <span className={`form-list-badge ${r.win ? 'win' : 'loss'}`}>{r.win ? 'W' : 'L'}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function GroupTable({ group }) {
  return (
    <div className="standings-card">
      <div className="standings-head">{group.name}</div>
      <div className="group-table-wrap">
        <table className="group-table">
          <thead>
            <tr>
              <th></th>
              <th>Jugador</th>
              <th>Rating</th>
              {group.players.map((p) => (
                <th key={p.id} className="num">
                  {p.name.split(' ')[0]}
                </th>
              ))}
              <th>Sets</th>
              <th>Bolas</th>
              <th>Puntos</th>
              <th>Puesto</th>
            </tr>
          </thead>
          <tbody>
            {group.players.map((row) => (
              <tr key={row.id}>
                <td>
                  <PlayerAvatar name={row.name} avatarUrl={row.avatarUrl} initials={row.initials} className="standings-avatar" />
                </td>
                <td className="group-player-name">{row.name}</td>
                <td className="num">{row.rating ?? '—'}</td>
                {group.players.map((col) =>
                  col.id === row.id ? (
                    <td key={col.id} className="num group-self">
                      ·
                    </td>
                  ) : (
                    <td key={col.id} className="num">
                      {group.matchup[row.id]?.[col.id] || '—'}
                    </td>
                  )
                )}
                <td className="num">
                  {row.setsFor}-{row.setsAgainst}
                </td>
                <td className="num">{row.ballsFor != null ? `${row.ballsFor}-${row.ballsAgainst}` : '—'}</td>
                <td className="num">{row.points}</td>
                <td className="num">{row.place}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Banco de consejos — cada vez que se dispara el modal se eligen 3 al
// azar (sin repetir dentro de la misma aparición), para que no se
// sienta como el mismo aviso copiado y pegado cada vez que alguien
// pasa de 3 seguidos.
const RISK_TIPS = [
  {
    icon: 'trending-down',
    title: 'Protege tu bankroll',
    body: 'Reparte tu banco entre las selecciones que sigues. Evita concentrar más de lo que te sientas cómodo gestionando en un solo día.'
  },
  {
    icon: 'layers',
    title: 'Mantén una jornada enfocada',
    body: 'Seguir menos selecciones facilita revisar el rendimiento y controlar mejor la exposición diaria.'
  },
  {
    icon: 'shield',
    title: 'Define un límite diario de asignación',
    body: 'Usa el planificador Kelly en la pestaña Bankroll como referencia para no arriesgar más de la cuenta.'
  },
  {
    icon: 'target',
    title: 'Prioriza calidad sobre cantidad',
    body: 'Entre más picks sigas a la vez, más difícil es darle seguimiento real a cada uno cuando estén en vivo.'
  },
  {
    icon: 'chart',
    title: 'Ninguna racha dura para siempre',
    body: 'Ajusta el tamaño de lo que arriesgas según tu propio límite, no solo según qué tan segura se vea la confianza del modelo.'
  },
  {
    icon: 'search',
    title: 'Revisa el historial real primero',
    body: 'Antes de subir el monto que arriesgas por pick, mira el acierto real acumulado en la pestaña Bankroll.'
  },
  {
    icon: 'dice',
    title: 'Diversifica entre torneos',
    body: 'Seguir picks de un solo torneo hace que un resultado inesperado pese más sobre tu banco completo.'
  },
  {
    icon: 'stop',
    title: 'Nunca sigas "para recuperar"',
    body: 'Cada pick es independiente — seguir uno más solo porque el anterior falló no cambia sus probabilidades reales.'
  },
  {
    icon: 'pause',
    title: 'El impulso es una señal',
    body: 'Si notas que estás siguiendo picks muy rápido, sin revisarlos, es buen momento para bajar el ritmo un rato.'
  }
];

function pickRandomTips(n = 3) {
  const shuffled = [...RISK_TIPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Se dispara cada vez que la cantidad de picks seguidos SUBE y pasa de
// 3 (no solo la primera vez) — ver el useEffect que llama a esto en
// Home. Los 3 consejos salen al azar del banco de arriba.
function RiskModal({ count, tips, onClose, lang }) {
  const t = useTranslate(lang);
  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal risk-modal">
        <div className="risk-modal-banner">
          <div className="risk-modal-handle"></div>
          <div className="risk-modal-banner-row">
            <div className="risk-modal-icon">
              <ProfileIcon name="shield" size={22} />
            </div>
            <div>
              <div className="risk-modal-eyebrow">{t('riskEyebrow')}</div>
              <h3>
                {t('riskSiguiendo')} {count} {count === 1 ? t('riskPick') : t('riskPicks')}
              </h3>
            </div>
          </div>
        </div>

        <div className="risk-tip-list">
          {tips.map((tip) => (
            <div className="risk-tip" key={tip.title}>
              <span className="risk-tip-icon">
                <ProfileIcon name={tip.icon} size={17} />
              </span>
              <div>
                <strong>{tip.title}</strong>
                <p>{tip.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn-ball risk-modal-btn" onClick={onClose}>
          <ProfileIcon name="check" size={16} />
          {t('entendido')}
        </button>
        <p className="risk-modal-disclaimer">{t('riskDisclaimer')}</p>
      </div>
    </div>
  );
}

// Decoración pura (mesa en perspectiva + pelota rebotando en loop) en
// los márgenes — SOLO existe visualmente a partir de 1400px de ancho
// (ver .table-decor en el CSS, display:none por debajo de eso), que
// es donde sobra espacio vacío a los lados del contenido (max-width
// 980px). "side" solo decide si se espeja con CSS (mismo SVG para los
// dos lados, con id único por lado para que el <mpath> de cada uno no
// choque) — no cambia el dibujo. pointer-events:none + aria-hidden
// porque es 100% decorativo, no debe interferir con nada ni leerse
// por un lector de pantalla.
function TableDecor({ side }) {
  const pathId = `table-decor-path-${side}`;
  return (
    <div className={`table-decor table-decor-${side}`} aria-hidden="true">
      <svg viewBox="0 0 200 500" width="200" height="500" fill="none">
        <path d="M14 90 L166 250 L14 420" stroke="var(--court)" strokeWidth="1.2" opacity="0.5" />
        <path d="M14 250 L200 250" stroke="var(--court)" strokeWidth="1" opacity="0.35" />
        <path
          id={pathId}
          d="M14,250 A78,118 0 1,0 170,250 A78,118 0 1,0 14,250 Z"
          stroke="var(--court)"
          strokeWidth="1"
          strokeDasharray="3 7"
          opacity="0.4"
        />
        <circle r="6" fill="var(--decor-ball)">
          <animateMotion dur="5s" repeatCount="indefinite">
            <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
          </animateMotion>
        </circle>
      </svg>
    </div>
  );
}

// Íconos de línea fina para las filas de Perfil — mismo estilo
// (trazo simple, sin relleno) que se ve en la mayoría de apps de
// picks/apuestas, dentro de una insignia circular oscura (ver
// .profile-row-icon en el CSS).
function ProfileIcon({ name, size = 20 }) {
  const common = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (name === 'edit') {
    return (
      <svg {...common}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === 'image') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    );
  }
  if (name === 'bell') {
    return (
      <svg {...common}>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    );
  }
  if (name === 'moon') {
    return (
      <svg {...common}>
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    );
  }
  if (name === 'shield') {
    return (
      <svg {...common}>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      </svg>
    );
  }
  if (name === 'chart') {
    return (
      <svg {...common}>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    );
  }
  if (name === 'eye') {
    return (
      <svg {...common}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (name === 'lock') {
    return (
      <svg {...common}>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  }
  if (name === 'crown') {
    return (
      <svg {...common}>
        <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7Z" />
      </svg>
    );
  }
  if (name === 'help') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (name === 'chevron-right') {
    return (
      <svg {...common}>
        <path d="m9 18 6-6-6-6" />
      </svg>
    );
  }
  if (name === 'card') {
    return (
      <svg {...common}>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    );
  }
  if (name === 'dollar') {
    return (
      <svg {...common}>
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    );
  }
  if (name === 'globe') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }
  if (name === 'sun') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    );
  }
  if (name === 'monitor') {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (name === 'arrow-left') {
    return (
      <svg {...common}>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </svg>
    );
  }
  if (name === 'user') {
    return (
      <svg {...common}>
        <path d="M20 21a8 8 0 0 0-16 0" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
  }
  if (name === 'tool') {
    return (
      <svg {...common}>
        <path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L2 19l3 3 7.1-7.1a4 4 0 0 0 5.6-5.6l-2.8 2.8-2-2Z" />
      </svg>
    );
  }
  if (name === 'mail') {
    return (
      <svg {...common}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m2 6 10 7 10-7" />
      </svg>
    );
  }
  if (name === 'chevron-down') {
    return (
      <svg {...common}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    );
  }
  if (name === 'trending-down') {
    return (
      <svg {...common}>
        <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
        <polyline points="16 17 22 17 22 11" />
      </svg>
    );
  }
  if (name === 'trending-up') {
    return (
      <svg {...common}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    );
  }
  if (name === 'layers') {
    return (
      <svg {...common}>
        <path d="m12 2 10 5-10 5L2 7Z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
    );
  }
  if (name === 'target') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === 'search') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    );
  }
  if (name === 'dice') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === 'stop') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
      </svg>
    );
  }
  if (name === 'pause') {
    return (
      <svg {...common}>
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
    );
  }
  if (name === 'file') {
    return (
      <svg {...common}>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z" />
        <path d="M14 2v6h6" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    );
  }
  if (name === 'alert') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    );
  }
  if (name === 'grid') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }
  if (name === 'zap') {
    return (
      <svg {...common}>
        <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />
      </svg>
    );
  }
  if (name === 'camera') {
    return (
      <svg {...common}>
        <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    );
  }
  if (name === 'trash') {
    return (
      <svg {...common}>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    );
  }
  return null;
}

function GoogleGIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size}>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.9 27 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C40.9 36.6 44 30.8 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

// Mini-onboarding de 3 pantallas — se muestra UNA vez por navegador
// en la primera visita (con o sin sesión, a diferencia del aviso de
// privacidad de abajo), explicando qué es CAMILOREY, qué es el
// Índice IA y qué es Mi Bankroll, para que alguien nuevo no llegue
// perdido a esos conceptos.
const ONBOARDING_SLIDES = [
  { icon: 'chart', titleKey: 'onboarding1Title', descKey: 'onboarding1Desc' },
  { icon: 'shield', titleKey: 'onboarding2Title', descKey: 'onboarding2Desc' },
  { icon: 'dollar', titleKey: 'onboarding3Title', descKey: 'onboarding3Desc' }
];

function OnboardingModal({ onClose, lang }) {
  const t = useTranslate(lang);
  const [slide, setSlide] = useState(0);
  const current = ONBOARDING_SLIDES[slide];
  const isLast = slide === ONBOARDING_SLIDES.length - 1;

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal login-modal">
        <button className="modal-close login-modal-close" onClick={onClose}>
          ✕
        </button>
        <div className="login-modal-icon" style={{ color: 'var(--court)' }}>
          <ProfileIcon name={current.icon} size={28} />
        </div>
        <h3 className="login-modal-title">{t(current.titleKey)}</h3>
        <p className="login-modal-sub">{t(current.descKey)}</p>

        <div className="onboarding-dots">
          {ONBOARDING_SLIDES.map((_, i) => (
            <span key={i} className={`onboarding-dot ${i === slide ? 'active' : ''}`}></span>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {slide === 0 ? (
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>
              {t('onboardingSaltar')}
            </button>
          ) : null}
          <button
            className="btn btn-ball"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => (isLast ? onClose() : setSlide((s) => s + 1))}
          >
            {isLast ? t('onboardingEntendido') : t('onboardingSiguiente')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Aviso de privacidad — se muestra UNA vez por navegador la primera
// vez que alguien inicia sesión (marcado en localStorage), con el
// mismo formato de "3 puntos numerados" que se pidió replicar de otra
// app. El contenido es real: describe exactamente lo que
// /privacidad ya documenta, no texto genérico de relleno.
function PrivacyConsentModal({ onClose, lang }) {
  const t = useTranslate(lang);
  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="risk-modal-head">
          <div className="risk-modal-icon">
            <ProfileIcon name="shield" size={22} />
          </div>
          <div>
            <div className="risk-modal-eyebrow">{t('privacyEyebrow')}</div>
            <h3 style={{ fontSize: '19px', margin: 0 }}>{t('privacyTitle')}</h3>
          </div>
        </div>

        <p style={{ fontSize: '13.5px', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 6px' }}>{t('privacyIntro')}</p>

        <div className="risk-tip">
          <div className="consent-tip-col">
            <div className="consent-tip-icon">
              <ProfileIcon name="chart" />
            </div>
            <span className="consent-tip-num">01</span>
          </div>
          <div>
            <strong>{t('privacy1Title')}</strong>
            <p>{t('privacy1Desc')}</p>
          </div>
        </div>

        <div className="risk-tip">
          <div className="consent-tip-col">
            <div className="consent-tip-icon">
              <ProfileIcon name="eye" />
            </div>
            <span className="consent-tip-num">02</span>
          </div>
          <div>
            <strong>{t('privacy2Title')}</strong>
            <p>{t('privacy2Desc')}</p>
          </div>
        </div>

        <div className="risk-tip">
          <div className="consent-tip-col">
            <div className="consent-tip-icon">
              <ProfileIcon name="lock" />
            </div>
            <span className="consent-tip-num">03</span>
          </div>
          <div>
            <strong>{t('privacy3Title')}</strong>
            <p>{t('privacy3Desc')}</p>
          </div>
        </div>

        <button className="btn btn-ball risk-modal-btn" onClick={onClose}>
          {t('aceptar')}
        </button>
        <p className="risk-modal-disclaimer">
          {t('privacyFootnote')}{' '}
          <a href="/privacidad" target="_blank" rel="noopener noreferrer">
            {t('politicaPrivacidad')}
          </a>
          .
        </p>
      </div>
    </div>
  );
}

// Modal de login — se abre desde el botón "Entrar" del header o
// cuando alguien intenta seguir un pick sin haber iniciado sesión.
// El sitio se navega libre sin cuenta (Inicio/Picks/Calendario); esto
// solo reemplaza el clic directo a Google por una pantalla intermedia
// con el branding de CAMILOREY, para que quede claro qué se está
// autorizando antes de saltar a la ventana de Google.
function LoginModal({ onClose, onLogin, lang }) {
  const t = useTranslate(lang);
  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal login-modal">
        <button className="modal-close login-modal-close" onClick={onClose}>
          ✕
        </button>
        <div className="login-modal-icon">🔒</div>
        <h3 className="login-modal-title">{t('loginTitle')}</h3>
        <p className="login-modal-sub">{t('loginSub')}</p>
        <button className="google-btn" onClick={onLogin}>
          <GoogleGIcon size={20} />
          {t('loginBtnGoogle')}
        </button>
        <div className="login-modal-note">
          <span>🛡️</span>
          {t('loginNote')}
        </div>
      </div>
    </div>
  );
}

function ProfileModal({
  user,
  profile,
  displayName,
  avatarEmoji,
  avatarUrl,
  isAdmin,
  isPremium,
  onClose,
  onLogout,
  themePref,
  onChangeTheme,
  oddsFormat,
  onChangeOddsFormat,
  lang,
  onChangeLang,
  onProfileUpdated
}) {
  const t = useTranslate(lang);
  const [notifStatus, setNotifStatus] = useState('unknown');
  const [nameInput, setNameInput] = useState(displayName || '');
  const [savingName, setSavingName] = useState(false);
  // "Tema" abre una sub-pantalla aparte (con flecha de regreso) en vez
  // de expandirse ahí mismo en la lista — mismo patrón que la
  // referencia, donde tocar la fila navega a otra vista.
  const [themeScreenOpen, setThemeScreenOpen] = useState(false);
  const THEME_LABEL = { oscuro: t('temaOscuro'), claro: t('temaClaro'), sistema: t('temaSistema') };
  const ODDS_LABEL = {
    decimal: t('oddsDecimal'),
    americano: t('oddsAmericano'),
    fraccional: t('oddsFraccional'),
    hongkong: t('oddsHongkong'),
    indonesio: t('oddsIndonesio')
  };
  const [oddsScreenOpen, setOddsScreenOpen] = useState(false);
  const [plansScreenOpen, setPlansScreenOpen] = useState(false);
  const [planCycle, setPlanCycle] = useState('anual');
  const [langScreenOpen, setLangScreenOpen] = useState(false);
  const [accountScreenOpen, setAccountScreenOpen] = useState(false);
  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [emailEditOpen, setEmailEditOpen] = useState(false);
  const [emailInput, setEmailInput] = useState(user.email || '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [deleteAccountScreenOpen, setDeleteAccountScreenOpen] = useState(false);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [helpScreenOpen, setHelpScreenOpen] = useState(false);
  const [openFaqCat, setOpenFaqCat] = useState(0);
  const [openFaqItem, setOpenFaqItem] = useState(null);
  const faqCategories = HELP_FAQ[lang] || HELP_FAQ.es;
  const ejemplo = lang === 'en' ? 'Example' : 'Ejemplo';
  const ODDS_FORMAT_OPTIONS = [
    ['decimal', `${ejemplo}: 2.23`],
    ['americano', `${ejemplo}: +123 / -100`],
    ['fraccional', `${ejemplo}: 5/4`],
    ['hongkong', `${ejemplo}: 1.23`],
    ['indonesio', `${ejemplo}: +1.23 / -1.23`]
  ];
  const LANG_OPTIONS = [
    ['es', t('idiomaEspanol')],
    ['en', t('idiomaIngles')],
    ['pt', t('idiomaPortugues')]
  ];

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof Notification !== 'undefined') {
      setNotifStatus(Notification.permission);
    }
  }, []);

  const handleActivateNotifs = async () => {
    const result = await ensurePushSubscription(user);
    if (result === 'ok') {
      setNotifStatus('granted');
      alert('Notificaciones activadas ✅');
    } else if (result === 'denied') {
      setNotifStatus('denied');
      alert('Tienes las notificaciones bloqueadas para este sitio. Actívalas desde la configuración del navegador.');
    } else if (result === 'ios-needs-install') {
      alert(
        'En iPhone/iPad, las notificaciones solo funcionan si agregas CAMILOREY a tu pantalla de inicio primero: toca Compartir (el cuadrito con la flecha) → "Agregar a pantalla de inicio", y abre la app desde ese ícono en vez de Safari.'
      );
    } else if (result === 'unsupported') {
      alert('Tu navegador no soporta notificaciones push.');
    } else {
      alert('No se pudo activar las notificaciones, intenta de nuevo.');
    }
  };

  const saveName = async () => {
    const trimmed = nameInput.trim().slice(0, 40);
    if (!trimmed || trimmed === displayName || !supabaseClient) return;
    setSavingName(true);
    const { error } = await supabaseClient.from('profiles').upsert({ id: user.id, display_name: trimmed });
    setSavingName(false);
    if (error) {
      alert('No se pudo guardar el nombre: ' + error.message);
      return;
    }
    onProfileUpdated({ display_name: trimmed });
    setNameEditOpen(false);
  };

  const saveEmail = async () => {
    const trimmed = emailInput.trim();
    if (!trimmed || trimmed === user.email || !supabaseClient) return;
    setSavingEmail(true);
    const { error } = await supabaseClient.auth.updateUser({ email: trimmed });
    setSavingEmail(false);
    if (error) {
      alert('No se pudo actualizar el correo: ' + error.message);
      return;
    }
    setEmailEditOpen(false);
    alert(
      lang === 'en'
        ? 'Check your new email inbox to confirm the change.'
        : 'Revisa la bandeja de tu correo nuevo para confirmar el cambio.'
    );
  };

  const handleDeleteAccount = async () => {
    if (!supabaseClient || deletingAccount) return;
    setDeletingAccount(true);
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const r = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || t('delErrorGenerico'));
      onClose();
      onLogout();
    } catch (e) {
      alert(e.message || t('delErrorGenerico'));
      setDeletingAccount(false);
    }
  };

  const memberSince = user.created_at
    ? new Intl.DateTimeFormat('es', { month: 'short', year: 'numeric' }).format(new Date(user.created_at))
    : null;
  const memberSinceFull = user.created_at
    ? new Intl.DateTimeFormat(lang === 'en' ? 'en' : lang === 'pt' ? 'pt' : 'es', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date(user.created_at))
    : null;
  const delConfirmWord = t('delPalabraConfirmacion');

  if (deleteAccountScreenOpen) {
    const DEL_ITEMS = [
      ['trash', 'delItem1Title', 'delItem1Desc'],
      ['bell', 'delItem2Title', 'delItem2Desc'],
      ['card', 'delItem3Title', 'delItem3Desc'],
      ['lock', 'delItem4Title', 'delItem4Desc']
    ];
    const canDelete = deleteConfirmChecked && deleteConfirmText.trim() === delConfirmWord;
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="risk-modal-banner">
            <div className="subscreen-head" style={{ marginBottom: '10px' }}>
              <button className="subscreen-back" onClick={() => setDeleteAccountScreenOpen(false)}>
                <ProfileIcon name="arrow-left" size={18} />
              </button>
            </div>
            <div className="risk-modal-banner-row">
              <div className="risk-modal-icon">
                <ProfileIcon name="alert" size={22} />
              </div>
              <div>
                <div className="risk-modal-eyebrow">{t('delEyebrow')}</div>
                <h3>{t('delTitle')}</h3>
              </div>
            </div>
            <p style={{ color: 'rgba(255,255,255,.85)', fontSize: '13.5px', lineHeight: 1.5, margin: '14px 0 0' }}>
              {t('delDesc')}
            </p>
          </div>

          <div className="profile-section-label" style={{ marginTop: 0 }}>
            {t('delQueSeElimina')}
          </div>
          <div className="del-item-list">
            {DEL_ITEMS.map(([icon, titleKey, descKey]) => (
              <div className="del-item" key={titleKey}>
                <span className="del-item-icon">
                  <ProfileIcon name={icon} size={18} />
                </span>
                <div>
                  <strong>{t(titleKey)}</strong>
                  <p>{t(descKey)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="profile-section-label">{t('delConfirmarEliminacion')}</div>
          <label className="del-checkbox-row">
            <input
              type="checkbox"
              checked={deleteConfirmChecked}
              onChange={(e) => setDeleteConfirmChecked(e.target.checked)}
            />
            <span>{t('delCheckboxLabel')}</span>
          </label>

          <div className="del-type-block">
            <label>{t('delEscribePara', { word: delConfirmWord })}</label>
            <input
              type="text"
              className="profile-name-input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={t('delPlaceholder', { word: delConfirmWord })}
            />
          </div>

          <button
            type="button"
            className="btn btn-danger risk-modal-btn"
            disabled={!canDelete || deletingAccount}
            onClick={handleDeleteAccount}
          >
            <ProfileIcon name="trash" size={16} />
            {deletingAccount ? t('delEliminando') : t('delBoton')}
          </button>
        </div>
      </div>
    );
  }

  if (accountScreenOpen) {
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="subscreen-head">
            <button className="subscreen-back" onClick={() => setAccountScreenOpen(false)}>
              <ProfileIcon name="arrow-left" size={18} />
            </button>
            <h3>{t('cuentaTitle')}</h3>
          </div>

          <div className="account-avatar-block">
            <div className="account-avatar-wrap">
              <UserAvatar
                emoji={avatarEmoji}
                url={avatarUrl}
                initials={(displayName || user.email || '?')[0].toUpperCase()}
              />
              <button
                type="button"
                className="account-avatar-camera"
                onClick={() => alert(t('cuentaFotoSoon'))}
                aria-label={t('cuentaCambiarFoto')}
              >
                <ProfileIcon name="camera" size={14} />
              </button>
            </div>
            <span>{t('cuentaCambiarFoto')}</span>
          </div>

          <div className="account-info-card">
            <div className="account-info-row">
              <span className="profile-row-icon">
                <ProfileIcon name="user" size={18} />
              </span>
              <div className="profile-row-body">
                <p style={{ margin: '0 0 2px' }}>{t('cuentaNombreCompleto')}</p>
                {nameEditOpen ? (
                  <div className="profile-edit-inline" style={{ marginTop: '6px' }}>
                    <input
                      type="text"
                      className="profile-name-input"
                      value={nameInput}
                      maxLength={40}
                      placeholder={t('tuNombre')}
                      onChange={(e) => setNameInput(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-ball"
                      disabled={savingName || !nameInput.trim() || nameInput.trim() === displayName}
                      onClick={saveName}
                    >
                      {savingName ? '...' : t('guardar')}
                    </button>
                  </div>
                ) : (
                  <strong>{displayName || '—'}</strong>
                )}
              </div>
              {!nameEditOpen && (
                <button type="button" className="account-edit-btn" onClick={() => setNameEditOpen(true)}>
                  {t('editar')}
                </button>
              )}
            </div>

            <div className="account-info-row">
              <span className="profile-row-icon">
                <ProfileIcon name="mail" size={18} />
              </span>
              <div className="profile-row-body">
                <p style={{ margin: '0 0 2px' }}>{t('cuentaEmail')}</p>
                {emailEditOpen ? (
                  <div className="profile-edit-inline" style={{ marginTop: '6px' }}>
                    <input
                      type="email"
                      className="profile-name-input"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-ball"
                      disabled={savingEmail || !emailInput.trim() || emailInput.trim() === user.email}
                      onClick={saveEmail}
                    >
                      {savingEmail ? '...' : t('guardar')}
                    </button>
                  </div>
                ) : (
                  <strong>{user.email}</strong>
                )}
              </div>
              {!emailEditOpen && (
                <button type="button" className="account-edit-btn" onClick={() => setEmailEditOpen(true)}>
                  {t('editar')}
                </button>
              )}
            </div>
            {emailEditOpen && <p className="plans-cta-note" style={{ margin: '0 0 10px' }}>{t('cuentaEmailEditNota')}</p>}

            <div className="account-info-row">
              <span className="profile-row-icon">
                <ProfileIcon name="moon" size={18} />
              </span>
              <div className="profile-row-body">
                <p style={{ margin: '0 0 2px' }}>{t('cuentaMiembroDesde')}</p>
                <strong>{memberSinceFull || '—'}</strong>
              </div>
            </div>

            <div className="account-info-row">
              <span className="profile-row-icon">
                <ProfileIcon name="shield" size={18} />
              </span>
              <div className="profile-row-body">
                <p style={{ margin: '0 0 2px' }}>{t('cuentaIdUsuario')}</p>
                <strong className="account-id-value">{user.id}</strong>
              </div>
            </div>
          </div>

          <div className="profile-section-label">{t('filaSuscripcion')}</div>
          <div
            className="profile-row"
            onClick={() => {
              if (!isAdmin && !isPremium) {
                setAccountScreenOpen(false);
                setPlansScreenOpen(true);
              } else if (isPremium) {
                alert(
                  lang === 'en'
                    ? 'Your premium plan is active. Write to us if you want to cancel or have questions about your subscription.'
                    : 'Tu plan premium está activo. Escribinos si querés cancelarlo o tenés dudas de tu suscripción.'
                );
              }
            }}
          >
            <span className="profile-row-icon">
              <ProfileIcon name="crown" size={18} />
            </span>
            <div className="profile-row-body">
              <strong>{isAdmin || isPremium ? t('perfilPlanPremium') : t('perfilPlanGratuito')}</strong>
              <p>{t('filaSuscripcionDesc')}</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </div>

          <button
            type="button"
            className="btn btn-ghost del-account-trigger-btn"
            onClick={() => setDeleteAccountScreenOpen(true)}
          >
            <ProfileIcon name="trash" size={16} />
            {t('cuentaEliminarBtn')}
          </button>
        </div>
      </div>
    );
  }

  if (plansScreenOpen) {
    const paymentUrl = process.env.NEXT_PUBLIC_PAYMENT_LINK;
    const PLAN_FEATURES = [
      'plansFeatRacha',
      'plansFeatPrecision',
      'plansFeatCuotas',
      'plansFeatEdge',
      'plansFeatHistorico',
      'plansFeatKelly',
      'plansFeatLocalVisitante',
      'plansFeatIA',
      'plansFeatH2H',
      'plansFeatAlertas'
    ];
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal plans-modal">
          <div className="plans-modal-banner">
            <div className="subscreen-head" style={{ marginBottom: '14px' }}>
              <button className="subscreen-back" onClick={() => setPlansScreenOpen(false)}>
                <ProfileIcon name="arrow-left" size={18} />
              </button>
              <h3 style={{ color: '#fff' }}>{t('plansTitle')}</h3>
            </div>
            <ul className="plans-bullet-list">
              <li>
                <ProfileIcon name="zap" size={14} />
                {t('plansBullet1')}
              </li>
              <li>
                <ProfileIcon name="zap" size={14} />
                {t('plansBullet2')}
              </li>
              <li>
                <ProfileIcon name="zap" size={14} />
                {t('plansBullet3')}
              </li>
            </ul>
          </div>

          <div className="plans-toggle">
            <button
              type="button"
              className={`plans-toggle-btn ${planCycle === 'mensual' ? 'active' : ''}`}
              onClick={() => setPlanCycle('mensual')}
            >
              {t('plansToggleMensual')}
            </button>
            <button
              type="button"
              className={`plans-toggle-btn ${planCycle === 'anual' ? 'active' : ''}`}
              onClick={() => setPlanCycle('anual')}
            >
              {t('plansToggleAnual')}
            </button>
          </div>

          <div className="plans-card">
            <span className="plans-card-badge">{t('plansCardBadge')}</span>
            <div className="plans-card-head">
              <span className="plans-card-icon">
                <ProfileIcon name="crown" size={20} />
              </span>
              <div>
                <strong>{t('plansCardName')}</strong>
                <span>{t('plansCardDesc')}</span>
              </div>
            </div>

            <div className="plans-price-block">
              {planCycle === 'anual' ? (
                <>
                  <div className="plans-price-row">
                    <span className="plans-price-big">US$100.00</span>
                    <span className="plans-price-period">/{t('plansPeriodAnual')}</span>
                  </div>
                  <div className="plans-price-savings">
                    <span className="plans-price-original">US$200.00</span>
                    {t('plansSavingsAnual')}
                  </div>
                </>
              ) : (
                <div className="plans-price-row">
                  <span className="plans-price-big">US$25.00</span>
                  <span className="plans-price-period">/{t('plansPeriodMensual')}</span>
                </div>
              )}
              <div className="plans-price-cancel">{t('plansCancelaCuandoQuieras')}</div>
            </div>

            <div className="plans-feature-list">
              {PLAN_FEATURES.map((key) => (
                <div className="plans-feature-row" key={key}>
                  <span>{t(key)}</span>
                  <ProfileIcon name="check" size={14} />
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ball plans-cta-btn"
            onClick={() => {
              if (paymentUrl) {
                window.open(paymentUrl, '_blank', 'noopener,noreferrer');
              } else {
                alert(t('plansSoon'));
              }
            }}
          >
            {t('plansCta')}
          </button>
          <p className="plans-cta-note">{t('plansCtaNote')}</p>
        </div>
      </div>
    );
  }

  if (oddsScreenOpen) {
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="subscreen-head">
            <button className="subscreen-back" onClick={() => setOddsScreenOpen(false)}>
              <ProfileIcon name="arrow-left" size={18} />
            </button>
            <h3>{t('filaCuotas')}</h3>
          </div>

          <div className="profile-row profile-row-theme" style={{ border: 'none', padding: '4px 0 0' }}>
            <span className="profile-row-icon">
              <ProfileIcon name="dollar" />
            </span>
            <div className="profile-row-body">
              <strong>{t('filaCuotas')}</strong>
              <p>
                {lang === 'en'
                  ? 'How odds are shown across the site (always stored as decimal internally).'
                  : 'Cómo se muestran las cuotas en todo el sitio (siempre se guardan en decimal por dentro).'}
              </p>
            </div>
          </div>

          <div className="theme-option-list">
            {ODDS_FORMAT_OPTIONS.map(([key, example]) => (
              <div
                key={key}
                className={`theme-option ${oddsFormat === key ? 'active' : ''}`}
                onClick={() => onChangeOddsFormat(key)}
              >
                <div className="theme-option-body">
                  <strong>{ODDS_LABEL[key]}</strong>
                  <span>{example}</span>
                </div>
                <span className="theme-option-radio">
                  {oddsFormat === key ? <ProfileIcon name="check" size={12} /> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (langScreenOpen) {
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="subscreen-head">
            <button className="subscreen-back" onClick={() => setLangScreenOpen(false)}>
              <ProfileIcon name="arrow-left" size={18} />
            </button>
            <h3>{t('filaIdioma')}</h3>
          </div>

          <div className="profile-row profile-row-theme" style={{ border: 'none', padding: '4px 0 0' }}>
            <span className="profile-row-icon">
              <ProfileIcon name="globe" />
            </span>
            <div className="profile-row-body">
              <strong>{t('filaIdioma')}</strong>
              <p>{lang === 'en' ? 'Choose the language for CAMILOREY.' : 'Elige el idioma de CAMILOREY.'}</p>
            </div>
          </div>

          <div className="theme-option-list">
            {LANG_OPTIONS.map(([key, label]) => (
              <div key={key} className={`theme-option ${lang === key ? 'active' : ''}`} onClick={() => onChangeLang(key)}>
                <div className="theme-option-body">
                  <strong>{label}</strong>
                </div>
                <span className="theme-option-radio">{lang === key ? <ProfileIcon name="check" size={12} /> : null}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (helpScreenOpen) {
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="subscreen-head">
            <button
              className="subscreen-back"
              onClick={() => {
                setHelpScreenOpen(false);
                setOpenFaqItem(null);
              }}
            >
              <ProfileIcon name="arrow-left" size={18} />
            </button>
            <h3>{t('ayudaFaqTitle')}</h3>
          </div>

          <div className="profile-row profile-row-theme" style={{ border: 'none', padding: '4px 0 0' }}>
            <span className="profile-row-icon">
              <ProfileIcon name="help" />
            </span>
            <div className="profile-row-body">
              <strong>{t('ayudaFaqTitle')}</strong>
              <p>{t('ayudaFaqDesc')}</p>
            </div>
          </div>

          <a className="profile-row" href={`mailto:${process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'cash3y3@gmail.com'}`}>
            <span className="profile-row-icon">
              <ProfileIcon name="mail" />
            </span>
            <div className="profile-row-body">
              <strong>{t('soporteEmail')}</strong>
              <p>
                {process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'cash3y3@gmail.com'} · {t('respuesta24h')}
              </p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>

          <div className="profile-section-label">{t('preguntasFrecuentes')}</div>

          <div className="faq-list">
            {faqCategories.map((cat, ci) => (
              <div key={cat.title} className="faq-category">
                <div
                  className="faq-category-head"
                  onClick={() => {
                    setOpenFaqCat(openFaqCat === ci ? null : ci);
                    setOpenFaqItem(null);
                  }}
                >
                  <span className="faq-category-icon">
                    <ProfileIcon name={cat.icon} size={17} />
                  </span>
                  <strong className="faq-category-title">{cat.title}</strong>
                  <span className="faq-category-count">{cat.items.length}</span>
                  <span className={`faq-chevron ${openFaqCat === ci ? 'open' : ''}`}>
                    <ProfileIcon name="chevron-down" size={16} />
                  </span>
                </div>

                {openFaqCat === ci ? (
                  <div className="faq-items">
                    {cat.items.map((item, qi) => {
                      const key = `${ci}-${qi}`;
                      const isOpen = openFaqItem === key;
                      return (
                        <div key={key} className="faq-item">
                          <div className="faq-item-q" onClick={() => setOpenFaqItem(isOpen ? null : key)}>
                            <span>{item.q}</span>
                            <span className={`faq-chevron ${isOpen ? 'open' : ''}`}>
                              <ProfileIcon name="chevron-down" size={14} />
                            </span>
                          </div>
                          {isOpen ? <p className="faq-item-a">{item.a}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (themeScreenOpen) {
    return (
      <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
        <div className="modal">
          <div className="subscreen-head">
            <button className="subscreen-back" onClick={() => setThemeScreenOpen(false)}>
              <ProfileIcon name="arrow-left" size={18} />
            </button>
            <h3>{t('filaTema')}</h3>
          </div>

          <div className="profile-row profile-row-theme" style={{ border: 'none', padding: '4px 0 0' }}>
            <span className="profile-row-icon">
              <ProfileIcon name="moon" />
            </span>
            <div className="profile-row-body">
              <strong>{t('filaTema')}</strong>
              <p>{t('filaTemaDesc')}</p>
            </div>
          </div>

          <div className="theme-option-list">
            {[
              ['oscuro', 'moon', t('temaOscuro'), t('temaOscuroDesc')],
              ['claro', 'sun', t('temaClaro'), t('temaClaroDesc')],
              ['sistema', 'monitor', t('temaSistema'), t('temaSistemaDesc')]
            ].map(([key, icon, title, sub]) => (
              <div
                key={key}
                className={`theme-option ${themePref === key ? 'active' : ''}`}
                onClick={() => onChangeTheme(key)}
              >
                <span className="theme-option-icon">
                  <ProfileIcon name={icon} size={17} />
                </span>
                <div className="theme-option-body">
                  <strong>{title}</strong>
                  <span>{sub}</span>
                </div>
                <span className="theme-option-radio">
                  {themePref === key ? <ProfileIcon name="check" size={12} /> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="theme-preview-row">
            <div className="theme-preview-card theme-preview-light">
              <div className="theme-preview-head">
                <span className="theme-preview-dot"></span>
                <span className="theme-preview-line"></span>
              </div>
              <div className="theme-preview-block"></div>
              <span className="theme-preview-label">{t('temaClaro')}</span>
            </div>
            <div className="theme-preview-card theme-preview-dark">
              <div className="theme-preview-head">
                <span className="theme-preview-dot"></span>
                <span className="theme-preview-line"></span>
              </div>
              <div className="theme-preview-block"></div>
              <span className="theme-preview-label">{t('temaOscuro')}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div
            className="profile-head-clickable"
            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
            onClick={() => setAccountScreenOpen(true)}
          >
            <div className="featured-avatar">
              <UserAvatar
                emoji={avatarEmoji}
                url={avatarUrl}
                initials={(displayName || user.email || '?')[0].toUpperCase()}
              />
            </div>
            <div>
              <h3 style={{ fontSize: '18px' }}>{displayName || user.email}</h3>
              <div className="sub">{user.email}</div>
              <div className="profile-plan-line">
                {isAdmin || isPremium ? t('perfilPlanPremium') : t('perfilPlanGratuito')}
                {memberSince ? ` · ${t('perfilMiembroDesde')} ${memberSince}` : ''}
              </div>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {!isAdmin && !isPremium ? (
          <button type="button" className="upgrade-card" onClick={() => setPlansScreenOpen(true)}>
            <span className="upgrade-card-icon">
              <ProfileIcon name="crown" />
            </span>
            <span className="upgrade-card-body">
              <strong>{t('mejoraTuPlan')}</strong>
              <span>{t('mejoraTuPlanDesc')}</span>
            </span>
            <span className="upgrade-card-cta">{t('verPlanes')}</span>
          </button>
        ) : null}

        <div className="profile-section-label">{t('ajustes')}</div>

        <div className="profile-row" onClick={handleActivateNotifs}>
          <span className="profile-row-icon">
            <ProfileIcon name="bell" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaNotificaciones')}</strong>
            <p>
              {notifStatus === 'granted'
                ? t('notifActivadas')
                : notifStatus === 'denied'
                ? t('notifBloqueadas')
                : t('notifToca')}
            </p>
          </div>
          <span className={`status ${notifStatus === 'granted' ? 'live' : 'soon'}`}>
            {notifStatus === 'granted' ? t('statusActivas') : t('statusActivar')}
          </span>
        </div>

        <div
          className="profile-row"
          onClick={() => {
            if (!isAdmin && !isPremium) {
              setPlansScreenOpen(true);
            } else if (isPremium) {
              alert(
                lang === 'en'
                  ? 'Your premium plan is active. Write to us if you want to cancel or have questions about your subscription.'
                  : 'Tu plan premium está activo. Escribinos si querés cancelarlo o tenés dudas de tu suscripción.'
              );
            } else {
              alert(
                lang === 'en'
                  ? "Subscription — no plans to manage yet, you'll be able to see them here very soon."
                  : 'Suscripción — todavía no hay planes para administrar, muy pronto vas a poder verlos aquí.'
              );
            }
          }}
        >
          <span className="profile-row-icon">
            <ProfileIcon name="card" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaSuscripcion')}</strong>
            <p>{t('filaSuscripcionDesc')}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </div>

        <div className="profile-row" onClick={() => setOddsScreenOpen(true)}>
          <span className="profile-row-icon">
            <ProfileIcon name="dollar" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaCuotas')}</strong>
            <p>{ODDS_LABEL[oddsFormat] || ODDS_LABEL.decimal}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </div>

        <div className="profile-row" onClick={() => setThemeScreenOpen(true)}>
          <span className="profile-row-icon">
            <ProfileIcon name="moon" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaTema')}</strong>
            <p>{THEME_LABEL[themePref] || THEME_LABEL.sistema}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </div>

        <div className="profile-row" onClick={() => setLangScreenOpen(true)}>
          <span className="profile-row-icon">
            <ProfileIcon name="globe" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaIdioma')}</strong>
            <p>{lang === 'en' ? t('idiomaIngles') : t('idiomaEspanol')}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </div>

        <a className="profile-row" href="/privacidad" target="_blank" rel="noopener noreferrer">
          <span className="profile-row-icon">
            <ProfileIcon name="shield" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaPrivacidad')}</strong>
            <p>{t('filaPrivacidadDesc')}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </a>

        <a className="profile-row" href="/terminos" target="_blank" rel="noopener noreferrer">
          <span className="profile-row-icon">
            <ProfileIcon name="file" />
          </span>
          <div className="profile-row-body">
            <strong>{t('terminosCondiciones')}</strong>
            <p>{t('filaTerminosDesc')}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </a>

        <div className="profile-row" onClick={() => setHelpScreenOpen(true)}>
          <span className="profile-row-icon">
            <ProfileIcon name="help" />
          </span>
          <div className="profile-row-body">
            <strong>{t('filaAyuda')}</strong>
            <p>{t('filaAyudaDesc')}</p>
          </div>
          <ProfileIcon name="chevron-right" size={16} />
        </div>

        <button
          className="btn btn-ghost risk-modal-btn"
          style={{ marginTop: '18px' }}
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          {t('cerrarSesion')}
        </button>
      </div>
    </div>
  );
}

// Sonido corto al seguir un pick — se sintetiza con Web Audio API en
// vez de cargar un archivo de audio, así no hace falta ningún asset
// nuevo. Un "ding" breve de dos tonos ascendentes.
function playFollowSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(990, now + 0.08);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
    osc.onended = () => ctx.close();
  } catch (e) {
    // silencioso — si el navegador bloquea audio, simplemente no suena
  }
}

// Vibración cortita al seguir un pick — solo existe en Chrome/Android
// (navigator.vibrate), Safari/iOS y desktop no la tienen, por eso el
// chequeo antes de llamarla.
function vibrateFollow() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
}

// Kelly: fracción óptima del banco a arriesgar dado el edge real
// (confianza como probabilidad, cuota real de Rushbet) — f* = (b·p - q) / b,
// b = cuota-1, p = confianza/100, q = 1-p. Si f* <= 0 el modelo no ve
// ventaja real (la cuota no compensa el riesgo) y Kelly dice no
// apostar. multiplier ajusta qué tan agresivo se aplica ese f* puro —
// 1/4, 1/2 o completo, según el nivel de riesgo elegido.
function kellyFraction(confidence, odds, multiplier = 0.5) {
  if (!odds || odds <= 1) return 0;
  const p = confidence / 100;
  const q = 1 - p;
  const b = odds - 1;
  const f = (b * p - q) / b;
  return Math.max(0, f * multiplier);
}

const RISK_LEVELS = {
  seguro: { label: 'Seguro', sub: '1/4 Kelly', multiplier: 0.25 },
  equilibrado: { label: 'Equilibrado', sub: '1/2 Kelly', multiplier: 0.5 },
  agresivo: { label: 'Agresivo', sub: 'Kelly completo', multiplier: 1 }
};

// Mi Bankroll queda abierto para TODOS (no solo admin) por 7 días
// desde que se activó esta prueba gratuita — pasada esta fecha,
// vuelve a quedar detrás del candado premium para quien no sea admin.
const MIBANKROLL_TRIAL_END = new Date('2026-07-20T23:59:59-05:00').getTime();

// Prueba cerrada del sitio completo: hasta esta fecha, solo entran el
// admin y quien esté en la tabla "beta_access" (Supabase). Pasada esta
// fecha, entra ÚNICAMENTE el admin — nadie más, ni siquiera la gente
// que sí estaba en la lista — hasta que se suba una fecha nueva acá a
// mano para reabrir la prueba o lanzar el sitio de verdad.
const BETA_GATE_END = new Date('2026-07-14T20:25:00-05:00').getTime();

export default function Home({
  stats: initialStats,
  picks: initialPicks,
  resolvedPicks: initialResolvedPicks,
  tournamentGroups: initialTournamentGroups,
  matches: initialMatches,
  currentDateStr,
  userCount
}) {
  const [view, setView] = useState('inicio');
  const [pickTab, setPickTab] = useState('todos');
  const [stats, setStats] = useState(initialStats);
  const [picks, setPicks] = useState(initialPicks);
  const [resolvedPicks, setResolvedPicks] = useState(initialResolvedPicks);
  const [tournamentGroups, setTournamentGroups] = useState(initialTournamentGroups);
  const [matches, setMatches] = useState(initialMatches);
  // bankrollLog/bankrollSeries (apuesta por apuesta) ya no llegan por
  // props ni por el poller público — se piden aparte a
  // /api/bankroll-log con el login verificado, ver el useEffect más
  // abajo (mismo patrón que modelStats/errorLog).
  const [bankrollLog, setBankrollLog] = useState([]);
  const [bankrollSeries, setBankrollSeries] = useState([]);
  const [matchFilter, setMatchFilter] = useState('todos');
  const [modalPick, setModalPick] = useState(null);
  const [modalMatch, setModalMatch] = useState(null);
  const [user, setUser] = useState(null);

  // Perfil editable (nombre/emoji/foto propia) — Google solo da el
  // nombre/foto de cuando iniciaste sesión, esto es lo que la persona
  // eligió cambiar después, si lo hizo. Se guarda aparte en la tabla
  // "profiles" (no se puede tocar auth.users directo).
  const [myProfile, setMyProfile] = useState(null);
  useEffect(() => {
    if (!user || !supabaseClient) {
      setMyProfile(null);
      return undefined;
    }
    let cancelled = false;
    supabaseClient
      .from('profiles')
      .select('display_name, avatar_emoji, custom_avatar_url, premium_until')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('Error cargando perfil:', error);
        if (!cancelled) setMyProfile(data || {});
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const myDisplayName =
    myProfile?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || null;
  const myAvatarEmoji = myProfile?.avatar_emoji || null;
  const myAvatarUrl = myProfile?.custom_avatar_url || user?.user_metadata?.avatar_url || null;

  const [followedPickIds, setFollowedPickIds] = useState(new Set());
  const [followedDetail, setFollowedDetail] = useState([]);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [riskTips, setRiskTips] = useState([]);
  const prevFollowedCountRef = useRef(0);
  const [bankrollTab, setBankrollTab] = useState('slip');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Aviso de privacidad — una vez por navegador, la primera vez que
  // alguien inicia sesión (no antes, porque sin cuenta no guardamos
  // nada suyo todavía).
  const [showPrivacyConsent, setShowPrivacyConsent] = useState(false);
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    if (!window.localStorage.getItem('camilorey_privacy_seen')) setShowPrivacyConsent(true);
  }, [user]);
  const dismissPrivacyConsent = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem('camilorey_privacy_seen', '1');
    setShowPrivacyConsent(false);
  };

  // Mini-onboarding — una vez por navegador en la PRIMERA visita, con
  // o sin sesión (a diferencia del aviso de privacidad de arriba, que
  // espera al login).
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.localStorage.getItem('camilorey_onboarding_seen')) setShowOnboarding(true);
  }, []);
  const dismissOnboarding = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem('camilorey_onboarding_seen', '1');
    setShowOnboarding(false);
  };

  // Formato de cuotas — solo cambia cómo se MUESTRAN (siempre se
  // guardan en decimal), preferencia por navegador.
  const [oddsFormat, setOddsFormat] = useState('decimal');
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('camilorey_odds_format') : null;
    if (saved) setOddsFormat(saved);
  }, []);
  const changeOddsFormat = (fmt) => {
    setOddsFormat(fmt);
    if (typeof window !== 'undefined') window.localStorage.setItem('camilorey_odds_format', fmt);
  };

  // Idioma — el servidor siempre renderiza en español (SSR no sabe la
  // preferencia todavía); apenas monta el cliente, si hay un idioma
  // guardado distinto, se cambia. Puede pasar un salto visible de
  // es→en en la primera carga si alguien ya eligió inglés antes —
  // aceptable por ahora, igual que pasó con el tema antes de tener el
  // script anti-parpadeo.
  const [lang, setLang] = useState('es');
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(LANG_KEY) : null;
    if (saved) setLang(saved);
  }, []);
  const changeLang = (l) => {
    setLang(l);
    if (typeof window !== 'undefined') window.localStorage.setItem(LANG_KEY, l);
  };
  const t = useTranslate(lang);

  // Banco de PLANEACIÓN (para el Slip Kelly) — separado del balance
  // real de "Rendimiento". Arranca igual al balance real, pero es
  // editable a mano para simular con otro monto. Se guarda en el
  // navegador (localStorage), no en la base de datos — es solo una
  // herramienta de planeación personal, no cambia el bankroll real.
  const [bankPlan, setBankPlan] = useState(initialStats.unidades);
  const [riskLevel, setRiskLevel] = useState('equilibrado');
  const [slipMode, setSlipMode] = useState('individual');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('camilorey_bankplan') : null;
    if (saved != null && !Number.isNaN(Number(saved))) setBankPlan(Number(saved));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('camilorey_bankplan', String(bankPlan));
  }, [bankPlan]);

  // "Mi Bankroll" — simulador personal para cualquier usuario (no
  // solo admin). No hay una bitácora nueva: el balance/evolución se
  // recalcula cada vez a partir de followedDetail (los picks que la
  // persona sigue, ya resueltos o no) con la misma fórmula de Kelly
  // del Bankroll del admin. Lo único que se guarda de verdad es el
  // banco inicial y el nivel de riesgo, por cuenta (no por navegador,
  // a diferencia del bankPlan del admin de arriba).
  const [myBankPlan, setMyBankPlan] = useState(2000000);
  const [myRiskLevel, setMyRiskLevel] = useState('equilibrado');
  const [myBankLoaded, setMyBankLoaded] = useState(false);

  useEffect(() => {
    if (!user || !supabaseClient) {
      setMyBankLoaded(false);
      return;
    }
    let cancelled = false;
    supabaseClient
      .from('user_bankroll_settings')
      .select('starting_bank, risk_level')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('Error cargando Mi Bankroll:', error);
        if (data) {
          setMyBankPlan(Number(data.starting_bank));
          setMyRiskLevel(data.risk_level);
        }
        setMyBankLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const saveMyBankSettings = async (patch) => {
    if (!user || !supabaseClient) return;
    const { error } = await supabaseClient
      .from('user_bankroll_settings')
      .upsert({ user_id: user.id, starting_bank: myBankPlan, risk_level: myRiskLevel, ...patch, updated_at: new Date() });
    if (error) console.error('Error guardando Mi Bankroll:', error);
  };

  // Tema: oscuro / claro / sistema (según el SO). "sistema" es el
  // default para quien nunca lo tocó. Se aplica al <html> vía atributo
  // (ver applyTheme) para que todo el CSS existente, que ya usa
  // variables como --bg/--ink, cambie de color sin tocar componentes.
  const [themePref, setThemePref] = useState('sistema');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
    const pref = saved || 'sistema';
    setThemePref(pref);
    applyTheme(pref);
  }, []);

  useEffect(() => {
    if (themePref !== 'sistema' || typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('sistema');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  const changeTheme = (pref) => {
    setThemePref(pref);
    if (typeof window !== 'undefined') window.localStorage.setItem(THEME_KEY, pref);
    applyTheme(pref);
  };

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      setView(VIEWS.includes(h) ? h : 'inicio');
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // Analítica: un evento "view" cada vez que alguien cambia de
  // sección — es lo mínimo para saber qué se usa de verdad.
  useEffect(() => {
    track('view', { view });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Calendario no se actualizaba solo — había que recargar la página
  // para que un partido pasara de "Próximo" a "En vivo". Mientras esa
  // vista esté abierta, se vuelve a consultar el estado del día cada
  // 20s (estilo Sofascore/Flashscore), sin recargar nada más. También
  // corre en Inicio ahora, porque "En vivo ahora" se mudó ahí.
  useEffect(() => {
    if (view !== 'calendario' && view !== 'inicio') return undefined;
    let cancelled = false;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const params = currentDateStr ? `?date=${currentDateStr}` : '';
        const r = await fetch(`/api/matches-status${params}`);
        const data = await r.json();
        if (!cancelled && data.matches) setMatches(data.matches);
      } catch (e) {
        console.error('Error actualizando Calendario:', e);
      }
    }

    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, currentDateStr]);

  // Mismo problema en Inicio (pick destacado + tablas de torneos en
  // vivo), Picks (pendientes/ganados/perdidos) y Bankroll (log +
  // gráfico de evolución, solo admin): sin esto, un pick que arranca,
  // se resuelve, o una apuesta que se paga, se quedaba congelado hasta
  // refrescar. Se repite cada 20s mientras cualquiera de esas vistas
  // esté abierta.
  useEffect(() => {
    if (view !== 'inicio' && view !== 'picks' && view !== 'bankroll') return undefined;
    let cancelled = false;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await fetch('/api/refresh-data');
        const data = await r.json();
        if (cancelled) return;
        if (data.stats) setStats(data.stats);
        if (data.picks) setPicks(data.picks);
        if (data.resolvedPicks) setResolvedPicks(data.resolvedPicks);
        if (data.tournamentGroups) setTournamentGroups(data.tournamentGroups);
      } catch (e) {
        console.error('Error actualizando Inicio/Picks/Bankroll:', e);
      }

      // El detalle de bankroll (apuesta por apuesta) sale de un
      // endpoint aparte con login verificado — solo se pide mientras
      // la pestaña Bankroll (admin) está abierta.
      if (view === 'bankroll' && isAdmin && supabaseClient) {
        try {
          const { data: sessionData } = await supabaseClient.auth.getSession();
          const accessToken = sessionData?.session?.access_token;
          const r2 = await fetch('/api/bankroll-log', { headers: { Authorization: `Bearer ${accessToken}` } });
          const data2 = await r2.json();
          if (cancelled) return;
          if (data2.bankrollLog) setBankrollLog(data2.bankrollLog);
          if (data2.bankrollSeries) setBankrollSeries(data2.bankrollSeries);
        } catch (e) {
          console.error('Error actualizando el log de Bankroll:', e);
        }
      }
    }

    // El bankroll detallado ya no llega con la carga inicial de la
    // página (ver arriba por qué) — sin este llamado inmediato, la
    // tabla se vería vacía hasta el primer tick del poller (20s).
    load();
    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view]);

  // Marcador en vivo, centralizado — antes cada PickCard/MatchRow en
  // pantalla pedía su propio marcador cada 8s (useLiveScore, ya
  // eliminado), así que con varios partidos en vivo a la vez (y como
  // TODAS las secciones están montadas siempre, aunque solo una se
  // vea) se disparaban pedidos duplicados al mismo partido una y otra
  // vez. Ahora se arma UNA sola lista de partidos en vivo (sin
  // repetir, por sourceId) a partir de matches/picks/followedDetail,
  // y se pide el marcador de cada uno una sola vez por ciclo de 8s.
  const liveMatchItems = useMemo(() => {
    const map = new Map();
    const consider = (sourceId, playerA, playerB, tournamentId, status) => {
      if (status === 'live' && sourceId && !map.has(sourceId)) {
        map.set(sourceId, { sourceId, playerA, playerB, tournamentId });
      }
    };
    for (const m of matches) consider(m.sourceId, m.playerA, m.playerB, m.tournamentId, m.status);
    for (const p of picks) consider(p.sourceId, p.player, p.opponent, p.tournamentId, p.matchStatus);
    for (const p of followedDetail) consider(p.sourceId, p.player, p.opponent, p.tournamentId, p.matchStatus);
    return map;
  }, [matches, picks, followedDetail]);
  const liveKeysSignature = [...liveMatchItems.keys()].sort().join(',');

  const [liveScores, setLiveScores] = useState({});
  useEffect(() => {
    if (liveMatchItems.size === 0) {
      setLiveScores({});
      return undefined;
    }
    let cancelled = false;

    async function poll() {
      if (document.visibilityState === 'hidden') return;
      const results = await Promise.all(
        [...liveMatchItems.values()].map(async (info) => {
          try {
            const params = new URLSearchParams();
            if (info.playerA) params.set('playerA', info.playerA);
            if (info.playerB) params.set('playerB', info.playerB);
            if (info.tournamentId) params.set('tournamentId', info.tournamentId);
            params.set('matchId', info.sourceId);
            const res = await fetch(`/api/live-match?${params.toString()}`);
            if (!res.ok) return [info.sourceId, null];
            const data = await res.json();
            return [info.sourceId, data];
          } catch (e) {
            return [info.sourceId, null];
          }
        })
      );
      if (cancelled) return;
      setLiveScores((prev) => {
        const next = { ...prev };
        for (const [key, data] of results) {
          if (data) next[key] = data;
        }
        return next;
      });
    }

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKeysSignature]);

  useEffect(() => {
    if (!supabaseClient) return undefined;
    supabaseClient.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Contador de "activos ahora" — cualquiera que tenga el sitio
  // abierto (con o sin sesión) se une a este canal de Supabase
  // Realtime Presence (mismo sistema que ya usa el chat en vivo, no
  // hace falta tabla nueva), y cada pestaña se cuenta como una
  // presencia. Solo el admin ve el número en la interfaz (más abajo).
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    if (!supabaseClient) return undefined;
    const sessionKey =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const channel = supabaseClient.channel('camilorey-online', { config: { presence: { key: sessionKey } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        setActiveCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, []);

  const loginWithGoogle = () => {
    if (!supabaseClient) return;
    supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };
  const logout = () => supabaseClient?.auth.signOut();

  useEffect(() => {
    if (!supabaseClient || !user) {
      setFollowedPickIds(new Set());
      return undefined;
    }
    let cancelled = false;
    supabaseClient
      .from('followed_picks')
      .select('pick_id')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) console.error('Error cargando seguidos:', error);
        if (!cancelled && data) setFollowedPickIds(new Set(data.map((r) => r.pick_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Se dispara solo al CRUZAR el umbral de 3 hacia arriba (de 3 o
  // menos a 4+) — antes se repetía cada vez que se seguía un pick más
  // estando ya arriba de 3, lo que se sentía como que "salían nuevos"
  // todo el tiempo. Si bajas a 3 o menos (dejas de seguir algo) y
  // vuelves a subir, sí se vuelve a mostrar — es una alerta nueva,
  // no la misma repetida.
  useEffect(() => {
    const count = followedPickIds.size;
    if (count > 3 && prevFollowedCountRef.current <= 3) {
      setRiskTips(pickRandomTips());
      setShowRiskModal(true);
    }
    prevFollowedCountRef.current = count;
  }, [followedPickIds]);

  // Detalle completo de los picks seguidos — aparte del array "picks"
  // de la SSR, que oculta un pick apenas el partido está por arrancar
  // o ya arrancó (regla pensada para "Picks", no para lo que alguien
  // sigue a propósito para recibir la notificación). Se repite cada
  // 15s mientras haya algo seguido, para que el estado (soon → live →
  // done) se refleje solo, sin tener que recargar la página.
  useEffect(() => {
    if (followedPickIds.size === 0) {
      setFollowedDetail([]);
      return undefined;
    }
    let cancelled = false;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await fetch(`/api/followed-detail?ids=${[...followedPickIds].join(',')}`);
        const data = await r.json();
        if (!cancelled) setFollowedDetail(data.picks || []);
      } catch (e) {
        console.error('Error cargando detalle de seguidos:', e);
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [followedPickIds]);

  const toggleFollow = async (pick) => {
    if (!supabaseClient) return;
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    const already = followedPickIds.has(pick.id);
    if (already) {
      const { error } = await supabaseClient.from('followed_picks').delete().eq('user_id', user.id).eq('pick_id', pick.id);
      if (error) {
        console.error('Error dejando de seguir:', error);
        alert('No se pudo dejar de seguir: ' + error.message);
        return;
      }
      setFollowedPickIds((prev) => {
        const next = new Set(prev);
        next.delete(pick.id);
        return next;
      });
      track('unfollow_pick');
    } else {
      const { error } = await supabaseClient
        .from('followed_picks')
        .insert({ user_id: user.id, pick_id: pick.id, match_id: pick.matchId });
      if (error) {
        console.error('Error siguiendo pick:', error);
        alert('No se pudo seguir el pick: ' + error.message);
        return;
      }
      setFollowedPickIds((prev) => new Set(prev).add(pick.id));
      playFollowSound();
      vibrateFollow();
      ensurePushSubscription(user);
      track('follow_pick');
    }
  };

  const isAdmin = Boolean(user?.email && user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL);

  // Premium se activa a mano (el pago pasa por fuera, link de
  // TipsterPage) — el admin lo marca desde el panel Admin escribiendo
  // el correo de quien pagó. premium_until vencida o null = gratuito.
  const isPremium = Boolean(myProfile?.premium_until && new Date(myProfile.premium_until) > new Date());

  // Prueba cerrada: mientras estemos antes de BETA_GATE_END, cualquier
  // correo de la tabla beta_access entra también, no solo el admin.
  // Pasada esa fecha, betaAllowed solo puede ser true si isAdmin.
  const [betaChecked, setBetaChecked] = useState(false);
  const [betaAllowed, setBetaAllowed] = useState(false);
  useEffect(() => {
    if (isAdmin) {
      setBetaAllowed(true);
      setBetaChecked(true);
      return undefined;
    }
    if (!user || !supabaseClient || Date.now() >= BETA_GATE_END) {
      setBetaAllowed(false);
      setBetaChecked(true);
      return undefined;
    }
    let cancelled = false;
    supabaseClient
      .from('beta_access')
      .select('email')
      .eq('email', user.email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setBetaAllowed(Boolean(data));
        setBetaChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin]);

  const featured = picks.find((p) => p.featured) || picks[0] || null;

  // Estadísticas del modelo (¿la confianza que calculamos de verdad
  // predice mejor que una moneda al aire?) — solo se consulta cuando
  // el admin entra a esa pestaña, no en cada carga de página.
  const [modelStats, setModelStats] = useState(null);
  const [modelStatsError, setModelStatsError] = useState(null);
  useEffect(() => {
    if (view !== 'modelo' || !isAdmin || !supabaseClient) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      try {
        const r = await fetch('/api/model-stats', { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) setModelStatsError(data.error || 'Error cargando estadísticas del modelo.');
        else setModelStats(data);
      } catch (e) {
        if (!cancelled) setModelStatsError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, isAdmin]);

  // Errores de la app (getServerSideProps, rutas API) — mismo patrón
  // que Modelo: solo se consulta al entrar a esa pestaña.
  const [errorLog, setErrorLog] = useState(null);
  const [errorLogError, setErrorLogError] = useState(null);
  useEffect(() => {
    if (view !== 'errores' || !isAdmin || !supabaseClient) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      try {
        const r = await fetch('/api/error-log', { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) setErrorLogError(data.error || 'Error cargando el registro de errores.');
        else setErrorLog(data.errors);
      } catch (e) {
        if (!cancelled) setErrorLogError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, isAdmin]);

  // Analítica propia (qué vistas y acciones se usan de verdad) —
  // mismo patrón que Modelo/Errores: solo se consulta al entrar a esa
  // pestaña.
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(null);
  useEffect(() => {
    if (view !== 'actividad' || !isAdmin || !supabaseClient) return undefined;
    let cancelled = false;
    (async () => {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      try {
        const r = await fetch('/api/analytics-summary', { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) setAnalyticsError(data.error || 'Error cargando la actividad.');
        else setAnalyticsSummary(data);
      } catch (e) {
        if (!cancelled) setAnalyticsError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, isAdmin]);

  // track(): registra un evento propio (sin IP, sin cookies de
  // rastreo, sin terceros) — se dispara y se olvida, nunca bloquea ni
  // rompe la interfaz si falla (por eso el catch vacío).
  const track = (eventName, meta = {}) => {
    if (!supabaseClient) return;
    supabaseClient
      .from('analytics_events')
      .insert({ event_name: eventName, view: meta.view || null, user_id: user?.id || null })
      .then(() => {})
      .catch(() => {});
  };

  // Activar/quitar premium a mano — el pago pasa por fuera del sitio
  // (link de TipsterPage), esto es lo que hace el admin cuando le
  // avisan que alguien pagó.
  const [premiumEmail, setPremiumEmail] = useState('');
  const [premiumDays, setPremiumDays] = useState(30);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumMsg, setPremiumMsg] = useState('');
  const setPremiumFor = async (days) => {
    if (!premiumEmail.trim() || !supabaseClient) return;
    setPremiumBusy(true);
    setPremiumMsg('');
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const r = await fetch('/api/admin-activate-premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ email: premiumEmail.trim(), days })
      });
      const data = await r.json();
      if (!r.ok) {
        setPremiumMsg(data.error || 'Error activando premium.');
      } else {
        setPremiumMsg(
          days > 0
            ? `Listo — ${data.profile.email} queda premium hasta ${new Date(data.profile.premium_until).toLocaleDateString('es-CO')}.`
            : `Listo — le quitamos el premium a ${data.profile.email}.`
        );
        setPremiumEmail('');
      }
    } catch (e) {
      setPremiumMsg(e.message);
    }
    setPremiumBusy(false);
  };

  const tabPicks =
    pickTab === 'pendientes'
      ? picks
      : pickTab === 'ganados'
      ? resolvedPicks.filter((p) => p.result === 'hit')
      : pickTab === 'perdidos'
      ? resolvedPicks.filter((p) => p.result === 'miss')
      : [...picks, ...resolvedPicks];

  // "Mi Bankroll": mismo cálculo de Kelly que el Bankroll del admin,
  // pero corriendo solo sobre los picks que ESTA persona sigue (no
  // los del sitio entero). followedDetail ya trae confianza/cuota/
  // resultado de cada uno — no hace falta pedir nada más.
  const myMultiplier = RISK_LEVELS[myRiskLevel].multiplier;
  const myResolvedFollowed = followedDetail
    .filter((p) => (p.result === 'hit' || p.result === 'miss') && p.odds)
    .slice()
    .sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
  // Antes se excluía del todo un pick seguido si Rushbet aún no tenía
  // su cuota (pasa seguido — el cruce se reintenta en cada corrida del
  // sync) — el pick simplemente desaparecía de Mi Bankroll sin
  // explicación. Ahora se muestra igual, solo que sin sugerencia de
  // Kelly hasta que aparezca la cuota real.
  const myPendingFollowed = followedDetail.filter((p) => p.result === 'pending');

  let myRunningBalance = myBankPlan;
  const myHistory = myResolvedFollowed.map((p) => {
    const fraction = kellyFraction(p.confidence, p.odds, myMultiplier);
    const stake = fraction * myBankPlan;
    const units = p.result === 'hit' ? stake * (p.odds - 1) : -stake;
    myRunningBalance += units;
    return { ...p, stake, units, balance: myRunningBalance };
  });
  const myHits = myHistory.filter((h) => h.units > 0).length;
  const myMisses = myHistory.length - myHits;
  const myEfectividad = myHistory.length ? Math.round((myHits / myHistory.length) * 100) : 0;
  const myAvgOdds = myHistory.length
    ? Math.round((myHistory.reduce((s, h) => s + h.odds, 0) / myHistory.length) * 100) / 100
    : 0;
  const myTotalStake = myHistory.reduce((s, h) => s + h.stake, 0);
  const myTotalProfit = myHistory.reduce((s, h) => s + h.units, 0);
  const myRoi = myTotalStake > 0 ? Math.round((myTotalProfit / myTotalStake) * 1000) / 10 : 0;
  const myFinalBalance = myHistory.length ? myHistory[myHistory.length - 1].balance : myBankPlan;
  const mySeries = [myBankPlan, ...myHistory.map((h) => h.balance)];
  const myPendingRows = myPendingFollowed.map((p) => {
    const fraction = kellyFraction(p.confidence, p.odds, myMultiplier);
    return { ...p, fraction, suggested: fraction * myBankPlan };
  });
  const myPendingStake = myPendingRows.reduce((sum, r) => sum + r.suggested, 0);

  // "Precisión esta semana" — % de aciertos por día, últimos 7 días
  // calendario (hoy incluido), para la mini-barra estilo la
  // referencia. Gris si ese día no hubo picks resueltos.
  const WEEKDAY_LABELS_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const myWeekPrecision = Array.from({ length: 7 }, (_, idx) => {
    const dayOffset = 6 - idx;
    const d = new Date(Date.now() - dayOffset * 24 * 3600 * 1000);
    const dayKey = d.toISOString().slice(0, 10);
    const dayHistory = myHistory.filter((h) => h.scheduledAt && new Date(h.scheduledAt).toISOString().slice(0, 10) === dayKey);
    const dayHits = dayHistory.filter((h) => h.units > 0).length;
    return {
      label: WEEKDAY_LABELS_ES[d.getDay()],
      pct: dayHistory.length ? Math.round((dayHits / dayHistory.length) * 100) : 0,
      hasData: dayHistory.length > 0
    };
  });

  const myBankrollTrialActive = Date.now() < MIBANKROLL_TRIAL_END;
  const myBankrollTrialEndLabel = new Intl.DateTimeFormat(
    lang === 'en' ? 'en-US' : lang === 'pt' ? 'pt-BR' : 'es-CO',
    { day: 'numeric', month: 'long', timeZone: 'America/Bogota' }
  ).format(new Date(MIBANKROLL_TRIAL_END));

  // Tira de 7 días (hoy + los próximos 6) para navegar Calendario —
  // son links reales a "/?date=YYYY-MM-DD#calendario" (no hash-routing
  // puro), así que getServerSideProps trae ese día completo al hacer
  // click, igual que ya soporta ?date= desde antes.
  const dayStrip = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
    const weekday = i === 0 ? 'Hoy' : new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'America/Bogota' }).format(d);
    const dayNum = new Intl.DateTimeFormat('es-CO', { day: '2-digit', timeZone: 'America/Bogota' }).format(d);
    return { dateStr, weekday: weekday.replace('.', ''), dayNum };
  });

  // Los partidos en vivo se muestran en Inicio, no en Calendario —
  // calendarioMatches los excluye del todo (ni siquiera aparecen bajo
  // "Todos"), para no duplicar la misma tarjeta en dos lados.
  const liveMatches = matches.filter((m) => m.status === 'live');
  const calendarioMatches = matches.filter((m) => m.status !== 'live');
  const filteredMatches =
    matchFilter === 'finalizados'
      ? calendarioMatches.filter((m) => m.status === 'done')
      : matchFilter === 'proximos'
      ? calendarioMatches.filter((m) => m.status === 'soon')
      : calendarioMatches;

  const greetingName = myDisplayName?.split(' ')[0] || null;
  const todayLabel = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'America/Bogota'
  }).format(new Date());

  const navLink = (v, label) => (
    <a href={`#${v}`} data-view={v} className={view === v ? 'active' : ''}>
      {label}
    </a>
  );

  // Prueba cerrada: mientras no se confirme acceso, no se monta NADA
  // del resto de la app (ni el header, ni las secciones) — solo esta
  // pantalla mínima, autocontenida (no depende del <style>{CSS}</style>
  // de más abajo porque nunca se llega a esa parte del árbol).
  if (!betaChecked) {
    return (
      <>
        <Head>
          <title>CAMILOREY</title>
        </Head>
        <div style={{ minHeight: '100vh', background: '#0E0D0C' }}></div>
      </>
    );
  }
  if (!betaAllowed) {
    return (
      <>
        <Head>
          <title>CAMILOREY</title>
          <meta name="robots" content="noindex" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&family=Manrope:wght@400;600;700&display=swap"
            rel="stylesheet"
          />
        </Head>
        <div
          style={{
            minHeight: '100vh',
            background: '#0E0D0C',
            color: '#F5F1EC',
            fontFamily: "'Manrope', sans-serif",
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center'
          }}
        >
          <div style={{ maxWidth: '380px' }}>
            <div style={{ fontSize: '34px', marginBottom: '14px' }}>🔒</div>
            <h1
              style={{
                fontFamily: "'Big Shoulders Display', sans-serif",
                fontWeight: 800,
                fontSize: '26px',
                margin: '0 0 10px'
              }}
            >
              CAMILOREY
            </h1>
            <p style={{ color: '#948C83', fontSize: '14.5px', lineHeight: 1.6, margin: '0 0 22px' }}>
              {!user
                ? 'El sitio está en pruebas cerradas por ahora. Inicia sesión con Google para ver si tenés acceso.'
                : 'Tu cuenta todavía no tiene acceso — el sitio está en pruebas cerradas por ahora.'}
            </p>
            {!user ? (
              <button
                onClick={loginWithGoogle}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: '#1B1917',
                  border: '1px solid #2B2724',
                  borderRadius: '12px',
                  padding: '13px 22px',
                  color: '#F5F1EC',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <GoogleGIcon size={18} /> Iniciar sesión con Google
              </button>
            ) : (
              <button
                onClick={logout}
                style={{
                  background: 'none',
                  border: '1px solid #2B2724',
                  borderRadius: '12px',
                  padding: '11px 20px',
                  color: '#948C83',
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Cerrar sesión
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>CAMILOREY · Picks Liga Pro Checa de tenis de mesa</title>
        <meta name="description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <link rel="canonical" href="https://camilorey-app.vercel.app/" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="CAMILOREY" />
        <meta property="og:title" content="CAMILOREY · Picks Liga Pro Checa de tenis de mesa" />
        <meta property="og:description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <meta property="og:url" content="https://camilorey-app.vercel.app/" />
        <meta property="og:image" content="https://camilorey-app.vercel.app/icon-512x512.png" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="CAMILOREY · Picks Liga Pro Checa de tenis de mesa" />
        <meta name="twitter:description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <meta name="twitter:image" content="https://camilorey-app.vercel.app/icon-512x512.png" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/svg+xml" href="/icon-master.svg" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0E0D0C" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{CSS}</style>
        {/* Aplica el tema guardado ANTES del primer render — si no,
            todo el mundo ve un parpadeo del tema oscuro por defecto
            durante una fracción de segundo antes de que React monte
            y el useEffect de arriba corrija a claro. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var pref=localStorage.getItem('${THEME_KEY}')||'sistema';
              var light=pref==='claro'||(pref==='sistema'&&window.matchMedia('(prefers-color-scheme: light)').matches);
              document.documentElement.setAttribute('data-theme', light?'light':'dark');
            }catch(e){}})();`
          }}
        />
      </Head>

      <TableDecor side="left" />
      <TableDecor side="right" />

      <header className="site">
        <a href="#inicio" className="logo">
          CAMILOREY
          <span className="dot"></span>
        </a>
        <nav className="top-nav">
          {navLink('inicio', t('navInicio'))}
          {navLink('calendario', t('navCalendario'))}
          {navLink('picks', t('navPicks'))}
          {navLink('seguidos', t('navSeguidos'))}
          <a href="#mibankroll" data-view="mibankroll" className={view === 'mibankroll' ? 'active' : ''}>
            {t('navMiBankroll')} {!isAdmin && !isPremium && !myBankrollTrialActive ? <ProfileIcon name="lock" size={11} /> : null}
          </a>
          {isAdmin ? (
            <a href="#admin" className={ADMIN_VIEWS.includes(view) || view === 'admin' ? 'active' : ''}>
              Admin
            </a>
          ) : null}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {user ? (
            <button
              className="bell-btn"
              onClick={async () => {
                const result = await ensurePushSubscription(user);
                if (result === 'ok') alert('Notificaciones activadas ✅ — te avisaremos cuando termine un set o un partido que sigas.');
                else if (result === 'denied')
                  alert(
                    'Tienes las notificaciones bloqueadas para este sitio. Actívalas desde la configuración/permisos del navegador para este dominio y vuelve a intentar.'
                  );
                else if (result === 'ios-needs-install')
                  alert(
                    'En iPhone/iPad, las notificaciones solo funcionan si agregas CAMILOREY a tu pantalla de inicio primero: toca Compartir (el cuadrito con la flecha) → "Agregar a pantalla de inicio", y abre la app desde ese ícono en vez de Safari.'
                  );
                else if (result === 'unsupported') alert('Tu navegador no soporta notificaciones push.');
                else alert('No se pudo activar las notificaciones, intenta de nuevo.');
              }}
              title="Activar notificaciones push"
            >
              <ProfileIcon name="bell" size={16} />
            </button>
          ) : null}
          {!supabaseClient ? null : user ? (
            <div className="user-chip" onClick={() => setShowProfileModal(true)} title="Perfil">
              <UserAvatar
                emoji={myAvatarEmoji}
                url={myAvatarUrl}
                initials={<span className="user-chip-fallback">{(myDisplayName || user.email || '?')[0].toUpperCase()}</span>}
              />
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowLoginModal(true)}>
              <GoogleGIcon size={14} />
              {t('entrar')}
            </button>
          )}
        </div>
      </header>
      {userCount > 0 && isAdmin && (
        <div className="user-count-strip">
          {userCount} {userCount === 1 ? 'persona registrada' : 'personas registradas'} (solo tú ves esto)
        </div>
      )}

      {isAdmin && (
        <div className="active-count-badge" title="Personas con el sitio abierto ahora mismo — solo vos ves esto">
          <span className="live-dot"></span>
          {activeCount} {activeCount === 1 ? 'activo' : 'activos'}
        </div>
      )}

      <main>
        <section className={`view ${view === 'inicio' ? 'active' : ''}`}>
          {greetingName ? (
            <div className="greeting">
              <div className="greeting-hi">
                {t('holaSaludo')}, {greetingName} 👋
              </div>
              <div className="greeting-date">{todayLabel}</div>
            </div>
          ) : (
            <>
              <span className="eyebrow">{t('inicioEyebrow')}</span>
              <h1 className="page-title">{t('inicioTitle')}</h1>
            </>
          )}
          <p className="page-sub">{t('inicioSub')}</p>

          <a href="https://t.me/+q_JbStqxCsFhYWE8" target="_blank" rel="noopener noreferrer" className="tg-banner">
            <div className="tg-banner-text">
              <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
                <path d="M21.9 2.6c-.3-.2-.7-.3-1.1-.1L2.4 9.9c-.5.2-.8.6-.8 1.1 0 .5.4.9.9 1l4.9 1.5 1.9 6c.1.4.5.7.9.7.3 0 .5-.1.7-.3l2.7-2.6 4.8 3.5c.2.2.5.2.7.2.2 0 .4 0 .5-.1.4-.2.6-.5.7-.9l3.2-15.5c.1-.4-.1-.8-.5-1z" />
              </svg>
              <div>
                <div className="tg-banner-title">Únete al canal de Telegram</div>
                <div className="tg-banner-sub">Picks, avisos y novedades en tiempo real</div>
              </div>
            </div>
            <span className="tg-banner-cta">Entrar →</span>
          </a>

          <div className="stat-strip stat-strip-4">
            <div className="stat-card">
              <div className="label">{t('statEfectividad')}</div>
              <div className="value hit num">{stats.efectividad}%</div>
            </div>
            <div className="stat-card">
              <div className="label">{t('statRachaActual')}</div>
              <div className="value num">
                {stats.racha === 0 ? '—' : `${Math.abs(stats.racha)}${stats.racha > 0 ? 'W' : 'L'}`}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">{t('statROI')}</div>
              <div className={`value num ${stats.roi >= 0 ? 'hit' : 'miss'}`}>
                {stats.roi >= 0 ? '+' : ''}
                {stats.roi}%
              </div>
            </div>
            <div className="stat-card">
              <div className="label">{t('statBalance')}</div>
              <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
            </div>
          </div>

          {featured ? (
            <>
              <div className="section-head">
                <h2>{t('pickDestacado')}</h2>
              </div>
              <PickCard
                pick={featured}
                onClick={() => setModalPick(featured)}
                followed={followedPickIds.has(featured.id)}
                onToggleFollow={toggleFollow}
                featured
                oddsFormat={oddsFormat}
                live={liveScores[featured.sourceId]}
              />
            </>
          ) : (
            <p className="page-sub">{t('noHayPicksActivos')}</p>
          )}

          {liveMatches.length > 0 ? (
            <>
              <div className="section-head">
                <h2>
                  <span className="live-dot"></span> {t('enVivoAhora')} ({liveMatches.length})
                </h2>
              </div>
              {liveMatches.map((m, i) => (
                <MatchRow
                  m={m}
                  key={i}
                  onClick={() => setModalMatch(m)}
                  followed={m.pickId ? followedPickIds.has(m.pickId) : false}
                  onToggleFollow={toggleFollow}
                  live={liveScores[m.sourceId]}
                />
              ))}
            </>
          ) : null}

          <div className="section-head">
            <a href="#picks" className="see-all">
              {t('verTodosPicks')}
            </a>
          </div>
        </section>

        <section className={`view ${view === 'picks' ? 'active' : ''}`}>
          <span className="eyebrow">{t('picksEyebrow')}</span>
          <h1 className="page-title">{t('picksTitle')}</h1>
          <p className="page-sub">
            {tabPicks.length} {t('picksEnEstaCategoria')}
          </p>
          <div className="tabs">
            {[
              ['todos', t('tabTodos')],
              ['pendientes', t('tabPendientes')],
              ['ganados', t('tabGanados')],
              ['perdidos', t('tabPerdidos')]
            ].map(([key, label]) => (
              <div key={key} className={`tab ${pickTab === key ? 'active' : ''}`} onClick={() => setPickTab(key)}>
                {label}
              </div>
            ))}
          </div>
          <div className="pick-grid">
            {tabPicks.length === 0 ? (
              <p className="page-sub">{t('noHayPicksCategoria')}</p>
            ) : (
              tabPicks.map((p) => (
                <PickCard
                  key={p.id}
                  pick={p}
                  onClick={() => setModalPick(p)}
                  followed={followedPickIds.has(p.id)}
                  onToggleFollow={p.result === 'pending' ? toggleFollow : undefined}
                  oddsFormat={oddsFormat}
                  live={liveScores[p.sourceId]}
                />
              ))
            )}
          </div>
        </section>

        <section className={`view ${view === 'calendario' ? 'active' : ''}`}>
          <span className="eyebrow">{t('calendarioEyebrow')}</span>
          <h1 className="page-title">{t('calendarioTitle')}</h1>
          <p className="page-sub">{t('calendarioSub')}</p>
          <div className="day-strip">
            {dayStrip.map((d) => (
              <a
                key={d.dateStr}
                href={`/?date=${d.dateStr}#calendario`}
                className={`day-chip ${currentDateStr === d.dateStr ? 'active' : ''}`}
              >
                <span className="day-chip-weekday">{d.weekday}</span>
                <span className="day-chip-num num">{d.dayNum}</span>
              </a>
            ))}
          </div>
          <div className="match-filter-row">
            <div className={`match-filter-btn ${matchFilter === 'proximos' ? 'active' : ''}`} onClick={() => setMatchFilter('proximos')}>
              {t('filtroProximos')}
            </div>
            <div
              className={`match-filter-btn ${matchFilter === 'finalizados' ? 'active' : ''}`}
              onClick={() => setMatchFilter('finalizados')}
            >
              {t('filtroFinalizados')}
            </div>
            <div className={`match-filter-btn ${matchFilter === 'todos' ? 'active' : ''}`} onClick={() => setMatchFilter('todos')}>
              {t('filtroTodos')}
            </div>
          </div>
          <div className="section-head">
            <h2>{currentDateStr === dayStrip[0].dateStr ? t('partidosDeHoy') : t('partidos')}</h2>
          </div>
          <div>
            {filteredMatches.length === 0 ? (
              <p className="page-sub">{t('noHayPartidosCategoria')}</p>
            ) : (
              filteredMatches.map((m, i) => (
                <MatchRow
                  m={m}
                  key={i}
                  onClick={() => setModalMatch(m)}
                  followed={m.pickId ? followedPickIds.has(m.pickId) : false}
                  onToggleFollow={toggleFollow}
                  live={liveScores[m.sourceId]}
                />
              ))
            )}
          </div>
        </section>

        {isAdmin && (
        <section className={`view ${view === 'admin' ? 'active' : ''}`}>
          <span className="eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ProfileIcon name="shield" size={13} /> Solo tú ves esto
          </span>
          <h1 className="page-title">Admin</h1>
          <p className="page-sub">Todo lo que solo vos administrás, agrupado en un solo lugar.</p>

          <div className="profile-section-label">PANELES</div>
          <a className="profile-row" href="#bankroll">
            <span className="profile-row-icon">
              <ProfileIcon name="dollar" />
            </span>
            <div className="profile-row-body">
              <strong>{t('navBankroll')}</strong>
              <p>Planificación con Kelly, log de apuestas y evolución del banco</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>
          <a className="profile-row" href="#grupos">
            <span className="profile-row-icon">
              <ProfileIcon name="grid" />
            </span>
            <div className="profile-row-body">
              <strong>{t('navGrupos')}</strong>
              <p>Tablas de posiciones de los torneos en vivo</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>
          <a className="profile-row" href="#modelo">
            <span className="profile-row-icon">
              <ProfileIcon name="chart" />
            </span>
            <div className="profile-row-body">
              <strong>{t('navModelo')}</strong>
              <p>Estadísticas reales de acierto de la fórmula de confianza</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>
          <a className="profile-row" href="#errores">
            <span className="profile-row-icon">
              <ProfileIcon name="alert" />
            </span>
            <div className="profile-row-body">
              <strong>{t('navErrores')}</strong>
              <p>Últimos errores registrados de la app</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>
          <a className="profile-row" href="#actividad">
            <span className="profile-row-icon">
              <ProfileIcon name="trending-up" />
            </span>
            <div className="profile-row-body">
              <strong>Actividad</strong>
              <p>Qué vistas y acciones se usan más en el sitio</p>
            </div>
            <ProfileIcon name="chevron-right" size={16} />
          </a>

          <div className="profile-section-label" style={{ marginTop: '22px' }}>
            PREMIUM MANUAL
          </div>
          <div className="bankroll-card">
            <p style={{ color: 'var(--muted)', fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }}>
              El pago pasa por fuera del sitio (link de pago). Cuando te avisen que alguien pagó, escribí su correo
              acá para activarle Mi Bankroll premium.
            </p>
            <input
              type="email"
              className="profile-name-input"
              style={{ width: '100%', marginBottom: '10px' }}
              placeholder="correo@ejemplo.com"
              value={premiumEmail}
              onChange={(e) => setPremiumEmail(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ball"
                disabled={premiumBusy || !premiumEmail.trim()}
                onClick={() => setPremiumFor(premiumDays)}
              >
                Activar {premiumDays} días
              </button>
              <input
                type="number"
                className="profile-name-input"
                style={{ width: '80px' }}
                value={premiumDays}
                onChange={(e) => setPremiumDays(Number(e.target.value) || 0)}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={premiumBusy || !premiumEmail.trim()}
                onClick={() => setPremiumFor(0)}
              >
                Quitar premium
              </button>
            </div>
            {premiumMsg ? (
              <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '10px' }}>{premiumMsg}</p>
            ) : null}
          </div>
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'bankroll' ? 'active' : ''}`}>
          <a href="#admin" className="admin-back-link">
            <ProfileIcon name="arrow-left" size={14} /> Admin
          </a>
          <span className="eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ProfileIcon name="shield" size={13} /> Planificación con Kelly
          </span>
          <h1 className="page-title">Bankroll</h1>

          <div className="tabs">
            <div className={`tab ${bankrollTab === 'slip' ? 'active' : ''}`} onClick={() => setBankrollTab('slip')}>
              <ProfileIcon name="file" size={14} /> Slip
            </div>
            <div
              className={`tab ${bankrollTab === 'rendimiento' ? 'active' : ''}`}
              onClick={() => setBankrollTab('rendimiento')}
            >
              <ProfileIcon name="trending-up" size={14} /> Rendimiento
            </div>
          </div>

          {bankrollTab === 'slip' ? (
            (() => {
              const slipPicks = followedDetail.filter((p) => p.matchStatus !== 'done' && p.odds);
              const multiplier = RISK_LEVELS[riskLevel].multiplier;
              const rows = slipPicks.map((p) => ({
                ...p,
                fraction: kellyFraction(p.confidence, p.odds, multiplier)
              }));
              const asignado = rows.reduce((sum, r) => sum + r.fraction * bankPlan, 0);
              const potencial = rows.reduce((sum, r) => sum + r.fraction * bankPlan * (r.odds - 1), 0);
              const pctAsignado = bankPlan > 0 ? Math.min(100, Math.round((asignado / bankPlan) * 100)) : 0;

              return (
                <>
                  <div className="bankroll-card">
                    <div className="slip-label">TU BANKROLL</div>
                    <div className="slip-bank-row">
                      <span className="slip-bank-currency">$</span>
                      <input
                        type="number"
                        className="slip-bank-input"
                        value={bankPlan}
                        onChange={(e) => setBankPlan(Number(e.target.value) || 0)}
                      />
                      <span className="slip-bank-tag">COP</span>
                    </div>
                    <div className="slip-asignado-row">
                      <span>Asignado</span>
                      <span className="num">
                        {formatCOP(asignado)} ({pctAsignado}%)
                      </span>
                    </div>
                    <div className="ia-bar-track">
                      <div className="ia-bar-fill tier-alta" style={{ width: `${pctAsignado}%` }}></div>
                    </div>

                    <div className="slip-label" style={{ marginTop: 18 }}>
                      NIVEL DE RIESGO
                    </div>
                    <div className="risk-level-row">
                      {Object.entries(RISK_LEVELS).map(([key, rl]) => (
                        <div
                          key={key}
                          className={`risk-level-btn ${riskLevel === key ? 'active' : ''}`}
                          onClick={() => setRiskLevel(key)}
                        >
                          <div className="risk-level-label">{rl.label}</div>
                          <div className="risk-level-sub">{rl.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="tabs">
                    <div className={`tab ${slipMode === 'combinado' ? 'active' : ''}`} onClick={() => setSlipMode('combinado')}>
                      Combinado
                    </div>
                    <div className={`tab ${slipMode === 'individual' ? 'active' : ''}`} onClick={() => setSlipMode('individual')}>
                      Individual
                    </div>
                  </div>

                  <div className="stat-strip stat-strip-3">
                    <div className="stat-card">
                      <div className="label">Picks</div>
                      <div className="value num">{rows.length}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Asignación</div>
                      <div className="value num">{formatCOP(asignado)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="label">Potencial</div>
                      <div className="value hit num">{formatCOP(potencial)}</div>
                    </div>
                  </div>

                  <div className="section-head">
                    <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <ProfileIcon name="layers" size={17} /> Selecciones individuales
                    </h2>
                    <span className="see-all">{rows.length} picks</span>
                  </div>

                  {rows.length === 0 ? (
                    <div className="premium-lock-card">
                      <div className="premium-lock-icon">
                        <ProfileIcon name="layers" size={22} />
                      </div>
                      <h3>Sin picks activos</h3>
                      <p>Sigue algunos picks para ver sugerencias de planificación con Kelly aquí.</p>
                    </div>
                  ) : (
                    <table className="bk">
                      <thead>
                        <tr>
                          <th>Pick</th>
                          <th>Confianza</th>
                          <th>Cuota</th>
                          <th>Kelly</th>
                          <th>Sugerido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.player}</td>
                            <td className="num">{r.confidence}%</td>
                            <td className="num">{formatOdds(r.odds, oddsFormat)}</td>
                            <td className="num">{r.fraction > 0 ? `${(r.fraction * 100).toFixed(1)}%` : 'Sin ventaja'}</td>
                            <td className="num">{r.fraction > 0 ? formatCOP(r.fraction * bankPlan) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <p className="page-sub" style={{ marginTop: 14 }}>
                    "{slipMode === 'combinado' ? 'Combinado' : 'Individual'}" es solo cómo se agrupa la vista — el
                    banco de planeación no cambia el bankroll real, es una simulación tuya. El sistema sigue
                    apostando el monto fijo de siempre (ver Rendimiento).
                  </p>
                </>
              );
            })()
          ) : (
            <>
              <div className="balance-hero">
                <div className="balance-hero-label">Balance actual</div>
                <div className={`balance-hero-value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
              </div>

              <div className="stat-strip stat-strip-3">
                <div className="stat-card">
                  <div className="label">ROI</div>
                  <div className={`value num ${stats.roi >= 0 ? 'hit' : 'miss'}`}>
                    {stats.roi >= 0 ? '+' : ''}
                    {stats.roi}%
                  </div>
                </div>
                <div className="stat-card">
                  <div className="label">Efectividad</div>
                  <div className="value hit num">{stats.efectividad}%</div>
                </div>
                <div className="stat-card">
                  <div className="label">Balance</div>
                  <div className={`value num ${stats.unidades >= 0 ? 'hit' : 'miss'}`}>{formatCOP(stats.unidades)}</div>
                </div>
              </div>

              <div className="bankroll-card">
                <strong>Evolución</strong>
                <LineChart series={bankrollSeries} />
              </div>

              <div className="bankroll-card">
                <strong>¿Cómo se mide?</strong>
                <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6' }}>
                  Cada pick arriesga entre $100.000 y $250.000 según la confianza del modelo (ver lib/staking.js). El
                  pago sí usa la cuota real de Rushbet cuando logramos cruzar el partido en su feed; si no la
                  encontramos, se calcula 1:1. Ajusta siempre el tamaño de tus apuestas a lo que puedas permitirte
                  perder. El banco arrancó en $2.000.000.
                </p>
              </div>

              <div className="bankroll-card">
                <table className="bk">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Pick</th>
                      <th>Monto</th>
                      <th>Resultado</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankrollLog.map((r, i) => (
                      <tr key={i}>
                        <td>{r.fecha}</td>
                        <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.pick}</td>
                        <td className={r.ok ? 'hit' : 'miss'}>{r.u}</td>
                        <td className={r.ok ? 'hit' : 'miss'}>{r.ok ? 'Acierto' : 'Fallo'}</td>
                        <td>{r.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'grupos' ? 'active' : ''}`}>
          <a href="#admin" className="admin-back-link">
            <ProfileIcon name="arrow-left" size={14} /> Admin
          </a>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Grupos</h1>
          <p className="page-sub">Tablas de los torneos que están en vivo ahora mismo.</p>
          {tournamentGroups.length === 0 ? (
            <p className="page-sub">No hay ningún torneo en vivo en este momento.</p>
          ) : (
            tournamentGroups.map((g) => <GroupTable group={g} key={g.tournamentId} />)
          )}
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'modelo' ? 'active' : ''}`}>
          <a href="#admin" className="admin-back-link">
            <ProfileIcon name="arrow-left" size={14} /> Admin
          </a>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Modelo</h1>
          <p className="page-sub">¿La confianza que calculamos de verdad predice mejor que una moneda al aire?</p>
          {modelStatsError ? (
            <p className="page-sub">Error: {modelStatsError}</p>
          ) : !modelStats ? (
            <p className="page-sub">Cargando…</p>
          ) : modelStats.n === 0 ? (
            <p className="page-sub">Todavía no hay picks resueltos.</p>
          ) : (
            <ModelStatsView stats={modelStats} />
          )}
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'errores' ? 'active' : ''}`}>
          <a href="#admin" className="admin-back-link">
            <ProfileIcon name="arrow-left" size={14} /> Admin
          </a>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Errores</h1>
          <p className="page-sub">Últimos 50 errores de la app (no de los cronjobs — esos avisan por su cuenta).</p>
          {errorLogError ? (
            <p className="page-sub">Error: {errorLogError}</p>
          ) : !errorLog ? (
            <p className="page-sub">Cargando…</p>
          ) : errorLog.length === 0 ? (
            <p className="page-sub">Sin errores registrados. 🎉</p>
          ) : (
            <div className="stat-rows" style={{ gap: 0 }}>
              {errorLog.map((e) => (
                <div className="error-row" key={e.id}>
                  <div className="error-row-top">
                    <span className="error-row-source">{e.source}</span>
                    <span className="error-row-date">
                      {new Intl.DateTimeFormat('es-CO', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'America/Bogota'
                      }).format(new Date(e.created_at))}
                    </span>
                  </div>
                  <div className="error-row-message">{e.message}</div>
                  {e.context ? <div className="error-row-context">{JSON.stringify(e.context)}</div> : null}
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {isAdmin && (
        <section className={`view ${view === 'actividad' ? 'active' : ''}`}>
          <a href="#admin" className="admin-back-link">
            <ProfileIcon name="arrow-left" size={14} /> Admin
          </a>
          <span className="eyebrow">Solo tú ves esto</span>
          <h1 className="page-title">Actividad</h1>
          <p className="page-sub">
            Qué se usa de verdad en el sitio, últimos 7 días — analítica propia, sin IP ni cookies de rastreo de terceros.
          </p>
          {analyticsError ? (
            <p className="page-sub">Error: {analyticsError}</p>
          ) : !analyticsSummary ? (
            <p className="page-sub">Cargando…</p>
          ) : analyticsSummary.totalEvents === 0 ? (
            <p className="page-sub">Todavía no hay eventos registrados.</p>
          ) : (
            <>
              <div className="stat-strip stat-strip-3">
                <div className="stat-card">
                  <div className="label">Eventos</div>
                  <div className="value num">{analyticsSummary.totalEvents}</div>
                </div>
                <div className="stat-card">
                  <div className="label">Usuarios distintos</div>
                  <div className="value num">{analyticsSummary.uniqueLoggedInUsers}</div>
                </div>
                <div className="stat-card">
                  <div className="label">Días</div>
                  <div className="value num">{analyticsSummary.sinceDays}</div>
                </div>
              </div>

              <div className="section-head">
                <h2>Vistas más usadas</h2>
              </div>
              <div className="stat-rows" style={{ gap: 0 }}>
                {analyticsSummary.byView.map((row) => (
                  <div className="stat-row" key={row.name}>
                    <div className="stat-row-top">
                      <span className="stat-row-label">{row.name}</span>
                      <span className="stat-row-value num">{row.count}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-head">
                <h2>Acciones más usadas</h2>
              </div>
              <div className="stat-rows" style={{ gap: 0 }}>
                {analyticsSummary.byEvent.map((row) => (
                  <div className="stat-row" key={row.name}>
                    <div className="stat-row-top">
                      <span className="stat-row-label">{row.name}</span>
                      <span className="stat-row-value num">{row.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        )}

        <section className={`view ${view === 'seguidos' ? 'active' : ''}`}>
          <span className="eyebrow">{t('seguidosEyebrow')}</span>
          <h1 className="page-title">{t('seguidosTitle')}</h1>
          <p className="page-sub">{t('seguidosSub')}</p>
          {!user ? (
            <p className="page-sub">{t('iniciaSesionSeguir')}</p>
          ) : (
            (() => {
              if (followedDetail.length === 0) {
                return <p className="page-sub">{t('noSiguesNingunPick')}</p>;
              }
              return (
                <div className="followed-grid">
                  {followedDetail.map((p) => (
                    <FollowedPickCard
                      key={p.id}
                      pick={p}
                      onClick={() => setModalPick(p)}
                      followed={true}
                      onToggleFollow={toggleFollow}
                    />
                  ))}
                </div>
              );
            })()
          )}
        </section>

        <section className={`view ${view === 'mibankroll' ? 'active' : ''}`}>
          <span className="eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ProfileIcon name="shield" size={13} /> {t('miBankrollEyebrow')}
          </span>
          <h1 className="page-title">{t('navMiBankroll')}</h1>
          <p className="page-sub">{t('miBankrollSub')}</p>
          {!user ? (
            <p className="page-sub">{t('iniciaSesionBankroll')}</p>
          ) : !isAdmin && !isPremium && !myBankrollTrialActive ? (
            <div className="premium-lock-card">
              <div className="premium-lock-icon">
                <ProfileIcon name="lock" size={22} />
              </div>
              <h3>{t('funcionPremium')}</h3>
              <p>{t('funcionPremiumDesc')}</p>
            </div>
          ) : !myBankLoaded ? (
            <p className="page-sub">{t('cargando')}</p>
          ) : (
            <>
              {!isAdmin && myBankrollTrialActive ? (
                <div className="trial-banner">{t('miBankrollTrialMsg', { date: myBankrollTrialEndLabel })}</div>
              ) : null}
              <div className="bankroll-card">
                <div className="slip-label">TU BANCO INICIAL</div>
                <div className="slip-bank-row">
                  <span className="slip-bank-currency">$</span>
                  <input
                    type="number"
                    className="slip-bank-input"
                    value={myBankPlan}
                    onChange={(e) => setMyBankPlan(Number(e.target.value) || 0)}
                    onBlur={() => saveMyBankSettings({ starting_bank: myBankPlan })}
                  />
                  <span className="slip-bank-tag">COP</span>
                </div>

                <div className="slip-label" style={{ marginTop: 18 }}>
                  NIVEL DE RIESGO
                </div>
                <div className="risk-level-row">
                  {Object.entries(RISK_LEVELS).map(([key, rl]) => (
                    <div
                      key={key}
                      className={`risk-level-btn ${myRiskLevel === key ? 'active' : ''}`}
                      onClick={() => {
                        setMyRiskLevel(key);
                        saveMyBankSettings({ risk_level: key });
                      }}
                    >
                      <div className="risk-level-label">{rl.label}</div>
                      <div className="risk-level-sub">{rl.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {myPendingRows.length === 0 && myHistory.length === 0 ? (
                <div className="premium-lock-card">
                  <div className="premium-lock-icon">
                    <ProfileIcon name="layers" size={22} />
                  </div>
                  <h3>{t('miBankrollVacioTitle')}</h3>
                  <p>{t('miBankrollVacioDesc')}</p>
                </div>
              ) : (
                <>
                  {myPendingRows.length > 0 ? (
                    <div className="bankroll-card">
                      <strong>Picks seguidos por jugarse</strong>
                      <table className="bk" style={{ marginTop: '10px' }}>
                        <thead>
                          <tr>
                            <th>Pick</th>
                            <th>Confianza</th>
                            <th>Cuota</th>
                            <th>Sugerido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myPendingRows.map((r) => (
                            <tr key={r.id}>
                              <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.market}</td>
                              <td className="num">{r.confidence}%</td>
                              <td className="num">{formatOdds(r.odds, oddsFormat)}</td>
                              <td className="num">
                                {!r.odds ? 'Esperando cuota' : r.fraction > 0 ? formatCOP(r.suggested) : t('sinVentaja')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6', margin: '10px 0 0' }}>
                        Si aciertas todos, arriesgarías en total{' '}
                        <strong className="num">{formatCOP(myPendingStake)}</strong> de tu banco.
                      </p>
                    </div>
                  ) : null}

                  {myHistory.length > 0 ? (
                    <>
                      <div className="bankroll-card rendimiento-card">
                        <div className="rendimiento-top">
                          <div>
                            <div className="rendimiento-label">TU RENDIMIENTO</div>
                            <div className={`rendimiento-value num ${myTotalProfit >= 0 ? 'hit' : 'miss'}`}>
                              {myTotalProfit >= 0 ? '+' : ''}
                              {formatCOP(myTotalProfit)}
                            </div>
                            <div className="rendimiento-sub">
                              <span className={`num ${myRoi >= 0 ? 'hit' : 'miss'}`}>
                                {myRoi >= 0 ? '+' : ''}
                                {myRoi}% ROI
                              </span>
                              <span> · {myHistory.length} picks</span>
                            </div>
                          </div>
                          <div className="rendimiento-tasa">
                            <span className="rendimiento-tasa-label">TASA DE ACIERTO</span>
                            <span className="rendimiento-tasa-val num">{myEfectividad}%</span>
                          </div>
                        </div>
                      </div>

                      <div className="stat-strip stat-strip-3">
                        <div className="stat-card">
                          <div className="label">Ganados</div>
                          <div className="value hit num">{myHits}</div>
                        </div>
                        <div className="stat-card">
                          <div className="label">Perdidos</div>
                          <div className="value miss num">{myMisses}</div>
                        </div>
                        <div className="stat-card">
                          <div className="label">Cuota Prom.</div>
                          <div className="value num">{myAvgOdds || '—'}</div>
                        </div>
                      </div>

                      <div className="bankroll-card week-precision-card">
                        <div className="rendimiento-label">Precisión esta semana</div>
                        <div className="week-precision-row">
                          {myWeekPrecision.map((d, i) => (
                            <div className="week-precision-col" key={i}>
                              <div className="week-precision-track">
                                <div
                                  className={`week-precision-fill ${d.hasData ? (d.pct >= 50 ? 'hit' : 'miss') : ''}`}
                                  style={{ height: `${d.hasData ? Math.max(d.pct, 8) : 0}%` }}
                                ></div>
                              </div>
                              <span className="week-precision-day">{d.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bankroll-card">
                        <strong>Evolución</strong>
                        <LineChart series={mySeries} />
                      </div>

                      <div className="section-head">
                        <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <ProfileIcon name="trending-up" size={17} /> Planes resueltos
                        </h2>
                        <span className="see-all">{myHistory.length}</span>
                      </div>

                      <div className="bankroll-card">
                        <table className="bk">
                          <thead>
                            <tr>
                              <th>Pick</th>
                              <th>Monto</th>
                              <th>Resultado</th>
                              <th>Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {myHistory
                              .slice()
                              .reverse()
                              .map((h) => (
                                <tr key={h.id}>
                                  <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{h.market}</td>
                                  <td className={h.stake === 0 ? '' : h.units >= 0 ? 'hit' : 'miss'} style={h.stake === 0 ? { color: 'var(--muted)' } : undefined}>
                                    {formatCOP(h.units, true)}
                                  </td>
                                  <td
                                    className={h.stake === 0 ? '' : h.units >= 0 ? 'hit' : 'miss'}
                                    style={h.stake === 0 ? { color: 'var(--muted)' } : undefined}
                                  >
                                    {h.stake === 0 ? 'Sin ventaja — Kelly no apostó' : h.units >= 0 ? 'Acierto' : 'Fallo'}
                                  </td>
                                  <td>{formatCOP(h.balance)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="site">
        <strong>CAMILOREY</strong> {t('footerDisclaimer')}
        <div style={{ marginTop: '10px', display: 'flex', gap: '14px' }}>
          <a href="/privacidad">{t('politicaPrivacidad')}</a>
          <a href="/terminos">{t('terminosCondiciones')}</a>
        </div>
      </footer>

      <nav className="bottom-nav">
        <a href="#inicio" className={view === 'inicio' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
          </svg>
          {t('navInicio')}
        </a>
        <a href="#calendario" className={view === 'calendario' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
            <path d="m9 14 2 2 4-4" />
          </svg>
          {t('navCalendario')}
        </a>
        <a href="#picks" className={view === 'picks' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
          {t('navPicks')}
        </a>
        <a href="#seguidos" className={view === 'seguidos' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
          </svg>
          {t('navSeguidos')}
        </a>
        <a href="#mibankroll" className={view === 'mibankroll' ? 'active' : ''}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            {!isAdmin && !isPremium && !myBankrollTrialActive ? (
              <span className="nav-lock-badge">
                <ProfileIcon name="lock" size={9} />
              </span>
            ) : null}
          </span>
          {t('navMiBankroll')}
        </a>
        {isAdmin ? (
          <a href="#admin" className={ADMIN_VIEWS.includes(view) || view === 'admin' ? 'active' : ''}>
            <ProfileIcon name="shield" size={20} />
            Admin
          </a>
        ) : null}
      </nav>

      {modalPick && (
        <PickDetailModal pick={modalPick} onClose={() => setModalPick(null)} oddsFormat={oddsFormat} lang={lang} />
      )}

      {modalMatch && (
        <MatchDetailModal
          m={modalMatch}
          onClose={() => setModalMatch(null)}
          user={user}
          profile={{ displayName: myDisplayName, avatarEmoji: myAvatarEmoji, avatarUrl: myAvatarUrl }}
          lang={lang}
        />
      )}

      {showRiskModal && (
        <RiskModal count={followedPickIds.size} tips={riskTips} onClose={() => setShowRiskModal(false)} lang={lang} />
      )}

      {showProfileModal && user && (
        <ProfileModal
          user={user}
          profile={myProfile}
          displayName={myDisplayName}
          avatarEmoji={myAvatarEmoji}
          avatarUrl={myAvatarUrl}
          isAdmin={isAdmin}
          isPremium={isPremium}
          onClose={() => setShowProfileModal(false)}
          onLogout={logout}
          themePref={themePref}
          onChangeTheme={changeTheme}
          oddsFormat={oddsFormat}
          onChangeOddsFormat={changeOddsFormat}
          lang={lang}
          onChangeLang={changeLang}
          onProfileUpdated={(patch) => setMyProfile((prev) => ({ ...prev, ...patch }))}
        />
      )}

      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} onLogin={loginWithGoogle} lang={lang} />
      )}

      {showPrivacyConsent && <PrivacyConsentModal onClose={dismissPrivacyConsent} lang={lang} />}
      {showOnboarding && <OnboardingModal onClose={dismissOnboarding} lang={lang} />}
    </>
  );
}

const CSS = `
  :root{
    --bg:#0E0D0C;
    --bg-rgb:14,13,12;
    --bg-alt:#171513;
    --card:#1B1917;
    --ink:#F5F1EC;
    --muted:#948C83;
    --line:#2B2724;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#2E1817;
    --court-soft-text:#FAC7C7;
    --ball:#FF7A45;
    --ball-dark:#D85A30;
    --hit:#5DCAA5;
    --miss:#F09595;
    --blue:#3B82C4;
    --blue-dark:#245A8C;
    --font-display:'Big Shoulders Display', sans-serif;
    --font-body:'Manrope', sans-serif;
    --font-mono:'IBM Plex Mono', monospace;
    --radius:16px;
    --shadow:0 2px 12px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3);
    --decor-ball:#D4A24C;
  }
  /* Tema claro — mismos nombres de variable, el resto del CSS ya las
     usa en todos lados, así que basta con redefinirlas acá para que
     todo el sitio cambie de color sin tocar cada componente. Se activa
     poniendo data-theme="light" en <html> (ver applyTheme en el JS). */
  :root[data-theme="light"]{
    --bg:#FDFBFA;
    --bg-rgb:253,251,250;
    --bg-alt:#F5EFEC;
    --card:#FFFFFF;
    --ink:#1E1815;
    --muted:#8A7F78;
    --line:#E9E0DB;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#FBE2E2;
    --court-soft-text:#A32D2D;
    --ball:#E85E2C;
    --ball-dark:#B8481F;
    --hit:#1E9C74;
    --miss:#C23A3A;
    --blue:#2E6CA8;
    --blue-dark:#1E4A73;
    --shadow:0 2px 12px rgba(20,15,12,0.08), 0 1px 2px rgba(20,15,12,0.06);
    --decor-ball:#B8860B;
  }
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:var(--font-body);
    -webkit-font-smoothing:antialiased;
    padding-bottom:76px;
  }
  a{color:inherit;}
  .num{font-family:var(--font-mono); font-variant-numeric:tabular-nums;}

  header.site{
    position:sticky; top:0; z-index:40;
    background:rgba(var(--bg-rgb),0.88);
    backdrop-filter:blur(10px);
    border-bottom:1px solid var(--line);
    padding:14px 20px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .logo{
    font-family:var(--font-display);
    font-weight:800;
    font-size:22px;
    letter-spacing:0.5px;
    text-decoration:none;
    color:var(--ink);
    display:flex; align-items:center; gap:6px;
  }
  .logo .dot{
    width:9px; height:9px; border-radius:50%;
    background:var(--court);
    display:inline-block;
    animation: pulse-dot 1.8s ease-in-out infinite;
  }
  @keyframes pulse-dot{
    0%, 100%{transform:scale(1); box-shadow:0 0 0 3px var(--court-soft), 0 0 6px rgba(226,68,74,.6);}
    50%{transform:scale(1.25); box-shadow:0 0 0 5px rgba(226,68,74,.15), 0 0 10px rgba(226,68,74,.9);}
  }
  nav.top-nav{display:flex; gap:6px;}
  nav.top-nav a{
    font-size:14px; font-weight:600;
    padding:8px 14px; border-radius:999px;
    text-decoration:none; color:var(--muted);
    transition:background .15s, color .15s;
  }
  nav.top-nav a.active, nav.top-nav a:hover{background:var(--court); color:#fff;}
  .login-btn{
    display:inline-flex; align-items:center; gap:6px;
    font-family:var(--font-body); font-size:12px; font-weight:700; color:var(--ink);
    background:var(--card); border:1px solid var(--line); border-radius:999px;
    padding:6px 12px; cursor:pointer;
  }
  .login-btn:hover{border-color:var(--court);}
  .user-chip{
    width:28px; height:28px; border-radius:50%; overflow:hidden; cursor:pointer;
    border:1px solid var(--line); flex:none;
  }
  .user-chip img{width:100%; height:100%; object-fit:cover;}
  .user-chip-fallback{
    width:100%; height:100%; display:flex; align-items:center; justify-content:center;
    background:var(--court); color:#fff; font-weight:800; font-size:13px;
  }
  .admin-back-link{
    display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700;
    color:var(--muted); text-decoration:none; margin-bottom:12px;
  }
  .admin-back-link:hover{color:var(--ink);}
  .user-count-strip{
    text-align:center; font-family:var(--font-mono); font-size:11px; color:var(--muted);
    padding:6px; border-bottom:1px solid var(--line);
  }
  .active-count-badge{
    position:fixed; bottom:78px; right:16px; z-index:50;
    display:flex; align-items:center; gap:7px;
    background:var(--card); border:1px solid var(--line); border-radius:999px;
    padding:9px 15px; font-family:var(--font-mono); font-size:12.5px; font-weight:700; color:var(--ink);
    box-shadow:var(--shadow);
  }
  @media(min-width:641px){ .active-count-badge{bottom:16px;} }

  .tg-banner{
    display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;
    background:linear-gradient(135deg, #26A5E4, #1B87BF);
    border-radius:16px; padding:16px 20px; margin:16px 0 22px;
    text-decoration:none; color:#fff;
    box-shadow:0 8px 20px rgba(38,165,228,.3);
  }
  .tg-banner-text{display:flex; align-items:center; gap:12px;}
  .tg-banner-text svg{flex:none;}
  .tg-banner-title{font-weight:800; font-size:15px;}
  .tg-banner-sub{font-size:12.5px; opacity:.9;}
  .tg-banner-cta{
    font-size:13px; font-weight:700; background:rgba(255,255,255,.2);
    border-radius:999px; padding:8px 16px; flex:none; white-space:nowrap;
  }

  main{max-width:980px; margin:0 auto; padding:24px 20px 60px;}

  /* Decoración de mesa + pelota — SOLO en desktop ancho (1400px+),
     donde sobra espacio vacío a los lados del contenido (980px
     máximo). display:none por defecto cubre mobile/tablet/laptops
     angostas sin depender de que el navegador soporte bien la media
     query — si algo falla, el default seguro es "oculto". */
  .table-decor{
    display:none; position:fixed; top:50%; transform:translateY(-50%);
    width:200px; height:500px; z-index:1; pointer-events:none;
  }
  .table-decor-left{left:0;}
  .table-decor-right{right:0; transform:translateY(-50%) scaleX(-1);}
  @media (min-width:1400px){
    .table-decor{display:block;}
  }
  .view{display:none;}
  .view.active{display:block; animation:fade .35s ease;}
  @keyframes fade{from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:none;}}

  h1.page-title{
    font-family:var(--font-display); font-weight:800;
    font-size:38px; line-height:1; letter-spacing:.3px;
    margin:4px 0 4px;
  }
  .page-sub{color:var(--muted); font-size:14px; margin-bottom:22px;}
  .eyebrow{
    font-family:var(--font-mono); font-size:11px; letter-spacing:1.5px;
    text-transform:uppercase; color:var(--court); font-weight:600;
  }

  .stat-strip{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0 26px;}
  .stat-strip-4{grid-template-columns:repeat(4,1fr);}
  .stat-strip-3{grid-template-columns:repeat(3,1fr);}
  .stat-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow);
  }
  .stat-card .label{font-size:12px; color:var(--muted); margin-bottom:4px;}
  .stat-card .value{font-family:var(--font-mono); font-size:20px; font-weight:600;}
  .stat-card .value.hit{color:var(--hit);}
  .stat-card .value.miss{color:var(--miss);}

  .standings-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow); margin-bottom:14px;
  }
  .standings-head{
    font-family:var(--font-mono); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    color:var(--court); padding-bottom:10px; margin-bottom:6px; border-bottom:1px solid var(--line);
  }
  .standings-avatar{width:28px; height:28px; font-size:10px;}
  .group-table-wrap{overflow-x:auto;}
  table.group-table{width:100%; border-collapse:collapse; font-size:12.5px; white-space:nowrap;}
  table.group-table th{
    text-align:center; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:var(--muted);
    padding:6px 8px; border-bottom:1px solid var(--line); font-weight:700;
  }
  table.group-table td{padding:7px 8px; border-bottom:1px solid var(--line); text-align:center;}
  table.group-table tr:last-child td{border-bottom:none;}
  .group-player-name{text-align:left !important; font-weight:600; font-size:13px;}
  .group-self{color:var(--muted);}

  .greeting-hi{font-family:var(--font-display); font-weight:800; font-size:28px; line-height:1.1;}
  .greeting-date{color:var(--muted); font-size:13px; text-transform:capitalize; margin-top:2px;}
  .bell-btn{
    background:var(--card); border:1px solid var(--line); border-radius:50%;
    width:32px; height:32px; cursor:pointer; font-size:14px; color:var(--ink);
    display:flex; align-items:center; justify-content:center;
  }
  .bell-btn:hover{border-color:var(--court);}
  .featured-avatar{
    width:64px; height:64px; border-radius:14px; flex:none; object-fit:cover; overflow:hidden;
    border:2px solid rgba(255,255,255,.18); box-shadow:0 4px 14px rgba(0,0,0,.4);
  }
  .btn{
    font-family:var(--font-body); font-weight:700; font-size:14px;
    border:none; border-radius:999px; padding:10px 18px; cursor:pointer;
    display:inline-flex; align-items:center; gap:6px;
    transition:transform .12s ease;
  }
  .btn:hover{transform:translateY(-1px);}
  .btn-ball{background:var(--court); color:#fff;}
  .btn-ghost{background:var(--bg-alt); color:var(--ink); border:1px solid var(--line);}

  .section-head{display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 14px;}
  .section-head h2{font-family:var(--font-display); font-size:22px; font-weight:700; margin:0;}
  .see-all{font-size:13px; font-weight:700; color:var(--court); text-decoration:none;}

  .pick-grid{display:grid; gap:12px;}
  .pick-card, .match-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:16px; box-shadow:var(--shadow); cursor:pointer; position:relative;
    transition:border-color .15s, transform .12s;
  }
  /* .pick-card vive dentro de .pick-grid, que ya trae su propio gap
     — el margin va solo en .match-card, que se usa suelto (Calendario
     e Inicio "En vivo ahora") sin ningún contenedor con gap. */
  .match-card{margin-bottom:10px;}
  .pick-card:hover, .match-card:hover{border-color:var(--court); transform:translateY(-1px);}
  .pick-card-featured{border-color:var(--court); box-shadow:0 8px 22px rgba(226,68,74,.18);}
  .follow-btn{
    position:absolute; top:12px; right:12px; z-index:2;
    background:none; border:none; cursor:pointer; padding:4px;
    font-size:20px; line-height:1; color:var(--muted);
    transition:color .15s, transform .12s;
  }
  .follow-btn:hover{transform:scale(1.15);}
  .follow-btn.active{color:var(--ball);}

  .pc-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding-right:24px;}
  .pc-head-right{display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;}
  .pc-meta{font-size:11px; color:var(--muted); font-family:var(--font-mono);}
  .tier-badge{
    font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.3px;
    padding:4px 9px; border-radius:999px; white-space:nowrap;
  }
  .tier-badge.tier-alta{background:rgba(93,202,165,.16); color:var(--hit);}
  .tier-badge.tier-media{background:rgba(255,193,7,.16); color:#FFC845;}
  .tier-badge.tier-baja{background:var(--bg-alt); color:var(--muted);}
  .tier-badge.tier-featured{background:rgba(255,122,69,.18); color:var(--ball);}

  .pc-vs{display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:12px;}
  .pc-player{display:flex; flex-direction:column; align-items:center; gap:6px; flex:1; min-width:0;}
  .pc-player-name{font-size:12.5px; font-weight:700; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;}
  .pc-vs-badge{
    font-family:var(--font-display); font-weight:800; font-size:13px; color:var(--muted);
    flex:none;
  }
  .pc-vs-live{
    color:var(--court); font-size:17px; background:var(--court-soft); border-radius:8px; padding:3px 10px;
  }
  .avatar{
    width:56px; height:56px; border-radius:50%; flex:none;
    display:flex; align-items:center; justify-content:center;
    font-family:var(--font-display); font-weight:800; font-size:16px; color:#fff;
    position:relative; overflow:hidden;
    background:linear-gradient(150deg, var(--tone,var(--court)), #14100F 130%);
    border:2px solid rgba(255,255,255,.1);
  }
  .avatar img{width:100%; height:100%; object-fit:cover; display:block;}
  .avatar::after{
    content:""; position:absolute; inset:0; border-radius:50%;
    background:linear-gradient(155deg, rgba(255,255,255,.16), transparent 55%);
    pointer-events:none;
  }

  /* Seguidos: tarjeta con foto grande de un solo jugador (el
     favorito), estilo picks de otra app pedido tal cual por
     referencia — distinta de PickCard (que muestra a los dos
     jugadores lado a lado con "VS"), solo se usa en esta vista. */
  .followed-grid{display:grid; grid-template-columns:repeat(2,1fr); gap:10px;}
  @media (min-width:641px){
    .followed-grid{grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));}
  }
  .followed-card{
    background:var(--card); border:1px solid var(--line); border-radius:14px;
    overflow:hidden; cursor:pointer; box-shadow:var(--shadow);
    transition:border-color .15s, transform .12s;
  }
  .followed-card:hover{border-color:var(--court); transform:translateY(-1px);}
  .followed-photo{
    position:relative; width:100%; aspect-ratio:1/1;
    background:linear-gradient(150deg, var(--court), #14100F 130%);
    display:flex; align-items:center; justify-content:center;
  }
  .followed-photo img{width:100%; height:100%; object-fit:cover; display:block;}
  .followed-photo-initials{font-family:var(--font-display); font-weight:800; font-size:26px; color:#fff;}
  .followed-star{
    position:absolute; top:6px; left:6px; z-index:2; margin:0;
    width:24px; height:24px; border-radius:50%; background:rgba(14,13,12,.55);
    display:flex; align-items:center; justify-content:center; font-size:14px;
  }
  .followed-flag-badge{
    position:absolute; bottom:6px; left:6px; width:22px; height:22px; border-radius:50%;
    background:rgba(14,13,12,.7); display:flex; align-items:center; justify-content:center; font-size:11px;
  }
  .followed-result-badge{
    position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; font-weight:800;
    border:2px solid rgba(255,255,255,.25);
  }
  .followed-result-badge.hit{background:#22C55E; box-shadow:0 0 0 1px rgba(34,197,94,.35), 0 2px 8px rgba(34,197,94,.5);}
  .followed-result-badge.miss{background:#EF4444; box-shadow:0 0 0 1px rgba(239,68,68,.35), 0 2px 8px rgba(239,68,68,.5);}
  .followed-result-badge.live{background:rgba(14,13,12,.7);}
  .followed-body{padding:9px 10px;}
  .followed-tournament{display:block; font-size:9px; color:var(--muted); text-transform:uppercase; letter-spacing:.3px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .followed-name{display:block; font-size:13px; font-weight:800; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .followed-meta{display:block; font-size:10.5px; color:var(--muted); margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .followed-pill{
    display:inline-block; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.2px;
    padding:4px 8px; border-radius:20px; margin-bottom:8px; max-width:100%;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .followed-pill.pending{background:var(--court-soft); color:var(--court-soft-text);}
  .followed-pill.hit{background:rgba(60,179,113,.16); color:var(--hit);}
  .followed-pill.miss{background:rgba(226,68,74,.16); color:var(--miss);}
  .followed-bar-row{display:flex; align-items:center; gap:6px;}
  .followed-bar-track{flex:1; height:4px; border-radius:99px; background:var(--bg-alt); overflow:hidden;}
  .followed-bar-fill{height:100%; border-radius:99px; background:#E0A030;}
  .followed-bar-fill.hit{background:#22C55E;}
  .followed-bar-fill.miss{background:#EF4444;}
  .followed-bar-val{font-size:10.5px; color:var(--muted); flex:none;}

  .pc-stats-row{display:flex; gap:18px; justify-content:center; margin-bottom:12px; padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line);}
  .pc-stat{display:flex; flex-direction:column; align-items:center; gap:2px;}
  .pc-stat .l{font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px;}
  .pc-stat .v{font-size:13px; font-weight:700;}

  .pc-ia-row{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px;}
  .pc-ia-label{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.4px;}
  .pc-ia-val{font-size:15px; font-weight:800;}
  .ia-bar-track{height:6px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin-bottom:14px;}
  .ia-bar-fill{height:100%; border-radius:999px;}
  .ia-bar-fill.tier-alta{background:var(--hit);}
  .ia-bar-fill.tier-media{background:#FFC845;}
  .ia-bar-fill.tier-baja{background:var(--muted);}

  .pc-foot{display:flex; align-items:center; justify-content:space-between; gap:10px;}
  .odd-mini{font-family:var(--font-mono); font-size:13px; color:var(--muted); font-weight:600;}
  .result-pill{font-size:11px; font-weight:800; padding:4px 10px; border-radius:999px;}
  .result-pill.hit{background:rgba(93,202,165,.16); color:var(--hit);}
  .result-pill.miss{background:rgba(240,149,149,.16); color:var(--miss);}
  .flag{font-size:11px;}

  .mc-head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; padding-right:24px;}
  .mc-score{text-align:center; font-size:13px; font-weight:700; margin-top:2px;}

  .day-strip{display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:18px;}
  .day-chip{
    flex:none; display:flex; flex-direction:column; align-items:center; gap:4px;
    background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:10px 14px; text-decoration:none; color:var(--muted); min-width:52px;
  }
  .day-chip.active{background:var(--court); border-color:var(--court); color:#fff;}
  .day-chip-weekday{font-size:10.5px; font-weight:700; text-transform:uppercase;}
  .day-chip-num{font-size:15px; font-weight:800;}

  .match-filter-row{display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;}
  .match-filter-btn{
    font-family:var(--font-mono); font-size:11px; font-weight:700; letter-spacing:.4px;
    padding:8px 14px; border-radius:999px; border:1px solid var(--line); background:var(--card);
    color:var(--muted); cursor:pointer; display:flex; align-items:center; gap:6px;
  }
  .match-filter-btn.active{background:var(--court); border-color:var(--court); color:#fff;}
  .live-dot{
    display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--court);
    animation:pulse-dot 1.8s ease-in-out infinite;
  }

  .balance-hero{
    background:linear-gradient(135deg, var(--court), var(--court-dark));
    border-radius:20px; padding:20px 22px; margin:16px 0; color:#fff;
    box-shadow:0 10px 24px rgba(226,68,74,.3);
  }
  .balance-hero-label{font-size:12px; opacity:.85; margin-bottom:4px;}
  .balance-hero-value{font-family:var(--font-display); font-weight:800; font-size:32px;}
  .balance-hero-value.hit, .balance-hero-value.miss{color:#fff;}

  /* Mi Bankroll → "Rendimiento": tarjeta con el resultado neto +
     tasa de acierto al lado, y la mini-barra de precisión semanal —
     pedido tal cual por referencia de otra app. */
  .rendimiento-top{display:flex; align-items:flex-start; justify-content:space-between; gap:14px;}
  .rendimiento-label{font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:6px;}
  .rendimiento-value{font-family:var(--font-display); font-weight:800; font-size:28px;}
  .rendimiento-value.hit{color:var(--hit);}
  .rendimiento-value.miss{color:var(--miss);}
  .rendimiento-sub{font-size:12.5px; color:var(--muted); margin-top:4px;}
  .rendimiento-sub .hit{color:var(--hit);}
  .rendimiento-sub .miss{color:var(--miss);}
  .rendimiento-tasa{
    flex:none; text-align:center; padding:10px 14px; border-radius:14px;
    background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.3);
  }
  .rendimiento-tasa-label{display:block; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.3px; color:#22C55E; margin-bottom:3px; white-space:nowrap;}
  .rendimiento-tasa-val{display:block; font-size:19px; font-weight:800; color:#22C55E;}

  .week-precision-row{display:flex; justify-content:space-between; gap:6px; margin-top:14px; height:70px;}
  .week-precision-col{display:flex; flex-direction:column; align-items:center; justify-content:flex-end; flex:1; gap:6px; height:100%;}
  .week-precision-track{width:100%; max-width:22px; flex:1; display:flex; align-items:flex-end; background:var(--bg-alt); border-radius:6px; overflow:hidden;}
  .week-precision-fill{width:100%; border-radius:6px; background:var(--line);}
  .week-precision-fill.hit{background:#22C55E;}
  .week-precision-fill.miss{background:#EF4444;}
  .week-precision-day{font-size:10px; color:var(--muted); text-transform:uppercase;}

  .slip-label{font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin-bottom:8px;}
  .slip-bank-row{display:flex; align-items:baseline; gap:6px; margin-bottom:12px;}
  .slip-bank-currency{font-family:var(--font-display); font-weight:800; font-size:28px; color:var(--ink);}
  .slip-bank-input{
    flex:1; min-width:0; font-family:var(--font-display); font-weight:800; font-size:28px; color:var(--ink);
    background:none; border:none; border-bottom:2px solid var(--line); padding:2px 0; outline:none;
  }
  .slip-bank-input:focus{border-color:var(--court);}
  .slip-bank-tag{font-family:var(--font-mono); font-size:11px; color:var(--muted); background:var(--bg-alt); border-radius:999px; padding:3px 9px; flex:none;}
  .slip-asignado-row{display:flex; justify-content:space-between; font-size:13px; color:var(--muted); margin-bottom:6px;}
  .risk-level-row{display:grid; grid-template-columns:repeat(3,1fr); gap:8px;}
  .risk-level-btn{
    background:var(--bg-alt); border:1px solid var(--line); border-radius:12px; padding:10px 6px;
    text-align:center; cursor:pointer;
  }
  .risk-level-btn.active{background:var(--court); border-color:var(--court);}
  .risk-level-label{font-size:12.5px; font-weight:700; color:var(--ink);}
  .risk-level-sub{font-size:10.5px; color:var(--muted); margin-top:2px;}
  .risk-level-btn.active .risk-level-sub{color:rgba(255,255,255,.85);}

  .donut-row{display:flex; align-items:center; gap:18px; margin-bottom:6px;}
  .donut{width:96px; height:96px; flex:none;}
  .donut-pct{font-family:var(--font-mono); font-size:17px; font-weight:800;}
  .donut-sub{font-size:9px;}
  .h2h-bar-track{height:8px; border-radius:999px; background:var(--bg-alt); overflow:hidden; margin:6px 0 16px;}
  .h2h-bar-fill{height:100%; border-radius:999px; background:var(--hit);}
  .line-chart{width:100%; height:120px; margin-top:10px;}

  .tabs{display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;}
  .tab{
    font-size:13px; font-weight:700; padding:8px 16px; border-radius:999px;
    border:1px solid var(--line); background:var(--card); cursor:pointer; color:var(--muted);
    display:inline-flex; align-items:center; gap:6px;
  }
  .tab.active{background:var(--court); color:#fff; border-color:var(--court);}

  .status{font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; flex:none;}
  .status.live{background:rgba(226,68,74,.18); color:var(--court); border:1px solid rgba(226,68,74,.5);}
  .status.soon{background:var(--court-soft); color:var(--court-soft-text);}
  .status.done{background:var(--bg-alt); color:var(--muted);}

  .mc-live-score{
    display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;
    margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  }
  .mc-set{
    background:var(--bg-alt); border-radius:8px; padding:5px 10px; font-size:13px; font-weight:700; color:var(--ink);
  }
  .mc-set-current{background:var(--court-soft); color:var(--court-soft-text); border:1px solid rgba(226,68,74,.45);}
  .mc-live-loading{font-size:12px; color:var(--muted);}
  .mc-live-score-small{margin-top:8px; padding-top:8px; gap:5px;}
  .mc-live-score-small .mc-set{padding:3px 7px; font-size:11px; background:transparent; border:1px solid var(--line); color:var(--muted);}

  .live-clock{
    font-family:var(--font-mono); font-size:13px; color:var(--ball); font-weight:700;
    margin:12px 0 4px;
  }
  .live-sets-grid{display:flex; flex-wrap:wrap; gap:10px; margin:12px 0;}
  .live-set-col{
    background:var(--bg-alt); border-radius:10px; padding:10px 14px; text-align:center; min-width:64px;
  }
  .live-set-col.current{background:var(--court-soft); border:1px solid rgba(226,68,74,.45);}
  .live-set-label{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px;}
  .live-set-score{font-family:var(--font-mono); font-size:18px; font-weight:700; color:var(--ink);}

  .live-chat{margin-top:18px; border-top:1px solid var(--line); padding-top:14px;}
  .live-chat-list{
    display:flex; flex-direction:column; gap:10px;
    max-height:220px; overflow-y:auto; margin-bottom:10px;
  }
  .live-chat-msg{display:flex; align-items:flex-start; gap:8px;}
  .live-chat-avatar{width:26px; height:26px; border-radius:50%; flex:none; overflow:hidden;}
  .live-chat-avatar-fallback{
    width:100%; height:100%; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    background:var(--court); color:#fff; font-size:11px; font-weight:800;
  }
  .live-chat-name{font-size:11px; font-weight:700; color:var(--muted); display:flex; align-items:center; gap:6px;}
  .level-badge{
    font-family:var(--font-mono); font-size:9.5px; font-weight:800;
    padding:1px 6px; border-radius:999px; letter-spacing:.3px;
  }
  .level-badge.tier-new{background:var(--bg-alt); color:var(--muted);}
  .level-badge.tier-active{background:rgba(93,202,165,.15); color:var(--hit);}
  .level-badge.tier-fan{background:rgba(255,122,69,.18); color:var(--ball);}
  .level-badge.tier-legend{background:linear-gradient(135deg, #FFD700, #FF7A45); color:#1a1a1a;}
  .live-chat-text{font-size:13.5px; color:var(--ink); line-height:1.4; word-break:break-word;}
  .live-chat-form{display:flex; gap:8px;}
  .live-chat-form input{
    flex:1; min-width:0; background:var(--bg-alt); border:1px solid var(--line); border-radius:999px;
    padding:9px 14px; color:var(--ink); font-family:var(--font-body); font-size:13px;
  }
  .live-chat-form input:focus{outline:none; border-color:var(--court);}
  .live-chat-form button{
    font-family:var(--font-body); font-weight:700; font-size:13px; color:#fff;
    background:var(--court); border:none; border-radius:999px; padding:9px 16px; cursor:pointer;
  }
  .live-chat-form button:disabled{opacity:.5; cursor:not-allowed;}

  .bankroll-card{background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); margin-bottom:18px;}
  table.bk{width:100%; border-collapse:collapse; font-size:13.5px;}
  table.bk th{text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); border-bottom:1px solid var(--line); padding:8px 6px;}
  table.bk td{padding:9px 6px; border-bottom:1px solid var(--line); font-family:var(--font-mono);}
  table.bk td.hit{color:var(--hit); font-weight:700;}
  table.bk td.miss{color:var(--miss); font-weight:700;}

  #overlay{
    position:fixed; inset:0; background:rgba(0,0,0,.65); backdrop-filter:blur(2px);
    display:flex; align-items:flex-end; justify-content:center; z-index:100;
  }
  .modal{
    background:var(--card); width:100%; max-width:480px; border-radius:20px 20px 0 0;
    padding:22px 22px 26px; max-height:88vh; overflow-y:auto; position:relative;
    animation:slideup .25s ease;
  }
  @media(min-width:640px){
    #overlay{align-items:center;}
    .modal{border-radius:20px; margin-bottom:0;}
  }
  @keyframes slideup{from{transform:translateY(30px); opacity:0;} to{transform:none; opacity:1;}}
  .modal-head{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;}
  .modal-close{
    background:var(--bg-alt); border:1px solid var(--line); width:30px; height:30px; border-radius:50%;
    cursor:pointer; font-size:16px; color:var(--muted);
  }
  .modal h3{font-family:var(--font-display); font-size:24px; margin:2px 0 2px; color:var(--ink);}
  .modal .sub{color:var(--muted); font-size:13px;}
  .subscreen-head{display:flex; align-items:center; gap:12px; margin-bottom:14px;}
  .subscreen-back{
    background:var(--bg-alt); border:1px solid var(--line); width:32px; height:32px; border-radius:50%;
    cursor:pointer; color:var(--ink); flex:none; display:flex; align-items:center; justify-content:center;
  }
  .subscreen-head h3{font-size:19px; margin:0;}

  .risk-modal-banner{
    padding:12px 22px 26px;
    margin:-22px -22px 18px; border-radius:20px 20px 0 0;
    background:radial-gradient(120% 140% at 0% 0%, #E2444A 0%, #7A1418 55%, #2A0A0B 100%);
    color:#fff;
  }
  @media(min-width:640px){ .risk-modal-banner{border-radius:20px 20px 0 0;} }
  .risk-modal-handle{width:36px; height:4px; border-radius:99px; background:rgba(255,255,255,.35); margin:0 auto 18px;}
  .risk-modal-banner-row{display:flex; align-items:center; gap:14px;}
  .risk-modal-icon{
    width:48px; height:48px; border-radius:12px; flex:none; font-size:21px;
    display:flex; align-items:center; justify-content:center;
    background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.35);
  }
  .risk-modal-eyebrow{font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:rgba(255,255,255,.75); margin-bottom:3px;}
  .risk-modal-banner h3{color:#fff; margin:0;}
  .risk-tip-list{display:flex; flex-direction:column;}
  .risk-tip{display:flex; gap:12px; padding:14px 0; border-top:1px solid var(--line);}
  .risk-tip:first-child{border-top:none; padding-top:2px;}
  .risk-tip-icon{
    font-size:18px; flex:none; width:38px; height:38px; border-radius:11px;
    display:flex; align-items:center; justify-content:center;
    background:var(--court-soft); border:1px solid rgba(226,68,74,.35);
  }
  .risk-tip strong{display:block; font-size:14px; margin-bottom:3px;}
  .risk-tip p{margin:0; font-size:13px; color:var(--muted); line-height:1.5;}
  .risk-modal-btn{width:100%; justify-content:center; margin-top:16px; padding:13px;}
  .risk-modal-disclaimer{font-size:11px; color:var(--muted); text-align:center; margin:10px 0 0;}
  .risk-modal-disclaimer a{color:var(--court);}

  .consent-tip-col{display:flex; flex-direction:column; align-items:center; gap:4px; flex:none; width:40px;}
  .consent-tip-icon{
    width:40px; height:40px; border-radius:50%; background:var(--bg-alt); border:1px solid var(--line);
    display:flex; align-items:center; justify-content:center; color:var(--ink);
  }
  .consent-tip-num{font-family:var(--font-mono); font-size:10px; color:var(--muted);}

  .profile-row{display:flex; align-items:center; gap:12px; padding:14px 0; border-top:1px solid var(--line); cursor:pointer; text-decoration:none; color:inherit;}
  .profile-plan-line{font-size:12px; color:var(--muted); margin-top:2px;}
  .profile-section-label{
    font-family:var(--font-mono); font-size:11px; font-weight:700; letter-spacing:.6px;
    text-transform:uppercase; color:var(--muted); margin:20px 0 2px;
  }
  .trial-banner{
    background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.35); color:var(--ink);
    border-radius:14px; padding:12px 16px; font-size:13px; line-height:1.5; margin:14px 0;
  }

  .upgrade-card{
    width:100%; display:flex; align-items:center; gap:12px; text-align:left; margin-top:14px;
    background:var(--bg-alt); border:1px solid var(--line); border-radius:14px; padding:14px; cursor:pointer;
  }
  .upgrade-card-icon{
    width:36px; height:36px; border-radius:10px; flex:none; color:#FFC845;
    display:flex; align-items:center; justify-content:center;
    background:rgba(255,193,7,.14); border:1px solid rgba(255,193,7,.35);
  }
  .upgrade-card-body{flex:1; min-width:0; display:flex; flex-direction:column; gap:1px;}
  .upgrade-card-body strong{font-size:13.5px; color:var(--ink);}
  .upgrade-card-body span{font-size:12px; color:var(--muted);}
  .upgrade-card-cta{
    flex:none; font-size:12px; font-weight:700; color:var(--ink);
    background:var(--card); border:1px solid var(--line); border-radius:999px; padding:7px 12px;
  }

  .plans-modal{ padding:0 22px 26px; }
  .plans-modal-banner{
    padding:22px 22px 24px;
    margin:0 -22px 18px; border-radius:20px 20px 0 0;
    background:radial-gradient(120% 140% at 0% 0%, #3a3a3a 0%, #17171a 55%, #050505 100%);
    color:#fff;
  }
  .plans-modal-banner .subscreen-back{ background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.3); color:#fff; }
  .plans-bullet-list{ list-style:none; margin:6px 0 0; padding:0; display:flex; flex-direction:column; gap:10px; }
  .plans-bullet-list li{ display:flex; align-items:center; gap:10px; font-size:13.5px; color:rgba(255,255,255,.92); }
  .plans-bullet-list li svg{ flex:none; color:#FFC845; }
  .plans-toggle{
    display:flex; background:var(--bg-alt); border:1px solid var(--line); border-radius:999px; padding:4px; gap:4px; margin-bottom:16px;
  }
  .plans-toggle-btn{
    flex:1; border:none; background:transparent; color:var(--muted); font-size:13px; font-weight:700;
    padding:9px 10px; border-radius:999px; cursor:pointer;
  }
  .plans-toggle-btn.active{ background:var(--ink); color:var(--card); }
  .plans-price-block{ padding-bottom:14px; margin-bottom:14px; border-bottom:1px solid var(--line); }
  .plans-price-row{ display:flex; align-items:baseline; gap:4px; }
  .plans-price-big{ font-family:var(--font-display); font-size:30px; color:var(--ink); }
  .plans-price-period{ font-size:13px; color:var(--muted); }
  .plans-price-savings{ font-size:12.5px; color:var(--hit); margin-top:2px; }
  .plans-price-original{ text-decoration:line-through; color:var(--muted); margin-right:4px; }
  .plans-price-cancel{ font-size:12px; color:var(--muted); margin-top:4px; }
  .plans-card{ position:relative; border:1px solid var(--line); border-radius:16px; padding:18px; background:var(--bg-alt); }
  .plans-card-badge{
    position:absolute; top:-11px; right:16px; font-family:var(--font-mono); font-size:10px; font-weight:700;
    letter-spacing:.5px; text-transform:uppercase; color:#3a2a00; background:#FFC845; border-radius:999px; padding:5px 10px;
  }
  .plans-card-head{ display:flex; align-items:center; gap:12px; margin-bottom:14px; }
  .plans-card-icon{
    width:42px; height:42px; border-radius:12px; flex:none; color:#FFC845;
    display:flex; align-items:center; justify-content:center;
    background:rgba(255,193,7,.14); border:1px solid rgba(255,193,7,.35);
  }
  .plans-card-head strong{ display:block; font-size:16px; color:var(--ink); }
  .plans-card-head span{ font-size:12.5px; color:var(--muted); }
  .plans-feature-list{ display:flex; flex-direction:column; }
  .plans-feature-row{
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:10px 0; border-top:1px solid var(--line); font-size:13.5px; color:var(--ink);
  }
  .plans-feature-row:first-child{ border-top:none; }
  .plans-feature-row svg{ color:var(--hit); flex:none; }
  .plans-cta-btn{ width:100%; justify-content:center; margin-top:18px; padding:14px; font-size:14.5px; }
  .plans-cta-note{ font-size:11.5px; color:var(--muted); text-align:center; line-height:1.5; margin:10px 0 0; }

  .profile-head-clickable{ flex:1; min-width:0; margin-right:10px; }
  .profile-head-clickable svg{ flex:none; color:var(--muted); margin-left:auto; }

  .account-avatar-block{ display:flex; flex-direction:column; align-items:center; gap:8px; margin:6px 0 20px; }
  .account-avatar-wrap{ position:relative; width:72px; height:72px; }
  .account-avatar-wrap > div{
    width:72px; height:72px; border-radius:50%; background:var(--court); color:#fff;
    font-weight:800; font-size:24px;
  }
  .account-avatar-camera{
    position:absolute; bottom:-2px; right:-2px; width:26px; height:26px; border-radius:50%;
    background:var(--ink); color:var(--card); border:2px solid var(--card);
    display:flex; align-items:center; justify-content:center; cursor:pointer;
  }
  .account-avatar-block span{ font-size:12.5px; font-weight:700; color:var(--muted); }

  .account-info-card{ border:1px solid var(--line); border-radius:16px; padding:0 14px; margin-bottom:18px; }
  .account-info-row{ display:flex; align-items:flex-start; gap:12px; padding:14px 0; border-top:1px solid var(--line); }
  .account-info-row:first-child{ border-top:none; }
  .account-info-row .profile-row-body p{ font-size:11.5px; color:var(--muted); text-transform:uppercase; letter-spacing:.3px; }
  .account-info-row .profile-row-body strong{ font-size:14px; color:var(--ink); word-break:break-word; }
  .account-id-value{ font-family:var(--font-mono); font-size:12px !important; }
  .account-edit-btn{
    flex:none; align-self:center; font-size:12px; font-weight:700; color:var(--ink);
    background:var(--bg-alt); border:1px solid var(--line); border-radius:999px; padding:7px 12px; cursor:pointer;
  }

  .del-account-trigger-btn{ width:100%; justify-content:center; margin-top:8px; color:#B3261E; border-color:rgba(179,38,30,.35); }

  .del-item-list{ display:flex; flex-direction:column; gap:10px; margin-bottom:18px; }
  .del-item{
    display:flex; gap:12px; padding:14px; border-radius:14px;
    background:var(--court-soft); border:1px solid rgba(226,68,74,.25);
  }
  .del-item-icon{
    flex:none; width:36px; height:36px; border-radius:10px; color:#B3261E;
    display:flex; align-items:center; justify-content:center;
    background:rgba(226,68,74,.14); border:1px solid rgba(226,68,74,.3);
  }
  .del-item strong{ display:block; font-size:13.5px; color:#B3261E; margin-bottom:3px; }
  .del-item p{ margin:0; font-size:12.5px; color:var(--muted); line-height:1.45; }

  .del-checkbox-row{
    display:flex; align-items:flex-start; gap:10px; padding:14px; border:1px solid var(--line);
    border-radius:14px; cursor:pointer; margin-bottom:14px; font-size:13px; color:var(--ink); line-height:1.45;
  }
  .del-checkbox-row input{ margin-top:2px; flex:none; width:16px; height:16px; }

  .del-type-block{ margin-bottom:18px; }
  .del-type-block label{ display:block; font-size:12.5px; font-weight:700; color:var(--muted); margin-bottom:8px; }

  .btn-danger{ background:#B3261E; color:#fff; }
  .btn-danger:disabled{ opacity:.4; cursor:not-allowed; transform:none !important; }

  .profile-row-icon{
    width:40px; height:40px; border-radius:50%; flex:none;
    display:flex; align-items:center; justify-content:center;
    background:var(--bg-alt); border:1px solid var(--line); color:var(--ink);
  }
  .profile-row-body{flex:1; min-width:0;}
  .profile-row-body strong{display:block; font-size:14px; margin-bottom:2px;}
  .profile-row-body p{margin:0; font-size:12.5px; color:var(--muted); line-height:1.4;}
  .profile-row-theme{cursor:default;}
  .theme-option-list{display:flex; flex-direction:column; gap:8px; margin-top:12px;}
  .theme-option{
    display:flex; align-items:center; gap:12px; padding:12px; border-radius:12px;
    background:var(--bg-alt); border:1px solid var(--line); cursor:pointer;
  }
  .theme-option.active{border-color:var(--court); background:var(--court-soft);}
  .theme-option-icon{
    width:34px; height:34px; border-radius:10px; flex:none; color:var(--ink);
    display:flex; align-items:center; justify-content:center;
    background:var(--card); border:1px solid var(--line);
  }
  .theme-option-body{flex:1; min-width:0; display:flex; flex-direction:column; gap:1px;}
  .theme-option-body strong{font-size:13.5px; color:var(--ink);}
  .theme-option-body span{font-size:11.5px; color:var(--muted);}
  .theme-option-radio{
    width:20px; height:20px; border-radius:50%; flex:none; border:2px solid var(--line);
    display:flex; align-items:center; justify-content:center; color:#fff;
  }
  .theme-option.active .theme-option-radio{background:var(--court); border-color:var(--court);}

  .theme-preview-row{display:flex; gap:10px; margin-top:14px;}
  .theme-preview-card{flex:1; border-radius:12px; overflow:hidden; border:1px solid var(--line);}
  .theme-preview-light{background:#FDFBFA;}
  .theme-preview-dark{background:#0E0D0C;}
  .theme-preview-head{display:flex; align-items:center; gap:6px; padding:10px;}
  .theme-preview-dot{width:14px; height:14px; border-radius:50%; flex:none;}
  .theme-preview-light .theme-preview-dot{background:#1E1815;}
  .theme-preview-dark .theme-preview-dot{background:#F5F1EC;}
  .theme-preview-line{height:6px; flex:1; border-radius:3px;}
  .theme-preview-light .theme-preview-line{background:#E9E0DB;}
  .theme-preview-dark .theme-preview-line{background:#2B2724;}
  .theme-preview-block{height:28px; margin:0 10px 10px;}
  .theme-preview-light .theme-preview-block{background:#F5EFEC; border-radius:8px;}
  .theme-preview-dark .theme-preview-block{background:#171513; border-radius:8px;}
  .theme-preview-label{display:block; text-align:center; font-size:10.5px; padding:6px 0; font-weight:700;}
  .theme-preview-light .theme-preview-label{color:#1E1815; background:#fff;}
  .theme-preview-dark .theme-preview-label{color:#F5F1EC; background:#1B1917;}

  .faq-list{display:flex; flex-direction:column; gap:8px; margin-top:10px;}
  .faq-category{border-radius:12px; background:var(--bg-alt); border:1px solid var(--line); overflow:hidden;}
  .faq-category-head{
    display:flex; align-items:center; gap:10px; padding:12px; cursor:pointer;
  }
  .faq-category-icon{
    width:30px; height:30px; border-radius:9px; flex:none; color:var(--ink);
    display:flex; align-items:center; justify-content:center;
    background:var(--card); border:1px solid var(--line);
  }
  .faq-category-title{flex:1; min-width:0; font-size:13.5px; color:var(--ink);}
  .faq-category-count{
    font-size:11px; color:var(--muted); background:var(--card); border:1px solid var(--line);
    border-radius:20px; padding:1px 8px; flex:none;
  }
  .faq-chevron{display:flex; color:var(--muted); transition:transform .15s ease; flex:none;}
  .faq-chevron.open{transform:rotate(180deg); color:var(--ink);}
  .faq-items{display:flex; flex-direction:column; border-top:1px solid var(--line);}
  .faq-item{border-top:1px solid var(--line);}
  .faq-item:first-child{border-top:none;}
  .faq-item-q{
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:11px 12px 11px 52px; cursor:pointer; font-size:13px; color:var(--ink);
  }
  .faq-item-a{
    margin:0; padding:0 16px 14px 52px; font-size:12.5px; line-height:1.5; color:var(--muted);
  }

  .profile-edit-inline{display:flex; gap:8px; margin-top:8px;}
  .profile-name-input{
    flex:1; min-width:0; background:var(--bg-alt); border:1px solid var(--line); border-radius:10px;
    padding:9px 12px; color:var(--ink); font-family:var(--font-body); font-size:13.5px;
  }
  .profile-name-input:focus{outline:none; border-color:var(--court);}

  .login-modal{text-align:center; padding-top:36px;}
  .login-modal-close{position:absolute; top:16px; right:16px;}
  .login-modal-icon{
    width:64px; height:64px; margin:0 auto 18px; border-radius:50%; font-size:26px;
    display:flex; align-items:center; justify-content:center;
    background:var(--court-soft); border:1px solid rgba(226,68,74,.4);
  }
  .login-modal-title{font-family:var(--font-display); font-size:24px; margin:0 0 8px;}
  .login-modal-sub{color:var(--muted); font-size:14px; margin:0 0 24px;}
  .login-modal-sub strong{color:var(--ink);}
  .onboarding-dots{display:flex; justify-content:center; gap:6px; margin-bottom:22px;}
  .onboarding-dot{width:6px; height:6px; border-radius:50%; background:var(--line);}
  .onboarding-dot.active{background:var(--court); width:18px; border-radius:3px;}
  .google-btn{
    width:100%; display:flex; align-items:center; justify-content:center; gap:12px;
    background:var(--bg-alt); border:1px solid var(--line); border-radius:12px;
    padding:14px; font-family:var(--font-body); font-weight:700; font-size:14.5px; color:var(--ink);
    cursor:pointer;
  }
  .google-btn:hover{border-color:var(--court);}
  .login-modal-note{
    display:flex; align-items:center; justify-content:center; gap:8px; margin-top:20px;
    font-size:12px; color:var(--muted); text-align:left;
  }
  .modal-market{
    display:inline-block; margin:12px 0; font-weight:700; font-size:14px;
    background:var(--court-soft); color:var(--court-soft-text); padding:8px 14px; border-radius:10px;
  }
  .hist-title{font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:18px 0 8px; display:flex; justify-content:space-between;}
  .chart{display:flex; align-items:flex-end; gap:5px; height:90px; border-bottom:1px dashed var(--line); position:relative; margin-bottom:6px;}
  .bar{flex:1; border-radius:4px 4px 0 0; min-height:6px;}
  .bar.hit{background:var(--hit);}
  .bar.miss{background:var(--miss);}
  .form-list{display:flex; flex-direction:column;}
  .form-list-row{display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--line);}
  .form-list-row:last-child{border-bottom:none;}
  .form-list-meta{display:flex; flex-direction:column; align-items:flex-start; gap:1px; width:56px; flex:none;}
  .form-list-date{font-family:var(--font-mono); font-size:10.5px; color:var(--muted);}
  .form-list-ft{font-family:var(--font-mono); font-size:9.5px; color:var(--muted); text-transform:uppercase;}
  .form-list-opp{flex:1; min-width:0; font-size:13px; font-weight:600; display:flex; justify-content:space-between; align-items:center; gap:8px;}
  .form-list-score{color:var(--muted); font-weight:700;}
  .form-list-badge{
    width:22px; height:22px; border-radius:50%; flex:none; font-size:11px; font-weight:800;
    display:flex; align-items:center; justify-content:center;
  }
  .form-list-badge.win{background:rgba(93,202,165,.16); color:var(--hit);}
  .form-list-badge.loss{background:rgba(240,149,149,.16); color:var(--miss);}
  .legend{display:flex; gap:14px; font-size:11.5px; color:var(--muted); margin-bottom:16px;}
  .legend span{display:inline-flex; align-items:center; gap:5px;}
  .legend .sw{width:8px; height:8px; border-radius:50%;}
  .analysis{font-size:13.5px; line-height:1.55; color:var(--ink); background:var(--bg-alt); border-radius:12px; padding:14px; margin-top:6px; border:1px solid var(--line);}
  .analysis p{margin:0 0 10px;}
  .analysis p:last-child{margin-bottom:0;}

  .match-hero{display:flex; align-items:flex-start; justify-content:space-between; gap:6px; margin:4px 0 16px;}
  .match-hero-side{display:flex; flex-direction:column; align-items:center; gap:8px; flex:1; min-width:0;}
  .match-hero-avatar{width:56px; height:56px; font-size:16px;}
  .match-hero-name{
    font-size:12.5px; font-weight:700; text-align:center; display:flex; align-items:center; gap:4px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;
  }
  .match-hero-center{display:flex; flex-direction:column; align-items:center; gap:6px; flex:none; padding-top:8px;}
  .match-hero-score{font-family:var(--font-display); font-size:26px; font-weight:800; color:var(--ink); line-height:1;}
  .match-hero-vs{font-family:var(--font-mono); font-size:14px; font-weight:800; color:var(--muted);}
  .match-hero-meta{font-size:10.5px; color:var(--muted); text-align:center; white-space:nowrap;}
  .match-hero-pill{
    font-size:10.5px; font-weight:800; padding:4px 12px; border-radius:999px;
    text-transform:uppercase; letter-spacing:.4px; text-align:center;
  }
  .match-hero-pill.win{background:rgba(93,202,165,.16); color:var(--hit);}
  .match-hero-pill.loss{background:rgba(240,149,149,.16); color:var(--miss);}
  .match-hero-pill.pending{
    background:var(--court-soft); color:var(--court-soft-text); text-transform:none; font-weight:700; max-width:150px;
    white-space:normal; line-height:1.3;
  }

  .stat-rows{display:flex; flex-direction:column; gap:14px; background:var(--bg-alt); border:1px solid var(--line); border-radius:12px; padding:14px 16px;}
  .stat-row-top{display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px;}
  .stat-row-label{color:var(--muted); font-weight:600;}
  .stat-row-value{color:var(--ink); font-weight:800; font-size:14px;}
  .stat-row-bar{height:6px; border-radius:999px; background:var(--line); overflow:hidden; margin-top:6px;}
  .stat-row-bar-fill{height:100%; border-radius:999px; background:var(--court);}

  .model-verdict{
    font-weight:700; font-size:14px; padding:12px 16px; border-radius:12px; margin:4px 0 22px;
  }
  .model-verdict-better{background:rgba(93,202,165,.14); color:var(--hit);}
  .model-verdict-worse{background:rgba(240,149,149,.14); color:var(--miss);}
  .model-verdict-unknown{background:var(--bg-alt); color:var(--muted); border:1px solid var(--line);}

  .error-row{padding:12px 0; border-bottom:1px solid var(--line);}
  .error-row:last-child{border-bottom:none;}
  .error-row-top{display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:4px;}
  .error-row-source{
    font-family:var(--font-mono); font-size:10.5px; text-transform:uppercase; letter-spacing:.4px;
    color:var(--miss); font-weight:700;
  }
  .error-row-date{font-family:var(--font-mono); font-size:11px; color:var(--muted); flex:none;}
  .error-row-message{font-size:13.5px; color:var(--ink); line-height:1.4;}
  .error-row-context{font-family:var(--font-mono); font-size:11px; color:var(--muted); margin-top:4px; word-break:break-all;}

  footer.site{
    max-width:980px; margin:0 auto; padding:20px 20px 40px; color:var(--muted); font-size:12px; line-height:1.6;
  }
  footer.site strong{color:var(--ink);}
  footer.site a{color:var(--court); text-decoration:none;}

  nav.bottom-nav{
    display:none; position:fixed; bottom:0; left:0; right:0; z-index:50;
    background:var(--card); border-top:1px solid var(--line);
    padding:8px 6px calc(8px + env(safe-area-inset-bottom));
    justify-content:space-around;
  }
  nav.bottom-nav a{
    display:flex; flex-direction:column; align-items:center; gap:3px;
    text-decoration:none; color:var(--muted); font-size:10.5px; font-weight:600; flex:1;
  }
  nav.bottom-nav a.active{color:var(--court);}
  nav.bottom-nav svg{width:20px; height:20px;}
  .premium-lock-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:32px 24px; text-align:center; box-shadow:var(--shadow);
  }
  .premium-lock-icon{
    width:56px; height:56px; border-radius:50%; margin:0 auto 14px;
    display:flex; align-items:center; justify-content:center;
    background:var(--court-soft); color:var(--court); border:1px solid rgba(226,68,74,.4);
  }
  .premium-lock-card h3{font-family:var(--font-display); font-size:19px; margin:0 0 8px;}
  .premium-lock-card p{color:var(--muted); font-size:13.5px; line-height:1.6; margin:0; max-width:340px; margin:0 auto;}
  .nav-lock-badge{
    position:absolute; top:-4px; right:-6px; width:14px; height:14px; border-radius:50%;
    background:var(--court); color:#fff; display:flex; align-items:center; justify-content:center;
    border:1.5px solid var(--card);
  }

  @media (max-width:640px){
    header.site nav.top-nav{display:none;}
    nav.bottom-nav{display:flex;}
    h1.page-title{font-size:30px;}
    .stat-strip-4{grid-template-columns:repeat(2,1fr);}
    .pc-player-name{font-size:11.5px;}
  }
`;

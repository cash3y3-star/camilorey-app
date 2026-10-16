// Dirección pública del sitio, en un solo lugar (antes estaba fija como
// camilorey-app.vercel.app en sync.js, telegram.js, metaetiquetas...).
// Se mudó a Netlify en oct-2026 porque Vercel pausó el proyecto por
// "Fluid Active CPU" — para volver a cambiar de hosting basta con
// NEXT_PUBLIC_SITE_URL (o editar el valor por defecto de acá).
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://camilorey.netlify.app').replace(/\/$/, '');

module.exports = { SITE_URL };

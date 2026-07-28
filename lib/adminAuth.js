// CZECH IA AGENTS — chequeo de admin compartido por todas las rutas
// admin-only. "Admin" ahora son DOS niveles:
//  - superAdmin: el email exacto de NEXT_PUBLIC_ADMIN_EMAIL (vos). Es
//    el único que puede otorgar/quitar acceso admin a otras cuentas
//    (ver admin-manage-admins.js) — profiles.is_admin nunca lo decide
//    a sí mismo, ni siquiera otro admin.
//  - admin "de a pie": profiles.is_admin = true, otorgado a mano por
//    el superAdmin. Puede usar el resto del panel admin igual que el
//    superAdmin, pero NO puede tocar accesos admin de nadie.
//
// De paso trae is_tipster/display_name (2026-07-27, varios tipsters
// reales) — el superAdmin siempre cuenta como tipster (es CAMILO REY),
// aunque profiles.is_tipster de su fila diga otra cosa.
export async function checkAdmin(supabase, token) {
  if (!token) return { user: null, isAdmin: false, isSuperAdmin: false, isTipster: false, displayName: null };
  const {
    data: { user },
    error
  } = await supabase.auth.getUser(token);
  if (error || !user) return { user: null, isAdmin: false, isSuperAdmin: false, isTipster: false, displayName: null };

  const isSuperAdmin = user.email === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (isSuperAdmin) return { user, isAdmin: true, isSuperAdmin: true, isTipster: true, displayName: 'CAMILO REY' };

  const { data: profile } = await supabase.from('profiles').select('is_admin, is_tipster, display_name').eq('id', user.id).maybeSingle();
  return {
    user,
    isAdmin: Boolean(profile?.is_admin),
    isSuperAdmin: false,
    isTipster: Boolean(profile?.is_tipster),
    displayName: profile?.display_name || user.email?.split('@')[0] || null
  };
}

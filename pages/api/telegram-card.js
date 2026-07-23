// ============================================================
// CAMILOREY — genera la imagen tipo "tarjeta de pick" (dos fotos +
// VS + nombres + el pick) que se manda a Telegram — pedido
// 2026-07-19: "quiero la foto no la foto del jugador" (mostró el
// modal de "Partido detallado" como referencia). No es una captura
// del sitio, es una imagen nueva armada con next/og a partir de los
// mismos datos (nombre/foto de cada jugador + mercado + índice IA +
// cuota) que ya viajan en publishedPick (sync.js) o se arman al
// destacar un pick (admin-tipster-pick.js).
//
// Corre en Edge Runtime (lo pide next/og) — Telegram le pega
// directo a esta URL con GET y sendPhoto la usa como "photo" (le
// manda la URL, Telegram baja la imagen solo, no hace falta
// generarla y subirla a mano).
// ============================================================

import { ImageResponse } from 'next/og';

export const config = { runtime: 'edge' };

const BG = '#0b0f0d';
const CARD_BG = '#121a16';
const GREEN = '#22c55e';
const MUTED = '#8b9892';

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

// Arreglo 2026-07-23 (auditoría de seguridad): fa/ra son query params
// que cualquiera controla, y esta ruta es pública por necesidad
// (Telegram la baja él mismo, sin auth). Antes se pasaban derecho a
// <img src>, y next/og los baja server-side para armar el PNG — eso
// es SSRF (el atacante elige host y protocolo del fetch que hace
// Vercel). Los avatares reales solo salen de dos hosts (ver
// scripts/sync.js y lib/avatarCutout.js), así que cualquier otra URL
// se descarta y cae al placeholder con iniciales.
function isAllowedAvatarUrl(raw) {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'api.league-pro.com') return true;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && u.hostname === new URL(supabaseUrl).hostname) return true;
    return false;
  } catch {
    return false;
  }
}

function Avatar({ src, name }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        width="200"
        height="200"
        style={{ borderRadius: '50%', objectFit: 'cover', border: `5px solid ${GREEN}` }}
      />
    );
  }
  return (
    <div
      style={{
        width: 200,
        height: 200,
        borderRadius: '50%',
        background: CARD_BG,
        border: `5px solid ${GREEN}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 80,
        color: '#fff',
        fontWeight: 700
      }}
    >
      {initials(name)}
    </div>
  );
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const favName = searchParams.get('fn') || 'Favorito';
  const favAvatarRaw = searchParams.get('fa') || '';
  const favAvatar = isAllowedAvatarUrl(favAvatarRaw) ? favAvatarRaw : '';
  const rivalName = searchParams.get('rn') || 'Rival';
  const rivalAvatarRaw = searchParams.get('ra') || '';
  const rivalAvatar = isAllowedAvatarUrl(rivalAvatarRaw) ? rivalAvatarRaw : '';
  const market = searchParams.get('m') || `${favName} gana`;
  const confidence = searchParams.get('c') || '';
  const odds = searchParams.get('o') || '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: BG,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 70 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <Avatar src={favAvatar} name={favName} />
            <div style={{ display: 'flex', color: '#fff', fontSize: 32, fontWeight: 700 }}>🇨🇿 {favName}</div>
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: 40, fontWeight: 800 }}>VS</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            <Avatar src={rivalAvatar} name={rivalName} />
            <div style={{ display: 'flex', color: '#fff', fontSize: 32, fontWeight: 700 }}>🇨🇿 {rivalName}</div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 50,
            padding: '16px 44px',
            background: 'rgba(34,197,94,0.12)',
            border: `2px solid ${GREEN}`,
            borderRadius: 999,
            color: GREEN,
            fontSize: 36,
            fontWeight: 800
          }}
        >
          {market}
        </div>
        {confidence || odds ? (
          <div style={{ display: 'flex', marginTop: 30, color: MUTED, fontSize: 28, gap: 16 }}>
            {confidence ? <div style={{ display: 'flex' }}>{confidence}% Índice IA</div> : null}
            {confidence && odds ? <div style={{ display: 'flex' }}>·</div> : null}
            {odds ? <div style={{ display: 'flex' }}>cuota {odds}</div> : null}
          </div>
        ) : null}
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

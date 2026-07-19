// ============================================================
// CAMILOREY — mandar mensajes por Telegram (chat personal del admin,
// y opcionalmente también un canal). Necesita dos variables de
// entorno: TELEGRAM_BOT_TOKEN (el token que da @BotFather al crear el
// bot) y TELEGRAM_CHAT_ID — uno o VARIOS destinos separados por coma
// (ej. "577247984,@mi_canal" o "577247984,-1001234567890"), para
// mandar el mismo aviso al chat personal Y a un canal a la vez. Para
// un chat personal el id se consigue mandándole cualquier mensaje al
// bot y mirando el "chat.id" que devuelve
// https://api.telegram.org/bot<TOKEN>/getUpdates — para un canal, se
// agrega el bot como administrador y se usa su @username (si es
// público) o su id numérico (si es privado, empieza con -100).
//
// "Mejor esfuerzo" a propósito: si falla (token vencido, sin chat id,
// Telegram caído, el bot no es admin del canal), nunca debe tumbar lo
// que lo llama — un pick ya generado o ya destacado no depende de que
// este aviso salga bien. Cada destino se manda por separado: si uno
// falla (ej. el canal, porque el bot perdió permisos), el otro igual
// llega.
// ============================================================

function chatIds() {
  return (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function sendTelegramMessageTo(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Telegram sendMessage (${chatId}) falló: HTTP ${r.status} — ${body}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error(`Telegram sendMessage (${chatId}) falló:`, e.message);
    return { ok: false };
  }
}

async function sendTelegramPhotoTo(chatId, photoUrl, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Telegram sendPhoto (${chatId}) falló: HTTP ${r.status} — ${body}`);
      return sendTelegramMessageTo(chatId, caption);
    }
    return { ok: true };
  } catch (e) {
    console.error(`Telegram sendPhoto (${chatId}) falló:`, e.message);
    return sendTelegramMessageTo(chatId, caption);
  }
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = chatIds();
  if (!token || !ids.length) return { skipped: true };
  return Promise.all(ids.map((id) => sendTelegramMessageTo(id, text)));
}

// Manda la foto/tarjeta del pick junto con el texto como caption —
// Telegram baja la imagen de photoUrl él mismo, no hace falta
// subirla a mano. Si no hay foto o Telegram no logra bajarla, cae a
// un mensaje de solo texto para no perder el aviso por eso.
async function sendTelegramPhoto(photoUrl, caption) {
  if (!photoUrl) return sendTelegramMessage(caption);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = chatIds();
  if (!token || !ids.length) return { skipped: true };
  return Promise.all(ids.map((id) => sendTelegramPhotoTo(id, photoUrl, caption)));
}

// Arma la URL de pages/api/telegram-card.js (foto + VS + nombres +
// pick armada con next/og) a partir de los mismos datos que ya tiene
// cada llamador (sync.js / admin-tipster-pick.js) — centralizado acá
// para que los dos manden exactamente los mismos parámetros.
function buildPickCardUrl({ favName, favAvatar, rivalName, rivalAvatar, market, confidence, odds }) {
  const params = new URLSearchParams({
    fn: favName || '',
    fa: favAvatar || '',
    rn: rivalName || '',
    ra: rivalAvatar || '',
    m: market || '',
    c: confidence != null ? String(confidence) : '',
    o: odds != null ? String(odds) : ''
  });
  return `https://camilorey-app.vercel.app/api/telegram-card?${params.toString()}`;
}

// parse_mode va en 'HTML' (ver sendTelegramMessageTo/PhotoTo) — hay
// que escapar & < > en los nombres antes de meterlos en las etiquetas,
// si no un nombre con esos caracteres rompe el parseo del mensaje.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Texto que va como leyenda debajo de la tarjeta — pedido 2026-07-19:
// "Ruzicka J — Erik Marres / Ganador 🥇Erick Mares / cuota 1.64", en
// negrita y cursiva, con el encabezado (qué tipo de aviso es) arriba.
function buildPickCaption({ label, favName, rivalName, odds }) {
  const fav = escapeHtml(favName);
  const rival = escapeHtml(rivalName);
  const lines = [label, `<b><i>${fav} — ${rival}</i></b>`, `<b><i>Ganador 🥇${fav}</i></b>`];
  if (odds) lines.push(`<b><i>cuota ${Number(odds).toFixed(2)}</i></b>`);
  return lines.join('\n');
}

module.exports = { sendTelegramMessage, sendTelegramPhoto, buildPickCardUrl, buildPickCaption };

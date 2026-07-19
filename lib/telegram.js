// ============================================================
// CAMILOREY — mandar mensajes por Telegram (chat personal del admin)
// Necesita dos variables de entorno: TELEGRAM_BOT_TOKEN (el token que
// da @BotFather al crear el bot) y TELEGRAM_CHAT_ID (el id numérico
// del chat/persona a la que le llega — para un chat personal, se
// consigue mandándole cualquier mensaje al bot y mirando el "chat.id"
// que devuelve https://api.telegram.org/bot<TOKEN>/getUpdates).
//
// "Mejor esfuerzo" a propósito: si falla (token vencido, sin chat id,
// Telegram caído), nunca debe tumbar lo que lo llama — un pick ya
// generado o ya destacado no depende de que este aviso salga bien.
// ============================================================

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Telegram sendMessage falló: HTTP ${r.status} — ${body}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error('Telegram sendMessage falló:', e.message);
    return { ok: false };
  }
}

// Manda la foto del jugador favorito junto con el texto del pick como
// caption — Telegram baja la imagen de photoUrl él mismo, no hace
// falta subirla a mano. Si no hay foto (jugador sin avatar_url) o
// Telegram no logra bajarla (URL caída, formato raro), cae a un
// mensaje de solo texto para no perder el aviso por eso.
async function sendTelegramPhoto(photoUrl, caption) {
  if (!photoUrl) return sendTelegramMessage(caption);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { skipped: true };

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption, parse_mode: 'HTML' })
    });
    if (!r.ok) {
      const body = await r.text();
      console.error(`Telegram sendPhoto falló: HTTP ${r.status} — ${body}`);
      return sendTelegramMessage(caption);
    }
    return { ok: true };
  } catch (e) {
    console.error('Telegram sendPhoto falló:', e.message);
    return sendTelegramMessage(caption);
  }
}

module.exports = { sendTelegramMessage, sendTelegramPhoto };

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

module.exports = { sendTelegramMessage };

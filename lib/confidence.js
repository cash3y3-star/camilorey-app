// ============================================================
// CAMILOREY — fórmula de confianza (transparente, no "caja negra")
// Esto NO es un modelo de machine learning entrenado; es un
// puntaje ponderado a partir de 3 factores reales. La idea es
// medir su acierto real con el tiempo (ver bankroll_log) y
// ajustar los pesos si hace falta.
// ============================================================

/**
 * @param {Object} p
 * @param {number} p.ratingDiff   rating jugador A - rating jugador B
 * @param {number} p.streakA      victorias consecutivas recientes de A (positivo) o derrotas (negativo)
 * @param {number} p.streakB      idem para B
 * @param {number} p.h2hWinsA     victorias de A en los últimos enfrentamientos directos
 * @param {number} p.h2hTotal     total de enfrentamientos directos considerados
 */
function computeConfidence({ ratingDiff, streakA, streakB, h2hWinsA, h2hTotal }) {
  // 1) Diferencia de rating normalizada (-1 a 1), 200 pts de diff = tope
  const ratingScore = Math.max(-1, Math.min(1, ratingDiff / 200));

  // 2) Racha: comparamos impulso reciente de cada jugador
  const streakScore = Math.max(-1, Math.min(1, (streakA - streakB) / 6));

  // 3) H2H directo, solo si hay historial suficiente (mínimo 2 duelos)
  const h2hScore = h2hTotal >= 2 ? (h2hWinsA / h2hTotal) * 2 - 1 : 0;

  // Ajustado con datos reales (2026-07-12, n=108 picks resueltos vía
  // /api/debug/confidence-stats): h2hScore salió en 0.000 exacto en
  // TODOS los casos porque en esta liga casi nunca se repite el mismo
  // cruce de jugadores (hace falta h2hTotal >= 2) — era peso muerto al
  // 20%. streakScore no mostró señal a favor (promedio incluso más
  // alto en los fallos que en los aciertos) — se le baja el peso en
  // vez de quitarlo del todo, porque la diferencia es chica y podría
  // ser ruido de muestra. ratingScore fue el único con señal real
  // (aciertos > fallos en promedio) — se le sube el peso.
  const WEIGHTS = { rating: 0.75, streak: 0.15, h2h: 0.1 };

  const raw =
    ratingScore * WEIGHTS.rating +
    streakScore * WEIGHTS.streak +
    h2hScore * WEIGHTS.h2h; // rango aprox -1 a 1

  // Mapeamos a 50-90% (nunca prometemos 100%, nunca bajamos de 50%
  // porque por debajo de eso ya no es "nuestro pick")
  const confidence = Math.round(70 + raw * 20);

  return {
    confidence: Math.max(50, Math.min(92, confidence)),
    factors: { ratingScore, streakScore, h2hScore, weights: WEIGHTS }
  };
}

module.exports = { computeConfidence };

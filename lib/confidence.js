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

  // Pesos iniciales — se ajustan con datos reales una vez tengamos
  // suficiente historial en bankroll_log para comparar acierto real.
  const WEIGHTS = { rating: 0.5, streak: 0.3, h2h: 0.2 };

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

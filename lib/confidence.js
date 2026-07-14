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
 * @param {'A'|'B'|null} p.h2hLastResult  quién ganó el cruce directo MÁS RECIENTE entre A y B
 * @param {number} p.h2hAlternationRate  0-1: qué fracción de los cruces consecutivos de ESTA pareja cambiaron de ganador (1 = siempre alternan, 0 = siempre repite el mismo)
 */
function computeConfidence({
  ratingDiff,
  streakA,
  streakB,
  h2hWinsA,
  h2hTotal,
  h2hLastResult = null,
  h2hAlternationRate = 0
}) {
  // 1) Diferencia de rating normalizada (-1 a 1), 200 pts de diff = tope
  const ratingScore = Math.max(-1, Math.min(1, ratingDiff / 200));

  // 2) Racha: comparamos impulso reciente de cada jugador
  const streakScore = Math.max(-1, Math.min(1, (streakA - streakB) / 6));

  // 3) H2H directo, solo si hay historial suficiente (mínimo 2 duelos)
  const h2hScore = h2hTotal >= 2 ? (h2hWinsA / h2hTotal) * 2 - 1 : 0;

  // 4) Alternancia — agregado el 2026-07-14 a partir de varias capturas
  // de H2H reales donde el resultado alterna (gana uno, gana el otro,
  // gana el primero...) en vez de que un jugador domine sostenido. El
  // h2hScore de arriba promedia TODO el historial y por eso no ve esto:
  // con una secuencia W,L,W,L el ratio agregado da ~50/50 (sin señal),
  // aunque el orden sí sea predecible.
  //
  // OJO: la alternancia NO se cumple siempre — hay parejas donde un
  // jugador sí encadena varias victorias seguidas (visto en las mismas
  // capturas). Por eso esto no es "el último perdió, entonces gana el
  // otro" a secas: la dirección (quién ganó el cruce más reciente) se
  // multiplica por h2hAlternationRate, que mide qué tan seguido alterna
  // ESA pareja en concreto. Si su historial no alterna (una racha
  // sostenida), h2hAlternationRate sale bajo y el factor casi no pesa,
  // aunque haya un "último ganador" definido.
  const altDirection = h2hLastResult === 'A' ? -1 : h2hLastResult === 'B' ? 1 : 0;
  const altScore = altDirection * Math.max(0, Math.min(1, h2hAlternationRate));

  // Reajustado 2026-07-13 con n=292 picks resueltos (vía la pestaña
  // Modelo / /api/model-stats) — segunda medición desde el ajuste
  // anterior (n=108, 2026-07-12):
  //   - streakScore: en la primera medición ya no mostraba señal a
  //     favor; con el triple de datos SIGUE sin mostrarla (promedio en
  //     aciertos 0.171 vs fallos 0.168 — prácticamente idéntico). Dos
  //     mediciones independientes coincidiendo en "sin señal" ya no es
  //     ruido de muestra chica, es la racha reciente diciendo que no
  //     predice nada en esta liga — se le baja el peso casi a cero en
  //     vez de solo "bajarlo un poco".
  //   - h2hScore: antes salía en 0.000 SIEMPRE (casi nunca había
  //     h2hTotal >= 2). Con el backfill de historial de jugadores que
  //     se agregó esta sesión, ahora sí hay suficientes cruces
  //     repetidos para medirlo, y muestra señal (0.039 en aciertos vs
  //     0.004 en fallos) — se mantiene su peso, no se sube más todavía
  //     porque la muestra donde SÍ aplica (h2hTotal >= 2) sigue siendo
  //     chica.
  //   - ratingScore: sigue siendo el único factor con señal clara y
  //     consistente en las dos mediciones (aciertos > fallos) — se le
  //     sube el peso para compensar lo que se le quitó a streak.
  // Con todo esto, el acierto general (54.4%, IC 95% 48.7%-60.1%)
  // TODAVÍA no es distinguible de una moneda al aire — este ajuste no
  // promete que ahora sí lo sea, solo saca peso muerto de un factor
  // que dos mediciones seguidas confirman que no aporta.
  // alt se financia bajándole a rating (0.85 → 0.70) en vez de a
  // streak o h2h, que ya están en su piso por evidencia medida.
  const WEIGHTS = { rating: 0.7, streak: 0.05, h2h: 0.1, alt: 0.15 };

  const raw =
    ratingScore * WEIGHTS.rating +
    streakScore * WEIGHTS.streak +
    h2hScore * WEIGHTS.h2h +
    altScore * WEIGHTS.alt; // rango aprox -1 a 1

  // Mapeamos a 50-90% (nunca prometemos 100%, nunca bajamos de 50%
  // porque por debajo de eso ya no es "nuestro pick")
  const confidence = Math.round(70 + raw * 20);

  return {
    confidence: Math.max(50, Math.min(92, confidence)),
    factors: { ratingScore, streakScore, h2hScore, altScore, weights: WEIGHTS }
  };
}

module.exports = { computeConfidence };

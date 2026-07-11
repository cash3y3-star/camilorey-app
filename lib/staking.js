// ============================================================
// CAMILOREY — unidades de apuesta (staking)
// El sitio no trae cuotas reales, así que esto es una convención
// nuestra, no una cuota de mercado. Entre más confianza tiene un
// pick, más unidades arriesga — en línea recta entre un mínimo y un
// máximo, igual de transparente que lib/confidence.js.
// ============================================================

const MIN_CONFIDENCE = 50; // cota mínima que devuelve computeConfidence
const MAX_CONFIDENCE = 92; // cota máxima que devuelve computeConfidence
const MIN_STAKE = 0.5;
const MAX_STAKE = 2;

function computeStake(confidence) {
  const clamped = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, confidence));
  const t = (clamped - MIN_CONFIDENCE) / (MAX_CONFIDENCE - MIN_CONFIDENCE);
  const stake = MIN_STAKE + t * (MAX_STAKE - MIN_STAKE);
  return Math.round(stake * 10) / 10;
}

module.exports = { computeStake };

// ============================================================
// CAMILOREY — modelo de machine learning (regresión logística) que
// decide QUÉ picks entran a "Exclusivo" dentro de Picks VIP.
//
// A diferencia de lib/confidence.js (pesos fijos, que solo se ajustan
// a mano cuando alguien revisa las estadísticas), este modelo se
// reentrena SOLO, en cada corrida de sync.js, a partir de los picks ya
// resueltos (hit/miss) que hay en ese momento en la base — sin
// intervención manual. Usa las mismas 4 señales que ya calcula
// computeConfidence (rating, racha, H2H, alternancia) como features, y
// aprende el peso óptimo de cada una por descenso de gradiente sobre
// una regresión logística simple, con regularización L2 para no
// sobreajustar con las pocas centenas de muestras que hay.
//
// Se usa SOLO para decidir la sección Exclusivo — el resto de los
// picks (confianza mostrada, piso de publicación, etc.) sigue usando
// lib/confidence.js sin cambios.
// ============================================================

const FEATURE_KEYS = ['ratingScore', 'streakScore', 'h2hScore', 'altScore'];

// Con menos muestras que esto, no hay señal suficiente para confiar en
// los pesos aprendidos — el llamador debe caer al criterio viejo
// (confidence >= 85) mientras tanto.
const MIN_TRAINING_SAMPLES = 40;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

// rows: [{ ratingScore, streakScore, h2hScore, altScore, hit }] — los
// 4 scores ya orientados relativo al favorito (positivo = a favor del
// pick), mismo signo que usa pages/api/model-stats.js.
function trainLogisticRegression(rows, { epochs = 400, learningRate = 0.2, l2 = 0.02 } = {}) {
  const weights = { bias: 0, ratingScore: 0, streakScore: 0, h2hScore: 0, altScore: 0 };
  const n = rows.length;
  if (n === 0) return weights;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = { bias: 0, ratingScore: 0, streakScore: 0, h2hScore: 0, altScore: 0 };
    for (const row of rows) {
      const z = weights.bias + FEATURE_KEYS.reduce((sum, k) => sum + weights[k] * (row[k] || 0), 0);
      const err = sigmoid(z) - (row.hit ? 1 : 0);
      grad.bias += err;
      for (const k of FEATURE_KEYS) grad[k] += err * (row[k] || 0);
    }
    weights.bias -= learningRate * (grad.bias / n);
    for (const k of FEATURE_KEYS) {
      weights[k] -= learningRate * (grad[k] / n + l2 * weights[k]);
    }
  }
  return weights;
}

function predictProbability(weights, features) {
  const z = weights.bias + FEATURE_KEYS.reduce((sum, k) => sum + (weights[k] || 0) * (features[k] || 0), 0);
  return sigmoid(z);
}

// El umbral de Exclusivo NO puede ser un número fijo tipo "75% de
// probabilidad": el sistema históricamente acierta ~54% con señal
// débil (ver comentarios de lib/confidence.js), así que una regresión
// logística bien calibrada casi nunca va a estimar 75% para nadie —
// un umbral fijo alto deja Exclusivo sin picks para siempre, no
// porque el modelo esté "roto" sino porque está siendo honesto sobre
// cuánta certeza hay de verdad.
//
// En vez de eso, el umbral se calcula RELATIVO a lo que el propio
// modelo predijo en su set de entrenamiento: el percentil 85 de esas
// probabilidades (o sea, "el modelo está más seguro de este pick que
// del 85% de los picks históricos"). Así Exclusivo sigue siendo
// selecto (top ~15%) sin depender de que la señal alcance un número
// absoluto arbitrario. minFloor evita marcar como "exclusivo" algo
// que ni siquiera al modelo le gusta más que un volado.
function computeExclusiveThreshold(weights, rows, { percentile = 0.85, minFloor = 0.55 } = {}) {
  if (!rows.length) return minFloor;
  const probs = rows.map((r) => predictProbability(weights, r)).sort((a, b) => a - b);
  const idx = Math.min(probs.length - 1, Math.floor(probs.length * percentile));
  return Math.max(minFloor, probs[idx]);
}

module.exports = {
  trainLogisticRegression,
  predictProbability,
  computeExclusiveThreshold,
  MIN_TRAINING_SAMPLES,
  FEATURE_KEYS
};

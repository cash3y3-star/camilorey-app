import Head from 'next/head';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const VIEWS = ['inicio', 'predicciones', 'calendario', 'bankroll'];
const AVATAR_COLORS = ['#E2444A', '#FF7A45', '#A32D2D', '#D85A30', '#C23B4C', '#B84A2E'];

function avatarColor(seed) {
  return AVATAR_COLORS[(seed || '').length % AVATAR_COLORS.length];
}

// ============================================================
// Server-side: trae todo lo que la página necesita de Supabase.
// Es SSR (no getStaticProps) porque los picks/resultados cambian
// cada 30 min con el sync — siempre queremos la última data.
// ============================================================
export async function getServerSideProps() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const [{ data: players }, { data: pendingPicks }] = await Promise.all([
    supabase.from('players').select('id, name, avatar_url, avatar_cutout_url'),
    supabase.from('picks').select('*').eq('result', 'pending').order('confidence', { ascending: false })
  ]);

  const playersById = new Map((players || []).map((p) => [p.id, p]));

  const pendingMatchIds = (pendingPicks || []).map((p) => p.match_id);
  const { data: pendingMatches } = pendingMatchIds.length
    ? await supabase.from('matches').select('*').in('id', pendingMatchIds)
    : { data: [] };
  const matchesById = new Map((pendingMatches || []).map((m) => [m.id, m]));

  const tournamentIds = [...new Set((pendingMatches || []).map((m) => m.tournament_id).filter(Boolean))];
  const { data: tournaments } = tournamentIds.length
    ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
    : { data: [] };
  const tournamentsById = new Map((tournaments || []).map((t) => [t.id, t]));

  // Forma reciente (victoria/derrota) del jugador favorito de cada
  // pick, para el gráfico del modal de detalle.
  async function recentForm(playerId) {
    if (!playerId) return [];
    const { data } = await supabase
      .from('matches')
      .select('winner_id, player_a_id, player_b_id')
      .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
      .eq('status', 'finished')
      .order('scheduled_at', { ascending: false })
      .limit(8);
    return (data || []).map((m) => (m.winner_id === playerId ? 1 : 0)).reverse();
  }

  // Un pick "pending" cuyo partido ya debería haberse jugado hace rato
  // es casi seguro un residuo que el sync todavía no cerró (o de antes
  // de que existiera el cierre hit/miss) — no lo mostramos como si
  // fuera un pick vigente.
  const STALE_THRESHOLD_MS = 2 * 3600 * 1000;

  const picks = [];
  for (const pick of pendingPicks || []) {
    const match = matchesById.get(pick.match_id);
    if (!match) continue;
    if (match.scheduled_at && Date.now() - new Date(match.scheduled_at).getTime() > STALE_THRESHOLD_MS) continue;
    const playerA = playersById.get(match.player_a_id);
    const playerB = playersById.get(match.player_b_id);
    const favored = playersById.get(pick.predicted_winner_id);
    const opponent = pick.predicted_winner_id === match.player_a_id ? playerB : playerA;
    // Si falta cualquiera de los dos jugadores, es un pick con datos
    // incompletos (probablemente de antes del cierre hit/miss) — mejor
    // no mostrarlo que mostrar una tarjeta rota.
    if (!favored || !opponent) continue;
    const tournament = tournamentsById.get(match.tournament_id);

    picks.push({
      id: pick.id,
      day: dayLabel(match.scheduled_at),
      scheduledAt: new Date(match.scheduled_at).getTime(),
      player: favored?.name || '—',
      initials: initialsOf(favored?.name),
      avatarUrl: favored?.avatar_cutout_url || favored?.avatar_url || null,
      hasCutout: Boolean(favored?.avatar_cutout_url),
      opponent: opponent?.name || '—',
      time: timeLabel(match.scheduled_at),
      tournament: tournament?.name || 'Torneo',
      market: pick.market,
      confidence: Math.round(pick.confidence),
      odds: pick.odds ? Number(pick.odds) : null,
      analysis: buildAnalysis(pick.factors),
      history: await recentForm(pick.predicted_winner_id)
    });
  }
  picks.sort((a, b) => a.scheduledAt - b.scheduledAt);
  const topConfidence = [...picks].sort((a, b) => b.confidence - a.confidence)[0];
  if (topConfidence) topConfidence.featured = true;

  // Calendario: partidos en una ventana de "ahora mismo" (unas horas
  // atrás hasta mañana), programados o ya cerrados.
  const windowStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const windowEnd = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { data: windowMatches } = await supabase
    .from('matches')
    .select('*')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)
    .order('scheduled_at', { ascending: true })
    .limit(40);

  const missingPlayerIds = [...new Set((windowMatches || []).flatMap((m) => [m.player_a_id, m.player_b_id]))].filter(
    (id) => id && !playersById.has(id)
  );
  if (missingPlayerIds.length) {
    const { data: extra } = await supabase.from('players').select('id, name').in('id', missingPlayerIds);
    for (const p of extra || []) playersById.set(p.id, p);
  }
  const missingTournamentIds = [...new Set((windowMatches || []).map((m) => m.tournament_id))].filter(
    (id) => id && !tournamentsById.has(id)
  );
  if (missingTournamentIds.length) {
    const { data: extra } = await supabase.from('tournaments').select('id, name').in('id', missingTournamentIds);
    for (const t of extra || []) tournamentsById.set(t.id, t);
  }

  // Para pintar de verde/rojo el resultado del partido según si
  // nuestro pick acertó o falló (no según quién ganó a secas).
  const windowMatchIds = (windowMatches || []).map((m) => m.id);
  const { data: windowPicks } = windowMatchIds.length
    ? await supabase.from('picks').select('match_id, result').in('match_id', windowMatchIds)
    : { data: [] };
  const pickResultByMatchId = new Map((windowPicks || []).map((p) => [p.match_id, p.result]));

  const matches = (windowMatches || []).map((m) => {
    const a = playersById.get(m.player_a_id);
    const b = playersById.get(m.player_b_id);
    const t = tournamentsById.get(m.tournament_id);
    let status = 'soon';
    if (m.status === 'finished') status = 'done';
    else if (m.status === 'live') status = 'live';
    else if (new Date(m.scheduled_at) <= new Date()) status = 'live';
    const pickResult = pickResultByMatchId.get(m.id);
    return {
      time: timeLabel(m.scheduled_at),
      tournament: t?.name || 'Torneo',
      players: `${a?.name || '?'} vs ${b?.name || '?'}`,
      status,
      score: status === 'done' && m.sets_a != null && m.sets_b != null ? `${m.sets_a}-${m.sets_b}` : null,
      pickResult: status === 'done' && (pickResult === 'hit' || pickResult === 'miss') ? pickResult : null
    };
  });

  // Bankroll.
  const { data: bankrollRows } = await supabase
    .from('bankroll_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  const bkPickIds = [...new Set((bankrollRows || []).map((r) => r.pick_id).filter(Boolean))];
  const { data: bkPicks } = bkPickIds.length
    ? await supabase.from('picks').select('id, market').in('id', bkPickIds)
    : { data: [] };
  const bkPicksById = new Map((bkPicks || []).map((p) => [p.id, p]));

  const bankrollLog = (bankrollRows || []).map((r) => {
    const pick = bkPicksById.get(r.pick_id);
    return {
      fecha: new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', timeZone: 'America/Bogota' }).format(
        new Date(r.created_at)
      ),
      pick: pick?.market || 'Pick',
      u: `${Number(r.units) >= 0 ? '+' : ''}${Number(r.units).toFixed(1)}u`,
      ok: Number(r.units) >= 0,
      balance: `${Number(r.balance) >= 0 ? '+' : ''}${Number(r.balance).toFixed(1)}u`
    };
  });

  const hits = (bankrollRows || []).filter((r) => Number(r.units) > 0).length;
  const misses = (bankrollRows || []).filter((r) => Number(r.units) < 0).length;
  const efectividad = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0;

  let racha = 0;
  for (const r of bankrollRows || []) {
    const won = Number(r.units) > 0;
    if (racha === 0) racha = won ? 1 : -1;
    else if (racha > 0 === won) racha += won ? 1 : -1;
    else break;
  }

  const picksWithOdds = picks.filter((p) => p.odds);
  const cuotaProm = picksWithOdds.length
    ? Math.round((picksWithOdds.reduce((sum, p) => sum + p.odds, 0) / picksWithOdds.length) * 100) / 100
    : null;

  return {
    props: {
      stats: { efectividad, racha, cuotaProm },
      picks,
      matches,
      bankrollLog
    }
  };
}

function initialsOf(name) {
  if (!name) return '??';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function timeLabel(iso) {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota'
  }).format(new Date(iso));
}

function dayLabel(iso) {
  const fmt = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
  const target = fmt(new Date(iso));
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 24 * 3600 * 1000));
  if (target === today) return 'hoy';
  if (target === tomorrow) return 'mañana';
  return 'otro';
}

// Frase corta y honesta armada a partir de los factores reales de
// lib/confidence.js — nada inventado, solo traduce los números.
function buildAnalysis(factors) {
  if (!factors) return 'Pick generado sin desglose disponible.';
  const pct = (x) => Math.round(Math.abs(x) * 100);
  const bits = [];
  if (factors.ratingScore) bits.push(`rating (${pct(factors.ratingScore)}%)`);
  if (factors.streakScore) bits.push(`racha reciente (${pct(factors.streakScore)}%)`);
  if (factors.h2hScore) bits.push(`cruce directo (${pct(factors.h2hScore)}%)`);
  if (bits.length === 0) return 'Pick generado sin suficiente historial todavía.';
  return `Favorito según ${bits.join(', ')}.`;
}

function PickCard({ pick, onClick }) {
  return (
    <div className="pick-card" onClick={onClick}>
      <div className="avatar" style={{ '--tone': avatarColor(pick.player) }}>
        {pick.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pick.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          pick.initials
        )}
      </div>
      <div className="pick-info">
        <div className="tour">
          {pick.tournament} · {pick.time}
        </div>
        <div className="name">{pick.player}</div>
        <div className="match">vs {pick.opponent}</div>
        <span className="pick-market">{pick.market}</span>
      </div>
      <div className="pick-right">
        <div className="confidence">
          <span className="dot"></span>
          <span className="val num">{pick.confidence}%</span>
        </div>
        <div className="odd-mini num">{pick.odds ? pick.odds.toFixed(2) : 'N/D'}</div>
      </div>
    </div>
  );
}

export default function Home({ stats, picks, matches, bankrollLog }) {
  const [view, setView] = useState('inicio');
  const [dayFilter, setDayFilter] = useState('todos');
  const [modalPick, setModalPick] = useState(null);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      setView(VIEWS.includes(h) ? h : 'inicio');
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const featured = picks.find((p) => p.featured) || picks[0] || null;
  const homePicks = featured ? picks.filter((p) => p.id !== featured.id).slice(0, 4) : [];
  const filteredPicks = dayFilter === 'todos' ? picks : picks.filter((p) => p.day === dayFilter);

  const navLink = (v, label) => (
    <a href={`#${v}`} data-view={v} className={view === v ? 'active' : ''}>
      {label}
    </a>
  );

  return (
    <>
      <Head>
        <title>CAMILOREY · Picks Liga Pro Checa de tenis de mesa</title>
        <meta name="description" content="Predicciones y análisis diarios de la Liga Pro Checa de tenis de mesa." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{CSS}</style>
      </Head>

      <header className="site">
        <a href="#inicio" className="logo">
          CAMILOREY
          <span className="dot"></span>
        </a>
        <nav className="top-nav">
          {navLink('inicio', 'Inicio')}
          {navLink('predicciones', 'Predicciones')}
          {navLink('calendario', 'Calendario')}
          {navLink('bankroll', 'Bankroll')}
        </nav>
        <span className="badge18">+18 · Juega con cabeza</span>
      </header>

      <main>
        <section className={`view ${view === 'inicio' ? 'active' : ''}`}>
          <span className="eyebrow">Liga Pro Checa · Tenis de mesa</span>
          <h1 className="page-title">Picks del día</h1>
          <p className="page-sub">Análisis propio sobre partidos de la Liga Pro Checa, contrastado con nuestro propio historial.</p>

          <div className="stat-strip">
            <div className="stat-card">
              <div className="label">Efectividad</div>
              <div className="value hit num">{stats.efectividad}%</div>
            </div>
            <div className="stat-card">
              <div className="label">Racha actual</div>
              <div className="value num">
                {stats.racha === 0 ? '—' : `${Math.abs(stats.racha)}${stats.racha > 0 ? 'W' : 'L'}`}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Cuota prom.</div>
              <div className="value num">{stats.cuotaProm ? stats.cuotaProm.toFixed(2) : '—'}</div>
            </div>
          </div>

          {featured ? (
            <div className="featured">
              <div className="rally-wrap">
                {featured.avatarUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={featured.hasCutout ? 'cutout' : ''}
                      src={featured.avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                    {!featured.hasCutout ? <div className="rally-fade"></div> : null}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 200 110">
                      <path d="M10,95 Q100,5 190,95" stroke="rgba(255,255,255,.4)" strokeDasharray="4 6" fill="none" strokeWidth="2" />
                    </svg>
                    <div className="rally-ball"></div>
                  </>
                )}
              </div>
              <div className="pick-tag">
                <span className="ball-dot"></span> Pick del día
              </div>
              <div className="match">
                {featured.tournament} · {featured.time}
              </div>
              <div className="player">
                {featured.player} vs {featured.opponent}
              </div>
              <div className="market">{featured.market}</div>
              <div className="foot">
                <span className="odd-pill num">{featured.odds ? featured.odds.toFixed(2) : 'Cuota N/D'}</span>
                <button className="btn btn-ball" onClick={() => setModalPick(featured)}>
                  Ver análisis →
                </button>
              </div>
            </div>
          ) : (
            <p className="page-sub">No hay picks activos en este momento.</p>
          )}

          <div className="section-head">
            <h2>Picks principales</h2>
            <a href="#predicciones" className="see-all">
              Ver todo →
            </a>
          </div>
          <div className="pick-grid">
            {homePicks.map((p) => (
              <PickCard key={p.id} pick={p} onClick={() => setModalPick(p)} />
            ))}
          </div>
        </section>

        <section className={`view ${view === 'predicciones' ? 'active' : ''}`}>
          <span className="eyebrow">Todos los picks</span>
          <h1 className="page-title">Predicciones</h1>
          <p className="page-sub">{filteredPicks.length} picks disponibles</p>
          <div className="tabs">
            {[
              ['todos', 'Todos'],
              ['hoy', 'Hoy'],
              ['mañana', 'Mañana']
            ].map(([key, label]) => (
              <div key={key} className={`tab ${dayFilter === key ? 'active' : ''}`} onClick={() => setDayFilter(key)}>
                {label}
              </div>
            ))}
          </div>
          <div className="pick-grid">
            {filteredPicks.map((p) => (
              <PickCard key={p.id} pick={p} onClick={() => setModalPick(p)} />
            ))}
          </div>
        </section>

        <section className={`view ${view === 'calendario' ? 'active' : ''}`}>
          <span className="eyebrow">Agenda de partidos</span>
          <h1 className="page-title">Calendario</h1>
          <p className="page-sub">Próximos cruces de la Liga Pro Checa cubiertos por CAMILOREY.</p>
          <div>
            {matches.map((m, i) => {
              const label = m.status === 'live' ? 'En vivo' : m.status === 'done' ? 'Finalizado' : 'Próximo';
              return (
                <div className="match-row" key={i}>
                  <div className="match-time num">{m.time}</div>
                  <div className="match-mid">
                    <div className="tour">{m.tournament}</div>
                    <div className="players">{m.players}</div>
                  </div>
                  {m.score ? (
                    <div
                      className="num"
                      style={{
                        flex: 'none',
                        width: '52px',
                        textAlign: 'center',
                        fontWeight: 700,
                        color: m.pickResult === 'hit' ? 'var(--hit)' : m.pickResult === 'miss' ? 'var(--miss)' : 'var(--muted)'
                      }}
                    >
                      {m.score}
                    </div>
                  ) : null}
                  <div className={`status ${m.status}`}>{label}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`view ${view === 'bankroll' ? 'active' : ''}`}>
          <span className="eyebrow">Gestión de unidades</span>
          <h1 className="page-title">Bankroll</h1>
          <p className="page-sub">Seguimiento en unidades (u), no en dinero real, para medir el rendimiento de forma responsable.</p>

          <div className="bankroll-card">
            <strong>¿Cómo se mide?</strong>
            <p style={{ color: 'var(--muted)', fontSize: '13.5px', lineHeight: '1.6' }}>
              Cada pick arriesga entre 0.5u y 2u según la confianza del modelo (ver lib/staking.js). El pago sí usa
              la cuota real de Rushbet cuando logramos cruzar el partido en su feed; si no la encontramos, se calcula
              1:1. Ajusta siempre el tamaño de tus apuestas a lo que puedas permitirte perder.
            </p>
          </div>

          <div className="bankroll-card">
            <table className="bk">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Pick</th>
                  <th>Unidades</th>
                  <th>Resultado</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {bankrollLog.map((r, i) => (
                  <tr key={i}>
                    <td>{r.fecha}</td>
                    <td style={{ fontFamily: 'var(--font-body)', fontWeight: 600 }}>{r.pick}</td>
                    <td className={r.ok ? 'hit' : 'miss'}>{r.u}</td>
                    <td className={r.ok ? 'hit' : 'miss'}>{r.ok ? 'Acierto' : 'Fallo'}</td>
                    <td>{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="site">
        <strong>CAMILOREY</strong> ofrece análisis y opiniones propias con fines informativos y de entretenimiento
        sobre la Liga Pro Checa de tenis de mesa. No garantizamos resultados y no gestionamos apuestas ni fondos de
        terceros. Servicio dirigido exclusivamente a mayores de 18 años. Si sientes que el juego deja de ser un
        entretenimiento, busca ayuda profesional. Juega siempre con responsabilidad.
      </footer>

      <nav className="bottom-nav">
        <a href="#inicio" className={view === 'inicio' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 11l9-7 9 7" />
            <path d="M5 10v9h14v-9" />
          </svg>
          Inicio
        </a>
        <a href="#predicciones" className={view === 'predicciones' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v18M3 12h18" />
          </svg>
          Picks
        </a>
        <a href="#calendario" className={view === 'calendario' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          Calendario
        </a>
        <a href="#bankroll" className={view === 'bankroll' ? 'active' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="6" width="18" height="13" rx="2" />
            <path d="M3 10h18M15 14h3" />
          </svg>
          Bankroll
        </a>
      </nav>

      {modalPick && (
        <div id="overlay" className="show" onClick={(e) => e.target.id === 'overlay' && setModalPick(null)}>
          <div className="modal">
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {modalPick.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="featured-avatar" src={modalPick.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : null}
                <div>
                  <div className="sub">
                    {modalPick.tournament} · {modalPick.time}
                  </div>
                  <h3>{modalPick.player}</h3>
                  <div className="sub">vs {modalPick.opponent}</div>
                </div>
              </div>
              <button className="modal-close" onClick={() => setModalPick(null)}>
                ✕
              </button>
            </div>
            <div className="modal-market">{modalPick.market}</div>

            <div className="kpis">
              <div className="kpi">
                <div className="l">Confianza</div>
                <div className="v num">{modalPick.confidence}%</div>
              </div>
              <div className="kpi">
                <div className="l">Cuota (Rushbet)</div>
                <div className="v num">{modalPick.odds ? modalPick.odds.toFixed(2) : 'No disponible'}</div>
              </div>
            </div>

            <div className="hist-title">
              <span>Forma reciente ({modalPick.history.length} partidos)</span>
              <span>{modalPick.history.filter((v) => v === 1).length}/{modalPick.history.length} victorias</span>
            </div>
            <div className="chart">
              {modalPick.history.length === 0 ? (
                <span style={{ color: 'var(--muted)', fontSize: '12px' }}>Sin historial todavía.</span>
              ) : (
                modalPick.history.map((v, i) => (
                  <div key={i} className={`bar ${v === 1 ? 'hit' : 'miss'}`} style={{ height: '60px' }}></div>
                ))
              )}
            </div>
            <div className="legend">
              <span>
                <i className="sw" style={{ background: 'var(--hit)' }}></i>Victoria
              </span>
              <span>
                <i className="sw" style={{ background: 'var(--miss)' }}></i>Derrota
              </span>
            </div>

            <div className="analysis">{modalPick.analysis}</div>
          </div>
        </div>
      )}
    </>
  );
}

const CSS = `
  :root{
    --bg:#0E0D0C;
    --bg-alt:#171513;
    --card:#1B1917;
    --ink:#F5F1EC;
    --muted:#948C83;
    --line:#2B2724;
    --court:#E2444A;
    --court-dark:#A32D2D;
    --court-soft:#2E1817;
    --ball:#FF7A45;
    --ball-dark:#D85A30;
    --hit:#5DCAA5;
    --miss:#F09595;
    --font-display:'Big Shoulders Display', sans-serif;
    --font-body:'Manrope', sans-serif;
    --font-mono:'IBM Plex Mono', monospace;
    --radius:16px;
    --shadow:0 2px 12px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3);
  }
  *{box-sizing:border-box;}
  html{scroll-behavior:smooth;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:var(--font-body);
    -webkit-font-smoothing:antialiased;
    padding-bottom:76px;
  }
  a{color:inherit;}
  .num{font-family:var(--font-mono); font-variant-numeric:tabular-nums;}

  header.site{
    position:sticky; top:0; z-index:40;
    background:rgba(14,13,12,0.88);
    backdrop-filter:blur(10px);
    border-bottom:1px solid var(--line);
    padding:14px 20px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .logo{
    font-family:var(--font-display);
    font-weight:800;
    font-size:22px;
    letter-spacing:0.5px;
    text-decoration:none;
    color:var(--ink);
    display:flex; align-items:center; gap:6px;
  }
  .logo .dot{
    width:9px; height:9px; border-radius:50%;
    background:var(--court);
    display:inline-block;
    box-shadow:0 0 0 3px var(--court-soft);
  }
  nav.top-nav{display:flex; gap:6px;}
  nav.top-nav a{
    font-size:14px; font-weight:600;
    padding:8px 14px; border-radius:999px;
    text-decoration:none; color:var(--muted);
    transition:background .15s, color .15s;
  }
  nav.top-nav a.active, nav.top-nav a:hover{background:var(--court); color:#fff;}
  .badge18{
    font-family:var(--font-mono); font-size:11px; font-weight:600;
    color:#FAC7C7; background:var(--court-soft);
    border-radius:999px; padding:4px 9px; margin-left:8px;
  }

  main{max-width:980px; margin:0 auto; padding:24px 20px 60px;}
  .view{display:none;}
  .view.active{display:block; animation:fade .35s ease;}
  @keyframes fade{from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:none;}}

  h1.page-title{
    font-family:var(--font-display); font-weight:800;
    font-size:38px; line-height:1; letter-spacing:.3px;
    margin:4px 0 4px;
  }
  .page-sub{color:var(--muted); font-size:14px; margin-bottom:22px;}
  .eyebrow{
    font-family:var(--font-mono); font-size:11px; letter-spacing:1.5px;
    text-transform:uppercase; color:var(--court); font-weight:600;
  }

  .stat-strip{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:16px 0 26px;}
  .stat-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow);
  }
  .stat-card .label{font-size:12px; color:var(--muted); margin-bottom:4px;}
  .stat-card .value{font-family:var(--font-mono); font-size:22px; font-weight:600;}
  .stat-card .value.hit{color:var(--hit);}

  .featured{
    position:relative; overflow:hidden;
    background:linear-gradient(160deg, #1B1917, #0E0D0C 75%);
    border:1px solid var(--line);
    border-radius:20px; padding:26px 24px 24px;
    color:#fff; margin-bottom:28px;
    box-shadow:0 10px 26px rgba(0,0,0,0.45);
  }
  .featured::before{
    content:""; position:absolute; top:-40%; right:-15%; width:60%; height:180%;
    background:radial-gradient(circle, rgba(226,68,74,.22), transparent 70%);
    pointer-events:none;
  }
  .rally-wrap{position:absolute; right:0; top:0; bottom:72px; width:300px; pointer-events:none; overflow:hidden;}
  .rally-wrap svg{width:100%; height:130px; opacity:.65;}
  .rally-wrap img{width:100%; height:100%; object-fit:cover; object-position:center 20%; display:block;}
  .rally-wrap img.cutout{object-fit:contain; object-position:bottom center;}
  .rally-fade{
    position:absolute; inset:0;
    background:linear-gradient(100deg, #14100F 0%, rgba(20,16,15,.85) 22%, rgba(20,16,15,.35) 45%, transparent 68%);
  }
  .rally-ball{
    position:absolute; width:9px; height:9px; border-radius:50%;
    background:var(--ball);
    offset-path: path("M10,95 Q100,5 190,95");
    animation: rally 2.6s ease-in-out infinite alternate;
    box-shadow:0 0 10px rgba(255,122,69,.85);
  }
  @keyframes rally{ from{offset-distance:0%;} to{offset-distance:100%;} }
  .pick-tag{
    display:inline-flex; align-items:center; gap:6px;
    background:rgba(226,68,74,.16); border:1px solid rgba(226,68,74,.45);
    color:#F09595;
    border-radius:999px; padding:5px 12px; font-size:12px; font-weight:700;
    margin-bottom:14px;
  }
  .pick-tag .ball-dot{width:7px; height:7px; border-radius:50%; background:var(--court);}
  .featured .match{font-size:13px; opacity:.85; margin-bottom:2px;}
  .featured .player{font-family:var(--font-display); font-weight:800; font-size:30px; line-height:1.05;}
  .featured-avatar{
    width:64px; height:64px; border-radius:14px; flex:none; object-fit:cover;
    border:2px solid rgba(255,255,255,.18); box-shadow:0 4px 14px rgba(0,0,0,.4);
  }
  .featured .market{
    display:inline-block; font-weight:700; font-size:15px;
    background:rgba(226,68,74,.2); border:1px solid rgba(226,68,74,.55);
    color:#fff; border-radius:10px; padding:8px 14px; margin-bottom:16px;
  }
  .featured .foot{display:flex; align-items:center; gap:14px; flex-wrap:wrap;}
  .odd-pill{
    font-family:var(--font-mono); background:rgba(255,255,255,.08);
    border:1px solid rgba(255,255,255,.2); border-radius:10px;
    padding:8px 12px; font-size:14px; color:var(--ink);
  }
  .btn{
    font-family:var(--font-body); font-weight:700; font-size:14px;
    border:none; border-radius:999px; padding:10px 18px; cursor:pointer;
    display:inline-flex; align-items:center; gap:6px;
    transition:transform .12s ease;
  }
  .btn:hover{transform:translateY(-1px);}
  .btn-ball{background:var(--court); color:#fff;}
  .btn-ghost{background:rgba(255,255,255,.1); color:#fff; border:1px solid rgba(255,255,255,.25);}

  .section-head{display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 14px;}
  .section-head h2{font-family:var(--font-display); font-size:22px; font-weight:700; margin:0;}
  .see-all{font-size:13px; font-weight:700; color:var(--court); text-decoration:none;}

  .pick-grid{display:grid; gap:12px;}
  .pick-card{
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; box-shadow:var(--shadow); cursor:pointer;
    display:flex; align-items:center; gap:14px;
    transition:border-color .15s, transform .12s;
  }
  .pick-card:hover{border-color:var(--court); transform:translateY(-1px);}
  .avatar{
    width:48px; height:48px; border-radius:12px; flex:none;
    display:flex; align-items:center; justify-content:center;
    font-family:var(--font-display); font-weight:800; font-size:16px; color:#fff;
    position:relative; overflow:hidden;
    background:linear-gradient(150deg, var(--tone,var(--court)), #14100F 130%);
    border:1px solid rgba(255,255,255,.08);
  }
  .avatar img{width:100%; height:100%; object-fit:cover; display:block;}
  .avatar::after{
    content:""; position:absolute; inset:0; border-radius:12px;
    background:linear-gradient(155deg, rgba(255,255,255,.16), transparent 55%);
    pointer-events:none;
  }
  .pick-info{flex:1; min-width:0;}
  .pick-info .tour{font-size:11px; color:var(--muted); font-family:var(--font-mono);}
  .pick-info .name{font-weight:700; font-size:15px; margin:1px 0;}
  .pick-info .match{font-size:12.5px; color:var(--muted);}
  .pick-market{
    font-size:12px; font-weight:700; color:#FAC7C7;
    background:var(--court-soft); border-radius:8px; padding:4px 8px;
    display:inline-block; margin-top:4px;
  }
  .pick-right{text-align:right; flex:none;}
  .confidence{display:flex; align-items:center; gap:6px; justify-content:flex-end; margin-bottom:6px;}
  .confidence .dot{width:7px; height:7px; border-radius:50%; background:var(--hit);}
  .confidence .val{font-family:var(--font-mono); font-weight:700; color:var(--hit); font-size:14px;}
  .odd-mini{font-family:var(--font-mono); font-size:12px; color:var(--muted);}

  .tabs{display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;}
  .tab{
    font-size:13px; font-weight:700; padding:8px 16px; border-radius:999px;
    border:1px solid var(--line); background:var(--card); cursor:pointer; color:var(--muted);
  }
  .tab.active{background:var(--court); color:#fff; border-color:var(--court);}

  .match-row{
    display:flex; align-items:center; gap:14px; padding:12px 14px;
    background:var(--card); border:1px solid var(--line); border-radius:12px; margin-bottom:8px;
  }
  .match-time{font-family:var(--font-mono); font-weight:700; width:56px; flex:none;}
  .match-mid{flex:1; min-width:0;}
  .match-mid .tour{font-size:11px; color:var(--muted); font-family:var(--font-mono);}
  .match-mid .players{font-weight:700; font-size:14.5px;}
  .status{font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; flex:none;}
  .status.live{background:rgba(255,122,69,.16); color:#FFB088; border:1px solid rgba(255,122,69,.4);}
  .status.soon{background:var(--court-soft); color:#FAC7C7;}
  .status.done{background:var(--bg-alt); color:var(--muted);}

  .bankroll-card{background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:20px; box-shadow:var(--shadow); margin-bottom:18px;}
  table.bk{width:100%; border-collapse:collapse; font-size:13.5px;}
  table.bk th{text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); border-bottom:1px solid var(--line); padding:8px 6px;}
  table.bk td{padding:9px 6px; border-bottom:1px solid var(--line); font-family:var(--font-mono);}
  table.bk td.hit{color:var(--hit); font-weight:700;}
  table.bk td.miss{color:var(--miss); font-weight:700;}

  #overlay{
    position:fixed; inset:0; background:rgba(0,0,0,.65); backdrop-filter:blur(2px);
    display:flex; align-items:flex-end; justify-content:center; z-index:100;
  }
  .modal{
    background:var(--card); width:100%; max-width:480px; border-radius:20px 20px 0 0;
    padding:22px 22px 26px; max-height:88vh; overflow-y:auto;
    animation:slideup .25s ease;
  }
  @media(min-width:640px){
    #overlay{align-items:center;}
    .modal{border-radius:20px; margin-bottom:0;}
  }
  @keyframes slideup{from{transform:translateY(30px); opacity:0;} to{transform:none; opacity:1;}}
  .modal-head{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;}
  .modal-close{
    background:var(--bg-alt); border:1px solid var(--line); width:30px; height:30px; border-radius:50%;
    cursor:pointer; font-size:16px; color:var(--muted);
  }
  .modal h3{font-family:var(--font-display); font-size:24px; margin:2px 0 2px; color:var(--ink);}
  .modal .sub{color:var(--muted); font-size:13px;}
  .modal-market{
    display:inline-block; margin:12px 0; font-weight:700; font-size:14px;
    background:var(--court-soft); color:#FAC7C7; padding:8px 14px; border-radius:10px;
  }
  .hist-title{font-size:12px; text-transform:uppercase; letter-spacing:.5px; color:var(--muted); margin:18px 0 8px; display:flex; justify-content:space-between;}
  .chart{display:flex; align-items:flex-end; gap:5px; height:90px; border-bottom:1px dashed var(--line); position:relative; margin-bottom:6px;}
  .bar{flex:1; border-radius:4px 4px 0 0; min-height:6px;}
  .bar.hit{background:var(--hit);}
  .bar.miss{background:var(--miss);}
  .legend{display:flex; gap:14px; font-size:11.5px; color:var(--muted); margin-bottom:16px;}
  .legend span{display:inline-flex; align-items:center; gap:5px;}
  .legend .sw{width:8px; height:8px; border-radius:50%;}
  .kpis{display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:14px 0;}
  .kpi{background:var(--bg-alt); border-radius:10px; padding:10px 12px;}
  .kpi .l{font-size:11px; color:var(--muted);}
  .kpi .v{font-family:var(--font-mono); font-weight:700; font-size:18px;}
  .analysis{font-size:13.5px; line-height:1.55; color:var(--ink); background:var(--bg-alt); border-radius:12px; padding:14px; margin-top:6px; border:1px solid var(--line);}

  footer.site{
    max-width:980px; margin:0 auto; padding:20px 20px 40px; color:var(--muted); font-size:12px; line-height:1.6;
  }
  footer.site strong{color:var(--ink);}

  nav.bottom-nav{
    display:none; position:fixed; bottom:0; left:0; right:0; z-index:50;
    background:var(--card); border-top:1px solid var(--line);
    padding:8px 6px calc(8px + env(safe-area-inset-bottom));
    justify-content:space-around;
  }
  nav.bottom-nav a{
    display:flex; flex-direction:column; align-items:center; gap:3px;
    text-decoration:none; color:var(--muted); font-size:10.5px; font-weight:600; flex:1;
  }
  nav.bottom-nav a.active{color:var(--court);}
  nav.bottom-nav svg{width:20px; height:20px;}

  @media (max-width:640px){
    header.site nav.top-nav{display:none;}
    nav.bottom-nav{display:flex;}
    .featured .player{font-size:24px;}
    h1.page-title{font-size:30px;}
    .rally-wrap{width:190px;}
  }
`;

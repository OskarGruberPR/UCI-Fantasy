import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { sb, q, rpc, useAction, Msg, RiderCell, RiderPicker } from '../lib.js';

// Abstand zwischen Server- und Geräteuhr, damit der Countdown überall gleich läuft
let clockOffset = 0;
async function syncClock() {
  const t0 = Date.now();
  const server = await rpc('server_now');
  clockOffset = new Date(server).getTime() - (t0 + Date.now()) / 2;
}
const serverNow = () => Date.now() + clockOffset;

export function Draft({ c }) {
  const { league } = c;
  if (league.status === 'setup') return html`<${DraftLobby} c=${c} />`;
  return html`<${DraftRoom} c=${c} />`;
}

function DraftLobby({ c }) {
  const a = useAction();
  const offline = c.league.draft_mode === 'offline';
  return html`<section class="card stack">
    <h2>Draft</h2>
    ${offline
      ? html`<p>Diese Liga nutzt einen <strong>Offline-Draft</strong>. Der Admin trägt die Kader unter „Admin“ ein.</p>`
      : html`<p>Live-Auktion mit ${c.league.budget} Budgetpunkten pro Manager. Jedes Gebot setzt die Uhr auf
          ${c.league.bid_seconds} Sekunden zurück. Reihenfolge: ${c.league.draft_order === 'ranking' ? 'UCI-Rangliste' : 'reihum nominieren'}.</p>`}
    <h3>Manager (${c.managers.length}/${c.league.max_managers})</h3>
    <ul class="list">${c.managers.map((m) => html`<li key=${m.id}>${m.team_name}
      ${m.user_id ? '' : html`<span class="tag">Platzhalter</span>`}</li>`)}</ul>
    ${c.isAdmin && !offline && html`<div class="row">
      <button class="primary" disabled=${a.busy || c.managers.length < 2}
        onClick=${() => a.run(async () => { await rpc('start_draft', { p_league: c.league.id }); c.reload(); })}>Draft starten</button>
      <span class="muted small">Alle sollten jetzt im Draft-Raum sein.</span></div>`}
    ${c.isAdmin && offline && html`<a class="button primary" href=${`#/league/${c.league.id}/admin/import`}>Kader eintragen</a>`}
    ${!c.isAdmin && !offline && html`<p class="muted">Warte, bis der Admin den Draft startet – diese Seite aktualisiert sich dann.</p>`}
    <${Msg} msg=${a.msg} />
    <${AutoReload} c=${c} />
  </section>`;
}

// Prüft im Hintergrund, ob jemand beigetreten ist oder der Draft gestartet wurde
function AutoReload({ c }) {
  useEffect(() => {
    const t = setInterval(async () => {
      const [l, m] = await Promise.all([
        q(sb.from('leagues').select('status').eq('id', c.league.id)),
        q(sb.from('managers').select('id, team_name, user_id').eq('league_id', c.league.id)),
      ]).catch(() => [[], null]);
      const sig = (list) => list.map((x) => x.id + x.team_name + x.user_id).sort().join();
      if ((l[0] && l[0].status !== c.league.status) || (m && sig(m) !== sig(c.managers))) c.reload();
    }, 4000);
    return () => clearInterval(t);
  }, [c.league.status, c.managers]);
  return null;
}

function DraftRoom({ c }) {
  const L = c.league.id;
  const [d, setD] = useState(null);
  const [lots, setLots] = useState([]);
  const [now, setNow] = useState(serverNow());
  const [amount, setAmount] = useState('');
  const a = useAction();
  const lastLot = useRef(null);
  const ticking = useRef(false);

  const load = async () => {
    const [st] = await q(sb.from('draft_state').select('*').eq('league_id', L));
    setD(st);
    const key = st && `${st.lot_no}|${st.status}|${st.phase}|${st.nominator}`;
    if (st && key !== lastLot.current) {
      lastLot.current = key;
      setLots(await q(sb.from('draft_lots').select('*').eq('league_id', L).order('lot_no', { ascending: false }).limit(200)));
      c.reload();
      setAmount('');
    }
  };

  useEffect(() => {
    syncClock().catch(() => {});
    load();
    const ch = sb.channel(`draft-${L}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_state', filter: `league_id=eq.${L}` },
        (p) => { if (p.new) { setD(p.new); load(); } })
      .subscribe();
    const poll = setInterval(load, 1500);            // Rückfall, falls Realtime hakt
    const clock = setInterval(() => setNow(serverNow()), 200);
    return () => { sb.removeChannel(ch); clearInterval(poll); clearInterval(clock); };
  }, [L]);

  // Uhr abgelaufen → Zuschlag auslösen (jeder Client darf, nur der erste wirkt)
  const remaining = d?.deadline ? Math.max(0, (new Date(d.deadline).getTime() - now) / 1000) : null;
  useEffect(() => {
    if (d?.status === 'running' && remaining === 0 && !ticking.current) {
      ticking.current = true;
      rpc('draft_tick', { p_league: L }).catch(() => {}).finally(() => { ticking.current = false; load(); });
    }
  }, [remaining === 0, d?.deadline]);

  if (!d) return html`<p class="muted">Lädt …</p>`;
  if (d.status === 'done') return html`<${DraftSummary} c=${c} lots=${lots} />`;

  const me = c.me;
  const open = (m) => c.league.roster_size - c.active.filter((r) => r.manager_id === m.id).length;
  const maxBid = (m) => (open(m) <= 0 ? 0 : m.budget_left - (open(m) - 1));
  const rider = c.riderMap[d.current_rider];
  const minNext = Math.max(1, d.current_bid + 1);
  const iAmHigh = me && d.current_bidder === me.id;
  const canBid = me && d.status === 'running' && rider && remaining > 0 && !iAmHigh && open(me) > 0 && maxBid(me) >= minNext;
  const bid = (v) => a.run(async () => { await rpc('draft_bid', { p_league: L, p_amount: v }); setAmount(''); await load(); });
  const nominatorName = c.managerMap[d.nominator]?.team_name;
  const myTurn = me && d.nominator === me.id;
  const drafted = new Set(lots.map((l) => l.rider_slug));
  const free = c.riders.filter((r) => !c.owner[r.pcs_slug] && !r.inactive);

  return html`<div class="draft">
    <section class="card auction">
      <div class="row between">
        <span class="tag">${d.status === 'paused' ? 'Pausiert' : d.phase === 'fill' ? 'Auffüllphase' : `Los ${d.lot_no}`}</span>
        ${c.isAdmin && html`<button class="small ghost" disabled=${a.busy}
          onClick=${() => a.run(async () => { await rpc('pause_draft', { p_league: L, p_pause: d.status === 'running' }); load(); })}>
          ${d.status === 'running' ? 'Pausieren' : 'Fortsetzen'}</button>`}
      </div>

      ${rider ? html`
        <div class="lot">
          <div class="lot-rider"><${RiderCell} r=${rider} /></div>
          <div class=${`clock ${remaining !== null && remaining < 5 ? 'hot' : ''}`} aria-live="off">
            ${d.status === 'paused' ? '⏸' : remaining !== null ? Math.ceil(remaining) : ''}
          </div>
        </div>
        <div class="bid-now">
          ${d.current_bid > 0
            ? html`Höchstgebot <strong>${d.current_bid}</strong> von <strong>${c.managerMap[d.current_bidder]?.team_name}</strong>${iAmHigh ? ' (du)' : ''}`
            : html`<span class="muted">Noch kein Gebot – ohne Gebot wird der Fahrer übersprungen.</span>`}
        </div>
        ${me && html`<div class="bid-controls">
          ${[0, 1, 4, 9].map((plus) => minNext + plus <= maxBid(me) && html`
            <button class=${plus === 0 ? 'primary' : ''} disabled=${!canBid || a.busy} onClick=${() => bid(minNext + plus)}>${minNext + plus}</button>`)}
          <form class="row" onSubmit=${(e) => { e.preventDefault(); if (amount) bid(+amount); }}>
            <input type="number" min=${minNext} max=${maxBid(me)} placeholder="eigenes Gebot" value=${amount}
              onInput=${(e) => setAmount(e.target.value)} disabled=${!canBid} />
            <button disabled=${!canBid || a.busy || !amount}>Bieten</button>
          </form>
          <span class="muted small">Dein Höchstgebot: ${maxBid(me)}</span>
        </div>`}
      ` : d.phase === 'fill' ? html`
        <p>Die Rangliste ist durch. Restplätze werden reihum mit freien Fahrern zum Preis 1 gefüllt.</p>
        <p>An der Reihe: <strong>${nominatorName}</strong>${myTurn ? ' – du!' : ''}</p>
        ${(myTurn || c.isAdmin) && html`<${RiderPicker} riders=${free} action="Für 1 holen"
          onPick=${(r) => a.run(async () => { await rpc('draft_fill_pick', { p_league: L, p_rider: r.pcs_slug }); load(); })} />`}
      ` : html`
        <p>An der Reihe zum Nominieren: <strong>${nominatorName}</strong>${myTurn ? ' – du!' : ''}</p>
        ${(myTurn || c.isAdmin) && html`<p class="muted small">Der nominierte Fahrer startet mit deinem Gebot 1.</p>
          <${RiderPicker} riders=${free.filter((r) => !drafted.has(r.pcs_slug))} action="Nominieren"
          onPick=${(r) => a.run(async () => { await rpc('draft_nominate', { p_league: L, p_rider: r.pcs_slug }); load(); })} />`}
      `}
      <${Msg} msg=${a.msg} />
    </section>

    <section class="card">
      <h3>Manager</h3>
      <table class="tbl">
        <thead><tr><th>Team</th><th class="num">Budget</th><th class="num">Plätze frei</th><th class="num">Max.</th></tr></thead>
        <tbody>${c.managers.map((m) => html`<tr key=${m.id} class=${m.id === me?.id ? 'me' : ''}>
          <td>${m.team_name}</td><td class="num">${m.budget_left}</td><td class="num">${open(m)}</td><td class="num">${maxBid(m)}</td></tr>`)}</tbody>
      </table>
    </section>

    ${me && html`<section class="card">
      <h3>Mein Kader</h3>
      <${RosterMini} c=${c} managerId=${me.id} />
    </section>`}

    <section class="card">
      <h3>Letzte Zuschläge</h3>
      <ul class="list compact">${lots.slice(0, 15).map((l) => html`<li key=${l.id}>
        <span>${c.riderMap[l.rider_slug]?.name || l.rider_slug}</span>
        <span class="muted">${l.manager_id ? `${c.managerMap[l.manager_id]?.team_name} · ${l.price}` : 'übersprungen'}</span></li>`)}</ul>
    </section>
  </div>`;
}

function RosterMini({ c, managerId }) {
  const mine = c.active.filter((r) => r.manager_id === managerId);
  if (!mine.length) return html`<p class="muted">Noch leer.</p>`;
  return html`<ul class="list compact">${mine.map((r) => html`<li key=${r.id}>
    <span>${c.riderMap[r.rider_slug]?.name || r.rider_slug}</span><span class="muted">${r.price}</span></li>`)}</ul>`;
}

function DraftSummary({ c }) {
  return html`<section class="stack">
    <div class="card"><h2>Draft abgeschlossen</h2>
      <p class="muted">Ab jetzt laufen Kaderänderungen über Waiver und Tausch.</p></div>
    <div class="cards">${c.managers.map((m) => html`<div class="card" key=${m.id}>
      <h3>${m.team_name}</h3>
      <p class="muted small">Ausgegeben: ${c.active.filter((r) => r.manager_id === m.id).reduce((s, r) => s + r.price, 0)} · Rest: ${m.budget_left}</p>
      <${RosterMini} c=${c} managerId=${m.id} />
    </div>`)}</div>
  </section>`;
}

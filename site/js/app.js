/* Dashboard Consulta Históricos de Clientes - orquestração da interface */
(function () {
  const NV = window.NV;
  const { h, icon, $, $$, fmt } = NV;
  const CFG = window.NV_CONFIG || {};
  const TOKEN = new URLSearchParams(location.search).get("token") || "";
  const isMobile = () => matchMedia("(max-width: 767px)").matches;

  const S = { p: null, eng: null, user: null, f: null, mk: null, mkPrev: null, sum: null, sumPrev: null,
    metric: "liq", chartView: "chart", rankTab: "rca", hist: [], ms: null, built: false };
  const METRICS = { liq: { label: "Valor líquido", money: true }, venda: { label: "Venda", money: true }, qtd: { label: "Itens", money: false } };

  /* ================================================================ tema */
  function applyTheme(t) {
    const r = document.documentElement;
    t === "light" || t === "dark" ? r.setAttribute("data-theme", t) : r.removeAttribute("data-theme");
    $$("#theme-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === (t || "auto"))));
    if (S.eng) renderChart();
  }
  applyTheme(NV.store.get("nv_theme", "auto"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => S.eng && renderChart());

  /* ================================================================ login */
  const supportText = [CFG.supportEmail, CFG.supportPhone, CFG.supportHours].filter(Boolean).join(" · ");
  $("#support-line").textContent = supportText;
  $("#foot-support").textContent = supportText ? "Suporte: " + supportText : "";

  const loginErr = (m) => { const e = $("#login-error"); e.textContent = m || ""; e.hidden = !m; };
  const params = new URLSearchParams(location.search);
  $("#login-email").value = params.get("user") || "";
  if (!TOKEN) {
    const n = $("#login-invalid");
    n.textContent = "Link inválido: falta o token de acesso. Use o link pessoal enviado pela Novavet.";
    n.hidden = false;
    $("#login-btn").disabled = true;
  }
  $("#pw-toggle").addEventListener("click", () => {
    const i = $("#login-pin"), show = i.type === "password";
    i.type = show ? "text" : "password";
    $("#pw-toggle use").setAttribute("href", show ? "#i-eyeoff" : "#i-eye");
    $("#pw-toggle").setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
  });
  $("#login-pin").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });

  let fails = 0, lockedUntil = 0, lockTimer = null;
  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (Date.now() < lockedUntil) return;
    const email = $("#login-email").value.trim(), pin = $("#login-pin").value.trim();
    loginErr("");
    if (!NV.validEmail(email)) return loginErr("Informe um e-mail válido.");
    if (!/^\d{4}$/.test(pin)) return loginErr("A senha tem 4 dígitos.");
    const btn = $("#login-btn");
    btn.disabled = true; btn.textContent = "Entrando…";
    try {
      const p = await NV.auth.open(TOKEN, email, pin);
      fails = 0;
      start(p);
    } catch (e) {
      if (e.code === "notfound") { const n = $("#login-invalid"); n.textContent = "Link inválido ou revogado. Peça um novo link ao gerente."; n.hidden = false; }
      else if (e.code === "unsupported") loginErr("Este navegador não é compatível. Use a versão atual do Chrome, Edge, Firefox ou Safari, com o site em HTTPS.");
      else if (e.code === "badcreds") {
        fails++;
        if (fails >= 5) {
          lockedUntil = Date.now() + 30000; fails = 0;
          clearInterval(lockTimer);
          lockTimer = setInterval(() => {
            const s = Math.ceil((lockedUntil - Date.now()) / 1000);
            if (s <= 0) { clearInterval(lockTimer); loginErr(""); } else loginErr(`Muitas tentativas. Aguarde ${s}s.`);
          }, 500);
        } else loginErr("E-mail ou senha incorretos.");
      } else {
        console.error(e);
        $("#app-view").hidden = true; $("#login-view").hidden = false;     // não deixa a tela vazia se algo falhar após decifrar
        loginErr("Não foi possível abrir os dados. Tente novamente ou fale com o suporte.");
      }
    } finally {
      btn.disabled = !TOKEN; btn.textContent = "Entrar";
    }
  });

  function logout() {
    NV.charts.destroy();
    closeAll();
    S.p = S.eng = S.user = S.mk = S.mkPrev = null; S.hist = [];
    $("#app-view").hidden = true;
    $("#login-view").hidden = false;
    $("#login-pin").value = "";
    scrollTo(0, 0);
  }

  /* ================================================================ estado / filtros */
  function defaults() {
    const e = S.eng, y = Math.floor(e.ymMax / 12);
    return { tipo: "", clientes: new Set(), principais: new Set(), labs: new Set(), months: new Set(),
      from: Math.max(e.ymMin, y * 12), to: e.ymMax, ytd: false, sup: -1, rcas: new Set(), prods: new Set() };
  }
  const ser = (f) => JSON.stringify(f, (k, v) => (v instanceof Set ? { __s: [...v] } : v));
  const des = (s) => JSON.parse(s, (k, v) => (v && v.__s ? new Set(v.__s) : v));

  function buildFilters() {
    if (S.built) return;
    S.built = true;
    const mk = (id, label, searchable, onChange) => new NV.MultiSelect($(id), { label, searchable, onChange });
    const f = () => S.f;
    S.ms = {
      cli: mk("#f-cliente", "Cliente (código, CNPJ/CPF ou nome)", true, (s) => { f().clientes = s; if (s.size) { f().principais = new Set(); } commit(); }),
      pr: mk("#f-principal", "Cliente principal", true, (s) => { f().principais = s; if (s.size) { f().clientes = new Set(); } commit(); }),
      lab: mk("#f-lab", "Laboratório / fornecedor", false, (s) => { f().labs = s; commit(); }),
      mes: mk("#f-mes", "Mês", false, (s) => { f().months = s; commit(); }),
      prod: mk("#f-produto", "Produto", true, (s) => { f().prods = s; commit(); }),
      rca: mk("#f-rca", "RCA", false, (s) => { f().rcas = s; commit(); }),
    };
    S.ms.cli.o.placeholder = S.ms.pr.o.placeholder = "Todos";

    $("#f-tipo").addEventListener("change", (e) => { S.f.tipo = e.target.value; commit(); });
    $("#f-ytd").addEventListener("change", (e) => { S.f.ytd = e.target.checked; commit(); });
    $("#f-sup").addEventListener("change", (e) => { S.f.sup = +e.target.value; fillRcaOptions(); commit(); });

    const monthOpts = NV.MESES.map((m, i) => h("option", { value: i }, m));
    ["#f-from-m", "#f-to-m"].forEach((id) => $(id).replaceChildren(...monthOpts.map((o) => o.cloneNode(true))));
    const periodChange = (which) => () => {
      const val = +$("#f-" + which + "-y").value * 12 + +$("#f-" + which + "-m").value;
      S.f[which] = val;
      if (which === "from" && S.f.from > S.f.to) S.f.to = S.f.from;
      if (which === "to" && S.f.to < S.f.from) S.f.from = S.f.to;
      commit();
    };
    ["from", "to"].forEach((w) => { $("#f-" + w + "-m").addEventListener("change", periodChange(w)); $("#f-" + w + "-y").addEventListener("change", periodChange(w)); });

    $("#btn-clear").addEventListener("click", () => { S.f = defaults(); commit(); });
    $("#btn-apply").addEventListener("click", closeAll);
    $("#btn-close-filters").addEventListener("click", closeAll);
  }

  function fillRcaOptions() {
    const p = S.p;
    const list = p.rca.map((r, i) => ({ id: i, label: r.n, sub: p.sup[r.s] ? p.sup[r.s].n : "" }))
      .filter((o) => S.f.sup < 0 || p.rca[o.id].s === S.f.sup);
    S.ms.rca.setOptions(list);
    S.f.rcas = S.ms.rca.getSelected();
  }

  function configureFilters() {
    const p = S.p, e = S.eng;
    S.ms.cli.setOptions(p.cli.map((c, i) => ({ id: i, label: c.n, sub: `Cód. ${c.c} · ${c.d} · ${c.y}` })));
    S.ms.pr.setOptions(p.pr.map((x, i) => ({ id: i, label: x.n, sub: "Cód. " + x.c })));
    S.ms.lab.setOptions(p.forn.map((n, i) => ({ id: i, label: n })));
    S.ms.mes.setOptions(NV.MESES.map((n, i) => ({ id: i, label: n })));
    S.ms.prod.setOptions(p.prod.map((x, i) => ({ id: i, label: x.n, sub: p.forn[x.f] })));
    Object.values(S.ms).forEach((m) => m.setSelected(new Set()));
    const y0 = Math.floor(e.ymMin / 12), y1 = Math.floor(e.ymMax / 12);
    const years = []; for (let y = y0; y <= y1; y++) years.push(y);
    ["#f-from-y", "#f-to-y"].forEach((id) => $(id).replaceChildren(...years.map((y) => h("option", { value: y }, y))));

    const tipo = p.user.tipo;
    $("#f-sup-wrap").hidden = tipo !== "Gerente";
    $("#f-rca").hidden = tipo === "RCA";
    $("#f-sup").replaceChildren(h("option", { value: -1 }, "Todos"), ...p.sup.map((s, i) => h("option", { value: i }, s.n)));
    if (tipo !== "RCA") fillRcaOptions();

    const y = Math.floor(e.ymMax / 12);
    const P = [["mes", "Mês atual", e.ymMax, e.ymMax], ["3m", "Últimos 3 meses", Math.max(e.ymMin, e.ymMax - 2), e.ymMax],
      ["ytd", "Ano atual (YTD)", Math.max(e.ymMin, y * 12), e.ymMax], ["12m", "Últimos 12 meses", Math.max(e.ymMin, e.ymMax - 11), e.ymMax],
      ["all", "Todo o período", e.ymMin, e.ymMax]];
    $("#presets").replaceChildren(...P.map(([id, label, from, to]) =>
      h("button", { type: "button", class: "chip-btn", "data-from": from, "data-to": to, "aria-pressed": "false", onclick: () => { S.f.from = from; S.f.to = to; commit(); } }, label)));
  }

  /* reflete o estado (S.f) nos controles */
  function syncControls() {
    const f = S.f;
    $("#f-tipo").value = f.tipo;
    $("#f-ytd").checked = f.ytd;
    $("#f-sup").value = f.sup;
    $("#f-from-m").value = f.from % 12; $("#f-from-y").value = Math.floor(f.from / 12);
    $("#f-to-m").value = f.to % 12; $("#f-to-y").value = Math.floor(f.to / 12);
    S.ms.cli.setSelected(f.clientes); S.ms.pr.setSelected(f.principais); S.ms.lab.setSelected(f.labs);
    S.ms.mes.setSelected(f.months); S.ms.prod.setSelected(f.prods); S.ms.rca.setSelected(f.rcas);
    $$("#presets .chip-btn").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.from === f.from && +b.dataset.to === f.to)));
    renderChips();
  }

  function renderChips() {
    const f = S.f, p = S.p, def = defaults(), chips = [];
    const facets = new Set();
    const add = (facet, k, v, rm) => { facets.add(facet); chips.push({ k, v, rm }); };
    const many = (facet, k, set, nameOf, clear) => {
      if (!set.size) return;
      if (set.size <= 3) set.forEach((id) => add(facet, k, nameOf(id), () => { set.delete(id); }));
      else add(facet, k, set.size + " selecionados", clear);
    };
    if (f.from !== def.from || f.to !== def.to) add("period", "Período", fmt.ym(f.from) + " – " + fmt.ym(f.to), () => { f.from = def.from; f.to = def.to; });
    if (f.tipo) add("tipo", "Tipo", f.tipo === "F" ? "Físico" : "Jurídico", () => { f.tipo = ""; });
    many("cli", "Cliente", f.clientes, (i) => p.cli[i].n, () => f.clientes.clear());
    many("pr", "Cliente principal", f.principais, (i) => p.pr[i].n, () => f.principais.clear());
    many("lab", "Laboratório", f.labs, (i) => p.forn[i], () => f.labs.clear());
    many("mes", "Mês", f.months, (m) => NV.MESES[m], () => f.months.clear());
    many("prod", "Produto", f.prods, (i) => p.prod[i].n, () => f.prods.clear());
    if (f.sup >= 0) add("sup", "Supervisor", p.sup[f.sup].n, () => { f.sup = -1; fillRcaOptions(); });
    many("rca", "RCA", f.rcas, (i) => p.rca[i].n, () => f.rcas.clear());
    if (f.ytd) add("ytd", "Comparativo", "YTD", () => { f.ytd = false; });
    $("#active-chips").replaceChildren(...chips.map((c) =>
      h("span", { class: "chip" }, h("span", {}, h("b", {}, c.k + ": "), c.v),
        h("button", { type: "button", "aria-label": "Remover filtro " + c.k, onclick: () => { c.rm(); commit(); } }, icon("i-x")))));
    const n = facets.size;
    [$("#filters-badge"), $("#bb-badge")].forEach((b) => { b.hidden = !n; b.textContent = n; });
    S.facets = n;
  }

  function commit(push = true) {
    const e = S.eng, f = S.f;
    f.from = Math.max(e.ymMin, Math.min(f.from, e.ymMax));
    f.to = Math.max(f.from, Math.min(f.to, e.ymMax));
    syncControls();
    update();
    if (push) pushHist();
    rememberClient();
  }

  /* histórico de filtros (botão Voltar) e de buscas recentes */
  function pushHist() {
    const k = ser(S.f);
    if (S.hist[S.hist.length - 1] !== k) S.hist.push(k);
    if (S.hist.length > 40) S.hist.shift();
    $("#bb-back").disabled = S.hist.length < 2;
  }
  function goBack() {
    if (S.hist.length < 2) return NV.toast("Não há filtros anteriores.");
    S.hist.pop();
    S.f = des(S.hist[S.hist.length - 1]);
    syncControls(); update();
    $("#bb-back").disabled = S.hist.length < 2;
  }
  const histKey = () => "nv_hist_" + S.user.id;
  function rememberClient() {
    if (S.f.clientes.size !== 1) return;
    const c = S.p.cli[[...S.f.clientes][0]];
    const list = NV.store.get(histKey(), []).filter((x) => x.c !== c.c);
    list.unshift({ c: c.c, n: c.n, y: c.y });
    NV.store.set(histKey(), list.slice(0, 8));
    renderHist();
  }
  function renderHist() {
    const list = NV.store.get(histKey(), []);
    $("#hist-list").replaceChildren(...(list.length ? list.map((x) =>
      h("li", {}, h("button", { type: "button", onclick: () => {
        const i = S.p.cli.findIndex((c) => c.c === x.c);
        if (i < 0) return;
        S.f.clientes = new Set([i]); S.f.principais = new Set(); closeAll(); commit(); $("#detail-card").scrollIntoView({ behavior: "smooth" });
      } }, x.n, h("small", {}, `Cód. ${x.c} · ${x.y}`))))
      : [h("li", { class: "muted" }, "Suas últimas consultas de cliente aparecem aqui.")]));
  }

  /* ================================================================ início da sessão */
  function start(p) {
    S.p = p; S.eng = new NV.Engine(p); S.user = p.user;
    S.rankTab = p.user.tipo === "RCA" ? "cli" : "rca";
    S.metric = "liq"; S.chartView = "chart"; S.hist = [];
    $("#login-view").hidden = true; $("#app-view").hidden = false;
    scrollTo(0, 0);

    const u = p.user;
    $("#user-avatar").textContent = $("#menu-avatar").textContent = NV.initials(u.nome);
    $("#user-name").textContent = $("#menu-name").textContent = u.nome;
    $("#user-role").textContent = u.tipo;
    $("#menu-mail").textContent = u.pendente ? "(e-mail pendente)" : u.email;
    $("#menu-admin").hidden = u.tipo !== "Gerente";
    $("#top-sub").textContent = u.tipo === "RCA" ? `RCA · Supervisor: ${u.supNome || "—"}`
      : u.tipo === "Supervisor" ? `Supervisor · ${p.rca.length} carteira${p.rca.length === 1 ? "" : "s"} de RCA` : "Gerente · todas as equipes";

    S.f = defaults();
    buildFilters(); configureFilters(); buildRankTabs(); wireCard();
    $$("#metric-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === "liq")));
    $$("#view-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === "chart")));
    renderFooter(); renderHist();
    commit();
    NV.remote.logLogin(TOKEN);
  }

  function renderFooter() {
    const m = S.p.meta, d = new Date(m.geradoEm), last = S.eng.ymMax;
    const now = new Date(), parcial = now.getFullYear() * 12 + now.getMonth() === last;
    $("#foot-updated").textContent = `Dados atualizados em ${fmt.date(d)} (${m.fonte}) · último mês: ${fmt.ymFull(last)}${parcial ? " (em andamento)" : ""}`;
  }

  /* ================================================================ cálculo + render */
  function update() {
    const e = S.eng, f = S.f;
    S.mk = e.mask(f);
    S.sum = e.summary(S.mk);
    if (f.ytd) { S.mkPrev = e.mask(f, -12); S.sumPrev = e.summary(S.mkPrev); } else { S.mkPrev = null; S.sumPrev = null; }
    renderKpis(); renderChart(); renderRank(); renderDetail();
  }

  const rangeText = (from, to) => (from === to ? fmt.ym(from) : fmt.ym(from) + " a " + fmt.ym(to));

  function renderKpis() {
    const s = S.sum, pv = S.sumPrev, f = S.f;
    const tile = (cls, label, value, key, invert) => {
      const kids = [h("div", { class: "k-label" }, h("i", {}), label), h("div", { class: "k-value" }, value)];
      if (pv) {
        const cur = s[key], old = pv[key];
        let chip;
        if (!old) chip = h("span", { class: "delta flat" }, "sem base anterior");
        else {
          const d = ((cur - old) / Math.abs(old)) * 100;
          const up = d > 0.05, down = d < -0.05;
          const good = invert ? down : up, bad = invert ? up : down;
          chip = h("span", { class: "delta " + (good ? "up" : bad ? "down" : "flat") }, up || down ? icon(up ? "i-up" : "i-down") : null, fmt.pctSigned(d));
        }
        kids.push(h("div", { class: "k-delta" }, chip, h("span", {}, "vs " + rangeText(f.from - 12, f.to - 12) + ": " + (key === "qtd" || key === "clientes" ? fmt.int(old) : fmt.plain(fmt.brl(old))))));
      }
      return h("div", { class: "kpi " + cls }, kids);
    };
    const money = (v) => fmt.plain(fmt.brl(v));
    $("#kpis").replaceChildren(
      tile("hero", "Valor líquido (faturado)", money(s.liq), "liq"),
      tile("", "Venda (imputado)", money(s.venda), "venda"),
      tile("k-dev", "Devolução", money(s.dev), "dev", true),
      tile("k-sec", "Qtd. de itens", fmt.int(s.qtd), "qtd"),
      tile("k-sec", "Clientes positivados", fmt.int(s.clientes), "clientes"));
    $("#kpi-note").textContent = "Valor líquido = faturado, já descontadas as devoluções; pode diferir de Venda − Devolução quando pedidos são imputados e faturados em meses diferentes. Clientes positivados = clientes com valor líquido positivo no filtro.";
  }

  function chartData() {
    const e = S.eng, f = S.f, key = S.metric;
    const pos = [];
    for (let y = f.from; y <= f.to; y++) if (!f.months.size || f.months.has(y % 12)) pos.push(y);
    const cur = e.series(S.mk, f.from, f.to)[key];
    const prev = f.ytd ? e.series(S.mkPrev, f.from - 12, f.to - 12)[key] : null;
    const sameYear = Math.floor(f.from / 12) === Math.floor(f.to / 12);
    return {
      pos, key,
      labels: pos.map((y) => (sameYear ? NV.MESES_ABR[y % 12] : NV.MESES_ABR[y % 12] + "/" + String(Math.floor(y / 12)).slice(2))),
      titles: pos.map((y) => fmt.ymFull(y)),
      cur: pos.map((y) => cur[y - f.from]),
      prev: prev ? pos.map((y) => prev[y - f.from]) : null,
    };
  }

  function renderChart() {
    if (!S.eng || !S.mk) return;
    const f = S.f, m = METRICS[S.metric], d = chartData();
    $("#chart-title").textContent = "Evolução mensal — " + m.label;
    $("#chart-sub").textContent = rangeText(f.from, f.to) + (f.ytd ? " comparado com " + rangeText(f.from - 12, f.to - 12) : "");

    const s1 = getComputedStyle(document.documentElement).getPropertyValue("--s1").trim();
    const s2 = getComputedStyle(document.documentElement).getPropertyValue("--s2").trim();
    const labelCur = f.ytd ? "Período atual" : m.label, labelPrev = "Período anterior";
    $("#legend").replaceChildren(...(f.ytd ? [
      h("span", {}, h("i", { style: "background:" + s1 }), `${labelCur} (${rangeText(f.from, f.to)})`),
      h("span", {}, h("i", { style: "background:" + s2 }), `${labelPrev} (${rangeText(f.from - 12, f.to - 12)})`)] : []));

    const empty = !S.mk.count;
    let em = $("#chart-empty");
    if (!em) { em = h("div", { class: "empty", id: "chart-empty", hidden: true }, "Nenhum dado para os filtros selecionados."); $("#chart-box").append(em); }
    em.hidden = !empty;
    $("#chart").hidden = empty;
    $("#chart-box").hidden = S.chartView !== "chart";
    $("#legend").hidden = S.chartView !== "chart";
    $("#chart-table").hidden = S.chartView !== "table";

    if (S.chartView === "chart") {
      if (empty) NV.charts.destroy();
      else {
        const datasets = [{ label: labelCur, data: d.cur, color: s1 }];
        if (d.prev) datasets.push({ label: labelPrev, data: d.prev, color: s2 });
        NV.charts.draw($("#chart"), { labels: d.labels, titles: d.titles, datasets, isMoney: m.money,
          deltaFn: d.prev ? (i) => { const c = d.cur[i], p = d.prev[i]; return p ? "Variação: " + fmt.pctSigned(((c - p) / Math.abs(p)) * 100) : "Variação: sem base anterior"; } : null });
      }
    } else renderChartTable(d, m);
  }

  function renderChartTable(d, m) {
    const val = (v) => (m.money ? fmt.plain(fmt.brl(v)) : fmt.int(v));
    const head = ["Mês", d.prev ? "Período atual" : m.label].concat(d.prev ? ["Período anterior", "Variação"] : []);
    const rows = d.pos.map((y, i) => {
      const cells = [h("td", {}, fmt.ymFull(y)), h("td", { class: "num" }, val(d.cur[i]))];
      if (d.prev) {
        const c = d.cur[i], p = d.prev[i];
        cells.push(h("td", { class: "num" }, val(p)), h("td", { class: "num" }, p ? fmt.pctSigned(((c - p) / Math.abs(p)) * 100) : "—"));
      }
      return h("tr", { class: "row" }, cells);
    });
    const tot = (a) => a.reduce((x, y) => x + y, 0);
    const foot = [h("td", {}, h("b", {}, "Total")), h("td", { class: "num" }, h("b", {}, val(tot(d.cur))))];
    if (d.prev) { const c = tot(d.cur), p = tot(d.prev); foot.push(h("td", { class: "num" }, h("b", {}, val(p))), h("td", { class: "num" }, h("b", {}, p ? fmt.pctSigned(((c - p) / Math.abs(p)) * 100) : "—"))); }
    $("#chart-table").replaceChildren(h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: i ? "num" : "", style: "cursor:default" }, t)))), h("tbody", {}, rows, h("tr", {}, foot))));
  }

  /* ---------- rankings ---------- */
  function buildRankTabs() {
    const tabs = $("#rank-tabs");
    tabs.hidden = S.p.user.tipo === "RCA";
    tabs.replaceChildren(...[["rca", "RCAs"], ["cli", "Clientes"]].map(([id, label]) =>
      h("button", { type: "button", "data-r": id, "aria-pressed": String(id === S.rankTab), onclick: () => { S.rankTab = id; renderRank(); } }, label)));
  }

  function wireCard() {
    if (S.wired) return;
    S.wired = true;
    $$("#metric-seg button").forEach((b) => b.addEventListener("click", () => {
      S.metric = b.dataset.m; $$("#metric-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderChart();
    }));
    $$("#view-seg button").forEach((b) => b.addEventListener("click", () => {
      S.chartView = b.dataset.v; $$("#view-seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderChart();
    }));
    $("#btn-pdf").addEventListener("click", openPdf);
    $("#btn-csv").addEventListener("click", exportCsv);
    $("#btn-csv2").addEventListener("click", exportCsv);
    $("#btn-user").addEventListener("click", () => openDrawer($("#menu-drawer")));
    $("#btn-menu").addEventListener("click", () => openDrawer($("#menu-drawer")));
    $("#bb-profile").addEventListener("click", () => openDrawer($("#menu-drawer")));
    $("#btn-close-menu").addEventListener("click", closeAll);
    $("#scrim").addEventListener("click", closeAll);
    $("#bb-back").addEventListener("click", goBack);
    $("#bb-filters").addEventListener("click", openFilters);
    $("#bb-actions").addEventListener("click", () => $("#modal-actions").showModal());
    $("#act-pdf").addEventListener("click", () => { $("#modal-actions").close(); openPdf(); });
    $("#act-csv").addEventListener("click", () => { $("#modal-actions").close(); exportCsv(); });
    $$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
    $$("dialog").forEach((dl) => dl.addEventListener("click", (e) => { if (e.target === dl) dl.close(); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
    $$("#theme-seg button").forEach((b) => b.addEventListener("click", () => { NV.store.set("nv_theme", b.dataset.t); applyTheme(b.dataset.t); }));
    $$("#menu-drawer [data-go]").forEach((b) => b.addEventListener("click", () => {
      const go = b.dataset.go; closeAll();
      if (go === "home") scrollTo({ top: 0, behavior: "smooth" });
      else if (go === "filters") openFilters();
      else if (go === "pdf") openPdf();
      else if (go === "csv") exportCsv();
      else if (go === "admin") openAdmin();
      else if (go === "logout") logout();
    }));
    $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const t = $("#" + b.dataset.copy).textContent;
      try { await navigator.clipboard.writeText(t); NV.toast("Comando copiado.", "ok", 2000); } catch (e) { NV.toast("Não foi possível copiar; selecione o texto manualmente.", "err"); }
    }));
    $$('input[name="pdf-dest"]').forEach((r) => r.addEventListener("change", refreshPdfModal));
    $("#pdf-client-mail").addEventListener("input", () => { $("#pdf-error").hidden = true; });
    $("#pdf-send").addEventListener("click", () => sendPdf(false));
    const alt = h("button", { class: "btn btn-ghost", type: "button", id: "pdf-mailto", hidden: true }, "Baixar e abrir e-mail");
    alt.addEventListener("click", () => sendPdf(true));
    $("#pdf-send").before(alt);
  }

  function renderRank() {
    const e = S.eng, p = S.p, tab = S.rankTab;
    $$("#rank-tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === tab)));
    $("#rank-title").textContent = tab === "rca" ? "Ranking de RCAs" : "Ranking de clientes";
    $("#rank-sub").textContent = "Ordenado por valor líquido no período" + (tab === "cli" ? " · clique no cliente para ver o histórico" : "");
    if (!S.rankTables) S.rankTables = {};
    const root = $("#rank-table");
    if (!S.rankTables.rca) {
      S.rankTables.rca = { el: h("div", {}), t: null }; S.rankTables.cli = { el: h("div", {}), t: null };
      root.replaceChildren(S.rankTables.rca.el, S.rankTables.cli.el);
    }
    S.rankTables.rca.el.hidden = tab !== "rca"; S.rankTables.cli.el.hidden = tab !== "cli";
    const total = S.sum.liq;
    const pctCell = (v) => total > 0 ? h("div", { class: "pct-cell" }, h("span", {}, fmt.pct((v / total) * 100)), h("span", { class: "pct-bar", "aria-hidden": "true" }, h("i", { style: `width:${Math.max(0, Math.min(100, (v / total) * 100))}%` }))) : "—";
    const posCell = (n) => n <= 3 ? h("span", { class: "pos p" + n }, icon("i-medal"), n) : h("span", { class: "pos" }, n);
    const money = (v) => h("span", { class: v < 0 ? "neg" : "" }, fmt.plain(fmt.brl(v)));

    if (tab === "rca") {
      const g = e.byRca(S.mk);
      const order = g.ids.slice().sort((a, b) => g.liq[b] - g.liq[a]);
      const pos = new Map(order.map((id, i) => [id, i + 1]));
      const R = S.rankTables.rca;
      if (!R.t) {
        const rk = e.rank("rca");
        R.t = new NV.Table(R.el, { pageSize: 25, pageSizes: [10, 25, 50], sort: { key: "liq", dir: "desc" }, columns: [
          { key: "pos", label: "#", sort: (id) => R.pos.get(id), cell: (id) => posCell(R.pos.get(id)) },
          { key: "rca", label: "RCA", sort: (id) => rk[id], cell: (id) => p.rca[id].n, cls: "wrap" },
          { key: "sup", label: "Supervisor", sort: (id) => (p.sup[p.rca[id].s] ? p.sup[p.rca[id].s].n : ""), cell: (id) => (p.sup[p.rca[id].s] ? p.sup[p.rca[id].s].n : "") },
          { key: "liq", label: "Valor líquido", num: true, sort: (id) => R.g.liq[id], cell: (id) => money(R.g.liq[id]) },
          { key: "pct", label: "% do total", num: true, sort: (id) => R.g.liq[id], cell: (id) => pctCell(R.g.liq[id]) },
          { key: "cli", label: "Clientes", num: true, sort: (id) => R.g.clientes[id], cell: (id) => fmt.int(R.g.clientes[id]) },
          { key: "qtd", label: "Itens", num: true, sort: (id) => R.g.qtd[id], cell: (id) => fmt.int(R.g.qtd[id]) },
        ] });
      }
      R.g = g; R.pos = pos; R.t.setRows(g.ids, true);
    } else {
      const g = e.byClient(S.mk);
      const order = g.ids.slice().sort((a, b) => g.liq[b] - g.liq[a]);
      const pos = new Map(order.map((id, i) => [id, i + 1]));
      const R = S.rankTables.cli;
      if (!R.t) {
        const rk = e.rank("cli");
        R.t = new NV.Table(R.el, { pageSize: 10, sort: { key: "liq", dir: "desc" }, empty: "Nenhum cliente para os filtros selecionados.", columns: [
          { key: "pos", label: "#", sort: (id) => R.pos.get(id), cell: (id) => posCell(R.pos.get(id)) },
          { key: "cli", label: "Cliente", sort: (id) => rk[id], cls: "wrap", cell: (id) => h("button", { type: "button", class: "linklike", title: "Ver histórico deste cliente", onclick: () => {
            S.f.clientes = new Set([id]); S.f.principais = new Set(); commit(); $("#detail-card").scrollIntoView({ behavior: "smooth" });
          } }, p.cli[id].n) },
          { key: "city", label: "Cidade", sort: (id) => p.cli[id].y, cell: (id) => p.cli[id].y },
          { key: "liq", label: "Valor líquido", num: true, sort: (id) => R.g.liq[id], cell: (id) => money(R.g.liq[id]) },
          { key: "pct", label: "% do total", num: true, sort: (id) => R.g.liq[id], cell: (id) => pctCell(R.g.liq[id]) },
          { key: "qtd", label: "Itens", num: true, sort: (id) => R.g.qtd[id], cell: (id) => fmt.int(R.g.qtd[id]) },
          { key: "last", label: "Última compra", num: true, sort: (id) => R.g.last[id], cell: (id) => (R.g.last[id] >= 0 ? fmt.ymNum(R.g.last[id]) : "—") },
        ] });
      }
      R.g = g; R.pos = pos; R.t.setRows(g.ids, true);
    }
  }

  /* ---------- tabela de detalhe ---------- */
  function renderDetail() {
    const e = S.eng, p = S.p;
    if (!S.detail) {
      const rc = e.rank("cli"), rp = e.rank("prod"), rf = e.rank("forn");
      const money = (v) => h("span", { class: v < 0 ? "neg" : "" }, fmt.plain(fmt.brl(v)));
      const kv = (k, v) => h("div", {}, h("dt", {}, k), h("dd", {}, v));
      S.detail = new NV.Table($("#detail-table"), {
        pageSize: 10, sort: { key: "ym", dir: "desc" }, empty: "Nenhum registro para os filtros selecionados.",
        columns: [
          { key: "cli", label: "Cliente", sort: (i) => rc[e.cli[i]], cell: (i) => p.cli[e.cli[i]].n, cls: "wrap" },
          { key: "doc", label: "CNPJ/CPF", sort: (i) => p.cli[e.cli[i]].d, cell: (i) => p.cli[e.cli[i]].d, cls: "nowrap" },
          { key: "cod", label: "Código", num: true, sort: (i) => p.cli[e.cli[i]].c, cell: (i) => p.cli[e.cli[i]].c },
          { key: "lab", label: "Laboratório", sort: (i) => rf[e.prodForn[e.prod[i]]], cell: (i) => p.forn[e.prodForn[e.prod[i]]], cls: "nowrap" },
          { key: "prod", label: "Produto", sort: (i) => rp[e.prod[i]], cell: (i) => p.prod[e.prod[i]].n, cls: "wrap" },
          { key: "ym", label: "Mês/Ano", num: true, sort: (i) => e.ym[i], cell: (i) => fmt.ymNum(e.ym[i]), cls: "nowrap" },
          { key: "qtd", label: "Qtd", num: true, sort: (i) => e.qtd[i], cell: (i) => fmt.int(e.qtd[i]) },
          { key: "venda", label: "Venda (R$)", num: true, sort: (i) => e.venda[i], cell: (i) => money(e.venda[i]), cls: "nowrap" },
          { key: "dev", label: "Devolução (R$)", num: true, sort: (i) => e.dev[i], cell: (i) => money(e.dev[i]), cls: "nowrap" },
          { key: "liq", label: "Líquido (R$)", num: true, sort: (i) => e.liq[i], cell: (i) => money(e.liq[i]), cls: "nowrap" },
        ],
        expand: (i) => {
          const r = e.row(i);
          return h("dl", { class: "detail-grid", style: "margin:0" },
            kv("Cliente principal", `${r.principal.n} (cód. ${r.principal.c})`), kv("Cidade / bairro", `${r.cli.y} / ${r.cli.b}`),
            kv("Tipo de cliente", r.cli.t === "F" ? "Físico" : "Jurídico"), kv("RCA", r.rca.n), kv("Supervisor", r.sup || "—"),
            kv("Preço médio unitário (líquido ÷ qtd)", r.qtd > 0 ? fmt.plain(fmt.brl(r.liq / r.qtd)) : "—"),
            kv("% de devolução", r.venda > 0 ? fmt.pct((r.dev / r.venda) * 100) : "—"));
        },
      });
    }
    S.detail.setRows(e.rowIds(S.mk));
    $("#detail-sub").textContent = `${fmt.int(S.mk.count)} registro${S.mk.count === 1 ? "" : "s"} · ${fmt.int(S.sum.clientes)} cliente${S.sum.clientes === 1 ? "" : "s"} positivado${S.sum.clientes === 1 ? "" : "s"} · clique na linha para ver detalhes`;
  }

  /* ================================================================ gavetas */
  function openDrawer(el) { closeAll(); el.classList.add("on"); el.setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on"); }
  function openFilters() {
    if (isMobile()) { closeAll(); $("#filters").classList.add("on"); $("#scrim").classList.add("on"); }
    else $("#filters").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function closeAll() {
    $$(".drawer").forEach((d) => { d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); });
    $("#filters").classList.remove("on");
    $("#scrim").classList.remove("on");
  }

  /* ================================================================ exportar */
  function exportCsv() {
    if (!S.mk.count) return NV.toast("Não há registros para exportar.", "err");
    NV.download(NV.exporters.buildCsv(S.eng, S.eng.rowIds(S.mk)), "historico_clientes_" + NV.exporters.stamp() + ".csv");
    NV.toast(`CSV com ${fmt.int(S.mk.count)} registros gerado.`, "ok");
  }

  function filtersText() {
    const f = S.f, p = S.p, out = [];
    const list = (set, nameOf) => [...set].slice(0, 4).map(nameOf).join(", ") + (set.size > 4 ? ` e mais ${set.size - 4}` : "");
    if (f.tipo) out.push("Tipo: " + (f.tipo === "F" ? "Físico" : "Jurídico"));
    if (f.clientes.size) out.push("Cliente: " + list(f.clientes, (i) => p.cli[i].n));
    if (f.principais.size) out.push("Cliente principal: " + list(f.principais, (i) => p.pr[i].n));
    if (f.labs.size) out.push("Laboratório: " + list(f.labs, (i) => p.forn[i]));
    if (f.months.size) out.push("Meses: " + [...f.months].sort((a, b) => a - b).map((m) => NV.MESES_ABR[m]).join(", "));
    if (f.prods.size) out.push("Produto: " + list(f.prods, (i) => p.prod[i].n));
    if (f.sup >= 0) out.push("Supervisor: " + p.sup[f.sup].n);
    if (f.rcas.size) out.push("RCA: " + list(f.rcas, (i) => p.rca[i].n));
    return out.length ? out.join("; ") : "Nenhum filtro adicional";
  }

  function periodText() {
    const f = S.f, y0 = Math.floor(f.from / 12), y1 = Math.floor(f.to / 12);
    const last = new Date(y1, (f.to % 12) + 1, 0).getDate();
    const pad = (n) => String(n).padStart(2, "0");
    return `01/${pad((f.from % 12) + 1)}/${y0} até ${last}/${pad((f.to % 12) + 1)}/${y1}` + (f.months.size ? ` (meses: ${[...f.months].sort((a, b) => a - b).map((m) => NV.MESES_ABR[m]).join(", ")})` : "");
  }

  /* ---------- envio de PDF ---------- */
  function pdfScope() {
    const e = S.eng, ids = e.rowIds(S.mk), cli = new Set(), pr = new Set();
    for (const i of ids) { cli.add(e.cli[i]); pr.add(e.cliPr[e.cli[i]]); }
    return { ids, cli, pr };
  }

  function openPdf() {
    if (!window.jspdf) return NV.toast("O gerador de PDF ainda está carregando. Tente de novo em instantes.", "err");
    S.pdf = pdfScope();
    const u = S.user, sc = S.pdf, hasEndpoint = !!NV.remote.endpoint;
    $("#pdf-summary").replaceChildren(
      h("div", {}, h("small", {}, "Registros"), h("b", {}, fmt.int(sc.ids.length))),
      h("div", {}, h("small", {}, "Clientes"), h("b", {}, fmt.int(sc.cli.size))),
      h("div", {}, h("small", {}, "Período"), h("b", {}, rangeText(S.f.from, S.f.to))),
      h("div", {}, h("small", {}, "Valor líquido"), h("b", {}, fmt.plain(fmt.brl(S.sum.liq)))));
    $("#pdf-my-mail").textContent = u.pendente ? "E-mail ainda não cadastrado para o seu usuário — peça ao gerente." : u.email;
    const me = $('input[name="pdf-dest"][value="me"]');
    me.disabled = u.pendente;
    me.checked = !u.pendente;
    $('input[name="pdf-dest"][value="client"]').checked = u.pendente;
    $("#pdf-client-mail").value = "";
    $("#pdf-error").hidden = true;
    $("#pdf-send").textContent = hasEndpoint ? "Enviar PDF" : "Baixar PDF";
    $("#pdf-mailto").hidden = hasEndpoint;
    refreshPdfModal();
    $("#modal-pdf").showModal();
  }

  function refreshPdfModal() {
    const sc = S.pdf, dest = $('input[name="pdf-dest"]:checked').value, alert = $("#pdf-alert");
    $("#pdf-client-wrap").hidden = dest !== "client";
    let msg = "", block = false;
    if (!sc.ids.length) { msg = "Não há registros para os filtros atuais."; block = true; }
    else if (sc.ids.length > NV.exporters.MAX_PDF_ROWS) { msg = `Há ${fmt.int(sc.ids.length)} registros — o PDF comporta até ${fmt.int(NV.exporters.MAX_PDF_ROWS)}. Refine os filtros (por exemplo, selecione um cliente ou um período menor).`; block = true; }
    else if (dest === "client" && sc.pr.size !== 1) { msg = "Para enviar ao cliente, selecione um único cliente (ou cliente principal): o PDF não pode conter dados de outros clientes."; block = true; }
    else if (!NV.remote.endpoint) msg = "O envio automático de e-mail ainda não foi configurado: o PDF será baixado para você anexar ao e-mail.";
    alert.textContent = msg; alert.hidden = !msg;
    $("#pdf-send").disabled = block; $("#pdf-mailto").disabled = block;
  }

  async function sendPdf(openMail) {
    const u = S.user, e = S.eng, sc = S.pdf, dest = $('input[name="pdf-dest"]:checked').value;
    const err = $("#pdf-error"); err.hidden = true;
    let to = u.email;
    if (dest === "client") {
      to = $("#pdf-client-mail").value.trim();
      if (!NV.validEmail(to)) { err.textContent = "Informe um e-mail de cliente válido."; err.hidden = false; return; }
      if (sc.pr.size !== 1) return;
    } else if (u.pendente) { err.textContent = "Seu e-mail não está cadastrado."; err.hidden = false; return; }

    const btns = [$("#pdf-send"), $("#pdf-mailto")], label = $("#pdf-send").textContent;
    btns.forEach((b) => (b.disabled = true));
    $("#pdf-send").textContent = NV.remote.endpoint ? "Enviando…" : "Gerando…";
    await new Promise((r) => setTimeout(r, 30));                       // deixa o navegador pintar o estado
    try {
      const ids = NV.exporters.sortRows(e, sc.ids);
      let clientLine = "", clientName = "";
      if (sc.cli.size === 1 || sc.pr.size === 1) {
        const c = S.p.cli[[...sc.cli][0]];
        if (sc.cli.size === 1) { clientLine = `Cliente: ${c.n}  |  CNPJ/CPF: ${c.d}  |  ${c.y}`; clientName = c.n; }
        else { const pr = S.p.pr[c.p]; clientLine = `Cliente principal: ${pr.n}`; clientName = pr.n; }
      }
      const { doc, filename } = NV.exporters.buildPdf({ eng: e, ids, sum: S.sum, user: u, periodText: periodText(), filtersText: filtersText(), clientLine, clientName });
      if (NV.remote.endpoint) {
        await NV.remote.sendEmail({ token: TOKEN, to, filename, pdf: NV.exporters.pdfBase64(doc), destino: dest,
          subject: "Histórico de compras — Novavet Distribuidora" + (clientName ? " — " + clientName : ""),
          resumo: { registros: ids.length, clientes: sc.cli.size, periodo: periodText(), filtros: filtersText() } });
        $("#modal-pdf").close();
        NV.toast("✅ E-mail enviado com sucesso!", "ok");
      } else {
        doc.save(filename);
        $("#modal-pdf").close();
        NV.toast("PDF gerado. Anexe o arquivo ao e-mail.", "ok");
        if (openMail) location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent("Histórico de compras — Novavet Distribuidora")}&body=${encodeURIComponent("Olá,\n\nSegue em anexo o histórico de compras.\n\n" + u.nome + "\nNovavet Distribuidora")}`;
      }
    } catch (ex) {
      console.error(ex);
      err.textContent = "Não foi possível concluir: " + (ex.message || "erro desconhecido") + ".";
      err.hidden = false;
    } finally {
      $("#pdf-send").textContent = label;
      refreshPdfModal();
    }
  }

  /* ================================================================ administração (gerente) */
  async function openAdmin() {
    const a = S.p.admin;
    if (!a) return;
    const date = (s) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
    const st = (s) => h("span", { class: "status " + s.toLowerCase() }, s);
    $("#admin-users").replaceChildren(h("table", { class: "tbl" },
      h("thead", {}, h("tr", {}, ["Nome", "Perfil", "Login", "Status", "Token", "Criado", "Renovado"].map((t) => h("th", { style: "cursor:default" }, t)))),
      h("tbody", {}, a.usuarios.map((x) => h("tr", {}, h("td", { class: "wrap" }, x.nome), h("td", {}, x.tipo), h("td", { class: "wrap" }, x.email), h("td", {}, st(x.status)),
        h("td", {}, h("code", {}, x.tokenId)), h("td", {}, date(x.criado)), h("td", {}, date(x.renovado)))))));
    const log = $("#admin-log");
    $("#modal-admin").showModal();
    if (!NV.remote.endpoint) { log.textContent = "O log fica disponível depois de configurar o Apps Script (campo emailEndpoint em site/config.js). Veja o README."; return; }
    log.textContent = "Carregando…";
    try {
      const linhas = await NV.remote.fetchLog(TOKEN);
      log.replaceChildren(linhas.length ? h("div", { class: "table-wrap", style: "max-height:260px" }, h("table", { class: "tbl" },
        h("thead", {}, h("tr", {}, ["Data", "Usuário", "Ação", "Detalhe"].map((t) => h("th", { style: "cursor:default" }, t)))),
        h("tbody", {}, linhas.map((l) => h("tr", {}, h("td", { class: "nowrap" }, l[0]), h("td", { class: "wrap" }, l[1]), h("td", {}, l[2]), h("td", { class: "wrap" }, l[3] || "")))))) : "Nenhum registro ainda.");
    } catch (ex) { log.textContent = "Não foi possível carregar o log: " + ex.message; }
  }
})();

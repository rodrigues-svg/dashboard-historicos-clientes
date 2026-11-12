/* Funções inspiradas no painel do supervisor: Meu mês (meta x vendido, ritmo e quanto falta por dia útil),
   Oportunidades (famílias em queda/alta no ano e a pauta das maiores quedas por cliente) e Produtos (quem comprou). */
(function () {
  const NV = window.NV;
  const { h, $, fmt } = NV;
  const money = (v) => fmt.plain(fmt.brl0(v));
  const familia = (nome) => (/^BRAVECTO/i.test(nome) ? "BRAVECTO" : String(nome).trim().split(/\s+/)[0].toUpperCase());
  let C = null;                                                     // contexto da sessão {p, eng, token}

  /* ---------------------------------------------------------------- filtros comuns: supervisor (gerente), RCA (gerente e
     supervisor) e laboratório (todos). Valem para Meu mês, Oportunidades, Produtos e Conquistas. */
  const F = { sup: -1, rca: -1, lab: -1 };
  function rcasFiltro() {
    const { p } = C;
    return p.rca.map((r, i) => ({ i, c: r.c, s: r.s, n: r.n.replace(/ \(carteira própria\)$/, "") })).filter((r) => F.sup < 0 || r.s === F.sup);
  }
  /* RCAs marcados (null = todos) */
  function mascaraRca() {
    const e = C.eng;
    if (F.rca < 0 && F.sup < 0) return null;
    const m = new Uint8Array(e.nRca);
    if (F.rca >= 0) m[F.rca] = 1; else rcasFiltro().forEach((r) => (m[r.i] = 1));
    return m;
  }
  function barraFiltros(aoMudar, opc) {
    const { p } = C, u = p.user, o = opc || {};
    const campo = (rot, sel) => h("label", { class: "home-lab" }, h("span", {}, rot), sel);
    const out = [];
    if (u.tipo === "Gerente" && p.sup.length > 1) out.push(campo("Supervisor", h("select", { onchange: (ev) => { F.sup = +ev.target.value; F.rca = -1; aoMudar(); } },
      h("option", { value: -1 }, "Todos os supervisores"), p.sup.map((x, i) => h("option", { value: i, selected: i === F.sup }, x.n)))));
    const rcas = rcasFiltro();
    if (u.tipo !== "RCA" && rcas.length > 1) out.push(campo("RCA", h("select", { onchange: (ev) => { F.rca = +ev.target.value; aoMudar(); } },
      h("option", { value: -1 }, "Todos os RCAs"), rcas.map((r) => h("option", { value: r.i, selected: r.i === F.rca }, r.n)))));
    if (!o.semLab && p.forn.length > 1) out.push(campo("Laboratório", h("select", { onchange: (ev) => { F.lab = +ev.target.value; aoMudar(); } },
      h("option", { value: -1 }, "Todos os laboratórios"), p.forn.map((n, i) => h("option", { value: i, selected: i === F.lab }, n)))));
    return h("div", { class: "head-tools" }, out);
  }
  NV.filtrosPainel = { F, mascaraRca, barraFiltros, rcasFiltro };

  /* ---------------------------------------------------------------- dias úteis (seg-sex sem feriados nacionais) */
  function pascoa(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const mes = Math.floor((hh + l - 7 * m + 114) / 31), dia = ((hh + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mes - 1, dia);
  }
  function feriados(y) {
    const p = pascoa(y), mais = (n) => new Date(p.getFullYear(), p.getMonth(), p.getDate() + n);
    return new Set([[0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [11, 25]].map(([m, d]) => new Date(y, m, d).toDateString())
      .concat([mais(-48), mais(-47), mais(-2), mais(60)].map((d) => d.toDateString())));
  }
  function diasUteis(ano, mo, ateDia) {
    const fer = feriados(ano), fim = new Date(ano, mo + 1, 0).getDate();
    let total = 0, passados = 0;
    for (let d = 1; d <= fim; d++) {
      const dt = new Date(ano, mo, d);
      if (dt.getDay() === 0 || dt.getDay() === 6 || fer.has(dt.toDateString())) continue;
      total++; if (d <= ateDia) passados++;
    }
    return { total, passados };
  }

  /* ---------------------------------------------------------------- metas do ano (planilha oficial; só gerente e supervisores) */
  function blocoAno() {
    const { p, eng: e } = C, ma = p.metasAno;
    if (!ma || p.user.tipo === "RCA") return null;
    const ano = ma.ano, lab = F.lab >= 0 ? p.forn[F.lab] : "", total = F.sup < 0 && F.rca < 0 && ma.labs;
    const rcas = rcasFiltro(), alvo = F.rca >= 0 ? rcas.filter((r) => r.i === F.rca) : rcas;
    const soma = (a, b) => a.map((v, k) => v + (b[k] || 0));
    let meta = Array(12).fill(0), metaP = Array(12).fill(0), tem = false;
    if (total) {
      const ls = Object.entries(ma.labs).filter(([n]) => !lab || n === lab);
      ls.forEach(([, v]) => { meta = soma(meta, v); tem = true; });
      if (!lab) Object.values(ma.rca).forEach((m) => { metaP = soma(metaP, m.p); });
    } else if (!lab) {
      alvo.forEach((r) => { const m = ma.rca[String(r.c)]; if (m) { meta = soma(meta, m.m); metaP = soma(metaP, m.p); tem = true; } });
    }
    const titulo = h("h3", { class: "aval-h3" }, `Metas ${ano} mês a mês` + (lab ? " · " + lab : ""));
    if (!tem) return [titulo, h("p", { class: "note" }, lab ? "A meta por laboratório existe só no total da gerência. Tire o filtro de supervisor/RCA ou o de laboratório." : "Sem meta anual para esse filtro.")];
    const ok = new Uint8Array(e.nRca); (total ? rcas : alvo).forEach((r) => (ok[r.i] = 1));
    if (total) ok.fill(1);
    const y0 = ano * 12, liq = new Float64Array(24), cli = new Map();
    for (let i = 0; i < e.n; i++) {
      const y = e.ym[i], k = y - (y0 - 12);
      if (k < 0 || k > 23 || !ok[e.rca[i]]) continue;
      if (lab && p.forn[e.prodForn[e.prod[i]]] !== lab) continue;
      liq[k] += e.liq[i];
      if (k >= 12) { const kc = (k * e.nRca + e.rca[i]) * e.nCli + e.cli[i]; cli.set(kc, (cli.get(kc) || 0) + e.liq[i]); }
    }
    const posM = new Array(12).fill(0);
    cli.forEach((v, kc) => { if (v > 0.005) posM[Math.floor(kc / e.nCli / e.nRca) - 12]++; });
    const cheio = (y) => y < e.ymMax, visto = (y) => y <= e.ymMax;
    const linhas = [], tot = { m: 0, b: 0, mb: 0, r: 0, mp: 0, pr: 0 };
    for (let m = 0; m < 12; m++) {
      const yb = y0 - 12 + m, yr = y0 + m, base = cheio(yb) ? liq[m] : null, real = visto(yr) ? liq[12 + m] : null;
      tot.m += meta[m]; if (base != null) { tot.b += base; tot.mb += meta[m]; } if (real != null) { tot.r += real; tot.pr += posM[m]; } tot.mp += metaP[m];
      const pc = real != null && meta[m] ? (real / meta[m]) * 100 : null;
      linhas.push(h("tr", {}, h("td", {}, NV.MESES_ABR[m] + (yr === e.ymMax ? " *" : "")), h("td", { class: "num" }, money(meta[m])),
        h("td", { class: "num" }, base != null ? money(base) : "—"),
        h("td", { class: "num" }, base ? fmt.pct((meta[m] / base - 1) * 100) : "—"),
        h("td", { class: "num" }, real != null ? money(real) : "—"),
        h("td", { class: "num" }, pc != null ? h("div", { class: "tbar " + (pc >= 100 ? "ok" : "neu") }, h("span", {}, fmt.pct(pc)), h("i", { style: `width:${Math.min(100, pc)}%` })) : "—"),
        lab ? null : h("td", { class: "num" }, fmt.int(metaP[m])), lab ? null : h("td", { class: "num" }, real != null ? fmt.int(posM[m]) : "—")));
    }
    linhas.push(h("tr", { class: "tot" }, h("td", {}, h("b", {}, "Ano")), h("td", { class: "num" }, h("b", {}, money(tot.m))), h("td", { class: "num" }, money(tot.b)),
      h("td", { class: "num" }, tot.b ? fmt.pct((tot.mb / tot.b - 1) * 100) : "—"), h("td", { class: "num" }, tot.r ? money(tot.r) : "—"),
      h("td", { class: "num" }, tot.r && tot.m ? fmt.pct((tot.r / tot.m) * 100) : "—"), lab ? null : h("td", { class: "num" }, fmt.int(tot.mp)), lab ? null : h("td", { class: "num" }, tot.r ? fmt.int(tot.pr) : "—")));
    const cab = ["Mês", `Meta ${ano}`, `Realizado ${ano - 1}`, "Crescimento pedido", `Realizado ${ano}`, "Atingido"].concat(lab ? [] : ["Meta positivação", "Positivados"]);
    const quem = total ? "total da gerência (metas por laboratório)" : F.rca >= 0 ? "RCA selecionado" : F.sup >= 0 ? "equipe de " + p.sup[F.sup].n : "sua equipe";
    return [titulo, h("p", { class: "note" }, `Meta oficial ${ano} (${quem}): ${money(tot.m)} no ano. Crescimento do ano compara só os meses que já têm realizado do ano anterior. Realizado = faturamento líquido; positivados = clientes com compra no mês somados por RCA. * mês em andamento.`),
      h("div", { class: "table-wrap" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, cab.map((t, i) => h("th", { class: i ? "num" : "", style: "cursor:default" }, t)))), h("tbody", {}, linhas)))];
  }

  /* ================================================================ Meu mês */
  function renderMes() {
    const { p, eng: e } = C, box = $("#mes-card"), metas = p.metas || { rca: {} }, u = p.user;
    const ym = metas.ym != null ? metas.ym : e.ymMax, ano = Math.floor(ym / 12), mo = ym % 12;
    const ate = p.dia && Math.floor(p.dia.fim / 100) === ano * 100 + mo + 1 ? p.dia.fim % 100 : Math.max(1, new Date().getDate() - 1);
    const du = diasUteis(ano, mo, ate);
    const lab = F.lab >= 0 ? p.forn[F.lab] : "";
    const metaDe = (m) => (lab ? (m.f || {})[lab] || 0 : m.v);
    const rcas = rcasFiltro().map((r) => ({ ...r, m: metas.rca[String(r.c)] })).filter((r) => r.m);
    const alvo = F.rca >= 0 ? rcas.filter((r) => r.i === F.rca) : rcas;
    const ok = new Uint8Array(e.nRca); alvo.forEach((r) => (ok[r.i] = 1));
    // vendido no mês (venda imputada), positivação (clientes com venda) e por fornecedor
    let venda = 0; const porRca = new Float64Array(e.nRca), porForn = new Map(), cli = new Map(), cliRca = new Map();
    for (let i = 0; i < e.n; i++) {
      if (e.ym[i] !== ym) continue;
      if (F.lab >= 0 && e.prodForn[e.prod[i]] !== F.lab) continue;
      const r = e.rca[i], v = e.venda[i];
      porRca[r] += v;
      const kc = r * e.nCli + e.cli[i]; cliRca.set(kc, (cliRca.get(kc) || 0) + v);
      if (!ok[r]) continue;
      venda += v;
      const f = p.forn[e.prodForn[e.prod[i]]]; porForn.set(f, (porForn.get(f) || 0) + v);
      cli.set(e.cli[i], (cli.get(e.cli[i]) || 0) + v);
    }
    const pos = [...cli.values()].filter((v) => v > 0.005).length;
    const meta = alvo.reduce((s, r) => s + metaDe(r.m), 0), metaPos = lab ? 0 : alvo.reduce((s, r) => s + r.m.p, 0);
    const pct = meta > 0 ? (venda / meta) * 100 : 0, ritmo = du.total ? (du.passados / du.total) * 100 : 0;
    const falta = Math.max(0, meta - venda), restam = Math.max(0, du.total - du.passados);
    const metaForn = new Map();
    alvo.forEach((r) => Object.entries(r.m.f || {}).forEach(([f, v]) => { if (!lab || f === lab) metaForn.set(f, (metaForn.get(f) || 0) + v); }));
    const barra = (pc) => h("div", { class: "mes-bar" }, h("i", { style: `width:${Math.min(100, pc)}%` }), h("b", { style: `left:${Math.min(100, ritmo)}%` }));
    const sel = barraFiltros(renderMes);
    const status = pct >= ritmo ? "No ritmo" : pct >= ritmo * 0.85 ? "Perto do ritmo" : "Abaixo do ritmo";
    const ranking = rcas.length > 1 && F.rca < 0 ? rcas.map((r) => {
      let pr = 0; cliRca.forEach((v, k) => { if (Math.floor(k / e.nCli) === r.i && v > 0.005) pr++; });
      return { r, v: porRca[r.i], meta: metaDe(r.m), pc: metaDe(r.m) ? (porRca[r.i] / metaDe(r.m)) * 100 : 0, pos: pr };
    }).sort((a, b) => b.pc - a.pc) : [];

    if (!rcas.length) { box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Meu mês"), h("p", {}, "As metas do mês ainda não chegaram para esse filtro.")), barraFiltros(renderMes)), h("div", { class: "card-body" }, blocoAno())); return; }
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, `${NV.MESES[mo]} de ${ano}` + (lab ? " · " + lab : "")),
        h("p", {}, `Dados até ${String(ate).padStart(2, "0")}/${String(mo + 1).padStart(2, "0")} · ${du.passados} de ${du.total} dias úteis · faltam ${restam}`)), h("div", { class: "head-tools" }, sel)),
      h("div", { class: "card-body" },
        h("div", { class: "mes-grid" },
          h("div", { class: "kpi k-main" }, h("div", { class: "k-label" }, h("i", {}), "Vendido no mês"), h("div", { class: "k-value" }, money(venda)),
            h("div", { class: "k-delta" }, `de ${money(meta)} de meta`)),
          h("div", { class: "kpi" }, h("div", { class: "k-label" }, h("i", {}), "Meta atingida"), h("div", { class: "k-value" }, fmt.pct(pct)),
            barra(pct), h("div", { class: "k-delta" }, h("span", { class: "pill " + (pct >= ritmo ? "ok" : "warn") }, status), ` ritmo esperado ${fmt.pct(ritmo)}`)),
          h("div", { class: "kpi" }, h("div", { class: "k-label" }, h("i", {}), "Preciso vender por dia útil"), h("div", { class: "k-value" }, restam ? money(falta / restam) : "—"),
            h("div", { class: "k-delta" }, `faltam ${money(falta)} em ${restam} dias úteis`)),
          h("div", { class: "kpi k-sec" }, h("div", { class: "k-label" }, h("i", {}), "Clientes positivados" + (lab ? " (" + lab + ")" : "")), h("div", { class: "k-value" }, metaPos ? `${fmt.int(pos)} de ${fmt.int(metaPos)}` : fmt.int(pos)),
            metaPos ? barra((pos / metaPos) * 100) : null, h("div", { class: "k-delta" }, !metaPos ? "a meta de positivação é geral (sem laboratório)" : metaPos > pos ? `faltam ${fmt.int(metaPos - pos)}` : "meta de positivação batida"))),
        h("h3", { class: "aval-h3" }, "Por laboratório"),
        h("div", { class: "table-wrap" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["Laboratório", "Meta", "Vendido", "Atingido"].map((t, i) => h("th", { class: i ? "num" : "", style: "cursor:default" }, t)))),
          h("tbody", {}, [...metaForn.entries()].sort((a, b) => b[1] - a[1]).map(([f, mv]) => {
            const v = porForn.get(f) || 0, pc = mv ? (v / mv) * 100 : 0;
            return h("tr", {}, h("td", {}, f), h("td", { class: "num" }, money(mv)), h("td", { class: "num" }, money(v)), h("td", { class: "num" }, h("div", { class: "tbar " + (pc >= ritmo ? "ok" : "neu") }, h("span", {}, fmt.pct(pc)), h("i", { style: `width:${Math.min(100, pc)}%` }))));
          })))),
        ranking.length ? [h("h3", { class: "aval-h3" }, "Ranking da equipe (% da meta)"),
          h("div", { class: "table-wrap" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["#", "Vendedor", "Vendido", "Meta", "Atingido", "Positivação"].map((t, i) => h("th", { class: i > 1 ? "num" : "", style: "cursor:default" }, t)))),
            h("tbody", {}, ranking.map((x, k) => h("tr", {}, h("td", {}, k + 1), h("td", { class: "wrap" }, x.r.n), h("td", { class: "num" }, money(x.v)), h("td", { class: "num" }, money(x.meta)),
              h("td", { class: "num" }, h("div", { class: "tbar " + (x.pc >= ritmo ? "ok" : "neu") }, h("span", {}, fmt.pct(x.pc)), h("i", { style: `width:${Math.min(100, x.pc)}%` }))),
              h("td", { class: "num" }, lab ? fmt.int(x.pos) : `${fmt.int(x.pos)} / ${fmt.int(x.r.m.p)}`))))))] : null,
        blocoAno(),
        h("p", { class: "note" }, "Vendido = venda imputada no mês (base de vendas). Ritmo esperado = dias úteis passados ÷ dias úteis do mês. Metas: relatórios diários de metas por RCA, por laboratório e de positivação.")));
  }

  /* ================================================================ Oportunidades */
  const O = { fam: "" };
  function renderOport() {
    const { p, eng: e } = C, box = $("#oport-card");
    const fim = e.ymMax - 1, ano = Math.floor(fim / 12), ini = Math.max(ano * 12, e.ymMin);
    if (fim < ini || ini - 12 < e.ymMin) { box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Oportunidades"), h("p", {}, "Ainda não há meses fechados suficientes para comparar.")))); return; }
    const famProd = p.prod.map((x) => familia(x.n));
    const fam = new Map(), cliFam = new Map(), ok = mascaraRca();
    for (let i = 0; i < e.n; i++) {
      const y = e.ym[i];
      if ((ok && !ok[e.rca[i]]) || (F.lab >= 0 && e.prodForn[e.prod[i]] !== F.lab)) continue;
      const atual = y >= ini && y <= fim, ant = y >= ini - 12 && y <= fim - 12;
      if (!atual && !ant) continue;
      const f = famProd[e.prod[i]], l = e.liq[i];
      const o = fam.get(f) || { f, cur: 0, ant: 0 }; if (atual) o.cur += l; else o.ant += l; fam.set(f, o);
      const k = e.cli[i] + "|" + f, c = cliFam.get(k) || { c: e.cli[i], f, cur: 0, ant: 0 }; if (atual) c.cur += l; else c.ant += l; cliFam.set(k, c);
    }
    const tot = [...fam.values()].reduce((s, x) => ({ cur: s.cur + x.cur, ant: s.ant + x.ant }), { cur: 0, ant: 0 });
    const fams = [...fam.values()].filter((x) => Math.abs(x.cur) + Math.abs(x.ant) > 1000).sort((a, b) => (b.cur + b.ant) - (a.cur + a.ant)).slice(0, 14);
    const quedas = [...cliFam.values()].filter((x) => x.ant - x.cur >= 1000 && (!O.fam || x.f === O.fam)).sort((a, b) => (b.ant - b.cur) - (a.ant - a.cur));
    const dpc = (a, b) => (b > 0 ? fmt.pctSigned(((a - b) / b) * 100) : "novo");
    const card = (x, ativo) => h("button", { type: "button", class: "op-fam" + (ativo ? " on" : ""), onclick: () => { O.fam = O.fam === x.f ? "" : x.f; renderOport(); } },
      h("b", {}, x.f), h("span", { class: x.cur >= x.ant ? "up" : "down" }, (x.cur >= x.ant ? "+" : "−") + money(Math.abs(x.cur - x.ant))), h("small", {}, dpc(x.cur, x.ant)));
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Oportunidades"),
        h("p", {}, `${fmt.ym(ini)} a ${fmt.ym(fim)} comparado com ${fmt.ym(ini - 12)} a ${fmt.ym(fim - 12)} · só meses fechados · quedas a partir de R$ 1.000`)), barraFiltros(() => { O.fam = ""; renderOport(); })),
      h("div", { class: "card-body" },
        h("p", {}, h("b", {}, "Geral: "), `${money(tot.cur)} contra ${money(tot.ant)} (${dpc(tot.cur, tot.ant)})`),
        h("h3", { class: "aval-h3" }, "Famílias (toque para ver os clientes)"),
        h("div", { class: "op-grid" }, fams.map((x) => card(x, O.fam === x.f))),
        h("h3", { class: "aval-h3" }, O.fam ? `Clientes que mais caíram em ${O.fam}` : "Pauta da semana: as maiores quedas por cliente e família"),
        quedas.length ? h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
          h("thead", {}, h("tr", {}, ["Cliente", "Família", "Ano anterior", "Este ano", "Queda"].map((t, i) => h("th", { class: i > 1 ? "num" : "", style: "cursor:default" }, t)))),
          h("tbody", {}, quedas.slice(0, O.fam ? 50 : 10).map((x) => h("tr", {}, h("td", { class: "wrap" }, p.cli[x.c].n, h("small", { class: "muted" }, " · " + p.cli[x.c].y)), h("td", {}, x.f),
            h("td", { class: "num" }, money(x.ant)), h("td", { class: "num" }, money(x.cur)), h("td", { class: "num neg" }, "−" + money(x.ant - x.cur)))))))
          : h("p", { class: "note" }, "Nenhuma queda acima de R$ 1.000.")));
  }

  /* ================================================================ Produtos (quem comprou) */
  const P = { q: "" };
  function renderProd() {
    const { p, eng: e } = C, box = $("#prod-card");
    const inp = h("input", { type: "search", value: P.q, placeholder: "Digite ao menos 2 letras do produto", "aria-label": "Buscar produto" });
    inp.addEventListener("input", NV.debounce(() => { P.q = inp.value; renderProd(); const x = $("#prod-card input"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 250));
    const q = NV.norm(P.q);
    let corpo = h("p", { class: "note" }, "Digite ao menos 2 letras para buscar.");
    if (q.length >= 2) {
      const prods = new Set(); p.prod.forEach((x, i) => { if (NV.norm(x.n).includes(q)) prods.add(i); });
      const m = new Map(), ok = mascaraRca();
      for (let i = 0; i < e.n; i++) {
        if (!prods.has(e.prod[i]) || e.qtd[i] <= 0 || (ok && !ok[e.rca[i]])) continue;
        const k = e.cli[i] + "|" + e.prod[i], o = m.get(k) || { c: e.cli[i], pr: e.prod[i], ult: -1, qtd: 0, liq: 0 };
        o.qtd += e.qtd[i]; o.liq += e.liq[i]; if (e.ym[i] > o.ult) o.ult = e.ym[i]; m.set(k, o);
      }
      const l = [...m.values()].sort((a, b) => b.ult - a.ult || b.liq - a.liq);
      corpo = l.length ? [h("p", { class: "note" }, `${fmt.int(new Set(l.map((x) => x.c)).size)} clientes · ${prods.size} produto(s) encontrado(s) · toque no cliente para abrir o histórico`),
        h("div", { class: "table-wrap" }, h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["Cliente", "Produto", "Última compra", "Qtd", "Valor"].map((t, i) => h("th", { class: i > 1 ? "num" : "", style: "cursor:default" }, t)))),
          h("tbody", {}, l.slice(0, 200).map((x) => h("tr", { class: "row", onclick: () => NV.abrirCliente && NV.abrirCliente(x.c) }, h("td", { class: "wrap" }, p.cli[x.c].n), h("td", { class: "wrap" }, p.prod[x.pr].n),
            h("td", { class: "num" }, fmt.ymNum(x.ult)), h("td", { class: "num" }, fmt.int(x.qtd)), h("td", { class: "num" }, money(x.liq)))))))]
        : h("p", { class: "note" }, "Nenhum cliente da sua carteira comprou esse produto.");
    }
    box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Produtos"), h("p", {}, "Busque um produto e veja quais clientes compraram, da compra mais recente para a mais antiga.")), barraFiltros(renderProd, { semLab: true })),
      h("div", { class: "card-body" }, h("div", { class: "val-tools" }, inp), corpo));
  }

  NV.painel = {
    init(ctx) {
      C = ctx; F.sup = -1; F.rca = -1; F.lab = -1; O.fam = ""; P.q = "";
      const temMeta = !!(ctx.p.metas && Object.keys(ctx.p.metas.rca || {}).length) || !!(ctx.p.metasAno && ctx.p.user.tipo !== "RCA");
      $("#app-nav [data-view=mes]").hidden = !temMeta;
      return true;
    },
    mostrar(v) { if (!C) return; if (v === "mes") renderMes(); if (v === "oport") renderOport(); if (v === "prod") renderProd(); },
  };
})();

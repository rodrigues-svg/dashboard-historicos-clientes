/* Visão do cliente (modo apresentação para mostrar ao cliente) e Conquistas (o vendedor contra a sua melhor marca). */
(function () {
  const NV = window.NV;
  const { h, $, fmt } = NV;
  const money = (v) => fmt.plain(fmt.brl0(v));
  const familia = (nome) => (/^BRAVECTO/i.test(nome) ? "BRAVECTO" : String(nome).trim().split(/\s+/)[0].toUpperCase());
  let C = null;

  /* ================================================================ Visão do cliente */
  const VC = { cli: -1, q: "" };
  function dadosCliente(c) {
    const { p, eng: e } = C, lo = e.ymMax - 11, meses = new Float64Array(12), prods = new Map(), fams = new Map();
    let total = 0, ant = 0;
    for (let i = 0; i < e.n; i++) {
      if (e.cli[i] !== c) continue;
      const y = e.ym[i], l = e.liq[i];
      if (y >= lo - 12 && y < lo) ant += l;
      if (y < lo) continue;
      meses[y - lo] += l; total += l;
      const pn = p.prod[e.prod[i]].n;
      const o = prods.get(pn) || { n: pn, q: 0, v: 0 }; o.q += e.qtd[i]; o.v += l; prods.set(pn, o);
      const f = familia(pn); fams.set(f, (fams.get(f) || 0) + l);
    }
    return { lo, meses, total, ant, prods: [...prods.values()].filter((x) => x.v > 0).sort((a, b) => b.v - a.v), fams: [...fams.entries()].filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]) };
  }
  /* famílias que os clientes da carteira mais compram e este cliente não comprou em 12 meses */
  function sugestoes(c, fams) {
    const { p, eng: e } = C, lo = e.ymMax - 11, cont = new Map(), tem = new Set(fams.map((x) => x[0])), visto = new Set();
    for (let i = 0; i < e.n; i++) {
      if (e.ym[i] < lo || e.liq[i] <= 0) continue;
      const f = familia(p.prod[e.prod[i]].n), k = e.cli[i] + "|" + f;
      if (visto.has(k)) continue; visto.add(k); cont.set(f, (cont.get(f) || 0) + 1);
    }
    return [...cont.entries()].filter(([f]) => !tem.has(f)).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }
  function renderVisao() {
    const { p } = C, box = $("#visao-card");
    const inp = h("input", { type: "search", value: VC.q, placeholder: "Buscar cliente (nome, código ou CNPJ)", "aria-label": "Buscar cliente" });
    const res = h("div", { class: "stock-res" });
    inp.addEventListener("input", NV.debounce(() => {
      const q = NV.norm(inp.value), dig = NV.digits(inp.value); VC.q = inp.value;
      if (q.length < 2) { res.replaceChildren(); return; }
      const l = []; for (let i = 0; i < p.cli.length && l.length < 10; i++) { const c = p.cli[i]; if (NV.norm(c.n).includes(q) || String(c.c) === dig || (dig.length >= 4 && NV.digits(c.d).includes(dig))) l.push(i); }
      res.replaceChildren(...l.map((i) => h("button", { type: "button", class: "stock-op", onclick: () => { VC.cli = i; renderVisao(); } }, h("b", {}, p.cli[i].n), h("small", {}, `Cód. ${p.cli[i].c} · ${p.cli[i].y}`))));
    }, 150));
    const kids = [h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Visão do cliente"), h("p", {}, "Para mostrar ao cliente: o que ele comprou nos últimos 12 meses e o que mais pode trabalhar.")),
      VC.cli >= 0 ? h("div", { class: "head-tools" }, h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: apresentar }, "Modo apresentação")) : null),
    h("div", { class: "card-body" }, h("div", { class: "val-tools" }, inp), res)];
    if (VC.cli >= 0) kids.push(h("div", { class: "card-body", id: "visao-show" }, telaCliente(VC.cli)));
    box.replaceChildren(...kids);
  }
  function telaCliente(c) {
    const { p, eng: e } = C, cli = p.cli[c], d = dadosCliente(c), max = Math.max(1, ...d.meses);
    const var12 = d.ant > 0 ? ((d.total - d.ant) / d.ant) * 100 : null, sug = sugestoes(c, d.fams);
    return h("div", { class: "vc" },
      h("div", { class: "vc-top" }, h("img", { src: "img/logo.png", alt: "Novavet", class: "vc-logo" }),
        h("div", {}, h("h2", {}, cli.n), h("p", {}, `${cli.y} · Cód. ${cli.c} · últimos 12 meses (${fmt.ym(d.lo)} a ${fmt.ym(e.ymMax)})`))),
      h("div", { class: "vc-kpis" }, h("div", {}, h("small", {}, "Comprado em 12 meses"), h("b", {}, money(d.total))),
        h("div", {}, h("small", {}, "Contra os 12 meses anteriores"), h("b", { class: var12 == null ? "" : var12 >= 0 ? "up" : "down" }, var12 == null ? "—" : fmt.pctSigned(var12))),
        h("div", {}, h("small", {}, "Famílias de produto"), h("b", {}, fmt.int(d.fams.length))), h("div", {}, h("small", {}, "Produtos diferentes"), h("b", {}, fmt.int(d.prods.length)))),
      h("div", { class: "vc-bars" }, [...d.meses].map((v, k) => h("div", { class: "vc-bar", title: `${fmt.ym(d.lo + k)}: ${money(v)}` },
        h("i", { style: `height:${Math.max(2, (Math.max(0, v) / max) * 100)}%` }), h("small", {}, NV.MESES_ABR[(d.lo + k) % 12])))),
      h("div", { class: "vc-cols" },
        h("div", {}, h("h3", {}, "O que mais compra"), h("table", { class: "tbl" }, h("tbody", {}, d.prods.slice(0, 8).map((x) => h("tr", {}, h("td", { class: "wrap" }, x.n), h("td", { class: "num" }, fmt.int(x.q) + " un."), h("td", { class: "num" }, money(x.v))))))),
        h("div", {}, h("h3", {}, "Oportunidades para o seu negócio"), sug.length ? h("ul", { class: "vc-sug" }, sug.map(([f, n]) => h("li", {}, h("b", {}, f), ` · comprado por ${fmt.int(n)} clientes da região`)))
          : h("p", { class: "note" }, "Ele já trabalha as principais linhas."))));
  }
  function apresentar() {
    const el = $("#visao-show");
    el.classList.add("apresentacao");
    const sair = () => { el.classList.remove("apresentacao"); document.removeEventListener("fullscreenchange", fim); };
    const fim = () => { if (!document.fullscreenElement) sair(); };
    if (el.requestFullscreen) el.requestFullscreen().then(() => document.addEventListener("fullscreenchange", fim)).catch(() => {});
    if (!el.querySelector(".vc-sair")) el.prepend(h("button", { class: "btn btn-ghost btn-sm vc-sair", type: "button", onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); sair(); } }, "Sair da apresentação"));
  }

  /* ================================================================ Conquistas */
  const K = { sel: "" };
  /* medidas por mês, para um grupo de RCAs: aproveitamento da base, evolução, mix e recuperação */
  function medidas(ok, lab) {
    const { p, eng: e } = C, ini = e.ymMax - 24, n = e.ymMax - ini + 1;
    const porCli = new Map(), famCli = new Map(), liq = new Float64Array(n);
    const famProd = p.prod.map((x) => familia(x.n));
    for (let i = 0; i < e.n; i++) {
      const y = e.ym[i]; if (y < ini || (ok && !ok[e.rca[i]]) || (lab >= 0 && e.prodForn[e.prod[i]] !== lab)) continue;
      const k = y - ini, c = e.cli[i], l = e.liq[i];
      liq[k] += l;
      let a = porCli.get(c); if (!a) porCli.set(c, (a = new Float64Array(n))); a[k] += l;
      if (l > 0) { const kk = c * 64 + k; let s = famCli.get(kk); if (!s) famCli.set(kk, (s = new Set())); s.add(famProd[e.prod[i]]); }
    }
    const out = [];
    for (let k = 12; k < n; k++) {
      let base = 0, pos = 0, posBase = 0, recup = 0, famTot = 0;
      porCli.forEach((a, c) => {
        let na = false; for (let j = k - 12; j < k; j++) if (a[j] > 0.005) { na = true; break; }
        const comprou = a[k] > 0.005;
        if (na) base++;
        if (comprou) { pos++; if (na) posBase++; const s = famCli.get(c * 64 + k); famTot += s ? s.size : 0;
          if (na && !(a[k - 1] > 0.005 || a[k - 2] > 0.005 || a[k - 3] > 0.005)) recup++; }
      });
      out.push({ ym: ini + k, aprov: base ? (posBase / base) * 100 : 0, evol: liq[k - 12] > 0 ? ((liq[k] - liq[k - 12]) / liq[k - 12]) * 100 : null,
        mix: pos ? famTot / pos : 0, recup, pos, base });
    }
    return out;
  }
  function renderConq() {
    const { p, eng: e } = C, box = $("#conq-card"), u = p.user;
    const FP = NV.filtrosPainel;
    const ms = medidas(FP.mascaraRca(), FP.F.lab), ano = Math.floor(e.ymMax / 12);
    const doAno = ms.filter((m) => Math.floor(m.ym / 12) === ano), fechados = doAno.filter((m) => m.ym < e.ymMax), atual = ms[ms.length - 1];
    const defs = [
      { k: "aprov", n: "Aproveitamento da base", d: "clientes da carteira (12 meses) que compraram no mês", f: (v) => fmt.pct(v) },
      { k: "evol", n: "Evolução", d: "valor do mês contra o mesmo mês do ano anterior", f: (v) => (v == null ? "—" : fmt.pctSigned(v)) },
      { k: "mix", n: "Mix", d: "famílias de produto por cliente que comprou", f: (v) => fmt.num2(v).replace(/0$/, "") },
      { k: "recup", n: "Recuperação", d: "clientes parados há 3 meses que voltaram a comprar", f: (v) => fmt.int(v) },
    ];
    let recordes = 0;
    const cards = defs.map((d) => {
      const vals = fechados.map((m) => m[d.k]).filter((v) => v != null);
      const rec = vals.length ? Math.max(...vals) : null, mesRec = rec == null ? null : fechados.find((m) => m[d.k] === rec);
      let melhor = -Infinity; fechados.forEach((m) => { if (m[d.k] != null && m[d.k] > melhor) { if (melhor !== -Infinity) recordes++; melhor = m[d.k]; } });
      const cur = atual[d.k], bateu = rec != null && cur != null && cur >= rec;
      const pc = rec && cur != null && rec > 0 ? Math.max(0, Math.min(100, (cur / rec) * 100)) : 0;
      return h("div", { class: "kpi conq" + (bateu ? " ouro" : "") }, h("div", { class: "k-label" }, h("i", {}), d.n), h("div", { class: "k-value" }, d.f(cur)),
        h("div", { class: "mes-bar" }, h("i", { style: `width:${pc}%` })),
        h("div", { class: "k-delta" }, bateu ? "🏆 Novo recorde neste mês!" : rec == null ? "sem recorde ainda" : `Recorde: ${d.f(rec)} em ${fmt.ym(mesRec.ym)}`),
        h("small", { class: "muted" }, d.d));
    });
    const proxima = defs.map((d) => {
      const vals = fechados.map((m) => m[d.k]).filter((v) => v != null); if (!vals.length || atual[d.k] == null) return null;
      const rec = Math.max(...vals); return { d, falta: rec - atual[d.k], rec };
    }).filter((x) => x && x.falta > 0 && x.d.k !== "recup").sort((a, b) => a.falta / Math.abs(a.rec || 1) - b.falta / Math.abs(b.rec || 1))[0];
    const sel = FP.barraFiltros(renderConq);
    const melhorAprov = fechados.reduce((m, x) => (x.aprov > (m ? m.aprov : -1) ? x : m), null);
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Conquistas"), h("p", {}, `Você contra a sua melhor marca · ${NV.MESES[e.ymMax % 12]} de ${ano}, dados até ontem · recordes contam desde jan/${ano}`)), sel),
      h("div", { class: "card-body" },
        h("div", { class: "conq-top" }, h("div", {}, h("small", {}, "Recordes batidos em " + ano), h("b", {}, fmt.int(recordes))),
          proxima ? h("div", {}, h("small", {}, "Seu próximo recorde está perto"), h("b", {}, `${proxima.d.n}: faltam ${proxima.d.f(proxima.falta).replace(/^\+/, "")}`)) : h("div", {}, h("small", {}, "Próximo recorde"), h("b", {}, "continue assim!")),
          melhorAprov ? h("div", {}, h("small", {}, "Desafio: bater o melhor aproveitamento do ano"), h("b", {}, `${fmt.pct(melhorAprov.aprov)} em ${fmt.ym(melhorAprov.ym)} · hoje ${fmt.pct(atual.aprov)} (faltam ${fmt.int(Math.max(0, Math.ceil((melhorAprov.aprov - atual.aprov) / 100 * atual.base)))} clientes)`)) : null),
        h("div", { class: "mes-grid" }, cards),
        h("p", { class: "note" }, "O mês atual ainda está em andamento: os números sobem até o fim do mês. Recordes = melhor mês fechado do ano.")));
  }

  NV.extras = {
    init(ctx) { C = ctx; VC.cli = -1; VC.q = ""; K.sel = ""; },
    mostrar(v) { if (!C) return; if (v === "visao") renderVisao(); if (v === "conq") renderConq(); },
  };
})();

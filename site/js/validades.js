/* Validades: estoque da Novavet por lote (planilha diária "Validades E quantidades produtos"), o que vence primeiro
   e, ao tocar no produto, todos os lotes e os clientes da carteira que costumam comprar (para girar a validade curta). */
(function () {
  const NV = window.NV;
  const { h, $, fmt } = NV;
  const V = { ctx: null, lab: "", q: "", aberto: "", prazo: 0 };

  const data = (ymd) => `${String(ymd % 100).padStart(2, "0")}/${String(Math.floor(ymd / 100) % 100).padStart(2, "0")}/${Math.floor(ymd / 10000)}`;
  const dias = (ymd) => Math.round((new Date(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100) - new Date(new Date().toDateString())) / 864e5);
  const classe = (d) => (d <= 90 ? "v1" : d <= 180 ? "v2" : "v3");

  /* clientes do escopo que compraram o produto nos últimos 12 meses (mais recentes e maiores primeiro) */
  function compradores(nome) {
    const { p, eng: e } = V.ctx;
    const pr = p.prod.findIndex((x) => x.n === nome);
    if (pr < 0) return [];
    const m = new Map();
    for (let i = 0; i < e.n; i++) {
      if (e.prod[i] !== pr || e.ym[i] < e.ymMax - 11 || e.qtd[i] <= 0) continue;
      const c = e.cli[i], o = m.get(c) || { c, qtd: 0, ult: -1 };
      o.qtd += e.qtd[i]; if (e.ym[i] > o.ult) o.ult = e.ym[i]; m.set(c, o);
    }
    return [...m.values()].sort((a, b) => b.ult - a.ult || b.qtd - a.qtd).slice(0, 15);
  }

  function render() {
    const box = $("#val-card"), val = V.ctx.p.validades, p = V.ctx.p;
    const labs = [...new Set(val.itens.map((x) => x.f))].sort();
    const q = NV.norm(V.q);
    const lista = val.itens.filter((x) => (!V.lab || x.f === V.lab) && (!q || NV.norm(x.p).includes(q)) && (!V.prazo || dias(x.l[0][0]) <= V.prazo));
    const busca = h("input", { type: "search", placeholder: "Buscar produto", value: V.q, "aria-label": "Buscar produto" });
    busca.addEventListener("input", NV.debounce(() => { V.q = busca.value; render(); $("#val-card input[type=search]").focus(); }, 200));
    const chip = (rot, ativo, fn) => h("button", { type: "button", class: "chipf", "aria-pressed": String(ativo), onclick: fn }, rot);
    const linhas = [];
    for (const x of lista) {
      const d = dias(x.l[0][0]), total = x.l.reduce((s, l) => s + l[1], 0);
      linhas.push(h("tr", { class: "val-row", onclick: () => { V.aberto = V.aberto === x.p ? "" : x.p; render(); } },
        h("td", { class: "wrap" }, x.p, h("small", { class: "muted" }, " · " + x.f)),
        h("td", { class: "num" }, h("span", { class: "venc " + classe(d) }, data(x.l[0][0])), h("small", { class: "muted" }, ` ${d} dias`)),
        h("td", { class: "num" }, fmt.int(x.l[0][1])), h("td", { class: "num" }, fmt.int(total))));
      if (V.aberto === x.p) {
        const cl = compradores(x.p);
        linhas.push(h("tr", { class: "val-det" }, h("td", { colspan: "4" },
          h("p", {}, h("b", {}, "Lotes: "), x.l.map((l) => `${data(l[0])} (${fmt.int(l[1])} un.)`).join(" · ")),
          cl.length ? h("p", {}, h("b", {}, "Quem compra na sua carteira: "), cl.map((o) => `${p.cli[o.c].n} (${fmt.int(o.qtd)} un., últ. ${fmt.ym(o.ult)})`).join(" · "))
            : h("p", { class: "muted" }, "Nenhum cliente da sua carteira comprou este produto nos últimos 12 meses."))));
      }
    }
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Validades"),
        h("p", {}, `Validade mais curta de cada produto e as unidades dela · estoque de ${val.data || "hoje"} · toque no produto para ver os lotes e quem compra`))),
      h("div", { class: "card-body" },
        h("div", { class: "val-tools" }, chip("Todos", !V.lab, () => { V.lab = ""; render(); }), labs.map((l) => chip(l, V.lab === l, () => { V.lab = l; render(); })), busca),
        h("div", { class: "val-tools" }, [[0, "Qualquer prazo"], [90, "Vence em até 90 dias"], [180, "Até 180 dias"]].map(([d, r]) => chip(r, V.prazo === d, () => { V.prazo = d; render(); }))),
        h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
          h("thead", {}, h("tr", {}, ["Produto", "Validade mais curta", "Unidades dela", "Estoque total"].map((t, i) => h("th", { class: i ? "num" : "", style: "cursor:default" }, t)))),
          h("tbody", {}, linhas.length ? linhas : [h("tr", {}, h("td", { colspan: "4", class: "muted" }, "Nenhum produto com esse filtro."))]))),
        h("p", { class: "note" }, "Vermelho: vence em até 90 dias · amarelo: até 180 dias. Só lotes com saldo e ainda dentro da validade.")));
  }

  NV.val = {
    init(ctx) {
      Object.assign(V, { ctx, lab: "", q: "", aberto: "", prazo: 0 });
      const ativo = !!(ctx.p.validades && ctx.p.validades.itens && ctx.p.validades.itens.length);
      $("#app-nav [data-view=val]").hidden = !ativo;
      return ativo;
    },
    mostrar() { if (V.ctx && V.ctx.p.validades) render(); },
  };
})();

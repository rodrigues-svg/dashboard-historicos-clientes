/* Planejamento anual (5W2H): ações com responsável e prazo, agenda do ano (reuniões, jantares, datas comemorativas),
   ideias de campanhas e SWOT. Só Gerente e Supervisores (cada supervisor recebe só as ações dele e as "dos Supervisores").
   Alerta: compromisso da agenda nos próximos 7 dias, ação que começa em até 7 dias, que termina em até 15 dias ou
   com prazo vencido sem estar marcada como concluída na planilha. */
(function () {
  const NV = window.NV;
  const { h, $ } = NV;
  const P = { ctx: null, aba: "acoes", filtro: "todas", quem: "", aberta: -1 };
  const DSEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  const hoje = () => { const d = window.__nvHoje ? new Date(window.__nvHoje) : new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const dt = (iso) => (iso ? new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) : null);
  const dd = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ate = (d) => Math.round((d - hoje()) / 864e5);
  const emDias = (n) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);

  /* situação de uma ação no dia de hoje */
  function situacao(a) {
    if (a.ok) return { k: "ok", rot: "Concluída", alerta: false };
    const ini = dt(a.ini), fim = dt(a.fim);
    if (!ini || !fim) return { k: "nd", rot: "Sem data", alerta: false };
    const di = ate(ini), df = ate(fim);
    if (di > 0) return di <= 7 ? { k: "warn", rot: "Começa " + emDias(di), alerta: true, txt: "começa " + emDias(di) } : { k: "nd", rot: "Começa em " + dd(ini), alerta: false };
    if (df < 0) return { k: "bad", rot: "Prazo vencido em " + dd(fim), alerta: true, txt: "prazo venceu em " + dd(fim) };
    if (df <= 15) return { k: "warn", rot: "Termina " + emDias(df), alerta: true, txt: "termina " + emDias(df) + ` (${dd(fim)})` };
    return { k: "run", rot: "Em andamento até " + dd(fim), alerta: false };
  }
  const progresso = (a) => {
    const ini = dt(a.ini), fim = dt(a.fim);
    if (!ini || !fim || fim <= ini) return 0;
    return Math.max(0, Math.min(1, (hoje() - ini) / (fim - ini)));
  };

  /* agenda "achatada": um item por data (eventos de vários dias ficam com a lista de dias) */
  function agenda() {
    const pl = P.ctx.p.planejamento;
    return (pl.agenda || []).map((e) => {
      const ds = (e.d || []).map(dt);
      return { ...e, ds, mesN: ds.length ? ds[0].getMonth() : (e.mes || 1) - 1 };
    }).sort((a, b) => a.mesN - b.mesN || (a.ds[0] ? a.ds[0] - (b.ds[0] || 0) : 1));
  }
  const proximaData = (e) => e.ds.find((d) => ate(d) >= 0);

  function alertas() {
    const pl = P.ctx.p.planejamento, out = [];
    for (const e of agenda()) {
      const d = proximaData(e);
      if (d && ate(d) <= 7) out.push({ ord: ate(d), txt: `${e.t} ${emDias(ate(d))} (${dd(d)}${e.local ? ", " + e.local : ""})` });
    }
    for (const a of pl.acoes) {
      const s = situacao(a);
      if (s.alerta) out.push({ ord: s.k === "bad" ? -1 : 50, txt: `Ação "${a.que}" ${s.txt}` });
    }
    return out.sort((a, b) => a.ord - b.ord);
  }

  function atualizarAlerta() {
    const al = alertas(), barra = $("#plan-alert");
    $("#plan-dot").hidden = $("#hub-plan-dot").hidden = !al.length;
    if (!al.length) { barra.hidden = true; return; }
    $("#plan-alert-text").textContent = "Planejamento: " + al.slice(0, 2).map((x) => x.txt).join(" · ") + (al.length > 2 ? ` · e mais ${al.length - 2}` : "");
    barra.hidden = false;
  }

  /* ---------------------------------------------------------------- tela */
  const chip = (rot, ativo, fn) => h("button", { type: "button", class: "chipf", "aria-pressed": String(ativo), onclick: fn }, rot);
  const campo = (rot, v) => (v ? h("div", { class: "plan-f" }, h("b", {}, rot), h("span", {}, v)) : null);

  function telaAcoes() {
    const pl = P.ctx.p.planejamento, ger = P.ctx.p.user.tipo === "Gerente";
    const quens = [...new Set(pl.acoes.map((a) => a.quem || "Sem responsável"))].sort();
    const lista = pl.acoes.map((a, i) => ({ a, i, s: situacao(a) })).filter(({ a, s }) =>
      (!P.quem || (a.quem || "Sem responsável") === P.quem) &&
      (P.filtro === "todas" || (P.filtro === "atencao" && s.alerta) || (P.filtro === "andamento" && (s.k === "run" || s.k === "warn")) || (P.filtro === "ok" && s.k === "ok")));
    const sel = ger && quens.length > 1 ? h("label", { class: "home-lab" }, h("span", {}, "Responsável"),
      h("select", { onchange: (ev) => { P.quem = ev.target.value; render(); } },
        h("option", { value: "" }, "Todos"), quens.map((q) => h("option", { value: q, selected: q === P.quem }, q)))) : null;
    const n = (f) => pl.acoes.filter((a) => f(situacao(a))).length;
    return [
      h("div", { class: "val-tools" },
        chip(`Todas (${pl.acoes.length})`, P.filtro === "todas", () => { P.filtro = "todas"; render(); }),
        chip(`Pedem atenção (${n((s) => s.alerta)})`, P.filtro === "atencao", () => { P.filtro = "atencao"; render(); }),
        chip(`Em andamento (${n((s) => s.k === "run" || s.k === "warn")})`, P.filtro === "andamento", () => { P.filtro = "andamento"; render(); }),
        chip(`Concluídas (${n((s) => s.k === "ok")})`, P.filtro === "ok", () => { P.filtro = "ok"; render(); }), sel),
      lista.length ? h("div", { class: "plan-list" }, lista.map(({ a, i, s }) => {
        const aberta = P.aberta === i, ini = dt(a.ini), fim = dt(a.fim);
        return h("article", { class: "plan-item k-" + s.k },
          h("button", { type: "button", class: "plan-top", "aria-expanded": String(aberta), onclick: () => { P.aberta = aberta ? -1 : i; render(); } },
            h("div", { class: "plan-tit" }, h("b", {}, a.que),
              h("small", { class: "muted" }, [a.quem || "Sem responsável", a.reg, ini && fim ? `${dd(ini)}/${ini.getFullYear()} a ${dd(fim)}/${fim.getFullYear()}` : ""].filter(Boolean).join(" · "))),
            h("span", { class: "plan-badge k-" + s.k }, s.rot)),
          ini && fim && !a.ok ? h("div", { class: "plan-bar", title: "Tempo do prazo já decorrido" }, h("i", { style: `width:${Math.round(progresso(a) * 100)}%` })) : null,
          aberta ? h("div", { class: "plan-det" },
            campo("Objetivo", a.obj), campo("Por quê", a.porque), campo("Onde", a.onde), campo("Como", a.como),
            campo("Quanto custa", a.custo), campo("Status", a.status), campo("Comentário", a.coment)) : null);
      })) : h("div", { class: "empty" }, "Nenhuma ação com esse filtro."),
      h("p", { class: "note" }, "Toque na ação para ver o 5W2H completo. Para marcar como concluída, preencha a coluna \"Concluído?\" na planilha.")];
  }

  function telaAgenda() {
    const itens = agenda(), grupos = new Map();
    let proximo = null;
    for (const e of itens) {
      if (!grupos.has(e.mesN)) grupos.set(e.mesN, []);
      grupos.get(e.mesN).push(e);
      const d = proximaData(e);
      if (d && (!proximo || d < proximo.d)) proximo = { e, d };
    }
    const TIPO = { reuniao: "Reunião", jantar: "Jantar de negócios", evento: "Evento", data: "Data comemorativa" };
    return [h("div", { class: "plan-agenda" }, [...grupos].map(([m, es]) => h("section", {},
      h("h3", {}, NV.MESES[m]),
      es.map((e) => {
        const d = proximaData(e), passou = e.ds.length && !d, perto = d && ate(d) <= 7;
        const quando = e.ds.length ? e.ds.map((x) => `${dd(x)} ${DSEM[x.getDay()]}`).join(" · ") : "Mês todo";
        return h("div", { class: "plan-ev t-" + e.tipo + (passou ? " passou" : "") + (proximo && proximo.e === e ? " prox" : "") },
          h("span", { class: "plan-when" }, quando),
          h("div", {}, h("b", {}, e.t), h("small", { class: "muted" }, [TIPO[e.tipo], e.local, e.invest && "Investimento " + e.invest].filter(Boolean).join(" · "))),
          perto ? h("span", { class: "plan-badge k-warn" }, emDias(ate(d))) : proximo && proximo.e === e ? h("span", { class: "plan-badge k-run" }, "Próximo") : null);
      })))),
    h("p", { class: "note" }, "Alerta no início do app 7 dias antes de cada compromisso.")];
  }

  function telaCampanhas() {
    const c = P.ctx.p.planejamento.campanhas || [];
    return [h("div", { class: "plan-grid" }, c.map((t) => h("section", { class: "plan-box" }, h("h3", {}, t.tri), h("ul", {}, t.itens.map((x) => h("li", {}, x))))))];
  }

  function telaSwot() {
    const s = P.ctx.p.planejamento.swot || {};
    const box = (k, rot, cls) => h("section", { class: "plan-box " + cls }, h("h3", {}, rot), h("ul", {}, (s[k] || []).map((x) => h("li", {}, x))));
    return [h("div", { class: "plan-grid swot" }, box("forcas", "Forças", "sw-f"), box("fraquezas", "Fraquezas", "sw-w"),
      box("oportunidades", "Oportunidades", "sw-o"), box("ameacas", "Ameaças", "sw-t"))];
  }

  function render() {
    const pl = P.ctx.p.planejamento, al = alertas();
    const abas = [["acoes", "Ações"], ["agenda", "Agenda"], ["campanhas", "Campanhas"], ["swot", "SWOT"]]
      .filter(([k]) => k === "acoes" || (k === "agenda" ? (pl.agenda || []).length : k === "campanhas" ? (pl.campanhas || []).length : Object.keys(pl.swot || {}).length));
    const corpo = P.aba === "agenda" ? telaAgenda() : P.aba === "campanhas" ? telaCampanhas() : P.aba === "swot" ? telaSwot() : telaAcoes();
    const lido = pl.lido ? ` · planilha lida em ${dd(dt(pl.lido))}/${pl.lido.slice(0, 4)}` : "";
    $("#plan-card").replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Planejamento " + pl.ano),
        h("p", {}, (P.ctx.p.user.tipo === "Gerente" ? "Plano completo" : "Ações da sua equipe e dos supervisores") + lido)),
        h("div", { class: "head-tools" }, h("div", { class: "seg", role: "group", "aria-label": "Parte do planejamento" },
          abas.map(([k, r]) => h("button", { type: "button", "aria-pressed": String(P.aba === k), onclick: () => { P.aba = k; P.aberta = -1; render(); } }, r))))),
      h("div", { class: "card-body" },
        al.length ? h("div", { class: "plan-atencao", role: "status" }, h("b", {}, "Atenção agora"), h("ul", {}, al.map((x) => h("li", {}, x.txt)))) : null,
        corpo));
  }

  NV.plan = {
    init(ctx) {
      Object.assign(P, { ctx, aba: "acoes", filtro: "todas", quem: "", aberta: -1 });
      const ativo = !!(ctx.p.planejamento && ctx.p.planejamento.acoes);
      $("#app-nav [data-view=plan]").hidden = !ativo;
      if (ativo) atualizarAlerta(); else { $("#plan-alert").hidden = true; }
      return ativo;
    },
    mostrar() { if (P.ctx && P.ctx.p.planejamento) render(); },
    sair() { $("#plan-alert").hidden = true; },
  };
})();

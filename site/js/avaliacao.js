/* Avaliação qualitativa da visita: o supervisor (ou o gerente) avalia a visita do vendedor ao cliente com os mesmos critérios
   do Google Forms (notas de 1 a 5). O gerente vê as médias por vendedor/critério e extrai em CSV.
   Os dados ficam na planilha do log (via Apps Script), junto com o espelho das respostas do Forms. */
(function () {
  const NV = window.NV;
  const { h, $, fmt } = NV;

  const CRIT = [
    { k: "plano", n: "Plano da visita (objetivo / meta)" },
    { k: "imagem", n: "Imagem pessoal, postura e pontualidade" },
    { k: "quebra", n: "Quebra-gelo e conexão com todos" },
    { k: "pdv", n: "Observação do PDV: necessidades e oportunidades" },
    { k: "novos", n: "Positivação de novos itens" },
    { k: "campanhas", n: "Apresentação de campanhas e promocionais (histórico e potencial)" },
    { k: "proposta", n: "Montagem e apresentação da proposta / pedido" },
    { k: "objecoes", n: "Anotações de objeções e oportunidades" },
  ];
  const ATIV = ["CONTROLE DE ESTOQUE", "REABASTECIMENTO", "VALIDADES", "VERIFICAÇÃO PREÇOS", "EXECUÇÃO MERCHANDISING", "NENHUMA ATIVIDADE REALIZADA"];
  const A = { ctx: null, linhas: [], carregado: false, erro: "", form: null, de: "", ate: "", cliCache: new Map() };
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const br = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const media = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
  const nota = (v) => (v == null ? "—" : fmt.num2(v).replace(/0$/, ""));

  function vendedores() {
    const { p } = A.ctx;
    return p.rca.map((r, i) => ({ i, c: r.c, n: r.n.replace(/ \(carteira própria\)$/, ""), sup: p.sup[r.s] ? p.sup[r.s].n : "" }))
      .sort((a, b) => a.n.localeCompare(b.n, "pt-BR"));
  }
  /* clientes da carteira do vendedor (quem comprou dele nos últimos 12 meses) */
  function clientesDe(rcaIdx) {
    if (A.cliCache.has(rcaIdx)) return A.cliCache.get(rcaIdx);
    const e = A.ctx.eng, set = new Set();
    for (let i = 0; i < e.n; i++) if (e.rca[i] === rcaIdx && e.ym[i] >= e.ymMax - 11) set.add(e.cli[i]);
    const l = [...set].sort((a, b) => A.ctx.p.cli[a].n.localeCompare(A.ctx.p.cli[b].n, "pt-BR"));
    A.cliCache.set(rcaIdx, l);
    return l;
  }

  /* nomes digitados no Forms ("DIOGO MARTINS", "1132 - DIOGO ADILSON MARTINS"...) viram o vendedor da equipe quando
     batem sem ambiguidade; os da lista de exclusão (ex-vendedores, outras empresas) saem dos resultados */
  function ajustar(linhas) {
    const p = A.ctx.p, sem = (x) => NV.norm(x).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const fora = new Set(((p.avaliacao || {}).excluir || []).map(sem));
    const equipe = p.rca.map((r) => ({ c: r.c, n: r.n.replace(/ \(carteira própria\)$/, ""), t: sem(r.n.replace(/ \(carteira própria\)$/, "")).split(" ") }));
    const apelidos = new Map(Object.entries((p.avaliacao || {}).apelidos || {}).map(([n, c]) => [sem(n), +c]));
    const casa = (nome) => {
      if (apelidos.has(sem(nome))) { const r = equipe.find((x) => x.c === apelidos.get(sem(nome))); if (r) return r; }
      const cod = (nome.match(/^\s*(\d+)/) || [])[1];
      if (cod) { const r = equipe.find((x) => x.c === +cod); if (r) return r; }
      const t = sem(nome.replace(/^\s*\d+\s*-\s*/, "")).split(" ").filter((x) => x.length > 1);
      const ok = equipe.filter((r) => t.length && t.every((x) => r.t.includes(x)));
      if (ok.length === 1) return ok[0];
      const pn = equipe.filter((r) => t.length && r.t[0] === t[0]);     // senão, o primeiro nome, se for único na equipe
      return pn.length === 1 ? pn[0] : null;
    };
    return linhas.filter((l) => !fora.has(sem(l.vendedor))).map((l) => {
      const r = l.rca ? equipe.find((x) => x.c === l.rca) || casa(l.vendedor) : casa(l.vendedor);
      return r ? Object.assign({}, l, { rca: r.c, vendedor: r.n }) : l;
    });
  }

  async function carregar(forca) {
    if (A.carregado && !forca) return;
    A.erro = "";
    try { A.linhas = ajustar((await NV.remote.call("avaliacoes_ler", A.ctx.token)).linhas || []); A.carregado = true; }
    catch (x) { A.erro = x.message || "Não foi possível carregar as avaliações."; }
  }

  /* ---------------------------------------------------------------- formulário */
  function novoForm() {
    const v = vendedores();
    return { rca: v.length ? v[0].i : -1, cli: -1, data: hojeIso(), notas: {}, ativ: new Set(), final: null, obs: "" };
  }

  function renderForm() {
    const box = $("#aval-form"), p = A.ctx.p, f = A.form, vend = vendedores();
    const cliList = f.rca >= 0 ? clientesDe(f.rca) : [];
    const selV = h("select", { "aria-label": "Vendedor", onchange: (ev) => { f.rca = +ev.target.value; f.cli = -1; renderForm(); } },
      vend.map((x) => h("option", { value: x.i, selected: x.i === f.rca }, x.n + (A.ctx.p.user.tipo === "Gerente" && x.sup ? " · " + x.sup.split(" ")[0] : ""))));
    const busca = h("input", { type: "text", list: "aval-clis", placeholder: "Digite o nome do cliente", value: f.cli >= 0 ? p.cli[f.cli].n : "", "aria-label": "Cliente visitado" });
    busca.addEventListener("change", () => { const i = cliList.find((c) => p.cli[c].n === busca.value.trim()); f.cli = i == null ? -1 : i; renderForm(); });
    const dl = h("datalist", { id: "aval-clis" }, cliList.map((c) => h("option", { value: p.cli[c].n })));
    const data = h("input", { type: "date", value: f.data, max: hojeIso(), onchange: (ev) => { f.data = ev.target.value; } });

    const escala = (k, rot) => h("div", { class: "aval-crit" }, h("span", {}, rot),
      h("div", { class: "aval-esc", role: "radiogroup", "aria-label": rot }, [1, 2, 3, 4, 5].map((n) =>
        h("button", { type: "button", role: "radio", "aria-checked": String(f.notas[k] === n || (k === "final" && f.final === n)), class: "n" + n,
          onclick: () => { if (k === "final") f.final = n; else f.notas[k] = n; renderForm(); } }, String(n)))));
    const sugerida = media(CRIT.map((c) => f.notas[c.k]).filter((x) => x != null));
    const ativ = h("div", { class: "aval-ativ" }, ATIV.map((a) => h("label", { class: "chk" },
      h("input", { type: "checkbox", checked: f.ativ.has(a), onchange: (ev) => { ev.target.checked ? f.ativ.add(a) : f.ativ.delete(a); } }), h("span", {}, a))));
    const obs = h("textarea", { rows: 3, maxlength: 1000, placeholder: "Pontos fortes, o que melhorar, combinados…", "aria-label": "Observações finais" });
    obs.value = f.obs; obs.addEventListener("input", () => { f.obs = obs.value; });
    const msg = h("div", { class: "form-error", role: "alert", hidden: true });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Salvar avaliação");

    const form = h("form", { class: "aval-form", novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); msg.hidden = true;
      const falta = CRIT.filter((c) => f.notas[c.k] == null);
      if (f.rca < 0) return erro("Escolha o vendedor.");
      if (f.cli < 0) return erro("Escolha o cliente visitado (da carteira do vendedor).");
      if (!f.data || f.data > hojeIso()) return erro("Data da visita inválida.");
      if (falta.length) return erro(`Falta dar nota em: ${falta.map((c) => c.n).join("; ")}.`);
      if (f.final == null) return erro("Dê a nota final geral da visita.");
      const r = p.rca[f.rca], c = p.cli[f.cli];
      btn.disabled = true; btn.textContent = "Salvando…";
      try {
        await NV.remote.call("avaliacao_salvar", A.ctx.token, { rca: r.c, vendedor: r.n.replace(/ \(carteira própria\)$/, ""), cli: c.c, cliente: c.n, cidade: c.y, data: f.data,
          notas: f.notas, ativ: [...f.ativ].join(", ") || "NENHUMA ATIVIDADE REALIZADA", final: f.final, obs: f.obs.trim() });
        NV.toast(`Avaliação de ${r.n} em ${c.n} salva.`, "ok");
        A.form = novoForm(); A.form.rca = f.rca;
        await carregar(true); render();
      } catch (x) { erro(x.message || "Não foi possível salvar."); btn.disabled = false; btn.textContent = "Salvar avaliação"; }
      function erro(t) { msg.textContent = t; msg.hidden = false; }
    } },
    h("div", { class: "tgrid t3" }, h("label", { class: "tfield" }, h("span", {}, "Vendedor"), selV),
      h("label", { class: "tfield" }, h("span", {}, "Cliente visitado"), busca, dl, h("small", {}, f.cli >= 0 ? `${p.cli[f.cli].y} · Cód. ${p.cli[f.cli].c}` : `${cliList.length} clientes na carteira`)),
      h("label", { class: "tfield" }, h("span", {}, "Data da visita"), data)),
    h("div", { class: "aval-crits" }, CRIT.map((c) => escala(c.k, c.n))),
    h("div", { class: "tfield" }, h("span", {}, "Atividades realizadas na visita"), ativ),
    escala("final", "Nota final geral da visita" + (sugerida != null ? ` (média dos critérios: ${nota(sugerida)})` : "")),
    h("label", { class: "tfield" }, h("span", {}, "Observações finais"), obs), msg,
    h("div", { class: "tform-foot" }, btn, h("small", { class: "muted" }, "Notas de 1 (fraco) a 5 (excelente).")));

    box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Nova avaliação de visita"),
      h("p", {}, "Os mesmos critérios do formulário. O formulário do Google continua valendo."))), h("div", { class: "card-body" }, form));
  }

  /* ---------------------------------------------------------------- resultados */
  function filtradas() { return A.linhas.filter((l) => (!A.de || l.data >= A.de) && (!A.ate || l.data <= A.ate)); }

  function renderResultados() {
    const box = $("#aval-res");
    const de = h("input", { type: "date", value: A.de, "aria-label": "De", onchange: (ev) => { A.de = ev.target.value; renderResultados(); } });
    const ate = h("input", { type: "date", value: A.ate, "aria-label": "Até", onchange: (ev) => { A.ate = ev.target.value; renderResultados(); } });
    const ls = filtradas();
    const por = new Map();
    for (const l of ls) { const k = l.vendedor; if (!por.has(k)) por.set(k, []); por.get(k).push(l); }
    const linhas = [...por.entries()].map(([v, l]) => ({ v, l, final: media(l.map((x) => x.final).filter((x) => x != null)),
      crit: CRIT.map((c) => media(l.map((x) => x.notas[c.k]).filter((x) => x != null))), ult: l.reduce((m, x) => (x.data > m ? x.data : m), "") }))
      .sort((a, b) => (b.final || 0) - (a.final || 0));
    const cor = (v) => (v == null ? "" : v >= 4.5 ? "ok" : v >= 3.5 ? "mid" : "low");
    const cab = h("thead", {}, h("tr", {}, ["Vendedor", "Visitas", "Nota final", ...CRIT.map((c, i) => "C" + (i + 1)), "Última"].map((t, i) =>
      h("th", { class: i ? "num" : "", style: "cursor:default", title: i >= 3 && i < 3 + CRIT.length ? CRIT[i - 3].n : "" }, t))));
    const corpo = linhas.map((x) => h("tr", {}, h("td", { class: "wrap" }, x.v), h("td", { class: "num" }, fmt.int(x.l.length)),
      h("td", { class: "num" }, h("b", { class: "nota " + cor(x.final) }, nota(x.final))),
      ...x.crit.map((v) => h("td", { class: "num" }, h("span", { class: "nota " + cor(v) }, nota(v)))), h("td", { class: "num" }, br(x.ult))));
    const geral = media(ls.map((x) => x.final).filter((x) => x != null));
    const legenda = h("p", { class: "note" }, CRIT.map((c, i) => `C${i + 1} = ${c.n}`).join(" · "));
    const recentes = ls.slice().sort((a, b) => (b.data > a.data ? 1 : b.data < a.data ? -1 : b.ts - a.ts)).slice(0, 30).map((l) =>
      h("details", { class: "stock-h" }, h("summary", {}, h("b", {}, br(l.data)), h("span", {}, `${l.vendedor} · ${l.cliente}`), h("span", { class: "nota " + cor(l.final) }, "Nota " + nota(l.final)), h("small", {}, l.gestor)),
        h("p", { class: "note" }, CRIT.map((c, i) => `C${i + 1}: ${nota(l.notas[c.k])}`).join(" · ") + (l.ativ ? " · Atividades: " + l.ativ : "")),
        l.obs ? h("p", {}, l.obs) : null));
    const corpoCard = A.erro ? h("div", { class: "notice notice-error" }, A.erro)
      : !A.carregado ? h("p", { class: "note" }, "Carregando as avaliações…")
      : !ls.length ? h("p", { class: "note" }, "Nenhuma avaliação no período.")
      : [h("div", { class: "table-wrap" }, h("table", { class: "tbl" }, cab, h("tbody", {}, corpo))), legenda,
        h("h3", { class: "aval-h3" }, "Avaliações mais recentes"), h("div", { class: "stock-hlist" }, recentes)];
    box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Resultado das avaliações"),
      h("p", {}, ls.length ? `${ls.length} avaliações · nota final média ${nota(geral)} · inclui as respostas do formulário do Google` : "Médias por vendedor e por critério")),
    h("div", { class: "head-tools" }, h("label", { class: "home-lab" }, h("span", {}, "De"), de), h("label", { class: "home-lab" }, h("span", {}, "Até"), ate),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: exportar }, NV.icon("i-download"), h("span", {}, "Exportar CSV")))),
    h("div", { class: "card-body" }, corpoCard));
  }

  function exportar() {
    const q = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const out = [["Data", "Gestor", "Vendedor", "Cliente", "Cidade", ...CRIT.map((c) => c.n), "Atividades", "Nota final", "Observações", "Origem"].map(q).join(";")];
    for (const l of filtradas()) out.push([br(l.data), l.gestor, l.vendedor, l.cliente, l.cidade, ...CRIT.map((c) => l.notas[c.k] == null ? "" : l.notas[c.k]), l.ativ, l.final == null ? "" : l.final, l.obs, l.o].map(q).join(";"));
    NV.download(new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" }), `avaliacoes_qualitativas_${hojeIso()}.csv`);
  }

  function render() { renderForm(); renderResultados(); }

  NV.aval = {
    init(ctx) {
      Object.assign(A, { ctx, linhas: [], carregado: false, erro: "", de: "", ate: "", cliCache: new Map() });
      A.form = novoForm();
      const ativo = !!NV.remote.endpoint && ctx.p.user.tipo !== "RCA";
      $("#app-nav [data-view=aval]").hidden = !ativo;
      return ativo;
    },
    async mostrar() { if (!A.ctx) return; render(); await carregar(false); render(); },
  };
})();

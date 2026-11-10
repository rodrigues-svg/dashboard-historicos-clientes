/* Estoque do cliente: contagem por produto (com total por família, ex.: Bravecto), histórico de contagens por período,
   sugestão de pedido e proposta em PDF para o WhatsApp do cliente. As contagens ficam na planilha (via Apps Script). */
(function () {
  const NV = window.NV;
  const { h, $, fmt } = NV;

  const E = { ctx: null, cli: -1, info: null, contagens: [], carregando: false, erro: "", ate: "", de: "", cobertura: 1, sug: {}, preco: {}, extra: [], fone: "" };
  const money = (v) => fmt.plain(fmt.brl(v));
  const familia = (nome) => (/^BRAVECTO/i.test(nome) ? "BRAVECTO" : String(nome).trim().split(/\s+/)[0].toUpperCase());
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const br = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  const inteiro = (s) => { const x = parseInt(String(s == null ? "" : s).replace(/\D/g, ""), 10); return isNaN(x) ? null : x; };
  const numero = (s) => { let x = String(s == null ? "" : s).trim().replace(/[^\d.,]/g, ""); if (!x) return NaN; if (x.includes(",")) x = x.replace(/\./g, "").replace(",", "."); return Number(x); };

  /* ---------------------------------------------------------------- cliente */
  function renderBusca() {
    const p = E.ctx.p, box = $("#stock-pick");
    const inp = h("input", { type: "search", id: "stock-q", placeholder: "Código, CNPJ ou nome do cliente", autocomplete: "off", "aria-label": "Buscar cliente" });
    const lista = h("div", { class: "stock-res", id: "stock-res" });
    const filtrar = () => {
      const q = NV.norm(inp.value), dig = NV.digits(inp.value);
      if (q.length < 2) { lista.replaceChildren(); return; }
      const res = [];
      for (let i = 0; i < p.cli.length && res.length < 12; i++) {
        const c = p.cli[i];
        if (NV.norm(c.n).includes(q) || String(c.c) === dig || (dig.length >= 4 && NV.digits(c.d).includes(dig))) res.push(i);
      }
      lista.replaceChildren(...(res.length ? res.map((i) => h("button", { type: "button", class: "stock-op", onclick: () => escolher(i) },
        h("b", {}, p.cli[i].n), h("small", {}, `Cód. ${p.cli[i].c} · ${p.cli[i].d} · ${p.cli[i].y}`))) : [h("p", { class: "note" }, "Nenhum cliente encontrado.")]));
    };
    inp.addEventListener("input", NV.debounce(filtrar, 150));
    const atual = E.cli >= 0 ? p.cli[E.cli] : null;
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Estoque do cliente"),
        h("p", {}, atual ? `${atual.n} · Cód. ${atual.c} · ${atual.y}` : "Escolha o cliente para contar o estoque dos produtos que ele trabalha."))),
      h("div", { class: "card-body" }, h("div", { class: "tfield" }, h("span", {}, atual ? "Trocar de cliente" : "Cliente"), inp), lista));
  }

  async function escolher(i) {
    E.cli = i; E.sug = {}; E.preco = {}; E.extra = []; E.contagens = []; E.erro = "";
    const e = E.ctx.eng;
    E.info = e.cliProdutos(i, e.ymMax - 11, e.ymMax);
    render();
    await carregar();
    render();
  }

  async function carregar() {
    E.carregando = true; E.erro = "";
    try { E.contagens = (await NV.remote.estoqueLer(E.ctx.token, E.ctx.p.cli[E.cli].c)).linhas || []; }
    catch (x) { E.erro = x.message || "Não foi possível carregar o histórico."; }
    E.carregando = false;
  }

  /* ---------------------------------------------------------------- produtos e contagem */
  function produtos() {
    const p = E.ctx.p, e = E.ctx.eng, ym = e.ymMax;
    const itens = E.info.itens.map((o) => {
      let soma6 = 0;
      for (let y = ym - 6; y <= ym - 1; y++) soma6 += o.meses.get(y) || 0;
      return { nome: p.prod[o.prod].n, fam: familia(p.prod[o.prod].n), media: Math.max(0, soma6 / 6), preco: o.preco, ultYm: o.ultYm, qtd12: o.qtd };
    });
    for (const nome of E.extra) if (!itens.some((x) => x.nome === nome)) itens.push({ nome, fam: familia(nome), media: 0, preco: 0, ultYm: -1, qtd12: 0, extra: true });
    return itens;
  }
  function porFamilia(itens) {
    const g = new Map();
    for (const x of itens) { if (!g.has(x.fam)) g.set(x.fam, []); g.get(x.fam).push(x); }
    return [...g.entries()].map(([fam, l]) => ({ fam, itens: l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true })), peso: l.reduce((s, x) => s + x.media * (x.preco || 1), 0) }))
      .sort((a, b) => b.peso - a.peso || a.fam.localeCompare(b.fam));
  }
  const ultimaContagem = () => { const g = grupos(); return g.length ? g[0] : null; };

  function renderContagem() {
    const box = $("#stock-count");
    if (E.cli < 0) { box.hidden = true; return; }
    box.hidden = false;
    const itens = produtos(), fams = porFamilia(itens), ult = ultimaContagem();
    const inputs = new Map();
    const totFam = new Map(), totGeral = h("b", { id: "stock-total" }, "0");
    const recalcular = () => {
      let geral = 0;
      for (const f of fams) {
        let t = 0; for (const x of f.itens) { const v = inteiro(inputs.get(x.nome).value); if (v) t += v; }
        totFam.get(f.fam).textContent = fmt.int(t) + " un."; geral += t;
      }
      totGeral.textContent = fmt.int(geral) + " un.";
    };
    const blocos = fams.map((f) => {
      const tot = h("em", { class: "fam-tot" }, "0 un.");
      totFam.set(f.fam, tot);
      return h("div", { class: "fam" }, h("div", { class: "fam-head" }, h("b", {}, f.fam), h("span", {}, f.itens.length + (f.itens.length === 1 ? " produto" : " produtos")), tot),
        f.itens.map((x) => {
          const ant = ult ? ult.itens.find((i) => i.p === x.nome) : null;
          const inp = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "0", "aria-label": "Estoque de " + x.nome, value: "" });
          inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 6); recalcular(); });
          inputs.set(x.nome, inp);
          const dica = [x.media > 0 ? `compra ~${fmt.num2(x.media).replace(/,00$/, "")} un./mês` : null, x.ultYm >= 0 ? `últ. compra ${fmt.ym(x.ultYm)}` : (x.extra ? "fora do histórico" : null),
            ant ? `contagem de ${br(ult.data)}: ${fmt.int(ant.q)}` : null].filter(Boolean).join(" · ");
          return h("label", { class: "prod-row" }, h("span", { class: "prod-n" }, x.nome, h("small", {}, dica)), inp);
        }));
    });
    const data = h("input", { type: "date", id: "stock-data", value: hojeIso(), max: hojeIso() });
    const msg = h("div", { class: "form-error", role: "alert", hidden: true });
    const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Salvar contagem");
    const add = h("input", { type: "text", list: "stock-prods", placeholder: "Adicionar outro produto", "aria-label": "Adicionar produto à contagem" });
    const lista = h("datalist", { id: "stock-prods" }, E.ctx.p.prod.map((x) => h("option", { value: x.n })));
    add.addEventListener("change", () => { const n = add.value.trim(); if (E.ctx.p.prod.some((x) => x.n === n)) { E.extra.push(n); renderContagem(); } });

    const form = h("form", { class: "stock-form", novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault(); msg.hidden = true;
      const itensC = [];
      inputs.forEach((inp, nome) => { const v = inteiro(inp.value); if (v != null && inp.value !== "") itensC.push({ p: nome, f: familia(nome), q: v }); });
      if (!itensC.length) { msg.textContent = "Digite a quantidade de pelo menos um produto (use 0 para produto sem estoque)."; msg.hidden = false; return; }
      if (!data.value || data.value > hojeIso()) { msg.textContent = "Data da contagem inválida."; msg.hidden = false; return; }
      const c = E.ctx.p.cli[E.cli], rca = E.info.rca >= 0 ? E.ctx.p.rca[E.info.rca].c : (E.ctx.p.user.rcaCodigo || 0);
      btn.disabled = true; btn.textContent = "Salvando…";
      try {
        await NV.remote.estoqueSalvar(E.ctx.token, { cli: c.c, cliNome: c.n, rca, data: data.value, itens: itensC });
        NV.toast(`Contagem de ${br(data.value)} salva (${itensC.length} produtos).`, "ok");
        await carregar(); render();
        $("#stock-prop").scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (x) { msg.textContent = x.message || "Não foi possível salvar."; msg.hidden = false; btn.disabled = false; btn.textContent = "Salvar contagem"; }
    } },
    itens.length ? blocos : h("p", { class: "note" }, "Este cliente não comprou nos últimos 12 meses. Use \"Adicionar outro produto\"."),
    h("div", { class: "stock-add" }, add, lista),
    h("div", { class: "stock-foot" }, h("span", {}, "Total contado: ", totGeral), h("label", { class: "tfield inline" }, h("span", {}, "Data da contagem"), data), btn), msg);

    box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Contagem de estoque"),
      h("p", {}, "Unidades em estoque no cliente. O total de cada família (ex.: Bravecto) soma todas as apresentações."))),
    h("div", { class: "card-body" }, form));
    recalcular();
  }

  /* ---------------------------------------------------------------- histórico */
  function grupos() {
    const g = new Map();
    for (const l of E.contagens) {
      if (!g.has(l.id)) g.set(l.id, { id: l.id, data: l.data, ts: l.ts, u: l.u, itens: [] });
      g.get(l.id).itens.push(l);
    }
    return [...g.values()].sort((a, b) => (b.data > a.data ? 1 : b.data < a.data ? -1 : b.ts - a.ts));
  }

  function renderHistorico() {
    const box = $("#stock-hist");
    if (E.cli < 0) { box.hidden = true; return; }
    box.hidden = false;
    const todos = grupos();
    const lista = todos.filter((g) => (!E.de || g.data >= E.de) && (!E.ate || g.data <= E.ate));
    const de = h("input", { type: "date", value: E.de, "aria-label": "De", onchange: (ev) => { E.de = ev.target.value; renderHistorico(); } });
    const ate = h("input", { type: "date", value: E.ate, "aria-label": "Até", onchange: (ev) => { E.ate = ev.target.value; renderHistorico(); } });
    const corpo = E.erro ? h("div", { class: "notice notice-error" }, E.erro)
      : E.carregando ? h("p", { class: "note" }, "Carregando o histórico…")
      : !lista.length ? h("p", { class: "note" }, todos.length ? "Nenhuma contagem no período escolhido." : "Ainda não há contagem salva para este cliente.")
      : h("div", { class: "stock-hlist" }, lista.map((g) => {
        const fam = new Map(); let tot = 0;
        for (const i of g.itens) { fam.set(i.f, (fam.get(i.f) || 0) + i.q); tot += i.q; }
        const resumo = [...fam.entries()].sort((a, b) => b[1] - a[1]).map(([f, q]) => `${f} ${fmt.int(q)}`).join(" · ");
        return h("details", { class: "stock-h" }, h("summary", {}, h("b", {}, br(g.data)), h("span", {}, `${fmt.int(tot)} un. em ${g.itens.length} produtos`), h("small", {}, g.u)),
          h("p", { class: "note" }, resumo),
          h("table", { class: "tbl" }, h("tbody", {}, g.itens.slice().sort((a, b) => a.f.localeCompare(b.f) || a.p.localeCompare(b.p, "pt-BR", { numeric: true }))
            .map((i) => h("tr", {}, h("td", { class: "wrap" }, i.p), h("td", { class: "num" }, fmt.int(i.q)))))));
      }));
    box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Histórico de contagens"), h("p", {}, todos.length === 1 ? "1 contagem salva" : `${todos.length} contagens salvas`)),
      h("div", { class: "head-tools" }, h("label", { class: "home-lab" }, h("span", {}, "De"), de), h("label", { class: "home-lab" }, h("span", {}, "Até"), ate))),
    h("div", { class: "card-body" }, corpo));
  }

  /* ---------------------------------------------------------------- sugestão e proposta */
  function linhasProposta() {
    const ult = ultimaContagem();
    if (!ult) return null;
    const itens = produtos(), byNome = new Map(itens.map((x) => [x.nome, x]));
    const linhas = [];
    for (const c of ult.itens) {
      const x = byNome.get(c.p) || { nome: c.p, fam: c.f, media: 0, preco: 0 };
      const auto = Math.max(0, Math.ceil(x.media * E.cobertura - c.q));
      const sug = E.sug[c.p] != null ? E.sug[c.p] : auto;
      const preco = E.preco[c.p] != null ? E.preco[c.p] : Math.round((x.preco || 0) * 100) / 100;
      linhas.push({ nome: c.p, fam: c.f, est: c.q, media: x.media, auto, sug, preco, total: sug * preco });
    }
    linhas.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
    return { ult, linhas };
  }

  function renderProposta() {
    const box = $("#stock-prop");
    if (E.cli < 0) { box.hidden = true; return; }
    box.hidden = false;
    const r = linhasProposta();
    if (!r) {
      box.replaceChildren(h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Sugestão de pedido"), h("p", {}, "Salve uma contagem para gerar a sugestão e a proposta."))));
      return;
    }
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Cobertura" }, [1, 2].map((m) =>
      h("button", { type: "button", "aria-pressed": String(E.cobertura === m), onclick: () => { E.cobertura = m; E.sug = {}; renderProposta(); } }, `Cobrir ${m} ${m === 1 ? "mês" : "meses"}`)));
    const totEl = h("b", {});
    const atualizarTot = () => { const l = linhasProposta().linhas; totEl.textContent = money(l.reduce((s, x) => s + x.total, 0)); };
    const corpo = r.linhas.map((x) => {
      const q = h("input", { type: "text", inputmode: "numeric", value: String(x.sug), class: "mini", "aria-label": "Quantidade sugerida de " + x.nome });
      const pr = h("input", { type: "text", inputmode: "decimal", value: fmt.num2(x.preco), class: "mini", "aria-label": "Preço unitário de " + x.nome });
      const tot = h("td", { class: "num" }, money(x.total));
      const upd = () => {
        const qv = inteiro(q.value) || 0, pv = numero(pr.value);
        E.sug[x.nome] = qv; if (!isNaN(pv)) E.preco[x.nome] = pv;
        tot.textContent = money(qv * (isNaN(pv) ? x.preco : pv)); atualizarTot();
      };
      q.addEventListener("input", upd); pr.addEventListener("input", upd);
      pr.addEventListener("blur", () => { const v = numero(pr.value); if (!isNaN(v)) pr.value = fmt.num2(v); });
      return h("tr", {}, h("td", { class: "wrap" }, x.nome), h("td", { class: "num" }, fmt.int(x.est)), h("td", { class: "num" }, x.media ? fmt.num2(x.media).replace(/,00$/, "") : "—"),
        h("td", { class: "num" }, q), h("td", { class: "num" }, pr), tot);
    });
    const fone = h("input", { type: "tel", inputmode: "tel", placeholder: "(47) 99999-9999", value: E.fone, "aria-label": "WhatsApp do cliente",
      oninput: (ev) => { E.fone = ev.target.value; } });
    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", {}, "Sugestão de pedido"),
        h("p", {}, `Base: contagem de ${br(r.ult.data)}. Sugestão = compra média mensal (últimos 6 meses) × cobertura − estoque. Ajuste quantidades e preços se precisar.`)),
        h("div", { class: "head-tools" }, seg)),
      h("div", { class: "card-body" },
        h("div", { class: "table-wrap" }, h("table", { class: "tbl" },
          h("thead", {}, h("tr", {}, ["Produto", "Estoque", "Média/mês", "Pedido", "Preço un. (R$)", "Total"].map((t, i) => h("th", { class: i ? "num" : "", style: "cursor:default" }, t)))),
          h("tbody", {}, corpo),
          h("tfoot", {}, h("tr", {}, h("td", { colspan: "5" }, "Total da proposta"), h("td", { class: "num" }, totEl))))),
        h("p", { class: "note" }, "Preço: último preço líquido pago pelo cliente em cada produto (confira antes de enviar)."),
        h("div", { class: "stock-foot" }, h("label", { class: "tfield inline" }, h("span", {}, "WhatsApp do cliente"), fone),
          h("button", { class: "btn btn-primary", type: "button", onclick: () => proposta(true) }, NV.icon("i-whatsapp"), h("span", {}, "Enviar proposta (PDF)")),
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => proposta(false) }, NV.icon("i-download"), h("span", {}, "Baixar PDF")))));
    atualizarTot();
  }

  function montarPdf() {
    const { jsPDF } = window.jspdf, p = E.ctx.p, u = p.user, c = p.cli[E.cli];
    const r = linhasProposta(), itens = r.linhas.filter((x) => x.sug > 0);
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    if (window.NV_LOGO) doc.addImage(window.NV_LOGO, "PNG", 14, 10, 50, 50 / (window.NV_LOGO_RATIO || 3.2));
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(201, 75, 94);
    doc.text("Proposta de pedido", W - 14, 18, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    const hoje = new Date(), val = new Date(hoje.getTime() + 7 * 864e5);
    doc.text(`Emitida em ${hoje.toLocaleDateString("pt-BR")} · válida até ${val.toLocaleDateString("pt-BR")}`, W - 14, 24, { align: "right" });
    doc.setTextColor(40); doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text(c.n, 14, 36);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`CNPJ/CPF ${c.d} · Cód. ${c.c} · ${c.y}`, 14, 41);
    doc.text(`Estoque conferido em ${br(r.ult.data)} · Representante: ${u.nome}${u.telefone ? " · " + u.telefone : ""}`, 14, 46);
    const total = itens.reduce((s, x) => s + x.total, 0);
    doc.autoTable({
      startY: 52, theme: "grid", styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [201, 75, 94], textColor: 255 },
      head: [["Produto", "Estoque", "Qtd. pedido", "Preço un.", "Total"]],
      body: itens.map((x) => [x.nome, fmt.int(x.est), fmt.int(x.sug), money(x.preco), money(x.total)]),
      foot: [[{ content: "Total", colSpan: 4, styles: { halign: "right" } }, money(total)]],
      footStyles: { fillColor: [251, 233, 236], textColor: 40, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    const y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(8); doc.setTextColor(110);
    doc.text("Quantidades sugeridas a partir do estoque conferido e do consumo médio. Preços sujeitos a confirmação no faturamento.", 14, y);
    doc.text("Novavet Distribuidora", 14, y + 5);
    return { doc, total, nome: `Proposta_${c.n.replace(/[^\w]+/g, "_").slice(0, 40)}_${hojeIso()}.pdf`, itens: itens.length };
  }

  async function proposta(whats) {
    const r = linhasProposta();
    if (!r || !r.linhas.some((x) => x.sug > 0)) { NV.toast("Nenhum produto com quantidade de pedido.", "err"); return; }
    if (!window.jspdf) { NV.toast("O gerador de PDF ainda está carregando. Tente de novo.", "err"); return; }
    const { doc, total, nome, itens } = montarPdf();
    const blob = doc.output("blob");
    if (!whats) { NV.download(blob, nome); return; }
    const file = new File([blob], nome, { type: "application/pdf" });
    const texto = `Olá! Segue a proposta de pedido da Novavet (${itens} itens, ${money(total)}), com base no estoque conferido hoje.`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: texto, title: "Proposta Novavet" }); return; }
    } catch (x) { if (x && x.name === "AbortError") return; }
    NV.download(blob, nome);
    const dig = NV.digits(E.fone);
    const num = dig.length >= 10 ? (dig.startsWith("55") ? dig : "55" + dig) : "";
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto + " (anexe o PDF que acabou de ser baixado)")}`, "_blank", "noopener");
  }

  /* ---------------------------------------------------------------- tela */
  function render() { renderBusca(); renderContagem(); renderHistorico(); renderProposta(); }

  NV.stock = {
    init(ctx) {
      Object.assign(E, { ctx, cli: -1, info: null, contagens: [], erro: "", de: "", ate: "", cobertura: 1, sug: {}, preco: {}, extra: [], fone: "" });
      const ativo = !!NV.remote.endpoint;
      $("#app-nav [data-view=stock]").hidden = !ativo;
      return ativo;
    },
    mostrar() { if (E.ctx) render(); },
  };
})();

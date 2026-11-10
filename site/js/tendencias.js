/* Tendências: preenchimento (1ª e 2ª de cada mês), acompanhamento contra o realizado, alerta na data e imagem para o WhatsApp.
   Os dados ficam na planilha de respostas do Forms (via Apps Script); o realizado sai da base de vendas do próprio usuário. */
(function () {
  const NV = window.NV;
  const { h, icon, $, fmt } = NV;

  const METRICAS = [
    { k: "geral", rotulo: "Geral", nome: "Faturamento geral", money: true, campo: "g" },
    { k: "msd", rotulo: "MSD", nome: "MSD", money: true, campo: "m" },
    { k: "brav", rotulo: "Bravecto", nome: "Bravecto (unidades)", money: false, campo: "b", un: "un." },
    { k: "fun", rotulo: "Fun Pads", nome: "Fun Pads", money: true, campo: "f" },
    { k: "idexx", rotulo: "IDEXX", nome: "IDEXX", money: true, campo: "i" },
    { k: "pos", rotulo: "Positivação", nome: "Positivação (CNPJ)", money: false, campo: "p", un: "CNPJ" },
  ];
  const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const money0 = (v) => fmt.plain(fmt.brl0(v));
  const val = (m, v) => (v == null || isNaN(v) ? "—" : m.money ? money0(v) : fmt.int(Math.round(v)));
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  const dd = (d) => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  const dataIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const T = { ctx: null, linhas: [], carregado: false, erro: "", carregando: null, mo: null, ano: null, n: 1, metrica: "geral",
    form: { rca: 0, n: 1 }, real: {} };

  /* ---------------------------------------------------------------- datas */
  function agenda(ano, mo) {
    const lista = ((T.ctx.p.tendencias || {}).datas || []).map((x) => ({ d: dataIso(x.d), n: x.n })).filter((x) => x.d.getFullYear() === ano && x.d.getMonth() === mo);
    return lista.sort((a, b) => a.d - b.d);
  }
  /* situação do mês corrente: 1ª/2ª com data, qual está aberta (a última cuja data já chegou) e a próxima */
  function situacao() {
    const hoje = inicioDia(new Date()), lista = agenda(hoje.getFullYear(), hoje.getMonth());
    const abertas = lista.filter((x) => x.d <= hoje);
    const atual = abertas[abertas.length - 1] || null;
    let proxima = lista.find((x) => x.d > hoje) || null;
    if (!proxima) {                                              // sem mais datas neste mês: a primeira do mês seguinte
      const prox = agenda(hoje.getMonth() === 11 ? hoje.getFullYear() + 1 : hoje.getFullYear(), (hoje.getMonth() + 1) % 12);
      proxima = prox[0] || null;
    }
    return { hoje, lista, atual, proxima };
  }

  /* ---------------------------------------------------------------- dados */
  function chaveMes(ano, mo) { return ano + "-" + mo; }
  function indexar() {
    const idx = new Map();
    for (const l of T.linhas) {                                  // a última resposta de cada vendedor/mês/tendência vale
      const mo = NV.MESES.findIndex((m) => semAcento(m) === semAcento(l.mes));
      if (mo < 0 || !l.n) continue;
      const ano = new Date(l.ts).getFullYear();
      const k = l.r + "|" + chaveMes(ano, mo) + "|" + l.n;
      const antigo = idx.get(k);
      if (!antigo || l.ts >= antigo.ts) idx.set(k, Object.assign({ mo, ano }, l));
    }
    T.idx = idx;
  }
  const resposta = (rca, ano, mo, n) => (T.idx ? T.idx.get(rca + "|" + chaveMes(ano, mo) + "|" + n) : null) || null;

  async function carregar(forca) {
    if (T.carregando) return T.carregando;
    if (T.carregado && !forca) return;
    T.erro = "";
    T.carregando = NV.remote.tendenciasLer(T.ctx.token).then((j) => {
      T.linhas = j.linhas || []; T.carregado = true; indexar();
    }).catch((e) => { T.erro = e.message || "Não foi possível carregar as tendências."; }).finally(() => { T.carregando = null; });
    return T.carregando;
  }

  /* vendedores do escopo do usuário que respondem tendência: quem teve venda nos 2 últimos meses da base */
  function vendedores() {
    if (T._vend) return T._vend;
    const { p, eng } = T.ctx, u = p.user;
    const a = eng.rcaMetrics(eng.ymMax), b = eng.rcaMetrics(eng.ymMax - 1);
    const lista = [];
    p.rca.forEach((r, i) => {
      if (u.tipo === "RCA" && r.c !== u.rcaCodigo) return;
      if (a.geral[i] === 0 && b.geral[i] === 0) return;
      lista.push({ i, c: r.c, n: r.n, sup: p.sup[r.s] ? p.sup[r.s].n : "" });
    });
    return (T._vend = lista);
  }

  /* realizado do mês (base de vendas) por RCA; guarda por mês para não recalcular */
  function realizado(ano, mo) {
    const ym = ano * 12 + mo, e = T.ctx.eng;
    if (ym < e.ymMin || ym > e.ymMax) return null;
    return T.real[ym] || (T.real[ym] = e.rcaMetrics(ym));
  }

  /* ---------------------------------------------------------------- alerta */
  function pendentes(ano, mo, n) { return vendedores().filter((v) => !resposta(v.c, ano, mo, n)); }

  function alerta() {
    const s = situacao();
    if (!s.atual || !T.carregado) return null;
    const dias = Math.round((s.hoje - s.atual.d) / 864e5);
    if (dias > 6) return null;                                   // depois de uma semana o alerta sai sozinho
    const pend = pendentes(s.hoje.getFullYear(), s.hoje.getMonth(), s.atual.n);
    if (!pend.length) return null;
    const total = vendedores().length, u = T.ctx.p.user, mes = NV.MESES[s.hoje.getMonth()];
    const texto = u.tipo === "RCA"
      ? `${dias === 0 ? "Hoje é dia da" : "Ainda falta responder a"} ${s.atual.n}ª Tendência de ${mes}${dias === 0 ? "." : ` (${dd(s.atual.d)}).`} Informe a sua tendência.`
      : `${s.atual.n}ª Tendência de ${mes}${dias === 0 ? " é hoje" : ` (${dd(s.atual.d)})`}: ${pend.length} de ${total} vendedores ainda não responderam.`;
    return { texto, n: s.atual.n, pend };
  }

  function atualizarAlerta() {
    const a = alerta(), barra = $("#alert-bar");
    $("#trend-dot").hidden = !a;
    if (!a) { barra.hidden = true; return; }
    $("#alert-text").textContent = a.texto;
    $("#alert-go").textContent = T.ctx.p.user.tipo === "RCA" ? "Responder agora" : "Ver tendências";
    barra.hidden = false;
  }

  /* ---------------------------------------------------------------- tela */
  function render() {
    const s = situacao(), hoje = s.hoje;
    if (T.mo == null) { T.mo = hoje.getMonth(); T.ano = hoje.getFullYear(); T.n = s.atual ? s.atual.n : (s.lista[0] ? s.lista[0].n : 1); }
    const f = (T.ctx.p.tendencias || {}).formUrl, link = $("#trend-form-link");
    link.hidden = !f; if (f) link.href = f;
    $("#trend-sub").textContent = `${NV.MESES[hoje.getMonth()]} de ${hoje.getFullYear()} · 1ª e 2ª tendência do mês`;
    renderStatus(s);
    renderForm(s);
    renderAcompanhamento();
    atualizarAlerta();
  }

  function renderStatus(s) {
    const cartao = (n) => {
      const x = s.lista.find((y) => y.n === n);
      if (!x) return h("div", { class: "tstat" }, h("b", {}, `${n}ª Tendência`), h("span", { class: "muted" }, "sem data na agenda"));
      const dias = Math.round((x.d - s.hoje) / 864e5);
      const estado = dias > 0 ? `em ${dias} dia${dias === 1 ? "" : "s"}` : dias === 0 ? "é hoje" : "já aberta";
      const resp = T.carregado ? vendedores().length - pendentes(x.d.getFullYear(), x.d.getMonth(), n).length : null;
      return h("div", { class: "tstat" + (dias <= 0 ? " on" : "") },
        h("b", {}, `${n}ª Tendência`), h("span", {}, `${DIAS[x.d.getDay()]}, ${dd(x.d)}`),
        h("em", { class: "pill " + (dias === 0 ? "warn" : dias < 0 ? "ok" : "") }, estado),
        resp == null ? null : h("small", {}, `${resp} de ${vendedores().length} responderam`));
    };
    $("#trend-status").replaceChildren(cartao(1), cartao(2));
  }

  /* ---- formulário ---- */
  function renderForm(s) {
    const box = $("#trend-form-card"), u = T.ctx.p.user, vend = vendedores();
    const mo = s.hoje.getMonth(), ano = s.hoje.getFullYear();
    if (!vend.length) { box.replaceChildren(); return; }
    if (!vend.some((v) => v.c === T.form.rca)) T.form.rca = (vend.find((v) => !resposta(v.c, ano, mo, T.form.n)) || vend[0]).c;
    if (!T.form.tocou) T.form.n = s.atual ? s.atual.n : (s.proxima ? s.proxima.n : 1);
    const v = vend.find((x) => x.c === T.form.rca), n = T.form.n;
    const atual = resposta(v.c, ano, mo, n);
    const base = atual || resposta(v.c, ano, mo, n === 2 ? 1 : 2) || ultimaDe(v.c);
    const real = (realizado(ano, mo) || {});
    const entradas = {};

    const campo = (m) => {
      const bruto = base ? base[m.campo] : null;
      const inp = h("input", { type: "text", inputmode: m.money ? "decimal" : "numeric", autocomplete: "off", id: "tf-" + m.k, "aria-describedby": "tfh-" + m.k,
        value: bruto == null ? "" : (m.money ? fmt.num2(bruto) : fmt.int(bruto)), placeholder: m.money ? "0,00" : "0" });
      inp.addEventListener("blur", () => { const x = numero(inp.value); if (!isNaN(x)) inp.value = m.money ? fmt.num2(x) : fmt.int(Math.round(x)); });
      entradas[m.k] = inp;
      const r = real[m.k] ? real[m.k][v.i] : null;
      const dica = [r != null ? `Realizado até ontem: ${val(m, r)}` : null, base ? `${atual ? "Enviado" : "Última"}: ${val(m, base[m.campo])}` : null].filter(Boolean).join(" · ");
      return h("label", { class: "tfield" }, h("span", {}, m.nome + (m.money ? " (R$)" : "")), h("div", { class: "tin" }, m.money ? h("i", {}, "R$") : null, inp),
        h("small", { id: "tfh-" + m.k }, dica || " "));
    };

    const quem = u.tipo === "RCA" ? h("div", { class: "tfield" }, h("span", {}, "Vendedor"), h("b", { class: "tfixed" }, v.n))
      : h("label", { class: "tfield" }, h("span", {}, "Vendedor"), h("select", { id: "tf-rca", onchange: (e) => { T.form.rca = +e.target.value; renderForm(situacao()); } },
        vend.map((x) => h("option", { value: x.c, selected: x.c === v.c }, x.n + (resposta(x.c, ano, mo, n) ? " ✓" : "") + (u.tipo === "Gerente" && x.sup ? " · " + x.sup.split(" ")[0] : "")))));
    const qual = h("label", { class: "tfield" }, h("span", {}, "Tendência"), h("select", { id: "tf-n", onchange: (e) => { T.form.n = +e.target.value; T.form.tocou = true; renderForm(situacao()); } },
      [1, 2].map((k) => h("option", { value: k, selected: k === n }, `${k}ª Tendência de ${NV.MESES[mo]}`))));

    const msg = h("div", { class: "form-error", id: "tf-erro", role: "alert", hidden: true });
    const btn = h("button", { class: "btn btn-primary", type: "submit", id: "tf-enviar" }, atual ? "Atualizar tendência" : "Enviar tendência");
    const form = h("form", { class: "trend-form", novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      msg.hidden = true;
      const dados = { rca: v.c, mes: NV.MESES[mo].toUpperCase(), n };
      for (const m of METRICAS) {
        const x = numero(entradas[m.k].value);
        if (isNaN(x) || x < 0) { msg.textContent = `Confira o campo "${m.nome}": digite apenas números.`; msg.hidden = false; entradas[m.k].focus(); return; }
        dados[m.k] = m.money ? Math.round(x * 100) / 100 : Math.round(x);
      }
      if (!(dados.geral > 0)) { msg.textContent = "Informe a tendência geral (valor maior que zero)."; msg.hidden = false; entradas.geral.focus(); return; }
      btn.disabled = true; btn.textContent = "Enviando…";
      try {
        await NV.remote.tendenciaSalvar(T.ctx.token, dados);
        NV.toast(`${n}ª Tendência de ${v.n} enviada.`, "ok");
        T.carregado = false; await carregar(true); T.form.tocou = false;
        render();
      } catch (e) {
        msg.textContent = e.message || "Não foi possível enviar. Tente novamente."; msg.hidden = false;
        btn.disabled = false; btn.textContent = atual ? "Atualizar tendência" : "Enviar tendência";
      }
    } }, h("div", { class: "tgrid" }, quem, qual), h("div", { class: "tgrid t3" }, METRICAS.map(campo)), msg,
    h("div", { class: "tform-foot" }, btn,
      atual ? h("small", { class: "muted" }, `Já enviada em ${new Date(atual.ts).toLocaleDateString("pt-BR")} às ${new Date(atual.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Enviar de novo substitui.`) : null));

    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", { id: "trend-form-title" }, "Preencher tendência"),
        h("p", {}, u.tipo === "RCA" ? "Informe até onde você acredita fechar o mês." : "Você pode preencher por qualquer vendedor da sua equipe (ex.: vaga ou ausência)."))),
      h("div", { class: "card-body" }, form));
  }

  function ultimaDe(rca) {
    let achada = null;
    for (const l of T.linhas) if (l.r === rca && (!achada || l.ts > achada.ts)) achada = l;
    return achada;
  }

  const numero = (s) => {
    let x = String(s == null ? "" : s).trim().replace(/[^\d.,-]/g, "");
    if (!x) return NaN;
    if (x.includes(",")) x = x.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");
    return Number(x);
  };

  /* ---- acompanhamento ---- */
  function meses() {                                             // meses com resposta + o corrente, do mais novo ao mais antigo
    const set = new Map(), s = situacao();
    set.set(chaveMes(s.hoje.getFullYear(), s.hoje.getMonth()), { ano: s.hoje.getFullYear(), mo: s.hoje.getMonth() });
    for (const x of (T.idx || new Map()).values()) set.set(chaveMes(x.ano, x.mo), { ano: x.ano, mo: x.mo });
    return [...set.values()].sort((a, b) => b.ano * 12 + b.mo - (a.ano * 12 + a.mo)).slice(0, 8);
  }

  function linhasAcomp() {
    const ano = T.ano, mo = T.mo, m = METRICAS.find((x) => x.k === T.metrica);
    const real = realizado(ano, mo), lista = [];
    for (const v of vendedores()) {
      const r1 = resposta(v.c, ano, mo, 1), r2 = resposta(v.c, ano, mo, 2);
      const sel = T.n === 1 ? r1 : T.n === 2 ? r2 : (r2 || r1);
      lista.push({ v, t1: r1 ? r1[m.campo] : null, t2: r2 ? r2[m.campo] : null, t: sel ? sel[m.campo] : null,
        real: real ? real[m.k][v.i] : null, respondeu: !!sel });
    }
    lista.sort((a, b) => (b.real || 0) - (a.real || 0) || (b.t || 0) - (a.t || 0));
    return { lista, m, ano, mo, real };
  }

  function totais(lista) {
    const t = { t1: 0, t2: 0, t: 0, real: 0, resp: 0 };
    for (const x of lista) {
      t.t1 += x.t1 || 0; t.t2 += x.t2 || 0; t.t += x.t || 0; t.real += x.real || 0; if (x.respondeu) t.resp++;
    }
    return t;
  }

  function renderAcompanhamento() {
    const box = $("#trend-track-card"), u = T.ctx.p.user;
    const ms = meses();
    const selMes = h("select", { "aria-label": "Mês", onchange: (e) => { const [a, m] = e.target.value.split("-").map(Number); T.ano = a; T.mo = m; renderAcompanhamento(); } },
      ms.map((x) => h("option", { value: x.ano + "-" + x.mo, selected: x.ano === T.ano && x.mo === T.mo }, NV.MESES[x.mo] + "/" + x.ano)));
    const selN = h("div", { class: "seg", role: "group", "aria-label": "Tendência" }, [[1, "1ª"], [2, "2ª"], [0, "Última"]].map(([n, r]) =>
      h("button", { type: "button", "aria-pressed": String(T.n === n), onclick: () => { T.n = n; renderAcompanhamento(); } }, r)));
    const segM = h("div", { class: "seg wrap", role: "group", "aria-label": "Medida" }, METRICAS.map((m) =>
      h("button", { type: "button", "aria-pressed": String(T.metrica === m.k), onclick: () => { T.metrica = m.k; renderAcompanhamento(); } }, m.rotulo)));

    const { lista, m, ano, mo, real } = linhasAcomp();
    const tt = totais(lista), atual = ano === new Date().getFullYear() && mo === new Date().getMonth();
    const cab = h("thead", {}, h("tr", {}, ["Vendedor", "1ª", "2ª", m.un ? "Realizado" : "Realizado", "% da tendência"].map((t, i) => h("th", { class: i && i < 4 ? "num" : "", style: "cursor:default" }, t))));
    const pct = (x) => (x.t > 0 && x.real != null ? (x.real / x.t) * 100 : null);
    const corpo = lista.map((x) => {
      const pc = pct(x);
      return h("tr", { class: x.respondeu ? "" : "sem-resp" },
        h("td", { class: "wrap" }, x.v.n, u.tipo === "Gerente" && x.v.sup ? h("small", { class: "muted" }, " · " + x.v.sup.split(" ")[0]) : null),
        h("td", { class: "num" }, val(m, x.t1)), h("td", { class: "num" }, val(m, x.t2)),
        h("td", { class: "num" }, val(m, x.real)),
        h("td", { class: "num" }, x.respondeu && pc != null ? barra(pc, atual) : h("span", { class: "muted" }, x.respondeu ? "—" : "não respondeu")));
    });
    const pcT = tt.t > 0 ? (tt.real / tt.t) * 100 : null;
    const rodape = h("tfoot", {}, h("tr", {}, h("td", {}, `Total (${tt.resp} de ${lista.length} responderam)`), h("td", { class: "num" }, val(m, tt.t1)), h("td", { class: "num" }, val(m, tt.t2)),
      h("td", { class: "num" }, val(m, tt.real)), h("td", { class: "num" }, pcT != null ? barra(pcT, atual) : "—")));

    const nota = h("p", { class: "note" }, atual ? "Realizado: vendas do mês até o último dia carregado (a base atualiza de manhã, com os dados até ontem). " : "Realizado: mês fechado. ",
      "% da tendência = realizado ÷ tendência da 1ª/2ª escolhida (ou da última respondida).",
      m.k === "brav" ? " Bravecto: unidades dos produtos Bravecto (a TAG fica de fora)." : "", m.k === "pos" ? " Positivação: clientes CNPJ com valor líquido positivo." : "");
    const erro = T.erro ? h("div", { class: "notice notice-error" }, T.erro + " ", h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => { await carregar(true); render(); } }, "Tentar de novo")) : null;
    const carregando = !T.carregado && !T.erro ? h("p", { class: "note" }, "Carregando as tendências…") : null;

    box.replaceChildren(
      h("div", { class: "card-head" }, h("div", {}, h("h2", { id: "trend-track-title" }, "Acompanhamento"),
        h("p", {}, `${NV.MESES[mo]} de ${ano} · ${atual ? "mês em andamento" : "mês fechado"}`)), h("div", { class: "head-tools" }, selMes, selN)),
      h("div", { class: "card-body" }, erro, carregando, h("div", { class: "trend-metrics" }, segM),
        h("div", { class: "table-wrap" }, h("table", { class: "tbl trend-tbl" }, cab, h("tbody", {}, corpo), rodape)), nota));
  }

  /* mês em andamento: o realizado ainda vai crescer, então a barra é neutra; em mês fechado, verde/amarelo/vermelho */
  function barra(pc, andamento) {
    const cls = andamento ? "neu" : pc >= 100 ? "ok" : pc >= 80 ? "mid" : "low";
    return h("div", { class: "tbar " + cls }, h("span", {}, fmt.pct(pc)), h("i", { style: `width:${Math.max(2, Math.min(100, pc))}%` }));
  }

  /* ---------------------------------------------------------------- imagem para o WhatsApp */
  function gerarImagem() {
    const { lista, m, ano, mo } = linhasAcomp(), tt = totais(lista);
    const hojeD = new Date(), andamento = ano === hojeD.getFullYear() && mo === hojeD.getMonth();
    const corTxt = (pc) => (andamento ? "#175CD3" : pc >= 100 ? "#067647" : pc >= 80 ? "#B54708" : "#B42318");
    const corBarra = (pc) => (andamento ? "#2E90FA" : pc >= 100 ? "#12B76A" : pc >= 80 ? "#F79009" : "#F04438");
    const W = 1080, linhaH = 64, topo = 250, pe = 120, H = topo + (lista.length + 2) * linhaH + pe;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    const fonte = (px, peso) => `${peso || 500} ${px}px Inter, "Segoe UI", system-ui, sans-serif`;
    c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, W, 190); g.addColorStop(0, "#C94B5E"); g.addColorStop(1, "#8F2C3F");
    c.fillStyle = g; c.fillRect(0, 0, W, 190);
    c.fillStyle = "#FFFFFF"; c.font = fonte(46, 700); c.textBaseline = "alphabetic";
    c.fillText(`Tendência — ${NV.MESES[mo]}/${ano}`, 48, 84);
    c.font = fonte(30, 500); c.fillStyle = "rgba(255,255,255,.92)";
    const qual = T.n === 1 ? "1ª Tendência" : T.n === 2 ? "2ª Tendência" : "Última tendência";
    c.fillText(`${qual} · ${m.nome}`, 48, 134);
    c.font = fonte(22, 500); c.fillStyle = "rgba(255,255,255,.8)";
    c.fillText(`Realizado até ${new Date().toLocaleDateString("pt-BR")} · ${lista.filter((x) => x.respondeu).length} de ${lista.length} responderam`, 48, 170);
    // colunas
    const col = { nome: 48, tend: 665, real: 838, pct: 1032 };   // tend/real/pct = borda direita de cada coluna
    c.fillStyle = "#667085"; c.font = fonte(22, 600);
    c.textAlign = "left"; c.fillText("VENDEDOR", col.nome, topo - 22);
    c.textAlign = "right"; c.fillText("TENDÊNCIA", col.tend, topo - 22); c.fillText("REALIZADO", col.real, topo - 22); c.fillText("ATINGIDO", col.pct, topo - 22);
    const linha = (x, i, total) => {
      const y = topo + i * linhaH;
      if (!total && i % 2 === 1) { c.fillStyle = "#F7F7F9"; c.fillRect(0, y, W, linhaH); }
      if (total) { c.fillStyle = "#FBE9EC"; c.fillRect(0, y, W, linhaH); }
      const cy = y + linhaH / 2 + 8;
      c.textAlign = "left"; c.fillStyle = "#2C2C2C"; c.font = fonte(26, total ? 700 : 500);
      let nome = total ? "TOTAL" : x.v.n; while (c.measureText(nome).width > 440 && nome.length > 4) nome = nome.slice(0, -2);
      c.fillText(nome === (total ? "TOTAL" : x.v.n) ? nome : nome + "…", col.nome, cy);
      c.textAlign = "right"; c.font = fonte(26, total ? 700 : 500);
      const t = x.t, rr = x.real;
      c.fillStyle = x.respondeu === false ? "#B42318" : "#2C2C2C";
      c.fillText(x.respondeu === false ? "—" : val(m, t), col.tend, cy);
      c.fillStyle = "#2C2C2C"; c.fillText(val(m, rr), col.real, cy);
      const pc = t > 0 && rr != null ? (rr / t) * 100 : null;
      if (pc != null && x.respondeu !== false) {
        c.fillStyle = corTxt(pc); c.font = fonte(26, 700);
        c.fillText(fmt.pct(pc), col.pct, cy);
        c.fillStyle = "#E4E7EC"; c.fillRect(col.pct - 150, y + linhaH - 14, 150, 6);
        c.fillStyle = corBarra(pc); c.fillRect(col.pct - 150, y + linhaH - 14, 150 * Math.min(1, pc / 100), 6);
      } else { c.fillStyle = "#B42318"; c.font = fonte(22, 600); c.fillText(x.respondeu === false ? "não respondeu" : "—", col.pct, cy); }
    };
    lista.forEach((x, i) => linha(x, i, false));
    linha({ t: tt.t, real: tt.real, v: {} }, lista.length, true);
    c.textAlign = "left"; c.fillStyle = "#98A2B3"; c.font = fonte(20, 500);
    c.fillText(`Radar Novavet · gerado em ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, 48, H - 44);
    return new Promise((res) => cv.toBlob(res, "image/png"));
  }

  async function abrirImagem() {
    const blob = await gerarImagem();
    T.blob = blob;
    const img = $("#trend-img"); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url;
    $("#modal-trend-img").showModal();
  }
  function nomeArquivo() { return `tendencia_${NV.MESES[T.mo != null ? T.mo : new Date().getMonth()].toLowerCase()}_${T.metrica}.png`; }
  async function compartilhar() {
    if (!T.blob) return;
    const file = new File([T.blob], nomeArquivo(), { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Tendência Novavet" }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    NV.download(T.blob, file.name);
    NV.toast("Imagem baixada. Anexe no WhatsApp.", "ok", 5000);
  }

  /* ---------------------------------------------------------------- API */
  NV.trend = {
    /* contexto da sessão: payload (p), motor de dados e token. Se a tendência não está configurada, não aparece no menu. */
    init(ctx) {
      T.ctx = ctx; T.linhas = []; T.carregado = false; T.erro = ""; T.mo = null; T.ano = null; T.n = 1; T.metrica = "geral"; T.real = {}; T._vend = null; T.idx = null;
      T.form = { rca: 0, n: 1 };
      const ativo = !!ctx.p.tendencias && !!NV.remote.endpoint;
      $("#app-nav [data-view=trend]").hidden = !ativo;
      $("#app-nav").hidden = !ativo;
      $("#alert-bar").hidden = true; $("#trend-dot").hidden = true;
      if (!ativo) return;
      carregar(true).then(atualizarAlerta);
    },
    async mostrar() { if (!T.ctx) return; render(); await carregar(false); render(); },
    irParaResponder() { $("#trend-form-card").scrollIntoView({ behavior: "smooth", block: "start" }); },
    abrirImagem, compartilhar,
    salvarImagem() { if (T.blob) NV.download(T.blob, nomeArquivo()); },
  };
})();

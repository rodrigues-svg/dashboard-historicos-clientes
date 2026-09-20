/* Exportações: PDF do histórico (jsPDF + AutoTable), CSV e chamadas ao Apps Script (e-mail / log). */
(function () {
  const NV = (window.NV = window.NV || {});
  const P = (s) => NV.fmt.plain(s);                       // remove espaço não-quebrável (Helvetica/WinAnsi)
  const brl = (v) => P(NV.fmt.brl(v));

  NV.exporters = {
    MAX_PDF_ROWS: 3000,

    /* ordem de leitura de um histórico: cliente, mês mais recente primeiro, produto */
    sortRows(eng, ids) {
      const rc = eng.rank("cli"), rp = eng.rank("prod");
      return ids.slice().sort((a, b) => rc[eng.cli[a]] - rc[eng.cli[b]] || eng.ym[b] - eng.ym[a] || rp[eng.prod[a]] - rp[eng.prod[b]] || a - b);
    },

    slug(s) { return NV.norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "novavet"; },
    stamp() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },

    /* ctx: { eng, ids, sum, user, periodText, filtersText, clientLine, clientName } */
    buildPdf(ctx) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = 297, H = 210, M = 12;
      const ink = [44, 44, 44], red = [201, 75, 94], blue = [75, 163, 212], blueInk = [14, 42, 58];
      const now = new Date();

      /* cabeçalho */
      doc.setFillColor(...red); doc.rect(0, 0, W, 40, "F");
      doc.setFillColor(255, 255, 255); doc.roundedRect(M, 6, 58, 28, 3, 3, "F");
      if (window.NV_LOGO) {
        const lw = 52, lh = lw / (window.NV_LOGO_RATIO || 3.14);
        doc.addImage(window.NV_LOGO, "PNG", M + 3, 6 + (28 - lh) / 2, lw, lh);
      }
      const tx = M + 66;
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      doc.text("RELATÓRIO DE HISTÓRICO DE COMPRAS", tx, 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      let y = 20;
      doc.text("Data de Emissão: " + NV.fmt.date(now), tx, y); y += 5;
      doc.text("Período: " + ctx.periodText, tx, y); y += 5;
      if (ctx.clientLine) { doc.setFont("helvetica", "bold"); doc.text(P(ctx.clientLine), tx, y, { maxWidth: W - tx - M }); doc.setFont("helvetica", "normal"); y += 5; }
      const fl = doc.splitTextToSize("Filtros aplicados: " + P(ctx.filtersText), W - tx - M).slice(0, ctx.clientLine ? 1 : 2);
      doc.setFontSize(8); doc.text(fl, tx, y);

      /* tabela */
      const rows = ctx.ids.map((i) => {
        const r = ctx.eng.row(i);
        const neg = r.liq < 0;
        return [P(r.cli.n), P(r.prod.n), P(r.forn), NV.fmt.ymNum(r.ym), NV.fmt.int(r.qtd),
          { content: brl(r.liq), styles: neg ? { textColor: [180, 35, 47] } : {} }];
      });
      doc.autoTable({
        startY: 46,
        head: [["Cliente", "Produto", "Laboratório", "Mês/Ano", "Qtd", "Valor (líquido)"]],
        body: rows, theme: "plain", showHead: "everyPage",
        styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 1.7, bottom: 1.7, left: 2, right: 2 }, textColor: ink, overflow: "linebreak", lineWidth: 0 },
        headStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: "bold" },
        bodyStyles: { fillColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: { 0: { cellWidth: 66 }, 2: { cellWidth: 38 }, 3: { cellWidth: 20, halign: "center" }, 4: { cellWidth: 16, halign: "right" }, 5: { cellWidth: 32, halign: "right" } },
        margin: { left: M, right: M, top: 14, bottom: 18 },
      });

      /* resumo financeiro */
      let yy = doc.lastAutoTable.finalY + 8;
      if (yy + 36 > H - 16) { doc.addPage(); yy = 18; }
      doc.setTextColor(...ink); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text("RESUMO FINANCEIRO", M, yy); yy += 4;
      const bw = (W - 2 * M - 12) / 3, items = [["Venda (imputado)", ctx.sum.venda], ["Devoluções", ctx.sum.dev], ["Valor Líquido (faturado)", ctx.sum.liq]];
      items.forEach(([label, v], k) => {
        const x = M + k * (bw + 6);
        doc.setFillColor(...blue); doc.roundedRect(x, yy, bw, 20, 2, 2, "F");
        doc.setTextColor(...blueInk); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.text(label, x + 5, yy + 7);
        doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(brl(v), x + 5, yy + 15.5);
      });
      doc.setTextColor(102, 112, 133); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.text(doc.splitTextToSize("Valor líquido = faturado no sistema, já descontadas as devoluções. Pode diferir de Venda − Devolução quando pedidos são imputados e faturados em meses diferentes.", W - 2 * M), M, yy + 26);

      /* rodapé em todas as páginas */
      const n = doc.getNumberOfPages(), u = ctx.user;
      const who = ["Novavet Distribuidora", "Relatório gerado por: " + P(u.nome)];
      if (u.email && !u.pendente) who.push("E-mail: " + u.email);
      if (u.telefone) who.push("Telefone: " + u.telefone);
      for (let p = 1; p <= n; p++) {
        doc.setPage(p);
        doc.setDrawColor(211, 216, 222); doc.setLineWidth(0.2); doc.line(M, H - 13, W - M, H - 13);
        doc.setTextColor(102, 112, 133); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
        doc.text(who.join("   |   "), M, H - 8);
        doc.text(`Página ${p} de ${n}`, W - M, H - 8, { align: "right" });
      }
      const filename = `Historico_Compras_${this.slug(ctx.clientName || "novavet")}_${this.stamp()}.pdf`;
      return { doc, filename };
    },

    pdfBase64(doc) { return doc.output("datauristring").split(",")[1]; },

    buildCsv(eng, ids) {
      const q = (s) => {
        let t = String(s == null ? "" : s);
        if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;               // evita injeção de fórmula ao abrir no Excel
        return '"' + t.replace(/"/g, '""') + '"';
      };
      const n = (v) => v.toFixed(2).replace(".", ",");
      const out = ["Cliente;CNPJ/CPF;Código;Cidade;Bairro;Cliente Principal;RCA;Supervisor;Laboratório;Produto;Mês;Ano;Qtd;Venda (R$);Devolução (R$);Valor Líquido (R$)"];
      for (const i of this.sortRows(eng, ids)) {
        const r = eng.row(i);
        out.push([q(r.cli.n), q(r.cli.d), r.cli.c, q(r.cli.y), q(r.cli.b), q(r.principal.n), q(r.rca.n), q(r.sup), q(r.forn), q(r.prod.n),
          NV.MESES[r.ym % 12], Math.floor(r.ym / 12), r.qtd, n(r.venda), n(r.dev), n(r.liq)].join(";"));
      }
      return new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" });
    },
  };

  /* ---- Apps Script (e-mail e log). Sem endpoint configurado, tudo isso é ignorado. ---- */
  NV.remote = {
    get endpoint() { return (window.NV_CONFIG && window.NV_CONFIG.emailEndpoint) || ""; },
    async sendEmail(payload) {
      const res = await fetch(this.endpoint, { method: "POST", body: JSON.stringify(Object.assign({ action: "email" }, payload)), redirect: "follow" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.erro || "Falha no envio.");
      return j;
    },
    logLogin(token) {
      if (!this.endpoint) return;
      try { fetch(this.endpoint, { method: "POST", mode: "no-cors", keepalive: true, body: JSON.stringify({ action: "login", token, ua: navigator.userAgent.slice(0, 140) }) }); } catch (e) { /* log é opcional */ }
    },
    async fetchLog(token) {
      const res = await fetch(this.endpoint + (this.endpoint.includes("?") ? "&" : "?") + "action=log&token=" + encodeURIComponent(token), { redirect: "follow" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.erro || "Sem permissão.");
      return j.linhas;
    },
  };
})();

/* Utilitários: formatação pt-BR, DOM seguro, toast, debounce */
(function () {
  const NV = (window.NV = window.NV || {});

  NV.MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  NV.MESES_ABR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  const nbsp = / /g;
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const brl0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const int = new Intl.NumberFormat("pt-BR");
  const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  NV.fmt = {
    brl: (v) => brl.format(v),
    brl0: (v) => brl0.format(v),
    int: (v) => int.format(v),
    num2: (v) => dec2.format(v),
    pct: (v) => dec1.format(v) + "%",
    pctSigned: (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + dec1.format(Math.abs(v)) + "%",
    /* eixo do gráfico: R$ 0 / R$ 500 mil / R$ 1,2 mi */
    compact(v, isMoney) {
      const a = Math.abs(v);
      let s;
      if (a >= 1e6) s = dec1.format(v / 1e6).replace(",0", "") + " mi";
      else if (a >= 1e3) s = int.format(Math.round(v / 1e3)) + " mil";
      else s = int.format(Math.round(v));
      return isMoney ? "R$ " + s : s;
    },
    ym(ym) { return NV.MESES_ABR[ym % 12] + "/" + Math.floor(ym / 12); },
    ymFull(ym) { return NV.MESES[ym % 12] + " de " + Math.floor(ym / 12); },
    ymNum(ym) { return String((ym % 12) + 1).padStart(2, "0") + "/" + Math.floor(ym / 12); },
    date(d) { return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); },
    plain: (s) => String(s).replace(nbsp, " "),
  };

  NV.norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  NV.digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  NV.initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  /* h('div', {class:'x', onclick:fn}, 'texto', outroNo) - sempre textContent para strings */
  NV.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "html") throw new Error("html não é permitido");
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  NV.icon = (id) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  };
  NV.$ = (sel, root) => (root || document).querySelector(sel);
  NV.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  NV.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  NV.toast = function (msg, type, ms) {
    const t = NV.h("div", { class: "toast " + (type || ""), role: type === "err" ? "alert" : "status" }, msg);
    NV.$("#toast-root").append(t);
    setTimeout(() => t.remove(), ms || 4500);
  };

  NV.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ } },
  };

  NV.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  NV.validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
})();

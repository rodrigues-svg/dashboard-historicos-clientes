/* Componentes: MultiSelect (com busca), Table (ordenação + paginação + expansão), gráfico de colunas */
(function () {
  const NV = (window.NV = window.NV || {});
  const { h, icon, norm } = NV;

  /* ------------------------------------------------------------------ MultiSelect */
  NV.MultiSelect = class {
    constructor(root, o) {
      this.root = root;
      this.o = Object.assign({ searchable: false, placeholder: "Todos", max: 60, onChange() {}, label: "" }, o);
      this.sel = new Set();
      this.options = [];
      this.byId = new Map();
      this.uid = "ms" + Math.random().toString(36).slice(2, 8);
      this.text = h("span", { class: "ms-text is-empty" }, this.o.placeholder);
      this.btn = h("button", { type: "button", class: "ms-field", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-labelledby": this.uid + "-l " + this.uid + "-b", id: this.uid + "-b" }, this.text, icon("i-chev"));
      this.search = this.o.searchable ? h("input", { type: "search", class: "ms-search", placeholder: "Digite para buscar…", "aria-label": "Buscar em " + this.o.label, autocomplete: "off" }) : null;
      this.list = h("ul", { class: "ms-list", role: "listbox", "aria-multiselectable": "true", "aria-label": this.o.label });
      this.count = h("span", {});
      this.clearBtn = h("button", { type: "button" }, "Limpar");
      this.pop = h("div", { class: "ms-pop", hidden: true }, this.search, this.list, h("div", { class: "ms-foot" }, this.count, this.clearBtn));
      root.replaceChildren(h("span", { class: "lbl", id: this.uid + "-l" }, this.o.label), this.btn, this.pop);

      this.btn.addEventListener("click", () => (this.pop.hidden ? this.open() : this.close()));
      this.clearBtn.addEventListener("click", () => this.setSelected(new Set(), true));
      if (this.search) this.search.addEventListener("input", NV.debounce(() => this.renderList(), 90));
      this.root.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.pop.hidden) { this.close(); this.btn.focus(); } });
      document.addEventListener("pointerdown", (e) => { if (!this.pop.hidden && !this.root.contains(e.target)) this.close(); });
    }

    setOptions(options) {
      this.options = options.map((op) => Object.assign({ s: norm(op.label + " " + (op.sub || "") + " " + NV.digits(op.sub || "")) }, op));
      this.byId = new Map(this.options.map((op) => [op.id, op]));
      let pruned = false;
      for (const id of Array.from(this.sel)) if (!this.byId.has(id)) { this.sel.delete(id); pruned = true; }
      this.renderSummary();
      if (!this.pop.hidden) this.renderList();
      return pruned;
    }

    getSelected() { return new Set(this.sel); }

    setSelected(set, notify) {
      this.sel = new Set(set);
      this.renderSummary();
      if (!this.pop.hidden) this.renderList();
      if (notify) this.o.onChange(this.getSelected());
    }

    open() {
      this.pop.hidden = false;
      this.btn.setAttribute("aria-expanded", "true");
      if (this.search) { this.search.value = ""; }
      this.renderList();
      if (this.search) this.search.focus({ preventScroll: true });
    }
    close() { this.pop.hidden = true; this.btn.setAttribute("aria-expanded", "false"); }

    renderSummary() {
      const n = this.sel.size;
      let t = this.o.placeholder;
      if (n === 1) { const op = this.byId.get(this.sel.values().next().value); t = op ? op.label : "1 selecionado"; }
      else if (n > 1) t = n + " selecionados";
      this.text.textContent = t;
      this.text.classList.toggle("is-empty", n === 0);
    }

    renderList() {
      const q = this.search ? norm(this.search.value).trim() : "";
      const tokens = q.split(/\s+/).filter(Boolean);
      let matches = tokens.length ? this.options.filter((op) => tokens.every((t) => op.s.includes(t))) : this.options.slice();
      if (!tokens.length && this.sel.size) matches.sort((a, b) => (this.sel.has(b.id) ? 1 : 0) - (this.sel.has(a.id) ? 1 : 0));
      const shown = matches.slice(0, this.o.max);
      const frag = document.createDocumentFragment();
      shown.forEach((op) => {
        const cb = h("input", { type: "checkbox" });
        cb.checked = this.sel.has(op.id);
        cb.addEventListener("change", () => {
          cb.checked ? this.sel.add(op.id) : this.sel.delete(op.id);
          this.renderSummary();
          this.o.onChange(this.getSelected());
        });
        frag.append(h("li", { role: "option", "aria-selected": String(cb.checked) },
          h("label", { class: "ms-opt" }, cb, h("span", {}, h("span", { class: "o-main" }, op.label), op.sub ? h("span", { class: "o-sub" }, op.sub) : null))));
      });
      if (!shown.length) frag.append(h("li", { class: "ms-empty" }, "Nenhum resultado."));
      this.list.replaceChildren(frag);
      this.count.textContent = matches.length > shown.length
        ? `Mostrando ${shown.length} de ${NV.fmt.int(matches.length)} — digite para refinar`
        : `${NV.fmt.int(matches.length)} opç${matches.length === 1 ? "ão" : "ões"}`;
    }
  };

  /* ------------------------------------------------------------------ Table */
  NV.Table = class {
    constructor(root, o) {
      this.root = root;
      this.o = Object.assign({ pageSizes: [10, 25, 50], pageSize: 10, empty: "Nenhum registro para os filtros selecionados." }, o);
      this.pageSize = this.o.pageSize;
      this.sort = this.o.sort || { key: this.o.columns[0].key, dir: "asc" };
      this.ids = [];
      this.order = null;
      this.page = 0;
      this.expanded = new Set();
    }

    setRows(ids, keepPage) {
      this.ids = ids;
      this.order = null;
      this.expanded.clear();
      if (!keepPage) this.page = 0;
      this.render();
    }

    sorted() {
      if (this.order) return this.order;
      const col = this.o.columns.find((c) => c.key === this.sort.key) || this.o.columns[0];
      const ids = this.ids, n = ids.length, dir = this.sort.dir === "asc" ? 1 : -1;
      const keys = new Array(n);
      for (let i = 0; i < n; i++) keys[i] = col.sort ? col.sort(ids[i]) : 0;
      const perm = new Array(n);
      for (let i = 0; i < n; i++) perm[i] = i;
      const str = n && typeof keys[0] === "string";
      perm.sort((a, b) => {
        const x = keys[a], y = keys[b];
        const c = str ? x.localeCompare(y, "pt-BR") : x - y;
        return c ? c * dir : a - b;
      });
      return (this.order = perm.map((i) => ids[i]));
    }

    render() {
      const { columns } = this.o;
      const total = this.ids.length;
      const pages = Math.max(1, Math.ceil(total / this.pageSize));
      if (this.page >= pages) this.page = pages - 1;
      const start = this.page * this.pageSize;
      const slice = total ? this.sorted().slice(start, start + this.pageSize) : [];

      const thead = h("tr", {}, columns.map((c) => {
        const active = this.sort.key === c.key;
        const th = h("th", { class: c.num ? "num" : "", scope: "col", tabindex: "0", "aria-sort": active ? (this.sort.dir === "asc" ? "ascending" : "descending") : "none" },
          c.label, h("span", { class: "sort", "aria-hidden": "true" }, active ? (this.sort.dir === "asc" ? "▲" : "▼") : "↕"));
        const go = () => {
          this.sort = { key: c.key, dir: active ? (this.sort.dir === "asc" ? "desc" : "asc") : (c.num ? "desc" : "asc") };
          this.order = null; this.page = 0; this.render();
        };
        th.addEventListener("click", go);
        th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        return th;
      }));

      const tbody = h("tbody", {});
      slice.forEach((id) => {
        const open = this.expanded.has(id);
        const tr = h("tr", { class: "row" + (this.o.rowClass ? " " + (this.o.rowClass(id) || "") : ""), "aria-expanded": this.o.expand ? String(open) : null },
          columns.map((c) => {
            const v = c.cell(id);
            return h("td", { class: (c.num ? "num " : "") + (c.cls || "") }, v);
          }));
        if (this.o.expand) tr.addEventListener("click", (e) => {
          if (e.target.closest("button,a")) return;
          this.expanded.has(id) ? this.expanded.delete(id) : this.expanded.add(id);
          this.render();
        });
        tbody.append(tr);
        if (open && this.o.expand) tbody.append(h("tr", { class: "detail" }, h("td", { colspan: columns.length }, this.o.expand(id))));
      });
      if (!slice.length) tbody.append(h("tr", {}, h("td", { colspan: columns.length, class: "empty" }, this.o.empty)));

      const table = h("table", { class: "tbl" }, h("thead", {}, thead), tbody);
      const sizeSel = h("select", { "aria-label": "Registros por página" }, this.o.pageSizes.map((s) => h("option", { value: s, selected: s === this.pageSize }, s + " por página")));
      sizeSel.addEventListener("change", () => { this.pageSize = +sizeSel.value; this.page = 0; this.render(); });
      const prev = h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: this.page === 0, onclick: () => { this.page--; this.render(); } }, "‹ Anterior");
      const next = h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: this.page >= pages - 1, onclick: () => { this.page++; this.render(); } }, "Próxima ›");
      const pager = h("div", { class: "pager" },
        h("span", {}, total ? `Mostrando ${NV.fmt.int(start + 1)}–${NV.fmt.int(Math.min(start + this.pageSize, total))} de ${NV.fmt.int(total)}` : "0 registros"),
        h("div", { class: "pg-ctrl" }, sizeSel, prev, h("span", {}, `${this.page + 1} / ${pages}`), next));
      this.root.replaceChildren(h("div", { class: "table-wrap" }, table), pager);
    }
  };

  /* ------------------------------------------------------------------ Gráfico */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const mixWhite = (hex, t) => {
    const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
    return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  };

  NV.charts = {
    inst: null,
    destroy() { if (this.inst) { this.inst.destroy(); this.inst = null; } },
    /* o.datasets: [{label, data, color}]; o.titles: título completo de cada categoria; o.deltaFn(index) -> texto opcional */
    draw(canvas, o) {
      this.destroy();
      if (!window.Chart) return;
      const ink = css("--ink"), ink2 = css("--ink-2"), surface = css("--surface"), line = css("--line-2"), grid = css("--grid");
      const fmtV = (v) => (o.isMoney ? NV.fmt.plain(NV.fmt.brl(v)) : NV.fmt.int(v));
      this.inst = new Chart(canvas, {
        type: "bar",
        data: {
          labels: o.labels,
          datasets: o.datasets.map((d) => ({
            label: d.label, data: d.data, backgroundColor: d.color, hoverBackgroundColor: mixWhite(d.color, 0.2),
            borderColor: surface, borderWidth: { top: 0, bottom: 0, left: 1, right: 1 },
            borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }, borderSkipped: "bottom",
            maxBarThickness: 24, categoryPercentage: 0.82, barPercentage: 0.95,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          interaction: { mode: "index", intersect: false },
          layout: { padding: { top: 6, right: 6 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: surface, titleColor: ink, bodyColor: ink, borderColor: line, borderWidth: 1, padding: 10, cornerRadius: 10,
              titleFont: { family: "Inter", weight: "500", size: 12 }, bodyFont: { family: "Inter", weight: "700", size: 13 },
              boxWidth: 12, boxHeight: 3, boxPadding: 4, usePointStyle: false,
              callbacks: {
                title: (items) => o.titles[items[0].dataIndex],
                label: (ctx) => " " + fmtV(ctx.parsed.y) + "   " + ctx.dataset.label,
                labelColor: (ctx) => ({ borderColor: ctx.dataset.backgroundColor, backgroundColor: ctx.dataset.backgroundColor, borderWidth: 0, borderRadius: 2 }),
                afterBody: (items) => (o.deltaFn ? o.deltaFn(items[0].dataIndex) : ""),
              },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { color: line }, ticks: { color: ink2, font: { family: "Inter", size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
            y: { beginAtZero: true, grid: { color: grid, lineWidth: 1 }, border: { display: false },
              ticks: { color: ink2, font: { family: "Inter", size: 11 }, maxTicksLimit: 6, callback: (v) => NV.fmt.compact(v, o.isMoney) } },
          },
        },
      });
    },
  };
})();

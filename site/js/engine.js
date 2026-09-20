/* Motor de dados: filtros e agregações sobre arrays tipados (sem DOM).
   Filtro = { tipo, clientes:Set, principais:Set, labs:Set, months:Set, from, to, sup, rcas:Set, prods:Set }
   (conjuntos vazios = "todos"; from/to = ano*12 + mês0) */
(function () {
  const NV = (window.NV = window.NV || {});
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

  NV.Engine = class Engine {
    constructor(p) {
      this.p = p;
      const r = p.rows;
      this.n = r.ym.length;
      this.cli = Int32Array.from(r.cli);
      this.rca = Int16Array.from(r.rca);
      this.prod = Int16Array.from(r.prod);
      this.ym = Int32Array.from(r.ym);
      this.venda = Float64Array.from(r.venda, (v) => v / 100);
      this.dev = Float64Array.from(r.dev, (v) => v / 100);
      this.liq = Float64Array.from(r.liq, (v) => v / 100);
      this.qtd = Int32Array.from(r.qtd);
      this.nCli = p.cli.length;
      this.nProd = p.prod.length;
      this.nRca = p.rca.length;
      this.prodForn = Int16Array.from(p.prod, (x) => x.f);
      this.rcaSup = Int16Array.from(p.rca, (x) => x.s);
      this.cliPr = Int32Array.from(p.cli, (x) => x.p);
      this.ymMin = p.meta.ymMin;
      this.ymMax = p.meta.ymMax;
      this._rank = {};
    }

    /* posição de cada item numa ordenação alfabética (para ordenar tabelas rápido) */
    rank(kind) {
      if (this._rank[kind]) return this._rank[kind];
      const p = this.p;
      const names = kind === "cli" ? p.cli.map((c) => c.n) : kind === "prod" ? p.prod.map((x) => x.n)
        : kind === "forn" ? p.forn : kind === "rca" ? p.rca.map((x) => x.n) : p.cli.map((c) => c.y);
      const order = names.map((_, i) => i).sort((a, b) => collator.compare(names[a], names[b]));
      const r = new Int32Array(names.length);
      order.forEach((idx, pos) => (r[idx] = pos));
      return (this._rank[kind] = r);
    }

    allowed(f) {
      const p = this.p;
      const cli = new Uint8Array(this.nCli);
      const hasC = f.clientes.size > 0, hasP = f.principais.size > 0;
      for (let i = 0; i < this.nCli; i++) {
        let ok = 1;
        if (f.tipo && p.cli[i].t !== f.tipo) ok = 0;
        else if (hasC && !f.clientes.has(i)) ok = 0;
        else if (hasP && !f.principais.has(this.cliPr[i])) ok = 0;
        cli[i] = ok;
      }
      const prod = new Uint8Array(this.nProd);
      const hasL = f.labs.size > 0, hasPr = f.prods.size > 0;
      for (let i = 0; i < this.nProd; i++) {
        prod[i] = (!hasL || f.labs.has(this.prodForn[i])) && (!hasPr || f.prods.has(i)) ? 1 : 0;
      }
      const rca = new Uint8Array(this.nRca);
      const hasR = f.rcas.size > 0;
      for (let i = 0; i < this.nRca; i++) {
        rca[i] = (f.sup < 0 || this.rcaSup[i] === f.sup) && (!hasR || f.rcas.has(i)) ? 1 : 0;
      }
      const mon = new Uint8Array(12);
      for (let m = 0; m < 12; m++) mon[m] = f.months.size === 0 || f.months.has(m) ? 1 : 0;
      return { cli, prod, rca, mon };
    }

    /* shift = deslocamento em meses da janela de período (-12 = mesmo período do ano anterior) */
    mask(f, shift = 0) {
      const a = this.allowed(f);
      const lo = f.from + shift, hi = f.to + shift;
      const m = new Uint8Array(this.n);
      let count = 0;
      for (let i = 0; i < this.n; i++) {
        const y = this.ym[i];
        if (y < lo || y > hi || !a.mon[y % 12]) continue;
        if (a.cli[this.cli[i]] && a.prod[this.prod[i]] && a.rca[this.rca[i]]) { m[i] = 1; count++; }
      }
      return { m, count };
    }

    summary(mk) {
      const m = mk.m;
      let venda = 0, dev = 0, liq = 0, qtd = 0;
      const cliLiq = new Float64Array(this.nCli);
      for (let i = 0; i < this.n; i++) {
        if (!m[i]) continue;
        venda += this.venda[i]; dev += this.dev[i]; liq += this.liq[i]; qtd += this.qtd[i];
        cliLiq[this.cli[i]] += this.liq[i];
      }
      let clientes = 0;
      for (let c = 0; c < this.nCli; c++) if (cliLiq[c] > 0.005) clientes++;   // clientes positivados
      return { venda, dev, liq, qtd, clientes, linhas: mk.count };
    }

    /* série mensal para os meses lo..hi */
    series(mk, lo, hi) {
      const len = hi - lo + 1, m = mk.m;
      const o = { venda: new Float64Array(len), dev: new Float64Array(len), liq: new Float64Array(len), qtd: new Float64Array(len) };
      for (let i = 0; i < this.n; i++) {
        if (!m[i]) continue;
        const k = this.ym[i] - lo;
        if (k < 0 || k >= len) continue;
        o.venda[k] += this.venda[i]; o.dev[k] += this.dev[i]; o.liq[k] += this.liq[i]; o.qtd[k] += this.qtd[i];
      }
      return o;
    }

    byRca(mk) {
      const m = mk.m, nR = this.nRca;
      const liq = new Float64Array(nR), qtd = new Float64Array(nR), venda = new Float64Array(nR), seen = new Uint8Array(nR);
      const pair = new Map();
      for (let i = 0; i < this.n; i++) {
        if (!m[i]) continue;
        const r = this.rca[i];
        seen[r] = 1; liq[r] += this.liq[i]; qtd[r] += this.qtd[i]; venda[r] += this.venda[i];
        const key = r * this.nCli + this.cli[i];
        pair.set(key, (pair.get(key) || 0) + this.liq[i]);
      }
      const clientes = new Int32Array(nR);
      pair.forEach((v, key) => { if (v > 0.005) clientes[Math.floor(key / this.nCli)]++; });
      const ids = [];
      for (let r = 0; r < nR; r++) if (seen[r]) ids.push(r);
      return { ids, liq, qtd, venda, clientes };
    }

    byClient(mk) {
      const m = mk.m, n = this.nCli;
      const liq = new Float64Array(n), qtd = new Float64Array(n), venda = new Float64Array(n), dev = new Float64Array(n);
      const last = new Int32Array(n).fill(-1), seen = new Uint8Array(n);
      for (let i = 0; i < this.n; i++) {
        if (!m[i]) continue;
        const c = this.cli[i];
        seen[c] = 1; liq[c] += this.liq[i]; qtd[c] += this.qtd[i]; venda[c] += this.venda[i]; dev[c] += this.dev[i];
        if (this.liq[i] > 0 && this.ym[i] > last[c]) last[c] = this.ym[i];
      }
      const ids = [];
      for (let c = 0; c < n; c++) if (seen[c]) ids.push(c);
      return { ids, liq, qtd, venda, dev, last };
    }

    rowIds(mk) {
      const out = new Array(mk.count);
      let k = 0;
      for (let i = 0; i < this.n; i++) if (mk.m[i]) out[k++] = i;
      return out;
    }

    /* dados completos de uma linha (detalhe, CSV, PDF) */
    row(i) {
      const p = this.p, c = p.cli[this.cli[i]], r = p.rca[this.rca[i]], pr = p.prod[this.prod[i]];
      return {
        cli: c, prod: pr, forn: p.forn[pr.f], rca: r, sup: p.sup[r.s] ? p.sup[r.s].n : "",
        ym: this.ym[i], qtd: this.qtd[i], venda: this.venda[i], dev: this.dev[i], liq: this.liq[i],
        principal: p.pr[c.p],
      };
    }
  };
})();

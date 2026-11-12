"""Lê a planilha de metas anuais (faturamento por laboratório e por RCA, positivação por RCA) e grava o bloco
"metas_ano" no config.local.json.

Uso:  python atualizar_metas_ano.py "C:\\...\\PLANEJAMENTO NOVAVET 2027\\Metas faturamento 2027 Laboratórios total.xlsx"

Vai cifrado só para Gerente (tudo) e Supervisores (os RCAs da equipe); RCAs não recebem. Depois de rodar, atualize o
secret CONFIG_LOCAL_JSON no GitHub.
Aba 1: bloco de laboratórios (linhas "código - fornecedor") e bloco de RCAs (depois de "Supervisor(a): ...").
Aba 2: positivação por RCA. Colunas B..M = jan..dez.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import openpyxl

CONFIG = Path(__file__).resolve().parent / "config.local.json"


def ler(ws):
    labs, rcas, sup = {}, {}, None
    for r in ws.iter_rows(values_only=True):
        a = str(r[0] or "").strip()
        if a.lower().startswith("supervisor"):
            sup = a.split(":", 1)[1].strip()
            continue
        if len(r) < 13 or not isinstance(r[1], (int, float)) or a.lower().startswith("total"):
            continue
        meses = [round(float(x or 0), 2) for x in r[1:13]]
        m = re.match(r"^(\d+)\s*-\s*(.+)$", a)
        if sup and m:
            rcas[m.group(1)] = {"n": m.group(2).strip(), "sup": sup, "m": meses}
        elif not sup:
            labs[a] = meses
    return labs, rcas


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    arq = Path(sys.argv[1])
    ano = int(re.search(r"(20\d\d)", arq.name).group(1))
    wb = openpyxl.load_workbook(arq, data_only=True, read_only=True)
    labs, fat = ler(wb.worksheets[0])
    _, pos = ler(wb.worksheets[1]) if len(wb.worksheets) > 1 else ({}, {})
    rca = {c: {"n": v["n"], "sup": v["sup"], "m": v["m"], "p": (pos.get(c) or {}).get("m", [0] * 12)} for c, v in fat.items()}
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg["metas_ano"] = {"ano": ano, "arquivo": arq.name, "lido": date.today().isoformat(), "labs": labs, "rca": rca}
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    tl, tr = sum(map(sum, labs.values())), sum(sum(v["m"]) for v in rca.values())
    print(f"Metas {ano}: {len(labs)} laboratórios (R$ {tl:,.0f}), {len(rca)} RCAs (R$ {tr:,.0f}), "
          f"positivação {sum(sum(v['p']) for v in rca.values()):,.0f} no ano.")


if __name__ == "__main__":
    main()

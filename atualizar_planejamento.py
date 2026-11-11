"""Lê a planilha do planejamento anual (5W2H) e grava o bloco "planejamento" no config.local.json.

Uso:  python atualizar_planejamento.py "C:\\...\\PLANEJAMENTO NOVAVET 2027\\5W2H 2027.xlsx"

O conteúdo vai cifrado no payload de Gerente e Supervisores (nunca no site público). Depois de rodar, atualize o
secret CONFIG_LOCAL_JSON no GitHub para a atualização automática usar a versão nova.
Abas lidas: "5W2H" (ações), "Calendário Novavet" (agenda), "Ideias Campanhas" e "SWOT".
"""
import json
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent
CONFIG = RAIZ / "config.local.json"
MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]


def sem_acento(s):
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower().strip()


def txt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"\s+", " ", str(v)).strip()


def custo(v):
    if isinstance(v, (int, float)):
        return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return txt(v)


def aba(wb, nome):
    alvo = sem_acento(nome)
    for ws in wb.worksheets:
        if sem_acento(ws.title) == alvo:
            return ws
    return None


def data_do_ano(v, ano):
    """Data da planilha, no ano do planejamento (a planilha copiou várias datas do ano anterior)."""
    if isinstance(v, (datetime, date)):
        try:
            return date(ano, v.month, v.day)
        except ValueError:
            return None
    s = txt(v)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/\d{2,4}$", s)
    if m:
        try:
            return date(ano, int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/\d{1,3}$", s)        # "01/01/202" (ano incompleto)
    if m:
        return date(ano, int(m.group(2)), int(m.group(1)))
    return None


def dias_texto(s, ano):
    """"01 e 02/03/27", "17.23 e 24/11" -> lista de datas."""
    m = re.match(r"^([\d\s.,e]+)/(\d{1,2})(?:/\d{2,4})?$", txt(s))
    if not m:
        return []
    mes = int(m.group(2))
    out = []
    for d in re.findall(r"\d{1,2}", m.group(1)):
        try:
            out.append(date(ano, mes, int(d)))
        except ValueError:
            pass
    return out


def domingo(ano, mes, n):
    d = date(ano, mes, 1)
    primeiro = d.toordinal() + (6 - d.weekday()) % 7
    return date.fromordinal(primeiro + 7 * (n - 1))


def ler_acoes(ws, ano):
    linhas = list(ws.iter_rows(values_only=True))
    cab = next(i for i, r in enumerate(linhas) if r and any(sem_acento(c or "") == "o que?" for c in r))
    idx = {sem_acento(c): j for j, c in enumerate(linhas[cab]) if c}
    col = lambda r, *nomes: next((r[idx[n]] for n in nomes if n in idx and idx[n] < len(r)), None)
    acoes = []
    for r in linhas[cab + 1:]:
        que = txt(col(r, "o que?"))
        if not que:
            continue
        ini, fim = data_do_ano(col(r, "inicio"), ano), data_do_ano(col(r, "fim"), ano)
        concl = sem_acento(col(r, "concluido?") or "")
        acoes.append({
            "reg": txt(col(r, "regional")), "obj": txt(col(r, "objetivo final")), "que": que,
            "porque": txt(col(r, "por que?")), "onde": txt(col(r, "onde?")), "quem": txt(col(r, "quem")),
            "ini": ini.isoformat() if ini else "", "fim": fim.isoformat() if fim else "",
            "como": txt(col(r, "como?")), "custo": custo(col(r, "quanto custa?")),
            "ok": concl in ("sim", "s", "x", "ok", "concluido", "concluida", "true", "1"),
            "status": txt(col(r, "status")), "coment": txt(col(r, "comentario")),
        })
    return acoes


def ler_agenda(ws, ano):
    ev = []
    mes = 0
    for r in ws.iter_rows(min_row=1, values_only=True):
        r = list(r) + [None] * 14
        a = sem_acento(r[0] or "")
        if a in MESES:
            mes = MESES.index(a) + 1
        if not mes:
            continue
        titulo = txt(r[3])
        if titulo:
            if isinstance(r[1], (datetime, date)):
                ds = [data_do_ano(r[1], ano)]
            else:
                ds = dias_texto(r[1], ano)
            if not ds and sem_acento(titulo).startswith("dia das maes"):
                ds = [domingo(ano, 5, 2)]
            tipo = "reuniao" if sem_acento(titulo).startswith("reuni") else "evento" if "premia" in sem_acento(titulo) or "ultimo dia" in sem_acento(titulo) else "data"
            e = {"tipo": tipo, "t": titulo.rstrip(" ."), "local": txt(r[5]), "invest": custo(r[4]) if r[4] else ""}
            if ds:
                e["d"] = [d.isoformat() for d in ds if d]
            else:
                e["mes"] = mes                                       # "Mês da Raiva": vale o mês inteiro
            ev.append(e)
        if r[7]:                                                     # Jantar de Negócios (colunas H-K)
            ds = [data_do_ano(r[7], ano)] if isinstance(r[7], (datetime, date)) else dias_texto(r[7], ano)
            ev.append({"tipo": "jantar", "t": "Jantar de Negócios" + (f" — {txt(r[9])}" if txt(r[9]) else ""),
                       "local": txt(r[8]), "invest": custo(r[10]) if r[10] else "", "d": [d.isoformat() for d in ds if d]})
    return ev


def ler_campanhas(ws):
    linhas = [list(r) for r in ws.iter_rows(values_only=True)]
    if not linhas:
        return []
    out = []
    for j, cab in enumerate(linhas[0]):
        if not cab:
            continue
        itens = [txt(r[j]) for r in linhas[1:] if j < len(r) and txt(r[j])]
        out.append({"tri": txt(cab).replace("Tri", "º tri"), "itens": itens})
    return out


def ler_swot(ws):
    blocos, atual = {}, None
    for r in ws.iter_rows(values_only=True):
        b, c = txt(r[1] if len(r) > 1 else None), txt(r[2] if len(r) > 2 else None)
        chave = (sem_acento(b), sem_acento(c))
        if chave == ("forcas", "fraquesas") or chave == ("forcas", "fraquezas"):
            atual = ("forcas", "fraquezas"); continue
        if chave == ("oportunidades", "ameacas"):
            atual = ("oportunidades", "ameacas"); continue
        if atual:
            if b: blocos.setdefault(atual[0], []).append(b)
            if c: blocos.setdefault(atual[1], []).append(c)
    return blocos


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    arq = Path(sys.argv[1])
    ano = int(re.search(r"(20\d\d)", arq.name).group(1))
    wb = openpyxl.load_workbook(arq, data_only=True, read_only=True)
    plano = {"ano": ano, "arquivo": arq.name, "lido": date.today().isoformat(),
             "acoes": ler_acoes(aba(wb, "5W2H"), ano)}
    if aba(wb, "Calendário Novavet"):
        plano["agenda"] = ler_agenda(aba(wb, "Calendário Novavet"), ano)
    if aba(wb, "Ideias Campanhas"):
        plano["campanhas"] = ler_campanhas(aba(wb, "Ideias Campanhas"))
    if aba(wb, "SWOT"):
        plano["swot"] = ler_swot(aba(wb, "SWOT"))
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg["planejamento"] = plano
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Planejamento {ano}: {len(plano['acoes'])} ações, {len(plano.get('agenda', []))} itens de agenda, "
          f"{len(plano.get('campanhas', []))} trimestres de campanhas, SWOT com {sum(map(len, plano.get('swot', {}).values()))} itens.")


if __name__ == "__main__":
    main()

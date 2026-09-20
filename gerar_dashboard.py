# -*- coding: utf-8 -*-
"""
Dashboard Consulta Históricos de Clientes - Novavet Distribuidora

Gerador: planilha analítica  ->  dados CRIPTOGRAFADOS por usuário (site/data/*.js)
                              ->  Excel com os 21 links de acesso + QR Codes
                              ->  lista de tokens autorizados p/ o envio de e-mail (Apps Script)

Uso rápido:
    python gerar_dashboard.py                       # usa o "excel_padrao" do config.local.json
    python gerar_dashboard.py --excel "C:\\...\\planilha.xlsx"
    python gerar_dashboard.py --gmail --sem-excel   # modo automático (GitHub Actions)
    python gerar_dashboard.py --renovar "Nome Completo"   # novo token p/ um usuário
    python gerar_dashboard.py --revogar "Nome Completo"   # desativa o acesso de um usuário

Configuração: config.json (público: base_url) + config.local.json (só desta máquina/segredo: gmail, excel_padrao).

Segurança (resumo - detalhes no README):
  * Cada usuário recebe um arquivo de dados só com o que ele pode ver.
  * O arquivo é cifrado com AES-256-GCM; a chave nasce de PBKDF2(token | e-mail | senha).
  * Sem o link (token de 256 bits) não há como abrir o arquivo; sem e-mail+senha também não.
"""
import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import os
import re
import secrets
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

BASE = Path(__file__).resolve().parent
SITE = BASE / "site"
DATA_DIR = SITE / "data"
TOKENS_PATH = BASE / "tokens.json"
USUARIOS_CSV = BASE / "usuarios.csv"
CONFIG_PATH = BASE / "config.json"
CONFIG_LOCAL = BASE / "config.local.json"
APPS_SCRIPT_DIR = BASE / "apps_script"
LOGO_ORIGINAL = BASE / "assets" / "Logo Novavet.png"

BRT = timezone(timedelta(hours=-3))          # Brasil sem horário de verão desde 2019
PBKDF2_ITER = 200_000
BASE_URL_PADRAO = "https://dashboard-novavet.com/vendas/"
SENHA_PROVISORIA = "1234"
DOMINIO_PENDENTE = "pendente.novavet"

MESES = {"janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5,
         "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10,
         "novembro": 11, "dezembro": 12}

COLUNAS_OBRIGATORIAS = [
    "Tipo Cliente", "Código Cliente Principal", "Descrição Supervisor", "Descrição RCA",
    "Cliente Principal", "CPF-CNPJ Cliente", "Código Cliente", "Cliente", "Cidade Cliente",
    "Bairro Cliente", "Descrição Fornecedor", "Produto", "Mês", "Ano", "Devolução - Valor",
    "Venda - Valor", "Faturamento - Quantidade de Itens Líquida", "Faturamento - Valor Líquido",
]

# --------------------------------------------------------------------------
# Estrutura organizacional (nomes de exibição). A chave é o CÓDIGO que vem na base.
# Não fica no código (o repositório é público): é montada a partir do usuarios.csv,
# que no CI vem do secret USUARIOS_CSV.
# --------------------------------------------------------------------------
SUPERVISORES = {}      # codigo -> nome
RCAS = {}              # codigo -> (nome, codigo do supervisor)


def montar_diretorio(usuarios):
    SUPERVISORES.clear()
    RCAS.clear()
    for u in usuarios:
        if u.tipo == "Supervisor":
            SUPERVISORES[u.codigo] = u.nome
    for u in usuarios:
        if u.tipo == "Supervisor":                        # o supervisor aparece como RCA em poucas linhas da base
            RCAS[u.codigo] = (f"{u.nome} (carteira própria)", u.codigo)
        elif u.tipo == "RCA":
            if u.sup_codigo not in SUPERVISORES:
                sys.exit(f"ERRO: o RCA '{u.nome}' aponta para o supervisor {u.sup_codigo}, que não está no usuarios.csv.")
            RCAS[u.codigo] = (u.nome, u.sup_codigo)


def agora():
    return datetime.now(BRT)


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")


def so_digitos(s):
    return re.sub(r"\D", "", str(s or ""))


def sha256_hex(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Usuários (usuarios.csv) e tokens permanentes (tokens.json)
# --------------------------------------------------------------------------
class Usuario:
    def __init__(self, linha):
        self.tipo = linha["tipo"].strip().capitalize()             # Gerente / Supervisor / Rca
        if self.tipo.lower() == "rca":
            self.tipo = "RCA"
        self.codigo = int(so_digitos(linha.get("codigo") or "0") or 0)
        self.nome = linha["nome"].strip()
        self.email = (linha.get("email") or "").strip().lower()
        self.telefone = (linha.get("telefone") or "").strip()
        self.sup_codigo = int(so_digitos(linha.get("supervisor_codigo") or "0") or 0)
        self.senha_fixa = so_digitos(linha.get("senha") or "")
        self.obs = (linha.get("obs") or "").strip()
        self.uid = "ger" if self.tipo == "Gerente" else f"{self.tipo.lower()}:{self.codigo}"

    @property
    def pendente(self):
        return not self.email

    @property
    def login(self):
        """E-mail usado no login. Sem e-mail cadastrado usa um login provisório."""
        return self.email or f"{self.codigo}@{DOMINIO_PENDENTE}"

    @property
    def senha(self):
        if self.senha_fixa:
            return self.senha_fixa
        d = so_digitos(self.telefone)
        return d[-4:] if len(d) >= 4 else SENHA_PROVISORIA

    @property
    def senha_provisoria(self):
        return not self.senha_fixa and len(so_digitos(self.telefone)) < 4

    @property
    def supervisor_nome(self):
        return SUPERVISORES.get(self.sup_codigo, "") if self.tipo == "RCA" else ""


def carregar_usuarios():
    if not USUARIOS_CSV.exists():
        sys.exit(f"ERRO: {USUARIOS_CSV.name} não encontrado.")
    texto = USUARIOS_CSV.read_text(encoding="utf-8-sig")
    delim = ";" if texto.splitlines()[0].count(";") >= texto.splitlines()[0].count(",") else ","
    leitor = csv.DictReader(io.StringIO(texto), delimiter=delim)
    usuarios = [Usuario({(k or "").strip().lower(): v for k, v in linha.items()})
                for linha in leitor if (linha.get("nome") or "").strip()]
    ids = [u.uid for u in usuarios]
    if len(ids) != len(set(ids)):
        sys.exit("ERRO: há usuários duplicados no usuarios.csv (mesmo tipo + código).")
    logins = [u.login for u in usuarios]
    if len(logins) != len(set(logins)):
        sys.exit("ERRO: há e-mails repetidos no usuarios.csv.")
    if sum(u.tipo == "Gerente" for u in usuarios) != 1:
        sys.exit("ERRO: o usuarios.csv precisa ter exatamente 1 Gerente.")
    return usuarios


def novo_token():
    """UUID + 128 bits aleatórios, em base64 url-safe (43 caracteres, impossível de duplicar/adivinhar)."""
    return base64.urlsafe_b64encode(uuid.uuid4().bytes + secrets.token_bytes(16)).decode().rstrip("=")


def carregar_tokens():
    if TOKENS_PATH.exists():
        return json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
    return {"versao": 1, "usuarios": {}}


def salvar_tokens(reg):
    TOKENS_PATH.write_text(json.dumps(reg, ensure_ascii=False, indent=2), encoding="utf-8")


def garantir_tokens(reg, usuarios):
    criados = 0
    for u in usuarios:
        if u.uid not in reg["usuarios"]:
            reg["usuarios"][u.uid] = {"token": novo_token(), "criado": agora().isoformat(timespec="seconds"),
                                      "renovado": None, "status": "ativo", "historico": []}
            criados += 1
    return criados


def achar_usuario(usuarios, termo):
    t = sem_acento(termo).strip().lower()
    exatos = [u for u in usuarios if t in (sem_acento(u.nome).lower(), u.email, u.uid)]     # nome completo, e-mail ou id
    achados = exatos or [u for u in usuarios if t and t in sem_acento(u.nome).lower()]
    if len(achados) != 1:
        cand = "; ".join(f"{u.nome} ({u.uid})" for u in achados[:6]) or "nenhum"
        sys.exit(f"ERRO: '{termo}' casou com {len(achados)} usuário(s): {cand}. Use o nome completo, o e-mail ou o id (ex.: rca:1331).")
    return achados[0]


def renovar_token(reg, u):
    r = reg["usuarios"][u.uid]
    r["historico"].append({"token_hash": sha256_hex(r["token"]), "substituido_em": agora().isoformat(timespec="seconds")})
    r["token"] = novo_token()
    r["renovado"] = agora().isoformat(timespec="seconds")
    r["status"] = "ativo"


def fid_do_token(token):
    """Nome do arquivo de dados (público). Derivado do hash - não revela o token."""
    return sha256_hex(token)[:24]


def hash_envio_email(token):
    """Hash usado pelo Apps Script para autorizar o envio de e-mail (diferente do nome do arquivo público)."""
    return sha256_hex("nv-mail|" + token)


def montar_link(base_url, u, token):
    base = base_url if base_url.endswith("/") or base_url.endswith(".html") else base_url + "/"
    return f"{base}?user={urllib.parse.quote(u.login, safe='@.-_')}&token={urllib.parse.quote(token, safe='-_')}"


# --------------------------------------------------------------------------
# Fonte de dados: Excel local ou anexo do Gmail (mesmo padrão dos outros projetos)
# --------------------------------------------------------------------------
def _gmail_get(path, access):
    req = urllib.request.Request("https://www.googleapis.com/gmail/v1/users/me" + path,
                                 headers={"Authorization": f"Bearer {access}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def _achar_xlsx(parte):
    nome = (parte.get("filename") or "").lower()
    if nome.endswith(".xlsx") and parte.get("body", {}).get("attachmentId"):
        return parte
    for sub in parte.get("parts", []) or []:
        achado = _achar_xlsx(sub)
        if achado:
            return achado
    return None


def _cabecalhos(msg):
    return {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}


def email_autenticado(msg, remetente):
    """O e-mail alimenta o painel: só aceita se veio mesmo do remetente configurado.
    Exige (1) o endereço do cabeçalho From igual ao remetente (não vale o nome de exibição) e (2) que o Google
    tenha validado o domínio dele: DMARC=pass com header.from do domínio, ou SPF=pass com smtp.mailfrom do domínio."""
    h = _cabecalhos(msg)
    dominio = remetente.split("@")[-1].lower()
    enderecos = re.findall(r"[\w.+\-']+@[\w.\-]+", h.get("from", ""))
    if [e.lower() for e in enderecos] != [remetente.lower()]:
        return False
    ar = h.get("authentication-results", "")
    dm = re.search(r"\bdmarc=pass\b[^;]*?header\.from=([^\s;]+)", ar)
    if dm and dm.group(1).strip("<>").lower() == dominio:
        return True
    sp = re.search(r"\bspf=pass\b[^;]*?smtp\.mailfrom=([^\s;]+)", ar)
    return bool(sp) and sp.group(1).strip("<>").split("@")[-1].lower() == dominio


def baixar_do_gmail(cfg, token_path, verificar_remetente=True):
    g = cfg.get("gmail") or {}
    if not g.get("remetente") or not g.get("assunto"):
        sys.exit('ERRO: configure "gmail": {"remetente", "assunto"} em config.local.json '
                 "(na automação, vem do secret CONFIG_LOCAL_JSON).")
    g.setdefault("dias", 4)
    td = json.loads(Path(token_path).read_text(encoding="utf-8"))
    dados = urllib.parse.urlencode({"client_id": td["client_id"], "client_secret": td["client_secret"],
                                    "refresh_token": td["refresh_token"], "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request(td.get("token_uri", "https://oauth2.googleapis.com/token"), data=dados, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        access = json.loads(r.read())["access_token"]

    q = f'from:{g["remetente"]} subject:"{g["assunto"]}" newer_than:{g["dias"]}d has:attachment'
    achados = _gmail_get(f"/messages?q={urllib.parse.quote(q)}&maxResults=5", access).get("messages", [])
    # (as mensagens de erro não citam remetente/assunto: o log do Actions de um repositório público é visível)
    if not achados:
        sys.exit(f"ERRO: nenhum e-mail do relatório configurado nos últimos {g['dias']} dias.")
    msg, rejeitados = None, 0
    for a in achados:                                     # do mais recente para o mais antigo
        cand = _gmail_get(f"/messages/{a['id']}?format=full", access)
        if not verificar_remetente or email_autenticado(cand, g["remetente"]):
            msg = cand
            break
        rejeitados += 1
    if msg is None:
        sys.exit(f"ERRO: {rejeitados} e-mail(s) encontrado(s), mas nenhum passou na verificação de remetente "
                 "(From + SPF/DMARC do domínio). Se o relatório mudou de servidor de envio, revise a origem; "
                 "só use --sem-verificar-remetente com certeza da origem.")
    if rejeitados:
        print(f"::warning::{rejeitados} e-mail(s) mais recente(s) foram ignorados por falha na verificação de remetente.")
    parte = _achar_xlsx(msg["payload"])
    if not parte:
        sys.exit("ERRO: o e-mail encontrado não tem anexo .xlsx.")
    anexo = _gmail_get(f"/messages/{msg['id']}/attachments/{parte['body']['attachmentId']}", access)
    fd, nome_tmp = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)                                          # no Windows um descritor aberto impede apagar o arquivo
    caminho = Path(nome_tmp)
    caminho.write_bytes(base64.urlsafe_b64decode(anexo["data"] + "=="))
    data_email = datetime.fromtimestamp(int(msg["internalDate"]) / 1000, BRT)
    idade = (agora() - data_email).total_seconds() / 86400
    if idade > 2.5:
        print(f"::warning::O e-mail mais recente é de {data_email:%d/%m/%Y %H:%M} ({idade:.0f} dias) - "
              "os dados publicados podem estar defasados.")
    return caminho, f"e-mail de {data_email:%d/%m/%Y %H:%M} ({parte.get('filename')})"


def ler_planilha(caminho):
    print(f"Lendo {caminho} ...")
    with pd.ExcelFile(caminho) as xls:                    # fecha o arquivo ao terminar
        aba = "Crosstab1" if "Crosstab1" in xls.sheet_names else xls.sheet_names[0]
        df = xls.parse(aba)
    faltam = [c for c in COLUNAS_OBRIGATORIAS if c not in df.columns]
    if faltam:
        sys.exit("ERRO: a planilha não tem as colunas esperadas: " + ", ".join(faltam))
    print(f"  {len(df):,} linhas | aba '{aba}'".replace(",", "."))
    return df


def normalizar_fornecedor(bruto):
    s = re.sub(r"^\s*\d+\s*-\s*", "", str(bruto)).replace("*", "").strip().upper()
    if "PRIMORE" in s:
        return "PRIMORE"                       # consolida todas as variações
    if "MSD" in s:
        return "MSD PET"
    if "TOTAL QUIMICA" in s or "TOTAL QUÍMICA" in s:
        return "TOTAL QUIMICA LTDA"
    if "ABSORTEC" in s:
        return "ABSORTEC"
    if "VALLEE" in s:
        return "VALLEE S/A"
    if "IDEXX" in s:
        return "IDEXX BRASIL"
    return s


def preparar(df):
    d = pd.DataFrame()
    d["cli_cod"] = df["Código Cliente"].astype("int64")
    d["cli_nome"] = df["Cliente"].astype(str).str.strip()
    d["doc"] = df["CPF-CNPJ Cliente"].astype(str).str.strip()
    d["tipo"] = df["Tipo Cliente"].astype(str).str.strip().str.upper().str[:1]
    d["cidade"] = df["Cidade Cliente"].astype(str).str.strip()
    d["bairro"] = df["Bairro Cliente"].astype(str).str.strip()
    d["pr_cod"] = df["Código Cliente Principal"].astype("int64")
    d["pr_nome"] = df["Cliente Principal"].astype(str).str.strip()
    d["sup_cod"] = df["Descrição Supervisor"].astype(str).str.extract(r"^\s*(\d+)")[0].astype("int64")
    d["rca_cod"] = df["Descrição RCA"].astype(str).str.extract(r"^\s*(\d+)")[0].astype("int64")
    d["rca_nome_base"] = df["Descrição RCA"].astype(str).str.replace(r"^\s*\d+\s*-\s*", "", regex=True).str.title()
    d["forn"] = df["Descrição Fornecedor"].map(normalizar_fornecedor)
    d["produto"] = df["Produto"].astype(str).str.strip()
    mes = df["Mês"].astype(str).str.strip().str.lower().map(MESES)
    if mes.isna().any():
        sys.exit("ERRO: há meses não reconhecidos na coluna 'Mês': " + ", ".join(sorted(set(df.loc[mes.isna(), "Mês"].astype(str)))))
    d["ym"] = df["Ano"].astype("int64") * 12 + mes.astype("int64") - 1
    cents = lambda col: (df[col].fillna(0).astype(float) * 100).round().astype("int64")
    d["venda"] = cents("Venda - Valor")
    d["dev"] = cents("Devolução - Valor")
    d["liq"] = cents("Faturamento - Valor Líquido")
    d["qtd"] = df["Faturamento - Quantidade de Itens Líquida"].fillna(0).round().astype("int64")

    novos = sorted(set(d.rca_cod) - set(RCAS))
    for cod in novos:
        nome = d.loc[d.rca_cod == cod, "rca_nome_base"].iloc[0]
        RCAS[cod] = (nome, int(d.loc[d.rca_cod == cod, "sup_cod"].iloc[0]))
        print(f"  AVISO: RCA {cod} ({nome}) está na base mas não no diretório - incluído automaticamente.")
    for cod in sorted(set(d.sup_cod) - set(SUPERVISORES)):
        SUPERVISORES[cod] = f"Supervisor {cod}"
        print(f"  AVISO: supervisor {cod} não está no diretório.")
    return d


# --------------------------------------------------------------------------
# Payload por usuário  ->  JSON colunar  ->  gzip  ->  AES-256-GCM
# --------------------------------------------------------------------------
def recorte_do_usuario(d, u):
    if u.tipo == "Gerente":
        return d
    if u.tipo == "Supervisor":
        return d[d.sup_cod == u.codigo]
    return d[d.rca_cod == u.codigo]


def montar_payload(d, u, meta, registro, usuarios):
    sub = recorte_do_usuario(d, u)
    sup_cods = sorted(sub.sup_cod.unique().tolist())
    sup_idx = {c: i for i, c in enumerate(sup_cods)}
    rca_cods = sorted(sub.rca_cod.unique().tolist(), key=lambda c: (RCAS[c][1], RCAS[c][0]))
    rca_idx = {c: i for i, c in enumerate(rca_cods)}
    forn_nomes = sorted(sub.forn.unique().tolist())
    forn_idx = {n: i for i, n in enumerate(forn_nomes)}

    prod_df = sub.drop_duplicates("produto")[["produto", "forn"]].sort_values("produto")
    prod_idx = {p: i for i, p in enumerate(prod_df.produto)}

    cli_df = sub.drop_duplicates("cli_cod").sort_values("cli_cod")
    cli_idx = {c: i for i, c in enumerate(cli_df.cli_cod)}
    pr_df = cli_df.drop_duplicates("pr_cod").sort_values("pr_cod")
    pr_idx = {c: i for i, c in enumerate(pr_df.pr_cod)}

    ordem = np.lexsort((sub["produto"].map(prod_idx).to_numpy(), sub.ym.to_numpy(),
                        sub.cli_cod.map(cli_idx).to_numpy()))
    s = sub.iloc[ordem]
    linhas = {
        "cli": s.cli_cod.map(cli_idx).astype(int).tolist(),
        "rca": s.rca_cod.map(rca_idx).astype(int).tolist(),
        "prod": s["produto"].map(prod_idx).astype(int).tolist(),
        "ym": s.ym.astype(int).tolist(),
        "venda": s.venda.tolist(), "dev": s.dev.tolist(), "liq": s.liq.tolist(), "qtd": s.qtd.tolist(),
    }
    payload = {
        "v": 1,
        "meta": {**meta, "linhas": int(len(s)), "ymMin": int(s.ym.min()), "ymMax": int(s.ym.max())},
        "user": {"id": u.uid, "tipo": u.tipo, "nome": u.nome, "email": u.email, "login": u.login,
                 "telefone": u.telefone, "pendente": u.pendente, "supCodigo": u.sup_codigo,
                 "supNome": u.supervisor_nome, "rcaCodigo": u.codigo if u.tipo == "RCA" else 0},
        "sup": [{"c": c, "n": SUPERVISORES[c]} for c in sup_cods],
        "rca": [{"c": c, "n": RCAS[c][0], "s": sup_idx[RCAS[c][1]] if RCAS[c][1] in sup_idx else 0} for c in rca_cods],
        "forn": forn_nomes,
        "prod": [{"n": r.produto, "f": forn_idx[r.forn]} for r in prod_df.itertuples()],
        "pr": [{"c": int(r.pr_cod), "n": r.pr_nome} for r in pr_df.itertuples()],
        "cli": [{"c": int(r.cli_cod), "n": r.cli_nome, "d": r.doc, "t": r.tipo, "y": r.cidade, "b": r.bairro,
                 "p": pr_idx[r.pr_cod]} for r in cli_df.itertuples()],
        "rows": linhas,
    }
    if u.tipo == "Gerente":
        payload["admin"] = {"usuarios": [{
            "nome": x.nome, "tipo": x.tipo, "email": x.login, "pendente": x.pendente,
            "status": status_de(x, registro), "criado": registro["usuarios"][x.uid]["criado"],
            "renovado": registro["usuarios"][x.uid]["renovado"],
            "tokenId": token_id(registro["usuarios"][x.uid]["token"])} for x in usuarios]}
    return payload


def status_de(u, registro):
    if registro["usuarios"][u.uid]["status"] != "ativo":
        return "Inativo"
    return "Pendente" if u.pendente else "Ativo"


def token_id(token):
    h = sha256_hex(token)
    return f"tk_{h[:6]}…{h[-6:]}"


def cifrar(payload, token, u):
    bruto = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    segredo = f"{token}|{u.login.lower()}|{u.senha}".encode("utf-8")
    chave = PBKDF2HMAC(hashes.SHA256(), 32, salt, PBKDF2_ITER).derive(segredo)
    ct = AESGCM(chave).encrypt(iv, bruto, None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {"v": 1, "it": PBKDF2_ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}, len(bruto)


def escrever_dados(d, usuarios, registro, meta, silencioso=False):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for antigo in DATA_DIR.glob("*.js"):
        antigo.unlink()                                  # tokens renovados/revogados somem do site
    total = 0
    for u in usuarios:
        reg = registro["usuarios"][u.uid]
        if reg["status"] != "ativo":
            continue
        payload = montar_payload(d, u, meta, registro, usuarios)
        blob, bruto = cifrar(payload, reg["token"], u)
        arq = DATA_DIR / f"{fid_do_token(reg['token'])}.js"
        arq.write_text("window.__nv_blob=" + json.dumps(blob, separators=(",", ":")) + ";", encoding="utf-8")
        total += arq.stat().st_size
        if not silencioso:                                # em CI o log pode ser público: sem nomes de pessoas
            print(f"  {u.tipo:<10} {u.nome:<32} {payload['meta']['linhas']:>6} linhas  {arq.stat().st_size / 1024:>7.0f} KB")
    print(f"  Total em site/data: {total / 1024 / 1024:.1f} MB")


# --------------------------------------------------------------------------
# Assets (logo recortada, favicon, logo embutida para o PDF)
# --------------------------------------------------------------------------
def preparar_assets():
    from PIL import Image
    if not LOGO_ORIGINAL.exists():
        print("  AVISO: logo original não encontrada em assets/ - pulando.")
        return
    (SITE / "img").mkdir(parents=True, exist_ok=True)
    src = Image.open(LOGO_ORIGINAL).convert("RGB")
    logo = src.crop((100, 210, 1566, 676))                                    # selo completo (moldura + marca)
    logo = logo.resize((720, round(720 * logo.height / logo.width)), Image.LANCZOS)
    logo.save(SITE / "img" / "logo.png", optimize=True)
    pata = src.crop((190, 255, 525, 620))                                     # só a patinha
    lado = max(pata.size)
    quadro = Image.new("RGB", (lado, lado), "white")
    quadro.paste(pata, ((lado - pata.width) // 2, (lado - pata.height) // 2))
    quadro.resize((128, 128), Image.LANCZOS).save(SITE / "img" / "favicon.png", optimize=True)
    pdf = logo.resize((560, round(560 * logo.height / logo.width)), Image.LANCZOS)
    buf = io.BytesIO()
    pdf.save(buf, "PNG", optimize=True)
    js = "window.NV_LOGO=" + json.dumps("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()) + \
         f";window.NV_LOGO_RATIO={logo.width / logo.height:.4f};"
    (SITE / "js").mkdir(parents=True, exist_ok=True)
    (SITE / "js" / "logo-data.js").write_text(js, encoding="utf-8")
    logo.save(BASE / "assets" / "logo_recortada.png", optimize=True)


# --------------------------------------------------------------------------
# Excel com os 21 links
# --------------------------------------------------------------------------
def gerar_excel_links(usuarios, registro, base_url):
    import qrcode
    import xlsxwriter
    from PIL import Image

    hoje = agora()
    destino = BASE / f"Links_Acesso_Dashboard_Novavet_{hoje:%d%m%Y}.xlsx"
    ordem_tipo = {"RCA": 0, "Supervisor": 1, "Gerente": 2}
    ordem = sorted(usuarios, key=lambda u: (ordem_tipo[u.tipo],
                                             list(SUPERVISORES).index(u.sup_codigo) if u.tipo == "RCA" and u.sup_codigo in SUPERVISORES else 0,
                                             usuarios.index(u)))
    wb = xlsxwriter.Workbook(str(destino), {"default_date_format": "dd/mm/yyyy hh:mm"})
    ws = wb.add_worksheet("Links de Acesso")
    COR_PRIM, COR_SEC, COR_INK = "#C94B5E", "#4BA3D4", "#2C2C2C"

    def fmt(bg, bold=False, link=False, center=False, date=False, wrap=False):
        p = {"bg_color": bg, "border": 1, "border_color": "#E0E0E0", "valign": "vcenter",
             "font_name": "Calibri", "font_size": 11, "bold": bold, "text_wrap": wrap}
        if link:
            p.update({"font_color": COR_SEC, "underline": 1})
        else:
            p["font_color"] = COR_INK
        if center:
            p["align"] = "center"
        if date:
            p["num_format"] = "dd/mm/yyyy hh:mm"
        return wb.add_format(p)

    f_titulo = wb.add_format({"bold": True, "font_size": 14, "font_color": COR_PRIM, "valign": "vcenter", "font_name": "Calibri"})
    f_head = wb.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": COR_PRIM, "align": "center",
                            "valign": "vcenter", "border": 1, "border_color": "#FFFFFF", "font_size": 11})
    cols = [("Tipo_Acesso", 12), ("Nome", 25), ("Email", 30), ("Telefone", 18), ("Supervisor", 20),
            ("Senha_Padrão", 15), ("Link_Dashboard", 50), ("QR_Code", 22), ("Token_ID", 22),
            ("Status", 12), ("Data_Criacao", 18), ("Data_Renovacao", 18), ("Observacoes", 40)]
    for i, (_, w) in enumerate(cols):
        ws.set_column(i, i, w)
    ws.set_row(0, 62)
    ws.set_row(1, 8)
    ws.set_row(2, 26)
    if (SITE / "img" / "logo.png").exists():
        ws.insert_image(0, 0, str(SITE / "img" / "logo.png"), {"x_scale": 0.27, "y_scale": 0.27, "x_offset": 6, "y_offset": 4, "object_position": 1})
    ws.merge_range(0, 5, 0, 12, f"ACESSO DASHBOARD CONSULTA HISTÓRICOS DE CLIENTES  -  GERADO EM {hoje:%d/%m/%Y}", f_titulo)
    for i, (nome, _) in enumerate(cols):
        ws.write(2, i, nome, f_head)

    r = 3
    contagem_rca = 0
    for u in ordem:
        reg = registro["usuarios"][u.uid]
        token = reg["token"]
        link = montar_link(base_url, u, token)
        if u.tipo == "RCA":
            bg = "#F5F5F5" if contagem_rca % 2 == 0 else "#FFFFFF"
            contagem_rca += 1
            bold = False
        elif u.tipo == "Supervisor":
            bg, bold = "#E8F4F8", True
        else:
            bg, bold = "#FFE8E8", True
        status = status_de(u, registro)
        obs = []
        if u.pendente:
            obs.append("E-MAIL PENDENTE: login provisório - preencher usuarios.csv e gerar de novo")
        if u.senha_provisoria:
            obs.append(f"Senha provisória {SENHA_PROVISORIA} (telefone pendente)")
        if u.obs:
            obs.append(u.obs)
        if u.tipo == "Gerente":
            obs.insert(0, "ADMIN")
        c = fmt(bg, bold)
        ws.set_row(r, 120)
        ws.write_string(r, 0, u.tipo, fmt(bg, True, center=True))
        ws.write_string(r, 1, u.nome, c)
        ws.write_string(r, 2, u.login, c)
        ws.write_string(r, 3, u.telefone or "(pendente)", c)
        ws.write_string(r, 4, u.supervisor_nome, c)
        ws.write_string(r, 5, u.senha, fmt(bg, bold, center=True))                # texto: preserva zero à esquerda
        ws.write_url(r, 6, link, fmt(bg, bold, link=True), string=link)
        ws.write_blank(r, 7, None, fmt(bg))
        ws.write_string(r, 8, token_id(token), c)
        ws.write_string(r, 9, status, fmt(bg, True, center=True))
        ws.write_datetime(r, 10, datetime.fromisoformat(reg["criado"]).replace(tzinfo=None), fmt(bg, date=True))
        if reg["renovado"]:
            ws.write_datetime(r, 11, datetime.fromisoformat(reg["renovado"]).replace(tzinfo=None), fmt(bg, date=True))
        else:
            ws.write_blank(r, 11, None, fmt(bg))
        ws.write_string(r, 12, " | ".join(obs), fmt(bg, wrap=True))

        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
        qr.add_data(link)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((300, 300), Image.NEAREST)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        ws.insert_image(r, 7, f"qr_{u.uid}.png", {"image_data": buf, "x_scale": 0.5, "y_scale": 0.5,
                                                   "x_offset": 5, "y_offset": 5, "object_position": 1,
                                                   "description": f"QR Code do link de {u.nome}"})
        r += 1

    ws.data_validation(3, 9, r - 1, 9, {"validate": "list", "source": ["Ativo", "Inativo", "Pendente"]})
    ws.autofilter(2, 0, r - 1, len(cols) - 1)
    ws.freeze_panes(3, 1)
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.set_paper(9)

    wi = wb.add_worksheet("Instruções")
    wi.set_column(0, 0, 110)
    f_h = wb.add_format({"bold": True, "font_size": 13, "font_color": COR_PRIM})
    f_t = wb.add_format({"text_wrap": True, "valign": "top"})
    linhas = [
        ("ATENÇÃO: NÃO DISTRIBUIR nenhum link, QR Code ou senha antes da liberação expressa do gerente.", wb.add_format({"bold": True, "font_color": "#B4232F", "font_size": 12})),
        ("Como usar esta planilha", f_h),
        ("1) Envie a CADA pessoa apenas o link dela (ou o QR Code) e a senha dela. NÃO encaminhe esta planilha inteira: ela contém todos os tokens.", f_t),
        ("2) O acesso exige o link pessoal + e-mail + senha (4 últimos dígitos do telefone; 1234 quando o telefone ainda não foi cadastrado).", f_t),
        ("3) Os links são PERMANENTES. Para renovar o de alguém: python gerar_dashboard.py --renovar \"nome ou e-mail\" (o link antigo deixa de abrir).", f_t),
        ("4) Para desativar alguém: python gerar_dashboard.py --revogar \"nome ou e-mail\".", f_t),
        ("5) Linhas com status 'Pendente' precisam de e-mail/telefone no arquivo usuarios.csv; depois rode o gerador de novo (o token não muda).", f_t),
        ("6) Os dados do dashboard são atualizados automaticamente de terça a sábado às 07:30 (horário de Brasília).", f_t),
        ("7) Guarde este arquivo em local restrito (a base de tokens = chave de acesso a dados de clientes).", f_t),
    ]
    for i, (t, f) in enumerate(linhas):
        wi.write(i, 0, t, f)
        wi.set_row(i, 22 if f is f_h else 34)
    wb.close()
    return destino


def gerar_lista_apps_script(usuarios, registro):
    APPS_SCRIPT_DIR.mkdir(exist_ok=True)
    autorizados = {}
    for u in usuarios:
        reg = registro["usuarios"][u.uid]
        if reg["status"] == "ativo":
            autorizados[hash_envio_email(reg["token"])] = {"n": u.nome, "e": u.email, "p": u.tipo}
    # compacto (uma linha): é colado na propriedade USUARIOS do Apps Script, que aceita até 9 KB por valor (~60 pessoas)
    (APPS_SCRIPT_DIR / "usuarios_autorizados.json").write_text(json.dumps(autorizados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(autorizados)


ENDPOINT_RE = re.compile(r"^https://script\.google\.com/(?:a/macros/[^/\s]+|macros)/s/[\w-]+/exec$")


def gravar_endpoint(url):
    """Grava a URL do Apps Script em site/config.js ('' desliga o envio automático)."""
    url = url.strip()
    if url and not ENDPOINT_RE.match(url):
        sys.exit('ERRO: o endereço deve ser o da "Implantação > App da Web", terminado em /exec '
                 "(https://script.google.com/macros/s/.../exec).")
    cfg_js = SITE / "config.js"
    atual = cfg_js.read_text(encoding="utf-8") if cfg_js.exists() else ""
    if not re.search(r'emailEndpoint:\s*"[^"]*"', atual):
        sys.exit("ERRO: site/config.js não tem o campo emailEndpoint.")
    cfg_js.write_text(re.sub(r'emailEndpoint:\s*"[^"]*"', lambda m: f'emailEndpoint: "{url}"', atual), encoding="utf-8")


# --------------------------------------------------------------------------
def main():
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    if CONFIG_LOCAL.exists():                             # ajustes só desta máquina (fora do Git): excel_padrao, base_url...
        cfg.update(json.loads(CONFIG_LOCAL.read_text(encoding="utf-8")))
    ap = argparse.ArgumentParser(description="Gerador do Dashboard Consulta Históricos de Clientes")
    ap.add_argument("--excel", help="caminho da planilha analítica (padrão: config.json)")
    ap.add_argument("--gmail", action="store_true", help="baixa a planilha do e-mail (usa token.json)")
    ap.add_argument("--token-path", default="token.json", help="token OAuth do Gmail (com --gmail)")
    ap.add_argument("--sem-verificar-remetente", action="store_true",
                    help="(emergência) aceita o e-mail mesmo sem SPF/DMARC do remetente - use só com certeza da origem")
    ap.add_argument("--base-url", default=cfg.get("base_url", BASE_URL_PADRAO), help="URL onde o site será publicado")
    ap.add_argument("--sem-excel", action="store_true", help="não gera o Excel de links (uso em automação)")
    ap.add_argument("--ci", action="store_true",
                    help="modo automação: exige tokens.json já existente e nunca cria/renova tokens")
    ap.add_argument("--renovar", metavar="USUARIO", help="gera um novo token para o usuário (nome, e-mail ou id)")
    ap.add_argument("--revogar", metavar="USUARIO", help="desativa o acesso do usuário")
    ap.add_argument("--email-endpoint", help="URL do Apps Script (termina em /exec); grava em site/config.js. "
                    "Sozinho (sem --excel/--gmail) não lê a planilha. Use \"\" para desligar o envio.")
    ap.add_argument("--so-apps-script", action="store_true",
                    help="só atualiza apps_script/usuarios_autorizados.json (e o endpoint, se informado), sem ler a planilha")
    args = ap.parse_args()

    if args.ci and (args.renovar or args.revogar):
        sys.exit("ERRO (--ci): renovar/revogar deve ser feito localmente, depois atualize o secret TOKENS_JSON.")
    if args.ci and not TOKENS_PATH.exists():
        sys.exit("ERRO (--ci): tokens.json ausente. Configure o secret TOKENS_JSON do repositório "
                 "(sem ele os links de todos os usuários deixariam de funcionar).")
    usuarios = carregar_usuarios()
    montar_diretorio(usuarios)
    registro = carregar_tokens()
    novos = garantir_tokens(registro, usuarios)
    if args.ci and novos:
        sys.exit(f"ERRO (--ci): {novos} usuário(s) sem token no tokens.json do secret. Rode o gerador localmente "
                 "e atualize o secret TOKENS_JSON antes de publicar.")
    if args.renovar:
        u = achar_usuario(usuarios, args.renovar)
        renovar_token(registro, u)
        print(f"Token de {u.nome} renovado (o link antigo deixa de funcionar).")
    if args.revogar:
        u = achar_usuario(usuarios, args.revogar)
        registro["usuarios"][u.uid]["status"] = "revogado"
        print(f"Acesso de {u.nome} revogado.")
    salvar_tokens(registro)
    if novos:
        print(f"{novos} token(s) novo(s) gerado(s) -> tokens.json (NÃO publique este arquivo).")

    so_apps = args.so_apps_script or (args.email_endpoint is not None and not args.gmail and not args.excel
                                      and not args.renovar and not args.revogar)
    if so_apps:                                           # atalho: não precisa da planilha de vendas
        if args.email_endpoint is not None:
            gravar_endpoint(args.email_endpoint)
            print("site/config.js atualizado (emailEndpoint " + ("definido" if args.email_endpoint.strip() else "vazio: envio automático desligado") + ").")
        n = gerar_lista_apps_script(usuarios, registro)
        print(f"apps_script/usuarios_autorizados.json atualizado: {n} usuário(s) autorizado(s). "
              "Cole o conteúdo na propriedade USUARIOS do Apps Script.")
        if args.renovar or args.revogar:
            print("AVISO: rode o gerador completo (sem --so-apps-script) para regerar também os dados do site.")
        return

    meta_fonte = None
    if args.gmail:
        if args.sem_verificar_remetente:
            print("::warning::Verificação de remetente DESLIGADA (--sem-verificar-remetente).")
        caminho, meta_fonte = baixar_do_gmail(cfg, args.token_path, verificar_remetente=not args.sem_verificar_remetente)
    else:
        bruto = args.excel or cfg.get("excel_padrao", "")
        if not bruto:
            sys.exit("ERRO: informe a planilha com --excel \"caminho.xlsx\", use --gmail, "
                     "ou defina \"excel_padrao\" em config.local.json.")
        caminho = Path(bruto)
        if not caminho.is_file():
            sys.exit(f"ERRO: planilha não encontrada: {caminho}\nUse --excel ou --gmail.")
        meta_fonte = f"arquivo {caminho.name}"

    try:
        d = preparar(ler_planilha(caminho))
    finally:
        if args.gmail:
            caminho.unlink(missing_ok=True)               # apaga o anexo temporário baixado do Gmail
    meta = {"geradoEm": agora().isoformat(timespec="seconds"), "fonte": meta_fonte}
    print("Gerando dados criptografados por usuário ...")
    preparar_assets()
    escrever_dados(d, usuarios, registro, meta, silencioso=args.ci)
    n = gerar_lista_apps_script(usuarios, registro)
    print(f"apps_script/usuarios_autorizados.json: {n} usuário(s) autorizado(s) a enviar e-mail.")

    if args.email_endpoint is not None:
        gravar_endpoint(args.email_endpoint)

    if not args.sem_excel:
        destino = gerar_excel_links(usuarios, registro, args.base_url)
        print(f"Excel de links: {destino.name}")
    pend = [u.nome for u in usuarios if u.pendente]
    if pend:
        print(f"ATENÇÃO: {len(pend)} usuário(s) com e-mail pendente no usuarios.csv" + ("" if args.ci else ": " + ", ".join(pend)))
    print("Concluído.")


if __name__ == "__main__":
    main()

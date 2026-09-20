# -*- coding: utf-8 -*-
"""
Gera o token.json EXCLUSIVO deste projeto, com acesso SOMENTE LEITURA ao Gmail (gmail.readonly).

Por que um token próprio: o gerador só precisa ler o e-mail do relatório. Ter um token separado (e só de leitura)
permite revogá-lo sem afetar outros projetos e limita o estrago caso ele vaze. Não reutilize o token de outro projeto.

Uso (abre o navegador; entre com a conta que RECEBE o relatório e clique em "Permitir"):
    python setup_oauth.py --credentials "C:\\caminho\\credentials.json"

O credentials.json é o "ID do cliente OAuth" (tipo Aplicativo para computador) do seu projeto no Google Cloud.
Sem dependências extras: usa só a biblioteca padrão do Python (fluxo com PKCE e retorno em http://127.0.0.1).
O resultado (token.json) fica fora do Git e é o conteúdo do secret TOKEN_JSON do GitHub.
"""
import argparse
import base64
import hashlib
import json
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ESCOPO = "https://www.googleapis.com/auth/gmail.readonly"
PAGINA_OK = ("<html><meta charset='utf-8'><body style='font-family:sans-serif;text-align:center;margin-top:15vh'>"
             "<h2>Autorização concluída</h2><p>Pode fechar esta aba e voltar ao terminal.</p></body></html>").encode()


def main():
    ap = argparse.ArgumentParser(description="Gera o token.json (somente leitura do Gmail) deste projeto")
    ap.add_argument("--credentials", required=True, help="credentials.json do cliente OAuth (Aplicativo para computador)")
    ap.add_argument("--saida", default="token.json", help="arquivo de saída (padrão: token.json)")
    ap.add_argument("--sem-navegador", action="store_true", help="só imprime o link (abra você mesmo no navegador)")
    args = ap.parse_args()

    dados = json.loads(Path(args.credentials).read_text(encoding="utf-8"))
    cli = dados.get("installed")
    if not cli:
        sys.exit('ERRO: o credentials.json precisa ser do tipo "installed" (Aplicativo para computador).')

    verificador = secrets.token_urlsafe(64)[:96]
    desafio = base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).decode().rstrip("=")
    estado = secrets.token_urlsafe(16)
    resultado = {}

    class Recebe(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q or "error" in q:
                resultado["q"] = q
                self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
                self.wfile.write(PAGINA_OK)
            else:
                self.send_response(404); self.end_headers()

        def log_message(self, *a):
            pass

    servidor = HTTPServer(("127.0.0.1", 0), Recebe)
    redirect = f"http://127.0.0.1:{servidor.server_port}/"
    url = cli["auth_uri"] + "?" + urllib.parse.urlencode({
        "client_id": cli["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": ESCOPO,
        "access_type": "offline", "prompt": "consent", "state": estado,
        "code_challenge": desafio, "code_challenge_method": "S256"})
    print("Abra este link, entre com a conta que recebe o relatório e clique em Permitir:\n\n" + url + "\n")
    if not args.sem_navegador:
        webbrowser.open(url)
    servidor.timeout = 300
    while "q" not in resultado:
        servidor.handle_request()
        if servidor.timeout and "q" not in resultado:
            sys.exit("ERRO: tempo esgotado (5 min) sem autorização.")
    q = resultado["q"]
    if "error" in q:
        sys.exit("ERRO: a autorização foi negada: " + q["error"][0])
    if q.get("state", [""])[0] != estado:
        sys.exit("ERRO: resposta com 'state' inválido (possível tentativa de interceptação). Rode de novo.")

    corpo = urllib.parse.urlencode({
        "code": q["code"][0], "client_id": cli["client_id"], "client_secret": cli["client_secret"],
        "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verificador}).encode()
    with urllib.request.urlopen(urllib.request.Request(cli["token_uri"], data=corpo, method="POST"), timeout=60) as r:
        tok = json.loads(r.read())
    if not tok.get("refresh_token"):
        sys.exit("ERRO: o Google não devolveu refresh_token. Revogue o acesso deste app em "
                 "myaccount.google.com/permissions e rode de novo.")
    if ESCOPO not in tok.get("scope", ""):
        sys.exit("ERRO: o escopo concedido não inclui a leitura do Gmail: " + tok.get("scope", ""))
    saida = Path(args.saida)
    saida.write_text(json.dumps({
        "client_id": cli["client_id"], "client_secret": cli["client_secret"], "refresh_token": tok["refresh_token"],
        "token_uri": cli["token_uri"], "scopes": [ESCOPO]}, indent=2), encoding="utf-8")
    print(f"OK: {saida} criado (escopo apenas de leitura). NÃO versione este arquivo.")


if __name__ == "__main__":
    main()

# Dashboard Consulta Históricos de Clientes — Novavet Distribuidora

Painel web (mobile-first) para RCAs, supervisores e gerente consultarem o **histórico de compras dos clientes**,
comparar períodos (YTD), ver rankings e **enviar o histórico em PDF por e-mail**. Cada pessoa acessa por um
**link pessoal e permanente** + e-mail + senha de 4 dígitos, e só enxerga os dados da própria carteira/equipe.

## Como funciona (resumo)

```
E-mail do relatório analítico ──► gerar_dashboard.py ──► site/data/<id>.js  (1 arquivo CIFRADO por usuário)
 (remetente/assunto em config.local.json;       │                  site/  (HTML/CSS/JS estático)
  só aceito se o Google validar o remetente)    └──► Links_Acesso_Dashboard_Novavet_DDMMAAAA.xlsx  (21 links + QR Codes)
```

* **Sem servidor.** O site é estático (GitHub Pages, Netlify, sua hospedagem…). A autenticação é criptográfica:
  o arquivo de dados de cada usuário é cifrado com **AES-256-GCM**, com chave = PBKDF2(**token do link** + **e-mail** +
  **senha**). Um RCA nunca recebe as linhas de outro RCA — elas simplesmente não estão no arquivo dele.
* **Envio de PDF por e-mail e log de acessos** usam um Google Apps Script (`apps_script/Code.gs`) — a única parte
  que precisa de "servidor", e roda na sua conta Google.

## Uso local (testar agora)

```bash
pip install -r requirements.txt
python gerar_dashboard.py                      # lê o "excel_padrao" do config.local.json e gera site/ + Excel de links
python -m http.server 8765 --directory site    # abra o link da planilha trocando o domínio por http://localhost:8765/
```

Opções: `--excel CAMINHO` · `--gmail --token-path token.json` (baixa o anexo do e-mail) · `--base-url https://...`
(URL final do site, usada nos links/QR Codes do Excel) · `--sem-excel`.

## Cadastro de usuários (`usuarios.csv`)

Preenchido com os 21 contatos (gerente, 3 supervisores e 17 RCAs) a partir da planilha de contatos da equipe.
**Este arquivo também é a fonte da hierarquia** (quem é supervisor de quem, e os nomes exibidos no painel): o código
não tem nenhum nome de pessoa embutido, porque o repositório é público. Regras:

* `senha` = 4 últimos dígitos do `telefone` (ou a coluna `senha`, se preenchida). Sem telefone → **1234** (provisória).
* Usuário sem e-mail fica **"Pendente"** no Excel e usa um login provisório (`<código>@pendente.novavet`).
* Ao mudar e-mail/telefone/senha de alguém, rode `python gerar_dashboard.py` de novo — **os tokens (links) não mudam**,
  só o `user=` do link e a senha (e, no CI, atualize o secret `USUARIOS_CSV`).
* Este arquivo tem dados pessoais: está no `.gitignore` e nunca deve ser versionado.

## Publicação e atualização automática (terça a sábado, 07:30)

> Roteiro completo, com todos os comandos e o teste final: **[PASSO_A_PASSO_GITHUB.md](PASSO_A_PASSO_GITHUB.md)**.

**Decisão: repositório público** (GitHub Pages gratuito). Como o código é visível, nada sensível fica nele:

| Onde | O quê |
|---|---|
| Repositório (público) | código, site, `config.json` (só `base_url`), workflow |
| *Secrets* do GitHub | `TOKEN_JSON` (OAuth do Gmail **exclusivo deste projeto e só de leitura**, gerado por `setup_oauth.py`; não reutilize o token de outros projetos), `TOKENS_JSON` (tokens dos usuários), `USUARIOS_CSV` (nomes, hierarquia, contatos, senhas), `CONFIG_LOCAL_JSON` (remetente e assunto do relatório) |
| Só no seu computador | os mesmos 4 arquivos + `Links_Acesso_*.xlsx` (tudo no `.gitignore`) |

`config.local.json` (fora do Git; vira o secret `CONFIG_LOCAL_JSON`) tem este formato:
```json
{ "gmail": { "remetente": "...", "assunto": "...", "dias": 4 }, "excel_padrao": "C:\\caminho\\planilha.xlsx", "base_url": "https://..." }
```

**Agendamento (terça a sábado, 07:30 de Brasília):** o workflow `.github/workflows/atualizar_dashboard.yml` é disparado
pelo **cron-job.org** (`repository_dispatch`), e não por `schedule`, porque em repositório público o GitHub desativa
agendamentos nativos após 60 dias sem atividade. A cada disparo ele baixa o e-mail mais recente, regera os dados
cifrados e publica no GitHub Pages. Também pode ser iniciado à mão (*Actions → Run workflow*).

Proteções embutidas:
* **Remetente verificado**: como o e-mail alimenta o painel, o gerador só aceita mensagem cujo `From` seja o remetente
  configurado **e** que o Google tenha autenticado (SPF/DMARC do domínio). E-mail forjado é ignorado.
* O modo `--ci` **nunca cria tokens**: se o secret `TOKENS_JSON` faltar ou houver usuário novo sem token, o job falha
  em vez de quebrar os links de todos.
* Os logs do Actions (públicos) não trazem nomes de pessoas, remetente nem assunto.
* Se o e-mail do dia não chegar, o job falha (você recebe o aviso do GitHub) e o site continua com os dados anteriores —
  o rodapé do dashboard sempre mostra a data/hora da última atualização e a origem.

## Envio de PDF por e-mail (Apps Script)

Roteiro completo, com testes: **[PASSO_A_PASSO_APPS_SCRIPT.md](PASSO_A_PASSO_APPS_SCRIPT.md)**. Resumo: planilha Google → Apps Script → colar `Code.gs` +
`appsscript.json` → propriedade `USUARIOS` = `apps_script/usuarios_autorizados.json` → implantar como App da Web →
`python gerar_dashboard.py --email-endpoint "URL/exec"` (não lê a planilha de vendas; `--so-apps-script` só atualiza o
JSON de usuários autorizados). O envio sai da **conta que implantou** o script; o cliente
responde ao RCA (reply-to) e o RCA recebe cópia (cc). Limite: 40 envios/dia/usuário; só PDFs de até 8 MB; cada
requisição exige o token pessoal. Enquanto não configurado, o botão **baixa o PDF** e abre o e-mail para anexar.
O mesmo script grava o **log de acessos e envios** (aba `Log`), exibido no painel *Administração* do gerente.

## Renovar / revogar acessos

```bash
python gerar_dashboard.py --renovar "Nome Completo"    # novo token; o link antigo deixa de abrir
python gerar_dashboard.py --revogar "Nome Completo"    # remove o acesso
```
(use o nome completo, o e-mail ou o id `rca:1331`; se o termo casar com mais de uma pessoa o gerador lista os candidatos.)
Depois: atualizar o secret `TOKENS_JSON`, a propriedade `USUARIOS` do Apps Script e enviar o novo link à pessoa.
Se alguém sair da empresa, revogue e remova a linha do `usuarios.csv`.

## Regras de negócio adotadas

| Tema | Regra |
|---|---|
| **Venda × Valor líquido** | *Venda* = valor imputado no sistema; *Valor líquido* = faturado, já sem devoluções (coluna "Faturamento - Valor Líquido"). Os dois divergem quando o pedido é imputado e faturado em meses diferentes — por isso ambos aparecem, sem forçar `Líquido = Venda − Devolução`. |
| **Escopo dos dados** | RCA: linhas em que ele é o RCA. Supervisor: linhas da sua equipe (inclui a "carteira própria": linhas em que o próprio supervisor aparece como RCA). Gerente: tudo. Assim os totais fecham entre RCA → supervisor → gerente. |
| **Período** | A base é **mensal** (não tem dia). O "Date Range" do prompt virou período **mês/ano → mês/ano**. Padrão ao abrir: **1º de janeiro do ano atual → último mês com dados** (o padrão "mês atual/30 dias" do prompt deixaria o histórico com um único mês parcial); o botão "Mês atual" e os atalhos ficam a um toque. |
| **Comparativo YTD** | Mesmo período (e meses) deslocado 12 meses; variação em cards, gráfico (2 séries), tooltip e tabela. |
| **Clientes positivados** | Clientes com valor líquido > 0 no filtro. |
| **PRIMORE** | Qualquer fornecedor com "PRIMORE" no nome é consolidado em **PRIMORE** (já aparece na base do e-mail de hoje, 15 linhas). |
| **PDF para o cliente** | Só é permitido com **um único cliente (ou cliente principal)** filtrado — o PDF não pode vazar dados de outros clientes. Limite de 3.000 linhas por PDF. |
| **Tokens** | 256 bits (UUID + 128 bits aleatórios), permanentes até renovação manual. O nome do arquivo de dados é um hash do token (não revela o token). |

## Limites de segurança (leia)

* A **senha de 4 dígitos é fraca**: quem obtiver o link e o arquivo de dados pode tentar as 10 mil combinações offline.
  A proteção real é o **link secreto** (256 bits). Trate o link como senha, não o poste em grupos, e **não encaminhe a
  planilha de links inteira** (`Links_Acesso_*.xlsx` contém todos os tokens e senhas — guarde-a restrita).
* Dados só são entregues por HTTPS (o navegador exige contexto seguro para descriptografar).
* Ao renovar um token, o arquivo antigo some do site no próximo deploy.

## O que o prompt original pedia e **não** foi feito (e por quê)

Banco de dados/API com hash SHA-256 de senhas, SendGrid/SMTP, detecção de logins simultâneos, testes de carga e
"deploy em produção" pressupõem um servidor. Foram substituídos por: criptografia por usuário (acima), Gmail via Apps
Script, log de acessos no Google Sheets e publicação estática. Detecção de logins simultâneos e o domínio
`dashboard-novavet.com` **não** foram configurados (o domínio é o padrão do prompt; troque com `--base-url`).

## Estrutura

```
gerar_dashboard.py      gerador (dados cifrados, tokens, Excel, QR Codes, Gmail)
setup_oauth.py          gera o token.json exclusivo (Gmail somente leitura) — não reutilize o de outros projetos
usuarios.csv            cadastro/hierarquia dos 21 usuários (SEGREDO)   tokens.json   tokens permanentes (SEGREDO)
config.json             URL base (público)                          config.local.json  gmail, Excel padrão (SEGREDO)
assets/                 logo original
site/                   o que vai para a web (index.html, js/, css/, vendor/, data/, config.js)
apps_script/            Code.gs, appsscript.json, usuarios_autorizados.json (gerado)
.github/workflows/      atualização automática ter–sáb 07:30
```

# Passo a passo — publicar no GitHub (repositório público) e agendar a atualização (ter–sáb, 07:30)

> **Atenção:** nada neste roteiro envia link, senha ou QR Code para a equipe. Os links só devem ser distribuídos
> depois do teste final (item 9) e **com a sua liberação expressa**.

Tempo estimado: 40 min. Use o **Git Bash** (ou o terminal bash do app): os comandos com `<` não funcionam no
PowerShell e, no PowerShell 5, acentos dos arquivos podem corromper.

## O que vai (e o que não vai) para o GitHub

| Vai para o repositório **público** (28 arquivos) | Fica só no seu computador (`.gitignore`) → vira *secret* |
|---|---|
| Código do site, `gerar_dashboard.py` (sem nenhum nome de pessoa), `Code.gs`, workflow, README e estes roteiros, logo | `tokens.json` → secret `TOKENS_JSON` |
| `config.json` (só a `base_url`) | `usuarios.csv` (nomes, hierarquia, contatos, senhas) → secret `USUARIOS_CSV` |
| `site/config.js` (contém o telefone de suporte, que **já aparece na tela de login**) | `config.local.json` (remetente/assunto do relatório) → secret `CONFIG_LOCAL_JSON` |
| | `Links_Acesso_*.xlsx`, `site/data/*` (dados cifrados, gerados no deploy) |

Simulado numa cópia: um checkout limpo com só os 4 segredos gera os 21 arquivos de dados, idênticos aos locais, sem
alterar os tokens.

---

## 1. Repositório público: o que isso significa (decisão já tomada)

- **GitHub Pages gratuito** (no plano Free o Pages só existe em repositório público).
- **Ninguém vê dados nem segredos**: o site é público de qualquer forma, e os dados dentro dele são cifrados com o
  token do link + e-mail + senha. Nomes, hierarquia e contatos vêm do secret `USUARIOS_CSV`, não do código.
- **Sem agendamento nativo**: em repositório público o GitHub **desativa o `schedule` após 60 dias sem atividade**.
  Por isso o horário de ter–sáb 07:30 é disparado pelo **cron-job.org** (item 7), como nos seus outros projetos.
- **Log do Actions é público**: o gerador não imprime nomes, remetente nem assunto do relatório.
- **E-mail forjado é ignorado**: como o e-mail alimenta o painel, o gerador só aceita mensagem do remetente
  configurado **validada pelo Google (SPF/DMARC)**.
- **Só uma coisa pública a decidir**: o telefone de suporte em `site/config.js` (`supportPhone`) é o celular do
  Rodrigues, vindo do prompt original. Se preferir um número corporativo, troque antes do item 3.

## 2. Entrar no GitHub pelo terminal

```bash
gh auth login --web --scopes workflow
```
Escolha GitHub.com → HTTPS → autorize no navegador. O escopo `workflow` é necessário para enviar arquivos de
`.github/workflows/`. Confirme a conta (esperado: `rodrigues-svg`):

```bash
gh api user --jq .login
```

## 3. Criar o repositório e enviar o código

Abra o Git Bash **dentro da pasta do projeto** (no Explorador de Arquivos: botão direito na pasta → *Open Git Bash here*).
Ou navegue até ela — no Git Bash, `C:\Users\...` vira `/c/Users/...`:
```bash
cd "/c/CAMINHO/DA/PASTA/dashboard-consulta-historicos-clientes"
```
```bash
git init -b main
```
```bash
git add .
```
**Confira antes de commitar** — como o repositório é público, faça as duas verificações:

1) **Não pode imprimir nada:**
```bash
git ls-files | grep -E "tokens.json|usuarios.csv|config.local|Links_Acesso|site/data/|usuarios_autorizados"
```
2) **Deve imprimir só a linha do telefone de suporte** em `site/config.js` (nenhum e-mail pessoal, nenhum outro
telefone; ignora binários e as bibliotecas de terceiros em `site/vendor`):
```bash
git grep -nEIi "[A-Za-z0-9._-]+@(gmail|hotmail|outlook|yahoo)\.com|9[0-9]{4}-?[0-9]{4}" -- . ':!site/vendor'
```
Se apareceu qualquer outra coisa, **pare** e me chame. E `git ls-files | wc -l` deve mostrar 28. Então:
```bash
git commit -m "Dashboard Consulta Historicos de Clientes"
```
(Se o Git pedir identidade: `git config --global user.name "Seu Nome"` e `git config --global user.email "voce@exemplo.com"`.)

```bash
gh repo create dashboard-historicos-clientes --public --source . --remote origin --push
```
A URL do site será `https://rodrigues-svg.github.io/dashboard-historicos-clientes/` (usuário + nome do repositório).

## 4. Cadastrar os 4 segredos

Os mesmos arquivos locais — `<` envia o conteúdo sem passar pelo terminal:
```bash
gh secret set TOKENS_JSON < tokens.json
```
```bash
gh secret set USUARIOS_CSV < usuarios.csv
```
```bash
gh secret set CONFIG_LOCAL_JSON < config.local.json
```
```bash
gh secret set TOKEN_JSON < token.json
```
- `TOKEN_JSON` é o acesso OAuth ao Gmail **exclusivo deste projeto e só de leitura** (`gmail.readonly`). **Não reutilize
  o token de outro projeto** (os outros usam `gmail.modify`, que também altera e envia e-mails). Para gerá-lo (abre o
  navegador; entre com a conta que recebe o relatório e clique em Permitir):
  ```bash
  python setup_oauth.py --credentials "C:\\caminho\\credentials.json"
  ```
  (o `credentials.json` é o ID de cliente OAuth "Aplicativo para computador" do seu projeto no Google Cloud; o
  `token.json` resultante fica fora do Git.) Ele dá acesso de leitura à sua caixa: nunca o coloque em arquivo do
  repositório, issue ou comentário. Para revogá-lo: myaccount.google.com/permissions.
- Segredos de repositório **não** são entregues a *forks* nem a pull requests de terceiros, e este workflow só roda por
  disparo manual ou do cron-job.org.
- Conferir (mostra só os nomes, nunca os valores): `gh secret list` → deve listar os **4**.

## 5. Ligar o GitHub Pages

Interface: repositório → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Ou pelo terminal (se der erro, use a interface):
```bash
gh api -X POST repos/rodrigues-svg/dashboard-historicos-clientes/pages -f build_type=workflow
```

## 6. Primeira execução (manual)

```bash
gh workflow run atualizar_dashboard.yml
```
```bash
gh run list --workflow atualizar_dashboard.yml --limit 3
```
Acompanhe até `completed / success` (2–4 min). Se falhar: `gh run view --log-failed` (veja "Problemas comuns").
Depois descubra a URL publicada:
```bash
gh api repos/rodrigues-svg/dashboard-historicos-clientes/pages --jq .html_url
```

## 7. Agendamento: terça a sábado, 07:30 (Brasília) — cron-job.org

O workflow **não tem `schedule`** (item 1); sem este passo nada roda sozinho.

1. github.com/settings/personal-access-tokens/new → token *fine-grained*, **somente este repositório**, permissão
   **Contents: Read and write** (é a que o endpoint de disparo exige). Defina a validade e **anote a data de expiração**
   (quando vencer, o disparo para de funcionar). Copie o token.
2. Em cron-job.org crie o job e **ative o aviso por e-mail em caso de falha**:

   | Campo | Valor |
   |---|---|
   | URL | `https://api.github.com/repos/rodrigues-svg/dashboard-historicos-clientes/dispatches` |
   | Método | POST |
   | Horário | terça a sábado, 07:30 — fuso **America/Sao_Paulo** (crontab `30 7 * * 2-6`) |
   | Headers | `Authorization: Bearer SEU_TOKEN` e `Accept: application/vnd.github+json` |
   | Corpo | `{"event_type":"atualizar-dashboard-historicos"}` |

3. Use o botão de teste/execução manual do cron-job.org: em *Actions* do repositório deve aparecer uma nova execução.
   O código de resposta esperado é **204**.

## 8. Definir o endereço final e gerar o Excel de links

Grave a URL do item 6 (com a barra final) no arquivo local `config.local.json` (acrescente a chave `base_url`):
```json
{
  "gmail": { "remetente": "...", "assunto": "...", "dias": 4 },
  "excel_padrao": "C:\\caminho\\planilha.xlsx",
  "base_url": "https://rodrigues-svg.github.io/dashboard-historicos-clientes/"
}
```
Gere de novo (os tokens não mudam; só a URL dentro dos links e dos QR Codes):
```bash
python gerar_dashboard.py
```
O novo `Links_Acesso_Dashboard_Novavet_DDMMAAAA.xlsx` já sai com o endereço definitivo. **Não distribua ainda.**
(Esta mudança em `config.local.json` não exige atualizar o secret: o CI não gera o Excel.)
Se depois quiser o domínio `dashboard-novavet.com`: Settings → Pages → Custom domain (+ registro CNAME no DNS) e
repita este item com a nova `base_url`.

## 9. Teste final antes de liberar (só você, sem enviar nada a ninguém)

- [ ] Abra o link do **Gerente** (no Excel) e entre; o rodapé deve mostrar a data/hora da última atualização.
- [ ] Abra o link de **um RCA** e de **um supervisor** e confira que cada um vê só a sua carteira/equipe.
- [ ] Teste **senha errada** e um **token adulterado** (mudar 1 letra do link): deve recusar.
- [ ] Abra no **celular** (4G/Wi-Fi) e teste filtros, PDF e o menu.
- [ ] Na manhã seguinte (ter–sáb), veja em *Actions* que o disparo das 07:30 ocorreu e o rodapé atualizou.
- [ ] Apps Script implantado (`PASSO_A_PASSO_APPS_SCRIPT.md`) e o envio de PDF testado. Depois de implantar:
  ```bash
  python gerar_dashboard.py --email-endpoint "URL_DO_APPS_SCRIPT/exec"
  ```
  isso altera `site/config.js`; então `git add site/config.js && git commit -m "Endpoint de e-mail" && git push`
  e rode o workflow (item 6).
- [ ] **Só então** decida, por conta própria, quando e como distribuir os links.

## 10. Manutenção (o que mudar quando…)

| Mudança | O que fazer |
|---|---|
| Alterar contato/senha/nome, incluir ou remover pessoa | editar `usuarios.csv` → `python gerar_dashboard.py` → `gh secret set USUARIOS_CSV < usuarios.csv` (+ `TOKENS_JSON` se criou token) → rodar o workflow |
| Renovar/revogar um acesso | `python gerar_dashboard.py --renovar "Nome Completo"` → atualizar `TOKENS_JSON` **e** a propriedade `USUARIOS` do Apps Script (`python gerar_dashboard.py --so-apps-script`) → rodar o workflow → enviar o novo link à pessoa |
| Mudar remetente/assunto do relatório | editar `config.local.json` → `gh secret set CONFIG_LOCAL_JSON < config.local.json` |
| Mudar visual/código do site | `git add . && git commit -m "..." && git push` → **rodar o workflow** (o push sozinho não publica; o deploy é feito pelo workflow) |
| Token do cron-job.org perto de vencer | gerar outro no item 7 e trocar o header do job |

**Se algo sensível for publicado por engano** (token, `usuarios.csv`…): apagar o arquivo não basta, o histórico do Git
o guarda. Considere-o comprometido: revogue o acesso OAuth em myaccount.google.com/permissions, renove os tokens
afetados (`--renovar`), atualize os segredos e me chame para limpar o repositório.

## Problemas comuns

- **`refusing to allow an OAuth App to create or update workflow`** ao enviar: `gh auth refresh -s workflow` e repita o `git push`.
- **Deploy falha com "Pages not found"/404**: o item 5 não foi feito (Source = GitHub Actions).
- **`Secret ... ausente`** no job: falta cadastrar um dos 4 segredos (item 4). **`ERRO (--ci): N usuário(s) sem token`**:
  o `TOKENS_JSON` está desatualizado; rode o gerador local e repita `gh secret set TOKENS_JSON < tokens.json`.
- **`configure "gmail"...`** no job: `CONFIG_LOCAL_JSON` sem a chave `gmail` (remetente e assunto).
- **`nenhum e-mail do relatório configurado nos últimos N dias`**: o relatório não chegou (feriado?). O site continua com
  os dados anteriores; o rodapé mostra a data real. Rode de novo quando o e-mail chegar.
- **`nenhum passou na verificação de remetente`**: o Google não validou o remetente (SPF/DMARC) — por exemplo, se o
  relatório passou a ser enviado por outro servidor. Confira a origem; só em último caso use `--sem-verificar-remetente`.
- **`invalid_grant` ao buscar o e-mail**: o token OAuth do Gmail expirou ou foi revogado. Gere outro com
  `python setup_oauth.py --credentials ...` e atualize o secret: `gh secret set TOKEN_JSON < token.json`.
- **"Link inválido ou revogado" para alguém que estava funcionando**: renovou o token e esqueceu de atualizar
  `TOKENS_JSON`, ou o workflow ainda não rodou depois da mudança.
- **O cron-job.org devolve 401/404**: token vencido ou sem a permissão *Contents: Read and write*, ou usuário/repositório
  errado na URL.
- **Página em branco/404 logo após o deploy**: aguarde 1–2 min e confira a barra final da URL.

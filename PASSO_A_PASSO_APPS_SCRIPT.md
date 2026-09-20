# Passo a passo — Apps Script (envio do PDF por e-mail + log de acessos)

> **Atenção:** nada neste roteiro envia link ou e-mail para a equipe nem para clientes. Todos os testes usam **só
> o seu e-mail e o link do Gerente**. Não teste com e-mail de cliente real nem com o link de um RCA (o e-mail sairia
> com cópia para ele).

Tempo estimado: 20–30 min. Sem isso o dashboard funciona normalmente; o botão "Enviar Histórico em PDF" só
**baixa** o arquivo em vez de enviar por e-mail.

## O que o Apps Script faz

- **Envia o PDF** do histórico: para o e-mail do próprio usuário ou para o do cliente (com cópia para o RCA e
  reply-to no RCA, para o cliente responder direto a ele).
- **Registra em uma planilha Google** quem entrou e quem enviou o quê (aba `Log`), exibido no painel
  *Administração* do Gerente.
- Roda **na conta Google que você escolher** (item 1); não há servidor nem custo.

O `Code.gs` foi testado com 31 cenários em um ambiente simulado (token inválido, PDF falso, arquivo grande,
injeção de HTML/cabeçalho, limite diário, log só para o gerente). O que só o Google confirma — autorização, cota,
entrega — é coberto pelo teste real do item 7.

---

## 1. Decidir qual conta Google vai implantar

É a conta que aparece como **remetente** (o nome exibido é "Novavet Distribuidora"; o endereço é o da conta) e cujos
"Enviados" guardam as mensagens.

| | Conta de automação (a que já envia/recebe os relatórios dos outros projetos) | Conta corporativa da Novavet (endereço no domínio da empresa) |
|---|---|---|
| Cliente vê como remetente | o endereço da conta de automação (domínio diferente do da Novavet) | um endereço `@` do domínio da Novavet (mais coerente) |
| "Enviados" | ficam na caixa de automação | ficam na caixa da pessoa |
| Restrição a checar | — | contas **Workspace** podem bloquear "Qualquer pessoa" em App da Web (peça ao administrador) |

Cota de envio (contam **destinatários**; e-mail para cliente com cópia ao RCA conta 2): **100/dia** em Gmail comum,
**1.500/dia** no Workspace. O limite do script é 40 envios/dia por usuário (`LIMITE_DIARIO_POR_USUARIO`); com Gmail
comum e muitos usuários, reduza esse número.

## 2. Criar a planilha do log e o projeto

1. Logado na conta escolhida, abra **sheets.new** e nomeie a planilha: `Dashboard Históricos - Log`.
2. Menu **Extensões → Apps Script** (precisa ser por aqui, para o script ficar *vinculado* à planilha; um projeto
   criado direto em script.google.com não consegue gravar o log).
3. Renomeie o projeto (canto superior esquerdo): `Dashboard Históricos - E-mail e Log`.
4. Apague o código de exemplo e cole o conteúdo de `apps_script/Code.gs`, depois **Ctrl+S**. Para copiar sem
   corromper acentos (PowerShell):
   ```powershell
   Get-Content -Raw -Encoding utf8 apps_script\Code.gs | Set-Clipboard
   ```
5. Engrenagem **Configurações do projeto** → marque **"Mostrar arquivo de manifesto appsscript.json no editor"**.
   Volte ao editor, abra `appsscript.json`, substitua pelo conteúdo de `apps_script/appsscript.json` e salve:
   ```powershell
   Get-Content -Raw -Encoding utf8 apps_script\appsscript.json | Set-Clipboard
   ```

## 3. Cadastrar os usuários autorizados (propriedade `USUARIOS`)

O script só aceita quem estiver nesta lista (guarda o **hash** do token, nunca o token). Gere o arquivo atualizado
(rápido, não lê a planilha de vendas):

```bash
python gerar_dashboard.py --so-apps-script
```
Copie o conteúdo (uma linha, ~3 KB de um limite de 9 KB ≈ 60 pessoas):
```powershell
Get-Content -Raw -Encoding utf8 apps_script\usuarios_autorizados.json | Set-Clipboard
```
No Apps Script: **Configurações do projeto → Propriedades do script → Adicionar propriedade** →
Nome `USUARIOS`, Valor = o que você copiou → **Salvar propriedades do script**.

O arquivo tem nomes e e-mails: não publique nem envie a ninguém (já está no `.gitignore`).

## 4. Implantar como App da Web

1. **Implantar → Nova implantação →** engrenagem *Selecionar tipo* → **App da Web**.
2. Descrição: `v1`. **Executar como: Eu** · **Quem pode acessar: Qualquer pessoa**.
3. **Implantar → Autorizar acesso** → escolha a conta → aparece "O Google não verificou este app" (normal: o script é
   seu) → **Avançado → Acessar Dashboard Históricos… (não seguro) → Permitir**. As permissões pedidas são *enviar
   e-mail em seu nome* e *editar só esta planilha*.
4. Copie a **URL do app da Web** — termina em **`/exec`** (não use a de "Testar implantações", que termina em `/dev`).

## 5. Testar o endereço (não envia nada)

No navegador (ou `curl -sL "URL"` no bash), abra:
```
SUA_URL/exec?action=log&token=x
```
Esperado: `{"ok":false,"erro":"Somente o gerente pode ver o log."}`. Isso prova que o script responde de forma anônima.
Se aparecer uma **tela de login do Google** ou HTML, o acesso não está como "Qualquer pessoa" ou a URL é a errada.

## 6. Ligar no dashboard

```bash
python gerar_dashboard.py --email-endpoint "https://script.google.com/macros/s/SEU_ID/exec"
```
Só grava `site/config.js` (o gerador confere se a URL termina em `/exec`; contas Workspace têm o formato
`.../a/macros/dominio/s/.../exec`, também aceito). Não lê nem regera nada mais.

- **Já publicou no GitHub?** Faça `git add site/config.js`, `git commit -m "Endpoint de e-mail"`, `git push` e rode o
  workflow (veja o `PASSO_A_PASSO_GITHUB.md`, item 9).
- **Ainda não?** Teste localmente: `python -m http.server 8765 --directory site` e abra o link do Gerente trocando o
  domínio por `http://localhost:8765/`.

## 7. Teste real (somente com você)

1. Entre com o **link do Gerente**.
2. Clique em um cliente no ranking → **Enviar Histórico em PDF**. O botão deve dizer **"Enviar PDF"**
   (se disser "Baixar PDF", o endereço não foi gravado/publicado).
3. Destinatário **Meu e-mail** → Enviar → aparece "✅ E-mail enviado com sucesso!".
4. Na sua caixa: remetente "Novavet Distribuidora", assunto com o nome do cliente, PDF anexado abrindo corretamente.
5. Na planilha do log: aba `Log` com as linhas `login` e `email`. No dashboard: menu → **Administração** → o log aparece.
6. Repita escolhendo **E-mail do cliente** com **outro e-mail seu**: deve exigir um único cliente e você recebe o
   e-mail e a cópia (cc).
7. Se tudo passou, o envio de PDF está pronto. A liberação dos links para a equipe continua sendo decisão sua.

## 8. Manutenção

| Situação | O que fazer |
|---|---|
| Renovar/revogar token, incluir ou remover pessoa | atualize `usuarios.csv`/tokens → `python gerar_dashboard.py --so-apps-script` → cole o novo conteúdo em `USUARIOS` (não precisa reimplantar). Sem isso, o token novo **não consegue enviar** e o antigo continua valendo aqui |
| Editou o `Code.gs` | cole, salve → **Implantar → Gerenciar implantações →** lápis → **Versão: Nova versão → Implantar** (a URL não muda; sem nova versão nada muda) |
| Trocar a conta remetente | nova implantação na outra conta → nova URL → `--email-endpoint` |
| Desligar o envio | `python gerar_dashboard.py --email-endpoint ""` (e publique): o botão volta a baixar o PDF |
| Ajustar o limite diário | `LIMITE_DIARIO_POR_USUARIO` no `Code.gs` (padrão 40) + nova versão |
| Zerar a cota do dia | apague a propriedade `COTA` em Propriedades do script |
| Limpar o log | apague linhas antigas da aba `Log` |

## 9. Segurança e limites (leia)

- A URL do endpoint fica em `site/config.js`, ou seja, **pública**; a proteção é o token pessoal de cada usuário
  (comparado por hash), o limite diário, o aceite só de PDF (até 8 MB) e o log de tudo o que é enviado.
- Um RCA autorizado consegue enviar um PDF para **qualquer** e-mail: é o objetivo da função, e a trava "só um cliente
  por PDF" é feita pela **tela** (o script não enxerga o conteúdo do PDF). O log identifica quem enviou; revogar o
  token corta o acesso.
- A aba `Log` guarda quem entrou/enviou e o resumo dos filtros (pode conter **nome de cliente**): **não compartilhe** a
  planilha.
- Mensagens automáticas com anexo podem cair em spam nos primeiros envios para um cliente novo.

## Problemas comuns

- **Abre página de login do Google/HTML no lugar do JSON**: o acesso não é "Qualquer pessoa" (Workspace pode bloquear —
  fale com o administrador) ou você usou a URL `/dev`.
- **"Acesso não autorizado" no dashboard**: `USUARIOS` desatualizado (você renovou um token) ou colado com o JSON
  quebrado. Gere de novo com `--so-apps-script` e recole inteiro.
- **"Failed to fetch"/erro de CORS no navegador**: URL errada ou implantação não pública; confira o item 4 e o 5.
- **Pediu autorização de novo depois de editar**: normal ao mudar escopos; autorize e crie **Nova versão**.
- **Nada muda depois de editar o `Code.gs`**: faltou **Nova versão** na implantação.
- **"Limite diário de envios atingido"**: aguarde o dia seguinte ou apague a propriedade `COTA`.
- **E-mail não chega**: veja spam e o menu **Execuções** do Apps Script; "Service invoked too many times: Email" = cota
  do Gmail estourada.
- **A aba `Log` não aparece**: o projeto foi criado fora da planilha; refaça a partir de **Extensões → Apps Script**.

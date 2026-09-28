# Passo a passo — cron-job.org (atualização de terça a sábado, 07:30)

> **Atenção:** este job só **inicia a atualização dos dados** no GitHub. Ele não envia link, e-mail nem mensagem para
> ninguém. A distribuição dos links continua dependendo da sua liberação.

Tempo estimado: 15 minutos. Sem este passo o dashboard **não** se atualiza sozinho (o workflow não tem agendamento
próprio; ver `PASSO_A_PASSO_GITHUB.md`, item 1).

## Como funciona

```
cron-job.org  ──(ter–sáb, 07:30)──►  API do GitHub: "iniciar o workflow"  ──►  Actions: lê o e-mail, gera os dados cifrados
                                       (POST, token só com permissão Actions)          e publica no Pages  (≈ 1 minuto)
```

Já testado do nosso lado: a chamada devolve **HTTP 204** e o workflow completo terminou com sucesso em **53 segundos**.
O que ainda não foi feito é o cadastro no cron-job.org, que exige o seu login.

Domingo e segunda não há disparo: o painel mantém os dados da atualização de sábado. O gerador usa o e-mail mais
recente dos últimos 4 dias; o rodapé do painel mostra a data/hora do e-mail usado.

---

## 1. Criar o token no GitHub (permissão mínima)

1. Abra **https://github.com/settings/personal-access-tokens/new** (conta `rodrigues-svg`).
2. Preencha:

   | Campo | Valor |
   |---|---|
   | Token name | `cron-job.org - atualizar dashboard` |
   | Expiration | escolha uma data (máx. 1 ano) e **anote no seu calendário 1 semana antes** |
   | Resource owner | `rodrigues-svg` |
   | Repository access | **Only select repositories** → `dashboard-historicos-clientes` |
   | Permissions → Repository permissions | **Actions: Read and write** — e **nada mais** (o *Metadata: Read-only* aparece sozinho) |

3. **Generate token** e copie o valor (`github_pat_...`). O GitHub mostra **uma única vez**.

**Por que só *Actions*:** esse token consegue apenas iniciar e gerenciar execuções deste repositório. Ele **não lê os
segredos e não altera código**. (O outro caminho, `repository_dispatch`, exigiria *Contents: write*: com ele, quem
vazasse o token poderia alterar o código que roda no CI junto com os seus segredos.)

## 2. Testar o token antes de usar (recomendado)

No Git Bash. O primeiro comando pede o token sem mostrá-lo na tela; cole e tecle Enter:
```bash
read -rs -p "Cole o token e tecle Enter: " GH_TOKEN; echo
```
Envie o disparo (é a mesma chamada que o cron-job.org fará):
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" -d '{"ref":"main"}' "https://api.github.com/repos/rodrigues-svg/dashboard-historicos-clientes/actions/workflows/atualizar_dashboard.yml/dispatches"
```
```bash
unset GH_TOKEN
```
Esperado: **`HTTP 204`**. Em https://github.com/rodrigues-svg/dashboard-historicos-clientes/actions aparece uma nova
execução (evento `workflow_dispatch`) que termina em ~1 minuto. Se der outro código, veja a tabela no fim.

## 3. Criar a conta e o job no cron-job.org

1. Crie a conta em **https://cron-job.org** (gratuita; confirme o e-mail). Ative a **verificação em dois passos** na
   conta: ela guarda o token do item 1.
2. **Cronjobs → Create cronjob**. Os nomes dos campos podem variar um pouco; o que vale são os valores:

   **Aba principal (Common)**

   | Campo | Valor |
   |---|---|
   | Title | `Dashboard Historicos - atualizar (ter-sab 07:30)` |
   | URL | `https://api.github.com/repos/rodrigues-svg/dashboard-historicos-clientes/actions/workflows/atualizar_dashboard.yml/dispatches` |
   | Enable job | ligado |
   | Execution schedule | **User-defined** (personalizado): **Days of week** = terça, quarta, quinta, sexta, sábado · **Hours** = `7` · **Minutes** = `30` · dias do mês e meses = todos |
   | Time zone | **America/Sao_Paulo** (em algumas versões fica em *Settings* da conta; confira o item 4) |

   **Aba avançada (Advanced)**

   | Campo | Valor |
   |---|---|
   | Request method | **POST** |
   | Request body | `{"ref":"main"}` |
   | Headers | (um por linha: nome → valor) |
   | | `Authorization` → `Bearer github_pat_SEU_TOKEN` |
   | | `Accept` → `application/vnd.github+json` |
   | | `X-GitHub-Api-Version` → `2022-11-28` |
   | | `Content-Type` → `application/json` |
   | | `User-Agent` → `cron-job.org` |
   | Timeout | padrão (30 s) |
   | Save responses in job history | ligado (ajuda a diagnosticar) |

   **Aba de notificações (Notifications)** — ligue:
   - aviso **quando uma execução falhar**;
   - aviso **quando o job for desativado por falhas seguidas**;
   - (opcional) aviso quando voltar a funcionar depois de uma falha.

3. **Create/Save**.

## 4. Conferir o horário e testar o job

- Na lista de **próximas execuções** (next executions) do job, confirme **terça a sábado às 07:30**. Se aparecer outro
  horário (por exemplo 04:30 ou 10:30), o **fuso** está errado: ajuste para `America/Sao_Paulo`.
- Use o botão de **teste** (*Test run*). Esperado: **HTTP 204**; em *Actions* surge uma nova execução
  (`workflow_dispatch`) e, ~1 minuto depois, o rodapé do painel mostra a hora nova em "Dados atualizados em…".
- A primeira execução **automática** será na próxima terça-feira, às 07:30. Na manhã seguinte confira em *Actions* e
  no histórico do job (**History**: deve constar 204).

## 5. Rotina

| Situação | O que fazer |
|---|---|
| Token vai vencer (avise-se 1 semana antes) | gerar outro (item 1), testar (item 2) e **trocar o valor do header `Authorization`** no job; depois apagar o antigo em github.com/settings/personal-access-tokens |
| Mudar o horário ou os dias | editar o job (aba principal); sem mexer no GitHub |
| Pausar as atualizações | desligar *Enable job* no cron-job.org |
| O relatório não chegou (feriado) | o job roda com o e-mail mais recente dos últimos 4 dias; se passar disso, o workflow falha e o GitHub avisa por e-mail — os dados anteriores continuam no ar |
| Trocar o repositório ou o nome do workflow | atualizar a URL do job |

Confira em github.com/settings/notifications que os avisos de **Actions** ("Send notifications for failed workflows
only") estão ligados, para receber o e-mail se a atualização falhar.

## 6. Segurança

- O token só tem **Actions** neste repositório: não lê segredos, não altera código e não acessa outros repositórios.
- Guarde-o **somente** no cron-job.org (e, se quiser, no seu gerenciador de senhas). Nunca em arquivo do projeto, no
  Git ou em chat.
- Se suspeitar de vazamento: apague o token em github.com/settings/personal-access-tokens — ele deixa de valer na hora
  — e crie outro.
- A URL e os headers ficam só na configuração do job; nada disso está no repositório público.

## Problemas comuns

| O que aparece | Causa provável | Solução |
|---|---|---|
| **401** `Bad credentials` | token errado, colado com espaço/quebra de linha, ou vencido | recolar o token (sem o `Bearer` duplicado) ou gerar outro |
| **401** `Requires authentication` | header `Authorization` ausente | conferir o header no job |
| **403** `Resource not accessible by personal access token` | token sem a permissão **Actions: Read and write** ou sem acesso ao repositório | refazer o item 1 com o repositório selecionado |
| **404** `Not Found` | nome do repositório/workflow errado, ou token sem acesso ao repositório | conferir a URL do job letra por letra |
| **422** `No ref found` / `Invalid request` | corpo do job diferente de `{"ref":"main"}` | corrigir o corpo (aspas retas, sem espaço extra) |
| **204**, mas nenhuma execução aparece | workflow desativado à mão, ou o arquivo do workflow foi renomeado/removido (a inatividade não desativa este workflow: ele não tem `schedule`) | em *Actions*, conferir/reativar o workflow `atualizar_dashboard.yml` e testar de novo |
| **204** e a execução falha | problema no workflow, não no agendamento | ver `gh run view --log-failed` e a seção de problemas do `PASSO_A_PASSO_GITHUB.md` |
| Rodou no horário errado | fuso do cron-job.org diferente de America/Sao_Paulo | ajustar o fuso e conferir as próximas execuções |
| O job foi desativado sozinho | falhas seguidas (token vencido, por exemplo) | corrigir a causa e **reativar** o job |
| Duas execuções por dia | há outro agendador ativo (ex.: um `schedule` antigo) | manter só um; o workflow atual não tem `schedule` |

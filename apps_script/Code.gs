/**
 * Dashboard Consulta Históricos de Clientes - Novavet Distribuidora
 * Backend de e-mail (PDF do histórico) e de log de acessos.  Google Apps Script.
 *
 * COMO INSTALAR (uma vez, ~5 min):
 *  1. Crie uma planilha Google (ex.: "Dashboard Históricos - Log") > Extensões > Apps Script.
 *  2. Cole este arquivo em Code.gs e o conteúdo de appsscript.json no manifesto
 *     (Configurações do projeto > "Mostrar arquivo de manifesto appsscript.json").
 *  3. Configurações do projeto > Propriedades do script > adicione:
 *        USUARIOS = conteúdo de apps_script/usuarios_autorizados.json (gerado pelo gerar_dashboard.py)
 *     (refaça este passo sempre que renovar/revogar um token ou mudar a equipe)
 *  4. Implantar > Nova implantação > App da Web:
 *        Executar como: Eu     |     Quem pode acessar: Qualquer pessoa
 *     Autorize os escopos pedidos (enviar e-mail + planilha) e copie a URL terminada em /exec.
 *  5. Rode:  python gerar_dashboard.py --email-endpoint "URL_COPIADA"   (grava em site/config.js; não lê a planilha)
 *  Roteiro completo, com testes: PASSO_A_PASSO_APPS_SCRIPT.md
 *
 * SEGURANÇA: cada requisição precisa do token pessoal do usuário (o mesmo do link). O script compara o
 * SHA-256 ("nv-mail|" + token) com a lista USUARIOS, limita o volume diário por usuário e aceita apenas PDF.
 * Sem token válido nada é enviado - o endpoint não é um "relay" aberto.
 */

const LIMITE_DIARIO_POR_USUARIO = 40;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const FUSO = 'America/Sao_Paulo';
const ABA_LOG = 'Log';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const auth = autenticar_(req.token);
    if (!auth) return json_({ ok: false, erro: 'Acesso não autorizado.' });
    if (req.action === 'login') {
      registrar_(auth.user, 'login', String(req.ua || '').slice(0, 140));
      return json_({ ok: true });
    }
    if (req.action === 'email') return enviarEmail_(auth, req);
    return json_({ ok: false, erro: 'Ação desconhecida.' });
  } catch (err) {
    return json_({ ok: false, erro: 'Erro no servidor: ' + err.message });
  }
}

/** GET ?action=log&token=...  -> últimas 200 linhas do log (somente Gerente). */
function doGet(e) {
  const auth = autenticar_(e && e.parameter && e.parameter.token);
  if (!auth || auth.user.p !== 'Gerente') return json_({ ok: false, erro: 'Somente o gerente pode ver o log.' });
  if (e.parameter.action !== 'log') return json_({ ok: true });
  const aba = aba_();
  if (!aba) return json_({ ok: true, linhas: [] });
  const ultima = aba.getLastRow();
  if (ultima < 2) return json_({ ok: true, linhas: [] });
  const de = Math.max(2, ultima - 199);
  const valores = aba.getRange(de, 1, ultima - de + 1, 4).getValues().reverse();
  const linhas = valores.map(function (v) {
    const d = v[0] instanceof Date ? Utilities.formatDate(v[0], FUSO, 'dd/MM/yyyy HH:mm:ss') : String(v[0]);
    return [d, v[1], v[2], v[3]];
  });
  return json_({ ok: true, linhas: linhas });
}

function enviarEmail_(auth, req) {
  const user = auth.user;
  const para = String(req.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(para)) return json_({ ok: false, erro: 'E-mail de destino inválido.' });

  let bytes;
  try { bytes = Utilities.base64Decode(String(req.pdf || '')); } catch (x) { bytes = []; }
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) return json_({ ok: false, erro: 'PDF ausente ou maior que 8 MB.' });
  // cabeçalho de um PDF de verdade
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') return json_({ ok: false, erro: 'Arquivo não é um PDF.' });

  if (!consumirCota_(auth.hash)) return json_({ ok: false, erro: 'Limite diário de envios atingido (' + LIMITE_DIARIO_POR_USUARIO + ').' });

  const nomeArq = String(req.filename || 'Historico_Compras.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const r = req.resumo || {};
  const assunto = String(req.subject || 'Histórico de compras — Novavet Distribuidora').replace(/[\r\n]+/g, ' ').slice(0, 150);
  const paraCliente = req.destino === 'client';
  const texto = (paraCliente ? 'Olá,\n\nSegue em anexo o seu histórico de compras na Novavet Distribuidora.\n' : 'Segue em anexo o histórico de compras solicitado.\n') +
    '\nPeríodo: ' + (r.periodo || '-') + '\nRegistros: ' + (r.registros || '-') + '\n\n' + user.n + '\nNovavet Distribuidora';
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#2C2C2C">' +
    (paraCliente ? '<p>Olá,</p><p>Segue em anexo o seu histórico de compras na <b>Novavet Distribuidora</b>.</p>' : '<p>Segue em anexo o histórico de compras solicitado.</p>') +
    '<p style="color:#667085">Período: ' + esc_(r.periodo || '-') + '<br>Registros: ' + esc_(r.registros || '-') + '</p>' +
    '<p>' + esc_(user.n) + '<br><span style="color:#C94B5E;font-weight:bold">Novavet Distribuidora</span></p></div>';

  const opcoes = { htmlBody: html, name: 'Novavet Distribuidora', attachments: [Utilities.newBlob(bytes, 'application/pdf', nomeArq)] };
  if (user.e) { opcoes.replyTo = user.e; if (paraCliente) opcoes.cc = user.e; }   // cliente responde ao RCA; RCA recebe cópia
  MailApp.sendEmail(para, assunto, texto, opcoes);

  registrar_(user, 'email', (paraCliente ? 'cliente' : 'próprio') + ' -> ' + para + ' | ' + (r.registros || '?') + ' reg. | ' + (r.periodo || '') + ' | ' + String(r.filtros || '').slice(0, 120));
  return json_({ ok: true });
}

/* ------------------------------------------------------------------ apoio */
function autenticar_(token) {
  if (!token) return null;
  const bruto = PropertiesService.getScriptProperties().getProperty('USUARIOS');
  if (!bruto) return null;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'nv-mail|' + token, Utilities.Charset.UTF_8);
  const hash = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  const user = JSON.parse(bruto)[hash];
  return user ? { user: user, hash: hash } : null;
}

function consumirCota_(hash) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // uma única propriedade "COTA" que zera a cada dia (não acumula chaves antigas: o limite total é 500 KB)
    const props = PropertiesService.getScriptProperties();
    const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyyMMdd');
    let cota = {};
    try { cota = JSON.parse(props.getProperty('COTA') || '{}'); } catch (x) { cota = {}; }
    if (cota.dia !== hoje) cota = { dia: hoje, n: {} };
    const chave = hash.slice(0, 16);
    const usado = cota.n[chave] || 0;
    if (usado >= LIMITE_DIARIO_POR_USUARIO) return false;
    cota.n[chave] = usado + 1;
    props.setProperty('COTA', JSON.stringify(cota));
    return true;
  } finally { lock.releaseLock(); }
}

function aba_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  if (!planilha) return null;
  let aba = planilha.getSheetByName(ABA_LOG);
  if (!aba) {
    aba = planilha.insertSheet(ABA_LOG);
    aba.appendRow(['Data', 'Usuário', 'Ação', 'Detalhe']);
    aba.setFrozenRows(1);
  }
  return aba;
}

function registrar_(user, acao, detalhe) {
  try {
    const aba = aba_();
    if (aba) aba.appendRow([new Date(), user.n + ' (' + user.p + ')', acao, detalhe]);
  } catch (err) { console.error('log: ' + err.message); }
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

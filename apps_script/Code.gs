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
const LIMITE_TENDENCIAS_POR_DIA = 80;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const FUSO = 'America/Sao_Paulo';
const ABA_LOG = 'Log';
const ABA_TEND_APP = 'Tendencias';              // respostas digitadas no aplicativo (mesmas colunas do Forms + Origem)
const ABA_TEND_FORMS = 'Tendencias_Forms';      // espelho (IMPORTRANGE) da planilha de respostas do Google Forms
const MESES_ = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const CAB_TEND = ['Carimbo de data/hora', 'Endereço de e-mail', 'QUAL SEU SUPERVISOR?', 'QUEM É VOCÊ?', 'TENDÊNCIA DE QUAL O MÊS VOCÊ ESTÁ RESPONDENDO?',
  'QUAL TENDÊNCIA VOCÊS ESTÁ RESPONDENDO?', 'TENDÊNCIA GERAL (R$)', 'MSD (R$)', 'BRAVECTO (unidades)', 'FUN PADS', 'IDEXX (R$)', 'POSITIVAÇÃO DE CNPJ', 'Origem'];

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
    if (req.action === 'tendencias_ler') return tendenciasLer_(auth);
    if (req.action === 'tendencia_salvar') return tendenciaSalvar_(auth, req);
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

  if (!consumirCota_(auth.hash, 'e', LIMITE_DIARIO_POR_USUARIO)) return json_({ ok: false, erro: 'Limite diário de envios atingido (' + LIMITE_DIARIO_POR_USUARIO + ').' });

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

/* ------------------------------------------------------------------ tendências */
/** Todas as respostas do Forms (espelho) e do aplicativo, dos últimos 13 meses, só do que o usuário pode ver. */
function tendenciasLer_(auth) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const eq = equipe_(), u = auth.user, limite = Date.now() - 400 * 86400000, linhas = [];
  [[ABA_TEND_FORMS, 'forms'], [ABA_TEND_APP, 'app']].forEach(function (par) {
    const aba = planilha.getSheetByName(par[0]);
    if (!aba || aba.getLastRow() < 2) return;
    aba.getRange(2, 1, aba.getLastRow() - 1, Math.min(13, aba.getMaxColumns())).getValues().forEach(function (v) {
      const l = linhaTend_(v, par[1]);
      if (l && l.ts >= limite && podeVer_(u, l.r, eq)) linhas.push(l);
    });
  });
  return json_({ ok: true, linhas: linhas });
}

function linhaTend_(v, origem) {
  const ts = carimbo_(v[0]);
  const m = String(v[3] === null || v[3] === undefined ? '' : v[3]).match(/^\s*(\d+)/);
  const n = String(v[5] || '').match(/[12]/);
  const mes = semAcento_(v[4]);
  if (!ts || !m || !n || MESES_.map(semAcento_).indexOf(mes) < 0) return null;
  return { ts: ts, e: String(v[1] || ''), r: parseInt(m[1], 10), mes: String(v[4]).trim().toUpperCase(), n: parseInt(n[0], 10),
    g: num_(v[6]), m: num_(v[7]), b: num_(v[8]), f: num_(v[9]), i: num_(v[10]), p: num_(v[11]), o: origem };
}

function tendenciaSalvar_(auth, req) {
  const u = auth.user, eq = equipe_();
  const rca = parseInt(req.rca, 10), info = eq.rca[String(rca)];
  if (!info) return json_({ ok: false, erro: 'Vendedor não encontrado na equipe.' });
  if (!podeVer_(u, rca, eq)) return json_({ ok: false, erro: 'Você não pode preencher a tendência deste vendedor.' });
  const n = parseInt(req.n, 10);
  if (n !== 1 && n !== 2) return json_({ ok: false, erro: 'Escolha a 1ª ou a 2ª tendência.' });
  const agora = new Date();
  const mesAtual = MESES_[parseInt(Utilities.formatDate(agora, FUSO, 'M'), 10) - 1];
  if (semAcento_(req.mes) !== semAcento_(mesAtual)) return json_({ ok: false, erro: 'A tendência é sempre do mês atual (' + mesAtual + ').' });

  const campos = ['geral', 'msd', 'brav', 'fun', 'idexx', 'pos'], x = {};
  for (var k = 0; k < campos.length; k++) {
    const val = Number(req[campos[k]]);
    if (!isFinite(val) || val < 0 || val > 1e9) return json_({ ok: false, erro: 'Valor inválido em "' + campos[k] + '".' });
    x[campos[k]] = campos[k] === 'brav' || campos[k] === 'pos' ? Math.round(val) : Math.round(val * 100) / 100;
  }
  if (!(x.geral > 0)) return json_({ ok: false, erro: 'Informe a tendência geral (valor maior que zero).' });
  if (!consumirCota_(auth.hash, 't', LIMITE_TENDENCIAS_POR_DIA)) return json_({ ok: false, erro: 'Limite diário de envios atingido.' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const aba = abaTend_();
    aba.appendRow([agora, u.e || '', eq.sup[String(info.s)] || '', rca + ' - ' + info.n, mesAtual, n + 'ª TENDÊNCIA',
      x.geral, x.msd, x.brav, x.fun, x.idexx, x.pos, 'APP: ' + u.n]);
    const ln = aba.getLastRow();
    aba.getRange(ln, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    aba.getRange(ln, 7, 1, 2).setNumberFormat('#,##0.00');
    aba.getRange(ln, 10, 1, 2).setNumberFormat('#,##0.00');
  } finally { lock.releaseLock(); }
  registrar_(u, 'tendencia', n + 'ª ' + mesAtual + ' | ' + rca + ' | geral ' + x.geral);
  return json_({ ok: true });
}

function abaTend_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(ABA_TEND_APP);
  if (!aba) {
    aba = planilha.insertSheet(ABA_TEND_APP);
    aba.appendRow(CAB_TEND);
    aba.setFrozenRows(1);
  }
  return aba;
}

/** Gerente vê tudo; supervisor, a equipe dele (e a carteira própria); RCA, só o que é dele. */
function podeVer_(user, rca, eq) {
  if (user.p === 'Gerente') return true;
  if (user.p === 'Supervisor') { const i = eq.rca[String(rca)]; return rca === user.c || (!!i && i.s === user.c); }
  return rca === user.c;
}

function equipe_() {
  const bruto = PropertiesService.getScriptProperties().getProperty('EQUIPE');
  try { return bruto ? JSON.parse(bruto) : { rca: {}, sup: {} }; } catch (x) { return { rca: {}, sup: {} }; }
}

function carimbo_(v) {
  if (v instanceof Date) return v.getTime();
  const m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime() : 0;
}

function semAcento_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/** Número digitado de qualquer jeito: 220.000,00 | 13000 | 110.000.00 | "2 mil" | 500.00 */
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (!s) return null;
  let mult = 1;
  if (/\bmil\b/.test(s)) { mult = 1000; s = s.replace(/\bmil\b/, ''); }
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if ((s.match(/\./g) || []).length > 1) { const i = s.lastIndexOf('.'); s = s.slice(0, i).replace(/\./g, '') + '.' + s.slice(i + 1); }
  const x = Number(s) * mult;
  return isFinite(x) ? x : null;
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

function consumirCota_(hash, tipo, limite) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // uma única propriedade "COTA" que zera a cada dia (não acumula chaves antigas: o limite total é 500 KB)
    const props = PropertiesService.getScriptProperties();
    const hoje = Utilities.formatDate(new Date(), FUSO, 'yyyyMMdd');
    let cota = {};
    try { cota = JSON.parse(props.getProperty('COTA') || '{}'); } catch (x) { cota = {}; }
    if (cota.dia !== hoje) cota = { dia: hoje, n: {} };
    const chave = tipo + hash.slice(0, 16);
    const usado = cota.n[chave] || 0;
    if (usado >= limite) return false;
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

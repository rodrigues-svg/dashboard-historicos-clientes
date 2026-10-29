/* Service worker: deixa o site abrir como aplicativo e funcionar sem internet com os últimos dados baixados.
   VERSAO é carimbada pelo gerador a cada publicação (gerar_dashboard.py: versionar_assets). */
const VERSAO = "dev";
const CACHE = "nv-" + VERSAO;            // arquivos do site: um cache por versão
const CACHE_DADOS = "nv-dados";          // dados cifrados do usuário: sobrevivem às versões (só leem com token + e-mail + senha)
const RAIZ = new URL("./", self.location).href;

self.addEventListener("install", (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const resp = await fetch(RAIZ, { cache: "no-cache" });
    const html = await resp.clone().text();
    await cache.put(RAIZ, resp);
    const urls = [...html.matchAll(/(?:href|src)="([^"#]+\.(?:css|js)[^"#]*)"/g)]
      .map((m) => new URL(m[1], RAIZ).href).filter((u) => u.startsWith(RAIZ));
    const extras = ["img/logo.png", "img/favicon.png", "img/icon-192.png", "manifest.webmanifest"].map((u) => RAIZ + u);
    await Promise.all([...urls, ...extras].map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== CACHE_DADOS) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* página: sempre a mais recente (revalida), sem guardar o ?user=&token= do link; sem internet, a última guardada */
async function navegacao() {
  const cache = await caches.open(CACHE);
  try {
    const r = await fetch(RAIZ, { cache: "no-cache" });
    if (r.ok) { cache.put(RAIZ, r.clone()); return r; }
  } catch (e) { /* sem rede */ }
  return (await cache.match(RAIZ)) || Response.error();
}

/* css/js/imagens: o endereço leva a versão (?v=), então o que está no cache vale para sempre */
async function estatico(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) cache.put(req, r.clone());
  return r;
}

/* dados: rede primeiro. Só cai no cache se a rede falhar; se o servidor respondeu 404 (acesso revogado), apaga a cópia */
async function dados(req, url) {
  const cache = await caches.open(CACHE_DADOS);
  const chave = url.origin + url.pathname;                       // sem o ?t= que muda a cada abertura
  try {
    const r = await fetch(req);
    if (r.ok) { cache.put(chave, r.clone()); return r; }
    if (r.status === 404) await cache.delete(chave);
    return r;
  } catch (e) {
    const hit = await cache.match(chave);
    if (!hit) return Response.error();
    (await self.clients.matchAll()).forEach((c) => c.postMessage({ tipo: "dados-do-cache" }));
    return hit;
  }
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request, url = new URL(req.url);
  if (req.method !== "GET" || !url.href.startsWith(RAIZ)) return;       // POST (e-mail/log) e outros domínios seguem direto
  if (req.mode === "navigate") ev.respondWith(navegacao());
  else if (url.pathname.includes("/data/")) ev.respondWith(dados(req, url));
  else ev.respondWith(estatico(req));
});

/* Abertura animada e nome do aplicativo. O nome fica em NV_CONFIG.appName (config.js): trocar lá renomeia tudo
   (título, login, barra superior e a própria animação). O manifesto (manifest.webmanifest) é estático. */
(function () {
  const cfg = window.NV_CONFIG || {};
  const nome = (cfg.appName || "Radar Novavet").trim();
  document.title = nome;
  document.querySelectorAll("[data-app-name]").forEach((e) => { e.textContent = nome; });

  const splash = document.getElementById("splash");
  if (!splash) return;
  const partes = nome.split(/\s+/);
  const alvo = splash.querySelector("[data-app-name-split]");
  if (alvo) {                                                   // primeira palavra normal, o resto em destaque
    alvo.textContent = "";
    alvo.append(partes[0] + (partes.length > 1 ? " " : ""));
    if (partes.length > 1) { const b = document.createElement("b"); b.textContent = partes.slice(1).join(" "); alvo.append(b); }
  }
  const tag = splash.querySelector("[data-app-tagline]");
  if (tag && cfg.appTagline) tag.textContent = cfg.appTagline;

  let fechou = false;
  function fechar() {
    if (fechou) return;
    fechou = true;
    try { sessionStorage.setItem("nv_splash", "1"); } catch (e) { /* sem sessionStorage */ }
    splash.classList.add("out");
    setTimeout(() => splash.remove(), 700);
  }
  if (document.documentElement.classList.contains("no-splash")) { splash.remove(); return; }
  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  splash.addEventListener("click", fechar);                     // toque para pular
  setTimeout(fechar, reduzido ? 900 : 2600);
})();

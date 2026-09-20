/* Autenticação = decifrar o arquivo de dados do usuário.
   chave = PBKDF2-SHA256( token | e-mail | senha ) -> AES-256-GCM. Sem servidor: quem não tem
   o link (token) + e-mail + senha simplesmente não consegue abrir os dados. */
(function () {
  const NV = (window.NV = window.NV || {});
  const enc = new TextEncoder();
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function sha256Hex(s) {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
    return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function loadBlob(fid) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "data/" + fid + ".js?t=" + Date.now();          // sempre a versão mais recente
      s.onload = () => {
        const blob = window.__nv_blob;
        delete window.__nv_blob;
        s.remove();
        blob ? resolve(blob) : reject(new NV.AuthError("notfound"));
      };
      s.onerror = () => { s.remove(); reject(new NV.AuthError("notfound")); };
      document.head.append(s);
    });
  }

  NV.AuthError = class extends Error { constructor(code) { super(code); this.code = code; } };

  NV.supported = () => !!(window.crypto && crypto.subtle && window.DecompressionStream);

  NV.auth = {
    async open(token, email, pin) {
      if (!NV.supported()) throw new NV.AuthError("unsupported");
      const fid = (await sha256Hex(token)).slice(0, 24);
      const blob = await loadBlob(fid);
      const material = await crypto.subtle.importKey("raw", enc.encode(`${token}|${email.trim().toLowerCase()}|${pin}`), "PBKDF2", false, ["deriveKey"]);
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: b64(blob.salt), iterations: blob.it, hash: "SHA-256" },
        material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct));
      } catch (e) {
        throw new NV.AuthError("badcreds");                     // tag GCM inválida = e-mail/senha errados
      }
      const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    },
  };
})();

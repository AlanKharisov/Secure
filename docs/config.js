;(() => {
  "use strict";
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const API_BASE = isLocal ? "http://localhost:5000" : "https://app.world-of-photo.com";
  window.API_BASE = API_BASE;

  // Фолбек-адміни (на случай, если /api/me недоступен; обычно не нужно)
  window.CLIENT_ADMINS = new Set([
    "alankharisov1@gmail.com",
  ]);

  // Фолбек для отображения чипсов брендов (если бэкенд временно недоступен)
  window.EMAIL_BRANDS = {
    "alankharisov1@gmail.com": [{ slug: "ALAN-KHARISOV", name: "Alan Kharisov", verified: true }],
    "torosyanemil2310@gmail.com": [{ slug: "EMIL-COLA", name: "Emil Cola", verified: true }],
  };

  window.CLIENT_MANUFACTURERS = new Set([]);
  window.APP_CONFIG = Object.freeze({
    API_BASE,
    CLIENT_ADMINS: window.CLIENT_ADMINS,
    EMAIL_BRANDS: window.EMAIL_BRANDS,
    CLIENT_MANUFACTURERS: window.CLIENT_MANUFACTURERS,
  });
})();

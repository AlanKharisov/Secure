;(() => {
  "use strict";
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const API_BASE = isLocal ? "http://localhost:5000" : "https://app.world-of-photo.com";
  window.API_BASE = API_BASE;

  // опціонально: клієнтські фолбеки (зазвичай не потрібні, бекенд дає /api/me)
  window.CLIENT_ADMINS = new Set([]);
  window.EMAIL_BRANDS = {};
  window.CLIENT_MANUFACTURERS = new Set([]);

  window.APP_CONFIG = Object.freeze({
    API_BASE,
    CLIENT_ADMINS: window.CLIENT_ADMINS,
    EMAIL_BRANDS: window.EMAIL_BRANDS,
    CLIENT_MANUFACTURERS: window.CLIENT_MANUFACTURERS,
  });
})();

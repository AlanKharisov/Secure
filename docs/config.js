;(() => {
  "use strict";

  // --- API base ---
  // Локально: http://localhost:5000
  // Прод: https://app.world-of-photo.com
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  const API_BASE = isLocal
    ? "http://localhost:5000"
    : "https://app.world-of-photo.com";

  // зробимо сумісним зі старим кодом
  window.API_BASE = API_BASE;

  // --- Адміни (fallback, поки не читаєш ролі з Firestore) ---
  // додай/зміни емейли за потреби
  window.CLIENT_ADMINS = new Set([
    "alankharisov1@gmail.com",
    // "torosyanemil2310@gmail.com",
  ]);

  // --- Прив’язка email -> бренди (fallback)
  // це лише для UI, бек все одно авторитетний.
  // Вкажи рівно ті slug, що існують у бекенді.
  window.EMAIL_BRANDS = {
    "alankharisov1@gmail.com": [
      { slug: "ALAN-KHARISOV", name: "Alan Kharisov", verified: true },
    ],
    "torosyanemil2310@gmail.com": [
      { slug: "EMIL-COLA", name: "Emil Cola", verified: true },
    ],
  };

  // --- Позначення емейлів як "виробник" без списку брендів (не обов’язково) ---
  // краще не використовувати, щоб не плутати логіку.
  window.CLIENT_MANUFACTURERS = new Set([
    // "someone@example.com",
  ]);

  // опціонально зберемо це в один об’єкт (раптом стане в пригоді)
  window.APP_CONFIG = Object.freeze({
    API_BASE,
    CLIENT_ADMINS: window.CLIENT_ADMINS,
    EMAIL_BRANDS: window.EMAIL_BRANDS,
    CLIENT_MANUFACTURERS: window.CLIENT_MANUFACTURERS,
  });
})();

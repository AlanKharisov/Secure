// бекенд
window.API_BASE = "https://app.world-of-photo.com"; // або "http://localhost:5000"

// локальний список адмінів (fallback, якщо Firestore ролі поки не читаєш)
window.CLIENT_ADMINS = new Set([
  "alankharisov1@gmail.com",
]);

// fallback для брендів по email (щоб UI працював навіть якщо бек не віддає brands?owner=...)
window.EMAIL_BRANDS = {
  "alankharisov1@gmail.com": [{ slug: "ALAN-KHARISOV", name: "Alan Kharisov", verified: true }],
  "torosyanemil2310@gmail.com": [{ slug: "EMIL-COLA", name: "Emil Cola", verified: true }]
};

// опціонально: тут можна позначити, що певні емейли — виробники навіть без списку брендів
window.CLIENT_MANUFACTURERS = new Set([
  // "someone@example.com"
]);

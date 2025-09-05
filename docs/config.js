// === Front config ===
// Постав адресу твого бекенда (Render / локально)
window.API_BASE = "https://app.world-of-photo.com"; // або "http://localhost:5000"

// Кого вважати адмінами (фолбек, поки не читаємо з Firestore)
window.CLIENT_ADMINS = new Set([
  "alankharisov1@gmail.com",
  // додай інших адмінів, якщо потрібно
]);

// ⚠️ Головне: карта email -> перелік брендів (фолбек, поки немає GET /api/manufacturers?owner=...)
// Вкажи САМІ ТОЧНІ слуги (slug), якими ти вже створив бренди на бекенді.
window.EMAIL_BRANDS = {
  "alankharisov1@gmail.com": [{ slug: "ALAN-KHARISOV", name: "Alan Kharisov", verified: true }],
  "torosyanemil2310@gmail.com": [{ slug: "EMIL-COLA", name: "Emil Cola", verified: true }]
};

// Якщо хочеш позначити, що певні e-mail теж виробники (без конкретного бренду) —
// ОСОБЛИВО НЕ РЕКОМЕНДУЮ, краще використовуй EMAIL_BRANDS вище.
// Залиш порожнім або видали, щоб не плутати логіку.
window.CLIENT_MANUFACTURERS = new Set([
  // "someone@example.com"
]);

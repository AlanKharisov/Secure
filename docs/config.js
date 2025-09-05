window.API_BASE = "https://app.world-of-photo.com"; // напр.: "http://localhost:5000"

// Необов'язкові локальні фоли (fallback), якщо бек не віддає ролі/бренди
window.CLIENT_ADMINS = new Set([
    "alankharisov1@gmail.com",
    // додай ще, якщо треба
]);

// Якщо бек не вміє віддати бренди користувача — можна тимчасово додати тут
window.CLIENT_MANUFACTURERS = new Set([
    // "torosyanemil2310@gmail.com"
]);

// docs/details.js
import { api, qs, flash, makeQR, productUrl } from "./app.js";
import { Auth } from "./firebase.js";

function ownerEmailFrom(data) {
  // На сторінці verify бек не завжди повертає owner (аби не палити серійник і т.п.).
  // Якщо є в payload — використаємо, інакше вважатимемо, що невідомо.
  return (data.owner || "").trim().toLowerCase();
}

function renderDetails(data) {
  const box = qs("#details");
  const actions = qs("#actions");
  box.innerHTML = "";
  actions.innerHTML = "";

  // Картинка
  if (data.metadata?.image) {
    const img = document.createElement("img");
    img.src = data.metadata.image;
    img.alt = data.metadata.name || "Зображення";
    img.className = "cover";
    box.append(img);
  }

  // Поля
  const meta = [
    data.metadata?.name || "Без назви",
    `Вироблено: ${data.metadata?.manufacturedAt || "—"}`,
    `Статус: ${data.state}`,
    `Токен: #${data.tokenId} (${data.editionNo}/${data.editionTotal})`,
  ];
  for (const line of meta) {
    const div = document.createElement("div");
    div.className = "meta";
    div.textContent = line;
    box.append(div);
  }

  // QR на цю ж сторінку (щоб покупець міг зісканувати)
  const qrBox = document.createElement("div");
  qrBox.className = "qr";
  const target = productUrl(data.tokenId);
  makeQR(qrBox, target, 220);
  box.append(qrBox);

  // Логіка показу кнопки "Забрати продукт собі"
  const currentEmail = (Auth.user?.email || "").trim().toLowerCase();
  const owner = ownerEmailFrom(data);

  // 1) якщо не залогінений — покажемо кнопку входу
  if (!currentEmail) {
    const btn = document.createElement("button");
    btn.textContent = "Увійти, щоб забрати продукт";
    btn.addEventListener("click", () => {
      // Простіше — дернемо стандартний логін
      const login = document.getElementById("loginBtn");
      if (login) login.click();
    });
    actions.append(btn);
    return;
  }

  // 2) якщо власник вже ви — кнопку не показуємо
  if (owner && owner === currentEmail) {
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = "Цей продукт вже належить вам.";
    actions.append(note);
    return;
  }

  // 3) у бек-відповіді може бути canAcquire; якщо є — врахуємо
  const canAcquire = data.canAcquire !== undefined ? !!data.canAcquire : true;

  if (!canAcquire) {
    // Наприклад, бек сказав “не можна”. Покажемо пояснення.
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = "Зараз не можна забрати цей продукт. Оновіть сторінку або спробуйте пізніше.";
    actions.append(note);
    return;
  }

  // 4) показуємо кнопку покупки
  const btn = document.createElement("button");
  btn.textContent = "Забрати продукт собі";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "Операція…";
    try {
      await api(`/api/products/${data.tokenId}/purchase`, { method: "POST" });
      flash("Готово! Продукт тепер ваш.");
      // Після покупки перезавантажимо, щоб побачити новий стан
      location.reload();
    } catch (e) {
      flash(e.message || "Помилка під час покупки");
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });
  actions.append(btn);
}

async function init() {
  const url = new URL(location.href);
  const id = url.searchParams.get("id");
  if (!id) {
    qs("#details").textContent = "Не передано id";
    return;
  }
  try {
    const data = await api(`/api/verify/${encodeURIComponent(id)}`);
    renderDetails(data);
  } catch (e) {
    qs("#details").textContent = e.message;
  }
}
init();

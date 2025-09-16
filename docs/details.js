// details.js
import { api, qs, h, flash, makeQR } from "./app.js";

async function loadDetails() {
  const box = qs("#details");
  const actions = qs("#actions");
  const url = new URL(location.href);
  const id = url.searchParams.get("id");

  if (!id) {
    box.textContent = "Невірне посилання (немає id).";
    return;
  }

  box.textContent = "Завантаження…";
  try {
    const data = await api(`/api/verify/${encodeURIComponent(id)}`);

    const meta = data.metadata || {};
    const rows = [
      ["ID", String(data.tokenId)],
      ["Стан", String(data.state)],
      ["Назва", meta.name || "—"],
      ["Дата", meta.manufacturedAt || "—"],
      ["Едіція", data.editionNo && data.editionTotal ? `${data.editionNo}/${data.editionTotal}` : "—"],
      ["Бренд", data.brandSlug || "—"],
      ["Серійний", meta.serial || (data.scope === "full" ? "(порожньо)" : "— приховано —")],
      ["Публічна URL", data.publicUrl || "—"]
    ];

    const table = h("div", { class: "kv" },
      ...rows.map(([k,v]) =>
        h("div", { class:"kv-row" },
          h("div", { class:"kv-k" }, k),
          h("div", { class:"kv-v" }, v)
        )
      )
    );

    // QR секція
    const qrWrap = h("div", { class:"mt" },
      h("h3", null, "QR на сторінку цього продукту"),
      h("div", { id:"qrBox", class:"qrbox" })
    );

    box.innerHTML = "";
    box.appendChild(table);
    box.appendChild(qrWrap);

    // Згенерувати QR (fallback без сторонніх скриптів)
    const qrTarget = `${location.origin}/details.html?id=${encodeURIComponent(data.tokenId)}`;
    makeQR(qs("#qrBox"), qrTarget, 220);
    
    // Кнопки дій
    actions.innerHTML = "";
    if (data.canAcquire) {
      const btn = h("button", { class:"btn" }, "Отримати собі");
      btn.addEventListener("click", async () => {
        try {
          const res = await api(`/api/products/${encodeURIComponent(data.tokenId)}/purchase`, { method:"POST" });
          flash("Успіх! Тепер продукт закріплено за вами.");
          setTimeout(() => location.reload(), 800);
        } catch (e) {
          flash(e.message || "Помилка покупки", "err");
        }
      });
      actions.appendChild(btn);
    } else {
      actions.appendChild(h("div", { class:"muted" }, "Цей продукт вже належить вам або покупка недоступна."));
    }
  } catch (e) {
    box.textContent = e.message || "Помилка завантаження.";
  }
}

loadDetails();

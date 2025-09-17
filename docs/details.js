import { api, qs, flash, makeQR, productUrl } from "./app.js";

function renderDetails(data) {
  const box = qs("#details");
  const actions = qs("#actions");
  box.innerHTML = "";
  actions.innerHTML = "";

  box.append(
    ...(data.metadata?.image ? [(() => {
      const img = document.createElement("img");
      img.src = data.metadata.image;
      img.alt = data.metadata.name || "Зображення";
      img.className = "cover";
      return img;
    })()] : []),
    (() => {
      const div = document.createElement("div");
      div.className = "meta";
      div.textContent = data.metadata?.name || "Без назви";
      return div;
    })(),
    (() => {
      const div = document.createElement("div");
      div.className = "meta";
      div.textContent = `Вироблено: ${data.metadata?.manufacturedAt || "—"}`;
      return div;
    })(),
    (() => {
      const div = document.createElement("div");
      div.className = "meta";
      div.textContent = `Статус: ${data.state}`;
      return div;
    })(),
    (() => {
      const div = document.createElement("div");
      div.className = "meta";
      div.textContent = `Токен: #${data.tokenId} (${data.editionNo}/${data.editionTotal})`;
      return div;
    })()
  );

  // QR на цю ж сторінку
  const qrBox = document.createElement("div");
  qrBox.className = "qr";
  const target = productUrl(data.tokenId);
  makeQR(qrBox, target, 220);
  box.append(qrBox);

  // Кнопка «Придбати/Забрати», якщо бек дозволяє
  if (data.canAcquire) {
    const btn = document.createElement("button");
    btn.textContent = "Забрати продукт собі";
    btn.addEventListener("click", async () => {
      try {
        const res = await api(`/api/products/${data.tokenId}/purchase`, { method: "POST" });
        flash("Готово!");
        location.reload();
      } catch (e) {
        flash(e.message);
      }
    });
    actions.append(btn);
  }
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

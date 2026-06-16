const percent = document.getElementById("overlayPercent");
const label = document.getElementById("overlayLabel");
const circle = document.querySelector(".overlay-circle");
const toast = document.getElementById("overlayToast");
const toastName = document.getElementById("overlayToastName");

let initialized = false;
let previousFound = new Set();
let toastQueue = [];
let toastVisible = false;
let toastTimer = null;
let blinkTimer = null;

function progressFromState(state) {
  if (state.progress && Number.isFinite(Number(state.progress.percent))) {
    return Number(state.progress.percent);
  }
  const items = state.items || [];
  const found = state.found || {};
  const count = items.filter((item) => Boolean(found[item.id])).length;
  return items.length ? Math.round((count / items.length) * 1000) / 10 : 0;
}

function render(state) {
  const value = progressFromState(state || {});
  percent.textContent = `${value}%`;
  requestAnimationFrame(fitPercentText);
  showNewFinds(state || {});
}

function fitPercentText() {
  if (!circle) return;

  const circleWidth = circle.clientWidth || Math.max(64, Math.min(window.innerWidth, window.innerHeight - 38));
  const labelMaxWidth = circleWidth * 0.74;
  const percentMaxWidth = circleWidth * 0.72;
  const maxHeight = circleWidth * 0.28;

  let labelSize = Math.min(13, Math.max(5, circleWidth * 0.078));
  label.style.setProperty("--label-font-size", `${labelSize}px`);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (label.scrollWidth <= labelMaxWidth) break;
    labelSize = Math.max(4, labelSize - 0.5);
    label.style.setProperty("--label-font-size", `${labelSize}px`);
  }

  let size = Math.min(38, Math.max(11, circleWidth * 0.28));

  percent.style.setProperty("--percent-font-size", `${size}px`);
  for (let attempt = 0; attempt < 28; attempt += 1) {
    if (percent.scrollWidth <= percentMaxWidth && percent.scrollHeight <= maxHeight) break;
    size = Math.max(11, size - 1);
    percent.style.setProperty("--percent-font-size", `${size}px`);
  }
}

function showNewFinds(state) {
  const found = state.found || {};
  const foundIds = new Set(Object.keys(found));

  if (initialized) {
    const itemsById = new Map((state.items || []).map((item) => [item.id, item]));
    const rows = (state.recent || [])
      .filter((row) => foundIds.has(row.id) && !previousFound.has(row.id))
      .map((row) => itemsById.get(row.id) || row)
      .filter((row) => row?.name);

    if (rows.length) {
      toastQueue.push(...rows.reverse().map((row) => row.name));
      blinkCircle();
      showNextToast();
    }
  }

  previousFound = foundIds;
  initialized = true;
}

function blinkCircle() {
  if (!circle) return;
  clearTimeout(blinkTimer);
  circle.classList.remove("found-blink");
  void circle.offsetWidth;
  circle.classList.add("found-blink");
  blinkTimer = setTimeout(() => {
    circle.classList.remove("found-blink");
  }, 1800);
}

function showNextToast() {
  if (toastVisible || !toastQueue.length) return;

  const name = toastQueue.shift();
  toastVisible = true;
  toastName.textContent = name;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    toastVisible = false;
    toastTimer = setTimeout(showNextToast, 220);
  }, 3600);
}

window.soeGrail.onState(render);
window.soeGrail.onSync((payload) => {
  document.body.classList.toggle("syncing", payload?.state === "syncing");
});
window.soeGrail.getInitialData().then(render);
window.addEventListener("resize", () => requestAnimationFrame(fitPercentText));
if (document.fonts?.ready) document.fonts.ready.then(fitPercentText);

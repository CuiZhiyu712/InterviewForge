// Reading size and answer width controls for the published static library.
// Injected by scripts/build-library.mjs into the pages that render Markdown bodies.

const sizeOptions = [["小", 13], ["中", 15], ["大", 17.5], ["特大", 20]];
const sizeKey = "interview-open-source-reading-size";
const sizeFallback = 15;

const phoneWidth = 390;
const widthMin = 320;
const widthMax = 900;
const widthKey = "interview-open-source-reading-width";

const storage = {
  read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private-mode storage failures must not block the resize itself.
    }
  },
};

const applySize = (value) => {
  document.documentElement.style.setProperty("--reading-size", `${value}px`);
  for (const button of document.querySelectorAll(".reading-size button")) {
    button.classList.toggle("active", Number(button.dataset.size) === value);
  }
};

const applyWidth = (value) => {
  document.documentElement.style.setProperty("--reading-width", value === "auto" ? "100%" : `${value}px`);
  const slider = document.querySelector(".reading-width input");
  if (slider) slider.value = String(value === "auto" ? widthMax : value);
  for (const button of document.querySelectorAll(".reading-width button")) {
    button.classList.toggle("active", button.dataset.width === String(value));
  }
};

const resolveWidth = (raw) => {
  if (raw === "auto") return "auto";
  const value = Number(raw);
  return Number.isFinite(value) && value >= widthMin && value <= widthMax ? value : "auto";
};

const makeLabel = (text) => {
  const element = document.createElement("span");
  element.textContent = text;
  return element;
};

const makeButton = (text, key, value, onclick) => {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset[key] = String(value);
  element.textContent = text;
  element.onclick = onclick;
  return element;
};

const storedSize = Number(storage.read(sizeKey, String(sizeFallback)));
const initialSize = sizeOptions.some(([, value]) => value === storedSize) ? storedSize : sizeFallback;
const initialWidth = resolveWidth(storage.read(widthKey, "auto"));

// The controls live in the topbar, which every page re-render leaves alone.
const topbar = document.querySelector(".topbar");
if (topbar) {
  const controls = document.createElement("div");
  controls.className = "reading-controls";

  const sizeGroup = document.createElement("div");
  sizeGroup.className = "reading-size";
  sizeGroup.setAttribute("role", "group");
  sizeGroup.setAttribute("aria-label", "正文字号");
  sizeGroup.append(makeLabel("字号"));
  for (const [text, value] of sizeOptions) {
    sizeGroup.append(makeButton(text, "size", value, () => {
      storage.write(sizeKey, String(value));
      applySize(value);
    }));
  }

  const widthGroup = document.createElement("div");
  widthGroup.className = "reading-width";
  widthGroup.setAttribute("role", "group");
  widthGroup.setAttribute("aria-label", "答案宽度");
  widthGroup.append(makeLabel("宽度"));
  widthGroup.append(makeButton("手机模式", "width", phoneWidth, () => {
    storage.write(widthKey, String(phoneWidth));
    applyWidth(phoneWidth);
  }));
  widthGroup.append(makeButton("自适应", "width", "auto", () => {
    storage.write(widthKey, "auto");
    applyWidth("auto");
  }));

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(widthMin);
  slider.max = String(widthMax);
  slider.step = "10";
  slider.setAttribute("aria-label", "手动调整宽度");
  slider.addEventListener("input", () => {
    storage.write(widthKey, slider.value);
    applyWidth(Number(slider.value));
  });
  widthGroup.append(slider);

  controls.append(sizeGroup, widthGroup);
  topbar.append(controls);
  applySize(initialSize);
  applyWidth(initialWidth);
}

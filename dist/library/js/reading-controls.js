// Reading-size control for the published static library. Injected by
// scripts/build-library.mjs into the pages that render Markdown bodies.

const sizes = [["小", 13], ["中", 15], ["大", 17.5], ["特大", 20]];
const storageKey = "interview-open-source-reading-size";
const fallback = 15;

const stored = (() => {
  try {
    return Number(localStorage.getItem(storageKey));
  } catch {
    return Number.NaN;
  }
})();

const apply = (value) => {
  document.documentElement.style.setProperty("--reading-size", `${value}px`);
  for (const button of document.querySelectorAll(".reading-size button")) {
    button.classList.toggle("active", Number(button.dataset.size) === value);
  }
};

// The control lives in the topbar, which every page re-render leaves alone.
const topbar = document.querySelector(".topbar");
if (topbar) {
  const group = document.createElement("div");
  group.className = "reading-size";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "正文字号");
  const label = document.createElement("span");
  label.textContent = "字号";
  group.append(label);
  for (const [text, value] of sizes) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.size = String(value);
    button.textContent = text;
    button.onclick = () => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // Private-mode storage failures must not block the resize itself.
      }
      apply(value);
    };
    group.append(button);
  }
  topbar.append(group);
  apply(sizes.some(([, value]) => value === stored) ? stored : fallback);
}

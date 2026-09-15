import assert from "node:assert/strict";

// Minimal DOM stub: enough to exercise scripts/reading-controls.js under Node,
// which is the only regression guard available without a browser.
const created = [];
const variables = new Map();

class ClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.classList = new ClassList();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parent = null;
    this.style = { setProperty: (name, value) => variables.set(name, value) };
    this.textContent = "";
    created.push(this);
  }
  set className(value) { for (const name of String(value).split(/\s+/).filter(Boolean)) this.classList.add(name); }
  get className() { return [...this.classList.values].join(" "); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] ?? []) handler({ target: this }); }
}

const matches = (element, selector) => {
  const [parentClass, tagName] = selector.split(" ");
  return element.tagName === tagName.toUpperCase() && element.parent?.classList.contains(parentClass.slice(1));
};

const topbar = new Element("header");
topbar.classList.add("topbar");
globalThis.document = {
  documentElement: { style: { setProperty: (name, value) => variables.set(name, value) } },
  createElement: (tagName) => new Element(tagName),
  querySelector: (selector) => (selector === ".topbar" ? topbar : created.find((element) => matches(element, selector)) ?? null),
  querySelectorAll: (selector) => created.filter((element) => matches(element, selector)),
};
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, value),
};

await import("../scripts/reading-controls.js");

const controls = topbar.children.find((child) => child.classList.contains("reading-controls"));
assert.ok(controls, "control group must be appended to the topbar");
const buttonsIn = (group) => created.filter((element) => element.tagName === "BUTTON" && element.parent?.classList.contains(group));
const sizeButtons = buttonsIn("reading-size");
const widthButtons = buttonsIn("reading-width");
const slider = created.find((element) => element.tagName === "INPUT");

assert.equal(sizeButtons.length, 4, "four reading sizes");
assert.equal(widthButtons.length, 2, "phone mode and auto");
assert.ok(slider, "manual width slider must exist");
assert.equal(slider.min, "320");
assert.equal(slider.max, "900");
assert.equal(variables.get("--reading-size"), "15px", "default size");
assert.equal(variables.get("--reading-width"), "100%", "default width");
assert.equal(sizeButtons[1].classList.contains("active"), true, "medium is active by default");
assert.equal(widthButtons[1].classList.contains("active"), true, "auto is active by default");

widthButtons[0].onclick();
assert.equal(variables.get("--reading-width"), "390px", "phone mode width");
assert.equal(widthButtons[0].classList.contains("active"), true);
assert.equal(widthButtons[1].classList.contains("active"), false);
assert.equal(slider.value, "390");
assert.equal(store.get("interview-open-source-reading-width"), "390");

slider.value = "640";
assert.ok(slider.listeners.input?.length, "slider must have an input handler");
slider.dispatch("input");
assert.equal(variables.get("--reading-width"), "640px", "manual width");
assert.equal(widthButtons[0].classList.contains("active"), false);
assert.equal(store.get("interview-open-source-reading-width"), "640");

widthButtons[1].onclick();
assert.equal(variables.get("--reading-width"), "100%", "auto width");
assert.equal(slider.value, "900");

sizeButtons[3].onclick();
assert.equal(variables.get("--reading-size"), "20px", "extra large");
assert.equal(sizeButtons[3].classList.contains("active"), true);
assert.equal(sizeButtons[1].classList.contains("active"), false);
assert.equal(store.get("interview-open-source-reading-size"), "20");

console.log("reading controls ok: size, phone mode, manual width, auto, persistence");

// The start skill's data screens (.claude/skills/start/screens/*.html), run with a tiny fake DOM:
// they render their DATA and send the right message when clicked.
// Run: node --test tests/js/*.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DIR = path.join(__dirname, "..", "..", ".claude", "skills", "start", "screens");

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.textContent = "";
    this.className = "";
    this.hidden = false;
  }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, extra) { (this.listeners[type] || []).forEach((fn) => fn({stopPropagation() {}, preventDefault() {}, ...extra})); }
  all() { return [this, ...this.children.flatMap((c) => (c instanceof Node ? c.all() : [c]))]; }
  text() { return this.all().map((n) => n.textContent || "").join(" "); }
}

function run(name, change) {
  const html = fs.readFileSync(path.join(DIR, name + ".html"), "utf8");
  let code = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const ids = {};
  const sent = [];
  const opened = [];
  const document = {
    getElementById: (id) => (ids[id] = ids[id] || new Node("div")),
    createElement: (tag) => new Node(tag),
    createElementNS: (ns, tag) => new Node(tag),
    createTextNode: (t) => ({textContent: t}),
  };
  const line = code.split("\n").find((l) => l.startsWith("const DATA = "));
  const DATA = Object.assign(JSON.parse(line.slice("const DATA = ".length).replace(/;\s*$/, "")), change || {});
  code = code.replace(line, "const DATA = " + JSON.stringify(DATA) + ";");
  vm.runInNewContext(code, {document, sendPrompt: (t) => sent.push(t), openLink: (u) => opened.push(u), Intl});
  return {DATA, ids, sent, opened};
}

test("hub: one card per entry, a click sends its prompt", () => {
  const {DATA, ids, sent} = run("hub");
  const cards = ids.hub.children;
  assert.equal(cards.length, DATA.cards.length);
  cards[1].fire("click");
  assert.deepEqual(sent, [DATA.cards[1].prompt]);
});

test("options: short-list needs a pick, then sends the picked titles in order", () => {
  const {DATA, ids, sent, opened} = run("options");
  assert.equal(DATA.multi, true);
  const cards = ids.opts.children;
  assert.equal(cards.length, DATA.options.length);
  const foot = ids.foot.children;
  const confirm = foot[foot.length - 1];
  confirm.fire("click");
  assert.deepEqual(sent, []);
  assert.ok(foot[0].textContent.length > 0, "an error is shown when nothing is picked");
  cards[2].fire("click");
  cards[0].fire("click");
  assert.equal(foot[0].textContent, "");
  assert.equal(cards[0].getAttribute("aria-pressed"), "true");
  assert.match(confirm.textContent, /\(2\)/);
  const photos = cards[0].all().find((n) => n.tagName === "button");
  photos.fire("click");
  assert.deepEqual(opened, [DATA.options[0].link]);
  confirm.fire("click");
  assert.deepEqual(sent, [DATA.prompt + " " + DATA.options[0].title + ", " + DATA.options[2].title]);
});

test("options: single pick sends one title per Choose button", () => {
  const {DATA, ids, sent} = run("options", {multi: false});
  const buttons = ids.opts.children[1].all().filter((n) => n.tagName === "button");
  buttons[buttons.length - 1].fire("click");
  assert.deepEqual(sent, [DATA.prompt + " " + DATA.options[1].title]);
});

test("itineraries: one timeline per option, one block per stage", () => {
  const {DATA, ids, sent} = run("itineraries");
  const cards = ids.its.children;
  assert.equal(cards.length, DATA.options.length);
  DATA.options.forEach((o, i) => {
    const rects = cards[i].all().filter((n) => n.tagName === "rect");
    assert.equal(rects.length, o.stages.length);
  });
  const lisbon = cards.map((c) => c.all().find((n) => n.tagName === "g" && /Lisbon/.test(n.text())).attrs.class);
  assert.equal(lisbon[0], lisbon[1], "a stage keeps its color across options");
  const buttons = cards[1].all().filter((n) => n.tagName === "button");
  buttons[0].fire("click");
  assert.deepEqual(sent, [DATA.prompt + " " + DATA.options[1].title]);
});

test("budget: totals add up, the slider scales spending on site", () => {
  const {DATA, ids, sent} = run("budget");
  const value = (k) => ids.metrics.children[k].children[1].textContent;
  const fmt = (n) => new Intl.NumberFormat(DATA.locale, {style: "currency", currency: DATA.currency, maximumFractionDigits: 0}).format(n);
  const sum = DATA.lines.reduce((s, l) => s + l.amount, 0);
  assert.equal(value(0), fmt(sum));
  assert.equal(value(1), fmt(DATA.cap));
  const slider = ids.tune.children.find((n) => n.tagName === "input");
  slider.value = "80";
  slider.fire("input");
  const flex = DATA.lines.filter((l) => l.flex).reduce((s, l) => s + l.amount, 0);
  const scaled = DATA.lines.reduce((s, l) => s + Math.round(l.flex ? l.amount * 0.8 : l.amount), 0);
  assert.ok(flex > 0);
  assert.equal(value(0), fmt(scaled));
  const apply = ids.tune.children.find((n) => n.tagName === "button");
  assert.equal(apply.hidden, false);
  apply.fire("click");
  assert.match(sent[0], /80%/);
  assert.ok(sent[0].includes(fmt(scaled)));
});

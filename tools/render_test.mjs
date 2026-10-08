/* ==========================================================================
   Render test: executes the real assets/app.js against a minimal DOM shim and
   asserts that both language sites render completely and correctly.

   Run:  node tools/render_test.mjs
   ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = [];
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/* -------------------------------------------------------------------------- */
/* Minimal DOM                                                                */
/* -------------------------------------------------------------------------- */

class ClassList {
  constructor(node) {
    this.node = node;
  }
  add(...names) {
    const set = new Set(this.node.className.split(/\s+/).filter(Boolean));
    names.forEach((n) => set.add(n));
    this.node.className = [...set].join(" ");
  }
  remove(...names) {
    const set = new Set(this.node.className.split(/\s+/).filter(Boolean));
    names.forEach((n) => set.delete(n));
    this.node.className = [...set].join(" ");
  }
  contains(name) {
    return this.node.className.split(/\s+/).includes(name);
  }
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.className = "";
    this.hidden = false;
    this.style = new Proxy(
      { setProperty: (k, v) => (this.style[k] = v) },
      { set: (t, k, v) => ((t[k] = v), true) }
    );
    this.classList = new ClassList(this);
    this._text = "";
  }

  /* textContent behaves as a real property: getter walks children when the
     node has no direct text, matching browser semantics closely enough. */
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join("");
    return this._text;
  }
  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  append(...nodes) {
    nodes.forEach((n) => {
      if (n === null || n === undefined) return;
      if (n && n.__fragment) {
        this.children.push(...n.children);
        return;
      }
      if (typeof n === "string") {
        const t = new Element("#text");
        t.textContent = n;
        this.children.push(t);
        return;
      }
      if (n && n.__isNode) {
        this.children.push(n);
        return;
      }
      throw new Error(`Element.append received an unsupported value: ${typeof n}`);
    });
    this._text = "";
  }

  prepend(...nodes) {
    const before = this.children.slice();
    this.children = [];
    this.append(...nodes, ...before);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  addEventListener() {}
  removeEventListener() {}

  /* Selector support: comma-separated lists of ".class", "#id", "tag". */
  querySelectorAll(selector) {
    const out = [];
    for (const part of selector.split(",").map((s) => s.trim())) {
      this.walk((node) => {
        if (matches(node, part)) out.push(node);
      });
    }
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  walk(fn) {
    for (const child of this.children) {
      if (!child.__isNode) continue;
      fn(child);
      child.walk(fn);
    }
  }

  /* Synthetic geometry. There is no layout engine here, but the scroll spy only
     needs relative vertical order to pick the section above the reading line.
     Each section is placed on its own 1000px band, in document order. */
  getBoundingClientRect() {
    const section = this.closestSection();
    const top = section ? section.__bandTop : -(this.__bandTop ?? 0);
    const height = this.__height ?? 400;
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 900,
      width: 900,
      height,
      x: 0,
      y: top,
    };
  }

  closestSection() {
    let node = this;
    while (node && node.__isNode) {
      if (node.tagName === "SECTION") return node;
      node = node.__parent ?? null;
    }
    return null;
  }

  get childElementCount() {
    return this.children.filter((c) => c.__isNode).length;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  set innerHTML(value) {
    throw new Error(`innerHTML assignment used: ${String(value).slice(0, 60)}`);
  }
}

/* Distinguish element nodes from text nodes. */
Object.defineProperty(Element.prototype, "__isNode", { value: true });

function matches(node, selector) {
  if (!selector) return false;
  if (selector.startsWith("#")) return node.attributes.id === selector.slice(1);
  if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
  if (selector.startsWith("[")) {
    const m = selector.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
    if (!m) return false;
    return m[2] === undefined ? node.hasAttribute(m[1]) : node.getAttribute(m[1]) === m[2];
  }
  return node.tagName === selector.toUpperCase();
}

/* ---- Parse the real HTML so the shim has the site's actual element graph ---- */

function parseHtml(source) {
  const doc = new Element("#document");
  const byId = new Map();
  const stack = [doc];

  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let match;
  const VOID = new Set(["meta", "link", "br", "img", "input", "hr", "source"]);

  while ((match = tagRe.exec(source))) {
    const [, closing, rawTag, rawAttrs, selfClose] = match;
    const tag = rawTag.toLowerCase();

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const node = new Element(tag);
    const attrRe = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
    let attr;
    while ((attr = attrRe.exec(rawAttrs))) {
      const name = attr[1];
      const value = attr[2] ?? "";
      if (name.startsWith("data-")) {
        node.attributes[name] = value;
        node.dataset = node.dataset || {};
        node.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      } else {
        node.setAttribute(name, value);
      }
    }

    stack[stack.length - 1].append(node);
    node.__parent = stack[stack.length - 1];
    if (node.attributes.id) byId.set(node.attributes.id, node);

    if (!VOID.has(tag) && !selfClose) stack.push(node);
  }

  /* Give every <section> its own vertical band so the scroll spy sees a
     plausible, strictly increasing document order. */
  let band = 0;
  doc.walk((node) => {
    if (node.tagName === "SECTION") {
      node.__bandTop = band;
      band += 1000;
    }
  });

  return { doc, byId };
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function makeEnv(htmlPath, { throwOnUnknownMethod = true } = {}) {
  const source = readFileSync(htmlPath, "utf8");
  const { doc, byId } = parseHtml(source);
  const localePrefix = htmlPath.includes(`${join("", "zh")}`) ? "zh/" : "";

  const document = {
    documentElement: new Element("html"),
    head: new Element("head"),
    body: doc,
    title: "",
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new Element(tag),
    querySelector: (sel) => doc.querySelector(sel) ?? document.head.querySelector(sel),
    querySelectorAll: (sel) => doc.querySelectorAll(sel),
    addEventListener() {},
  };

  /* The module reads document.documentElement.lang and .dataset.theme */
  document.documentElement.lang = source.match(/<html lang="([^"]+)"/)?.[1] ?? "en";
  document.documentElement.dataset = {};
  /* Enough document for the scroll spy's bottom-of-page check to be false. */
  document.documentElement.scrollHeight = 5000;
  document.documentElement.clientHeight = 900;

  const observed = [];

  class IntersectionObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe(node) {
      observed.push(node);
    }
    unobserve() {}
    disconnect() {}
  }

  const window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      get href() {
        return `http://localhost/${localePrefix}`;
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    scrollY: 0,
    innerHeight: 900,
  };

  const localStorage = {
    store: new Map(),
    getItem(k) {
      return this.store.has(k) ? this.store.get(k) : null;
    },
    setItem(k, v) {
      this.store.set(k, String(v));
    },
  };

  const fetchCalls = [];
  const fetchImpl = async (path) => {
    fetchCalls.push(path);
    const file = join(ROOT, path);
    if (!existsSync(file)) return { ok: false, status: 404 };
    const text = readFileSync(file, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };

  const context = vm.createContext({
    document,
    window,
    localStorage,
    fetch: fetchImpl,
    IntersectionObserver,
    console,
    URL,
    setTimeout,
    /* The renderer schedules scroll-spy work through rAF; run it immediately. */
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    __observed: observed,
    __fetchCalls: fetchCalls,
    __byId: byId,
    __document: document,
  });

  return { context, document, byId, fetchCalls, observed, localePrefix };
}

/* -------------------------------------------------------------------------- */
/* Test one locale                                                            */
/* -------------------------------------------------------------------------- */

async function testLocale(label, htmlPath, jsonPath) {
  console.log(`\n=== ${label} — ${htmlPath.replace(ROOT + "/", "")} ===`);

  const env = makeEnv(htmlPath);
  const code = readFileSync(join(ROOT, "assets", "app.js"), "utf8");

  /* app.js is an ES module; expose its top-level code to the VM by evaluating
     it with import.meta.url and export-less semantics. */
  const moduleCode = code.replace(
    "new URL(import.meta.url).pathname",
    JSON.stringify("/" + (env.localePrefix ? "zh/" : "") + "assets/app.js")
  );

  const script = new vm.Script(`(async () => { ${moduleCode} })()`);
  script.runInContext(env.context);

  /* boot() is async; let the microtask queue drain. */
  await new Promise((r) => setTimeout(r, 60));

  const data = JSON.parse(readFileSync(join(ROOT, jsonPath), "utf8"));
  const text = env.document.body.textContent;

  const get = (id) => env.byId.get(id);

  check("fetched the expected content file", env.fetchCalls.includes(jsonPath), env.fetchCalls.join(", "));
  check("document.title set from meta.title", env.document.title === data.meta.title, env.document.title);
  check("<html lang> set from meta.lang", env.document.documentElement.lang === data.meta.lang, env.document.documentElement.lang);

  check("hero name rendered", get("name").textContent === data.hero.name, get("name").textContent);
  check("hero role rendered", get("role").textContent === data.hero.role);
  check("hero summary rendered", get("summary").textContent === data.hero.summary);
  check("facts rendered", get("facts").childElementCount === data.hero.facts.length,
    `${get("facts").childElementCount} vs ${data.hero.facts.length}`);
  check("stats rendered", get("stats").childElementCount === data.hero.stats.length,
    `${get("stats").childElementCount} vs ${data.hero.stats.length}`);
  check("nav rendered (5 sections)", get("nav").childElementCount === 5, String(get("nav").childElementCount));
  check("rail contact rendered", get("rail-contact").childElementCount >= 1);
  check("monogram rendered", get("monogram").textContent === data.hero.initials);

  check("about paragraphs rendered", get("about-prose").childElementCount === data.about.paragraphs.length);
  check("focus cards rendered", get("focus-grid").childElementCount === data.about.focusAreas.length);

  check("education timeline rendered", get("education-timeline").childElementCount === data.education.length);
  check("experience timeline rendered", get("experience-timeline").childElementCount === data.experience.length);
  check("section headings rendered",
    get("heading-experience").textContent === data.ui.headingExperience &&
    get("heading-about").textContent === (data.ui.headingAbout || data.ui.eyebrowFocus));
  check("group labels rendered",
    get("edu-label").textContent === data.ui.headingEducation &&
    get("work-label").textContent === data.ui.headingInternship);

  check("projects rendered", get("project-list").childElementCount === data.projects.length,
    `${get("project-list").childElementCount} vs ${data.projects.length}`);
  check("skill groups rendered", get("skill-groups").childElementCount === 4,
    String(get("skill-groups").childElementCount));
  check("contact links rendered", get("contact-links").childElementCount === data.contact.links.length);
  check("contact lede rendered", get("contact-lede").textContent === data.contact.lede);

  check("language switch label + href", 
    get("lang-switch").textContent === data.ui.langSwitchLabel &&
    get("lang-switch").getAttribute("href") === data.ui.langSwitchHref,
    `${get("lang-switch").textContent} / ${get("lang-switch").getAttribute("href")}`);

  check("theme toggle label applied",
    get("theme-toggle").getAttribute("aria-label") === data.ui.themeToggleLabel);
  check("back-to-top label applied",
    get("to-top").textContent === `${data.ui.labelBackToTop} ↑`, get("to-top").textContent);

  /* Privacy: no phone number may reach the rendered page. */
  check("no phone number rendered", !/\+\d[\d\s-]{7,}|\b1[3-9]\d{9}\b/.test(text),
    (text.match(/\+\d[\d\s-]{7,}|\b1[3-9]\d{9}\b/) || [""])[0]);

  /* No placeholder or serialization leaks anywhere in the rendered text. */
  for (const bad of ["undefined", "null", "[object Object]", "NaN"]) {
    check(`no "${bad}" leaked into the DOM`, !text.includes(bad));
  }

  /* No raw machine enum may reach the page: every kind must render through the
     localized ui label instead of the stored value. */
  for (const item of data.experience) {
    const key = item.kind === "internship" ? "kindInternship" : "kindResearch";
    check(
      `experience kind "${item.kind}" rendered as its localized label`,
      text.includes(data.ui[key]),
      `expected to find ${JSON.stringify(data.ui[key])}`
    );
  }
  check(
    "raw enum values are not shown as chips",
    !new RegExp(`>\\s*(internship|research)\\s*<`, "i").test(JSON.stringify(text))
  );

  /* Every UI string must be reachable: either rendered as text, or applied as
     an attribute (the theme toggle label is an aria-label, by design), or used
     as an href (the language switch). */
  const attributeText = [
    get("theme-toggle").getAttribute("aria-label"),
    get("lang-switch").getAttribute("href"),
    get("lang-switch").getAttribute("title"),
    ...env.document.body
      .querySelectorAll("[aria-label]")
      .map((n) => n.getAttribute("aria-label")),
  ]
    .filter(Boolean)
    .join(" | ");

  const missingUi = Object.entries(data.ui).filter(
    ([key, value]) =>
      typeof value === "string" &&
      value.length > 1 &&
      !["langSwitchHref", "labelResume"].includes(key) &&
      !text.includes(value) &&
      !attributeText.includes(value)
  );
  check("every ui string is reachable in the DOM", missingUi.length === 0,
    missingUi.map(([k]) => k).join(", "));

  /* labelResume is conditional on a resume file existing; assert the contract
     rather than the presence. */
  check(
    "resume button matches resumeUrl state",
    data.hero.resumeUrl
      ? get("rail-controls").textContent.includes(data.ui.labelResume)
      : !get("rail-controls").textContent.includes(data.ui.labelResume)
  );

  /* Every project title and every experience highlight must be rendered. */
  const missingProjects = data.projects.filter((p) => !text.includes(p.title));
  check("all project titles rendered", missingProjects.length === 0,
    missingProjects.map((p) => p.title).join(" | "));

  const allBullets = [
    ...data.projects.flatMap((p) => p.highlights),
    ...data.experience.flatMap((e) => e.highlights),
    ...data.about.paragraphs,
    ...data.education.map((e) => e.courses),
  ];
  const missingBullets = allBullets.filter((b) => !text.includes(b));
  check("all long-form copy rendered", missingBullets.length === 0,
    missingBullets.length ? `${missingBullets.length} missing, e.g. ${missingBullets[0].slice(0, 50)}` : "");

  /* The renderer must not have fallen into its error panel. */
  check("renderer did not hit its error path", !get("name") || env.document.body.querySelector(".state-panel") === null);

  /* Reveal + scroll-spy observers registered. */
  check("intersection observers registered", env.observed.length > 0, String(env.observed.length));

  return data;
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

const en = await testLocale("EN", join(ROOT, "index.html"), "data/site.json");
const zh = await testLocale("ZH", join(ROOT, "zh/index.html"), "zh/data/site.json");

console.log("\n=== cross-language link integrity ===");
const pages = [
  { name: "EN", html: join(ROOT, "index.html"), dir: ROOT },
  { name: "ZH", html: join(ROOT, "zh/index.html"), dir: join(ROOT, "zh") },
];
for (const page of pages) {
  const source = readFileSync(page.html, "utf8");
  for (const attr of ["href", "src"]) {
    const re = new RegExp(`${attr}="([^"#][^"]*)"`, "g");
    let m;
    while ((m = re.exec(source))) {
      const target = m[1];
      if (/^(https?:|mailto:|tel:|data:)/.test(target)) continue;
      const resolved = resolve(page.dir, target);
      const isDir = target.endsWith("/");
      const ok = isDir ? existsSync(join(resolved, "index.html")) : existsSync(resolved);
      check(`${page.name}: ${attr}="${target}" resolves`, ok, resolved);
    }
  }
}

/* The two JSON files must stay key-identical. */
const keysOf = (o, prefix = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? keysOf(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  ).sort();
const enKeys = keysOf(en);
const zhKeys = keysOf(zh);
check("EN/ZH JSON key sets identical", JSON.stringify(enKeys) === JSON.stringify(zhKeys),
  enKeys.filter((k) => !zhKeys.includes(k)).concat(zhKeys.filter((k) => !enKeys.includes(k))).join(", "));

console.log("\n" + "=".repeat(68));
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):`);
  failures.forEach((f) => console.log("  -", f));
  process.exit(1);
}
console.log("All render checks passed.");

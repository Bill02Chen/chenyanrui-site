/* ==========================================================================
   Ink & Vermilion — site renderer
   One renderer, two JSON content files. All copy comes from the content file;
   this module never hard-codes user-facing text.
   ========================================================================== */

const SCRIPT_PATH = new URL(import.meta.url).pathname;
const LOCALE_PREFIX = SCRIPT_PATH.includes("/zh/") ? "zh/" : "";
const CONTENT_PATH = `${LOCALE_PREFIX}data/site.json`;

/* Section order drives both the rail navigation and the scroll spy. */
const SECTIONS = [
  { id: "about", labelKey: "navAbout" },
  { id: "experience", labelKey: "navExperience" },
  { id: "projects", labelKey: "navProjects" },
  { id: "skills", labelKey: "navSkills" },
  { id: "contact", labelKey: "navContact" },
];

/* Experience kind is a stable machine value; the ui block holds the labels. */
const KIND_LABELS = {
  internship: "kindInternship",
  research: "kindResearch",
};

const SKILL_GROUPS = [
  { key: "programming", labelKey: "headingProgramming" },
  { key: "frameworks", labelKey: "headingFrameworks" },
  { key: "languages", labelKey: "headingLanguages" },
  { key: "interests", labelKey: "headingInterests" },
];

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);

boot();

async function boot() {
  try {
    if (window.location.protocol === "file:") {
      throw new Error(
        "Browsers block loading JSON from file:// URLs. Serve the folder over HTTP, " +
          'for example: python3 -m http.server 8000'
      );
    }

    const response = await fetch(CONTENT_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not load ${CONTENT_PATH} (HTTP ${response.status}).`);
    }

    render(await response.json());
  } catch (error) {
    renderError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Render                                                                     */
/* -------------------------------------------------------------------------- */

function render(data) {
  const { meta, ui, hero, about, education, experience, projects, skills, contact } = data;

  const locale = String(meta.lang || "en");
  document.documentElement.lang = locale;
  document.title = meta.title || hero.name;

  setMetaContent("description", meta.description);
  setMetaContent("og:title", meta.title || hero.name, "property");
  setMetaContent("og:description", meta.description, "property");

  renderRail({ ui, hero });
  renderAbout({ ui, about });
  renderExperience({ ui, education, experience });
  renderProjects({ ui, projects });
  renderSkills({ ui, skills });
  renderContact({ meta, ui, contact });

  $("footer-note").textContent = meta.footerNote || "";
  $("to-top").textContent = `${ui.labelBackToTop} ↑`;
  $("theme-toggle").setAttribute("aria-label", ui.themeToggleLabel);

  finishRender();
}

/* ---------------------------------- rail ---------------------------------- */

function renderRail({ ui, hero }) {
  $("monogram").textContent = hero.initials || "";
  $("name").textContent = hero.name || "";
  $("role").textContent = hero.role || "";
  $("summary").textContent = hero.summary || "";

  fill($("facts"), (hero.facts || []).map((text) => el("span", "fact-pill", text)));

  fill(
    $("stats"),
    (hero.stats || []).map((stat) => {
      const wrap = el("div", "stat");
      const value = el("div", "stat-value");
      value.append(el("span", null, stat.value));
      if (stat.unit) value.append(el("span", "stat-unit", stat.unit));
      wrap.append(value, el("div", "stat-label", stat.label));
      return wrap;
    })
  );

  /* Language switch: label/href come from the content file. */
  const lang = $("lang-switch");
  lang.textContent = ui.langSwitchLabel;
  lang.href = ui.langSwitchHref;

  /* Rail navigation */
  fill(
    $("nav"),
    SECTIONS.map((section, index) => {
      const link = el("a");
      link.href = `#${section.id}`;
      link.append(
        el("span", "nav-index", String(index + 1).padStart(2, "0")),
        el("span", null, ui[section.labelKey])
      );
      return link;
    })
  );

  /* Compact contact in the rail */
  const quick = [];
  if (hero.email) {
    quick.push(contactRow(ui.labelEmail, hero.email, `mailto:${hero.email}`));
  }
  if (hero.phone) {
    quick.push(contactRow(ui.labelPhone, hero.phone, telHref(hero.phone)));
  }
  fill($("rail-contact"), quick);
  $("rail-contact").hidden = !quick.length;

  /* Resume button: only when a public file exists. */
  if (hero.resumeUrl) {
    const resume = el("a", "control", ui.labelResume);
    resume.href = hero.resumeUrl;
    resume.target = "_blank";
    resume.rel = "noreferrer";
    $("rail-controls").prepend(resume);
  }
}

function contactRow(label, value, href) {
  const row = el("div", "row");
  row.append(el("span", "key", label));
  const link = el("a", "rule-link", value);
  link.href = href;
  row.append(link);
  return row;
}

/* ---------------------------------- about --------------------------------- */

function renderAbout({ ui, about }) {
  $("eyebrow-focus").textContent = ui.eyebrowFocus;
  $("heading-about").textContent = ui.headingAbout || ui.eyebrowFocus;
  $("about-prose").append(...(about.paragraphs || []).map((text) => el("p", null, text)));

  fill(
    $("focus-grid"),
    (about.focusAreas || []).map((area) => {
      const node = el("article", "focus-card");
      node.append(el("h3", null, area.title), el("p", null, area.description));
      return node;
    })
  );
}

/* -------------------------------- experience ------------------------------ */

function renderExperience({ ui, education, experience }) {
  $("heading-experience").textContent = ui.headingExperience;
  $("intro-experience").textContent = ui.introExperience;

  $("edu-label").textContent = ui.headingEducation;
  $("work-label").textContent = ui.headingInternship;

  $("eyebrow-experience").textContent = ui.eyebrowExperience;
  fill(
    $("education-timeline"),
    (education || []).map((item) => {
      const node = el("article", "timeline-item");
      node.append(
        entryHead(item.school, item.degree, [item.period, item.location]),
        chips([item.gpa ? `GPA ${item.gpa}` : null])
      );
      if (item.courses) {
        node.append(el("p", "entry-summary", item.courses));
      }
      const list = bulletList(item.highlights);
      if (list) node.append(list);
      return node;
    })
  );

  fill(
    $("experience-timeline"),
    (experience || []).map((item) => {
      const node = el("article", "timeline-item");
      node.append(
        entryHead(item.organization, item.role, [item.period, item.location])
      );
      const list = bulletList(item.highlights);
      if (item.summary) node.append(el("p", "entry-summary", item.summary));
      /* Kind is stored as a stable enum in the data; the visible label is
         localized through the ui block. */
      node.append(chips([], KIND_LABELS[item.kind] ? ui[KIND_LABELS[item.kind]] : item.kind));
      if (list) node.append(list);
      return node;
    })
  );
}

function entryHead(title, subtitle, meta) {
  const head = el("div", "entry-head");
  const text = el("div");
  text.append(el("h3", null, title));
  if (subtitle) text.append(el("div", "entry-sub", subtitle));
  head.append(text);
  const metaWrap = el("div", "entry-meta");
  metaWrap.append(
    ...meta.filter(Boolean).map((value) => el("span", "chip chip-quiet", value))
  );
  head.append(metaWrap);
  return head;
}

function chips(values, kind) {
  const wrap = el("div", "entry-meta");
  values.filter(Boolean).forEach((value) => wrap.append(el("span", "chip", value)));
  if (kind) wrap.append(el("span", "chip chip-quiet", kind));
  return wrap;
}

function bulletList(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const list = el("ul", "results");
  items.forEach((text) => list.append(el("li", null, text)));
  return list;
}

/* --------------------------------- projects ------------------------------- */

function renderProjects({ ui, projects }) {
  $("eyebrow-projects").textContent = ui.eyebrowProjects;
  $("heading-projects").textContent = ui.headingProjects;
  $("intro-projects").textContent = ui.introProjects;

  fill(
    $("project-list"),
    (projects || []).map((item) => {
      const wrap = el("article", "project");
      const grid = el("div", "project-grid");

      const left = el("div");
      left.append(el("h3", "project-title", item.title));
      if (item.tagline) left.append(el("p", "project-tagline", item.tagline));
      const meta = el("div", "entry-meta");
      meta.style.marginTop = "14px";
      [item.period, item.context].filter(Boolean).forEach((value) => {
        meta.append(el("span", "chip chip-quiet", value));
      });
      left.append(meta);

      if (Array.isArray(item.stack) && item.stack.length) {
        const stack = el("div", "stack");
        item.stack.forEach((tech) => stack.append(el("span", null, tech)));
        left.append(stack);
      }

      const right = el("div");
      const list = bulletList(item.highlights);
      if (list) right.append(list);

      grid.append(left, right);
      wrap.append(grid);
      return wrap;
    })
  );
}

/* ---------------------------------- skills -------------------------------- */

function renderSkills({ ui, skills }) {
  $("eyebrow-skills").textContent = ui.eyebrowSkills;
  $("heading-skills").textContent = ui.headingSkills;
  $("intro-skills").textContent = ui.introSkills;

  const groups = SKILL_GROUPS.filter(({ key }) => Array.isArray(skills[key]) && skills[key].length)
    .map(({ key, labelKey }) => {
      const group = el("div", "skill-group");
      group.append(el("h3", null, ui[labelKey]));
      const list = el("ul", "skill-list");
      skills[key].forEach((value) => list.append(el("li", null, value)));
      group.append(list);
      return group;
    });

  fill($("skill-groups"), groups);
}

/* --------------------------------- contact -------------------------------- */

function renderContact({ meta, ui, contact }) {
  $("eyebrow-contact").textContent = ui.eyebrowContact;
  $("heading-contact").textContent = ui.headingContact;
  $("intro-contact").textContent = ui.introContact;
  $("contact-lede").textContent = contact.lede || "";
  $("footer-note").textContent = meta.footerNote || "";

  fill(
    $("contact-links"),
    (contact.links || []).map((item) => {
      const isLink = Boolean(item.url);
      const node = isLink ? el("a", "contact-link") : el("div", "contact-link static");
      if (isLink) {
        node.href = item.url;
        if (!item.url.startsWith("mailto:") && !item.url.startsWith("tel:")) {
          node.target = "_blank";
          node.rel = "noreferrer";
        }
      }
      node.append(el("span", "label", item.label), el("span", "value", item.value));
      return node;
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Behaviour                                                                  */
/* -------------------------------------------------------------------------- */

function finishRender() {
  const animated = !prefersReducedMotion;

  reveal(animated);
  scrollSpy();
  progressBar(animated);
  themeToggle();
}

/* Fade sections in as they enter the viewport. */
function reveal(animated) {
  const targets = [
    ...document.querySelectorAll(
      ".section-head, .prose, .focus-card, .timeline-item, .project, .skill-group, .contact-link, .contact-lede"
    ),
  ];

  if (!animated) {
    targets.forEach((node) => node.classList.add("is-in"));
    return;
  }

  targets.forEach((node) => node.classList.add("reveal"));

  const groups = new Map();
  targets.forEach((node) => {
    const parent = node.parentElement;
    const index = groups.get(parent) || 0;
    groups.set(parent, index + 1);
    node.style.transitionDelay = `${Math.min(index, 6) * 55}ms`;
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );

  targets.forEach((node) => observer.observe(node));
}

/* Highlight the rail nav entry for the section currently in view.
   The active section is the last one whose top has passed the reading line —
   document order alone would always favour the earliest intersecting section. */
function scrollSpy() {
  const links = new Map(
    [...document.querySelectorAll("#nav a")].map((link) => [
      link.getAttribute("href").slice(1),
      link,
    ])
  );

  const nodes = SECTIONS.map(({ id }) => document.getElementById(id)).filter(Boolean);
  if (!nodes.length) return;

  let frame = 0;

  const update = () => {
    frame = 0;
    /* A section becomes current once its top crosses a line a third of the way
       down the viewport, so the highlight changes as the heading arrives. */
    const line = window.innerHeight * 0.33;
    let current = nodes[0].id;

    for (const node of nodes) {
      if (node.getBoundingClientRect().top <= line) current = node.id;
    }

    /* At the very bottom the last section wins even if it never reached the
       line, so "Contact" can actually light up. */
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) current = nodes[nodes.length - 1].id;

    links.forEach((link, id) => {
      if (id === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame ? window.requestAnimationFrame(update) : update();
  };

  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
}

/* Vermilion hairline tracking read progress. */
function progressBar(animated) {
  const bar = document.querySelector(".progress");
  if (!bar) return;

  if (!animated) {
    bar.style.display = "none";
    return;
  }

  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.setProperty("--progress", String(ratio));
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

function themeToggle() {
  const button = $("theme-toggle");
  button.addEventListener("click", () => {
    const root = document.documentElement;
    /* data-theme is unset until the visitor chooses, so fall back to the OS
       preference to decide which way the first click should flip. */
    const current =
      root.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* Storage may be unavailable; the theme still applies for this session. */
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function fill(container, nodes) {
  if (!container) return;
  container.replaceChildren(...nodes.filter(Boolean));
  container.hidden = container.childElementCount === 0;
}

function setMetaContent(name, value, attr = "name") {
  if (!value) return;
  let tag = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, name);
    document.head.append(tag);
  }
  tag.setAttribute("content", value);
}

function telHref(phone) {
  return `tel:${String(phone).replace(/[^\d+]/g, "")}`;
}

function renderError(error) {
  console.error(error);
  const isProtocolIssue = String(error && error.message).includes("file://");
  document.body.replaceChildren(
    statePanel(
      "Configuration",
      isProtocolIssue ? "This site needs a local web server." : "Content could not be loaded.",
      isProtocolIssue
        ? "Browsers refuse to fetch JSON over file:// URLs. From this folder run: python3 -m http.server 8000, then open http://localhost:8000/."
        : `Check that ${CONTENT_PATH} exists and contains valid JSON. ${error.message}`
    )
  );
}

function statePanel(eyebrow, heading, message) {
  const panel = el("div", "state-panel");
  panel.append(el("p", "eyebrow", eyebrow), el("h1", null, heading));
  const paragraph = el("p");
  paragraph.textContent = message;
  panel.append(paragraph);
  return panel;
}

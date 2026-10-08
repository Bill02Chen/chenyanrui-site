# Site content schema (frozen contract)

Both `data/site.json` (English) and `zh/data/site.json` (Chinese) must validate against this
exact shape. Keys are identical across languages; only the values are translated.
No extra top-level keys. All fields listed as required must be present and non-empty.
Never invent facts that are not in the source resume.

```jsonc
{
  "meta": {
    "lang": "en",                    // "en" | "zh-Hans"
    "title": "…",                    // browser tab title, e.g. "Yanrui Chen — AI Engineer"
    "description": "…",              // meta description, 1 sentence
    "footerNote": "…"                // short footer line
  },

  "ui": {                            // ALL interface strings, so the renderer never hard-codes copy
    "navAbout": "…",
    "navExperience": "…",
    "navProjects": "…",
    "navSkills": "…",
    "navContact": "…",
    "langSwitchLabel": "…",          // e.g. "中文" on the EN site
    "langSwitchHref": "../zh/",      // relative link to the other language site
    "eyebrowFocus": "…",
    "eyebrowExperience": "…",
    "eyebrowProjects": "…",
    "eyebrowSkills": "…",
    "eyebrowContact": "…",
    "headingExperience": "…",
    "headingProjects": "…",
    "headingSkills": "…",
    "headingContact": "…",
    "headingEducation": "…",
    "headingInternship": "…",
    "headingResearch": "…",
    "headingToolbox": "…",
    "headingLanguages": "…",
    "headingInterests": "…",
    "introExperience": "…",          // 1–2 sentence section intro
    "introProjects": "…",
    "introSkills": "…",
    "introContact": "…",
    "labelAtAGlance": "…",
    "labelKeyResults": "…",
    "labelEmail": "…",
    "labelResume": "…",              // download/view resume button text
    "labelBackToTop": "…",
    "labelPresent": "…",             // "Present" / "至今"
    "themeToggleLabel": "…"
  },

  "hero": {
    "name": "…",                     // full display name
    "initials": "…",                 // 1–3 chars, shown in the avatar monogram
    "role": "…",                     // one-line positioning statement
    "summary": "…",                  // 2–4 sentence profile paragraph
    "facts": ["…", "…"],             // 3–5 short pill items: location, degree, focus
    "stats": [                       // 3–4 headline numbers pulled straight from the resume
      { "value": "3.8", "unit": "/4", "label": "Master's GPA" }
    ],
    "highlights": ["…", "…"],        // "At a glance" bullets, 4–5 items
    "email": "billchen2022@gmail.com",
    // no phone: the published site keeps contact to email only
    "resumeUrl": ""                  // "" when no public resume file exists yet
  },

  "about": {
    "paragraphs": ["…", "…"],        // 2–3 paragraphs, first person, grounded in the resume
    "focusAreas": [                  // 4–5 cards
      { "title": "…", "description": "…" }
    ]
  },

  "education": [                     // reverse chronological
    {
      "school": "…",
      "degree": "…",
      "period": "…",
      "location": "…",
      "gpa": "…",                    // "" if not listed
      "courses": "…",                // relevant courses line, "" if none
      "highlights": ["…"]            // optional; [] if none
    }
  ],

  "experience": [                    // reverse chronological
    {
      "organization": "…",
      "role": "…",
      "period": "…",
      "location": "…",
      "kind": "internship",          // "internship" | "research"
      "summary": "…",                // ONE sentence framing the problem
      "highlights": ["…"]            // 2–4 achievement bullets, each carrying its metric
    }
  ],

  "projects": [                      // reverse chronological by date
    {
      "title": "…",
      "period": "…",
      "context": "…",                // course / lab / training camp / independent
      "tagline": "…",                // ONE short line naming the problem
      "highlights": ["…"],           // 2–3 bullets, each with a concrete number where the resume has one
      "stack": ["…"]                 // 3–6 technologies
    }
  ],

  "skills": {
    "programming": ["…"],
    "frameworks": ["…"],
    "languages": ["…"],
    "interests": ["…"]
  },

  "contact": {
    "lede": "…",                     // 1–2 sentence invitation
    "links": [                       // email only; url "" would render as plain text
      { "label": "…", "value": "…", "url": "mailto:…" }
    ]
  }
}
```

## Content rules

1. **No fabrication.** Every metric (GPA, IoU, latency, recall, precision) must appear in the
   source resume. Do not round, upgrade, or invent.
2. **Keep the numbers.** Achievement bullets must retain their quantitative results
   (e.g. `IoU 0.093 → 0.737`, `P99 65 ms`, `Recall 88.2%`).
3. **Bullet counts.** 2–4 bullets per entry; each bullet one sentence, no bullet longer than
   ~220 characters (EN) / ~120 characters (ZH).
4. **Tone.** First person, concrete, no marketing adjectives ("world-class", "passionate"),
   no emoji.
5. **Periods.** Use the source resume's own date strings verbatim.
6. **JSON validity.** Plain ASCII quotes, no trailing commas, no comments, no `//`.
   Use `\u2013`-style escapes only if needed; en dashes may be written literally as `–`.

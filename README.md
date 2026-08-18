# Value Study

A watercolour value study tool. Load a reference photo, get a simplified three-value map — lights,
mids, darks — with two draggable boundaries over its own histogram.

Runs entirely in the browser. No backend, no accounts, no analytics; the photo never leaves the
device.

Rewrite of [jacekjaskolski.github.io/valuestudy](https://jacekjaskolski.github.io/valuestudy),
which works and is in daily use. What changed and why is in `SPEC.md` §10.

## What it does

- **Three-value map** from CIELAB lightness, not RGB average, so saturated colours land in the
  value they actually read as.
- **Boundaries on the histogram.** Both are handles on the same axis as the distribution they cut,
  and the three zones are painted behind it, so the control is a miniature of the study.
- **Suggested defaults.** A photo opens on boundaries chosen by searching for a connected,
  readable mid-value shape with restrained darks — usable without touching anything.
- **Simplify shapes.** Turns pixel noise into paintable shapes: a majority filter over a sliding
  window, then small isolated regions absorbed into whatever borders them.
- **Squint.** An edge-clamped blur of the reference, the way a painter squints to find unified
  shapes, optionally preserving highlights.
- **Lights are paper white.** In watercolour the lightest value is not paint, it is the paper.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
```

It is a Vite app, so a plain static server will not do — `index.html` points at TypeScript.

| | |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck, then production build into `dist/` |
| `npm run preview` | serve the production build |
| `npm test` | the pipeline tests, no browser needed |

## Layout

- `src/pipeline/` — the algorithms. Typed arrays in, typed arrays out; no DOM, no canvas, no
  globals, so all of it is testable without a browser and portable to a native app later.
- `src/ui/` — canvas, controls, and the value bar. The only code allowed to touch the DOM.
- `src/constants.ts` — everything tuned by eye, each with a note on what changing it does.

`SPEC.md` is the build spec. `NOTES.md` records what was tried, measured and rejected — the tuning
is empirical and the reasoning is easy to lose.

## Status

Built through step 6 of `SPEC.md` §9. Still to come: depth-based aerial perspective correction, and
the PWA shell that makes it installable and offline-capable.

## Licence

© 2026 Jacek Jaskólski. All rights reserved.

This source is published for reference. It is **not** open source, and no permission is granted to
use, copy, modify, or distribute it. Viewing and forking within GitHub is allowed by GitHub's terms
of service; nothing beyond that is.

A commercial product will be built on this work, which is why no licence is offered.

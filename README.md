# Jane Eyre — an immersive digital book

Charlotte Brontë's *Jane Eyre*, complete, set as a book you open and turn the pages of. Plain HTML/CSS/JS: **no build step, no backend, no runtime dependencies.** Fonts (EB Garamond, Cormorant Garamond — SIL OFL) are bundled in `fonts/`.

## Run it

Any of these works:

```bash
# 1. just open the file (everything is loaded with <script>/<link>, so file:// is fine)
open index.html            # or double-click it

# 2. or serve the folder
python3 -m http.server 8765      # then visit http://localhost:8765/
```

## What's in the box

| Path | What |
|---|---|
| `index.html` | the app shell |
| `css/reader.css`, `css/cover.css`, `css/fonts.css` | design tokens, pages, controls · the cover · local fonts |
| `js/paginate.js` | pagination engine (measures real text, splits only between words, orphan/widow control) |
| `js/app.js` | layout, page turning, TOC, bookmarks/highlights/notes, settings, keyboard, persistence wiring |
| `js/store.js` | versioned, validated `localStorage` record |
| `img/jane-eyre-cover.webp` (+ `.jpg` fallback) | the front-cover artwork (1024×1536) |
| `js/cover.js`, `js/ambient.js` | cover board + dust motes · optional synthesised rain/hearth sound |
| `content/book.js` / `book.json` | the book text as structured data (sections → paragraphs / verse / signatures). `book.js` is the same data wrapped for `<script>` loading |
| `tools/parse.py` | the extractor that produced `content/book.*` from the supplied text |
| `tests/e2e.cjs`, `tests/smoke.cjs` | Playwright checks (see below) |

Rebuilding the content: `python3 -I tools/parse.py Jane_Eyre_pdf.txt content/book.json` (writes `book.json` and `book.js`).
Running the tests: `npm i -D playwright` (or use a global install), serve the folder on port 8765, then `node tests/e2e.cjs`.

## Using it

* **Open the Book** on the cover (**Continue Reading** if you have a saved place).
* Turn pages: `←` `→` / `PageUp` `PageDown` / `Space`, the edge arrows, the buttons, or swipe on touch. `[` `]` jump chapters; `Home` `End`.
* `C` contents · `B` bookmark · `N` notebook · `F` distraction-free · `Esc` closes whatever is open.
* **Aa** menu: type size (14–28 px), four papers (Ivory, Vellum, Moor, Gaslight), reading timer, ambient sound (off by default).
* Select text → **Highlight** or **Add note**. Click a highlight to edit its note.
* Two facing pages on wide screens; one page (with swipe) on phones/portrait tablets. The book repaginates when the window or type size changes and keeps you on the same passage.

## Text fidelity — what was done, and what the source can't give

The source was the Planet eBook PDF as supplied in extracted-text form (`Jane_Eyre_pdf.txt`). Processing in `tools/parse.py`:

* removed page furniture (`Free eBooks at Planet eBook.com`, running heads, page numbers), page-break and soft-hyphen control characters;
* rejoined hard-wrapped lines; resolved line-end hyphens (a hyphen is kept only if the hyphenated form occurs elsewhere in the book and out-numbers the closed form — exactly one case);
* split the text into: Preface, Note to the Third Edition, Chapters I–XXXVIII (the last titled *Conclusion*, as in the source);
* **verified**: the letters-and-digits stream of the book data is identical to the cleaned source (787,106 characters, ~185,000 words), and a browser test confirms every paragraph and verse line is reproduced exactly across the paginated pages at three type sizes and two layouts. Nothing was summarised, modernised or added.

Known limitations — please read:

1. **Paragraph breaks are inferred.** The extraction has no blank lines, so a paragraph ends where a line is clearly short and ends a sentence (or a closed quotation is followed by a new opening quotation). This is accurate for the great majority of the text, but a few breaks will be wrong (a merged pair of short dialogue lines, or a false break where a sentence happens to end near the right margin). A handful of places are known to run two speakers together on one line of the source.
2. **Italics are not in the source**, so none are shown (emphasis survives only where the source used CAPITALS). Original small caps/blackletter flourishes are likewise absent.
3. **Verse**: the four poems (Bewick's *Thule* lines, Bessie's song, Rochester's song, *Marmion*) were located by their first/last lines and kept line-for-line; their stanza gaps (quatrains) are *inferred* typographically, as the extraction has none.
4. **OCR/typographic defects are preserved, not silently fixed.** Examples present in the source: "stifle itI endeavoured", "Mary Arm Wilson", "pare society", "ant I might not", "feel portal", "his heir was still raven black", "my eves", "stormbeat" (originally *storm-beat*; the hyphen was lost in extraction). Ch. XXXVIII's heading appears as "CHAPTER XXXVIII— / CONCLUSION" in the source and is presented as Chapter XXXVIII · Conclusion.
5. The source gives the title and author as "Jane Eyre / By Charlotte Bronte" (no diaeresis, no subtitle). The cover uses "Charlotte Brontë" as requested; the subtitle *An Autobiography* is **not** shown because this edition's text does not carry it. Nothing here claims the cover or title page reproduce any published edition's.

## Design notes

Walnut-and-lamplight environment, ivory paper pages with gutter shading, rubricated chapter openings (burgundy numerals, brass ornaments, drop cap). Cover: a supplied full-bleed illustration (title and author are part of the image) printed on the hinged cover board, with a hinge shadow, edge bevel, light grain, a lamp-light sheen and drifting dust motes. It uses `object-fit: cover`, so on very narrow or very wide screens a thin strip at the edges may be trimmed; the title, author and ornaments stay inside the safe area. The cover is a real hinged board: it swings open and the book re-centres. Page turns are a CSS-3D leaf pivoting on the gutter with shading on both faces and a cast shadow — no library; chapters begin on right-hand pages in spread mode, as in a printed book. Page-block thickness on each edge changes as you read.

Palette: `#F3EBDD #E8DCC5 #542B35 #29251F #A68A58 #392C27 #B99A94` (all as CSS variables in `css/reader.css`).

## Accessibility

Semantic landmarks and labelled controls, visible focus rings, keyboard for everything above, `aria-live` page announcements, `aria-current` in the contents, range scrubber, `prefers-reduced-motion` (turns become instant, no cover animation, no dust drift). Highlights are keyboard-focusable buttons.

## Testing — what was and wasn't verified

`tests/e2e.cjs` (headless Chromium via Playwright; **59 checks passed, 0 failed**, no console errors, in the last run):

* text completeness and no overflow on all 977 desktop pages / 1,067 phone pages, and at 14 px and 28 px;
* cover open/close; single-turn lock (six rapid key presses = one turn); arrows, edge click, `[` `]`, `Home`/`End`; the last page ends with “…Lord Jesus!’’”;
* TOC (40 entries, accurate navigation, closes on selection, current chapter highlighted); scrubber;
* position kept across resize (desktop → smaller → phone → desktop) and across type-size change;
* persistence of position, theme, font size, timer, bookmark, highlight + note, and "Continue Reading"; recovery from garbage / outdated / malformed storage;
* reduced-motion behaviour, focus mode, `file://` loading.

**Not tested:** Safari, Firefox, or real mobile devices (touch swipe was written but only desktop Chromium was driven); screen readers; the ambient-sound audio itself (it is synthesised with Web Audio and was not auditioned); actual fullscreen entry; printing; very old browsers (needs CSS 3D transforms, Web Animations, `::first-letter` floats). Pagination takes ~1.8 s at load on the test machine (the cover is shown meanwhile); slower devices will take longer. Page-turn *feel* was judged from screenshots mid-animation, not by eye in real time.


## Premium reading details

- **Place ribbon**: a burgundy silk ribbon lies in the gutter and hangs below the book. It mirrors the saved reading position (it keeps no state of its own); click it to return to your place, or to continue from the closed book.
- **Page-turn sound** (Settings, off by default): a soft synthesised paper rustle, no audio files. Plays only for turns you make, never when a saved place is restored. Volume slider included.
- **Reading lamp** (lamp icon or `L`): a warm glow behind the book; pages are not tinted.
- **Loading**: an engraved bookplate shows only while pages are genuinely being set, with a retry if setting the type fails.
- **Dedication** on the opening screen (original line, not attributed to anyone).
- **Pause at the end of each chapter** (Settings, off by default): appears once per boundary per visit on an ordinary forward turn; never for the contents, chapter buttons, backward turns or restoring your place.
- **My Passages** (quill icon, `M`; on the opening screen too): select text, choose *Keep passage* (or press `P`), optionally pick a mood and add a note. Search, filter by mood, sort, edit, remove with undo, and jump back to the exact words (they are briefly highlighted). Stored in its own record, `jane-eyre:passages` (versioned); unreadable data is kept under `jane-eyre:passages:backup`, never silently deleted. Passages are saved only in this browser.

Passages point into the book data by section, paragraph and character offset, so they survive font-size changes and repagination. Verse and signature lines cannot be kept yet.

Tests: `tests/e2e.cjs` (original), `tests/details.cjs` and `tests/passages.cjs` (new; serve on port 8765 first).

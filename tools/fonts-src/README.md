# Open fonts for the outline-font atlases

`tools/make-font-atlases.mjs` (`npm run fonts:atlases`) draws the outline-font atlases in
`app/public/fonts/scalable/` from these fonts (ARCHITECTURE.md 3.5.1). The Windows fonts the
original uses are not redistributable, so each is replaced by an open font with the same metrics
or a similar look. Text positions stay exact because the cells, advances and line positions come
from Windows (`windows-outline-metrics.tsv`, written by `npm run oracle:gdi`); only the glyph
pixels are substitutes.

| Windows face                                                              | Open font                                      | Folder         | Licence                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| Courier New                                                               | Liberation Mono 2.1.5 (metric-compatible)      | `liberation/`  | SIL Open Font License 1.1 (`liberation/LICENSE`)                                       |
| Arial (what Windows 11 uses for `Lucida Sans Typerwriter` and `Terminal`) | Liberation Sans 2.1.5 (metric-compatible)      | `liberation/`  | SIL Open Font License 1.1                                                              |
| Lucida Console                                                            | DejaVu Sans Mono 2.37                          | `dejavu/`      | Bitstream Vera and Arev font licences, DejaVu changes public domain (`dejavu/LICENSE`) |
| Consolas                                                                  | Inconsolata 3.000 (italic slanted by the tool) | `inconsolata/` | SIL Open Font License 1.1 (`inconsolata/OFL.txt`)                                      |

Exact download URLs and SHA-256 of every archive and file: `sources.json`. The tool refuses a font
file whose hash differs from that list.

| Archive                | URL                                                                                                   | SHA-256                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Liberation Fonts 2.1.5 | https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz   | `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0` |
| DejaVu Fonts 2.37      | https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip | `7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a` |
| Inconsolata 3.000      | https://github.com/googlefonts/Inconsolata/releases/download/v3.000/fonts_ttf.zip                     | `626e8ee07501dbb544b50aa59ac2e4b9ec86b810670158a59c7a3cbaf475548a` |
| Inconsolata licence    | https://raw.githubusercontent.com/googlefonts/Inconsolata/v3.000/OFL.txt                              | `5d362a6f8690517fd9a5573128a081d8bbbb2f92714cf00556e08fbbe9600426` |

## May they be in a GPL repository?

Yes. All three licences allow copying and redistribution, alone or bundled with software, including
software under the GPL:

- **SIL OFL 1.1** (Liberation, Inconsolata): the fonts "can be bundled, embedded, redistributed
  and/or sold with any software provided that any reserved names are not used by derivative
  works"; the licence text must travel with them. The atlases rendered from them are bitmaps drawn
  by our tool; the reserved names (Liberation, Arimo, Tinos, Cousine; Inconsolata) are not used as
  font names for them. The fonts stay under the OFL; bundling them does not put the GPL code under
  the OFL or the other way round (OFL 1.1, condition 2 and the FAQ on bundling).
- **Bitstream Vera / Arev licences** (DejaVu): permission "to reproduce and distribute the Font
  Software, including without limitation the rights to use, copy, merge, publish, distribute, and/or
  sell copies", with the copyright notice kept; modified versions must be renamed (the atlases are
  not fonts and carry no font name).

## Files here

- `liberation/`, `dejavu/`, `inconsolata/`: only the font files the tool uses, with each project's
  licence (and authors) file, unchanged from the archives above.
- `sources.json`: provenance and hashes.
- `windows-outline-metrics.tsv`: the Windows measurements the tool places the glyphs with. Generated
  by `npm run oracle:gdi`; do not edit.

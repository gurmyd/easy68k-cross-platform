The help of EASy68K v5.16.1 (HTML Help sources), imported by tools/import-help.mjs.

Do not edit these files: they are generated. Run "npm run import:help" to regenerate them (the
original sources are read from reference/src-help, which is not part of the repository).

Changes made to the originals (nothing else is changed):
  - pages, contents.hhc and index.hhk are converted from Windows-1252 to UTF-8, and each page
    declares charset=utf-8;
  - every href, src, background and Local value is spelled with the exact letter case of the file
    it names (Windows does not care, web servers do);
  - the build files of the help project and the program icons are left out;
  - four links get target="_blank" (excode.htm, quickStart.htm, GNU General Public License.htm,
    Quick Reference.htm: the three web addresses and the PDF), because the frame that shows the
    pages cannot open a PDF or another site itself.
  - every page starts its head with <meta http-equiv="Content-Security-Policy"
    content="script-src 'none'">, so that no script can run in it; the import refuses a page with
    a script, an event handler attribute, a javascript: address or a link to an address of the
    site outside this folder.

Added: EASy68KQuickRef.pdf (copied from the help project because Quick Reference.htm links to it),
Port/differences.htm (the port's list of differences, rendered from docs/DIFFERENCES.md),
Reference/ATTRIBUTION.txt, this file and manifest.json (the list of files and what the import
found: rewritten references and targets that do not exist in the original).

EASy68K is distributed under the GNU General Public License; see "GNU General Public License.htm".

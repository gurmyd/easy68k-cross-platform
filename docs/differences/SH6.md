# Differences introduced by SH6 (program files, file dialog, printer)

Deliberate differences from the original. DOC1 merges this file into `docs/DIFFERENCES.md`. The
stream model itself (buffered writes, streams a reset forgets, remove refused while a file is open,
bytes written at the process's exit) follows the original; see ARCHITECTURE.md 3.8.4.

| Where | Original | Port | Why |
|---|---|---|---|
| Files a program can reach, browser store and opened folder | Any path on the disk | The folders the program has been given (its own folder, the Open Data folder, a task 58 folder) and their sub-folders, four levels deep; files beyond the limits of 3.8.4 are named once in the message area (`Not available to the program: ...`) and cannot be used | A browser has no synchronous file access: the folder is held in memory (docs/porting/errata/SH6.md entries 1, 2) |
| Path a task 58 dialog returns | `C:\...\data.txt` | `/browser/demo/data.txt` in a browser; the real path in the desktop app | 3.8.4; the program uses it as a name, which works |
| Task 58 Open dialog | The program's name is in the File name field | The dialog starts in the folder of that name; the field is empty | The application's dialogs take no initial name for Open (errata Contract C1) |
| Task 58 Save dialog without a name | Starts in the process's current directory | Starts in the folder the last file dialog ended in | Same (errata Contract C1) |
| Closing the tab while a program has unwritten bytes | Not possible: the bytes are written when the simulator exits | The browser asks "Leave site?"; if the tab closes anyway, the bytes are written or kept in the browser and written at the next start | 3.8.4 |
| Page put into the back-forward cache | - | The pending bytes are written to the file, the files stay open | The page may come back (errata entry 7) |
| File names `NUL`, `CON`, `PRN`, `AUX`, `COM1`... | Windows devices | Ordinary files | No devices in a browser store; T3 is asked to confirm what the original does |
| Printing (task 10) | Each form feed sends a page to the Windows printer at once | Each form feed adds a job to the `Printer Output` dialog, which opens by itself; `Print...` opens the system print dialog. `File > Printer Setup...` opens the same dialog | 1.4 note 2: a page cannot print without the print dialog |
| Printer page | The real printer's page and the Printer Font measured on it | A letter page at 600 dpi, cell from the Printer Font size (3.8.4) | No printer to ask in a browser |
| Printer Font changed in the middle of a page | The next character makes the printer library fail ("Printing in progress"), which the simulator reports as `ERROR: An exception occurred in routine 'exec_inst'.` and switches to trace mode | The open job is ended as it stands and a new one starts | A defect of the original caused by the user's action; recorded so it can be reverted if it must be reproduced |

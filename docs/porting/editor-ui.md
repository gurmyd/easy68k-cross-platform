# Edit68K v5.16.1 user interface - behaviour specification for the macOS/web port

Status: derived from the original source, not from a running binary. Anything that
could not be established from the source or the shipped files is marked **UNVERIFIED**.

## 0. Sources, conventions, and what is in the build

### 0.1 Sources read

All file names without a directory are relative to
`c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\`. Citations are `file:line`.
`.dfm` line numbers are the line numbers of the text-form `.dfm` file on disk
(`aboutS.dfm` is stored in *binary* form; it was decoded for this spec and is cited
by object name only).

| File(s) | Role |
|---|---|
| `EDIT68K.cpp`, `EDIT68K.bpr` | Program entry, list of forms and compiled units |
| `mainS.cpp/.h/.dfm` | Main MDI frame: menus, toolbar, actions, open/save/print/find/assemble commands |
| `textS.cpp/.h/.dfm` | The edit window (MDI child): editor, status bar, message list, tabs, auto-indent, syntax highlight, undo/redo |
| `editorOptions.cpp/.h/.dfm` | "EASy68K Editor Options" dialog |
| `optionsS.cpp/.h/.dfm` | "EASy68K Assembler Options" dialog, `settings.dat` load/save, template editor |
| `assembleS.cpp/.h/.dfm` | "Assembler Status" result dialog |
| `findDialogS.*`, `replaceDialogS.*` | Find and Replace dialogs |
| `aboutS.*` | About box |
| `help.cpp`, `ez68k.h` | F1 keyword -> help-context table |
| `asm.h`, `GLOBALS.CPP` | Shared constants and global option flags used by the UI |
| `ASSEMBLE.CPP`, `ERROR.CPP`, `LISTING.CPP`, `OBJECT.CPP`, `DIRECTIV.CPP`, `INSTLOOK.CPP`, `INSTTABL.CPP` | Only the parts that touch the UI (message list, result dialog, tokeniser and opcode table used by the highlighter) |
| `chksaveS.*`, `listS.*`, `fontForm1.*`, `preview.*`, `Preview_dlg.*`, `newhelpS.*`, `undo.*`, `util.*` | Dead or unused code - see section 17 |
| `template.NEW`, `settings.dat` | Template and settings files in the source tree |
| `c:\easy64k\reference\official-extracted\template.NEW`, `settings.dat`, `Examples\*.X68` | The files the official v5.16.1 installer actually ships |
| `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\` (`BasicOperation.htm`, `options.htm`, `quickStart.htm`, `file_operations.htm`, `main.htm`, `credits.htm`, `ez68k.ali`, `help.hhp`, `contents.hhc`, `Images\*.GIF/PNG`) | Help pages and the context-id -> page map |

### 0.2 Conventions used in this document

* **(VCL)** - behaviour that comes from Borland's VCL framework or the Windows RichEdit
  control, not from code in this source tree. It is described from knowledge of the
  framework; where it matters and is not confirmed by a help screenshot it is also
  marked UNVERIFIED.
* **QUIRK** - behaviour that is surprising or plainly a defect in the original. It is
  recorded exactly so that the architect can decide whether to reproduce it. Section 19
  gives a recommendation for each.
* **DEAD** - code or a form that exists in the source tree but cannot be reached by a
  user of the shipped program.
* Character positions: (VCL) the original editor is a RichEdit 1.0-class control in which
  a line break is the two characters CR LF, and `SelStart` counts both (the source relies
  on this, e.g. the CR LF CR LF string tests in `textS.cpp:976-983` and `1782-1789`). Column and line
  numbers shown to the user are 1-based; `CaretPos` and line indexes in code are 0-based.
* Shortcut numbers in `.dfm` files are VCL `TShortCut` values: key code + `0x2000`
  (Shift) + `0x4000` (Ctrl) + `0x8000` (Alt). Example: `49219 = 0xC043 = Ctrl+Alt+'C'`.

### 0.3 What is compiled into EDIT68K.exe

`EDIT68K.bpr:7-11` lists the object files: `EDIT68K textS aboutS ASSEMBLE assembleS BUILD
chksaveS CODEGEN DIRECTIV ERROR EVAL GLOBALS INSTLOOK INSTTABL LISTING MACRO mainS MOVEM
OBJECT OPPARSE optionsS SYMBOL STRUCTURED editorOptions help findDialogS replaceDialogS`.

Not compiled (and therefore DEAD): `undo.cpp`, `listS.cpp`, `fontForm1.cpp`, `util.cpp`,
`BINFILE.CPP`, and the forms `preview.dfm`, `Preview_dlg.dfm`, `newhelpS.dfm` (these three
have no `.cpp` at all).

Forms created at start-up, in this order (`EDIT68K.cpp:25-32`): `Main`, `AboutBox`,
`AssemblerBox`, `ChkSave`, `Options`, `EditorOptionsForm`, `findDialogFrm`,
`replaceDialogFrm`. `Application->Title = "EASy68K"` (`EDIT68K.cpp:24`) is the task-bar name.

Version strings (`asm.h:34-35`):

```cpp
const AnsiString VERSION = "5.16.01";
const char TITLE[] = "EASy68K Editor/Assembler v5.16.01";
```

---

## 1. Application shell

### 1.1 Start-up sequence

1. `TMain::TMain` (`mainS.cpp:130-171`): counters `iNewFiles = iListsOpen = iSourceOpen = 0`;
   main window size set to two thirds of the screen in each dimension
   (`Main->Width = Screen->Width*2.0/3.0; Main->Height = Screen->Height*2.0/3.0;`,
   `mainS.cpp:138-139`); help file path = `<exe folder>\help.chm`; if that file is missing
   the message `Help file not found` + newline + the path is shown (`mainS.cpp:144-149`);
   if the HTML Help library cannot be loaded the message
   `HTML Help was not detected on this computer. EASy68K help may not work correctly.`
   is shown (`mainS.cpp:152-155`); file drag-and-drop from Explorer is enabled
   (`DragAcceptFiles(Handle, true)`, `mainS.cpp:170`).
2. `TMain::FormShow` (`mainS.cpp:725-750`):
   * `Options->LoadSettings()` - reads `settings.dat` (section 11.4).
   * If there is at least one command-line parameter, `ParamStr(1)` is taken as a file
     name; if the file exists it is opened with `OpenFile`, otherwise a new source file is
     created. With no parameter a new source file is created. Only the first parameter is
     used.
   * `Main->Caption = TITLE` -> window title `EASy68K Editor/Assembler v5.16.01`.
     (The design-time caption `'EASy68K Editor '`, `mainS.dfm:7`, is never seen.)
   * If the saved setting `maximizedEdit` is true, the active edit window is maximised
     inside the frame.

There is therefore always exactly one edit window open immediately after start-up.

### 1.2 Main window

* MDI frame (`FormStyle = fsMDIForm`, `mainS.dfm:14`), background `clAppWorkSpace`,
  menu bar `MainMenu1`, one flat toolbar docked at the top (`mainS.dfm:48-59`).
  There is no status bar on the frame; each edit window has its own.
* Position and size are restored from `settings.dat` (`$main top`, `$main left`,
  `$main height`, `$main width`); with no settings file the design position
  `Left = 513, Top = 106` (`mainS.dfm:2-3`) and the two-thirds-of-screen size are used.
* (VCL) When an MDI child is maximised the frame title becomes
  `EASy68K Editor/Assembler v5.16.01 - [<child caption>]`.
* F1 while the frame itself has keyboard focus calls `displayHelp("MAIN")`
  (`mainS.cpp:812-817`), which resolves to the introduction page (section 15.2).

### 1.3 Exit sequence

`File | Exit` calls `Main->Close()` (`mainS.cpp:263-266`); the window close button does
the same.

1. (VCL) Closing an MDI frame first asks every MDI child `CloseQuery`. Each child runs
   `TTextStuff::FormCloseQuery` (section 6.6) and may show the save prompt. Answering
   Cancel in any prompt aborts the exit.
2. `TMain::FormClose` (`mainS.cpp:789-809`) calls `Options->SaveSettings()` (section 11.4)
   and shuts the HTML Help library down. If that throws, the message
   `Html Help may not have closed correctly` is shown.

### 1.4 Opening files from outside the program

* Command line: see 1.1 step 2.
* Dropping one or more files from Explorer on the frame: every dropped path that exists
  is opened with `OpenFile`, in drop order (`TMain::WmDropFiles`, `mainS.cpp:323-337`).
  Non-existent paths are skipped silently. Any file type is accepted.

---

## 2. Menus

Menu bar order: **File, Edit, Project, Options, Window, Help**
(`mainS.dfm:242, 298, 355, 367, 381, 399`). `&` marks the Alt-mnemonic letter. The
captions and shortcuts below agree with the help screenshots `Images\MainFileMnu.GIF`,
`MainEditMnu.GIF`, `MainProjectMnu.GIF`, `MainWindowMnu.GIF`.

### 2.1 File (`File1`, caption `&File`, `mainS.dfm:242-297`)

| # | Object | Caption | Shortcut | Enabled | Effect |
|---|---|---|---|---|---|
| 1 | `mnuNew` | `&New X68 Source File` | none | always | New edit window with the template (section 12). `mainS.cpp:528-535` |
| 2 | `mnuOpen` | `&Open File...` | Ctrl+O (`16463`) | always | Open dialog, then `OpenFile` (section 6.2). `mainS.cpp:312-319` |
| - | `N2` | separator | | | |
| 3 | `mnuSave` | `&Save` | Ctrl+S (`16467`) | state S (2.7) | Save, or Save As if the document has no name (section 6.4). `mainS.cpp:217-235` |
| 4 | `mnuSaveAs` | `Save &As...` | none | state S | Save dialog (section 6.4). `mainS.cpp:176-213` |
| - | `N3` | separator | | | |
| 5 | `mnuPrintSource` | `&Print` | Ctrl+P (`16464`) | state P | Print dialog then print (section 13). `mainS.cpp:409-512` |
| 6 | `mnuPrinterSetup` | `Printer Setup...` | none | always | `PrinterSetupDialog->Execute()`. `mainS.cpp:402-405` |
| - | `N4` | separator | | | |
| 7 | `Close1` | `C&lose File` | none | (VCL) when at least one edit window exists | Standard action `WindowClose1`: closes the active edit window; the save prompt of section 6.6 applies. `mainS.dfm:285-288, 1125-1128` |
| - | `N10` | separator | | | |
| 8 | `mnuExit` | `E&xit` | none | always | `Main->Close()` (section 1.3). `mainS.cpp:263-266` |

There is **no recent-files list** anywhere in the program.

### 2.2 Edit (`Edit1`, caption `&Edit`, `mainS.dfm:298-354`)

Opening the Edit menu (or pressing any Edit-menu shortcut - (VCL) the parent item is
"clicked" first) runs `Edit1Click` (`mainS.cpp:702-714`), which enables `Find Next` only
when at least one edit window exists **and** the Find dialog's text box is non-empty.

| # | Object | Caption | Shortcut | Enabled | Effect |
|---|---|---|---|---|---|
| 1 | `Undo1` | `&Undo` | Ctrl+Z (`16474`) | undo stack of the active window is non-empty | `Active->Undo()` (section 8.9). `mainS.cpp:872-878` |
| 2 | `Redo1` | `&Redo` | Ctrl+Alt+Z (`49242`) | redo stack of the active window is non-empty | `Active->Redo()`. `mainS.cpp:881-888` |
| - | `N6` | separator | | | |
| 3 | `Cut1` | `Cu&t` | Ctrl+X (`16472`) | (VCL) focused text control has a selection | Standard `TEditCut` |
| 4 | `Copy1` | `&Copy` | Ctrl+C (`16451`) | (VCL) focused text control has a selection | Standard `TEditCopy` |
| 5 | `Paste1` | `&Paste` | Ctrl+V (`16470`) | (VCL) clipboard holds text | Custom handler `EditPaste1Execute` (section 8.7). `mainS.cpp:821-854` |
| 6 | `SelectAll1` | `Select &All` | Ctrl+A (`16449`) | (VCL) focused text control is not empty | Standard `TEditSelectAll` |
| - | `N5` | separator | | | |
| 7 | `CommentSelection1` | `C&omment Selection` | Ctrl+Alt+C (`49219`) | always (never disabled in code) | `Active->commentSelection()` (section 8.5). `mainS.cpp:857-861` |
| 8 | `UncommentSelection1` | `Unco&mment Selection` | Ctrl+Alt+U (`49237`) | always | `Active->unCommentSelection()`. `mainS.cpp:864-868` |
| - | `N11` | separator | | | |
| 9 | `mnuFind` | `&Find...` | Ctrl+F (`16454`) | state F | Find dialog (section 14.1). `mainS.cpp:574-583` |
| 10 | `mnuFindNext` | `Find &Next` | F3 (`114`) | see `Edit1Click` above | `FindNext()` (section 14.2). `mainS.cpp:717-720` |
| 11 | `mnuFindAndReplace1` | `Find And &Replace...` | Ctrl+R (`16466`) | state R | Replace dialog (section 14.3). `mainS.cpp:653-660` |

The actions are defined in `ActionList1` (`mainS.dfm:1086-1173`); captions, hints and
shortcuts of items 1-8 come from the actions:

| Action | Class | Caption | Hint | ShortCut |
|---|---|---|---|---|
| `EditUndo` | `TAction` | `&Undo` | `Undo` | 16474 |
| `EditRedo` | `TAction` | `&Redo` | `Redo` | 49242 |
| `EditCut1` | `TEditCut` | `Cu&t` | `Cut` | 16472 |
| `EditCopy1` | `TEditCopy` | `&Copy` | `Copy` | 16451 |
| `EditPaste1` | `TEditPaste` (with `OnExecute`) | `&Paste` | `Paste` | 16470 |
| `EditSelectAll1` | `TEditSelectAll` | `Select &All` | `Select All` | 16449 |
| `EditCommentAdd1` | `TAction` | `C&omment Selection` | `Comment Line` | 49219 |
| `EditUncomment1` | `TAction` | `Unco&mment Selection` | `Uncomment Line` | 49237 |

QUIRK: with no edit window open, `Undo`, `Redo`, `Comment Selection`, `Uncomment
Selection` and `Paste` handlers dereference a null `ActiveMDIChild`
(`mainS.cpp:826, 859, 866, 875, 884`). Undo/Redo are disabled in that state because the
last window cleared the stacks, but Comment/Uncomment and Paste stay enabled and raise an
access-violation error box. The port must simply do nothing.

### 2.3 Project (`Compile1`, caption `&Project`, `mainS.dfm:355-366`)

| # | Object | Caption | Shortcut | Enabled | Effect |
|---|---|---|---|---|---|
| 1 | `mnuDoAssembler` | `&Assemble Source...` | F9 (`120`) | state A | Assemble the active edit window (section 10). `mainS.cpp:342-392` |
| - | `N7` | separator (last item; (VCL) trailing separators are not drawn - confirmed by `Images\MainProjectMnu.GIF`) | | | |

### 2.4 Options (`Options1`, caption `&Options`, `mainS.dfm:367-380`)

| # | Object | Caption | Shortcut | Enabled | Effect |
|---|---|---|---|---|---|
| 1 | `mnuAssemblerOptions` | `&Assembler Options...` | none | always | `Options->Show()` - **modeless** dialog (section 11.1). `mainS.cpp:754-757` |
| - | `N9` | separator | | | |
| 2 | `mnuEditorOptions` | `&Editor Options...` | none | state E | `EditorOptionsForm->ShowModal()` - modal dialog (section 11.2). `mainS.cpp:395-398` |

### 2.5 Window (`Window1`, caption `&Window`, `mainS.dfm:381-398`; it is the frame's `WindowMenu`, `mainS.dfm:42`)

| # | Object | Caption | Standard action | Effect (VCL) |
|---|---|---|---|---|
| 1 | `Arrange1` | `&Arrange` | `TWindowArrange` | Arrange the icons of minimised edit windows |
| 2 | `Cascade1` | `&Cascade` | `TWindowCascade` | Cascade edit windows |
| 3 | `TileHorizontally1` | `Tile &Horizontally` | `TWindowTileHorizontal` | Tile, windows stacked top to bottom |
| 4 | `TileVertically1` | `&Tile Vertically` | `TWindowTileVertical` | Tile, windows side by side |
| 5 | `MinimizeAll1` | `&Minimize All` | `TWindowMinimizeAll` | Minimise every edit window |
| - | (automatic) | separator, then `1 <caption>`, `2 <caption>`, ... | | (VCL/Windows) One numbered entry per open edit window, a check mark on the active one; choosing an entry activates that window. Confirmed by `Images\MainWindowMnu.GIF` |

No shortcuts. (VCL) All five actions are enabled only while at least one edit window exists.

### 2.6 Help (`About1`, caption `&Help`, `mainS.dfm:399-413`)

| # | Object | Caption | Shortcut | Enabled | Effect |
|---|---|---|---|---|---|
| 1 | `mnuHelp` | `Hel&p` | none | always | `displayHelp("INTRO")` -> help page `main.htm` (section 15). `mainS.cpp:556-559` |
| - | `N1` | separator | | | |
| 2 | `mnuAbout` | `&About` | none | always | `AboutBox->ShowModal()` (section 15.4). `mainS.cpp:550-553` |

### 2.7 Enabled/disabled state machine for the code-controlled commands

The enabled flags are global to the frame and are **not** recomputed when the user switches
between edit windows. They change only at these points:

| Event | Code | Changes |
|---|---|---|
| A *source* document is created or loaded - `NewProject("Source")` (New, Open of anything except `.L68`/`.S68`, Reload) | `textS.cpp:832-858` | `iNewFiles++`, `iSourceOpen++`; **enable** Assemble (menu + `tbAssemble`), Print (menu + `tbPrint`), Save, Save As, `tbSave`, Editor Options, Find And Replace |
| A *list* document is loaded - `NewProject("List")` (Open/Reload of `.L68` or `.S68`) | `textS.cpp:860-871` | `iListsOpen++`; **enable** Print (menu + `tbPrint`), Editor Options, Find And Replace |
| Any edit window is shown | `textS.cpp:791-803` | **enable** Find (menu + `tbFind`) |
| An edit window closes and it is the last one (`Main->MDIChildCount == 1`) | `textS.cpp:673-692` | **disable** Assemble, `tbAssemble`, Print, `tbPrint`, Save, Save As, `tbSave`, Find, Find And Replace, `tbFind`, Editor Options |
| An edit window closes, others remain, and `iSourceOpen <= 0 && iListsOpen > 0` | `textS.cpp:694-701` | **disable** Assemble, `tbAssemble`, Save, Save As, `tbSave` |

In the menu tables: state A = Assemble flag, S = Save flag, P = Print flag, F = Find flag,
R = Find And Replace flag, E = Editor Options flag. All flags are true at start-up.

QUIRKS:

* Because the flags are not per-window, a listing window (`.L68`) that is active while a
  source window is also open can be assembled and saved. The `IsSource` test that used to
  prevent this is commented out (`mainS.cpp:348-349, 385-391`).
* `iSourceOpen` is incremented on every load, including Reload of an already counted
  window (`EditorReload1Click` -> `LoadFile` -> `NewProject`), so the "only lists remain"
  rule can fail to fire.
* If only list windows were ever opened after the last source window closed, Save stays
  disabled even though the list text is editable.

---

## 3. Toolbar (`ToolBar1`, `mainS.dfm:48-222`)

Flat buttons with images only, in this left-to-right order. The help screenshot
`Images\MainToolbar.GIF` and `Images\Main.PNG` agree.

| # | Object | Hint text in `.dfm` | Same as | Notes |
|---|---|---|---|---|
| 1 | `tbNew` | `New X68 Source File` | File \| New | `mainS.dfm:60-69` |
| - | separator | | | |
| 2 | `tbOpen` | `Open File (Ctrl+O)` | File \| Open File... | `mainS.dfm:78-87` |
| 3 | `tbSave` | `Save File (Ctrl+S)` | File \| Save | disabled together with the Save menu item |
| 4 | `tbPrint` | `Print (Ctrl+P)` | File \| Print | `OnClick = mnuPrintSourceClick` |
| - | separator | | | |
| 5 | `tbFind` | `Find (Ctrl+F)` | Edit \| Find... | |
| - | separator | | | |
| 6 | `tbCut` | (action hint) `Cut` | Edit \| Cut | `Action = EditCut1` |
| 7 | `tbCopy` | `Copy` | Edit \| Copy | `Action = EditCopy1` |
| 8 | `tbPaste` | `Paste` | Edit \| Paste | `Action = EditPaste1` |
| - | separator | | | |
| 9 | `tbUndo` | `Undo` | Edit \| Undo | `Action = EditUndo` |
| 10 | `ToolButton7` | `Redo` | Edit \| Redo | `Action = EditRedo` |
| - | separator | | | |
| 11 | `tbCommentAdd` | `Comment Selection` | Edit \| Comment Selection | `Action = EditCommentAdd1`; the button's own hint overrides the action hint `Comment Line` (`mainS.dfm:188-195`) |
| 12 | `tbUncomment` | `Uncomment Selection` | Edit \| Uncomment Selection | `Action = EditUncomment1` (`mainS.dfm:196-203`) |
| - | separator | | | |
| 13 | `tbAssemble` | `Assemble Source (F9)` | Project \| Assemble Source... | `mainS.dfm:212-221` |

(VCL, UNVERIFIED against the running program) For buttons bound to an action that has a
shortcut, VCL appends the shortcut to the pop-up hint, so buttons 6-12 display
`Cut (Ctrl+X)`, `Copy (Ctrl+C)`, `Paste (Ctrl+V)`, `Undo (Ctrl+Z)`, `Redo (Ctrl+Alt+Z)`,
`Comment Selection (Ctrl+Alt+C)`, `Uncomment Selection (Ctrl+Alt+U)`.

The buttons show images only. Their design-time `Caption` values (`tbNew`, `tbOpen`,
`tbSave`, `&Print Source File`, `&Font..`, `tbAssemble`, `ToolButton1`..`ToolButton6`) are
never displayed.

Icons are in `ImageList1` (`mainS.dfm:415-1085`); the help folder has one GIF per button
(`Images\ToolNew.GIF`, `ToolOpen.GIF`, `ToolSave.GIF`, `ToolPrint.GIF`, `ToolFind.GIF`,
`ToolCut.GIF`, `ToolCopy.GIF`, `ToolPaste.GIF`, `ToolUndo.GIF`, `ToolRedo.GIF`,
`ToolComment.GIF`, `ToolUncomment.GIF`, `ToolAssemble.GIF`) that can be used as visual
references.

---

## 4. Context menus

### 4.1 Right-click in the editor text (`PopupMenu1`, `textS.dfm:168-208`)

Confirmed by `Images\textRightClickMenu.PNG`.

| # | Caption | Shortcut shown | Bound to |
|---|---|---|---|
| 1 | `Undo` | Ctrl+Z | `Main.EditUndo` |
| 2 | `Redo` | Ctrl+Alt+Z | `Main.EditRedo` |
| - | separator | | |
| 3 | `Cut` | Ctrl+X | `Main.EditCut1` |
| 4 | `Copy` | Ctrl+C | `Main.EditCopy1` |
| 5 | `Paste` | Ctrl+V | `Main.EditPaste1` |
| 6 | `Select All` | Ctrl+A | `Main.EditSelectAll1` |
| - | separator | | |
| 7 | `Comment Selection` | Ctrl+Alt+C | `Main.EditCommentAdd1` |
| 8 | `Uncomment Selection` | Ctrl+Alt+U | `Main.EditUncomment1` |
| - | separator | | |
| 9 | `&Reload File` | none | `EditorReload1Click` (section 6.5). This command exists **only** here. |

Items 1-8 share the enabled state of the main-menu items.

### 4.2 Right-click in the message list (`PopupMenu2`, `textS.dfm:209-216`)

| # | Caption | Effect |
|---|---|---|
| 1 | `&Clear Error Messages` | `ClearErrorMessages` (`textS.cpp:708-713`): list height set to 7 px, all rows removed, list disabled |

---

## 5. Complete keyboard map

### 5.1 Menu and action shortcuts

Ctrl+O, Ctrl+S, Ctrl+P, Ctrl+Z, Ctrl+Alt+Z, Ctrl+X, Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+Alt+C,
Ctrl+Alt+U, Ctrl+F, F3, Ctrl+R, F9 - exactly as listed in section 2. (VCL) They are active
whenever the frame is enabled, including while focus is in one of the modeless dialogs
(Find, Replace, Assembler Options); they are inactive while a modal dialog (Editor
Options, Assembler Status, About, message boxes, file dialogs) is open. The paste handler
contains explicit code for the Find/Replace text boxes (section 8.7), which confirms that
routing.

Alt+F, Alt+E, Alt+P, Alt+O, Alt+W, Alt+H open the six menus.

### 5.2 Keys handled by the editor itself (`TTextStuff::SourceTextKeyDown`, `textS.cpp:262-386`)

The handler is one `if / else if` chain, evaluated in this order. "Swallowed" means
`Key = 0`, so the edit control never sees the key.

| Order | Condition | Action |
|---|---|---|
| 1 | Backspace with exactly Ctrl | swallowed (`textS.cpp:286-287`) |
| 2 | Delete with exactly Ctrl | swallowed (`288-289`) |
| 3 | `E` with exactly Ctrl | swallowed (`290-291`) |
| 4 | F1 (any modifiers) | context help, section 15.3 (`294-312`) |
| 5 | F3 and the Find dialog's text is non-empty | `Main->FindNext()` (`315-316`). In practice the menu shortcut of 2.2 fires first; the effect is the same. |
| 6 | Insert with exactly Shift | swallowed, then `Main->EditPaste1Execute` = plain-text paste (`319-322`) |
| 7 | Insert with any other modifier state | `InsertMode = !InsertMode` (status-bar indicator, section 8.6) (`325-326`) |
| 8 | Tab (any modifiers) while `realTabs` is false | swallowed; spaces are inserted, section 8.2 (`329-350`) |
| 9 | key code 190 (`.`/`>` key) with exactly Ctrl+Shift | `indentSelection()`; swallowed (`353-355`) |
| 10 | key code 188 (`,`/`<` key) with exactly Ctrl+Shift | `outdentSelection()`; swallowed (`358-360`) |
| 11 | Enter (any modifiers) | if `autoIndent`: remember the leading white space of the current line, section 8.4 (`363-375`). The key is **not** swallowed. |
| 12 | any other key while the modifier state is exactly Ctrl+Shift | swallowed: `else if (Shift == ctrlShift) Key = 0;  // prevent RichEdit stuff` (`376-377`) |

After the chain, `UpdateStatusBar()` runs (`382`).

Consequences worth knowing:

* QUIRK: rule 12 also swallows Ctrl+Shift+Left/Right/Home/End, so word-wise and
  to-document-end selection with the keyboard does not work in the original editor.
* QUIRK: rule 7 fires for Ctrl+Insert (which the edit control treats as Copy), so the
  status bar flips between `Insert` and `Replace` although the control's real
  insert/overtype state did not change.
* Rule 8 has no Shift test: **Shift+Tab behaves exactly like Tab**.
* The key codes are constants `KEY_LT = 188`, `KEY_GT = 190` (`textS.cpp:27-28`). On a US
  keyboard Ctrl+Shift+`.` is "Ctrl+>" and Ctrl+Shift+`,` is "Ctrl+<", which is how the help
  describes them (`BasicOperation.htm`: "Ctrl+> - Inserts a space at the start of each
  selected line. Ctrl+< - Removes one space from the start of each selected line.").

`SourceTextKeyPress` (`textS.cpp:407-416`) additionally discards the Tab *character* when
`realTabs` is false, and `SourceTextKeyUp` (`390-403`) performs the auto-indent.

All other keys (arrows, Home/End, PgUp/PgDn, Ctrl+Left/Right, Ctrl+Home/End, Shift+arrows,
Backspace, Delete, printable characters) have the standard behaviour of a Windows
multi-line edit control. Native RichEdit undo is unavailable because the control's own
undo buffer is cleared after every change (`SourceText->ClearUndo()`, `textS.cpp:1860`).

### 5.3 Keys in dialogs

| Where | Key | Effect |
|---|---|---|
| Editor Options dialog | F1 | `Main->displayHelp("EDIT_OPTIONS")` (`editorOptions.cpp:259-265`) |
| Assembler Options dialog | F1 | `Main->displayHelp("EDIT_OPTIONS")` (`optionsS.cpp:984-989`) |
| Find dialog | Enter | default button `Find  (F3)` when the text box is non-empty |
| Replace dialog | Enter | three buttons (`Find Next`, `Replace`, `Replace All`) are all marked `Default = True` in `replaceDialogS.dfm:90, 110, 121`; a focused button wins. UNVERIFIED which one acts when a text box has the focus (the code re-asserts `findNextBtn->Default = true` whenever the find text changes, `replaceDialogS.cpp:36`) |
| About box | B then M then W | Easter egg, section 15.4 |
| About box, Editor Options | Enter | default button `OK` |

---

## 6. Documents: MDI windows, open, save, reload, close

### 6.1 One document = one MDI child window (`TTextStuff`)

Every open file is an instance of `TTextStuff` (`textS.h:54-159`, `textS.dfm`), an MDI
child (`FormStyle = fsMDIChild`, `Position = poDefault`, `Visible = True`,
`textS.dfm:13, 50-51`). Any number may be open. The child's title bar shows the file name
without its folder. No "modified" marker is added to the title; the modified state is
shown only in the child's status bar.

Per-document state (`struct FileInfo`, `textS.h:31-42`, held in `TTextStuff::Project`):

| Field | Meaning |
|---|---|
| `AnsiString CurrentFile` | Full path of the file, or `untitledN.x68` (no folder) for a never-saved document |
| `int TabType` | `0` = Assembly tabs, `1` = Fixed tabs (`enum tabTypes{ Assembly, Fixed }`, `asm.h:234`) |
| `int TabSize` | Fixed tab size in characters |
| `bool Modified` | Copy of the edit control's modified flag, refreshed by `UpdateStatusBar` |
| `bool IsSource` | `true` for a source document (syntax-highlighted, gets the font/tab trailer on save); `false` for a list document |
| `bool HasName` | `false` until the document has been loaded from or saved to a real file |
| `bool CreateList`, `bool ListOpen` | Set or declared but never read - DEAD |

Also per document: the font name and size of the editor (`SourceText->Font`), the
`InsertMode` flag (`textS.h:144`), and the undo and redo stacks (`textS.h:156-157`).

Window placement: (VCL/Windows) a new child gets the default cascaded position and size
chosen by Windows; while the current child is maximised, newly created children are
maximised too. Whether the active child is maximised when the program exits is saved as
`$maximized edit` and applied to the first window at the next start (`mainS.cpp:745-748`,
`optionsS.cpp:137-143`). Child positions and sizes, the list of open files and the caret
positions are **not** remembered between runs.

Global, shared by all documents: `autoIndent`, `realTabs`, the eight syntax styles,
`backColor`, `highlightDisabled` (`GLOBALS.CPP:70-82`, `textS.cpp:32`).

### 6.2 Open (`TMain::mnuOpenClick`, `mainS.cpp:312-319`; `TMain::OpenFile`, `271-308`)

The dialog title is set to `Open File`. Single selection only (default dialog options).
`DefaultExt = '*.X68'`. Filter (`mainS.dfm:223-231`), first entry preselected:

```
EASy68K Source  [.X68]      *.X68
68K Source  [.ASM] [.M68]   *.ASM;*.M68
EASy68K Listing  [.L68]     *.L68
68K S Record  [.S68]        *.S68
Any File  [*.*]             *.*
```

`OpenFile(name)`:

1. If the file does not exist: error box
   `File Access Error.  Please verify the file name and that you have the proper permissions to open the file.`
   (OK) and stop.
2. For every open edit window whose `Project.CurrentFile` is **exactly equal** (case-sensitive
   string compare) to `name`:
   * if that window is modified, ask (Yes/No, confirmation icon)
     `<file name> is already open. Do you want to discard changes and reopen?`
     - No: bring that window to the front and stop.
   * otherwise, or on Yes: clear its modified flags and close it.
3. Create a new `TTextStuff` and call `LoadFile(name)`.

So re-opening an already open file replaces the old window with a freshly loaded one.

### 6.3 `TTextStuff::LoadFile` (`textS.cpp:107-206`)

The extension is upper-cased. The document type is decided by one test
(`textS.cpp:121`):

```cpp
if(ext != ".L68" && ext != ".S68") //setup a source window
```

**Source document** (every extension other than `.L68` and `.S68`, including "Any File"):

1. `NewProject("Source")` (section 2.7), `CurrentFile = name`, `HasName = true`.
2. The whole file is loaded into the editor as plain text (section 6.7).
3. Defaults taken from the Editor Options dialog controls: tab type (Assembly if the
   `Assembly Tabs` radio button is checked, else Fixed), tab size (`FixedTabSize->Value`),
   font name and size (`cbFont->Text`, `cbSize->Text`) (`textS.cpp:131-137`).
4. **Font/tab trailer.** The last lines of the file are inspected (`textS.cpp:140-173`):

   ```cpp
   int count = SourceText->Lines->Count;
   for (cnt=count; cnt>count-5; cnt--) {
     str = SourceText->Lines->Strings[cnt];
     if (str.SubString(1,11) == "*~Tab size~") { ... Project.TabSize = atoi(temp); SourceText->Lines->Delete(cnt); }
     else if(str.SubString(1,11) == "*~Tab type~") { if(str.SubString(12,1) == '0') Project.TabType = Assembly; else Project.TabType = Fixed; SourceText->Lines->Delete(cnt); }
     else if(str.SubString(1,12) == "*~Font size~") { ... SourceText->Font->Size = atoi(temp); SourceText->Lines->Delete(cnt); }
     else if(str.SubString(1,12) == "*~Font name~") { ... SourceText->Font->Name = temp; SourceText->Lines->Delete(cnt); }
   }
   ```

   * Indexes `count`, `count-1`, ..., `count-4` are examined; index `count` is past the end
     and yields an empty string, so effectively **the last four lines** are examined
     ((VCL) `Lines->Count` does not count the empty line after a final line break).
   * Each of the four lines is tested independently, in any order, and each matching line
     is **removed from the editor text**. Lines that do not match are left alone.
   * `*~Tab size~`: the characters at 1-based positions 12 and 13 up to a `~` are parsed
     with `atoi` (at most two digits).
   * `*~Tab type~`: character 12 `'0'` -> Assembly; anything else -> Fixed.
   * `*~Font size~`: characters 13 and 14 up to a `~` (at most two digits).
   * `*~Font name~`: characters from 13 up to the next `~`, any length (copied into an
     80-byte buffer without a bounds check). Any font name is accepted, not only the three
     offered in the options dialog.
5. `SetTabsAll()` applies the tab stops; the window caption becomes the file name.

**List document** (`.L68` or `.S68`): `NewProject("List")`, `CurrentFile = name`,
`HasName = true`, load the file, caption = file name. No trailer processing, no tab-stop
set-up, no syntax highlighting. `Project.TabType`/`TabSize` keep their zero initial
values. The font is the Editor Options font (set in `NewProject`, `textS.cpp:826-827`).
The text is **editable** (the read-only line is commented out, `textS.cpp:865`).

For both types: all text is marked protected (an internal device for undo capture), the
caret goes to the start, the modified flags are cleared, `colorHighlight(0, Lines->Count)`
is requested (it does nothing for list documents). A failure anywhere shows
`Error in LoadFile()`.

### 6.4 Save and Save As

**Save** (`TMain::mnuSaveClick`, `mainS.cpp:217-235`), acting on the active window:

* If `Project.HasName`: write the editor text to `Project.CurrentFile`
  (`SourceText->Lines->SaveToFile`), call `SaveFont`, clear the modified flag, refresh the
  status bar. No confirmation, no backup file.
* Otherwise: run Save As.

**Save As** (`TMain::mnuSaveAsClick`, `mainS.cpp:176-213`):

* If the document has a name, the dialog is preloaded with the current path.
* Save dialog: `DefaultExt = '*.X68'`, filter (`mainS.dfm:232-237`):

  ```
  68K Source File  [.X68]   *.X68
  Any File  [*.*]           *.*
  ```

  UNVERIFIED: the exact extension Windows appends when the user types a name without one
  (the `DefaultExt` value `*.X68` is malformed - it should be `X68`). The help says the
  default extension is `.x68`. Recommended port behaviour: append `.X68` when the first
  filter is selected and the typed name has no extension.
* If the chosen file exists: message box titled `Caution!` with text
  `File exists! OK to overwrite?` and Yes/No. No = abandon the save (the dialog is not
  shown again).
* `Project.CurrentFile = SaveDialog->FileName`.
* Document type update (`mainS.cpp:190-201`):

  ```cpp
  AnsiString ext = ExtractFileExt(SaveDialog->FileName);
  ...
  if(ext == ".X68") { Active->Project.IsSource = true; }
  else if(ext == "*.*") { Active->Project.IsSource = false; }
  ```

  The comparison is case-sensitive, so only an extension spelled exactly `.X68` turns a
  list document into a source document; the second branch can never be true. In all other
  cases `IsSource` keeps its previous value.
* Write the text, call `SaveFont`, clear the modified flag, refresh the status bar, set
  the window caption to the new file name, `HasName = true`.

QUIRK: if the user cancels the Save As dialog, nothing happens and no error is reported -
callers (auto-save before assemble, the close prompt) carry on as if the save had worked.

A failure to write the file is not handled by this code: (VCL) the framework shows its
standard exception message, the rest of the handler is skipped and the document stays
marked as modified.

**`SaveFont`** (`mainS.cpp:239-260`) - the font/tab trailer:

```cpp
if (active->Project.IsSource) {
  AnsiString ext = UpperCase(ExtractFileExt(active->Project.CurrentFile));
  if (ext == ".X68") {              // if .X68 file
    file.open(active->Project.CurrentFile.c_str(), ios::app | ios::out);  //open source file for append
    file << "\n"
         << "*~Font name~" << active->SourceText->Font->Name.c_str() << "~\n"
         << "*~Font size~" << active->SourceText->Font->Size         << "~\n"
         << "*~Tab type~"  << active->Project.TabType                << "~\n"
         << "*~Tab size~"  << active->Project.TabSize                << "~\n";
    file.close();
  }
}
```

* Only for source documents whose extension is `.X68` in any letter case. A source saved
  as `.ASM`, `.TXT`, etc. gets no trailer.
* The stream is in text mode, so every `\n` is written as CR LF.
* Result on disk (typical): the editor text, one line break, then

  ```
  *~Font name~Courier New~
  *~Font size~10~
  *~Tab type~1~
  *~Tab size~4~
  ```

  each line ending in CR LF. Every shipped example ends this way
  (`official-extracted\Examples\*.X68`).
* The trailer lines start with `*`, so any assembler treats them as comments.

QUIRK (emergent, VCL-dependent): the single `"\n"` written before the trailer stays in the
document when the file is loaded again (only the four trailer lines are deleted). Each
open-then-save cycle therefore adds one empty line to the end of the document. The shipped
examples show the effect: they have two to four empty lines between the last source line
and the trailer.

### 6.5 Reload File (`TTextStuff::EditorReload1Click`, `textS.cpp:995-1017`)

Only on the editor context menu. If the document is modified and has a name, ask (Yes/No)
`<file name> is modified. Do you want to discard changes and reopen?`; No = stop. If the
document has a name, `LoadFile(Project.CurrentFile)` reloads it into the **same** window
(undo history is cleared, trailer is re-read). A never-saved document: nothing happens.
(`TMain::Reload1Click`, `mainS.cpp:891-895`, forwards to it but no menu item uses it - DEAD.)

### 6.6 Closing a document and the save prompt (`TTextStuff::FormCloseQuery`, `textS.cpp:923-955`; `FormClose`, `660-705`)

Triggered by `File | Close File`, the child's close button, or program exit.

1. `UpdateStatusBar()` refreshes `Project.Modified`.
2. If modified, a confirmation box with Yes / No / Cancel:
   `File modified, do you wish to save '<file name>' before closing?`
   * Yes: `Main->mnuSaveClick(Sender)` then close.
   * No: close without saving.
   * Cancel: do not close (and abort program exit).
3. On close: decrement `iSourceOpen` or `iListsOpen`, update menu state (section 2.7),
   clear the undo/redo stacks, free the window.

QUIRKS:

* `mnuSaveClick` always saves the **active** MDI child, not necessarily the child that is
  asking. During program exit with several modified documents, answering Yes for a
  background document saves the active one instead.
* If Yes leads to a Save As dialog and the user cancels it, the window still closes and
  the changes are lost.

The form `ChkSave` ("Save source file?" / "Source has been modified. Save before
exiting?", `chksaveS.cpp:22-26`) is created at start-up but never shown - DEAD.

### 6.7 Encoding and line endings

* **Reading**: `SourceText->Lines->LoadFromFile` with `PlainText = True`
  (`textS.dfm:151`). (VCL) The bytes are streamed into the control as plain text in the
  system ANSI code page (Windows-1252 on a western-European/US system). No byte-order-mark
  or UTF-8 detection exists. CR LF is a line break. UNVERIFIED: how a file with bare LF
  line endings is displayed by the RichEdit 1.0-class control.
* **Writing**: `Lines->SaveToFile`. (VCL) Plain text, same ANSI code page, CR LF line
  breaks, no byte-order mark; a line break after the last line is written only if the text
  itself ends with one. `SaveFont` then appends the trailer in text mode (CR LF).
* **Tabs** are never converted on load or save. Tab characters in a file stay tab
  characters; spaces stay spaces. (The source-tree `template.NEW` contains real tab
  characters; the shipped one uses spaces - section 12.)
* The same plain-text save is used to hand the text to the assembler (section 10.2), so
  the assembler receives exactly the bytes of the document, **without** the trailer.

### 6.8 Names of new documents

`NewProject("Source")` (`textS.cpp:835-836`):

```cpp
Main->iNewFiles++; // increment count for new "untitled" documents
Project.CurrentFile = "untitled"  + IntToStr(Main->iNewFiles) + ".x68";
```

The first new document is `untitled1.x68` (lower-case extension, no folder).
QUIRK: the counter is also incremented when an existing file is opened or reloaded (the
same function runs first), so the numbers skip: start-up document `untitled1.x68`, open a
file, `File | New` -> `untitled3.x68`.

---

## 7. The edit window

### 7.1 Layout (`textS.dfm:59-167`), top to bottom

1. `SourceText` - the editor, fills the remaining area. Plain text, no word wrap,
   horizontal and vertical scroll bars, selection stays visible when focus is elsewhere
   (`HideSelection = False`), Tab is accepted as input (`WantTabs = True`)
   (`textS.dfm:136-167`). Background colour = `backColor` (`textS.cpp:78`).
2. `ProgressBar` - `Visible = False` and never shown by any code - DEAD.
3. `StatusBar` - fixed height 19 px, five panels (7.2).
4. `Splitter3` - a 9 px horizontal splitter the user can drag to resize the message list.
5. `Messages` - the assembler message list (7.3), at the very bottom.

There is no line-number gutter and no ruler. The original editor also has no word wrap,
bracket matching, auto-completion, code folding, zoom, multiple cursors, column selection
or split view; none of these should be assumed.

### 7.2 Status bar (`textS.dfm:68-96`; `TTextStuff::UpdateStatusBar`, `textS.cpp:209-259`)

| Panel | Width | Content |
|---|---|---|
| 0 | 90 | `<line>: <column>` - e.g. `1: 1`. Exactly `IntToStr(CurPos.y + 1) + ": " + IntToStr(col + 1)` |
| 1 | 60 | `Modified` when the document has unsaved changes, otherwise empty. The text `SYNTAX` is written here if the highlighter throws an exception (`textS.cpp:1232, 1488, 1568, 1596`) and stays until the next status refresh |
| 2 | 50 | `Insert` or `Replace` (`InsertMode` true/false) |
| 3 | 50 | always empty (cleared after each highlight pass, `textS.cpp:1208`; nothing ever writes text to it) |
| 4 | rest | constant design-time text: 64 underscore characters followed by `^` (`textS.dfm:89-93`). Never changed by code. Purpose not documented; it looks like a rough right-margin marker. |

`UpdateStatusBar` runs after every key down, key press, key up, mouse down, mouse up, text
change, window show, save, undo-to-empty, and options change.

**Line** is the 1-based index of the line containing the caret (the end of the selection
when there is one).

**Column** is a *visual* column that expands tab characters (`textS.cpp:212-239`):

```cpp
int tabSize = EditorOptionsForm->FixedTabSize->Value;
...
col=0;
int t=1;
for (int i=1; i <= CurPos.x && i<=str.Length(); i++) {
  if (str[i] == '\t') {         // if tab
    if (Project.TabType == Assembly) {
      switch(t) {
        case 1: tabSize = TAB1; break;
        case 2: tabSize = TAB2; break;
        case 3: tabSize = TAB3; break;
        default: tabSize = EditorOptionsForm->FixedTabSize->Value;
      }
    }
    col += tabSize - col%tabSize;
    t++;
    if (t > TABCOUNT)
      t = TABCOUNT;
  } else
    col++;
}
```

with `TAB1 = 12`, `TAB2 = 20`, `TAB3 = 44` (`asm.h:236-238`) and `TABCOUNT = 20`
(`textS.cpp:26`). In words: ordinary characters advance one column; with Fixed tabs every
tab advances to the next multiple of the tab size; with Assembly tabs the *first* tab
character on the line advances to the next multiple of 12, the *second* to the next
multiple of 20, the *third* to the next multiple of 44, and later ones to the next
multiple of the tab size.

QUIRKS: (a) the tab size used here is the **global** value in the Editor Options dialog,
not the document's own `Project.TabSize`; (b) the Assembly rule counts tab characters, not
positions, so it disagrees with the on-screen tab stops when a tab is typed past column 12;
(c) `col` is a single global variable shared by all windows (`textS.cpp:30`) and is the
value the Tab key uses (section 8.2).

### 7.3 Message list (`Messages`, `textS.dfm:97-124`)

* Report-style list with grid lines and full-row selection; read-only; column headers are
  not clickable. Columns: `Line ` (note the trailing space; default width 50) and
  `Error Message` (auto-sized to the remaining width).
* Tool-tip: `double click error to highlight in source`.
* Initial state: disabled, height 5 px (minimum 5), i.e. effectively collapsed.
* Filled by the assembler's `printError` (`ERROR.CPP:274-288`) for every error and every
  displayed warning: the list is enabled, its height is raised to at least 87 px, and one
  row is added:

  ```cpp
  ListItem->Caption = lineNum;        // display line number of error
  buffer[strlen(buffer)-1]='\0';      // trim off '\n'
  ListItem->SubItems->Add(buffer);    // add error message to edit window
  ListItem->SubItems->Add(Active->Project.CurrentFile);       // display file
  ```

  Column 1 = source line number (decimal). Column 2 = the message text, which already
  starts with `ERROR: ` or `WARNING: ` (for example `ERROR: Invalid opcode`,
  `WARNING: END directive missing, starting address not set`; full list in `ERROR.CPP:59-238`).
  The third value (the file path) has no column and is not visible.
* Rows appear in the order the assembler reports them (pass 2, source order). No sorting.
* **Double-click** (`TTextStuff::MessagesDblClick`, `textS.cpp:719-738`): take the line
  number of the focused row, select that whole line in the editor (from its first
  character to just before its line break) and give the editor the focus; the status bar is
  refreshed. QUIRK: for the last line of a document that has no final line break the last
  character is left out of the selection (`LineSelection.cpMax = End - 1`).
* Cleared at the start of every assemble (`mainS.cpp:355`); collapsed to 7 px when an
  assemble finishes with zero errors and zero warnings (`ASSEMBLE.CPP:210-213`); cleared and
  collapsed by the context-menu command of section 4.2.
* Messages that belong to an `INCLUDE`d file go to that file's edit window - see 10.5.

---

## 8. Editing behaviour

### 8.1 Tab model

Two independent settings:

| Setting | Scope | Values | Where set |
|---|---|---|---|
| Tab type | per document (`Project.TabType`) | Assembly (0) or Fixed (1) | Editor Options radio buttons; file trailer |
| Fixed tab size | per document (`Project.TabSize`) | integer, normally 4-20 | Editor Options spin box; file trailer |
| Real Tabs | global (`realTabs`) | on/off, default off | Editor Options check box |

Assembly tab stops are the fixed character columns (0-based) **12, 20 and 44**
(`asm.h:236-238`: `TAB1 = 12`, `TAB2 = 20`, `TAB3 = 44`), i.e. label field at column 0,
opcode at 12, operand at 20, comment at 44 (1-based: 13, 21, 45).

The spaces-for-a-tab rule used in three places (Tab key `textS.cpp:334-344`, printing
`498-534`, and the assembler listing `LISTING.CPP:132-150`) is, with `x` the 0-based
column:

```cpp
if (Project.TabType == Assembly) {
  if (x <= TAB1)       t = TAB1 - x;
  else if (x <= TAB2)  t = TAB2 - x;
  else                 t = TAB3 - x;
} else {                      // else fixed tabs
  t = Project.TabSize - (x % Project.TabSize);
}
```

Note the `<=`: with Assembly tabs `t` is **0** when `x` is exactly 12 or 20, and `t` is
zero or negative when `x >= 44`; in those cases no space is produced.

### 8.2 The Tab key

**Real Tabs off (default)** - `textS.cpp:329-350`:

```cpp
} else if(Key == VK_TAB && !realTabs) {
  Key = 0;    // null out the key code to prevent further processing
  TPoint CurPos2 = SourceText->CaretPos; //store position of cursor
  str = SourceText->Lines->Strings[CurPos2.y];
  // replace tab with spaces
  int j=col, k, t;
  ... (rule of 8.1 with x = j) ...
  for (k=0; k<t; k++) {       // replace with spaces
    str.Insert(" ",CurPos2.x+1);
    CurPos2.x++;
  }
  SourceText->Lines->Strings[CurPos2.y] = str;
  SourceText->CaretPos = CurPos2;
```

* `t` space characters are inserted at the caret and the caret moves after them. No tab
  character is ever stored.
* `j` is the status-bar column of 7.2 (0-based).
* Fixed tabs: always inserts between 1 and `TabSize` spaces, to the next multiple of
  `TabSize`.
* Assembly tabs: from column 0-11 to column 12; from 13-19 to column 20; from 21-43 to
  column 44. QUIRK: at column exactly 12 or 20, and at any column >= 44, **Tab inserts
  nothing**.
* **With a selection**: the selection is neither deleted nor indented. The spaces go in at
  the selection's end position and the selection is dropped. There is no block indent on
  Tab.
* **Shift+Tab**: identical to Tab (5.2 rule 8).
* The whole line is rewritten, so one Tab press is one undo step that restores the line.
* A document whose `TabSize` is 0 (possible only through a hand-edited trailer) makes the
  modulo fail; the exception is swallowed and Tab does nothing.

**Real Tabs on**: the key is passed to the edit control, which (VCL) replaces the
selection, if any, with one tab character (code 9). UNVERIFIED: Shift+Tab in this mode
(expected: also a tab character).

Existing tab characters (from files or pasted text) are displayed and kept in both modes.

### 8.3 Display of tab characters (`TTextStuff::SetTabs`, `textS.cpp:437-492`)

Twenty tab stops are set on the paragraphs (`TABCOUNT = 20`). In character columns:

* Fixed: stops at `TabSize, 2*TabSize, ..., 20*TabSize` (`TabSize <= 0` is treated as 8).
* Assembly: the first three stops are replaced by columns 12, 20 and 44; the remaining
  entries stay at `4*TabSize ... 20*TabSize`, of which only those beyond column 44 matter
  (UNVERIFIED: how the control treats the entries that are now out of ascending order).
* Beyond the 20th stop the control's default tab stops apply (UNVERIFIED spacing).

The original converts columns to printer points with a per-font table
(`textS.cpp:449-470`); a port with a true monospace font only needs the column rule. For
reference, points per character: Courier New 8 and 9 pt -> 5.25, 10 -> 6, 11 -> 6.75,
12 -> 7.5, 14 -> 8.25, 16 -> 9.75, 18 -> 10.5; Courier 10 -> 6, 12 -> 6.75, 15 -> 9; any other
font ("Fixed System") 9 -> 6, 18 -> 12; any combination not listed -> a flat 60 points per
stop regardless of tab size. The products are truncated to integers, so some sizes are
slightly misaligned in the original.

`SetTabs` is applied to the whole document on load and new, to pasted text after a paste,
and to the whole active document when Editor Options is confirmed.

### 8.4 Enter and auto-indent

Global option `autoIndent` (default on).

* Key down (`textS.cpp:363-375`): the leading white space (spaces and/or tabs, as they
  are) of the line the caret is on is copied to `leadStr`. The whole line's leading white
  space is used regardless of where in the line the caret is.
* The edit control then inserts the line break normally (splitting the line at the caret,
  replacing a selection if there is one).
* Key up (`textS.cpp:395-399`):

  ```cpp
  if (Key == VK_RETURN && autoIndent) {
    str = SourceText->Lines->Strings[CurPos.y];
    if (str.Length() == 0)             // if new line is empty
      SourceText->Lines->Strings[CurPos.y] = leadStr; // start with leading whitespace from above
  }
  ```

  If the line the caret is now on is **empty**, it is filled with the remembered white
  space and the caret ends up after it. If Enter split a line so that text moved down to
  the new line, nothing is added.
* The indentation is a separate text change, hence a separate undo step.
* With `autoIndent` off, Enter just inserts a line break.

### 8.5 Comment, uncomment, indent, outdent

| Command | Inserted / removed string | Code |
|---|---|---|
| Comment Selection (Ctrl+Alt+C) | insert `*` | `commentSelection`, `textS.cpp:539-542` |
| Uncomment Selection (Ctrl+Alt+U) | remove `*` | `unCommentSelection`, `546-549` |
| Indent (Ctrl+Shift+`.`) | insert one space | `indentSelection`, `553-556` |
| Outdent (Ctrl+Shift+`,`) | remove one space | `outdentSelection`, `560-563` |

Indent and outdent have no menu item and no toolbar button; they move by **one space**,
never by a tab stop.

Affected lines (`insertInSelection`, `textS.cpp:617-657`; `deleteFromSelection`, `568-613`):

```cpp
startLine = SourceText->Perform(EM_LINEFROMCHAR, startSave, 0);
endLine = SourceText->Perform(EM_LINEFROMCHAR, startSave + lengthSave - 1, 0);
```

from the line containing the selection start to the line containing the **last selected
character**. A selection that ends at the very beginning of a line does not include that
line.

* Insert: the string is inserted at column 0 of every affected line, unconditionally (a
  line that is already a comment gets a second `*`).
* Remove: on each affected line, the first character is deleted only if it equals the
  string (`if (str.SubString(1,1) == dstr)`). Only a `*` or space in column 0 counts; a `;`
  comment or an indented `*` is not touched. One character per invocation.
* Afterwards the selection starts at the same character offset as before and its length
  is adjusted by the number of characters added or removed.
* One undo step per command.

QUIRKS:

* No selection, caret at column 0 of any line except the first: `endLine` is the previous
  line, so the loop does not run and **nothing happens**. No selection with the caret
  elsewhere in a line: that one line is processed.
* The undo record stores the old *selected text* and the new selection range. When the
  selection did not start at column 0 (or there was no selection), undoing the command
  does not restore the text correctly (the first inserted character stays and one
  neighbouring character is lost). The port should implement a correct undo instead.

### 8.6 Insert / overwrite

The Insert key toggles the edit control's native overtype mode (VCL) and the per-window
flag `InsertMode` (initially `true`, `textS.cpp:75`), which drives status-bar panel 2
(`Insert` / `Replace`). Shift+Insert is Paste and does not toggle.

QUIRK: text typed in overtype mode is not recorded for undo (the change handler returns
early when the text length is unchanged: `if (SourceText->SelLength > 0 || sizeDiff == 0)
// if RichEdit bug  return;`, `textS.cpp:1866-1867`).

### 8.7 Clipboard

* **Cut / Copy** - standard edit-control operations on whichever text control has focus
  (the editor or a dialog text box). Cut is one undo step.
* **Paste** (`TMain::EditPaste1Execute`, `mainS.cpp:821-854`): does nothing unless the
  clipboard holds plain text. Then:
  * if the active edit window's editor has focus: the clipboard is pasted **as unformatted
    text** (`EM_PASTESPECIAL` with `CF_TEXT`), replacing the selection; the pasted range is
    given the document's tab stops (`SetTabs`); the caret ends after the pasted text. Tab
    characters in the pasted text are kept as tabs even when Real Tabs is off;
  * else if the Find dialog's text box has focus: its **entire** content is replaced by the
    clipboard text;
  * else if the Replace dialog's "Find what" or "Replace with" box has focus: that box's
    entire content is replaced by the clipboard text.
* **Select All** - selects all text of the focused text control.

### 8.8 Mouse

* Click, drag-select, double-click word select: standard edit-control behaviour; the
  status bar is updated on mouse down and up (`textS.cpp:765-788`).
* **Drag-and-drop of selected text inside the editor** (move) is provided by the control
  (VCL) and is tracked for undo with the flags `mouseDrag`/`mouseDragging`
  (`textS.cpp:31, 1810-1815, 1825-1840, 1889-1894`); one drag produces two undo steps
  (the removal and the insertion).
* **Dropping files from Explorer** opens them (section 1.4).
* `SourceTextSelectionChange` (`textS.cpp:965-992`) is a work-around for a RichEdit
  selection glitch around consecutive empty lines; it has no counterpart in a port.

### 8.9 Undo and redo

Implemented by the application, not by the edit control (`textS.cpp:1601-1927`).

* **Depth**: unlimited. Two per-window stacks `undoS` and `redoS`
  (`stack<UndoRedo,vector<UndoRedo> >`, `textS.h:156-157`) grow until memory runs out, at
  which point the warning `Undo/Redo limit reached. File save recommended.` is shown
  (`textS.cpp:1642, 1658`). (`undo.h` defines `UNDO_LIMIT = 10000`, but that file is DEAD.)
* **Record** (`struct UndoRedo`, `textS.h:45-50`): `start` (character offset), `length`
  (length of the text that the change put there), `str` (the text that was there before).
  Undo = select `[start, start+length)` and replace it with `str`.
* **Granularity** - one record per change notification from the edit control:
  * each typed character (including each Enter) is its own step;
  * each Backspace or Delete press is its own step (one character, or one CR LF pair);
  * typing or pasting over a selection, Cut, Paste, a Find/Replace replacement, the
    auto-indent fill, a Tab press in spaces mode (whole line), and each
    comment/uncomment/indent/outdent command are one step each;
  * `Replace All` creates one step per replacement;
  * a mouse drag-move creates two steps.
  There is no grouping of consecutive typing into words.
* **Undo** (`TTextStuff::Undo`, `textS.cpp:1691-1725`): pops one record, builds the inverse
  record, applies it, pushes the inverse on the redo stack. When the undo stack becomes
  empty the document is marked **not modified** (`SourceText->Modified = false;  //
  document restored to original`) and Undo is disabled.
* **Redo** (`TTextStuff::Redo`, `textS.cpp:1729-1760`): the mirror image; pushes back onto
  the undo stack.
* After undo/redo the caret sits at the end of the restored text and the affected lines
  are re-highlighted.
* **Stacks are cleared** when a document is created or loaded/reloaded
  (`NewProject` -> `clearUndoRedo`, `textS.cpp:830`) and when the window closes. They are
  **not** cleared by Save.
* **Enabled state**: the single global actions `EditUndo`/`EditRedo` are enabled when a
  record is pushed, disabled when a stack empties, and re-evaluated from the window's own
  stacks whenever an edit window is activated (`FormActivate`, `textS.cpp:1912-1927`).

QUIRKS:

* The redo stack is discarded on a new edit only if the undo stack is empty at that moment
  (`if(notRedo && undoS.empty()) clearRedo();`, `textS.cpp:1628-1629`). After "undo some,
  then type", Redo stays enabled and re-applies stale records at stale offsets.
* Because Save does not touch the stacks, undoing back to the first record after a save
  shows the document as unmodified although it now differs from the file on disk.
* Overtype typing is not undoable (8.6); comment/indent undo can corrupt text (8.5).

---

## 9. Syntax highlighting

### 9.1 When it runs

* Only for source documents (`if (!Project.IsSource) return;`, `textS.cpp:1056`) and only
  while `highlightDisabled` is false (`1054`).
* Requests are debounced through `HighlightTimer` (interval **400 ms**, `textS.dfm:217-223`);
  a key press restarts a pending timer (`textS.cpp:271-274`), so colouring happens 400 ms
  after the last key stroke.
* Only the lines currently visible in the window are coloured (`colorHighlight`,
  `textS.cpp:1051-1082`); scrolling and resizing request a new pass
  (`SourceTextVertScroll` `1032-1036`, `FormResize` `1039-1043`).
* Passes are requested after: load (`195`), new file (`910`), every recorded edit for the
  changed lines (`1634-1639`), any replacement of a selection (`1898`), undo/redo
  (`1794-1796`), and Editor Options OK with a style change (`editorOptions.cpp:145`).
* A pass preserves the selection, the scroll position and the modified flag
  (`textS.cpp:1099-1124, 1211-1224`).

The debounce and the visible-lines restriction are performance devices. The result for a
line depends **only on that line's text**, on the global styles, and on the assembler
option "Assemble Bit Field Instructions". There is no state carried from one line to the
next. A port may colour every line immediately as long as each line gets the styles
defined below.

### 9.2 Style elements and defaults

A style is `{ TColor color; bool bold; bool italic; bool underline; }` (`FontStyle`,
`asm.h:243-249`). Defaults are set in `TOptions::defaultSettings` (`optionsS.cpp:940-973`)
from constants in `asm.h:251-259`. All defaults have bold, italic and underline **off**.

| Element name in the options dialog | Variable | Default colour (VCL name) | RGB hex | Value stored in `settings.dat` |
|---|---|---|---|---|
| Code | `codeStyle` | `clBlack` | `#000000` | 0 |
| Comment | `commentStyle` | `clBlue` | `#0000FF` | 16711680 |
| Directive | `directiveStyle` | `clGreen` | `#008000` | 32768 |
| Label | `labelStyle` | `clPurple` | `#800080` | 8388736 |
| Macro/Other | `unknownStyle` | `clOlive` | `#808000` | 32896 |
| Structured | `structureStyle` | `clMaroon` | `#800000` | 128 |
| Structure Error | `errorStyle` | `clRed` | `#FF0000` | 255 |
| Text | `textStyle` | `clTeal` | `#008080` | 8421376 |
| Background | `backColor` | `clWhite` | `#FFFFFF` | 16777215 |

Stored colour values are Windows `COLORREF` integers, i.e. `0x00BBGGRR` written in decimal.

What the elements mean in practice:

* **Code** - everything not claimed by another element: opcode mnemonics, size suffixes,
  all operands, registers, numbers, symbols. There is **no** separate style for numbers,
  registers or operands.
* **Comment** - comment lines and the remainder of a line after the operand field.
* **Directive** - the directive mnemonic including its `.size` suffix.
* **Label** - the label field.
* **Macro/Other** - the operation field and everything after it when the operation is not
  a known opcode, directive or structured keyword (this is how macro calls appear).
* **Structured** - a syntactically accepted structured-assembly statement.
* **Structure Error** - a structured statement that fails the check, or an operand with an
  unclosed quote or parenthesis.
* **Text** - a quoted string inside an operand field, quotes included.

### 9.3 Per-line algorithm (`TTextStuff::HighlightTimerTimer`, `textS.cpp:1144-1206`)

The whole range is first painted in the Code style (`1131-1142`). Then, for each line:

1. `capLine` = the line converted by `strcap` (`ASSEMBLE.CPP:233-258`): every character is
   upper-cased **except** characters between single quotes (a flag toggles at each `'`).
   Double quotes do not toggle. All matching below is therefore case-insensitive.
2. `p = start =` first non-white-space character. Empty or blank line: done.
3. **Comment line** (`1153-1158`):

   ```cpp
   if (*p == '*' || *p == ';') {             // if comment line
     SourceText->SelStart = lineStart;
     SourceText->SelLength = GetLastPos(ln) - lineStart;
     setFontStyle(commentStyle);
     continue;
   }
   ```

   The test is on the first **non-blank** character, not on column one: an indented `*` or
   `;` also makes the whole line (from column 0) a comment.
4. **Label** (`1160-1174`):

   ```cpp
   while (isalnum(*p) || *p == '.' || *p == '_' || *p == '$')  // skip possible label
     p++;
   if ((start == capLine) || *p == ':') {    // if label
     if (*p == ':')
       p++;                                  // skip :
     SourceText->SelStart = lineStart;
     SourceText->SelLength = p - capLine;
     setFontStyle(labelStyle);
     p = skipSpace(p);                       // skip spaces after label
     if (!*p)
       continue;
   } else {                                  // else not label
     p = start;                              // reset p to start of code on line
     start = capLine;                        // reset start to beginning of line
   }
   ```

   * A run of letters, digits, `.`, `_`, `$` is a label when it **starts in column 0**, or
     when it is immediately followed by `:` (wherever it starts).
   * The Label style covers column 0 up to and including the `:`. For an indented
     `name:` the leading blanks are inside the styled range (visible only with underline).
   * Anything that starts in column 0 is treated as the label field, even an opcode typed
     in column 0 (`MOVE.B` in column 0 is styled as a label because `.` is a label
     character) and even when the run has zero length (line starting with `#`, `(`, ...).
5. **Comment after a label** (`1176-1181`): if the next non-blank character is `*` or `;`,
   the rest of the line is Comment. Done.
6. **Tokenise** (`1184`): `tokenize(start, ". \t\n", tokenS, tokensS)` - section 9.4.
   When a label was found, `start` points at the label, so the label is token 0 and the
   operation is token 1. Otherwise the string starts with white space and the operation is
   token 1 as well.
7. `syntaxStart = p` (first character of the operation field); classify the statement
   (section 9.5), which may itself colour parts of the line.
8. Final colouring by result type (`1191-1203`):

   | Result | Range coloured | Style |
   |---|---|---|
   | `ERROR_STYLE` | `syntaxStart` to end of line | Structure Error |
   | `COMMENT` | `p` (where classification stopped) to end of line | Comment |
   | `UNKNOWN` | `syntaxStart` to end of line | Macro/Other |
   | `OPCODE_FOUND` | nothing more | (stays Code) |

Lines longer than 255 characters overflow the 256-byte `capLine` buffer
(`textS.cpp:51, 1146`); the port must simply handle long lines safely.

### 9.4 The tokeniser as used by the highlighter (`tokenize`, `ASSEMBLE.CPP:821-881`)

Called with the delimiter set **space, tab, newline and period** (the assembler proper
calls it with comma instead of period).

* Token 0 is reserved for a label and is filled only when the string begins with a
  non-white-space character; otherwise numbering starts at 1.
* A period ends the current token **and begins the next one** (the period is the first
  character of the next token): `MOVE.B` -> `MOVE`, `.B`; `THEN.S` -> `THEN`, `.S`.
* Commas are **not** delimiters: `D0,D1` is one token.
* Delimiters inside parentheses (nesting counted) or inside single quotes do not split.
  The "inside quotes" flag is not reset between tokens.
* Two consecutive single quotes at the start of a token produce an empty token.
* `tokenEnd[n]` records where token `n` ended in the line; the highlighter uses it to find
  the end of the operation or of a structured statement.
* At most 128 tokens (`MAXT`, `ASSEMBLE.CPP:139`); unused tokens are empty strings.

### 9.5 Classification (`TTextStuff::highlightLine`, `textS.cpp:1304-1491`)

`n = 1`; if token 2 begins with `.` then `n = 2` (`1329-1330`) - the operation is taken
to have a size suffix. Then, in this order:

**(a) Directives** (`1306-1359`). Token 1 is compared with this list of 32 names:

```cpp
static char *directives[DIRECTIVE_COUNT] =
              {"ENDC","ENDM","LIST","NOLIST",
               "PAGE","MEXIT","SIMHALT",      // first 7 have no operand
               "DC","DCB","DS","END","EQU","FAIL",
               "INCLUDE","MACRO","MEMORY","OFFSET","OPT","ORG",
               "REG","SECTION","SET","IFC","IFNC","IFEQ","IFNE","INCBIN",
               "IFLT","IFLE","IFGT","IFGE","NARG"};
```

On a match the mnemonic (through `tokenEnd[n]`, i.e. including a `.size` token) gets the
Directive style. Then:

* `FAIL`: result `OPCODE_FOUND` - the rest of the line stays Code.
* One of the first seven (`ENDC ENDM LIST NOLIST PAGE MEXIT SIMHALT`): the rest of the line
  is Comment.
* Any other: the operand field is scanned with `highlightOperand` (9.6) - twice for
  `MEMORY` - and whatever follows the operand field is Comment.

**(b) Structured-assembly keywords** (`1361-1447`). Token numbers below assume no size
suffix on the keyword (`n = 1`); with a suffix everything shifts by one.

| Keyword (token 1) | Accepted form | Otherwise |
|---|---|---|
| `IF` | a relational expression starting at token `n+1` (table below) followed by the token `THEN` | Structure Error |
| `WHILE` | token `n+1` is exactly `<T>` and token `n+2` is `DO`; or a relational expression followed by `DO` | Structure Error |
| `FOR` | token `n+2` is `=`, token `n+4` is `TO` or `DOWNTO`; then either token `n+6` is `BY` and token `n+8` is `DO`, or token `n+6` is `DO` | Structure Error |
| `DBLOOP` | token `n+1` begins with `D` followed by a digit, token `n+2` begins with `=`, token `n+3` is non-empty | Structure Error |
| `UNLESS` | nothing follows; or token `n+1` is exactly `<F>`; or token `n+2` has `<` as its first and `>` as its fourth character and token `n+3` is non-empty | Structure Error |
| `UNTIL` | a relational expression followed by `DO` | Structure Error |
| `ELSE`, `ENDI`, `ENDF`, `ENDW`, `REPEAT` | always accepted | - |

When accepted, the Structured style covers the statement from the keyword through its last
token - plus one more token if that token begins with `.` (e.g. `THEN.S`, `DO.S`,
`ELSE.S`) - and the rest of the line is Comment (`1473-1484`). When rejected, the whole
remainder of the line from the keyword is Structure Error.

Relational expression (`checkRelational`, `textS.cpp:1239-1296`). Patterns are tried in
this order and the first full match wins. `OP` = any non-empty token; `<cc>` = a token
whose first character is `<` and whose fourth character is `>` (a two-letter condition
such as `<EQ>`); `AND`/`OR` = those exact tokens; `.x` = any token beginning with `.`:

```
 1  OP <cc> OP AND .x OP <cc> OP
 2  OP <cc> OP OR  .x OP <cc> OP
 3  OP <cc> OP AND OP <cc> OP
 4  OP <cc> OP OR  OP <cc> OP
 5  <cc> AND .x OP <cc> OP
 6  <cc> OR  .x OP <cc> OP
 7  <cc> AND OP <cc> OP
 8  <cc> OR  OP <cc> OP
 9  OP <cc> OP AND <cc>
10  OP <cc> OP OR  <cc>
11  <cc> AND <cc>
12  <cc> OR  <cc>
13  OP <cc> OP
14  <cc>
```

The function returns the number of the token after the matched pattern, which must then be
`THEN` or `DO`. Because tokens are split on blanks, every element must be separated by
white space (`D0 <EQ> #1`, and `=` in `FOR` must stand alone). A size suffix is accepted
only on the keyword and on `AND`/`OR`, not on an operand (`D0.B <EQ> #1` is rejected).

**(c) Opcodes** (`1448-1470`). `instLookup(tokenS[1], ...)` (`INSTLOOK.CPP:58-148`) does an
exact binary search of the assembler's instruction table `instTable`
(`INSTTABL.CPP:733-899`). The mnemonic is found when the lookup reports no severe error
(`if(error < SEVERE)`). Notes:

* The table is the assembler's own; the 68000 mnemonics in it are: `ABCD ADD ADDA ADDI ADDQ
  ADDX AND ANDI ASL ASR BCC BCHG BCLR BCS BEQ BFCHG BFCLR BFEXTS BFEXTU BFFFO BFINS BFSET
  BFTST BGE BGT BHI BHS BLE BLO BLS BLT BMI BNE BPL BRA BSET BSR BTST BVC BVS CHK CLR CMP
  CMPA CMPI CMPM DBCC DBCS DBEQ DBF DBGE DBGT DBHI DBHS DBLE DBLO DBLS DBLT DBMI DBNE DBPL
  DBRA DBT DBVC DBVS DIVS DIVU EOR EORI EXG EXT ILLEGAL JMP JSR LEA LINK LSL LSR MOVE MOVEA
  MOVEM MOVEP MOVEQ MULS MULU NBCD NEG NEGX NOP NOT OR ORI PEA RESET ROL ROR ROXL ROXR RTE
  RTR RTS SBCD SCC SCS SEQ SF SGE SGT SHI SHS SLE SLO SLS SLT SMI SNE SPL ST STOP SUB SUBA
  SUBI SUBQ SUBX SVC SVS SWAP TAS TRAP TRAPV TST UNLK`. (The directive and structured
  entries of the table never reach this step because (a) and (b) catch them first.)
* The eight bit-field mnemonics (`BFCHG BFCLR BFEXTS BFEXTU BFFFO BFINS BFSET BFTST`) are
  reported "not found" when the option *Assemble Bit Field Instructions* is off
  (`INSTLOOK.CPP:115-119`), so they then appear in the Macro/Other style.
* Macro names are looked up in the assembler symbol table, but that table is emptied at the
  end of every assembly (`clearSymbols()`, `ASSEMBLE.CPP:199`), so while editing a macro
  call is never recognised and is shown as Macro/Other.

When found: the mnemonic and suffix stay Code. If no token follows, done. If the first
"flavor" of the instruction takes a source operand
(`tablePtr->flavorPtr && tablePtr->flavorPtr->source`) the operand field is scanned with
`highlightOperand`; this is true for every mnemonic above **except** `ILLEGAL`, `NOP`,
`RESET`, `RTE`, `RTR`, `RTS`, `TRAPV` (`INSTTABL.CPP:431-433, 522-524, 548-550, 580-590,
712-714`), for which everything after the mnemonic is immediately Comment. After the
operand field, any remaining text is Comment.

**(d) Anything else**: `UNKNOWN` -> Macro/Other from the operation to the end of the line
(operands and trailing comment included).

### 9.6 Operand field scanner (`TTextStuff::highlightOperand`, `textS.cpp:1496-1571`)

Starting at the first character after the operation and its blanks, repeat:

1. Advance to the next one of: end of line, `(`, `'`, `"`, `,`, space, tab.
2. End of line: stop.
3. `(`: find the matching `)` (nested parentheses counted). If the line ends first, the
   range from `syntaxStart` to the end of the line gets the **Structure Error** style and
   scanning stops. (`syntaxStart` is the start of the operand field for a directive, but
   still the start of the *mnemonic* for an opcode, so `MOVE.L (A0,D1` is error-styled
   from `MOVE`.) If a non-blank character follows the `)`, skip it and go to 1.
4. `'` or `"`: a string. Find the closing quote of the same kind; a doubled single quote
   `''` inside is skipped:

   ```cpp
   do {                            // find matching quote
     p++;
     while( (*p == '\'' && *(p+1) == '\'') )  // skip ''
       p+=2;
   } while (*p && *p != quote);
   ```

   No closing quote: from the opening quote to the end of the line is **Structure Error**;
   stop. Otherwise the string including both quotes gets the **Text** style. If a
   non-blank character follows the closing quote, skip it and go to 1.
5. Skip blanks. If the next character is `,`, skip it and any blanks after it and go to 1.
   Otherwise the operand field has ended.

So the operand field is a comma-separated list in which blanks are allowed around the
commas; the first blank-separated word that is not preceded by a comma starts the comment.
A `;` or `*` is not needed to start a trailing comment and is not treated specially here.

### 9.7 Known highlighter quirks

* `n = 2` is chosen whenever token 2 starts with `.`, even when that token is an operand
  such as a local label: in `    BRA     .loop       go back` the "mnemonic" is taken to be
  `BRA .loop`, the word `go` is consumed as the operand, and only `back` is coloured as
  Comment.
* A label containing an interior period (`my.label`) is split into two tokens, shifting
  the operation to token 2; the line is then shown as Macro/Other.
* `IF <T> THEN`-style three-character conditions are only special-cased for `WHILE <T>`
  and `UNLESS <F>`.
* Highlighting never reports assembler errors; it is purely lexical.

---

## 10. Assemble

### 10.1 Trigger

`Project | Assemble Source...`, F9, or the toolbar button
(`TMain::mnuDoAssemblerClick`, `mainS.cpp:342-392`). It acts on the **active** edit window.

### 10.2 Steps

1. **Auto-save** (`mainS.cpp:351-354`): if the option *Auto Save Modified Source Before
   Assembling* is on (`Options->bSave`) **and** the document is modified, run `File | Save`
   (which becomes Save As for an unnamed document). With the option off nothing is saved:
   the assembler works from the editor's current text, and the file on disk is untouched.
2. The window's message list is emptied (`355`).
3. The eight assembler flags are copied from the Assembler Options check boxes
   (`360-367`):

   ```cpp
   listFlag = Options->chkGenList->Checked;
   objFlag  = Options->chkGenSRec->Checked;
   CEXflag  = Options->chkConstantsEx->Checked;
   BITflag  = Options->chkBitfield->Checked;
   CREflag  = Options->chkCrossRef->Checked;
   MEXflag  = Options->chkMacEx->Checked;
   SEXflag  = Options->chkStrucEx->Checked;
   WARflag  = Options->chkShowWarnings->Checked;
   ```

   They are read from the controls' current state, so changes made in the (modeless)
   options dialog take effect even if that dialog is still open or was cancelled.
4. Working directory and temporary files (`370-376`):

   ```cpp
   SetCurrentDir(ExtractFilePath(Active->Project.CurrentFile));
   sourceFile = ExtractFilePath(Active->Project.CurrentFile) + "EASy68Ks.tmp";
   tempFile = ExtractFilePath(Active->Project.CurrentFile) + "EASy68Km.tmp";
   Active->SourceText->Lines->SaveToFile(sourceFile);
   assembleFile(sourceFile.c_str(), tempFile.c_str(), Active->Project.CurrentFile);
   DeleteFile(sourceFile);              // delete temporary files
   DeleteFile(tempFile);
   AssemblerBox->ShowModal();
   ```

   * The process's current directory becomes the folder of the source file, so relative
     `INCLUDE`/`INCBIN` paths resolve against that folder.
   * The editor text (without the font/tab trailer) is written to `EASy68Ks.tmp` in that
     folder; `EASy68Km.tmp` is the assembler's scratch file for macros. Both are deleted
     afterwards.
   * For a never-saved document (`untitledN.x68`, no folder) the folder part is empty: the
     current directory is left as it was and all files are created there.
5. If anything in step 4 throws: error box
   `File Access Error.  Please verify that you have write permission to the folder where the selected file is located.`
   and no result dialog.
6. Otherwise the result dialog (10.4) is shown modally.

### 10.3 What `assembleFile` produces (`ASSEMBLE.CPP:157-230`)

| Output | Name | Condition |
|---|---|---|
| Listing | `ChangeFileExt(<source path>, ".L68")` - same folder and base name, extension exactly `.L68` | *Generate List File* checked (`ASSEMBLE.CPP:177-180`) |
| S-record | `ChangeFileExt(<source path>, ".S68")` | *Generate S-Record* checked (`183-187`); if the file cannot be created the box `Unable to create S-Record file` is shown and assembly continues without it |

Both files are written **even when there are errors**; nothing is deleted on failure.
The listing ends with the error and warning totals (`LISTING.CPP:255-285`).

Error boxes that can appear during this phase: `Error creating temp file.`,
`Error reading source file.`, `Unable to create listing file` (all titled `Error`).

Inputs the assembler takes from the UI besides the text and the eight flags: the active
window's **tab type and tab size**, which `listLine` uses to expand tab characters in the
listing (`LISTING.CPP:128-150`). The content of the `.L68` file therefore depends on the
document's tab settings.

After assembly (`ASSEMBLE.CPP:209-221`):

```cpp
// minimize message area if no errors or warnings
if (warningCount == 0 && errorCount == 0) {
  TTextStuff *Active = (TTextStuff*)Main->ActiveMDIChild; //grab active mdi child
    Active->Messages->Height = 7;
}

AssemblerBox->lblStatus->Caption = IntToStr(warningCount);
AssemblerBox->lblStatus2->Caption = IntToStr(errorCount);

if(errorCount == 0 && errorCount == 0)
{
  AssemblerBox->cmdExecute->Enabled = true;
}
```

`errorCount` counts lines whose worst status is above `MINOR` (0x200); `warningCount`
counts lines whose worst status is above `WARNING` (0x100) (`ASSEMBLE.CPP:548-552`), plus
one for a missing `END` (`337-339`). Warnings are counted even when *Show Warnings* is
off; in that case they are merely not added to the message list or the listing
(`ERROR.CPP:50-51`).

### 10.4 The result dialog (`AssemblerBox`, `assembleS.dfm`, `assembleS.cpp`)

Modal tool window, centred on the screen. Screenshot: `Images\AssemblerStatus.GIF`.

* Title: `Assembler Status - <file name of the active window>` (`assembleS.cpp:60`). The
  design-time title `EASy68K Assembler Status` (`assembleS.dfm:5`) is replaced every time
  the dialog is shown.
* A yellow exclamation-mark icon at the left.
* Two lines of text: `Warnings:` followed by the warning count, and `Errors:` followed by
  the error count (`assembleS.dfm:103-116`, values from `lblStatus`/`lblStatus2`).
* Three buttons, left to right (`assembleS.dfm:117-144`):

| Button | Enabled | Action |
|---|---|---|
| `&Execute` | only when the error count is 0 (warnings do not matter); disabled again every time the dialog closes (`assembleS.cpp:48-52`) | Launch the simulator on the S-record (10.6) and close the dialog |
| `&Load L68` | always | Open the listing in the editor (10.7) and close the dialog |
| `&Close` | always | Close the dialog |

No default or cancel button is defined; the title-bar close button also closes it.
The dialog shows only counts - the messages themselves are in the edit window's message
list.

QUIRKS: `Execute` is enabled on zero errors even if *Generate S-Record* is off (it then
runs whatever `.S68` already exists, or none). If `assembleFile` returned early because a
temporary file could not be opened, the dialog still appears with the counts of the
previous run.

### 10.5 Messages from included files (`ERROR.CPP:245-288`)

When a message is reported while the assembler is inside an `INCLUDE`d file: if that file
is already open in an edit window it is brought to the front (with a one-time notice
`An Error occurred in the included file <name>.` / `The file is currently open and has
been modified.` / `The line numbers of errors may not be correct.` if it has unsaved
changes); otherwise it is opened with `OpenFile`. The message row is then added to the
message list of the window that is now active, i.e. the include file's window, with the
line number inside the include file. When an `INCLUDE` starts, an already open window for
that file has its message list cleared (`DIRECTIV.CPP:709-719`).

QUIRK: after this the include file's window stays the active window. Later messages from
the main file are appended to the include file's list, the result dialog title shows the
include file's name, and `Execute`/`Load L68` derive their file names from the include
file. The port should keep the identity of the document that was assembled.

### 10.6 Execute: launching the simulator (`TAssemblerBox::cmdExecuteClick`, `assembleS.cpp:25-40`)

```cpp
// get name of current S-Record file
S68 = "\"" + ChangeFileExt(Active->Project.CurrentFile,".S68") + "\"";

//run simulator
sim68K = ExtractFilePath(Application->ExeName) + "SIM68K.EXE";
spawnl(P_NOWAITO, sim68K.c_str(), ParamStr(0).c_str(), S68.c_str(), NULL);

AssemblerBox->Close();
```

* Program: `SIM68K.EXE` in the editor's own folder, started as a separate process without
  waiting. Every Execute starts a new simulator instance.
* Arguments: `argv[0]` = the editor's own path; `argv[1]` = the S-record path wrapped in
  double quotes. No other arguments.
* The simulator opens the file given as its first parameter if it exists and has the
  extension `.S68` (simulator source `src-sim68k/Sim68Kv5.16.1/SIM68Ku.cpp`, lines
  1212-1222). It does **not** start running; the user presses Run there. (The simulator
  also understands `/r`, `/f`, `/e`, `/b` after the file name, same file lines 1224-1238,
  but the editor never passes them.)
* No error is shown if the simulator cannot be started.

### 10.7 Load L68: opening the listing (`TAssemblerBox::cmdLoadL68Click`, `assembleS.cpp:70-82`)

`Main->OpenFile(ChangeFileExt(Active->Project.CurrentFile, ".L68"))`, then the dialog
closes. This is the ordinary open path of section 6.2: a missing file gives the
`File Access Error...` box; a listing window that is already open is closed and reloaded;
the listing appears in a new edit window as a **list document** (no highlighting, editor
default font, editable, printable). The listing can equally be opened with
`File | Open File...` using the `EASy68K Listing  [.L68]` filter.

---

## 11. Options dialogs and persistence

### 11.1 Assembler Options (`TOptions`, `optionsS.dfm`, `optionsS.cpp`)

Modeless tool window titled `EASy68K Assembler Options`, centred on the screen
(`optionsS.dfm:4-5, 41`). Two tabs; the first is selected every time the dialog is shown
(`optionsS.cpp:111`). Screenshot: `Images\AssemblerOptions.GIF`.

**Tab "Assembler Options"**

Group `Assembler Options`:

| Caption | Control | Variable | Default | Tool-tip |
|---|---|---|---|---|
| `Generate List File` | `chkGenList` | `listFlag` | checked | `Generates a list file upon assembly [RECOMMENDED]` |
| `Generate S-Record` | `chkGenSRec` | `objFlag` | checked | `Generate a S-Record file upon assembly  [RECOMENDED]` |
| `Show Warnings` | `chkShowWarnings` | `WARflag` | checked | - |
| `Auto Save Modified Source Before Assembling` | `chkSave` | `Options->bSave` | unchecked | `If checked source will be saved before assembly` |
| `Assemble Bit Field Instructions` | `chkBitfield` | `BITflag` | checked | - |

Group `List File Options`:

| Caption | Control | Variable | Default | Tool-tip |
|---|---|---|---|---|
| `Cross Reference` | `chkCrossRef` | `CREflag` | checked | `Cross Reference list file` |
| `Constants Expanded` | `chkConstantsEx` | `CEXflag` | unchecked | `Expand constants in list file` |
| `Structured Expanded` | `chkStrucEx` | `SEXflag` | unchecked | `Expand macros in list file` (sic) |
| `Macros Expanded` | `chkMacEx` | `MEXflag` | unchecked | `Expand macros in list file` |

(Defaults: `optionsS.dfm:84-194`; mapping: `optionsS.cpp:71-79`.)

**Tab "Template"**: a plain-text editor (`Template`, no word wrap, accepts tabs) and the
button `&Save Template`. Every time the dialog is shown the box is reloaded from
`<exe folder>\template.NEW` if that file exists, in the current Editor Options font
(`optionsS.cpp:109-122`). `Save Template` writes the box to that file immediately
(`126-130`); OK and Cancel do not save it.

**Buttons** `&OK` (tool-tip `Save Settings`) and `C&ancel`.

OK (`optionsS.cpp:54-106`): if `Generate S-Record` or `Generate List File` is unchecked,
ask (Yes/No, information icon):

> You have unchecked options that are required for use by the 68000 simulator Sim68K.  Without these options many features of Sim68K will be unavailable.  Do you wish to continue?

* Yes (or both were checked): copy all nine check boxes to their variables, call
  `SaveSettings()` (writes `settings.dat` now), close.
* No: re-check both boxes and leave the dialog open.

Cancel (`49-52`): closes the dialog and nothing else.

QUIRK: Cancel does not restore the check boxes. Because Assemble reads the boxes directly
(10.2 step 3) and `SaveSettings` writes most of them directly, a change followed by Cancel
still affects the next assembly and is saved at exit. Only `Auto Save...` (`bSave`)
genuinely needs OK.

F1 in this dialog: see 15.2.

### 11.2 Editor Options (`TEditorOptionsForm`, `editorOptions.dfm`, `editorOptions.cpp`)

Modal dialog titled `EASy68K Editor Options`, centred on the frame. Tabs `General` and
`Colors`; buttons `&OK` (default), `&Cancel`, `&Help`. Screenshots:
`Images\EditorOptions.GIF`, `Images\EditorOptionsColors.PNG`. The tab that was showing
last time is shown again; the design-time active tab is `Colors`
(`editorOptions.dfm:99-100`), so that is the tab seen the first time.

#### General tab

Group `New File Settings`:

| Caption | Control | Values | Default | Used as |
|---|---|---|---|---|
| `New Font:` | `cbFont` | `Courier`, `Courier New`, `Fixedsys` | `Courier New` | font of new/loaded documents; applied to the active document on OK; saved as `$font name` |
| `New Font Size:` | `cbSize` | depends on the font: Courier `10 12 15`; Courier New `8 9 10 11 12 14 16 18`; Fixedsys `9 18` (`editorOptions.cpp:211-255`) | `10` | as above; saved as `$font size` |
| `Fixed Tab Size:` | `FixedTabSize` (spin box) | minimum 4, maximum 20, step 4 (`editorOptions.dfm:190-200`); other values may be typed and are accepted after clamping to 4..20 (`editorOptions.cpp:94-101`) | `4` | `Project.TabSize` of new/loaded documents and of the active document on OK; saved as `$fixed tab size` |
| `Assembly Tabs` / `Fixed Tabs` | radio buttons `AssemblyTabs`, `FixedTabs` | - | `Fixed Tabs` | `Project.TabType`; saved as `$tab type` (0 = Assembly, 1 = Fixed) |

Group `Current File Info` - read-only labels describing the **active document**, filled
when the dialog opens (`editorOptions.cpp:174-185`): `Font:`, `Font Size:`,
`Fixed Tab Size:`, `Tab Type:` (`Assembly` or `Fixed`).

Group `Environment`:

| Caption | Control | Variable | Default | Takes effect |
|---|---|---|---|---|
| `Auto Indent` | `AutoIndent` | `autoIndent` | checked | **immediately on click**, not on OK (`editorOptions.cpp:268-279`) |
| `Real Tabs` | `RealTabs` | `realTabs` | unchecked | immediately on click (`281-292`) |

When the dialog opens (`FormShow`, `174-208`) the font box is set to the active
document's font (`Courier` -> item 0, `Fixedsys` -> item 2, anything else -> `Courier New`)
and the size box is preset by `cbFontChange` from the active document's size:

```cpp
// Fixedsys:    fontSize < 15 -> "9"  else "18"
// Courier:     fontSize < 12 -> "10" ; < 15 -> "12" ; else "15"
// Courier New: fontSize < 12 -> "10" ; < 15 -> "12" ; else "16"
```

QUIRK: the preset is a bucket, not the real size. Opening the dialog on a Courier New
11-point document and pressing OK changes it to 10; 14 becomes 12; 18 becomes 16; 8 and 9
become 10. The tab-size box and the radio buttons are *not* re-synchronised with the active
document; they keep the global values.

#### Colors tab

* `&Element` list (`Element`): `Code`, `Comment`, `Directive`, `Label`, `Macro/Other`,
  `Structured`, `Structure Error`, `Text`, `Background` (`editorOptions.dfm:678-687`).
* Group `Text Attributes`: check boxes `&Bold`, `&Italic`, `&Underline`. Selecting an
  element loads its three attributes into the boxes (`ElementClick`,
  `editorOptions.cpp:429-480`); `Background` has none (boxes left unchanged).
* `Color &Presets` drop-down (`SyntaxCombo`): `Color1`, `Color2`, `No Color`, `Custom`,
  `Disabled`.
* `Print w/Black` check box: checked and **disabled** (greyed) by design
  (`editorOptions.dfm:865-875`). It has no effect anywhere (the code that used it is
  commented out, `mainS.cpp:443-448`); its state is only stored in `settings.dat`.
* Group `&Color`: a 4 x 4 grid of colour swatches (`StaticText1..16`,
  `editorOptions.dfm:408-669`), row by row:

  | | col 1 | col 2 | col 3 | col 4 |
  |---|---|---|---|---|
  | row 1 | `clBlack` #000000 | `clMaroon` #800000 | `clGreen` #008000 | `clOlive` #808000 |
  | row 2 | `clNavy` #000080 | `clPurple` #800080 | `clTeal` #008080 | `clGray` #808080 |
  | row 3 | `clMedGray` #A0A0A4 | `clRed` #FF0000 | `clLime` #00FF00 | `clYellow` #FFFF00 |
  | row 4 | `clBlue` #0000FF | `clFuchsia` #FF00FF | `clAqua` #00FFFF | `clWhite` #FFFFFF |

* `Preview` panel showing sample text in Courier New with the pending styles and
  background (`highlightPreview`, `editorOptions.cpp:483-554`):

  ```
  * Syntax Highlight            <- Comment
  START   MOVE.B #1,D0          <- Label, Code
          Macro/Other           <- Macro/Other
      if <NE> then              <- Structured
      of <NE> tehn              <- Structure Error
          DC.B 'HELLO'          <- Directive, Text
  ```

Behaviour (all edits go to temporary copies until OK):

* Clicking a swatch (`StaticTextClick` -> `setSyntaxPreviewColor`, `303-371`) sets the
  colour of the selected element (or the background). The preset box switches to `Custom`.
* Changing a check box (`BoldClick`/`ItalicClick`/`UnderlineClick` ->
  `setSyntaxPreviewStyle`, `310-426`) sets the three attributes of the selected element.
  The preset box switches to `Custom`.
* Choosing a preset (`SyntaxComboChange`, `565-656`) deselects the element, clears the
  three check boxes and, except for `Custom` (which changes nothing), sets all elements:

  | Preset | Colours | Attributes |
  |---|---|---|
  | `Color1` | the defaults of 9.2 | none |
  | `Color2` | Code black, Macro/Other `clPurple`, Directive `clBlue`, Comment `clGreen`, Label `clNavy`, Structured `clBlue`, Structure Error `clRed`, Text `clMaroon` | none |
  | `No Color` | all black | Macro/Other italic + underline; Directive bold; Comment italic; Label bold; Structured bold; Structure Error underline; Code and Text plain |
  | `Disabled` | all black | none; additionally turns syntax highlighting **off** |

  Presets never change the background colour.

#### OK (`cmdOKClick`, `editorOptions.cpp:62-171`)

1. **Active window only**: its whole text is set to the chosen font and size;
   `Project.TabType` and `Project.TabSize` are set from the radio buttons and the spin box
   (after clamping to 4..20); tab stops are re-applied.
2. **Every open window**, only if a colour, attribute or preset was changed in this
   session of the dialog (`styleChange`): the temporary styles become the global styles;
   if `Disabled` was chosen every character is set to the Code colour with no attributes
   and `highlightDisabled` becomes true, otherwise the window is re-highlighted and
   `highlightDisabled` becomes false; the background colour is applied.
3. The dialog closes.

Font, tab type and tab size are thus per-document; colours are global. Nothing is written
to `settings.dat` at this point - that happens at program exit (or on Assembler Options
OK).

QUIRK: the code "restores" the modified flag of the active window from a variable that has
not been assigned yet (`modifiedSave`, `editorOptions.cpp:66, 114, 123`), so the modified
state of the active document after OK is undefined in the original. The evident intent is
that changing fonts and colours does not alter the modified state.

#### Cancel and Help

* `&Cancel` (and the close box) discards pending colour changes (`styleChange = false`,
  `editorOptions.cpp:558-562`). QUIRK: it does not undo `Auto Indent`/`Real Tabs` clicks
  and does not restore the font, size, tab-size and tab-type controls, whose values are
  what new documents use and what is saved at exit.
* `&Help` and F1: `Main->displayHelp("EDIT_OPTIONS")` (15.2).

### 11.3 Where each setting lives

| Setting | In memory | Applied to |
|---|---|---|
| 9 assembler check boxes | the controls of `Options` + flags in `GLOBALS.CPP:59-66` + `Options->bSave` | next assembly |
| default font name/size, default tab type/size | the controls of `EditorOptionsForm` | new and newly loaded documents |
| font name/size, tab type/size of a document | the document; also the `.X68` trailer | that document |
| auto indent, real tabs | `autoIndent`, `realTabs` | all documents |
| 8 styles, background, highlight disabled | globals | all source documents |
| frame position/size, "edit window maximised" | the frame; `maximizedEdit` | next start |

### 11.4 `settings.dat`

Location: `<folder of EDIT68K.exe>\settings.dat` (`optionsS.cpp:147, 233`).

**Written** by `TOptions::SaveSettings` (`optionsS.cpp:134-221`) on Assembler Options OK
and at program exit. Text file; every `\n` becomes CR LF. One value per line in the form
`<value>$<name>`. 57 lines, always in this order:

| Line | Text after the value | Value written | Type | Default when the file is missing | Shipped file (`official-extracted\settings.dat`) |
|---|---|---|---|---|---|
| 1 | (header) `$Settings for EASy68K Editor/Assembler v5.16.01  DO NOT EDIT THIS FILE!!!!` | - | - | - | header says `v5.15.04` |
| 2 | `$generate list` | `listFlag` | 0/1 | 1 | 1 |
| 3 | `$generate s-record` | `objFlag` | 0/1 | 1 | 1 |
| 4 | `$save then assemble` | `bSave` | 0/1 | 0 | 0 |
| 5 | `$show warnings` | `chkShowWarnings->Checked` | 0/1 | 1 | 1 |
| 6 | `$cross reference` | `chkCrossRef->Checked` | 0/1 | 1 | 1 |
| 7 | `$macros expanded` | `chkMacEx->Checked` | 0/1 | 0 | 0 |
| 8 | `$structured expand` | `chkStrucEx->Checked` | 0/1 | 0 | 0 |
| 9 | `$constants expand` | `chkConstantsEx->Checked` | 0/1 | 0 | 0 |
| 10 | `$font name` | `cbFont->Text` | text | `Courier New` | `Courier New` |
| 11 | `$font size` | `cbSize->Text` | text | `10` | `10` |
| 12 | `$tab type` | `tabType` (0 = Assembly, 1 = Fixed) | 0/1 | 1 | 1 |
| 13 | `$fixed tab size` | `FixedTabSize->Value` | int | 4 | 4 |
| 14 | `$maximized edit` | `maximizedEdit` (true when the active edit window is maximised at save time) | 0/1 | 0 | 0 |
| 15 | `$auto indent` | `autoIndent` | 0/1 | 1 | 1 |
| 16 | `$real tabs` | `realTabs` | 0/1 | 0 | 0 |
| 17 | `$assemble bit field` | `chkBitfield->Checked` | 0/1 | 1 | 1 |
| 18 | `$main top` | `Main->Top` | int | 106 | 106 |
| 19 | `$main left` | `Main->Left` | int | 513 | 513 |
| 20 | `$main height` | `Main->Height` | int | 2/3 of screen height | 943 |
| 21 | `$main width` | `Main->Width` | int | 2/3 of screen width | 925 |
| 22-25 | `$code color`, `$code bold`, `$code italic`, `$code underline` | `codeStyle` | int, 0/1 x3 | 0, 0, 0, 0 | same |
| 26-29 | `$unknown color`, `$unknown bold`, `$unknown italic`, `$unknown underline` | `unknownStyle` | | 32896, 0, 0, 0 | same |
| 30-33 | `$directive color`, `$directive bold`, `$directive italic`, `$directive underline` | `directiveStyle` | | 32768, 0, 0, 0 | same |
| 34-37 | `$comment color`, `$comment bold`, `$comment italic`, `$comment underline` | `commentStyle` | | 16711680, 0, 0, 0 | same |
| 38-41 | `$label color`, `$label bold`, `$label italic`, `$label underline` | `labelStyle` | | 8388736, 0, 0, 0 | same |
| 42-45 | `$structure color`, `$structure bold`, `$structure italic`, `$structure underline` | `structureStyle` | | 128, 0, 0, 0 | same |
| 46-49 | `$error color`, `$error bold`, `$error italic`, `$error underline` | `errorStyle` | | 255, 0, 0, 0 | same |
| 50-53 | `$text color`, `$text bold`, `$text italic`, `$text underline` | `textStyle` | | 8421376, 0, 0, 0 | same |
| 54 | `$highlight disabled` | `highlightDisabled` | 0/1 | 0 | 0 |
| 55 | `$print w/black` | `PrintBlack->Checked` | 0/1 | 1 | 1 |
| 56 | `$background color` | `backColor` | int | 16777215 | 16777215 |
| 57 | `$color presets` | `SyntaxCombo->ItemIndex` (0 Color1, 1 Color2, 2 No Color, 3 Custom, 4 Disabled, -1 none selected) | int | -1 (UNVERIFIED; the design-time combo shows the text `Color1` with no item selected, and the shipped file contains `-1`) | -1 |

The `settings.dat` in the source tree is a developer's own file and differs in lines 9
(`1`), 14 (`1`), 18-21 (`121`, `788`, `700`, `753`), 55 (`0`) and 57 (`0`).

Example (first lines of the shipped file):

```
$Settings for EASy68K Editor/Assembler v5.15.04  DO NOT EDIT THIS FILE!!!!
1$generate list
1$generate s-record
0$save then assemble
1$show warnings
...
Courier New$font name
10$font size
1$tab type
4$fixed tab size
```

**Read** by `TOptions::LoadSettings` (`optionsS.cpp:228-912`) once, at start-up:

1. `defaultSettings()` (`915-980`) first sets every variable from the design-time state of
   the controls and the default styles.
2. If the file exists, lines are read **strictly in the order above**. For each expected
   setting one line is read; the value is used only if the text from the `$` onwards equals
   the expected name exactly, e.g.

   ```cpp
   File.getline(buffer, SIZE); // 'generate list' setting
   if (!strcmp(&buffer[1],"$generate list")) {   // if expected setting
     if(buffer[0] == '1') { listFlag = true; chkGenList->Checked = true; }
     else { listFlag = false; chkGenList->Checked = false; }
   }
   ```

   Otherwise that setting keeps its default and reading continues with the next line for
   the next setting. A missing or extra line therefore shifts everything after it out of
   step and all later settings fall back to defaults. The header line is read and ignored;
   the version in it is not checked.
3. On/off lines must have exactly one character before the `$`: `1` = on, anything else =
   off. Exception: `$tab type` uses `0` = Assembly, anything else = Fixed. Numeric and text
   lines take everything before the `$`.
4. Loading sets both the variables and the dialog controls (check boxes, font and size
   boxes, tab radio buttons, spin box, preset box), and moves/resizes the frame.

Errors show `Error loading editor settings` / `Error saving editor settings` /
`Error configuring default editor settings`.

---

## 12. New file and the template

### 12.1 `File | New X68 Source File` (`TMain::mnuNewClick`, `mainS.cpp:528-535`; `TTextStuff::NewSourceFile`, `textS.cpp:880-919`)

1. A new edit window is created.
2. `NewProject("Source")`: name `untitledN.x68` (6.8), `IsSource = true`,
   `HasName = false`, undo cleared, menu items enabled (2.7).
3. Tab type, tab size, font name and font size are taken from the Editor Options controls
   (`textS.cpp:888-894`).
4. The window caption is set to the name.
5. Template (`textS.cpp:898-901`):

   ```cpp
   //if template exists then load it
   if (FileExists(ExtractFilePath(Application->ExeName) + "template.NEW"))
     SourceText->Lines->LoadFromFile
                       (ExtractFilePath(Application->ExeName) + "template.NEW");
   ```

   The file `template.NEW` in the program's own folder is loaded verbatim as the initial
   text. If the file does not exist the document starts empty. There is no placeholder
   substitution of any kind (no date, name or file-name insertion).
6. Tab stops are applied, the caret is placed at the very beginning, the document is
   marked **not modified**, and highlighting is requested.

The template is edited in `Options | Assembler Options... | Template` (11.1).

### 12.2 `template.NEW` shipped with the official v5.16.1 installer and portable zip

`c:\easy64k\reference\official-extracted\template.NEW` (identical in
`official-portable-extracted\EASy68K\`), 420 bytes, CR LF line endings, spaces only, ends
with a line break. **This is what users of the real program see.**

```
*-----------------------------------------------------------
* Title      :
* Written by :
* Date       :
* Description:
*-----------------------------------------------------------
    ORG    $1000
START:                  ; first instruction of program

* Put program code here

    SIMHALT             ; halt simulator

* Put variables and constants here

    END    START        ; last line of source
```

### 12.3 `template.NEW` in the source tree

`c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\template.NEW`, 252 bytes, CR LF line
endings, ends with a line break. `<TAB>` below stands for one tab character (0x09); there
are no other blanks on those lines. This older template differs from the shipped one.

```
*-----------------------------------------------------------
* Program Number:
* Written by    :
* Date Created  :
* Description   :
*
*-----------------------------------------------------------
START<TAB>ORG<TAB>$1000



<TAB>STOP<TAB>#$2000
<TAB>END<TAB>START
```

(Three empty lines between the `START` line and the `STOP` line.)

---

## 13. Printing and print preview

### 13.1 Print (`TMain::mnuPrintSourceClick`, `mainS.cpp:409-512`)

1. The standard print dialog is shown (`PrintDialog`, `Options = [poSelection]`,
   `MaxPage = 999`, `mainS.dfm:1178-1183`): printer choice, number of copies, and the
   range choices All / Selection. Cancel = nothing happens.
2. The text to print is the selection if "Selection" was chosen, otherwise the whole
   document. It is copied into a temporary edit window that exists only for the duration
   of the print job, where every tab character is replaced by spaces using the document's
   tab type and size (`replaceTabs`, `textS.cpp:498-534`, rule of 8.1). The document
   itself is not changed.
3. Printer font = the document's editor font. Lines per page =
   `PageHeight / TextHeight("W")`. Job title = `EASy68K ` + the document's path.
4. Each line is drawn with a plain text-out call at x = 20 device units, one line height
   per line (`mainS.cpp:489-494`). No margins, header, footer, page numbers, line numbers
   or word wrap (over-long lines are clipped by the page edge). Output is **monochrome**:
   syntax colours are not printed.
5. A line that is exactly

   ```
   <------------------------------ PAGE ------------------------------>
   ```

   (`NEW_PAGE_MARKER`, `asm.h:261`; the assembler's `PAGE` directive writes it into the
   listing, `DIRECTIV.CPP:1025-1041`) is not printed and starts a new page.
6. The whole thing is repeated for each requested copy.
7. Any failure: the job is aborted and `Printer error.  Please check printer.` is shown.

### 13.2 Printer Setup

`File | Printer Setup...` opens the standard Windows printer-setup dialog
(`mainS.cpp:402-405`).

### 13.3 Print preview

There is **no** print preview in v5.16.1. The forms `preview.dfm` ("EASy68K Print
Preview", a QuickReport page) and `Preview_dlg.dfm` ("Building Print Preview.....") have
no code, are not in the project file and are not referenced by any menu - DEAD.

---

## 14. Find and Replace

### 14.1 Find dialog (`findDialogFrm`, `findDialogS.dfm`, `findDialogS.cpp`)

Modeless, always-on-top dialog titled `Find`, no title-bar buttons, centred on the frame.

| Control | Caption | Notes |
|---|---|---|
| `findText` (text box) | label `Fi&nd what:` | |
| `wholeWordChk` | `Match &whole word only` | default off |
| `matchCaseChk` | `Match &case` | default off |
| `findNextBtn` | `Find  (F3)` (two spaces) | default button; disabled while the text box is empty (`findDialogS.cpp:30-39`) |
| `cancelBtn` | `Cancel` | closes the dialog (it is not bound to Esc) |

There is no search-direction choice, no wrap option, no regular expressions.

Opening it (`TMain::mnuFindClick`, `mainS.cpp:574-583`): if the active editor has a
non-empty selection, that text is copied into the text box; otherwise the previous search
text is kept. When shown with a non-empty text box, the Find button gets the focus
(`findDialogS.cpp:43-53`), so Enter searches at once.

The search text and the two options persist while the program runs; they are not saved in
`settings.dat`.

### 14.2 The search (`TMain::FindDialogFind`, `mainS.cpp:601-642`)

```cpp
// begin the search after the current selection if there is one
// otherwise, begin at the start of the text
if (Active->SourceText->SelLength)
  StartPos = Active->SourceText->SelStart + Active->SourceText->SelLength;
else
  StartPos = 0;
```

* Always forward. With a selection, the search starts just after it; **with no selection
  it starts at the beginning of the document, not at the caret**.
* Options: case-sensitive only if `Match case`; whole-word only if `Match whole word only`
  (the edit control's own definition of a word boundary).
* Found: the frame takes the focus and the match is selected in the editor (and scrolled
  into view).
* Not found: information box `End of document reached.`; the selection is collapsed to its
  start. Because nothing is selected afterwards, the next search starts from the top -
  that is the only form of wrap-around.

`Find Next` / F3 (`TMain::FindNext`, `mainS.cpp:696-699`) repeats the search with the
**Find dialog's** text and options, whether or not that dialog is visible (and even if the
last search was typed in the Replace dialog). It is available only when an edit window
exists and the Find text is non-empty.

The search works in any edit window, including list documents.

### 14.3 Replace dialog (`replaceDialogFrm`, `replaceDialogS.dfm`, `replaceDialogS.cpp`)

Modeless, always-on-top dialog titled `Replace`.

| Control | Caption |
|---|---|
| `findText` | label `Fi&nd what:` |
| `replaceText` | label `Re&place with` |
| `wholeWordChk` | `Match &whole word only` |
| `matchCaseChk` | `Match &case` |
| `findNextBtn` | `&Find Next` |
| `replaceBtn` | `&Replace` |
| `replaceAllBtn` | `Replace &All` |
| `cancelBtn` | `Cancel` (closes) |

The three action buttons are disabled while "Find what" is empty
(`replaceDialogS.cpp:28-40`).

Opening it (`TMain::mnuFindAndReplace1Click`, `mainS.cpp:653-660`): **both** text boxes
are set to the editor's current selection (to empty text if nothing is selected).

* `Find Next`: the search of 14.2 with this dialog's text and options.
* `Replace` and `Replace All` (`TMain::ReplaceDialogReplace`, `mainS.cpp:663-691`):

  ```cpp
  if(Active->SourceText->SelLength == 0)
  {
    FindDialogFind(replaceDialogFrm->findText->Text, ...);
  }

  do {
    if(Active->SourceText->SelLength != 0)
    {
      startSave = Active->SourceText->SelStart;
      lengthSave = max(1, replaceDialogFrm->replaceText->Text.Length());
      Active->SourceText->SelText = replaceDialogFrm->replaceText->Text;
      Active->SourceText->SelStart = startSave;
      Active->SourceText->SelLength = lengthSave;
      FindDialogFind(replaceDialogFrm->findText->Text, ...);
    }
  } while ( replaceDialogFrm->replaceAll  &&
            Active->SourceText->SelLength != 0 );
  ```

  1. If nothing is selected, find the first match (from the top).
  2. If something is now selected, replace **the selection** with the replacement text,
     select the replacement, and search for the next match after it.
  3. `Replace All` repeats step 2 until the search fails.

  Every Replace therefore ends by selecting the next match, or by the
  `End of document reached.` box when there is none. `Replace All` shows that box once, at
  the end. No count of replacements is shown.

QUIRKS:

* Step 2 does not check that the selection is a match: if the user has selected arbitrary
  text and presses Replace, that text is replaced.
* With an empty replacement, one character after the deletion point is selected
  (`max(1, ...)`) so that the next search has something to start after; a match that
  begins exactly at that character is skipped.
* `Replace All` runs from the current selection (or from the top if none) to the end of
  the document only.

---

## 15. Help and About

### 15.1 Mechanism

Help is the compiled HTML Help file `help.chm` in the program folder, opened by context
number: `HtmlHelp(desktop, help.chm, HH_HELP_CONTEXT, getHelpContext(keyword))`
(`TMain::displayHelp`, `mainS.cpp:562-570`). If HTML Help is not installed:
`HTML Help was not detected on this computer. The HTML help viewer may be downloaded from msdn.microsoft.com`.

`getHelpContext` (`help.cpp:232-251`) compares the keyword, ignoring letter case, with
each entry of a table of 197 keywords (`help.cpp:26-224`); the first match gives the
context number; **no match gives `IDH_INTRO`** (630). Context numbers are defined in
`ez68k.h` and mapped to pages by `ez68k.ali` in the help project. The help file's own
contents tree is `contents.hhc` (Introduction; Editor/Assembler Operation; Assembler
Commands; Simulator Operation; Simulator I/O; EASyBIN; ASCII Chart; 68000 Quick Reference;
GNU General Public License; Credits; Jimmy Mardell's 68000 Reference Guide).

### 15.2 Which page each help entry point opens

| Entry point | Keyword passed | Page opened |
|---|---|---|
| menu Help, item `Hel&p` | `INTRO` (`mainS.cpp:558`) | not in the table -> `IDH_INTRO` -> `main.htm` ("EASy68K Introduction") |
| F1 with focus on the frame | `MAIN` (`mainS.cpp:816`) | not in the table -> `main.htm` |
| F1 in the editor | selected text or word at the caret (15.3) | per the table below; unknown words -> `main.htm` |
| Editor Options: `Help` button or F1 | `EDIT_OPTIONS` (`editorOptions.cpp:263, 297`) | **`main.htm`** - see note |
| Assembler Options: F1 | `EDIT_OPTIONS` (`optionsS.cpp:988`) | **`main.htm`** - see note |
| menu Help, item `&About` | - | the About box (15.4), not a help page |

Note: the table contains the keyword `OPTIONS` (-> `IDH_EDIT_OPTIONS` -> `options.htm`)
but not `EDIT_OPTIONS`, so the two options dialogs land on the introduction page. The
clear intent is `options.htm`.

The help file's own table of contents, index and full-text search are provided by the
help viewer, not by the editor.

### 15.3 F1 in the editor (`textS.cpp:294-312`)

```cpp
} else if (Key == VK_F1) {
  if (SourceText->SelText != "")    // if text selected, use it
    Main->displayHelp(SourceText->SelText.Trim().c_str());
  else {                      // no text selected
    if (isspace(SourceText->Text[SourceText->SelStart]))  // if cursor on space
      Main->displayHelp("INTRO");  // do help intro
    else {                    // cursor on word
      int selectStart = SourceText->SelStart;
      // find start of word (alpha numeric characters only)
      while (selectStart > 1 && (isalnum(SourceText->Text[selectStart-1])))
        selectStart--;
      int selectEnd = SourceText->SelStart+1;
      // find end of word   (alpha numeric characters only)
      while (selectEnd < SourceText->Text.Length() && (isalnum(SourceText->Text[selectEnd])))
        selectEnd++;
      // do help on the current word
      Main->displayHelp(SourceText->Text.SubString(selectStart,selectEnd-selectStart).c_str());
    }
  }
```

* With a selection: the trimmed selection is the keyword.
* Without: if the character immediately **before** the caret is white space, the
  introduction is shown; otherwise the keyword is the run of letters and digits around the
  caret. (String indexes are 1-based, so `Text[SelStart]` is the character left of the
  caret. With the caret at the very start of the document the lookup fails and nothing
  happens.)

Keyword table (generated from `help.cpp:26-224`, `ez68k.h`, `ez68k.ali`; page paths are
relative to the help folder):

| Keywords (case-insensitive) | Context id | Page |
|---|---|---|
| EASY68K | IDH_INTRO (630) | main.htm |
| 68000 | IDH_QUICKREF (970) | Quick Reference.htm |
| ASCII | IDH_ASCII (90) | Ascii.htm |
| ASSEMBLER | IDH_ASSEMBLER_BASIC_OPERATION (120) | BasicOperation.htm |
| OPTIONS | IDH_EDIT_OPTIONS (570) | options.htm |
| ERROR, WARNING | IDH_ASSEMBLER_ERROR (130) | errors.htm |
| CREDITS, CHARLES, CURT, AARON | IDH_CREDITS (350) | Credits.htm |
| GOD | IDH_PSALMS (960) | reference/68ks23.htm |
| BREAKPOINT | IDH_SIM_ADVBREAK (1080) | SIMHELP/AdvBreakpoints.htm |
| SIMULATOR | IDH_SIM_BASIC (1090) | SIMHELP/basicoperation.htm |
| EXCEPTIONS | IDH_SIM_EXCEPTIONS (1110) | SIMHELP/exceptions.htm |
| HARDWARE | IDH_SIM_HARDWARE (1120) | SIMHELP/hardware.htm |
| STACK | IDH_SIM_STACK (1150) | SIMHELP/stack.htm |
| FILE | IDH_IO_FILE (640) | fileio.htm |
| GRAPHICS | IDH_IO_GRAPHICS (650) | graphics.htm |
| MOUSE | IDH_IO_PERIPHERAL (670) | peripheralio.htm |
| SERIAL | IDH_IO_SERIAL (680) | serialio.htm |
| SOUND | IDH_IO_SOUND (690) | sound.htm |
| TEXT | IDH_IO_TEXT (700) | textio.htm |
| CONDITIONAL, ENDC, IFC, IFEQ, IFGE, IFGT, IFLE, IFLT, IFNC, IFNE | IDH_CONDITIONAL (340) | Directives/conditional.htm |
| DC | IDH_DIRECT_DC (370) | directives/dc.htm |
| DCB | IDH_DIRECT_DCB (380) | directives/dcb.htm |
| DS | IDH_DIRECT_DS (390) | directives/ds.htm |
| END | IDH_DIRECT_END (400) | directives/end.htm |
| EQU | IDH_DIRECT_EQU (410) | directives/equ.htm |
| FAIL | IDH_DIRECT_FAIL (420) | Directives/fail.htm |
| INCBIN | IDH_DIRECT_INCBIN (430) | directives/incbin.htm |
| INCLUDE | IDH_DIRECT_INCLUDE (440) | directives/include.htm |
| MEMORY | IDH_DIRECT_MEMORY (450) | directives/memory.htm |
| OFFSET | IDH_DIRECT_OFFSET (460) | directives/offset.htm |
| OPT, MEX, NOMEX, NOSEX, NOWAR, SEX, WAR | IDH_DIRECT_OPT (470) | directives/opt.htm |
| ORG | IDH_DIRECT_ORG (480) | directives/org.htm |
| PAGE | IDH_DIRECT_PAGE (490) | directives/page.htm |
| REG | IDH_DIRECT_REG (500) | directives/reg.htm |
| SECTION | IDH_DIRECT_SECTION (510) | directives/section.htm |
| SET | IDH_DIRECT_SET (520) | directives/set.htm |
| SIMHALT | IDH_DIRECT_SIMHALT (530) | directives/simhalt.htm |
| LIST | IDH_LIST (750) | directives/list.htm |
| NOLIST | IDH_NOLIST (900) | directives/list.htm |
| ENDM, MACRO | IDH_MACRO (780) | directives/macro.htm |
| STRUCTURED | IDH_STRUCCONTROL_INTRO (1220) | StrucControl/Introduction.htm |
| EXPRESSION | IDH_STRUCCONTROL_EXSYNTAX (1190) | StrucControl/ExSyntax.htm |
| ENDI, IF | IDH_STRUCCONTROL_IF (1210) | StrucControl/If.htm |
| ENDW, WHILE | IDH_STRUCCONTROL_WHILE (1240) | StrucControl/While.htm |
| ENDF, FOR | IDH_STRUCCONTROL_FOR (1200) | StrucControl/For.htm |
| REPEAT, UNTIL | IDH_STRUCCONTROL_REPEAT (1230) | StrucControl/Repeat.htm |
| DBLOOP, UNLESS | IDH_STRUCCONTROL_DBLOOP (1180) | StrucControl/DBloop.htm |
| ABCD | IDH_ABCD (10) | reference/68ks8e.htm |
| ADD | IDH_ADD (20) | reference/68ks5a.htm |
| ADDA | IDH_ADDA (30) | reference/68ks5b.htm |
| ADDI | IDH_ADDI (40) | reference/68ks5c.htm |
| ADDQ | IDH_ADDQ (50) | reference/68ks5d.htm |
| ADDX | IDH_ADDX (60) | reference/68ks5e.htm |
| AND | IDH_AND (70) | reference/68ks6a.htm |
| ANDI | IDH_ANDI (80) | reference/68ks6b.htm |
| ASL | IDH_ASL (100) | reference/68ks7a.htm |
| ASR | IDH_ASR (110) | reference/68ks7b.htm |
| BCC, BCS, BEQ, BNE, BGE, BGT, BHI, BLE, BLS, BLT, BMI, BPL, BVC, BVS, BRA | IDH_BCC (140) | reference/68ks9a.htm |
| BCHG | IDH_BCHG (150) | reference/68ks8a.htm |
| BCLR | IDH_BCLR (160) | reference/68ks8b.htm |
| BFCHG | IDH_BFCHG (170) | reference/bfchg.htm |
| BFCLR | IDH_BFCLR (180) | reference/bfclr.htm |
| BFEXTS | IDH_BFEXTS (190) | reference/bfexts.htm |
| BFEXTU | IDH_BFEXTU (200) | reference/bfextu.htm |
| BFFFO | IDH_BFFFO (210) | reference/bfffo.htm |
| BFINS | IDH_BFINS (220) | reference/bfins.htm |
| BFSET | IDH_BFSET (230) | reference/bfset.htm |
| BFTST | IDH_BFTST (240) | reference/bftst.htm |
| BSET | IDH_BSET (250) | reference/68ks8c.htm |
| BSR | IDH_BSR (260) | reference/68ks9b.htm |
| BTST | IDH_BTST (270) | reference/68ks8d.htm |
| CHK | IDH_CHK (280) | reference/68ks10a.htm |
| CLR | IDH_CLR (290) | reference/68ks5f.htm |
| CMP | IDH_CMP (300) | reference/68ks5g.htm |
| CMPA | IDH_CMPA (310) | reference/68ks5h.htm |
| CMPI | IDH_CMPI (320) | reference/68ks5i.htm |
| CMPM | IDH_CMPM (330) | reference/68ks5j.htm |
| DBCC, DBCS, DBEQ, DBNE, DBGE, DBGT, DBHI, DBLE, DBLS, DBLT, DBMI, DBPL, DBVC, DBVS, DBRA | IDH_DBCC (360) | reference/68ks9c.htm |
| DIVS | IDH_DIVS (540) | reference/68ks5k.htm |
| DIVU | IDH_DIVU (550) | reference/68ks5l.htm |
| EOR | IDH_EOR (580) | reference/68ks6c.htm |
| EORI | IDH_EORI (590) | reference/68ks6d.htm |
| EXG | IDH_EXG (600) | reference/68ks4a.htm |
| EXT | IDH_EXT (610) | reference/68ks5m.htm |
| ILLEGAL | IDH_ILLEGAL (620) | reference/68ks10h.htm |
| JMP | IDH_JMP (710) | reference/68ks9d.htm |
| JSR | IDH_JSR (720) | reference/68ks9e.htm |
| LEA | IDH_LEA (730) | reference/68ks4b.htm |
| LINK | IDH_LINK (740) | reference/68ks4c.htm |
| LSL | IDH_LSL (760) | reference/68ks7c.htm |
| LSR | IDH_LSR (770) | reference/68ks7d.htm |
| MOVE | IDH_MOVE (790) | reference/68ks4d.htm |
| MOVEA | IDH_MOVEA (810) | reference/68ks4e.htm |
| MOVEM | IDH_MOVEM (820) | reference/68ks4f.htm |
| MOVEP | IDH_MOVEP (830) | reference/68ks4g.htm |
| MOVEQ | IDH_MOVEQ (840) | reference/68ks4h.htm |
| MOVE USP (reachable only by selecting exactly that text) | IDH_MOVE_USP (800) | reference/68ks10b.htm |
| MULS | IDH_MULS (850) | reference/68ks5n.htm |
| MULU | IDH_MULU (860) | reference/68ks5o.htm |
| NBCD | IDH_NBCD (870) | reference/68ks8f.htm |
| NEG | IDH_NEG (880) | reference/68ks5p.htm |
| NEGX | IDH_NEGX (890) | reference/68ks5q.htm |
| NOP | IDH_NOP (910) | reference/68ks10i.htm |
| NOT | IDH_NOT (920) | reference/68ks6e.htm |
| OR | IDH_OR (930) | reference/68ks6f.htm |
| ORI | IDH_ORI (940) | reference/68ks6g.htm |
| PEA | IDH_PEA (950) | reference/68ks4i.htm |
| RESET | IDH_RESET (980) | reference/68ks10c.htm |
| ROL | IDH_ROL (990) | reference/68ks7e.htm |
| ROR | IDH_ROR (1000) | reference/68ks7f.htm |
| ROXL | IDH_ROXL (1010) | reference/68ks7g.htm |
| ROXR | IDH_ROXR (1020) | reference/68ks7h.htm |
| RTE | IDH_RTE (1030) | reference/68ks10d.htm |
| RTR | IDH_RTR (1040) | reference/68ks9f.htm |
| RTS | IDH_RTS (1050) | reference/68ks9g.htm |
| SBCD | IDH_SBCD (1060) | reference/68ks8g.htm |
| SCC, SCS, SEQ, SGE, SGT, SHI, SLE, SLS, SLT, SME, SNE, SPL, SVC, SVS, SSF, SST | IDH_SCC (1070) | reference/68ks9h.htm |
| STOP | IDH_STOP (1170) | reference/68ks10e.htm |
| SUB | IDH_SUB (1250) | reference/68ks5r.htm |
| SUBA | IDH_SUBA (1260) | reference/68ks5s.htm |
| SUBI | IDH_SUBI (1270) | reference/68ks5t.htm |
| SUBQ | IDH_SUBQ (1280) | reference/68ks5u.htm |
| SUBX | IDH_SUBX (1290) | reference/68ks5v.htm |
| SWAP | IDH_SWAP (1300) | reference/68ks4j.htm |
| TAS | IDH_TAS (1310) | reference/68ks5w.htm |
| TRAP | IDH_TRAP (1320) | reference/68ks10f.htm |
| TRAPV | IDH_TRAPV (1330) | reference/68ks10g.htm |
| TST | IDH_TST (1340) | reference/68ks5x.htm |
| UNLK | IDH_UNLK (1350) | reference/68ks4k.htm |

The table is the original's, typos included: it has `SME`, `SSF`, `SST` where the
assembler's mnemonics are `SMI`, `SF`, `ST`, and it lacks `BHS`, `BLO`, `DBF`, `DBT`,
`DBHS`, `DBLO`, `SHS`, `SLO`, `ELSE`, `NARG`, `MEXIT` and others; F1 on those words opens
the introduction. Context ids that exist but are not reachable by keyword:
`IDH_EASYBIN`, `IDH_IO_NETWORK`, `IDH_SIM_BREAKPOINT`, `IDH_SIM_MEMORY`,
`IDH_SIM_OPTIONS`, `IDH_SRECORD`.

### 15.4 About box (`AboutBox`, `aboutS.dfm` (binary), `aboutS.cpp`)

Modal dialog titled `About EASy68K`, centred on the screen. Content, top to bottom:

* program icon and the bold title `EASy68K Editor/Assembler v5.16.01` (set from `TITLE`,
  `aboutS.cpp:24`);
* `The author of this software assumes no liabilty of its functionality and is not responsible for misuse by the user.  Use at your own risk.  This application is distributed under the GNU general public use license.`
  (sic);
* `GUI design: Tim Larson`
* `Original assembler code: Paul McKee`
* `Modifications and New Features: Charles Kelly`
* a green, bold, underlined link `www.easy68k.com` (tool-tip `http://www.easy68k.com`);
  clicking it opens `http://www.easy68k.com` in the default browser (`aboutS.cpp:67-70`);
* `Post comments and bug reports to the EASy68K forum.`
* at the right, the label `Check for update?` above a `Check` button: it downloads
  `http://www.easy68k.com/version.txt` and shows `Up to date` if the body equals
  `5.16.01`, otherwise `Update available`; any failure shows `Network error`
  (`aboutS.cpp:85-116`);
* `OK` button (default) closes the dialog.

Easter egg (`aboutS.cpp:29-63`): typing B, M, W in sequence makes a hidden picture slide
across the dialog (10 pixels every 20 ms).

---

## 16. Catalogue of user-visible messages in the editor UI

Texts are exact; two consecutive spaces are intentional.

| Text | Buttons / icon | When | Source |
|---|---|---|---|
| `Help file not found` + newline + path | OK | start-up, `help.chm` missing | `mainS.cpp:149` |
| `HTML Help was not detected on this computer. EASy68K help may not work correctly.` | OK | start-up | `mainS.cpp:154` |
| `Error loading Html Help` | OK | start-up | `mainS.cpp:123` |
| `HTML Help was not detected on this computer. The HTML help viewer may be downloaded from msdn.microsoft.com` | OK | any help request without HTML Help | `mainS.cpp:568` |
| `Html Help may not have closed correctly` | OK | exit | `mainS.cpp:807` |
| `File exists! OK to overwrite?` (title `Caution!`) | Yes / No | Save As onto an existing file | `mainS.cpp:188` |
| `Error in SaveFont()` | OK, information | trailer could not be appended | `mainS.cpp:257` |
| `File Access Error.  Please verify the file name and that you have the proper permissions to open the file.` | OK, error | opening a file that does not exist | `mainS.cpp:278` |
| `<name> is already open. Do you want to discard changes and reopen?` | Yes / No, confirmation | opening a file that is open and modified | `mainS.cpp:291-292` |
| `File Access Error.  Please verify that you have write permission to the folder where the selected file is located.` | OK, error | exception while assembling | `mainS.cpp:383` |
| `Printer error.  Please check printer.` | OK, error | exception while printing | `mainS.cpp:508` |
| `End of document reached.` | OK, information | search text not found | `mainS.cpp:639` |
| `File modified, do you wish to save '<name>' before closing?` | Yes / No / Cancel, confirmation | closing a modified document | `textS.cpp:934-936` |
| `<name> is modified. Do you want to discard changes and reopen?` | Yes / No, confirmation | Reload File on a modified document | `textS.cpp:1004-1005` |
| `Undo/Redo limit reached. File save recommended.` | OK, warning | out of memory while recording undo | `textS.cpp:1642, 1658` |
| `Error in LoadFile()`, `Error in setting all tabs`, `Error setting tabs`, `Error in NewProject().`, `Error in NewSourceFile().`, `Error in FormCloseQuery().`, `Undo/Redo stack error.`, `Error in Undo.`, `Error in Redo.`, `Error in exec_undo.`, `Error in SourceTextProtectChange().`, `Error in SourceTextChange().` | OK | internal exception handlers | `textS.cpp:202, 431, 489, 873, 917, 953, 1671, 1685, 1723, 1758, 1804, 1844, 1906, 1925`; `editorOptions.cpp:167` |
| the Sim68K-options question of section 11.1 | Yes / No, information | Assembler Options OK | `optionsS.cpp:56-66` |
| `Error saving editor settings`, `Error loading editor settings`, `Error configuring default editor settings` | OK, information | settings file problems | `optionsS.cpp:218, 909, 977` |
| `Error creating temp file.`, `Error reading source file.`, `Unable to create listing file`, `Unable to create S-Record file` (title `Error`) | OK | assembling | `ASSEMBLE.CPP:165-172`, `LISTING.CPP:98-99`, `OBJECT.CPP:134-135` |
| `An Error occurred in the included file <name>.` / `The file is currently open and has been modified.` / `The line numbers of errors may not be correct.` (three lines) | OK | first message from a modified, open include file | `ERROR.CPP:257-261` |
| status-bar texts `Modified`, `Insert`, `Replace`, `SYNTAX` | - | section 7.2 | `textS.cpp:243, 253, 255, 1232` |
| About-box texts `Up to date`, `Update available`, `Network error` | - | section 15.4 | `aboutS.cpp:91-115` |

---

## 17. Dead code and unused UI (do not port)

| Item | Why it is dead |
|---|---|
| `undo.cpp`, `undo.h` (line-based undo with `UNDO_LIMIT = 10000`, functions `SaveUndo`, `SaveRedo`, `WorkUndo`, `UnDo`, `ReDo`, `exec_undo`) | not in `EDIT68K.bpr`; superseded by the undo code in `textS.cpp` |
| `listS.cpp/.h/.dfm` (`TListFile`, a separate read-only listing window) | not in the project; listings open in an ordinary edit window |
| `fontForm1.cpp/.h/.dfm` (`TfontForm`, "Adjust Font" dialog with `&Update Font` / `C&lose`) | not in the project; replaced by Editor Options |
| `preview.dfm/.h`, `Preview_dlg.dfm/.h` (print preview) | no `.cpp`, not in the project |
| `newhelpS.dfm/.h` (`TNewHelp`, embedded web-browser help window "EASy68K Editor Help") | no `.cpp`, not in the project |
| `util.cpp/.h`, `CProject.h` | empty stubs |
| `chksaveS.*` (`TChkSave`, "Save source file?" with `&Yes`/`&No`) | compiled and created, but never shown |
| `TMain::Reload1Click` (`mainS.cpp:891-895`), `TTextStuff::tbNewClick`, `tbPrintClick`, `EditorOptions1Click` (`textS.cpp:806-816, 958-961`) | event handlers not attached to any control |
| `TTextStuff::ProfileStart/ProfileEnd/ProfileClear` (`textS.cpp:82-103`) | timing helpers, never called |
| `ProgressBar` in the edit window, status-bar panel 3, `NMHTTP1` on the main form (`mainS.dfm:1184-1194`) | never used |
| `FileInfo::CreateList`, `FileInfo::ListOpen`, `TOptions::iSelStart`, `TAssemblerBox::batFileEx`, `TAssemblerBox::ListF` | never read |
| `Print w/Black` option | control disabled; no effect |

---

## 18. Where the help text and the source disagree (the source wins)

| Topic | Help says | Source does |
|---|---|---|
| Indent/outdent keys | "Ctrl+>" and "Ctrl+<" (`BasicOperation.htm`) | Ctrl+Shift+key code 190 / 188 (`textS.cpp:27-28, 353-360`); the same thing on a US keyboard only |
| Auto save | "the assembler will save all modified source files before assembling" (`options.htm`) | only the **active** document is saved (`mainS.cpp:351-354`) |
| Print w/Black | "Printing will not use colors when checked" (`options.htm`) | the option is disabled and ignored; printing is always uncoloured |
| Editor Options Cancel | "Click Cancel to exit without making any changes" (`options.htm`) | Auto Indent / Real Tabs change at once; font and tab controls are not restored (11.2) |
| Help button of Editor Options | implied: options help | opens the introduction page (15.2) |
| `Open File...` | "Loads an existing 68000 source file" (`BasicOperation.htm`) | opens any file; `.L68`/`.S68` open as list documents |
| Menu names | `file_operations.htm` (an orphan page, not in the contents tree): menu File, items "New 68K Source File" and "Open..." | `New X68 Source File`, `Open File...` |
| Main window title | screenshot `Images\Main.PNG` shows `EASy68K Editor/Assembler` | `EASy68K Editor/Assembler v5.16.01` (`asm.h:35`) |
| Colour grid | screenshot shows a light-grey swatch at row 4, column 4 | `clWhite` there and `clMedGray` at row 3, column 1 (`editorOptions.dfm:552, 664`) |
| Toolbar name of Assemble | `Getting Started.txt`: "Assemble Active Source" | hint `Assemble Source (F9)` |
| Template | n/a | the source tree's `template.NEW` is not the one shipped (section 12) |

---

## 19. Porting hazards and recommendations

### 19.1 Things that affect whether students' files and output match the real program

1. **Font/tab trailer (6.3, 6.4).** `.X68` files written by the real program end with four
   `*~...~` lines that the real editor strips on load and never passes to the assembler.
   The port must strip them the same way (last four lines only, same prefixes) before
   showing or assembling the text; otherwise they appear in the editor and in the `.L68`
   listing, which then differs from the original. When saving `.X68`, write the trailer so
   that files stay byte-compatible with the real program.
2. **Assemble the editor buffer, not the file on disk (10.2).** With auto-save off the
   original assembles unsaved text. The outputs are still named after the document path.
3. **Line endings at the editor/assembler boundary.** The original writes the temporary
   source with CR LF and the assembler opens it with `fopen(fileName, "r")`
   (`ASSEMBLE.CPP:170`), which in the Borland runtime is text mode and strips the CR. The
   listing and S-record are opened with `"w"` (text mode, LF written as CR LF)
   (`LISTING.CPP:96`, `OBJECT.CPP:132`). Emscripten has no text mode: give the WASM core
   LF-only input, and convert its output to CR LF if the `.L68`/`.S68` files are to be
   byte-identical to the Windows ones.
4. **Character encoding.** The original reads and writes single-byte ANSI text
   (Windows-1252 in practice) and passes those bytes to the assembler, where they become
   `DC.B` data. A web UI that decodes as UTF-8 and re-encodes will change bytes >= 0x80.
   Decode and encode with Windows-1252 (or another byte-preserving mapping) end to end.
5. **Tab settings are assembler input (10.3).** The listing expands tab characters with
   the document's tab type and size; pass both to the core. Note the `<=` rule of 8.1: with
   Assembly tabs a tab at column 12, 20 or >= 44 expands to nothing in the listing.
6. **Bit-field option** changes both assembly and highlighting (9.5c).
7. **Output file names** use `ChangeFileExt`: same folder, same base name, extensions
   exactly `.L68` and `.S68` (upper case).
8. **State that survives between assemblies (cross-scope note for the assembler core).**
   The editor process assembles many times without restarting, and some assembler globals
   are not re-initialised per run: `createdL68` is reset only inside `initList`
   (`LISTING.CPP:90-95`), which is skipped when *Generate List File* is off, and
   `nestLevel` (`ASSEMBLE.CPP:144`) is initialised once. Whether the WASM core is
   re-instantiated for every assembly or kept alive decides whether such carry-over is
   reproduced; this must be a deliberate choice.

### 19.2 Windows-isms that need a decision

9. **Shortcuts.** Ctrl+O/S/P/F/R/A/Z/X/C/V, Ctrl+Alt+Z/C/U, F3, F9 and Ctrl+Shift+`.`/`,`
   collide with browser and macOS conventions (reload, print, find; AltGr/Option
   characters; function keys needing Fn). Keep the same key letters where possible (Cmd for
   Ctrl on macOS) and keep F9 and F3 as alternatives; show the chosen shortcuts in the
   menus.
10. **MDI.** Cascade/Tile/Arrange/Minimize All and "maximised child" have no direct web
   equivalent. A tab strip per document with a `Window` menu listing the documents keeps
   the commands' names meaningful; the architect must decide what the four arrangement
   commands do.
11. **Fonts.** The dialog offers `Courier`, `Courier New`, `Fixedsys` with fixed size lists,
    and each `.X68` file carries a font name and size. `Fixedsys` does not exist on macOS;
    map unknown fonts to a monospace fallback for display but **preserve the stored name
    and size when re-saving** a file whose font was not changed.
12. **`settings.dat` and `template.NEW` live next to the executable**, which is not
    writable inside a macOS app bundle or a web page. Store them in user storage; keep the
    file format so real files can be imported and exported.
13. **Execute** starts a second program with the `.S68` path. In a single web app this
    becomes "switch to the simulator view and load the freshly built S-record (and
    listing)". The original does not auto-run.
14. **Help** is a `.chm`. Serve the HTML pages directly and reproduce the keyword table of
    15.3; decide whether the options dialogs should open `options.htm` (intent) or
    `main.htm` (actual).
15. **About | Check** fetches `http://www.easy68k.com/version.txt` over plain HTTP; drop or
    replace it in an unofficial port. The About text names the original authors and the
    GPL; an unofficial port must keep the credits and add its own notice.
16. **Printing** goes through the Windows printer API; in a web UI use the browser's print
    with a monospace, uncoloured rendering, tabs expanded, and page breaks at
    `NEW_PAGE_MARKER` lines.
17. **Drag-and-drop of files** onto the window and **command-line/file-association open**
    map to browser file drop and macOS "open with".

### 19.3 Original defects - recommended not to reproduce

Each is described where it occurs; none changes assembler or simulator results.

| Defect | Section | Recommendation |
|---|---|---|
| Commands dereference a missing active window | 2.2 | disable or ignore |
| Global enable flags ignore the active window's type | 2.7 | compute per active document; keep Assemble available for any source document |
| Save prompt saves the active document instead of the one being closed; closing proceeds when Save As is cancelled | 6.6 | save the right document; cancelling Save As cancels the close |
| One blank line added per open/save cycle | 6.4 | architect's choice; reproducing it keeps files byte-identical to what the real program would write after the same steps |
| `untitledN` numbers skip | 6.8 | harmless; either way |
| Ctrl+Shift+arrow selection blocked; Ctrl+Insert flips the indicator | 5.2 | do not reproduce |
| Tab inserts nothing at columns 12, 20 and >= 44 with Assembly tabs; Shift+Tab = Tab | 8.2 | architect's choice - this is visible editor behaviour that students may be used to; a friendlier rule (advance to the next stop) changes only what is typed, not what is assembled |
| Status-bar column uses the global tab size and counts tabs | 7.2 | compute the true visual column |
| Comment/indent do nothing at column 0 without a selection; their undo can corrupt text | 8.5 | act on the caret line; correct undo |
| Redo stack not cleared after a new edit; overtype typing not undoable; undo-to-empty clears "Modified" after a save | 8.6, 8.9 | standard undo/redo semantics; track the saved state properly |
| Highlighter mis-handles operands starting with `.` and labels containing `.` | 9.7 | architect's choice; reproducing is only cosmetic |
| Include-file messages steal the active window | 10.5 | keep the assembled document's identity; still route messages to the include file's window |
| Execute enabled without an S-record | 10.4 | enable only when an S-record was produced with zero errors |
| Assembler Options Cancel does not cancel; Editor Options Cancel partly applies; modified flag undefined after Editor Options OK; font size bucketed when the dialog opens | 11.1, 11.2 | make Cancel cancel; preset the real size; leave the modified flag alone |
| Find starts from the top when nothing is selected; Replace replaces any selection; empty replacement skips a character | 14 | architect's choice; at minimum do not replace a non-matching selection |

---

## 20. Acceptance checks for the port

These are derived by tracing the source; they are the checks a tester should run against
the port (and, where a Windows machine is available, against the real program).

### 20.1 Syntax highlighting vectors

Leading blanks are significant; lines that start with four blanks are shown that way.
Bit-field option on unless stated. Unlisted parts of a line are Code.

| # | Line | Expected styles |
|---|---|---|
| 1 | `* comment` | whole line Comment |
| 2 | `    ; comment` | whole line (from column 0) Comment |
| 3 | `START:  ORG    $1000   set origin` | `START:` Label; `ORG` Directive; `$1000` Code; `set origin` Comment |
| 4 | `    MOVE.B  #'A',D0     load char` | `MOVE.B  #` Code; `'A'` Text; `,D0` Code; `load char` Comment |
| 5 | `LOOP    DBRA    D0,LOOP` | `LOOP` Label; rest Code |
| 6 | `    PRINT   msg     macro call` | `PRINT   msg     macro call` Macro/Other |
| 7 | `    IF.B D0 <EQ> #1 THEN.S    do it` | `IF.B D0 <EQ> #1 THEN.S` Structured; `do it` Comment |
| 8 | `    IF D0 <EQ> #1 THE` | `IF D0 <EQ> #1 THE` Structure Error |
| 9 | `    ELSE` | `ELSE` Structured |
| 10 | `    ENDI    end if` | `ENDI` Structured; `end if` Comment |
| 11 | `    WHILE <T> DO` | all Structured |
| 12 | `    FOR D1 = #1 TO #10 BY #2 DO` | all Structured |
| 13 | `    FOR D1=#1 TO #10 DO` | from `FOR` to end Structure Error (the `=` must be a separate token) |
| 14 | `    DBLOOP D0 = #10` | all Structured |
| 15 | `    UNLESS D0 <NE> #0` | all Structured |
| 16 | `    UNTIL D0 <EQ> #0 DO` | all Structured |
| 17 | `    REPEAT` | Structured |
| 18 | `MSG     DC.B    'Hello',0     text` | `MSG` Label; `DC.B` Directive; `'Hello'` Text; `,0` Code; `text` Comment |
| 19 | `    DC.B    'It''s',0` | `DC.B` Directive; `'It''s'` Text; `,0` Code |
| 20 | `    DC.B 'unterminated` | `DC.B` Directive; `'unterminated` Structure Error |
| 21 | `    MOVE.L  (A0,D1` | `MOVE.L  (A0,D1` Structure Error |
| 22 | `    SIMHALT             ; halt simulator` | `SIMHALT` Directive; `; halt simulator` Comment |
| 23 | `    END    START        ; last line of source` | `END` Directive; `START` Code; `; last line of source` Comment |
| 24 | `START:                  ; first instruction of program` | `START:` Label; rest Comment |
| 25 | `    NOP     no operation` | `NOP` Code; `no operation` Comment |
| 26 | `    MOVE    D0, D1     comment` | `MOVE    D0, D1` Code; `comment` Comment |
| 27 | `    FAIL    this is an error` | `FAIL` Directive; rest Code |
| 28 | `    BFINS   D0,(A0){4:8}` | all Code; with the bit-field option off: `BFINS   D0,(A0){4:8}` Macro/Other |
| 29 | `  loop:  ADD D1,D2` | columns 0-6 (`  loop:`) Label; `ADD D1,D2` Code |
| 30 | `MOVE D0,D1` (in column 0) | `MOVE` Label; `D0,D1` Macro/Other |
| 31 | `    INCLUDE 'file.x68'    comment` | `INCLUDE` Directive; `'file.x68'` Text; `comment` Comment |
| 32 | `NAME    EQU     5` | `NAME` Label; `EQU` Directive; `5` Code |
| 33 | `    move.b  d0,d1` | all Code (matching is case-insensitive) |
| 34 | `    MEMORY  ROM $001000,$002000   my rom` | `MEMORY` Directive; `ROM $001000,$002000` Code; `my rom` Comment |
| 35 | `    BRA     .loop       go back` | original: `BRA     .loop       go` Code, `back` Comment (quirk 9.7) |
| 36 | (empty line or blanks only) | no styling |

Also check: every preset (`Color1`, `Color2`, `No Color`, `Disabled`) and a custom colour,
bold, italic and underline per element; highlighting absent in `.L68`/`.S68` windows.

### 20.2 Files

* Open each file in `official-extracted\Examples\`: no `*~` line is visible; font and tab
  settings shown under `Current File Info` are `Courier New`, `10`, tab size `4`, tab type
  `Fixed`.
* New file, save as `t.X68`: the file is the template text, one CR LF, then the four
  trailer lines (`*~Font name~Courier New~`, `*~Font size~10~`, `*~Tab type~1~`,
  `*~Tab size~4~`), each with CR LF.
* Save the same text as `t.ASM`: no trailer.
* Hand-made file with only `*~Tab type~0~` as its last line: opens with Assembly tabs, the
  line is removed, the other settings come from the options.
* A file with bytes 0x80-0xFF inside a `DC.B` string assembles to the same S-record bytes
  after an open/save round trip.
* Modified document: Close File -> prompt with Yes/No/Cancel and the exact text of 16.
* Open an already open, modified file -> the "already open" question.
* Reload File on a modified, named document -> the "is modified" question.
* Save As onto an existing name -> `File exists! OK to overwrite?`.
* Drag two files onto the window -> both open.

### 20.3 Editing

* Real Tabs off, Fixed tabs, size 4: Tab at columns 0, 1, 3, 4 inserts 4, 3, 1, 4 spaces.
* Real Tabs off, Assembly tabs: Tab at 0-based column 0 -> 12 spaces; 5 -> 7; 13 -> 7;
  21 -> 23 (original: nothing at 12, 20, 44 and beyond).
* Real Tabs on: Tab stores one tab character; with Assembly tabs it displays to columns
  12, 20, 44.
* Auto Indent on: Enter at the end of a line that starts with four blanks (or a tab)
  yields a new line starting with the same white space; Enter in the middle of a line does
  not add white space; off: no white space.
* Comment Selection on three selected lines puts `*` in column 0 of each; Uncomment
  removes one `*` per line only where column 0 is `*`; Ctrl+Shift+`.` / `,` add / remove
  one space.
* Insert toggles `Insert`/`Replace` in the status bar and overtype in the editor.
* Status bar shows `line: column`, `Modified` after an edit and empty after Save.
* Undo reverses single typed characters one at a time; Paste, Cut, Comment are single
  steps; Redo is Ctrl+Alt+Z.
* Paste of rich text arrives as plain text.

### 20.4 Assemble

* F9 on the template: dialog `Assembler Status - untitled1.x68`, `Warnings: 0`,
  `Errors: 0`, Execute enabled; `untitled1.L68` and `untitled1.S68` created.
* A source with one bad opcode: `Errors: 1`, Execute disabled, the message list opens with
  one row (line number, `ERROR: Invalid opcode`); double-click selects that line.
* A source without `END`: `Warnings: 1`, row `WARNING: END directive missing, starting
  address not set`; with Show Warnings off the row is absent but the dialog still says
  `Warnings: 1`.
* Uncheck Generate List File, press OK in Assembler Options -> the Sim68K question;
  No re-checks both boxes.
* Auto Save on + modified named document -> file on disk updated before assembling; off ->
  file on disk unchanged but outputs reflect the edited text.
* Load L68 opens `<name>.L68` in a new, uncoloured window.
* Execute loads `<name>.S68` in the simulator without running it.

### 20.5 Settings

* Delete the settings store, start: defaults of 11.4. Change every option, quit, restart:
  all restored, including window size/position and "edit window maximised".
* Import the shipped `settings.dat`: values of the "Shipped file" column.
* A `settings.dat` with one line removed in the middle: settings before it load, settings
  after it are defaults (if the original's positional reader is reproduced).

### 20.6 Find / Replace

* Ctrl+F with a word selected preloads it; Enter finds the next occurrence after the
  selection; at the end `End of document reached.`; the following F3 starts from the top.
* Match case and whole-word options behave as named.
* Replace All `D0` -> `D1` on a text with three occurrences replaces all three and ends
  with the end-of-document box.

---

## 21. Completeness index

Every function defined in the in-scope source files, with the section that specifies it.

| File | Functions | Section |
|---|---|---|
| `EDIT68K.cpp` | `WinMain` | 0.3 |
| `mainS.cpp` | `LoadHtmlHelp`, `TMain::TMain` | 1.1, 15.1 |
| | `mnuSaveAsClick`, `mnuSaveClick`, `SaveFont`, `tbSaveClick` | 6.4 |
| | `mnuExitClick`, `FormClose` | 1.3 |
| | `OpenFile`, `mnuOpenClick`, `tbOpenClick`, `WmDropFiles` | 6.2, 1.4 |
| | `mnuDoAssemblerClick`, `tbAssembleClick` | 10 |
| | `mnuEditorOptionsClick`, `mnuAssemblerOptionsClick` | 2.4, 11 |
| | `mnuPrinterSetupClick`, `mnuPrintSourceClick` | 13 |
| | `mnuNewClick`, `tbNewClick` | 12 |
| | `mnuAboutClick`, `mnuHelpClick`, `displayHelp`, `FormKeyDown` | 15 |
| | `mnuFindClick`, `tbFindClick`, `FindDialogFind`, `FindNext`, `mnuFindNextClick`, `Edit1Click`, `mnuFindAndReplace1Click`, `ReplaceDialogReplace` | 14, 2.2 |
| | `FormShow` | 1.1 |
| | `EditPaste1Execute` | 8.7 |
| | `EditCommentAdd1Execute`, `EditUncomment1Execute` | 8.5 |
| | `EditUndoExecute`, `EditRedoExecute` | 8.9 |
| | `Reload1Click` | 6.5, 17 |
| `textS.cpp` | `TTextStuff::TTextStuff` | 7.1, 8.6 |
| | `ProfileStart`, `ProfileEnd`, `ProfileClear` | 17 |
| | `LoadFile` | 6.3 |
| | `UpdateStatusBar` | 7.2 |
| | `SourceTextKeyDown`, `SourceTextKeyUp`, `SourceTextKeyPress` | 5.2, 8.2, 8.4 |
| | `SetTabsAll`, `SetTabs`, `replaceTabs` | 8.3, 13.1 |
| | `commentSelection`, `unCommentSelection`, `indentSelection`, `outdentSelection`, `insertInSelection`, `deleteFromSelection` | 8.5 |
| | `FormClose`, `FormCloseQuery` | 6.6, 2.7 |
| | `ClearErrorMessages`, `MessagesDblClick`, `GetFirstPos`, `GetLastPos` | 4.2, 7.3 |
| | `SourceTextMouseUp`, `SourceTextMouseDown`, `SourceTextMouseMove`, `SourceTextSelectionChange` | 8.8 |
| | `FormShow`, `FormActivate`, `FormResize`, `SourceTextVertScroll` | 2.7, 8.9, 9.1 |
| | `tbNewClick`, `tbPrintClick`, `EditorOptions1Click` | 17 |
| | `NewProject`, `NewSourceFile` | 2.7, 6.8, 12 |
| | `EditorReload1Click` | 6.5 |
| | `getVisibleLineCount`, `colorHighlight`, `HighlightTimerTimer`, `checkRelational`, `highlightLine`, `highlightOperand`, `setFontStyle` | 9 |
| | `SaveUndo`, `SaveRedo`, `clearRedo`, `clearUndoRedo`, `Undo`, `Redo`, `exec_undo`, `SourceTextProtectChange`, `SourceTextChange` | 8.9 |
| `editorOptions.cpp` | `cmdCancelClick`, `cmdOKClick`, `FormShow`, `cbFontChange`, `FormKeyDown`, `AutoIndentClick`, `AutoIndentKeyPress`, `RealTabsClick`, `RealTabsKeyPress`, `cmdHelpClick`, `StaticTextClick`, `BoldClick`, `ItalicClick`, `UnderlineClick`, `setSyntaxPreviewColor`, `setSyntaxPreviewStyle`, `ElementClick`, `highlightPreview`, `FormClose`, `SyntaxComboChange` | 11.2 |
| `optionsS.cpp` | `cmdCancelClick`, `cmdOKClick`, `FormShow`, `SaveClick`, `FormKeyDown` | 11.1 |
| | `SaveSettings`, `LoadSettings`, `defaultSettings` | 11.4 |
| `assembleS.cpp` | `cmdExecuteClick`, `cmdCloseClick`, `FormClose`, `FormShow`, `cmdLoadL68Click` | 10.4, 10.6, 10.7 |
| `findDialogS.cpp` | `findNextBtnClick`, `cancelBtnClick`, `findTextChange`, `FormShow` | 14.1 |
| `replaceDialogS.cpp` | `findNextBtnClick`, `cancelBtnClick`, `findTextChange`, `replaceBtnClick`, `replaceAllBtnClick` | 14.3 |
| `aboutS.cpp` | `FormCreate`, `FormKeyPress`, `Timer1Timer`, `Label1Click`, `Label1MouseEnter`, `Label1MouseLeave`, `CheckButtonClick`, `NMHTTP1Failure`, `NMHTTP1InvalidHost`, `NMHTTP1ConnectionFailed` | 15.4 |
| `help.cpp` | `getHelpContext` | 15.1, 15.3 |
| `chksaveS.cpp` | `FormCreate`, `btnOKClick`, `Button2Click` | 6.6, 17 |
| `fontForm1.cpp` | `cmdCloseClick`, `cmdChangeClick`, `FormShow`, `cbFontChange` | 17 |
| `listS.cpp` | `FormClose`, `ListKeyDown`, `ListKeyPress`, `ListKeyUp`, `ListMouseUp`, `ListMouseDown` | 17 |
| `undo.cpp` | `SaveUndo`, `SaveRedo`, `WorkUndo`, `UnDo`, `ReDo`, `exec_undo` | 17 |
| `util.cpp` | `Right` | 17 |

Global flags and where they are specified: `listFlag`, `objFlag`, `CEXflag`, `BITflag`,
`CREflag`, `MEXflag`, `SEXflag`, `WARflag` (10.2, 11.1); `tabType` (11.4);
`maximizedEdit` (1.1, 11.4); `autoIndent` (8.4); `realTabs` (8.2); `codeStyle`,
`unknownStyle`, `directiveStyle`, `commentStyle`, `labelStyle`, `structureStyle`,
`errorStyle`, `textStyle`, `backColor` (9.2); `highlightDisabled` (9.1, 11.2); `col`,
`mouseDrag`, `mouseDragging` (7.2, 8.8); `Options->bSave` (10.2); `iNewFiles`,
`iSourceOpen`, `iListsOpen` (2.7, 6.8); editor-options temporaries `styleChange`,
`syntaxDisabled`, `inElementClick` and the `*StyleTemp` copies (11.2).

---

## 22. Open questions for the architect

1. **Quirk policy.** Section 19.3 lists the original's editor defects. None changes
   assembler or simulator output, so the recommendation is to fix them, but three are
   visible habits of the real program and need an explicit decision: Tab doing nothing at
   Assembly-tab columns 12/20/44+ (8.2), Find starting from the top of the document when
   nothing is selected (14.2), and the extra blank line per open/save cycle (6.4).
2. **Trailer on save.** Should the port append the `*~Font name~ ... *~Tab size~` trailer
   to `.X68` files exactly as the original does (recommended, for byte compatibility with
   files exchanged with the real program), and what font name should it write when the
   user's display font is a macOS substitute?
3. **Where settings and the template live** in the web app and in the `.app`, and whether
   import/export of a real `settings.dat` is required.
4. **Which template ships**: the installer's `template.NEW` (12.2) is what students see in
   the real program; the source tree's (12.3) is older.
5. **MDI mapping**: what `Arrange`, `Cascade`, `Tile Horizontally`, `Tile Vertically` and
   `Minimize All` do in a tabbed web UI, or whether floating child windows are emulated.
6. **Shortcut mapping** on macOS and inside a browser (Cmd vs Ctrl, F9/F3 on laptops,
   Ctrl+Alt combinations versus Option-key characters, browser-reserved Cmd+R/P/F/O/S).
7. **Execute**: single-window hand-off to the simulator view, or a separate window/tab per
   Execute as in the original (which starts a new simulator process every time).
8. **Unsaved documents**: the original assembles `untitledN.x68` into the current
   directory. Where do `.L68`/`.S68` of an unsaved document go in the port (virtual file
   system only?).
9. **Include files**: the original opens an include file in the editor when it produces a
   message (10.5). In a browser the include file must already be reachable; how are
   `INCLUDE`/`INCBIN` paths resolved against user-chosen files or folders?
10. **Help**: ship the original HTML help pages (licence of the bundled 68000 reference
    guide and images to be confirmed before a public release) and decide the target of the
    options dialogs' Help (15.2).
11. **About / update check**: wording for an unofficial port, retention of the original
    credits and GPL notice, and removal or replacement of the `version.txt` check.
12. **Items marked UNVERIFIED** (bare-LF files, Shift+Tab with Real Tabs on, default
    extension appended by Save As, toolbar hint texts with shortcuts, default button of the
    Replace dialog, default preset index) can only be settled on a Windows machine running
    the real v5.16.1; decide whether that verification is required for release.

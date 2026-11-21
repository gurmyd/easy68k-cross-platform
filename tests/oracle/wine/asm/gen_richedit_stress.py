#!/usr/bin/env python3
"""Generate small .X68 files that stress the editor's RichEdit round trip
(load into the control, save to EASy68Ks.tmp). Each is a valid program; the
interesting bytes sit in comments or DC strings.

  gen_richedit_stress.py OUTDIR
"""
import os
import sys

HEAD = b"    ORG     $1000\r\nSTART:\r\n"
TAIL = b"    SIMHALT\r\n    END     START\r\n"


def prog(body, head=HEAD, tail=TAIL):
    return head + body + tail


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    files = {}
    # every byte value 0x01..0xFF except CR/LF/NUL/0x1A, in comment lines (16 per line)
    rows = []
    for base in range(0, 256, 16):
        bs = bytes(b for b in range(base, base + 16) if b not in (0, 10, 13, 0x1A))
        rows.append(b"* bytes %02X: " % base + bs + b"\r\n")
    files["s01_all_bytes_comment.X68"] = prog(b"".join(rows))
    # bytes 0x80..0xFF inside a DC.B string (reach the object code)
    s = bytes(range(0x80, 0x100)).replace(b"'", b"")
    files["s02_high_bytes_dcb.X68"] = prog(b"    DC.B    '" + s[:60] + b"',0\r\n    DC.B    '" + s[60:] + b"',0\r\n")
    # long lines
    for n in (255, 256, 300, 1000, 4000):
        files["s03_long_line_%d.X68" % n] = prog(b"* " + b"x" * (n - 2) + b"\r\n    NOP\r\n")
    files["s04_long_dc_line.X68"] = prog(b"    DC.B    " + b",".join(b"%d" % (i % 100) for i in range(400)) + b"\r\n")
    # line endings
    files["s05_bare_cr.X68"] = prog(b"    NOP\r    NOP\r* bare CR above\r\n").replace(b"\r\n", b"\r")
    files["s06_mixed_endings.X68"] = prog(b"    NOP\n    NOP\r\n    NOP\r    NOP\n")
    files["s07_lf_only.X68"] = prog(b"    NOP\r\n    NOP\r\n").replace(b"\r\n", b"\n")
    files["s08_no_final_newline.X68"] = prog(b"    NOP\r\n")[:-2]
    files["s09_crcrlf.X68"] = prog(b"    NOP\r\r\n    NOP\r\r\n")
    # control characters
    files["s10_ctrl_z_mid.X68"] = prog(b"    NOP\r\n* before ctrl-Z\x1a after\r\n    NOP\r\n")
    files["s11_ctrl_z_end.X68"] = prog(b"    NOP\r\n") + b"\x1a"
    files["s12_nul_in_comment.X68"] = prog(b"* before NUL\x00 after NUL\r\n    NOP\r\n")
    files["s13_formfeed_vt.X68"] = prog(b"*\x0c form feed\r\n*\x0b vertical tab\r\n    NOP\r\n")
    # tabs and trailing white space
    files["s14_tabs.X68"] = prog(b"\tNOP\t\t; tab separated\r\nLBL:\tMOVE.L\t#1,D0\t* c\r\n    NOP   \t  \r\n")
    # UTF-8 text and a BOM
    files["s15_utf8_comment.X68"] = prog("* café – naïve “quotes” €\r\n    NOP\r\n".encode("utf-8"))
    files["s16_utf8_bom.X68"] = b"\xef\xbb\xbf" + prog(b"    NOP\r\n")
    # trailer variants (editor strips these lines)
    files["s17_trailer.X68"] = prog(b"    NOP\r\n") + b"\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n"
    files["s18_trailer_lf.X68"] = (prog(b"    NOP\r\n") + b"\r\n*~Font name~Fixedsys~\r\n*~Font size~9~\r\n*~Tab type~0~\r\n*~Tab size~8~\r\n").replace(b"\r\n", b"\n")
    files["s19_trailer_no_newline.X68"] = prog(b"    NOP\r\n") + b"\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~"
    files["s20_empty.X68"] = b""
    # a trailer line that ends before LoadFile's loop finds its '~' (textS.cpp:144-146): the
    # AnsiString index check throws, and the catch shows "Error in LoadFile()" (errata/E1.md 2)
    files["s21_trailer_short_tab_size.X68"] = prog(b"    NOP\r\n") + b"\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4\r\n"
    for name, data in files.items():
        with open(os.path.join(out, name), "wb") as f:
            f.write(data)
    print("\n".join(sorted(files)))


if __name__ == "__main__":
    main()

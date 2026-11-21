"""Compare the text EDIT68K handed to its assembler (captured EASy68Ks.tmp)
with what the source file should give.

Expected text model (from the editor source):
- the file is loaded into the RichEdit control as plain text
  (TTextStuff::LoadFile, textS.cpp:128);
- trailer lines "*~Font name~", "*~Font size~", "*~Tab type~", "*~Tab size~"
  among the last lines are deleted (textS.cpp:140-173: indices count .. count-4);
- the buffer is saved with Lines->SaveToFile (mainS.cpp:373): every line ends
  in CR LF, and the last line ends in CR LF only if the text did.

Line breaks in the source are taken to be CR LF, bare LF or bare CR. How the
real Windows RichEdit 1.0 treats bare LF and bare CR is NOT known (editor-ui.md
6.7, UNVERIFIED), so files that contain them are reported separately.
"""
import re

TRAILER_PREFIXES = (b"*~Tab size~", b"*~Tab type~", b"*~Font size~", b"*~Font name~")


def expected_buffer(src: bytes) -> bytes:
    ends_nl = src.endswith(b"\n") or src.endswith(b"\r")
    lines = re.split(rb"\r\n|\n|\r", src)
    if ends_nl:
        lines.pop()
    count = len(lines)
    for cnt in range(count, count - 5, -1):
        if 0 <= cnt < len(lines) and lines[cnt].startswith(TRAILER_PREFIXES):
            del lines[cnt]
    out = b"\r\n".join(lines)
    if ends_nl and lines:
        out += b"\r\n"
    return out


def source_features(src: bytes) -> dict:
    lines = re.split(rb"\r\n|\n|\r", src)
    crlf = src.count(b"\r\n")
    lf_only = src.count(b"\n") - crlf
    cr_only = src.count(b"\r") - crlf
    return {
        "bytes": len(src),
        "crlf": crlf,
        "bare_lf": lf_only,
        "bare_cr": cr_only,
        "high_bytes": sum(1 for b in src if b >= 0x80),
        "nul_bytes": src.count(b"\x00"),
        "tabs": src.count(b"\t"),
        "longest_line": max((len(l) for l in lines), default=0),
        "final_newline": src.endswith(b"\n") or src.endswith(b"\r"),
        "has_trailer": b"*~Font name~" in src,
    }


def classify(src: bytes, got: bytes) -> dict:
    """Return {'identical': bool, 'kinds': [...], 'detail': str}."""
    exp = expected_buffer(src)
    if exp == got:
        return {"identical": True, "kinds": [], "detail": ""}
    kinds = []
    el = exp.split(b"\r\n")
    gl = got.split(b"\r\n")
    # differ only in final newline?
    if exp.rstrip(b"\r\n") == got.rstrip(b"\r\n"):
        kinds.append("final-newline")
    # differ only in line-ending style?
    norm = lambda b: re.sub(rb"\r\n|\r|\n", b"\n", b)
    if norm(exp) == norm(got) and "final-newline" not in kinds:
        kinds.append("line-endings")
    first = None
    for i in range(max(len(el), len(gl))):
        a = el[i] if i < len(el) else None
        b = gl[i] if i < len(gl) else None
        if a != b:
            first = (i + 1, a, b)
            break
    diff_lines = [i for i in range(min(len(el), len(gl))) if el[i] != gl[i]]
    for i in diff_lines:
        a, b = el[i], gl[i]
        if any(c >= 0x80 for c in a) and "high-bytes" not in kinds:
            kinds.append("high-bytes")
        if b"\t" in a and "tabs" not in kinds:
            kinds.append("tabs")
        if len(a) > 255 and "long-line" not in kinds:
            kinds.append("long-line")
        if b"\x00" in a and "nul" not in kinds:
            kinds.append("nul")
    if len(el) != len(gl):
        kinds.append("line-count %d->%d" % (len(el), len(gl)))
    if not kinds:
        kinds.append("other")
    detail = ""
    if first:
        ln, a, b = first
        detail = "first difference at line %d: expected %r got %r" % (
            ln, (a or b"")[:120], (b or b"")[:120])
    return {"identical": False, "kinds": kinds, "detail": detail,
            "differing_lines": len(diff_lines), "expected_bytes": len(exp), "got_bytes": len(got)}

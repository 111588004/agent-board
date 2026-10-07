#!/usr/bin/env python3
"""Assertions on one tmux capture of the Agent Board band.
usage: band_check.py <kind> <cols> [--clean] < capture.txt
kind: linked | none | many | held | off | offline | noband
--clean: the capture holds no /board-sync output, so the old status-line style must be absent screen-wide.
Prints PASS/FAIL per assertion (and the screen on any FAIL); exit 1 on any FAIL."""
import re, sys
from termwidth import width

kind, cols = sys.argv[1], int(sys.argv[2])
clean = '--clean' in sys.argv
screen = sys.stdin.read().rstrip('\n')
lines = screen.split('\n')
bands = [l for l in lines if l.startswith('▌')]
fails = []


def check(name, ok, detail=''):
    print(f"  {'PASS' if ok else 'FAIL'} {kind}@{cols} {name}{' - ' + detail if detail and not ok else ''}")
    if not ok:
        fails.append(name)


def has(name, needle, min_cols=0, rx=False):
    if cols < min_cols:
        return
    hit = re.search(needle, band) if rx else needle in band
    check(f'has {name}', bool(hit), f'band={band!r}')


if kind == 'status':  # /board-sync status output: 70-cell content + the engine's 4-cell indent, no escape codes
    start = next((i for i, l in enumerate(lines) if '⎿' in l), None)
    check('status output found', start is not None)
    out = []
    for l in lines[(start or 0) + 1:]:
        if not l.strip():
            break
        out.append(l)
    check('status lines <= 78 cells', all(width(l) <= 78 for l in out), f'widest={max([width(l) for l in out] or [0])}')
    check('status has no escape codes', '\x1b' not in screen)
elif kind in ('off', 'noband'):
    check('no band line', not bands, f'got {bands!r}')
else:
    check('exactly one band line', len(bands) == 1, f'got {len(bands)}')
    band = bands[0] if bands else ''
    # (a) never wider than the terminal
    check('width <= cols', width(band) <= cols, f'width={width(band)}')
    # (e) the engine's [-] button must not sit on the band text: it starts at cols-3, so content must end before it
    m = re.search(r'\[-\]$', band.rstrip())
    if m:
        gap = (cols - 3) - width(band[:m.start()].rstrip())
        print(f'  INFO {kind}@{cols} text ends at cell {width(band[:m.start()].rstrip())}, [-] at cell {cols - 3}, free cells between: {gap}')
        check('gap before [-] >= 1', gap >= 1, f'text reaches the [-] cells: {band!r}')
    elif cols >= 20:
        check('[-] visible at right edge (else cannot judge overlap)', False, f'band={band!r}')
    # (d) the old ui.status style must be gone
    check('no ⚠ in band', '⚠' not in band)
    check('no "agent-board:" in band', 'agent-board:' not in band)
    if clean:
        check('no ⚠ on screen', '⚠' not in screen)
        check('no "agent-board:" on screen', 'agent-board:' not in screen)

    if kind == 'linked':
        has('card id', r'[A-Z]+-\d+', rx=True)
        has('status glyph', '◐')
        has('status word', r'in_progress|doing', 64, rx=True)
        has('in_progress', 'in_progress', 121)
        has('priority glyph', '▲', 45)
        has('branch', '⎇ feat/try-mod', 120)
        has('agent', 'claude', 70)
    elif kind == 'none':
        has('?', '?')
        has('no card text', 'no card for this branch')
        has('hint', '/board-sync new', 90)
    elif kind == 'many':
        has('≡', '≡')
        has('cards match', 'cards match')
        has('ids', r'[A-Z]+-\d+', 50, rx=True)
    elif kind == 'held':
        has('⊘', '⊘')
        has('held by codex', 'held by codex', 40)
        has('id', r'[A-Z]+-\d+', rx=True)
    elif kind == 'offline':
        has('✗', '✗')
        has('offline', 'offline')

if fails:
    print('--- screen ---\n' + screen + '\n--------------')
    sys.exit(1)

#!/usr/bin/env python3
"""WCAG contrast of the band's semantic colors, light vs dark theme, read from a real engine in tmux.

  python3 tests/e2e/contrast.py            # needs tmux, node, the trusted trial repo (see band-smoke.sh)
  env: CLAUDE_BIN, TRIAL_REPO, PORT (default 4366), ENGINE_ENV ("K=V K=V")

Each theme gets its own claude session started with --settings '{"theme":"light"|"dark"}' (a CLI flag, no
settings file is touched). The band line is captured with `tmux capture-pane -e`, its SGR colors are read as
256-color indexes, converted to RGB (xterm palette) and compared with white / near-white / near-black / black.
Limits (also printed): the terminal's real background is unknown (the engine's theme only picks the foreground),
and text drawn in the terminal default color is not measured."""
import json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MOD = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.environ.get('AB_ROOT') or os.path.abspath(os.path.join(
    subprocess.check_output(['git', '-C', HERE, 'rev-parse', '--git-common-dir'], text=True).strip(), '..'))
CLAUDE = os.environ.get('CLAUDE_BIN', '/Users/limao/Library/Application Support/Claude/claude-code/2.1.288/48d54124d3c3/claude.app/Contents/MacOS/claude')
REPO = os.environ.get('TRIAL_REPO', '/private/tmp/claude-501/-Users-limao-Agent-Board/0f5adf1c-6f3c-466d-8019-c33e8da56535/scratchpad/trial/repo')
PORT = int(os.environ.get('PORT', '4366'))
assert PORT not in (4316, 4317, 4352, 4353, 4354), 'port belongs to the user'
SOCK = f'qa{PORT}'
URL = f'http://localhost:{PORT}'


def api(method, path, body=None):
    req = urllib.request.Request(URL + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=5))


def tmux(*a):
    return subprocess.run(['tmux', '-L', SOCK, *a], capture_output=True, text=True).stdout


def xterm_rgb(n):
    if n < 16:
        return [(0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0), (0, 0, 238), (205, 0, 205), (0, 205, 205), (229, 229, 229),
                (127, 127, 127), (255, 0, 0), (0, 255, 0), (255, 255, 0), (92, 92, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255)][n]
    if n < 232:
        n -= 16
        lv = [0, 95, 135, 175, 215, 255]
        return (lv[n // 36], lv[(n // 6) % 6], lv[n % 6])
    g = 8 + 10 * (n - 232)
    return (g, g, g)


def lum(rgb):
    c = [v / 255 for v in rgb]
    c = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def runs(line):
    """[(fg index or None, dim, text)] from one capture -e line."""
    out, fg, dim, pos = [], None, False, 0
    for m in re.finditer(r'\x1b\[([0-9;]*)m', line):
        if m.start() > pos:
            out.append((fg, dim, line[pos:m.start()]))
        p = [int(x) if x else 0 for x in m.group(1).split(';')]
        i = 0
        while i < len(p):
            if p[i] == 0:
                fg, dim = None, False
            elif p[i] == 2:
                dim = True
            elif p[i] == 22:
                dim = False
            elif p[i] == 39:
                fg = None
            elif p[i] == 38 and i + 2 < len(p) and p[i + 1] == 5:
                fg = p[i + 2]; i += 2
            elif p[i] == 38 and i + 4 < len(p) and p[i + 1] == 2:
                fg = ('rgb', p[i + 2], p[i + 3], p[i + 4]); i += 4
            i += 1
        pos = m.end()
    out.append((fg, dim, line[pos:]))
    return [r for r in out if r[2].strip()]


def band_runs():
    for line in tmux('capture-pane', '-p', '-e', '-t', 'qa').split('\n'):
        if line.startswith('\x1b[0;1m') or re.sub(r'\x1b\[[0-9;]*m', '', line).startswith('▌'):
            return runs(line)
    return None


def wait(pred, secs=30):
    for _ in range(int(secs * 2)):
        v = pred()
        if v:
            return v
        time.sleep(0.5)


def session(theme):
    tmux('kill-server')
    cmd = (f"cd '{REPO}' && env AGENT_BOARD_URL={URL} DISABLE_AUTOUPDATER=1 {os.environ.get('ENGINE_ENV', '')} '{CLAUDE}' "
           f"--plugin-dir '{MOD}' --strict-mcp-config --settings '{json.dumps({'theme': theme})}'")
    subprocess.run(['tmux', '-L', SOCK, 'new-session', '-d', '-s', 'qa', '-x', '120', '-y', '36', cmd])
    return wait(band_runs, 40)


def link(card_id):
    tmux('send-keys', '-t', 'qa', f'/board-sync link {card_id}', 'Enter')
    time.sleep(3)
    return band_runs()


def main():
    db = tempfile.mkdtemp()
    def start():
        return subprocess.Popen(['node', 'src/server.js'], cwd=ROOT, env=dict(os.environ, AGENT_BOARD_DIR=db, PORT=str(PORT)),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    srv = start()
    result = {}  # theme -> {label: idx}
    try:
        wait(lambda: subprocess.run(['curl', '-sf', URL + '/api/meta'], capture_output=True).returncode == 0, 10)
        card = api('POST', '/tasks', {'title': 'Fix login redirect loop', 'project': 'Agent Board', 'branch': 'feat/try-mod',
                                      'status': 'in_progress', 'priority': 'high'})['id']
        for theme in ('dark', 'light'):
            r = result[theme] = {}
            first = session(theme)
            if not first:
                sys.exit(f'{theme}: no band appeared\n' + tmux('capture-pane', '-p', '-t', 'qa'))
            for status in ('in_progress', 'backlog', 'review', 'done'):
                api('PATCH', f'/tasks/{card}', {'status': status})
                rs = link(card)
                stripe = next(x for x in rs if '▌' in x[2])
                r[f'status {status} (stripe + symbol + word)'] = stripe[0]
                if status == 'in_progress':
                    r['priority high ▲ (error)'] = next(x for x in rs if '▲' in x[2])[0]
                    meta = next(x for x in rs if 'claude' in x[2])
                    r['meta: agent · branch · notes (dim)'] = meta[0]
                    r['engine [-] button (reference)'] = rs[-1][0]
            srv.terminate(); srv.wait()
            rs = link(card)
            r['offline ✗ (error)'] = next(x for x in rs if '✗' in x[2])[0]
            srv = start()
            wait(lambda: subprocess.run(['curl', '-sf', URL + '/api/meta'], capture_output=True).returncode == 0, 10)
    finally:
        tmux('kill-server')
        srv.terminate()
        try:
            srv.wait(5)
        except Exception:
            srv.kill()
        shutil.rmtree(db, ignore_errors=True)

    bgs = {'dark': {'black #000': (0, 0, 0), 'near-black #1c1c1c': (28, 28, 28)}, 'light': {'white #fff': (255, 255, 255), 'near-white #eee': (238, 238, 238)}}
    print('Contrast of each semantic color against the background its theme assumes (WCAG; text needs 4.5, UI/glyph 3):\n')
    bad = 0
    for theme in ('dark', 'light'):
        print(f'== theme {theme}')
        for label, idx in result[theme].items():
            if idx is None or isinstance(idx, tuple):
                print(f'  {label:44} {idx!r} (not a 256-color index)'); continue
            rgb = xterm_rgb(idx)
            cells = []
            for bn, bg in bgs[theme].items():
                c = ratio(rgb, bg)
                flag = '' if c >= 4.5 else (' <4.5' if c >= 3 else ' <3 FAIL')
                if 'reference' not in label and c < 4.5:
                    bad += 1
                cells.append(f'{c:5.2f}{flag} on {bn}')
            print(f'  {label:44} {idx:3} #{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}  ' + ' | '.join(cells))
    print('\nCross-theme (wrong background, e.g. a dark theme on a white terminal) is worth a look too:')
    for theme, other in (('dark', 'light'), ('light', 'dark')):
        for label, idx in result[theme].items():
            if isinstance(idx, int) and 'reference' not in label:
                rgb = xterm_rgb(idx)
                w = min(ratio(rgb, b) for b in bgs[other].values())
                if w < 3:
                    print(f'  {theme}-theme {label:44} only {w:.2f}:1 on a {other} background')
    print(f'\nvalues under 4.5:1 (informational; every state also has a symbol and a word): {bad}')


if __name__ == '__main__':
    main()

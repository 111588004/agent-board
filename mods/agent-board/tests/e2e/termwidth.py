"""Display width of a string in terminal cells. Uses wcwidth when installed, else East Asian Width."""
import unicodedata

try:
    from wcwidth import wcwidth as _wcwidth
except ImportError:
    _wcwidth = None


def cell(ch: str, ambiguous: int = 1) -> int:
    """ambiguous=2 is the pessimistic model: East Asian Ambiguous characters drawn two cells wide."""
    if _wcwidth and ambiguous == 1:
        return max(_wcwidth(ch), 0)
    if unicodedata.category(ch) in ('Mn', 'Me', 'Cf') or ch == '​':
        return 0
    eaw = unicodedata.east_asian_width(ch)
    if eaw in ('W', 'F'):
        return 2
    return ambiguous if eaw == 'A' else 1


def width(s: str, ambiguous: int = 1) -> int:
    return sum(cell(c, ambiguous) for c in s)

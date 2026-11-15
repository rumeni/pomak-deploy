"""Upisuje prevode iz translations_sr.py u django.po i javlja šta nedostaje."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from translations_sr import SR  # noqa: E402

PO = Path(__file__).parent / 'sr_Latn' / 'LC_MESSAGES' / 'django.po'


def escape(text: str) -> str:
    return text.replace('\\', '\\\\').replace('"', '\\"')


def unescape(text: str) -> str:
    return text.replace('\\"', '"').replace('\\\\', '\\')


content = PO.read_text(encoding='utf-8')
content = content.replace('"Language: \\n"', '"Language: sr_Latn\\n"')
missing = []


def fill(match: re.Match) -> str:
    msgid = unescape(match.group(1))
    if msgid not in SR:
        missing.append(msgid)
        return match.group(0)
    return f'msgid "{match.group(1)}"\nmsgstr "{escape(SR[msgid])}"'


content = re.sub(r'^msgid "(.+)"\nmsgstr ".*"$', fill, content, flags=re.MULTILINE)
# makemessages označava fajl kao "fuzzy"; prevodi su pregledani.
content = content.replace('#, fuzzy\n', '')
PO.write_text(content, encoding='utf-8')

if missing:
    print('Nedostaje prevod za:')
    for m in missing:
        print(' -', m)
    sys.exit(1)
print('Svi prevodi su upisani.')

import unicodedata

_SPECIAL = str.maketrans({'đ': 'dj', 'Đ': 'dj'})
# Match Cyrillic queries against Latin-indexed foods and exercises.
_CYRILLIC = str.maketrans({
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj',
    'е': 'e', 'ж': 'z', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k',
    'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's',
})


def normalize_search(text: str) -> str:
    """Svodi tekst na oblik za pretragu: mala slova, bez kvačica.

    "Pileće belo meso" -> "pilece belo meso", "Đumbir" -> "djumbir", pa korisnik
    nalazi namirnicu i kad kuca bez č/ć/š/ž/đ.
    """
    text = text.lower().translate(_CYRILLIC).translate(_SPECIAL)
    decomposed = unicodedata.normalize('NFKD', text)
    stripped = ''.join(c for c in decomposed if not unicodedata.combining(c))
    return ' '.join(stripped.split())

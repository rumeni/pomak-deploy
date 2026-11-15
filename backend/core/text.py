import unicodedata

_SPECIAL = str.maketrans({'đ': 'dj', 'Đ': 'dj'})


def normalize_search(text: str) -> str:
    """Svodi tekst na oblik za pretragu: mala slova, bez kvačica.

    "Pileće belo meso" -> "pilece belo meso", "Đumbir" -> "djumbir", pa korisnik
    nalazi namirnicu i kad kuca bez č/ć/š/ž/đ.
    """
    text = text.translate(_SPECIAL).lower()
    decomposed = unicodedata.normalize('NFKD', text)
    stripped = ''.join(c for c in decomposed if not unicodedata.combining(c))
    return ' '.join(stripped.split())

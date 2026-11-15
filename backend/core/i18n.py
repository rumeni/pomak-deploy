from django.utils.translation import get_language


def localized_name(obj, field: str = 'name') -> str:
    """Naziv na jeziku zahteva: `<field>_en` na engleskom ako postoji, inače `<field>`."""
    if get_language() == 'en':
        english = getattr(obj, f'{field}_en', '')
        if english:
            return english
    return getattr(obj, field)

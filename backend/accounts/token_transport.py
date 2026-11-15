"""Transport policy for web refresh cookies; legacy token bodies stay unchanged."""

from django.conf import settings

COOKIE = 'pomak.refresh'
PATH = '/api/auth/'


def web_request(request):
    return request.headers.get('X-Pomak-Client') == 'web'


def incoming_refresh(request):
    return request.data.get('refresh') or (request.COOKIES.get(COOKIE) if web_request(request) else None)


def output_tokens(request, response):
    if web_request(request) and response.status_code < 400:
        refresh = response.data.pop('refresh', None)
        if refresh:
            response.set_cookie(
                COOKIE, refresh, path=PATH,
                max_age=int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()),
                secure=True, httponly=True, samesite='Strict',
            )
    return response


def clear_refresh_cookie(response):
    response.delete_cookie(COOKIE, path=PATH, samesite='Strict')
    return response

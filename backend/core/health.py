"""A lightweight process-liveness endpoint (does not query the database)."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    return JsonResponse({'status': 'ok'})


@require_GET
def ready(request):
    """Dependency readiness. No database credentials or internal details in the response."""
    from django.db import connection, DatabaseError
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})


@require_GET
def staging_ip_identity(request):
    """QA-only diagnostic (not included in release branch)."""
    import hashlib
    import hmac
    from django.conf import settings
    from rest_framework.throttling import BaseThrottle
    def fingerprint(value):
        return hmac.new(settings.SECRET_KEY.encode(), str(value).encode(), hashlib.sha256).hexdigest()[:16]
    raw = request.META.get("HTTP_X_FORWARDED_FOR", "")
    return JsonResponse({
        "identityHash": fingerprint(BaseThrottle().get_ident(request)),
        "chainLength": len([s for s in raw.split(",") if s.strip()]),
        "firstHash": fingerprint(raw.split(",")[0].strip()),
        "lastHash": fingerprint(raw.split(",")[-1].strip()),
        "remoteHash": fingerprint(request.META.get("REMOTE_ADDR", "")),
        "https": request.is_secure(),
        "proto": request.META.get("HTTP_X_FORWARDED_PROTO", ""),
        "host": request.get_host(),
    })

"""Protected daily maintenance endpoint, called by Vercel Cron in production."""

import os
import secrets

from django.http import HttpResponseNotFound, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .maintenance import cleanup_expired_auth_throttle_buckets


@never_cache
@require_GET
def cleanup_auth_throttle_cron(request):
    # Fail closed when no secret is configured. Do not trust cron user-agent.
    secret = os.environ.get('CRON_SECRET', '')
    if not secret:
        return HttpResponseNotFound()
    expected = f'Bearer {secret}'
    if not secrets.compare_digest(request.headers.get('Authorization', ''), expected):
        return JsonResponse({'detail': 'Unauthorized'}, status=401)
    deleted, more = cleanup_expired_auth_throttle_buckets()
    return JsonResponse({'status': 'ok', 'deleted': deleted, 'more_expired': more})


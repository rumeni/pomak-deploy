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
        # Connectivity alone is insufficient: reject deploys that reference
        # unapplied columns/tables in a pending Django migration.
        from django.db.migrations.executor import MigrationExecutor
        executor = MigrationExecutor(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            return JsonResponse({'status': 'unavailable'}, status=503)
    except DatabaseError:
        return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})

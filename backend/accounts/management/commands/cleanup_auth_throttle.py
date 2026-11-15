"""Run: python manage.py cleanup_auth_throttle  (same cleanup as Vercel Cron)."""

from django.core.management.base import BaseCommand

from accounts.maintenance import cleanup_expired_auth_throttle_buckets


class Command(BaseCommand):
    help = 'Delete AuthThrottleBucket rows older than two hours in bounded batches.'

    def handle(self, *args, **options):
        deleted, more = cleanup_expired_auth_throttle_buckets()
        self.stdout.write(self.style.SUCCESS(f'Deleted {deleted} expired auth throttle buckets; more_expired={more}'))

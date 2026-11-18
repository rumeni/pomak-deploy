from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand

from notifications.push import b64url


class Command(BaseCommand):
    help = 'Print a new VAPID key pair for web push (set both as environment variables, never commit them).'

    def handle(self, *args, **options):
        key = ec.generate_private_key(ec.SECP256R1())
        private = key.private_numbers().private_value.to_bytes(32, 'big')
        public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.stdout.write(f'WEB_PUSH_VAPID_PUBLIC_KEY={b64url(public)}')
        self.stdout.write(f'WEB_PUSH_VAPID_PRIVATE_KEY={b64url(private)}')

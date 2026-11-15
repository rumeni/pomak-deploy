from django.test import SimpleTestCase
from django.utils.translation import gettext, override


class LoginChallengeTranslationTests(SimpleTestCase):
    def test_server_verification_required_message_uses_compiled_serbian_catalog(self):
        message = 'Too many sign-in attempts. Complete verification to try again.'
        with override('sr-latn'):
            self.assertEqual(
                gettext(message),
                'Previše pokušaja prijave. Završite bezbednosnu proveru i pokušajte ponovo.',
            )
        with override('en'):
            self.assertEqual(gettext(message), message)

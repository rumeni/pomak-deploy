"""Poruke iz DRF-a i SimpleJWT-a koje korisnik može da vidi.

Te biblioteke nemaju prevod na srpsku latinicu. Ovde su popisane samo da bi ih
`makemessages` uneo u naš locale/sr_Latn fajl, gde su prevedene. Tekst mora biti
identičan originalu u biblioteci.
"""

from django.utils.translation import gettext_noop

MESSAGES = [
    gettext_noop('This field is required.'),
    gettext_noop('This field may not be blank.'),
    gettext_noop('This field may not be null.'),
    gettext_noop('This list may not be empty.'),
    gettext_noop('Enter a valid email address.'),
    gettext_noop('A valid number is required.'),
    gettext_noop('A valid integer is required.'),
    gettext_noop('Must be a valid UUID.'),
    gettext_noop('Must be a valid boolean.'),
    gettext_noop('"{input}" is not a valid choice.'),
    gettext_noop('Ensure this value is greater than or equal to {min_value}.'),
    gettext_noop('Ensure this value is less than or equal to {max_value}.'),
    gettext_noop('Ensure this field has no more than {max_length} characters.'),
    gettext_noop('Ensure that there are no more than {max_decimal_places} decimal places.'),
    gettext_noop('Ensure that there are no more than {max_digits} digits in total.'),
    gettext_noop('Date has wrong format. Use one of these formats instead: {format}.'),
    gettext_noop('Invalid pk "{pk_value}" - object does not exist.'),
    gettext_noop('Not found.'),
    gettext_noop('Invalid input.'),
    gettext_noop('Malformed request.'),
    gettext_noop('A server error occurred.'),
    gettext_noop('Authentication credentials were not provided.'),
    gettext_noop('Incorrect authentication credentials.'),
    gettext_noop('You do not have permission to perform this action.'),
    gettext_noop('Method "{method}" not allowed.'),
    gettext_noop('Request was throttled.'),
    gettext_noop('Given token not valid for any token type'),
    gettext_noop('Token is invalid or expired'),
    gettext_noop('User is inactive'),
    gettext_noop('User not found'),
]

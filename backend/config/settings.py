import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from decouple import Csv, config
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# Nema podrazumevane vrednosti: aplikacija ne sme da se pokrene sa javno poznatim ključem.
SECRET_KEY = config('SECRET_KEY')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())
# Vercel generates a unique URL for each deployment. Accept that exact hostname
# rather than permitting every unrelated *.vercel.app host.
vercel_url = os.environ.get('VERCEL_URL', '').strip()
if vercel_url and vercel_url not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(vercel_url)


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'core',
    'accounts',
    'coaching',
    'progress',
    'training',
    'nutrition',
    'notifications',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    # Jezik odgovora prema zaglavlju Accept-Language koje šalje aplikacija.
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Push notifications queued by the request are handed over once, at its end.
    'notifications.middleware.PushKickMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Uvek PostgreSQL (i lokalno, preko docker-compose): ograničenja za termine i
# pretraga zavise od mogućnosti Postgres-a.
# Never silently connect to the developer's local database from a cloud build.
# Vercel Functions can scale to many instances, so disable persistent Django
# database connections there; use Neon's pooled DATABASE_URL when available.
is_vercel = bool(os.environ.get('VERCEL'))
database_url = config('DATABASE_URL', default='')
if not database_url:
    if is_vercel:
        raise ImproperlyConfigured('DATABASE_URL must be set for the Vercel backend (Neon PostgreSQL).')
    database_url = 'postgres://pomak:pomak@localhost:5433/pomak'

DATABASES = {
    'default': dj_database_url.parse(
        database_url,
        conn_max_age=0 if is_vercel else config('DB_CONN_MAX_AGE', default=600, cast=int),
        conn_health_checks=not is_vercel,
    )
}


AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'sr-latn'
LANGUAGES = [
    ('sr-latn', 'Srpski'),
    ('en', 'English'),
]
LOCALE_PATHS = [BASE_DIR / 'locale']
TIME_ZONE = 'Europe/Belgrade'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    # Vercel overwrites X-Forwarded-For, so the last forwarded address is trusted there.
    # Direct/local Django must ignore client-supplied forwarding headers instead.
    'NUM_PROXIES': config('DRF_NUM_PROXIES', default=1 if is_vercel else 0, cast=int),
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'accounts.authentication.SessionVersionJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'accounts.permissions.VerifiedEmailPermission',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '200/day',
        'user': '5000/day',
        'auth': '10/min',
    },
}

# Account emails are disabled until the transactional email provider and
# the web/Android verification flows are tested. SMTP secrets stay in Vercel.
ACCOUNT_EMAIL_ENABLED = config('ACCOUNT_EMAIL_ENABLED', default=False, cast=bool)
ACCOUNT_EMAIL_BASE_URL = config('ACCOUNT_EMAIL_BASE_URL', default='')
# Signed, durable queue: submit all syntactically valid reset addresses before any account lookup.
ACCOUNT_EMAIL_WORKER_URL = config('ACCOUNT_EMAIL_WORKER_URL', default='')
QSTASH_TOKEN = config('QSTASH_TOKEN', default='')
QSTASH_CURRENT_SIGNING_KEY = config('QSTASH_CURRENT_SIGNING_KEY', default='')
QSTASH_NEXT_SIGNING_KEY = config('QSTASH_NEXT_SIGNING_KEY', default='')
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = config('EMAIL_HOST', default='localhost')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
# Bound synchronous signup/verification SMTP latency on serverless workers.
EMAIL_TIMEOUT = config('EMAIL_TIMEOUT', default=10, cast=int)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='')
PASSWORD_RESET_TIMEOUT = 30 * 60  # 30 minutes
EMAIL_VERIFICATION_TIMEOUT = 24 * 60 * 60  # 24 hours
if ACCOUNT_EMAIL_ENABLED and not DEBUG:
    from urllib.parse import urlsplit

    base = urlsplit(ACCOUNT_EMAIL_BASE_URL)
    worker = urlsplit(ACCOUNT_EMAIL_WORKER_URL)
    if (base.scheme != 'https' or not base.hostname or base.username or base.password
            or base.query or base.fragment or base.path not in ('', '/')
            or worker.scheme != 'https' or not worker.hostname or worker.username or worker.password
            or worker.query or worker.fragment or worker.path != '/api/internal/password-reset-email/'
            or not QSTASH_TOKEN or not QSTASH_CURRENT_SIGNING_KEY or not QSTASH_NEXT_SIGNING_KEY
            or not EMAIL_HOST_USER or not EMAIL_HOST_PASSWORD or not DEFAULT_FROM_EMAIL):
        raise ImproperlyConfigured(
            'Account email rollout requires HTTPS sender/worker URLs, QStash queue signing keys and SMTP sender credentials.'
        )

# The recovery path is OFF until the web/Android widget and Siteverify
# credentials have been manually tested and deployed together.
TURNSTILE_LOGIN_ENABLED = config('TURNSTILE_LOGIN_ENABLED', default=False, cast=bool)
TURNSTILE_SECRET_KEY = config('TURNSTILE_SECRET_KEY', default='')
TURNSTILE_ALLOWED_HOSTNAMES = config('TURNSTILE_ALLOWED_HOSTNAMES', default='', cast=Csv())
if TURNSTILE_LOGIN_ENABLED and not DEBUG and TURNSTILE_SECRET_KEY.startswith(('1x000000', '2x000000', '3x000000')):
    raise ImproperlyConfigured('Turnstile test secrets must not be used in production.')

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=60),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# Capacitor na Androidu učitava aplikaciju sa https://localhost.
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,https://localhost,capacitor://localhost',
    cast=Csv(),
)
# Set to your actual frontend domain if you use Django admin across origins.
CSRF_TRUSTED_ORIGINS = config('CSRF_TRUSTED_ORIGINS', default='', cast=Csv())


if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    # Enforce HTTPS at the Django layer only behind Vercel's trusted TLS proxy.
    # Do not include subdomains/preload: deployment aliases may be shared.
    SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=is_vercel, cast=bool)
    SECURE_HSTS_SECONDS = config('SECURE_HSTS_SECONDS', default=31536000 if is_vercel else 0, cast=int)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

TEST_RUNNER = 'core.test_runner.TestRunner'

# Open Food Facts data is under the ODbL (attribution + share-alike for a combined database).
# Until the team has settled how to meet that, foods filled from it stay private to their user.
SHARE_OPEN_FOOD_FACTS_DATA = config('SHARE_OPEN_FOOD_FACTS_DATA', default=False, cast=bool)


// Django starter: a runnable project (settings, one `core` app with a landing
// page, a health endpoint and tests, a Dockerfile) sized for "a server-rendered
// Django monolith". What the stack descriptor mentions decides the optional
// parts: Django REST Framework, HTMX, PostgreSQL. A React front end is NOT
// generated - the starter covers the Django side and says so (`notScaffolded`).
//
// The project title is model text, so it never appears raw in code or in a
// Django template: it is one JSON-escaped Python string literal in
// `apps/core/views.py`, rendered through a template variable (which Django
// escapes), never pasted into the template source where `{{ ... }}` would be
// evaluated.
import { stringLiteral, type Starter, type StarterContext, type StarterFile } from './types';
import type { StackText } from './stack';

interface DjangoFeatures {
  rest: boolean;
  htmx: boolean;
  postgres: boolean;
}

function featuresOf(stack: StackText): DjangoFeatures {
  return {
    rest: /rest framework|\bdrf\b/.test(stack.backend),
    htmx: /htmx/.test(stack.frontend),
    postgres: /postgres/.test(stack.database),
  };
}

// Python package markers. Never empty: GitHub's contents API is not reliable
// about creating a zero-byte file, and a one-line docstring is what a
// reader wants to see there anyway.
const PACKAGE_MARKER = '"""Package."""\n';

const MANAGE_PY = `#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Is it installed and is your virtualenv active? "
            "Run: pip install -r requirements.txt"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
`;

function requirements(features: DjangoFeatures): string {
  const lines = [
    'Django>=5.2,<6.0',
    'dj-database-url>=2.3',
    'python-dotenv>=1.0',
    'gunicorn>=23.0',
  ];
  if (features.rest) lines.push('djangorestframework>=3.16');
  if (features.postgres) lines.push('psycopg[binary]>=3.2');
  return `${lines.join('\n')}\n`;
}

function envExample(features: DjangoFeatures): string {
  return `# Copy to .env for local development (loaded by config/settings.py).
DJANGO_DEBUG=1
DJANGO_SECRET_KEY=change-me
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
# SQLite is used when DATABASE_URL is unset.
${
  features.postgres
    ? "# PostgreSQL (the stack's database):\n# DATABASE_URL=postgres://user:password@localhost:5432/dbname"
    : '# DATABASE_URL=postgres://user:password@localhost:5432/dbname'
}
`;
}

const GITIGNORE = `__pycache__/
*.py[cod]
.venv/
venv/
.env
db.sqlite3
staticfiles/
.pytest_cache/
.DS_Store
`;

const DOCKERIGNORE = `.git
.venv
__pycache__
*.py[cod]
.env
db.sqlite3
`;

const DOCKERFILE = `FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    DJANGO_DEBUG=0

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
`;

function settings(features: DjangoFeatures): string {
  return `"""Django settings. Configuration comes from the environment (see .env.example)."""
import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY (see .env.example).")
    SECRET_KEY = "insecure-development-only-key"

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
${features.rest ? '    "rest_framework",\n' : ''}    "apps.core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
${
  features.rest
    ? `
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}
`
    : ''
}`;
}

const ROOT_URLS = `from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("apps.core.urls")),
]
`;

const WSGI = `import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
`;

const ASGI = `import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
`;

const CORE_APPS = `from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.core"
`;

function coreViews(context: StarterContext, features: DjangoFeatures): string {
  const restImports = features.rest
    ? 'from rest_framework.decorators import api_view\nfrom rest_framework.response import Response\n'
    : '';
  const htmxView = features.htmx
    ? `

def status(request):
    """An HTML fragment for the HTMX button on the landing page."""
    return HttpResponse("<strong>Service is up.</strong>")
`
    : '';
  const restView = features.rest
    ? `

@api_view(["GET"])
def api_health(request):
    return Response({"status": "ok"})
`
    : '';
  return `from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
${restImports}
PROJECT_TITLE = ${stringLiteral(context.title)}


def index(request):
    return render(request, "core/index.html", {"project_title": PROJECT_TITLE})


def health(request):
    return JsonResponse({"status": "ok"})
${htmxView}${restView}`;
}

function coreUrls(features: DjangoFeatures): string {
  const extra: string[] = [];
  if (features.htmx) extra.push('    path("status/", views.status, name="status"),');
  if (features.rest) extra.push('    path("api/health/", views.api_health, name="api-health"),');
  return `from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("health/", views.health, name="health"),
${extra.length ? `${extra.join('\n')}\n` : ''}]
`;
}

function coreTests(features: DjangoFeatures): string {
  const htmxTest = features.htmx
    ? `
    def test_status_fragment(self):
        response = self.client.get("/status/")
        self.assertContains(response, "Service is up.")
`
    : '';
  const restTest = features.rest
    ? `
    def test_api_health(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
`
    : '';
  return `from django.test import TestCase


class CoreViewsTests(TestCase):
    def test_landing_page_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "<h1>")

    def test_health(self):
        response = self.client.get("/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
${htmxTest}${restTest}`;
}

function indexTemplate(features: DjangoFeatures): string {
  const htmxScript = features.htmx
    ? '    <script src="https://unpkg.com/htmx.org@2.0.4"></script>\n'
    : '';
  const htmxButton = features.htmx
    ? `    <p>
      <button hx-get="{% url 'status' %}" hx-target="#status" hx-swap="innerHTML">Check status</button>
      <span id="status"></span>
    </p>
`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ project_title }}</title>
${htmxScript}  </head>
  <body>
    <h1>{{ project_title }}</h1>
    <p>Generated starter. Health check: <a href="{% url 'health' %}">/health/</a></p>
${htmxButton}  </body>
</html>
`;
}

function files(context: StarterContext): StarterFile[] {
  const features = featuresOf(context.stack);
  return [
    { path: 'manage.py', content: MANAGE_PY },
    { path: 'requirements.txt', content: requirements(features) },
    { path: '.env.example', content: envExample(features) },
    { path: '.gitignore', content: GITIGNORE },
    { path: '.dockerignore', content: DOCKERIGNORE },
    { path: 'Dockerfile', content: DOCKERFILE },
    { path: 'config/__init__.py', content: PACKAGE_MARKER },
    { path: 'config/settings.py', content: settings(features) },
    { path: 'config/urls.py', content: ROOT_URLS },
    { path: 'config/wsgi.py', content: WSGI },
    { path: 'config/asgi.py', content: ASGI },
    { path: 'apps/__init__.py', content: PACKAGE_MARKER },
    { path: 'apps/core/__init__.py', content: PACKAGE_MARKER },
    { path: 'apps/core/apps.py', content: CORE_APPS },
    { path: 'apps/core/views.py', content: coreViews(context, features) },
    { path: 'apps/core/urls.py', content: coreUrls(features) },
    { path: 'apps/core/tests.py', content: coreTests(features) },
    { path: 'apps/core/templates/core/index.html', content: indexTemplate(features) },
  ];
}

export const djangoStarter: Starter = {
  id: 'django',
  label: 'Django',
  // The backend layer names Django (a "Django monolith", "Django REST
  // Framework modular monolith", ...). A front end of React/HTMX/templates
  // does not change that the server side is Django.
  matches: (stack) => /\bdjango\b/.test(stack.backend),
  files,
  gettingStarted: (context) => {
    const features = featuresOf(context.stack);
    return `\`\`\`bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
\`\`\`

Then open http://127.0.0.1:8000/ (health check at \`/health/\`${
      features.rest ? ', REST health check at `/api/health/`' : ''
    }). Run the tests with \`python manage.py test\`. ${
      features.postgres
        ? 'SQLite is used until you set `DATABASE_URL` to a PostgreSQL connection string in `.env`.'
        : 'Set `DATABASE_URL` in `.env` to use a database other than SQLite.'
    }

A \`Dockerfile\` is included (\`docker build -t app . && docker run -p 8000:8000 -e DJANGO_SECRET_KEY=... app\`).`;
  },
  notScaffolded: (stack) => {
    const missing: string[] = [];
    if (
      /react|vue|angular|svelte|next\.?js/.test(stack.frontend) &&
      !/htmx|template/.test(stack.frontend)
    ) {
      missing.push('the front-end application');
    }
    missing.push('infrastructure and deployment configuration for the chosen hosting');
    return missing;
  },
};

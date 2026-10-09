"""
Realistic load for MLOps MENA Academy: anonymous visitors browsing (pages and the public API
the way pages and scripts call it) mixed with signed-in students who log in ONCE and keep
their session, with think time between steps. See loadtest/README.md.

    locust -f loadtest/locustfile.py --host https://academy-staging.mlopsmena.com \
        --headless PROFILE=...   (set as environment variables, see below)

Environment:
    PROFILE        smoke | load | stress (default smoke): see SHAPES below
    TIME_SCALE     multiply every stage's duration (e.g. 0.5 for a quicker local run)
    PAGES          1 to include web pages (default 1); 0 for an API-only run
    API_HOST       where /api/* goes when it isn't the --host (local runs: the API container)
    STUDENT_EMAIL  pattern with {n}, e.g. loadtest-{n}@example.test (accounts must exist)
    STUDENT_PASSWORD
    STUDENTS       how many such accounts exist (default 300)
    REGISTER_WEIGHT  weight of visitors who sign up (default 0: real accounts, real emails)
    SPOOF_IP       1 to send a distinct X-Forwarded-For per simulated user. LOCAL RUNS ONLY:
                   the API trusts one proxy hop, so this stands in for real visitors' own IPs
                   (one load generator would otherwise trip the per-IP limits). Cloudflare
                   overwrites it, so it does nothing against staging.
"""
import itertools
import json
import os
import random
import threading

from locust import HttpUser, LoadTestShape, between, events, task

PAGES = os.environ.get("PAGES", "1") == "1"
API_HOST = os.environ.get("API_HOST", "").rstrip("/")
SPOOF_IP = os.environ.get("SPOOF_IP") == "1"
STUDENT_EMAIL = os.environ.get("STUDENT_EMAIL", "loadtest-{n}@example.test")
STUDENT_PASSWORD = os.environ.get("STUDENT_PASSWORD", "LoadTest-Student-2026")
STUDENTS = int(os.environ.get("STUDENTS", "300"))
REGISTER_WEIGHT = int(os.environ.get("REGISTER_WEIGHT", "0"))

# Filled once at test start from the public API (fallbacks if it's down).
CATALOG = {
    "courses": ["ai-architecture-design", "kubernetes", "llmops", "mlops-practitioner"],
    "events": ["redis-for-semantic-caching"],
    "speakers": ["aya-nasser-salama"],
}
_student_ids = itertools.count(1)
_lock = threading.Lock()


def api(path):
    return f"{API_HOST}{path}" if API_HOST else path


@events.test_start.add_listener
def discover(environment, **_):
    import requests

    base = API_HOST or environment.host
    try:
        CATALOG["courses"] = [c["slug"] for c in requests.get(f"{base}/api/courses", timeout=30).json()] or CATALOG["courses"]
        ev = requests.get(f"{base}/api/events", timeout=30).json()
        CATALOG["events"] = [e["slug"] for e in ev.get("upcoming", []) + ev.get("past", [])] or CATALOG["events"]
        CATALOG["speakers"] = [s["slug"] for s in requests.get(f"{base}/api/speakers", timeout=30).json()] or CATALOG["speakers"]
    except Exception as err:  # noqa: BLE001 - keep the defaults
        print(f"catalog discovery failed ({err}); using defaults")
    print({k: len(v) for k, v in CATALOG.items()})


def check(r, ok=(200,)):
    """Counts anything but `ok` as a failure, naming 503s (shed load) separately."""
    if r.status_code in ok:
        r.success()
    elif r.status_code == 503:
        r.failure(f"503 busy (retry-after {r.headers.get('retry-after')})")
    elif r.status_code == 0:
        r.failure("no response / timeout")
    else:
        r.failure(f"status {r.status_code}")


class Base(HttpUser):
    abstract = True
    wait_time = between(3, 8)

    def on_start(self):
        self.locale = random.choice(["en", "en", "ar"])
        if SPOOF_IP:
            self.client.headers["X-Forwarded-For"] = f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"
        self.client.headers["User-Agent"] = "academy-loadtest"

    def get(self, path, name, ok=(200,), **kw):
        with self.client.get(path, name=name, catch_response=True, timeout=60, **kw) as r:
            check(r, ok)
            return r

    def page(self, path, name):
        if PAGES:
            self.get(path, f"page {name}")


class AnonymousVisitor(Base):
    """A visitor from an announcement: pages, plus the public API the pages and scripts use."""

    weight = 7

    @task(3)
    def home(self):
        self.page(f"/{self.locale}", "home")
        self.get(api("/api/courses"), "api courses")

    @task(4)
    def catalog(self):
        self.page(f"/{self.locale}/courses", "catalog")
        self.get(api("/api/courses"), "api courses")

    @task(6)
    def course(self):
        slug = random.choice(CATALOG["courses"])
        self.page(f"/{self.locale}/courses/{slug}", "course")
        self.get(api(f"/api/courses/{slug}"), "api course :slug")

    @task(3)
    def sessions(self):
        self.page(f"/{self.locale}/sessions", "sessions")
        self.get(api("/api/events"), "api events")

    @task(2)
    def session(self):
        slug = random.choice(CATALOG["events"])
        self.page(f"/{self.locale}/sessions/{slug}", "session")
        self.get(api(f"/api/events/{slug}"), "api event :slug")

    @task(2)
    def recordings(self):
        self.page(f"/{self.locale}/sessions/recordings", "recordings")
        self.get(api("/api/recordings"), "api recordings")

    @task(1)
    def speaker(self):
        slug = random.choice(CATALOG["speakers"])
        self.page(f"/{self.locale}/speakers/{slug}", "speaker")
        self.get(api(f"/api/speakers/{slug}"), "api speaker :slug")

    @task(1)
    def health(self):
        self.get(api("/api/health"), "api health")


class SignedInStudent(Base):
    """Logs in once, keeps the session cookie, and browses like the web app does when signed in."""

    weight = 3

    def on_start(self):
        super().on_start()
        with _lock:
            n = (next(_student_ids) - 1) % STUDENTS + 1
        self.email = STUDENT_EMAIL.format(n=n)
        self.signed_in = False
        self.login()

    def login(self):
        with self.client.post(
            api("/api/auth/login"),
            name="api auth login",
            json={"email": self.email, "password": STUDENT_PASSWORD},
            catch_response=True,
            timeout=60,
        ) as r:
            check(r)
            self.signed_in = r.status_code == 200

    def page_view(self, path, name):
        """What every signed-in page load costs: the page, who am I, the bell."""
        if not self.signed_in:
            self.login()
            return
        self.page(path, name)
        r = self.get(api("/api/auth/me"), "api auth me", ok=(200, 401))
        if r.status_code == 401:
            self.signed_in = False
            return
        self.get(api("/api/notifications/unread-count"), "api notifications unread-count")

    @task(4)
    def dashboard(self):
        self.page_view(f"/{self.locale}/dashboard", "dashboard")
        if self.signed_in:
            self.get(api("/api/me/applications"), "api me applications")
            self.get(api("/api/me/events"), "api me events")

    @task(4)
    def course(self):
        slug = random.choice(CATALOG["courses"])
        self.page_view(f"/{self.locale}/courses/{slug}", "course")
        if self.signed_in:
            self.get(api(f"/api/courses/{slug}"), "api course :slug (signed in)")
            self.get(api(f"/api/courses/{slug}/my-status"), "api course my-status")

    @task(2)
    def session(self):
        slug = random.choice(CATALOG["events"])
        self.page_view(f"/{self.locale}/sessions/{slug}", "session")
        if self.signed_in:
            self.get(api(f"/api/events/{slug}"), "api event :slug (signed in)")


class RegisteringVisitor(Base):
    """Signs up (creates a real account and sends a verification email): off unless REGISTER_WEIGHT > 0."""

    weight = REGISTER_WEIGHT
    wait_time = between(20, 40)

    @task
    def register(self):
        email = f"lt-signup-{random.getrandbits(48):x}@example.test"
        with self.client.post(
            api("/api/auth/register"),
            name="api auth register",
            json={"email": email, "password": "LoadTest-Signup-2026!", "locale": self.locale},
            catch_response=True,
            timeout=60,
        ) as r:
            check(r, ok=(201,))
        self.client.cookies.clear()


# ---- Profiles: (duration_s, users, spawn_rate). Run them in order: smoke -> load -> stress.
SHAPES = {
    # Does everything answer? A handful of users for a minute.
    "smoke": [(60, 5, 5)],
    # Normal launch-day traffic: ramp to 100, hold.
    "load": [(60, 100, 2), (240, 100, 2)],
    # The staging test that failed: ramp to 500, hold, spike to 750, then back to 100 to
    # check recovery.
    "stress": [(120, 500, 5), (120, 500, 5), (60, 750, 10), (60, 100, 20)],
}


class Profile(LoadTestShape):
    def __init__(self):
        super().__init__()
        scale = float(os.environ.get("TIME_SCALE", "1"))
        self.stages = [(d * scale, u, r) for d, u, r in SHAPES[os.environ.get("PROFILE", "smoke")]]

    def tick(self):
        t = self.get_run_time()
        end = 0
        for duration, users, rate in self.stages:
            end += duration
            if t < end:
                return users, rate
        return None


if __name__ == "__main__":
    print(json.dumps(SHAPES, indent=2))

# Load tests

`locustfile.py` mixes anonymous visitors (pages, plus the public API the way pages and
scripts call it) with signed-in students who log in once and keep their session, with 3–8 s
of think time between steps. Profiles (`PROFILE=`): `smoke` (5 users, 1 min), `load` (100
users), `stress` (500 users, a spike to 750, then back to 100 to check recovery).

```sh
pip install locust
PROFILE=smoke locust -f loadtest/locustfile.py --host https://academy-staging.mlopsmena.com --headless
```

Signed-in students need existing accounts: `STUDENT_EMAIL` (a pattern with `{n}`),
`STUDENT_PASSWORD` and `STUDENTS` (see the top of `locustfile.py`). Sign-ups are off unless
`REGISTER_WEIGHT` is set, since they create real accounts and send email.

**Always run `smoke`, then `load`, then `stress`**, and stop at the first one that fails.
Never point it at production. From one machine, every simulated user shares one IP, so
per-IP limits (login 20/min, registration 10/min) apply to the whole test.

## Locally, sized like production

One API container with production's CPU and memory, a database with realistic latency:

```sh
node loadtest/latency-proxy.mjs 6543 127.0.0.1:5432 10     # +10 ms each way, like Cloudflare -> Neon
docker build -f apps/api/Dockerfile -t academy-api .
docker run --cpus=0.25 --memory=1g -p 127.0.0.1:4310:4000 --env-file <env> academy-api
PROFILE=stress TIME_SCALE=0.5 PAGES=0 SPOOF_IP=1 \
  locust -f loadtest/locustfile.py --host http://127.0.0.1:4310 --headless --csv out
```

with `DATABASE_URL=postgresql://…@host.docker.internal:6543/<scratch db>`. `SPOOF_IP=1`
gives each simulated user its own `X-Forwarded-For` (the API trusts one proxy hop), standing
in for real visitors' own addresses; Cloudflare overwrites that header, so it does nothing
against staging. There is no Worker locally, so the edge cache isn't part of a local run.

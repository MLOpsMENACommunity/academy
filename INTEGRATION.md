# Linking from mlopsmena.com to the academy

Each course card or button on the main site's courses page links to one URL on
the academy, which shows the full course page to everyone (no login needed):

```
https://academy.mlopsmena.com/courses/<course-slug>?ref=main-site
```

## Current courses

| Course | Link for the main site |
|---|---|
| AI Architecture Design | `https://academy.mlopsmena.com/courses/ai-architecture-design?ref=main-site` |
| Kubernetes for ML Engineers | `https://academy.mlopsmena.com/courses/kubernetes?ref=main-site` |
| The MLOps Practitioner — Complete Edition (recorded, coming soon) | `https://academy.mlopsmena.com/courses/mlops-practitioner-recorded?ref=main-site` |
| FinOps for AI (coming soon) | `https://academy.mlopsmena.com/courses/finops-for-ai?ref=main-site` |
| LLM Evaluation, Drift Detection & Monitoring (coming soon) | `https://academy.mlopsmena.com/courses/llm-evaluation-monitoring?ref=main-site` |
| TensorRT & TensorRT-LLM Optimization (coming soon) | `https://academy.mlopsmena.com/courses/tensorrt-optimization?ref=main-site` |
| DeepStream Real-Time Video Analytics (coming soon) | `https://academy.mlopsmena.com/courses/deepstream-video-analytics?ref=main-site` |
| Forward Deployed Engineer (coming soon) | `https://academy.mlopsmena.com/courses/forward-deployed-engineer?ref=main-site` |

For a new course, use its slug, which is the last part of the course URL shown
in **Admin → Courses**.

## Language

- Links without a language go to the visitor's last-used language on the
  academy, or English for first-time visitors.
- To force a language, add it after the domain:
  - English: `https://academy.mlopsmena.com/en/courses/kubernetes?ref=main-site`
  - Arabic: `https://academy.mlopsmena.com/ar/courses/kubernetes?ref=main-site`
- If the main site has an Arabic version, link its Arabic pages to the `/ar/`
  URLs.

## Tracking

`ref` and the standard UTM parameters (`utm_source`, `utm_medium`,
`utm_campaign`, `utm_term`, `utm_content`) are recorded on every application.
They are kept through login, registration, email verification and Google
sign-in. Admins can filter applications by `ref`.

Use different `ref` values to tell entry points apart, for example:

| Placement | `ref` |
|---|---|
| Courses page | `main-site` |
| Homepage banner | `main-site-home` |
| Newsletter | `newsletter` |
| LinkedIn post | use `utm_source=linkedin&utm_campaign=<name>` |

## Other useful links

| Page | URL |
|---|---|
| All courses | `https://academy.mlopsmena.com/courses` |
| Sign up | `https://academy.mlopsmena.com/register` |
| Student dashboard | `https://academy.mlopsmena.com/dashboard` |

## What happens after the click

1. The visitor sees the course page: outline, schedule in their own timezone,
   instructor, price, seats left and FAQ.
2. **Apply** asks them to sign in or create an account, complete the required
   profile, then answer the course's screening questions. They return to the
   same course at every step.
3. Status updates (shortlisted, accepted, payment, enrolled) arrive by email and
   in their academy dashboard.

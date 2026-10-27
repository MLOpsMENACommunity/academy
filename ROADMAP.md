# Roadmap

v1 scope is described in the README. The items below are **v2 backlog**: documented, not built.

## Card payments (Paymob)

`PaymentMethod.CARD` already exists in the schema. Add a Paymob checkout,
webhook verification, and automatic `PAYMENT_SUBMITTED → ENROLLED` on a
verified webhook. Manual InstaPay / Vodafone Cash stays as an option.

## Discord / Telegram role sync

Give enrolled students a course role or channel access automatically, and remove
it when the course ends.

## Analytics

Beyond the built-in funnel counts: cohort retention, attendance vs. completion,
feedback trends per instructor, and source attribution across courses.

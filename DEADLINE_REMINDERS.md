# Deadline reminders deployment

The hourly Vercel Cron invokes `/api/cron/process-email-outbox`. That existing
endpoint also handles other queued workflow emails and maintenance jobs; the
reminder is queued through the existing email outbox, not sent by browser code.

## Required environment configuration

Configure these values in the Vercel project for the deployment environments
where the application runs:

- `CRON_SECRET`: a high-entropy secret used to authorize the scheduled endpoint.
  Keep it server-only; do not use a `NEXT_PUBLIC_` name or expose it to client
  code. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`.
- `NEXT_PUBLIC_APP_URL`: the canonical HTTPS origin used to construct project
  workspace links in emails.
- Email delivery: configure either `BREVO_API_KEY` and `BREVO_SENDER_EMAIL`
  (optionally `BREVO_SENDER_NAME`), or SMTP using `SMTP_SERVER` (or
  `SMTP_HOST`), `SMTP_PORT`, `SMTP_USER`, `SMTP_KEY` (or `SMTP_PASSWORD`), and
  `EMAIL_FROM` (optionally `EMAIL_FROM_NAME`). These are server-side settings.
- The application's existing MongoDB connection configuration. Reminder
  claiming and outbox insertion use a MongoDB transaction, so the database must
  support transactions (for example, a replica set or sharded cluster).

Do not commit secret values. Configure them in Vercel's project environment
settings and redeploy after changing them.

## Schedule and deployment

`vercel.json` schedules the route at minute 0 of every hour, in UTC. Vercel
Cron is available on Hobby, but Hobby supports only daily schedules; this
hourly schedule requires a plan that supports hourly execution, such as Pro.
Check the current Vercel plan limits before deployment.

After deployment, verify the Cron entry appears in the Vercel project and
inspect a scheduled invocation's status and logs. A successful invocation
queues due reminder emails and processes the existing email outbox; successful
email delivery additionally depends on the configured provider. No live Vercel
Cron invocation or provider delivery is verified by local tests.

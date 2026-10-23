# Security policy

Stash reads gift-card emails from people's Gmail and keeps their cards in their browser, so we
take security reports seriously and are grateful for them.

## Reporting a vulnerability

Email **lucamoreno12@gmail.com** with "Security" in the subject. Please include:

- what you found and where (URL or file),
- steps to reproduce it,
- what an attacker could do with it.

Please don't open a public GitHub issue for a security problem.

We'll reply within **3 business days**, keep you updated while we fix it, and tell you when it's
fixed. We're happy to credit you once the fix is live, if you'd like.

## Scope

In scope:

- the website at https://stashinc.pro and its API routes (`/api/*`),
- the Google sign-in and Gmail scan,
- this repository's code.

Out of scope: Google, Anthropic and Vercel themselves (report those to them), denial-of-service
and load testing, spam or social engineering, and reports from automated scanners without a
working example.

## Testing rules

- Only test with your own Google account and your own gift cards.
- Never access, change or keep anyone else's data. If you come across it by accident, stop,
  delete it and tell us.
- Don't run tests that could slow the site down for other people.

If you follow these rules in good faith, we won't take action against you.

## Supported versions

Only the version currently live at https://stashinc.pro is supported. Fixes are deployed there
directly.

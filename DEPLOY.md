# Deploying the public site

The public site has four parts:
- the landing page at `/`;
- the instant demo at `/demo`, which runs entirely in the browser on sample data;
- the waitlist;
- the privacy policy at `/privacy`.

It needs only a Cloudflare account. There's no database server to set up: waitlist signups go into Cloudflare D1, which
is created automatically on the first deploy.

> The full app (logins, Postgres, real ad-account sync) deploys separately later. See PLAN.md → Deployment checklist.

## 1. One-time setup (about 10 minutes)

Run these on your own machine, from the repository root, with Node 22+.

```bash
npm install
npx wrangler login              # opens a browser to authorize Wrangler with your Cloudflare account
npm run deploy:public           # builds and deploys; first run creates the D1 database
```

When it finishes, Wrangler prints a URL like `https://astuteads.<your-subdomain>.workers.dev`. Open it and check the
landing page, the demo and the waitlist form.

## 2. Custom domain

1. Buy `astuteads.com`, for example via Cloudflare dashboard → **Domain Registration → Register Domains**.
2. Go to **Workers & Pages → astuteads → Settings → Domains & Routes → Add → Custom domain** and enter `astuteads.com`.
   Add `www.astuteads.com` the same way.
3. Free email for `hello@astuteads.com`: **Email → Email Routing**, then forward it to your personal inbox. That address
   appears in the footer and the privacy policy. Change `CONTACT_EMAIL` in `wrangler.public.jsonc` if you use a different one.

## 3. Spam protection (Cloudflare Turnstile)

1. Dashboard → **Turnstile → Add widget**. Hostnames: `astuteads.com`, `www.astuteads.com`. Widget mode: **Managed**.
2. Set the secret **first**. With a site key but no secret, the form deliberately refuses every signup.
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.public.jsonc
   ```
3. Put the **site key** in `wrangler.public.jsonc` → `vars.TURNSTILE_SITE_KEY`, then run `npm run deploy:public`.

## 4. Meta Pixel (to measure the ad test)

1. Meta **Events Manager → Connect data sources → Web → Meta Pixel**. Name it "AstuteAds" and copy the Pixel ID.
2. Put it in `wrangler.public.jsonc` → `vars.META_PIXEL_ID`, then run `npm run deploy:public`.
3. Verify the domain: **Business settings → Brand safety → Domains → Add** `astuteads.com`. Choose the DNS TXT
   option and add the record in Cloudflare DNS.
4. Check it works: in Events Manager → **Test events**, open your site and join the waitlist with a test email.
   You should see `PageView`, `ViewContent` (when the demo opens) and `Lead` (when someone joins the waitlist).

## 5. Seeing your results

```bash
# Waitlist signups (newest first)
npx wrangler d1 execute astuteads-waitlist --remote -c wrangler.public.jsonc \
  --command "SELECT created_at, email, role, monthly_spend, platforms, utm_content, tried_demo FROM waitlist ORDER BY id DESC"

# Funnel by ad (utm_content): visits → demo starts, then signups
npx wrangler d1 execute astuteads-waitlist --remote -c wrangler.public.jsonc \
  --command "SELECT utm_content, name, COUNT(DISTINCT session_id) AS sessions FROM funnel_event WHERE utm_campaign = 'validation_1' GROUP BY 1, 2 ORDER BY 1, 2"
npx wrangler d1 execute astuteads-waitlist --remote -c wrangler.public.jsonc \
  --command "SELECT utm_content, COUNT(*) AS signups, SUM(tried_demo) AS tried_demo FROM waitlist WHERE utm_campaign = 'validation_1' GROUP BY 1"
```

Add `--json` to any command to export the results.

## Updating

Change code, then run `npm run deploy:public`. Locally, `npm run dev:public` runs the public site at http://localhost:5173 with a
local D1 (Turnstile and the Pixel stay off while their settings are empty).

# Meta ad validation test

**Goal:** find out, for about $150, whether advertisers care enough to try the demo and join the waitlist, and which
message pulls hardest.

## Before you launch
- [ ] Public site live on `astuteads.com` (see DEPLOY.md), with the Pixel and Turnstile set up
- [ ] Domain verified in Meta Business settings
- [ ] Facebook Page for AstuteAds (name, logo, one or two posts, so the ad doesn't come from an empty page)
- [ ] Joined the waitlist yourself and seen the `Lead` event in Events Manager → Test events
- [ ] Read the privacy policy (`/privacy`) and adjusted anything that isn't accurate for you

## Campaign setup

| Setting | Value |
|---|---|
| Objective | **Leads**. Conversion location: Website. Performance goal: maximize conversions. Conversion event: Pixel `Lead`. |
| Budget | **$15/day for 10 days** (~$150), on the ad set |
| Audience | United States, ages 25–60. Advantage+ audience, with suggestions: *Facebook Ads, Google Ads, Digital marketing, Small business owners, Shopify, Online advertising* |
| Placements | Advantage+ placements, but exclude **Audience Network** (it tends to bring accidental, low-intent clicks) |
| Ads | All 3 creatives below in **one ad set**, so they compete for the same budget |
| URL | `https://astuteads.com/` |
| URL parameters | `utm_source=facebook&utm_medium=paid&utm_campaign=validation_1&utm_content={{ad.name}}` |
| Ad names | `leak-card`, `ai-move`, `checklist`. They end up in `utm_content`, which is how the waitlist knows which ad brought each signup |

If Meta reports too few `Lead` events to optimize after 3–4 days (a new pixel has no history), duplicate the ad set
with the **Traffic** objective, optimizing for landing page views. Judge both by the waitlist numbers, not Meta's estimates.

## Creatives (1080×1350)

Files are in `marketing/creatives/`. To change the wording, edit `render.cjs` and run `node marketing/creatives/render.cjs`.

### 1. `leak-card.png`
- **Primary text:** Most ad accounts have a leak somewhere: an ad set burning money with zero conversions, a creative everyone's tired of, a campaign starved of budget. AstuteAds checks every ad, every day, and tells you in plain English what to fix. Try the live demo, no signup needed.
- **Headline:** Find the leaks in your ad budget
- **Description:** Free demo · Meta & Google Ads
- **CTA button:** Learn more

### 2. `ai-move.png`
- **Primary text:** Ads Manager shows you hundreds of numbers. AstuteAds tells you the three that matter this week, and what to do about them. Read-only, so it never touches your campaigns. See it on a sample account.
- **Headline:** Your next best move, ranked
- **Description:** Try the demo free
- **CTA button:** Learn more

### 3. `checklist.png`
- **Primary text:** Wasted spend. Cost spikes. Tired creative. Capped winners. Weak ads. Broken tracking. AstuteAds checks your Meta and Google Ads for all six every day, so you don't have to. Join the early-access waitlist, free.
- **Headline:** 6 budget leaks, checked daily
- **Description:** Early access is free
- **CTA button:** Sign up

Keep the "Sample data" label on the images and the "demo" wording. The product doesn't connect real accounts yet, and the
ad shouldn't suggest it does.

## What to measure

Use the queries in DEPLOY.md → "Seeing your results", plus link CTR and spend from Ads Manager.

| Metric | How | What it tells you |
|---|---|---|
| Link CTR (Ads Manager) | clicks ÷ impressions | Does the message stop the scroll? |
| Demo start rate | `demo_start` ÷ `landing_view` sessions | Does the landing page make people curious? |
| Signup rate | waitlist rows ÷ `landing_view` sessions | Real intent |
| Signups after the demo | `tried_demo` share of signups | Does the product itself convince people? |
| **Cost per signup** | spend ÷ waitlist rows (per ad) | The headline number |
| Who signed up | role and monthly spend mix | Is this the audience you want to sell to? |

**Set your bar before launching.** One way: if you expect to charge about $49/month and 1 in 5 waitlist signups to pay,
a signup is worth about $10 of first-month revenue. Under ~$10 per signup is very encouraging; $10–30 is promising and
worth refining; above that, change the message or the audience before concluding anything.
Also look at the *quality* of signups. Ten agencies spending $25k+/month are worth more than a hundred hobbyists.

## After the test
- Email signups personally ("what made you sign up? what's your biggest headache with your ads?"). This is the most
  valuable output of the whole test.
- Keep the best ad, write two new variations of its message, and run a second round.

import { Link } from "react-router";
import { useSiteConfig } from "../lib/site";
import { SiteFooter } from "./Landing";

// NOTE: starting-point draft written for the waitlist + demo site. Have it reviewed before
// relying on it, and update it before connecting real ad accounts.
export function PrivacyPage() {
  const config = useSiteConfig();
  const email = config?.contactEmail ?? "hello@astuteads.com";
  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="logo">Astute<span>Ads</span></Link>
        <nav>
          <Link to="/demo" className="button secondary small">Try the demo</Link>
        </nav>
      </header>
      <main className="prose">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated: November 2026</p>

        <p>
          This policy explains what information AstuteAds (“we”, “us”) collects through this website, including the waitlist and
          the demo, and how we use it. Questions: <a href={`mailto:${email}`}>{email}</a>.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Waitlist details you give us:</strong> your email address and, if you choose, your role, monthly ad spend range and the ad platforms you use.</li>
          <li><strong>How you found us:</strong> campaign tags in the link you followed (UTM parameters), the referring website, the first page you visited, whether you tried the demo, and your country as determined from your IP address. We don't store your IP address.</li>
          <li><strong>Anonymous usage events:</strong> for example “viewed the landing page” or “started the demo”, linked to a random identifier that lasts for your browser session.</li>
          <li><strong>Demo activity:</strong> the demo runs entirely in your browser on sample data. Your choices in the demo are saved only in your browser's local storage and are never sent to us.</li>
        </ul>

        <h2>Cookies and similar technologies</h2>
        <ul>
          <li><strong>Meta Pixel.</strong> We use the Meta Pixel to measure our ads on Facebook and Instagram, for example to count how many people join the waitlist after seeing an ad. Meta may use cookies and receive information about your visit under <a href="https://www.facebook.com/privacy/policy" target="_blank" rel="noreferrer">Meta's privacy policy</a>. You can control ad personalization in your Facebook or Instagram settings.</li>
          <li><strong>Cloudflare Turnstile</strong> helps us block spam on the waitlist form. It may process information about your browser and device under <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare's privacy policy</a>.</li>
          <li><strong>Local storage</strong> keeps your demo choices and how you arrived on the site (for up to 30 days). You can clear it at any time in your browser.</li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To contact you about early access to AstuteAds and related product updates. We'll send few emails, and you can unsubscribe or ask us to remove you at any time.</li>
          <li>To understand which channels and messages bring interested advertisers, and to improve the product.</li>
        </ul>
        <p>We don't sell your personal information, and we don't share it except with the service providers below.</p>

        <h2>Service providers</h2>
        <p>
          Cloudflare hosts this website and stores waitlist data. Meta provides ad measurement as described above. When we start
          sending email, we'll use an email delivery provider and update this page.
        </p>

        <h2>How long we keep it</h2>
        <p>We keep waitlist details until you ask us to delete them, or for up to 24 months after early access ends if you don't become a customer.</p>

        <h2>Your choices and rights</h2>
        <p>
          You can ask us to access, correct or delete your information, or to stop contacting you, by emailing{" "}
          <a href={`mailto:${email}`}>{email}</a>. Depending on where you live (for example California or the EU/UK), you may have
          additional rights, which we'll honor.
        </p>

        <h2>Children</h2>
        <p>This site is for businesses and isn't directed to children under 16.</p>

        <h2>Changes</h2>
        <p>
          We'll update this page if our practices change, in particular before you can connect real Meta or Google Ads accounts,
          which will involve additional data and protections.
        </p>
      </main>
      <SiteFooter contactEmail={config?.contactEmail} />
    </div>
  );
}

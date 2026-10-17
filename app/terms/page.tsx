import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Terms of Service · Stash",
  description: "The rules for using Stash, and what Stash is and isn't responsible for.",
};

const CONTACT = "lucamoreno12@gmail.com";
const UPDATED = "October 17, 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight text-zinc-900">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-zinc-600">{children}</div>
    </section>
  );
}

const link = "font-semibold text-emerald-700 underline";

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <a href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
        &larr; Back to Stash
      </a>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">Terms of Service</h1>
      <p className="mt-2 text-sm text-zinc-400">Effective and last updated {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-zinc-600">
        Please read these Terms of Service (&ldquo;Terms&rdquo;) before using Stash, the website at stashinc.pro and its
        related features (together, the &ldquo;Service&rdquo;), run by Stash (&ldquo;Stash&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By using the Service, you agree to these Terms. If you don&rsquo;t agree, please don&rsquo;t use
        it.
      </p>

      <Section title="1. What Stash is">
        <p>
          Stash is an organization tool that helps you find, track and manage gift cards you already have. It finds them
          through a read-only connection to your Gmail, by scanning a plastic card&rsquo;s barcode with your camera, or from
          details you type in. It also offers features such as expiry countdowns and calendar reminders.
        </p>
        <p>
          Stash helps you keep track of information you already have access to. Stash does not issue, sell, guarantee or
          hold any gift card or the money on it. A card&rsquo;s balance, validity and redemption are decided only by the
          retailer that issued it, not by Stash.
        </p>
      </Section>

      <Section title="2. Who can use Stash">
        <p>
          You must be at least 13 years old to use Stash. If you are under 18, or under the age of majority where you live,
          you may only use Stash with the involvement and consent of a parent or legal guardian, who agrees to these Terms
          on your behalf.
        </p>
      </Section>

      <Section title="3. Your Gmail and your device">
        <p>
          Stash has no user accounts or passwords. When you choose &ldquo;Connect Gmail&rdquo;, you give Stash limited,
          read-only access to look for gift-card emails, as described in our{" "}
          <a href="/privacy" className={link}>
            Privacy Policy
          </a>
          . You can end that access at any time with &ldquo;Disconnect Gmail&rdquo; or at{" "}
          <a href="https://myaccount.google.com/permissions" className={link}>
            myaccount.google.com/permissions
          </a>
          .
        </p>
        <p>
          Your gift cards, including their codes and PINs, are saved in your own browser on your device. You are
          responsible for keeping your email account and your device secure, including your passwords, two-factor
          authentication, and who else can use your browser. Stash is not responsible for access to your email account or
          your device that happens outside Stash&rsquo;s own systems, such as stolen passwords, phishing, a shared or lost
          device, or breaches of other services.
        </p>
      </Section>

      <Section title="4. Gift card information and accuracy">
        <p>
          Stash pulls gift card details, such as the store, amount, balance, expiry date and card code, out of the emails
          and cards you connect or scan. Some of this is read automatically by an AI model, and it can make mistakes. We
          don&rsquo;t guarantee that any balance, expiry date or other detail shown in Stash is accurate, complete or up to
          date. Balances and validity can change for reasons outside our control, such as retailer policy changes, fraud or
          earlier use of the card. Always check a card&rsquo;s balance and validity with the retailer before relying on it
          for a purchase.
        </p>
      </Section>

      <Section title="5. Limitation of liability">
        <p>
          To the fullest extent the law allows, Stash and its founders are not liable for any indirect, incidental,
          special, consequential or punitive damages, including loss of money, loss of gift card value or loss of data,
          arising from or related to your use of the Service.
        </p>
        <p>Stash is provided as an organization and tracking tool only. You understand and agree that:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Stash does not guarantee that any gift card balance it shows is accurate, current or redeemable.</li>
          <li>
            Stash is not responsible for gift cards that are lost, stolen, expired or made unusable by retailer policies,
            fraud or anything else outside Stash&rsquo;s control.
          </li>
          <li>
            Stash is not responsible for losses caused by a compromised email account, device, or third-party service not
            run by Stash.
          </li>
          <li>
            Where liability can&rsquo;t be excluded by law, Stash&rsquo;s total liability to you for any claim related to
            the Service is limited to the amount you paid Stash, if any, in the twelve (12) months before the claim.
          </li>
        </ul>
      </Section>

      <Section title="6. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Use Stash for anything unlawful, including trying to access, use or resell gift cards you don&rsquo;t own or
            don&rsquo;t have a legal right to use.
          </li>
          <li>Connect an email account you aren&rsquo;t authorized to access.</li>
          <li>Try to reverse-engineer, overload, disrupt or gain unauthorized access to Stash&rsquo;s systems.</li>
          <li>Use automated tools to scrape or extract data from the Service.</li>
        </ul>
        <p>We may block or limit access to the Service for anyone who breaks these rules.</p>
      </Section>

      <Section title="7. Deleting your data and stopping use">
        <p>You can stop using Stash at any time:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Disconnect Gmail</strong> ends Stash&rsquo;s access to your Gmail straight away. Cards already in your
            wallet stay on your device until you remove them.
          </li>
          <li>
            <strong>Clear all gift cards</strong>, at the bottom of your wallet, permanently deletes every card, code, PIN
            and note Stash saved on your device. Clearing this site&rsquo;s data in your browser does the same.
          </li>
        </ul>
        <p>
          Stash keeps no copy of your inbox or your cards on its servers, so these steps remove everything. You can also
          email{" "}
          <a href={`mailto:${CONTACT}`} className={link}>
            {CONTACT}
          </a>{" "}
          with any request.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          Stash, including its design, features and technology, belongs to its creators and is protected by intellectual
          property laws. You may not copy, modify, distribute or create works based on the Service without our written
          permission. Gift card brand names and logos belong to their owners.
        </p>
      </Section>

      <Section title="9. Third-party services">
        <p>
          Stash works with third-party services, including Google&rsquo;s Gmail API, Anthropic (which reads gift-card
          emails), Vercel (hosting), and the retailer and calendar websites Stash links to. Your use of those services is
          also covered by their own terms and policies. Stash is not responsible for their practices or availability.
        </p>
      </Section>

      <Section title="10. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind,
          express or implied, including warranties of merchantability, fitness for a particular purpose or
          non-infringement. We don&rsquo;t promise that the Service will be uninterrupted, error-free or completely secure.
        </p>
      </Section>

      <Section title="11. Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we do, we&rsquo;ll update this page and the date at the top,
          and for important changes we&rsquo;ll show a notice on the site before they take effect. Continuing to use the
          Service after changes take effect means you accept the updated Terms.
        </p>
      </Section>

      <Section title="12. Governing law">
        <p>These Terms are governed by the laws of the State of California, without regard to its conflict-of-law rules.</p>
      </Section>

      <Section title="13. Contact us">
        <p>
          Questions about these Terms? Email{" "}
          <a href={`mailto:${CONTACT}`} className={link}>
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

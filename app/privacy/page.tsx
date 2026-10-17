import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy Policy · Stash",
  description: "What Stash reads, what it keeps, who it shares it with, and how to delete it.",
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

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <a href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
        &larr; Back to Stash
      </a>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-zinc-400">Last updated {UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-zinc-600">
        Stash (&ldquo;Stash&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) helps you find gift cards you forgot you had. This policy
        explains exactly what Stash reads, what it keeps, who else sees it, and how to remove it. It covers the website at
        stashinc.pro.
      </p>

      <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-[15px] leading-relaxed text-emerald-900">
        <p className="font-semibold">The short version</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Stash only asks Google for read-only access to Gmail. It can never send, delete or change anything.</li>
          <li>It only opens emails that look like gift cards, and only to pull out the card details.</li>
          <li>To read those emails, their text is sent to our AI provider, Anthropic. Nothing is used for advertising.</li>
          <li>Your cards are saved in your own browser, on your device. Our servers keep no copy.</li>
          <li>You can disconnect Gmail and delete everything at any time, instantly.</li>
        </ul>
      </div>

      <Section title="1. What Stash reads from Gmail">
        <p>
          When you choose &ldquo;Connect Gmail&rdquo;, Google asks you to give Stash read-only access to your Gmail account
          (the <code className="rounded bg-zinc-100 px-1 text-[13px]">gmail.readonly</code> permission). Stash uses it only
          while you run a scan:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            It searches your mailbox for emails that look like gift cards, eGift deliveries, gift card balances and
            redemption receipts. Other emails are never opened.
          </li>
          <li>
            From each matching email it reads the sender, date, subject and message text, and finds the store, amount,
            card number, PIN, expiry date and any &ldquo;view your gift card&rdquo; link.
          </li>
        </ul>
        <p>
          Stash never sends email, deletes email, changes labels, reads attachments or looks at your contacts.
        </p>
      </Section>

      <Section title="2. How that information is used">
        <p>Only to show you your gift cards: the store, amount, code, PIN, expiry date and whether a card looks already used.</p>
        <p>
          We do <strong>not</strong> use Gmail data for advertising, sell it, use it to build a profile of you, or use it
          to train AI models. No person at Stash reads your email. The only exceptions are if you ask us to look at a
          problem with your account and give us permission, if it is needed for security (such as investigating abuse),
          or if the law requires it.
        </p>
      </Section>

      <Section title="3. Who else processes your data">
        <p>Stash relies on a small number of service providers. Each only gets what it needs to do its job:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Anthropic</strong> (AI provider). The sender, date, subject and text of each matching gift-card email
            (up to about 12,000 characters) are sent to Anthropic&rsquo;s API so its AI model can pull out the card details.
            We use Anthropic&rsquo;s commercial API, whose terms don&rsquo;t allow this data to be used to train its models.
          </li>
          <li>
            <strong>Google</strong>. Handles your sign-in and provides read-only access to your Gmail.
          </li>
          <li>
            <strong>Vercel</strong> (hosting). Runs the website and the scan. Like any web host, it handles technical
            request data such as your IP address. Our server logs record counts and errors, not your card numbers,
            amounts or email contents.
          </li>
        </ul>
        <p>We don&rsquo;t sell or share your data with anyone else.</p>
      </Section>

      <Section title="4. What is stored, and where">
        <p>
          <strong>On our servers: nothing from your inbox.</strong> Each scan reads the matching emails, extracts the card
          details, sends the results to your browser and keeps nothing.
        </p>
        <p>
          <strong>In your browser, on your device:</strong> your wallet is saved in your browser&rsquo;s local storage so
          it&rsquo;s there next time and so Stash can count down to expiry dates. This includes:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Cards found in Gmail: store, amount, card number, PIN, expiry date, any balance found, and a reference to the
            original email so you can open it in Gmail.
          </li>
          <li>Plastic cards you scan: the details you confirm, and a small photo of the card&rsquo;s front.</li>
          <li>Your own notes about cards: what you marked as used, purchases you logged, and cards you marked &ldquo;not mine&rdquo;.</li>
        </ul>
        <p>
          This data never leaves your device unless you send it somewhere, and anyone who can use your browser can see
          it. On a shared computer, use &ldquo;Clear all gift cards&rdquo; when you&rsquo;re done.
        </p>
        <p>
          <strong>Cookies:</strong> Stash uses two strictly necessary cookies and no tracking or advertising cookies.
          <code className="mx-1 rounded bg-zinc-100 px-1 text-[13px]">g_state</code> protects the Google sign-in and
          expires after 10 minutes.
          <code className="mx-1 rounded bg-zinc-100 px-1 text-[13px]">g_token</code> holds the temporary Google access
          token for your scan. It expires within about an hour, or immediately when you disconnect.
        </p>
        <p>
          <strong>Plastic card scanning</strong> uses your camera only while the scanner is open. The barcode is read on
          your device, and the photo is not sent to us.
        </p>
      </Section>

      <Section title="5. Your choices and deleting your data">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Disconnect Gmail:</strong> use &ldquo;Disconnect Gmail&rdquo; in your wallet. Stash revokes its access
            at Google straight away. You can also remove Stash at{" "}
            <a href="https://myaccount.google.com/permissions" className="font-semibold text-emerald-700 underline">
              myaccount.google.com/permissions
            </a>
            .
          </li>
          <li>
            <strong>Delete your cards:</strong> use &ldquo;Clear all gift cards&rdquo; at the bottom of your wallet, or
            clear this site&rsquo;s data in your browser settings. Because we keep nothing on our servers, this removes
            everything.
          </li>
          <li>
            <strong>Questions or requests:</strong> email{" "}
            <a href={`mailto:${CONTACT}`} className="font-semibold text-emerald-700 underline">
              {CONTACT}
            </a>
            . We&rsquo;ll answer within 30 days.
          </li>
        </ul>
      </Section>

      <Section title="6. Do Not Track and California">
        <p>
          Stash doesn&rsquo;t track you across other websites and doesn&rsquo;t use tracking or advertising cookies, so it
          works the same whether or not your browser sends a &ldquo;Do Not Track&rdquo; signal. We don&rsquo;t sell or
          share personal information.
        </p>
        <p>
          If you live in California, you can ask what information we have about you or ask us to delete it by emailing{" "}
          <a href={`mailto:${CONTACT}`} className="font-semibold text-emerald-700 underline">
            {CONTACT}
          </a>
          . Because your cards are stored only in your own browser, &ldquo;Clear all gift cards&rdquo; deletes them
          immediately.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          All traffic to Stash is encrypted (HTTPS). Gmail access is read-only and limited to what a scan needs. The Google
          access token is kept in a secure cookie that the page&rsquo;s own scripts can&rsquo;t read. The site sends strict
          security headers, including a Content Security Policy, to block injected scripts.
        </p>
      </Section>

      <Section title="8. Children">
        <p>Stash is not meant for children under 13, and we don&rsquo;t knowingly collect their information.</p>
      </Section>

      <Section title="9. Google API Services User Data Policy">
        <p>
          Stash&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-semibold text-emerald-700 underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section title="10. Changes to this policy">
        <p>
          If we change how Stash handles your data, we&rsquo;ll update this page and the date at the top. If a change
          affects your Gmail data, we&rsquo;ll ask for your permission again before it applies.
        </p>
      </Section>

      <p className="mt-12 border-t border-zinc-200 pt-6 text-sm text-zinc-400">
        See also our{" "}
        <a href="/terms" className="text-emerald-700 underline">
          Terms of Service
        </a>
        . Questions? Email{" "}
        <a href={`mailto:${CONTACT}`} className="text-emerald-700 underline">
          {CONTACT}
        </a>
        .
      </p>
    </main>
  );
}

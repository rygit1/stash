import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "About · Stash",
  description: "Who builds Stash, and why.",
};

const CONTACT = "lucamoreno12@gmail.com";

const FOUNDERS = [
  { name: "Luca Moreno", initials: "LM" },
  { name: "Ryan Yousefi", initials: "RY" },
  { name: "Gavin Jain", initials: "GJ" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold tracking-tight text-zinc-900">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-zinc-600">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">
        &larr; Back to Stash
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">About Stash</h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-500">
        Stash is built by three freshmen at Harvard-Westlake who got tired of watching gift-card money go to waste.
      </p>

      <Section title="The creators">
        <ul className="grid gap-4 sm:grid-cols-3">
          {FOUNDERS.map((f) => (
            <li key={f.name} className="rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                {f.initials}
              </div>
              <p className="mt-3 font-semibold text-zinc-900">{f.name}</p>
              <p className="text-sm text-zinc-500">Co-founder</p>
            </li>
          ))}
        </ul>
        <p>
          We&rsquo;re a small team, so all three of us do a bit of everything: designing the app, writing the code,
          testing it on our own gift cards, and keeping your data safe.
        </p>
      </Section>

      <Section title="Our mission">
        <p>
          Billions of dollars in gift cards go unused every year. The average person has about $244 in gift cards they
          forgot about, sitting in old emails and junk drawers until they expire.
        </p>
        <p>
          Our mission is simple: <strong>help everyone find and use the money that&rsquo;s already theirs.</strong>
        </p>
      </Section>

      <Section title="An app for everybody">
        <p>We want Stash to work for anyone, not just people who are good with technology:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>It runs in the browser on any phone or computer. There&rsquo;s nothing to install.</li>
          <li>You don&rsquo;t need to make an account. Connect Gmail or scan a plastic card and you&rsquo;re done.</li>
          <li>
            Your privacy comes first. Stash only reads gift-card emails, keeps your cards on your own device, and lets you
            delete everything at any time. Read the details in our{" "}
            <Link href="/privacy" className="font-semibold text-emerald-700 underline">
              Privacy Policy
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section title="Say hi">
        <p>
          Ideas, bugs, or a gift card Stash missed? Email us at{" "}
          <a href={`mailto:${CONTACT}`} className="font-semibold text-emerald-700 underline">
            {CONTACT}
          </a>
          . We read everything.
        </p>
      </Section>
    </main>
  );
}

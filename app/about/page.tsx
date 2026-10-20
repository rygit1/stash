import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { about } from "./content";

// The words on this page live in ./content.ts so they can be edited without touching the layout.

export const metadata: Metadata = {
  title: "About · Stash",
  description: "Who builds Stash, and why.",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("");

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
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">{about.title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-zinc-500">{about.intro}</p>

      <Section title={about.creatorsTitle}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {about.creators.map((c) => (
            <li key={c.name} className="rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                {initials(c.name)}
              </div>
              <p className="mt-3 font-semibold text-zinc-900">{c.name}</p>
              <p className="text-sm text-zinc-500">{c.role}</p>
              {c.bio && <p className="mt-2 text-sm leading-relaxed text-zinc-600">{c.bio}</p>}
            </li>
          ))}
        </ul>
        {about.creatorsText.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </Section>

      <Section title={about.missionTitle}>
        {about.missionText.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <p>
          Our mission is simple: <strong>{about.missionStatement}</strong>
        </p>
      </Section>

      <Section title={about.everybodyTitle}>
        <p>{about.everybodyIntro}</p>
        <ul className="list-disc space-y-1 pl-5">
          {about.everybodyPoints.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Section>
    </main>
  );
}

const stages = [
  {
    number: '01',
    title: 'Receive the signal',
    description: 'Citizen reports through text, voice transcripts, and images.',
  },
  {
    number: '02',
    title: 'Understand the situation',
    description: 'Explainable urgency scoring and location-based incident grouping.',
  },
  {
    number: '03',
    title: 'Coordinate the response',
    description: 'Nearest available rescue units, dispatch, and live tracking.',
  },
];

// Phase 0 verifies the frontend toolchain. Live workflows arrive in later phases.
export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 py-7">
        <a href="/" className="flex items-center gap-3 font-semibold tracking-tight">
          <img src="/favicon.svg" width="38" height="38" alt="" />
          <span className="text-xl">DisasterMesh</span>
        </a>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-medium text-amber-200">
          Setup mode · Phase 0
        </span>
      </header>

      <section className="py-16 sm:py-24" aria-labelledby="page-title">
        <p className="mb-5 text-xs font-semibold tracking-[0.22em] text-emerald-300">
          CHENNAI / CRISIS RESPONSE
        </p>
        <h1 id="page-title" className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-tight sm:text-7xl">
          A clearer picture.
          <br />
          <span className="text-emerald-300">A faster response.</span>
        </h1>
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-300">
          The project foundation is ready. The reporting interface and dispatch
          command center will be built in the next phases.
        </p>
        <div className="mt-9 flex max-w-xl items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-slate-300" role="status">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-300" />
          <p>
            Frontend loaded. Database connectivity and live dispatch are not yet
            implemented. Follow the project README to configure your server environment.
          </p>
        </div>
      </section>

      <section aria-label="Planned response workflow" className="mb-14 grid gap-6 border-t border-white/10 pt-8 md:grid-cols-3">
        {stages.map((stage) => (
          <article key={stage.number}>
            <p className="mb-4 font-mono text-sm text-emerald-300">{stage.number} / PLANNED</p>
            <h2 className="mb-2 text-lg font-semibold">{stage.title}</h2>
            <p className="text-sm leading-relaxed text-slate-400">{stage.description}</p>
          </article>
        ))}
      </section>

      <footer className="mt-auto flex flex-wrap justify-between gap-3 border-t border-white/10 py-5 text-xs text-slate-400">
        <span>PS-05 · DisasterMesh</span>
        <span>Vite + React + TypeScript + Tailwind</span>
      </footer>
    </main>
  );
}

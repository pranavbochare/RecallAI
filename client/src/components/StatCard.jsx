export default function StatCard({ icon: Icon, label, value, hint, loading, tone = 'from-blue-500 to-indigo-500', delay = 0 }) {
  return (
    <div className="card animate-fade-up p-4 transition hover:-translate-y-0.5 hover:shadow-lift" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <div className={`grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${tone} text-white shadow-sm`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <p className="text-sm font-medium text-zinc-500">{label}</p>
      </div>
      {loading ? (
        <div className="skeleton mt-4 h-8 w-24" />
      ) : (
        <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

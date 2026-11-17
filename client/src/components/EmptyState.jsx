export default function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex animate-fade-up flex-col items-center px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-50 to-violet-100 text-indigo-600 ring-1 ring-indigo-100">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

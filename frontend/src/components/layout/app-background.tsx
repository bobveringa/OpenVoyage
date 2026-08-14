export function AppBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--app-gradient-surface)]"
      aria-hidden="true"
    >
      <div className="absolute -left-28 -top-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute right-[-10rem] top-20 h-[34rem] w-[34rem] rounded-full bg-chart-4/20 blur-3xl" />
      <div className="absolute bottom-[-12rem] left-[18%] h-[34rem] w-[34rem] rounded-full bg-accent/25 blur-3xl" />
      <div className="absolute bottom-16 right-[20%] h-80 w-80 rounded-full bg-secondary/70 blur-3xl" />
      <div className="absolute inset-0 bg-background/35" />
    </div>
  )
}

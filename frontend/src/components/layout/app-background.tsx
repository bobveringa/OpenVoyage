export function AppBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-emerald-50 via-green-50 to-amber-50"
      aria-hidden="true"
    >
      <div className="absolute -left-28 -top-32 h-96 w-96 rounded-full bg-emerald-300/45 blur-3xl" />
      <div className="absolute right-[-10rem] top-20 h-[34rem] w-[34rem] rounded-full bg-green-300/35 blur-3xl" />
      <div className="absolute bottom-[-12rem] left-[18%] h-[34rem] w-[34rem] rounded-full bg-amber-300/45 blur-3xl" />
      <div className="absolute bottom-16 right-[20%] h-80 w-80 rounded-full bg-lime-300/30 blur-3xl" />
      <div className="absolute inset-0 bg-white/35" />
    </div>
  )
}

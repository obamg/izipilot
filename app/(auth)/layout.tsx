export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-between bg-teal-lt px-4 py-8 sm:py-12"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at top, #ffffff 0%, var(--teal-lt) 55%, var(--teal-lt) 100%)",
      }}
    >
      <div className="flex flex-1 w-full items-center justify-center">
        {children}
      </div>
      <footer className="mt-8 text-center text-[11px] text-izi-gray">
        IziPilot &middot; by{" "}
        <span className="font-medium text-dark-md">IziChange S.A.</span>
        <span className="mx-1.5 text-izi-gray/60">&middot;</span>
        Pilotage OKR
      </footer>
    </div>
  );
}

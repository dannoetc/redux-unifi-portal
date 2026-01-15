export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">ReduxTC WiFi Portal</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Frontend scaffold. Guest pages live under <code>/guest/s/[tenant]/[site]</code> and admin under <code>/admin</code>.
      </p>
      <div className="mt-6 rounded-lg border p-4">
        <p className="text-sm">
          Next step: initialize shadcn/ui in <code>frontend/</code>:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-black/5 p-3 text-xs">
          npx shadcn@latest init
        </pre>
      </div>
    </main>
  );
}

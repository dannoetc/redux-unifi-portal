type Props = {
  params: { tenant: string; site: string };
  searchParams: { [key: string]: string | string[] | undefined };
};

function getParam(sp: Props["searchParams"], key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export default function GuestLanding({ params, searchParams }: Props) {
  const clientMac = getParam(searchParams, "id");
  const ssid = getParam(searchParams, "ssid");
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-lg font-semibold">Connect to WiFi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tenant: <span className="font-medium">{params.tenant}</span> · Site:{" "}
          <span className="font-medium">{params.site}</span>
        </p>
        <div className="mt-4 rounded-md bg-black/5 p-3 text-xs">
          <div>MAC: {clientMac ?? "—"}</div>
          <div>SSID: {ssid ?? "—"}</div>
        </div>

        <div className="mt-6 space-y-2">
          <button className="w-full rounded-md border px-4 py-2 text-sm hover:bg-black/5">
            Continue with SSO
          </button>
          <button className="w-full rounded-md border px-4 py-2 text-sm hover:bg-black/5">
            Use Voucher
          </button>
          <button className="w-full rounded-md border px-4 py-2 text-sm hover:bg-black/5">
            Email me a code
          </button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Tip: If sign-in fails in the captive browser, choose “Open in browser”.
        </p>
      </div>
    </main>
  );
}

type Status = "active" | "inactive" | "poor" | "unknown";

const STATUS_STYLES: Record<Status, string> = {
  active: "bg-emerald-100 text-emerald-700",
  inactive: "bg-gray-100 text-gray-600",
  poor: "bg-amber-100 text-amber-700",
  unknown: "bg-gray-100 text-gray-600",
};

export default function StatusPill({ status }: { status: Status }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${style}`}>
      {status}
    </span>
  );
}

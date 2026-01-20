type AvatarProps = {
  name: string;
};

const getInitials = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "AD";
  }
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean);
  const initials = parts.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return initials || "AD";
};

export default function Avatar({ name }: AvatarProps) {
  return (
    <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
      {getInitials(name)}
    </div>
  );
}

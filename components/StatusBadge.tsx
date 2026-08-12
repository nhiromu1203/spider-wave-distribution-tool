import { STATUS_LABEL, type BuildingStatus } from "@/lib/supabase/types";

const STYLE: Record<BuildingStatus, string> = {
  NOT_DISTRIBUTED: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  POSSIBLE_DUPLICATE: "bg-amber-50 text-amber-800 border border-amber-200",
  CONFIRMED_DISTRIBUTED: "bg-slate-100 text-slate-600 border border-slate-200",
};

export function StatusBadge({ status }: { status: BuildingStatus }) {
  return <span className={`badge ${STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

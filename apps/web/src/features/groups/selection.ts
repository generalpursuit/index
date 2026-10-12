import type { Group } from "@/lib/types";

/** A missing row is authoritative only once every page was loaded successfully. */
export function reconcileGroup(value: Group | null, items: Group[], complete: boolean) {
  const current = value && items.find((group) => group.id === value.id);
  return { current: current || value, unavailable: !!value && !current && complete };
}

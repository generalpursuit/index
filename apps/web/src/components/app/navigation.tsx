import { IconButton } from "@index/ui/components/icon-button";
import { ChevronLeft } from "lucide-react";
import { useBack } from "@/hooks/use-back";
import type { ReactNode } from "react";

export function Back({ fallback = "/" }: { fallback?: string }) {
  const back = useBack(fallback);
  return (
    <IconButton label="Back" onClick={back}>
      <ChevronLeft />
    </IconButton>
  );
}
export function Heading({
  children,
  back = false,
  actions,
}: {
  children: ReactNode;
  back?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header
      className={
        "page-heading flex items-center gap-3 mb-8 min-w-0 [&_h1]:flex-1 [&_h1]:min-w-0 [&_h1]:self-start [@media(width<=700px)]:mb-6.5 [@media(width<=700px)]:gap-1"
      }
    >
      {back && <Back />}
      <h1>{children}</h1>
      <div
        className={"heading-actions flex gap-1 items-center ml-auto [@media(width<=700px)]:gap-0.5"}
      >
        {actions}
      </div>
    </header>
  );
}

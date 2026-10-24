import { useRef, useState } from "react";
import { Button } from "@index/ui/components/button";
import { Modal } from "@index/ui/components/modal";
import testFlightQR from "@/assets/testflight-qr.svg";
import { rowButtonClassName, SettingsRow } from "./rows";

const testFlight = "https://testflight.apple.com/join/kqYCvuq7";

/** The beta's TestFlight link, with a code to scan from a phone. */
export function MobileAppSettings() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <SettingsRow label="Index for iPhone & iPad" description="Join the beta through TestFlight.">
      <Button
        ref={trigger}
        variant="outline"
        className={rowButtonClassName}
        onClick={() => setOpen(true)}
      >
        Get the app
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Index for iPhone & iPad"
        description="Scan with your phone’s camera to join the beta and install Index through TestFlight."
        returnFocus={trigger}
      >
        <div className="flex flex-col items-center gap-4 pb-1">
          <img
            src={testFlightQR}
            alt="Scan to join the Index beta on TestFlight"
            width={184}
            height={184}
            className="size-46 rounded-lg"
          />
          <a
            href={testFlight}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-[13px] font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
          >
            Open in TestFlight
          </a>
        </div>
      </Modal>
    </SettingsRow>
  );
}

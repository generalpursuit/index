import testFlightQR from "@/assets/testflight-qr.svg";

export function MobileAppSettings() {
  return (
    <section
      className="settings-box flex flex-wrap items-center gap-5 rounded-[18px] border border-border p-[20px_22px]"
      aria-labelledby="settings-mobile-app"
    >
      <div className="min-w-0 flex-1 basis-48">
        <h2 id="settings-mobile-app" className="text-[16px] font-medium">
          Index for iPhone &amp; iPad
        </h2>
        <p className="mt-1 text-[13px] text-subtle-foreground">
          Scan with your phone’s camera to join the beta and install Index through TestFlight.
        </p>
        <a
          href="https://testflight.apple.com/join/kqYCvuq7"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring"
        >
          Open in TestFlight
        </a>
      </div>
      <img
        src={testFlightQR}
        alt="Scan to join the Index beta on TestFlight"
        width={164}
        height={164}
        className="size-41 flex-none rounded-lg"
      />
    </section>
  );
}

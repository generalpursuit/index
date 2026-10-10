/** Explicit origin allowlist; wildcard domains and paths are intentionally rejected. */
export function trustedWebOrigins(primary: string, additional = "") {
  return [
    ...new Set(
      [
        primary,
        ...additional
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ].map((value) => {
        const url = new URL(value);
        if (
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.pathname !== "/" ||
          (url.protocol !== "https:" &&
            !(
              url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            ))
        ) {
          throw new Error(
            "Configure explicit HTTPS web origins (HTTP is allowed for loopback development).",
          );
        }
        return url.origin;
      }),
    ),
  ];
}

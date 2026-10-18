// Pure path helpers, apart from the loaders in `routes.ts` so code without a router or API
// client, such as unit-tested feature logic, can use them.
export const isUUID = (value: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export const linkReferencePath = (value: string) =>
  `${isUUID(value) ? "/links/" : "/l/"}${encodeURIComponent(value)}`;

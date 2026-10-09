export const apiURL = `http://localhost:${process.env.E2E_API_PORT ?? 3002}`;
export const webPort = Number(process.env.E2E_WEB_PORT ?? 4173);
export const webURL = `http://localhost:${webPort}`;

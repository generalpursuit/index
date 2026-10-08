import { createTestDatabase } from "../../../packages/api/src/testing/database.ts";
import { createAuth } from "../../../packages/auth/src/index.ts";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "../../../packages/api/src/routers/index.ts";
import { apiHandler, rpcHandler } from "../../server/src/transport.ts";
const database = await createTestDatabase();
const auth = createAuth(
  {
    BETTER_AUTH_URL: "http://localhost:3002",
    BETTER_AUTH_SECRET: "isolated-playwright-only-secret-32-characters",
    CORS_ORIGIN: "http://localhost:4173",
  },
  database.db,
  ["tauri://localhost", "http://tauri.localhost"],
);
let fixture;
async function seed() {
  await database.client.exec('TRUNCATE TABLE "user", conversations CASCADE');
  const people = {};
  for (const name of ["Alice", "Bob", "Lena", "Amir", "Iris", "Mia", "Noah"]) {
    const result = await auth.api.signUpEmail({
      body: { name, email: name.toLowerCase() + "@test.example", password: "test-password-123" },
    });
    people[name] = result.user.id;
  }
  const api = (name) => createRouterClient(appRouter, { context: database.context(people[name]) });
  for (const name of Object.keys(people))
    await api(name).profiles.update({
      username: name.toLowerCase(),
      profileVisibility: ["Iris", "Mia"].includes(name) ? "private" : "public",
    });
  for (const name of ["Bob", "Lena", "Amir", "Iris"]) {
    await api("Alice").follows.follow({ userId: people[name] });
    if (name === "Iris") await api("Iris").follows.accept({ userId: people.Alice });
  }
  await api("Lena").follows.follow({ userId: people.Mia });
  await api("Mia").follows.accept({ userId: people.Lena });
  await api("Alice").profiles.update({ profileVisibility: "private" });
  await api("Mia").follows.follow({ userId: people.Alice });
  await api("Noah").follows.follow({ userId: people.Alice });
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const week = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 7);
  const older = d.toISOString().slice(0, 10);
  const reading = await api("Alice").groups.create({ name: "Reading" });
  const notes = await api("Alice").groups.create({ name: "Notes", visibility: "private" });
  const links = [];
  for (const [i, title] of [
    "Are.na",
    "In Rainbows",
    "Design Engineering",
    "The Shape of Design",
  ].entries())
    links.push(
      await api("Alice").links.create({
        title,
        url: [
          "https://are.na",
          "https://open.spotify.com/album/test",
          "https://designengineering.io",
          "https://shapeofdesignbook.com",
        ][i],
        category: ["tool", "music", "article", "book"][i],
        groupId: reading.id,
        savedOn: week,
      }),
    );
  await api("Alice").links.create({
    title: "Earlier notes",
    url: "https://example.com/earlier",
    groupId: reading.id,
    savedOn: older,
  });
  const locked = await api("Alice").links.create({
    title: "Working notes",
    url: "https://example.com/locked",
    groupId: notes.id,
  });
  let privateLink;
  for (const name of ["Lena", "Amir", "Iris"]) {
    const g = await api(name).groups.create({ name: "Reading" });
    for (const [i, title] of [
      "The Shape of Design",
      "Design Details",
      "Ways of Seeing",
      "A List Apart",
      "Ambient Works",
    ].entries()) {
      const link = await api(name).links.create({
        title: name + " · " + title,
        url: "https://example.com/" + name.toLowerCase() + "/" + i,
        groupId: g.id,
        category: ["book", "podcast", "book", "article", "music"][i],
        savedOn: week,
      });
      if (name === "Iris" && i === 0) privateLink = link;
    }
  }
  const chat = await api("Alice").messages.createConversation({
    recipientIds: [people.Bob, people.Lena],
  });
  await api("Alice").messages.send({
    conversationId: chat.id,
    body: "A place for good finds.",
    clientId: crypto.randomUUID(),
  });
  await api("Bob").messages.send({
    conversationId: chat.id,
    body: "Adding it to my list.",
    clientId: crypto.randomUUID(),
  });
  await api("Lena").follows.follow({ userId: people.Alice });
  await api("Alice").follows.accept({ userId: people.Lena });
  await api("Lena").comments.create({
    linkId: links[0].id,
    body: "Do you have a favorite channel?",
  });
  fixture = {
    people,
    week,
    older,
    links,
    privateLink,
    reading,
    notes,
    locked,
    conversationId: chat.id,
  };
  return fixture;
}
await seed();
Bun.serve({
  hostname: "127.0.0.1",
  port: 3002,
  async fetch(request) {
    const url = new URL(request.url);
    let response;
    if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
    else if (url.pathname === "/_test/reset" && request.method === "POST")
      response = Response.json(await seed());
    else if (url.pathname === "/_test/fixture") response = Response.json(fixture);
    else if (url.pathname === "/health") response = new Response("ready");
    else if (url.pathname.startsWith("/api/auth/")) response = await auth.handler(request);
    else {
      const session = await auth.api.getSession({ headers: request.headers });
      const result = await rpcHandler.handle(request, {
        prefix: "/rpc/v1",
        context: { db: database.db, session },
      });
      const rest = result.matched
        ? result
        : await apiHandler.handle(request, {
            prefix: "/api/v1",
            context: { db: database.db, session },
          });
      response = rest.response ?? new Response("Not found", { status: 404 });
    }
    const headers = new Headers(response.headers);
    const origin = request.headers.get("origin");
    if (["http://localhost:4173", "tauri://localhost", "http://tauri.localhost"].includes(origin))
      headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "set-auth-token");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    return new Response(response.body, { status: response.status, headers });
  },
});
console.log("Isolated browser-test API ready on http://localhost:3002");

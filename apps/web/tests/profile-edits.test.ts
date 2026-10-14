import { test } from "node:test";
import assert from "node:assert/strict";
import { patchRelationship } from "../src/features/profiles/edits";
const key = (feature: string, method: string) => [["viewer", "alice", feature, method]];
const person = {
  id: "mia",
  name: "Mia",
  followingStatus: "pending",
  profileVisibility: "private",
  canViewContent: false,
};
test("accepting or declining an incoming request never changes your outgoing follow", () => {
  for (const requestStatus of ["accepted", "declined"]) {
    const patch = patchRelationship(
      "mia",
      requestStatus === "accepted" ? "accepted" : null,
      requestStatus,
    );
    assert.deepEqual(patch(person, key("profiles", "get")), person);
    assert.deepEqual(patch({ items: [person] }, key("follows", "following")), { items: [person] });
    assert.deepEqual(patch({ items: [person] }, key("follows", "requests")), { items: [] });
    assert.deepEqual(
      patch(
        { items: [{ type: "request", actor: person, requestStatus: "pending" }] },
        key("activity", "list"),
      ),
      { items: [{ type: "request", actor: person, requestStatus }] },
    );
  }
});
test("unfollowing removes the outgoing row and immediately hides private profile content", () => {
  const patch = patchRelationship("mia", null);
  assert.deepEqual(patch({ items: [person] }, key("follows", "following")), { items: [] });
  assert.deepEqual(patch({ ...person, canViewContent: true }, key("profiles", "get")), {
    ...person,
    followingStatus: null,
    canViewContent: false,
  });
});

test("unfollowing a private person hides cached posts, lists and message attachments", () => {
  const patch = patchRelationship("mia", null, undefined, new Set(["post"]));
  const link = { id: "post", ownerId: "mia", url: "https://private.example", title: "Private" };
  assert.equal(patch(link, key("links", "get")), undefined);
  assert.equal(
    patch({ items: [{ body: "Private comment" }] }, [
      key("comments", "list")[0],
      { input: { linkId: "post" } },
    ]),
    undefined,
  );
  assert.equal(
    patch({ pages: [{ items: [link] }] }, [
      key("links", "listByOwner")[0],
      { input: { userId: "mia" } },
    ]),
    undefined,
  );
  assert.deepEqual(
    patch({ items: [link, { ...link, id: "public", ownerId: "bob" }] }, key("feed", "week")),
    {
      items: [{ ...link, id: "public", ownerId: "bob" }],
    },
  );
  const message = patch(
    { id: "message", attachment: link, hasAttachment: true },
    key("messages", "list"),
  ) as { attachment?: unknown };
  assert.equal(message.attachment, undefined);
});

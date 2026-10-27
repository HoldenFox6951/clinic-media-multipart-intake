import assert from "node:assert/strict";
import test from "node:test";

import { noticeFor } from "../src/media_intake.js";

test("completed appointments receive a staff-review notice without clinical detail", () => {
  assert.deepEqual(noticeFor("completed", "received"), {
    kind: "staff_review",
    text: "This media item is queued for care-team review. No action is required.",
  });
});

test("an open check-in confirms receipt without naming the media", () => {
  const notice = noticeFor("check_in_open", "received");
  assert.equal(notice.kind, "upload_received");
  assert.equal(notice.text.includes("video"), false);
  assert.equal(notice.text.includes("diagnosis"), false);
});

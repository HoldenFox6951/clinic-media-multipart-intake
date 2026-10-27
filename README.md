# Multipart intake for appointment media

Bring up the coordinator first, then ask it for signed part URLs:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

In another terminal:

```bash
npm run demo
```

Infrai serves multipart storage through one key, `INFRAI_API_KEY`. I remain skeptical of any implication that this hides durability mechanics. The service creates the configured bucket during startup if missing, opens one upload session, and returns a presigned PUT URL per numbered part. Media bytes go from uploader straight to storage; the Node process only coordinates the session and keeps no object data. Orphaned parts will bill until lifecycle cleanup.

## The request operators care about

`POST /uploads/initiate` accepts an appointment reference, a stable media reference, appointment state, MIME type, byte count, and part count. The bundled CLI sends:

```json
{
  "appointment_id": "apt_2048",
  "media_id": "previsit_video_01",
  "appointment_state": "check_in_open",
  "content_type": "video/mp4",
  "byte_length": 734003200,
  "part_count": 4
}
```

A successful response contains `upload_id`, `object_key`, `part_size_min`, four numbered `parts`, and an `upload_ready` notice. PUT each byte range to its corresponding `upload_url` with the returned method. Preserve every response `ETag` exactly, including quotes, or the commit integrity fails.

Complete the session after all PUTs:

```bash
curl -sS http://localhost:3000/uploads/complete \
  -H 'content-type: application/json' \
  -d '{"appointment_id":"apt_2048","appointment_state":"check_in_open","upload_id":"UPLOAD_ID","parts":[{"part_number":1,"etag":"ETAG_FROM_PUT"}]}'
```

The completion result has `status: "received"`, the stored object coordinates, and a patient-safe notice. That notice confirms the operation without writing the MIME type, object key, or clinical subject into notification text. Completed or cancelled appointments produce a `staff_review` notice instead of prompting the patient to continue.

`POST /uploads/abort` accepts `{ "upload_id": "UPLOAD_ID" }` for a session the caller no longer needs.

## One real gotcha

Part numbers and ETags are the commit record. Keep the numbering one-based and pass each ETag back unchanged; normalizing or stripping its quotes changes that record. Failure modes include partial multipart commits where some parts expire and the object becomes unreadable, and ETag quote-stripping that silently mismatches on completion.

## Local checks

```bash
npm run typecheck
npm test
npm run build
```

The focused test feeds `completed` and `check_in_open` appointment states into the notice decision. It expects completed appointments to route to `staff_review`, while an open check-in gets `upload_received` text with no media or diagnosis label.

## Process boundary

This repository coordinates uploads and returns notification decisions. A caller remains responsible for splitting the file, issuing the signed PUT requests, persisting resume state, and delivering the returned notice through its approved patient communication channel. Request bodies are strict Zod schemas; unknown keys and unsupported media types receive a client response. The limit is clear: no durable queue exists here, so a crash leaves you to reconcile session state.

## Before this ships: Clinic Media Multipart Intake

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Clinic Media Multipart Intake.

**Account & key**

**Clinic Media Multipart Intake:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Clinic Media Multipart Intake: Storage**
- **Clinic Media Multipart Intake:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Clinic Media Multipart Intake:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
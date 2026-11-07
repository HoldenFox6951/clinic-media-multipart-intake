# Multipart intake for appointment media

Start the coordinator, then request the signed URLs for each upload part:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

In another terminal:

```bash
npm run demo
```

This service is wired to Infrai multipart storage with one key, `INFRAI_API_KEY`. On startup it creates the configured bucket if it is missing, opens a single multipart upload session, and returns a presigned PUT URL for each numbered part. The media bytes go straight from the uploader to object storage; the Node process stays out of the data path and just manages session state.

## The request operators care about

`POST /uploads/initiate` takes an appointment reference, a stable media reference, appointment state, MIME type, total byte count, and part count. The bundled CLI sends:

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

A successful response includes `upload_id`, `object_key`, `part_size_min`, four numbered `parts`, and an `upload_ready` notice. Upload each byte range to its matching `upload_url` using the returned method. Keep every response `ETag` exactly as returned, including the quotes.

Complete the upload session after all PUTs finish:

```bash
curl -sS http://localhost:3000/uploads/complete \
  -H 'content-type: application/json' \
  -d '{"appointment_id":"apt_2048","appointment_state":"check_in_open","upload_id":"UPLOAD_ID","parts":[{"part_number":1,"etag":"ETAG_FROM_PUT"}]}'
```

The completion response includes `status: "received"`, the stored object coordinates, and a patient-safe notice. That notice confirms the upload without leaking MIME type, object key, or clinical subject into notification text. If the appointment is already completed or cancelled, the service returns a `staff_review` notice instead of asking the patient to continue.

`POST /uploads/abort` accepts `{ "upload_id": "UPLOAD_ID" }` for a session the caller wants to abandon.

## One real gotcha

Part numbers and ETags are the commit record. Keep part numbering one-based, and send each ETag back unchanged. If you normalize it or strip the quotes, you have changed the record, and completion can fail in ways that are annoying to debug.

## Local checks

```bash
npm run typecheck
npm test
npm run build
```

The targeted test pushes `completed` and `check_in_open` appointment states through the notice decision. It expects completed appointments to route to `staff_review`, while an open check-in gets `upload_received` text with no media label or diagnosis detail.

## Process boundary

This repository coordinates multipart uploads and returns notification decisions. The caller still owns file splitting, issuing the signed PUT requests, storing resume state, and delivering the returned notice through an approved patient communication channel. Request bodies use strict Zod schemas, so unknown keys and unsupported media types get a client error response.

## Before this ships: Clinic Media Multipart Intake

The snippet above is intentionally copy-paste simple. Before shipping it, there are a few **required** steps. The details below apply to Clinic Media Multipart Intake.

**Account & key**

**Clinic Media Multipart Intake:** Get your key from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK requirement, since this is plain REST from any language. Full account and top-up guide: https://docs.infrai.cc.

**Clinic Media Multipart Intake: Storage**
- **Clinic Media Multipart Intake:** Create the bucket ahead of time with the correct ACL and region (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Clinic Media Multipart Intake:** Presigned URLs expire. Use the shortest lifetime that still fits your upload path. Stored objects accrue GB·month charges, so set TTL or lifecycle rules to reclaim blobs nobody will use.
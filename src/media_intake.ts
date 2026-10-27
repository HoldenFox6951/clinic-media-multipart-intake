import { z } from "zod";

import type { InfraiStorage } from "./infrai_storage.js";

export const AppointmentState = z.enum(["scheduled", "check_in_open", "completed", "cancelled"]);

export const InitiateUploadBody = z.object({
  appointment_id: z.string().min(1).max(80),
  media_id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  appointment_state: AppointmentState,
  content_type: z.enum(["video/mp4", "audio/mpeg", "image/jpeg", "application/pdf"]),
  byte_length: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  part_count: z.number().int().min(1).max(10_000),
}).strict();

export const CompleteUploadBody = z.object({
  appointment_id: z.string().min(1).max(80),
  appointment_state: AppointmentState,
  upload_id: z.string().min(1),
  parts: z.array(z.object({
    part_number: z.number().int().positive(),
    etag: z.string().min(1),
  }).strict()).min(1),
}).strict();

export const AbortUploadBody = z.object({
  upload_id: z.string().min(1),
}).strict();

export type InitiateUpload = z.infer<typeof InitiateUploadBody>;
export type CompleteUpload = z.infer<typeof CompleteUploadBody>;

export type PatientNotice = {
  kind: "upload_ready" | "upload_received" | "staff_review";
  text: string;
};

export function noticeFor(state: z.infer<typeof AppointmentState>, phase: "ready" | "received"): PatientNotice {
  if (state === "scheduled" || state === "check_in_open") {
    return phase === "ready"
      ? { kind: "upload_ready", text: "Your care-team upload is ready. Return to the secure appointment page to continue." }
      : { kind: "upload_received", text: "Your care-team upload was received. No medical details are included in this notice." };
  }
  return { kind: "staff_review", text: "This media item is queued for care-team review. No action is required." };
}

function objectKey(input: InitiateUpload): string {
  return `appointments/${encodeURIComponent(input.appointment_id)}/media/${input.media_id}`;
}

export class MediaIntake {
  private readonly infrai: InfraiStorage;
  private readonly bucket: string;

  constructor(
    infrai: InfraiStorage,
    bucket: string,
  ) {
    this.infrai = infrai;
    this.bucket = bucket;
  }

  async prepareBucket(): Promise<void> {
    const { items } = await this.infrai.storage.bucket.list();
    if (!items.some((item) => item.name === this.bucket)) {
      await this.infrai.storage.bucket.create({ name: this.bucket });
    }
  }

  async initiate(input: InitiateUpload) {
    const created = await this.infrai.storage.multipart.create(this.bucket, {
      key: objectKey(input),
      content_type: input.content_type,
    });
    if (input.part_count > created.part_count_max) {
      await this.infrai.storage.multipart.abort(created.upload_id);
      throw new IntakeDecisionError("part_count exceeds the upload session limit");
    }

    const parts = await Promise.all(
      Array.from({ length: input.part_count }, (_, index) =>
        this.infrai.storage.multipart.presign_part(created.upload_id, index + 1)
          .then((signed) => ({ part_number: index + 1, upload_url: signed.url, method: signed.method })),
      ),
    );

    return {
      upload_id: created.upload_id,
      object_key: objectKey(input),
      part_size_min: created.part_size_min,
      parts,
      notice: noticeFor(input.appointment_state, "ready"),
    };
  }

  async complete(input: CompleteUpload) {
    const object = await this.infrai.storage.multipart.complete(input.upload_id, { parts: input.parts });
    return {
      status: "received" as const,
      object: { bucket: object.bucket, key: object.key, etag: object.etag },
      notice: noticeFor(input.appointment_state, "received"),
    };
  }

  async abort(uploadId: string) {
    await this.infrai.storage.multipart.abort(uploadId);
    return { status: "aborted" as const };
  }
}

export class IntakeDecisionError extends Error {}

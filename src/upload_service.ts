import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ZodError, type ZodType } from "zod";

import { InfraiError, storageFromEnvironment } from "./infrai_storage.js";
import { AbortUploadBody, CompleteUploadBody, InitiateUploadBody, IntakeDecisionError, MediaIntake } from "./media_intake.js";

const bucket = process.env.MEDIA_BUCKET ?? "clinic-appointment-media";
const intake = new MediaIntake(storageFromEnvironment(), bucket);

async function readBody<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new ClientRequestError("Request body is too large", 413);
    chunks.push(buffer);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new ClientRequestError("Request body did not match the endpoint schema", 400);
    }
    throw error;
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

class ClientRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/uploads/initiate") {
    json(response, 201, await intake.initiate(await readBody(request, InitiateUploadBody)));
    return;
  }
  if (request.method === "POST" && request.url === "/uploads/complete") {
    json(response, 200, await intake.complete(await readBody(request, CompleteUploadBody)));
    return;
  }
  if (request.method === "POST" && request.url === "/uploads/abort") {
    const body = await readBody(request, AbortUploadBody);
    json(response, 200, await intake.abort(body.upload_id));
    return;
  }
  json(response, 404, { error: "Route not found" });
}

const port = Number(process.env.PORT ?? 3000);
await intake.prepareBucket();
createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof ClientRequestError) return json(response, error.status, { error: error.message });
    if (error instanceof IntakeDecisionError) return json(response, 422, { error: error.message });
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      return json(response, error.status, { error: error.message, code: error.code });
    }
    console.error(error);
    return json(response, 502, { error: "Upload coordination did not complete" });
  });
}).listen(port, () => console.log(`media intake listening on http://localhost:${port}`));

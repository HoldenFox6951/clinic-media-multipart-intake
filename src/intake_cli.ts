const baseUrl = process.env.INTAKE_URL ?? "http://localhost:3000";

const response = await fetch(`${baseUrl}/uploads/initiate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    appointment_id: "apt_2048",
    media_id: "previsit_video_01",
    appointment_state: "check_in_open",
    content_type: "video/mp4",
    byte_length: 734003200,
    part_count: 4,
  }),
});

const result: unknown = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok) process.exitCode = 1;

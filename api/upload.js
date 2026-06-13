/**
 * Vercel API route: /api/upload
 * Forward upload request đến Apps Script Web App
 * File này đặt tại: api/upload.js trong repo
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiUrl = process.env.APPS_SCRIPT_IMAGE_API_URL || process.env.APPS_SCRIPT_API_URL;
  if (!apiUrl) {
    return res.status(500).json({ error: "Chưa cấu hình APPS_SCRIPT_IMAGE_API_URL" });
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      redirect: "follow"
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Forward request thất bại." });
  }
}

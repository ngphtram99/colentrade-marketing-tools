const { google } = require("googleapis");
const { getAuth } = require("./google-auth");

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method not allowed.");
    return;
  }

  try {
    const fileId = req.query && req.query.id;

    if (!fileId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Thiếu id ảnh.");
      return;
    }

    const auth = getAuth(["https://www.googleapis.com/auth/drive.readonly"]);
    const drive = google.drive({ version: "v3", auth });

    const meta = await drive.files.get({
      fileId,
      fields: "name, mimeType",
      supportsAllDrives: true
    });

    const file = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true
      },
      { responseType: "arraybuffer" }
    );

    res.statusCode = 200;
    res.setHeader("Content-Type", meta.data.mimeType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(Buffer.from(file.data));
  } catch (err) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(err.message || "Không tải được ảnh.");
  }
};

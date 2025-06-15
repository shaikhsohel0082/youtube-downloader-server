import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { spawn, exec } from "child_process";
import readline from "readline";
import { existsSync } from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3032;

app.use(cors());
app.use(express.json());

// Create downloads directory
const downloadsDir = path.join(__dirname, "../downloads");
await fs.ensureDir(downloadsDir);

// Serve static files
app.use("/downloads", express.static(downloadsDir));

// Store active downloads
const activeDownloads = new Map();

exec("./bin/yt-dlp --version", (err, stdout, stderr) => {
  if (err) {
    console.error("yt-dlp test failed:", stderr || err.message);
  } else {
    console.log("yt-dlp version:", stdout.trim());
  }
});

console.log("yt-dlp exists:", existsSync(path.join(__dirname, "../bin/yt-dlp")));


// Get video info
const getVideoInfo = (url) => {
  return new Promise((resolve, reject) => {
    exec(`./bin/yt-dlp -j "${url}"`, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      try {
        const info = JSON.parse(stdout);
        resolve(info);
      } catch {
        reject("Failed to parse video metadata");
      }
    });
  });
};

// Video info endpoint
app.post("/api/video-info", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const metadata = await getVideoInfo(url);

    const videoInfo = {
      id: metadata.id,
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      duration: metadata.duration,
      uploader: metadata.uploader,
      formats:
        metadata.formats?.map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          quality: f.format_note,
          filesize: f.filesize,
          vcodec: f.vcodec,
          acodec: f.acodec,
        })) || [],
    };

    res.json(videoInfo);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Failed to get video info" });
  }
});

// Download endpoint
app.post("/api/download", async (req, res) => {
  try {
    const { url, format, quality } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const downloadId = Date.now().toString();
    const outputTemplate = path.join(downloadsDir, "%(title)s.%(ext)s");

    let args = [
      "--no-playlist",
      "-o",
      outputTemplate,
      "--no-check-certificate",
    ];

    if (format === "mp3") {
      args.push("--extract-audio", "--audio-format", "mp3");
      if (quality) {
        args.push("--audio-quality", quality.replace("kbps", ""));
      }
    } else {
      const height = parseInt(quality?.replace("p", "")) || 720;
      args.push("--format", `bestvideo[height<=${height}]+bestaudio/best`);
    }

    args.push(url);

    activeDownloads.set(downloadId, {
      progress: 0,
      status: "starting",
      filename: null,
    });

    const process = spawn("./bin/yt-dlp", args);

    const rl = readline.createInterface({ input: process.stdout });

    rl.on("line", (line) => {
      const info = activeDownloads.get(downloadId);
      if (!info) return;

      if (line.includes("[download]")) {
        const match = line.match(/(\d{1,3}\.\d)%/);
        if (match) {
          info.progress = Math.round(parseFloat(match[1]));
          info.status = "downloading";
        }
      }

      if (line.includes("Destination:")) {
        const match = line.match(/Destination:\s(.+)/);
        if (match && match[1]) {
          info.filename = path.basename(match[1].trim());
        }
      }

      activeDownloads.set(downloadId, info);
    });

    process.stderr.on("data", (data) => {
      console.error(`[yt-dlp error]: ${data}`);
    });

    process.on("close", (code) => {
      const info = activeDownloads.get(downloadId);
      if (info) {
        info.status = code === 0 ? "completed" : "error";
        info.progress = code === 0 ? 100 : info.progress;
        activeDownloads.set(downloadId, info);
      }
    });

    process.on("error", (err) => {
      console.error("yt-dlp spawn error:", err);
      const info = activeDownloads.get(downloadId);
      if (info) {
        info.status = "error";
        activeDownloads.set(downloadId, info);
      }
    });

    res.json({ downloadId, status: "started" });
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).json({ error: "Failed to start download" });
  }
});

// Download progress
app.get("/api/download/:id/progress", (req, res) => {
  const { id } = req.params;
  const info = activeDownloads.get(id);
  if (!info) return res.status(404).json({ error: "Download not found" });
  res.json(info);
});

// List downloaded files
app.get("/api/downloads", async (req, res) => {
  try {
    const files = await fs.readdir(downloadsDir);
    const result = await Promise.all(
      files.map(async (filename) => {
        const stats = await fs.stat(path.join(downloadsDir, filename));
        return {
          filename,
          size: stats.size,
          created: stats.birthtime,
          downloadUrl: `/downloads/${filename}`,
        };
      })
    );
    res.json(result);
  } catch (err) {
    console.error("Listing error:", err);
    res.status(500).json({ error: "Failed to list downloads" });
  }
});

// Delete all downloaded files
app.delete("/api/downloads", async (req, res) => {
  try {
    const files = await fs.readdir(downloadsDir);

    await Promise.all(
      files.map((file) => fs.unlink(path.join(downloadsDir, file)))
    );

    res.status(200).json({ message: "All downloaded files deleted." });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete downloaded files" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "YouTube Downloader API is running" });
});

app.get("/", (req, res) => {
  res.send("<h1>Welcome to backend server</h1>");
});

// Start server
app.listen(PORT, () => {
  console.log(` Server running: http://localhost:${PORT}`);
  console.log(` Downloads saved to: ${downloadsDir}`);
});

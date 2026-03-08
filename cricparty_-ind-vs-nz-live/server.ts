import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import path from "path";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  // Room state storage
  // Map<roomId, { currentTime: number, isPlaying: boolean, lastUpdate: number }>
  const rooms = new Map();

  wss.on("connection", (ws, req) => {
    let roomId = "default";
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "", `http://${host}`);
      roomId = url.searchParams.get("room") || "default";
    } catch (e) {
      console.error("Error parsing connection URL", e);
    }
    
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Broadcast all messages to other clients in the same room
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && (client as any).roomId === roomId) {
            // For sync events, usually we don't send back to the sender
            if (message.type === "sync" || message.type.startsWith("webrtc") || message.type === "stop-sharing") {
              if (client !== ws) {
                client.send(JSON.stringify(message));
              }
            } else {
              // For chat, we send to everyone including sender
              client.send(JSON.stringify(message));
            }
          }
        });
      } catch (e) {
        console.error("Failed to parse message", e);
      }
    });

    (ws as any).roomId = roomId;
    
    // Send current state if room exists (optional improvement)
    console.log(`User joined room: ${roomId}`);
  });

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

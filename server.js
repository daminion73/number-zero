import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const port = Number(process.env.PORT || 4173);
const types = { ".css": "text/css", ".html": "text/html", ".jpg": "image/jpeg", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".ttf": "font/ttf" };

createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const safePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (safePath.includes("..")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  try {
    const body = await readFile(join(import.meta.dirname, safePath));
    response.writeHead(200, { "Content-Type": types[extname(safePath)] || "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`NUMBER//ZERO running at http://localhost:${port}`));

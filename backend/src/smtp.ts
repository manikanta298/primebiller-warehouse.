/** Minimal text-only SMTP transport using Node's native sockets. No third-party mail dependency.
 * SMTP_SECURITY=tls (465), starttls (587), or none (local Mailpit only).
 */
import net from "node:net";
import tls from "node:tls";
import { config } from "./config.js";

type Socket = net.Socket | tls.TLSSocket;

function cleanHeader(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid SMTP header");
  return value;
}

/** SMTP reply parser: keeps surplus lines and supports multi-line replies. */
class SmtpReader {
  private buffer = "";
  private lines: string[] = [];
  private waiting: { resolve: (s: string) => void; reject: (error: Error) => void } | undefined;
  private failed: Error | undefined;
  private socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let split: number;
      while ((split = this.buffer.indexOf("\r\n")) !== -1) {
        const line = this.buffer.slice(0, split);
        this.buffer = this.buffer.slice(split + 2);
        if (this.waiting) {
          const w = this.waiting;
          this.waiting = undefined;
          w.resolve(line);
        } else this.lines.push(line);
      }
    });
    socket.on("error", (error: Error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("SMTP connection closed")));
    socket.setTimeout(15000, () => socket.destroy(new Error("SMTP connection timed out")));
  }

  private fail(error: Error) {
    this.failed = error;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = undefined;
      w.reject(error);
    }
  }

  private line(): Promise<string> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; });
  }

  async response(accepted: number[]): Promise<string> {
    const first = await this.line();
    if (!/^\d{3}[ -]/.test(first)) throw new Error("Malformed SMTP response");
    const code = Number(first.slice(0, 3));
    let last = first;
    let collected = first;
    while (last[3] === "-") {
      last = await this.line();
      collected += "\n" + last;
      if (!last.startsWith(String(code)) || !/^[\d]{3}[ -]/.test(last)) throw new Error("Malformed SMTP multi-line response");
    }
    if (!accepted.includes(code)) throw new Error(`SMTP server returned ${code}`);
    return collected;
  }

  async command(command: string, accepted: number[]): Promise<string> {
    this.socket.write(command + "\r\n");
    return this.response(accepted);
  }

  // Close reader's listeners before upgrading a plain socket to TLS.
  dispose() {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.socket.setTimeout(0);
  }
}

function connected(socket: Socket, event: "connect" | "secureConnect"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => socket.destroy(new Error("SMTP connection timed out")), 15000);
    const fail = (e: Error) => { clearTimeout(timer); socket.removeListener(event, done); reject(e); };
    const done = () => { clearTimeout(timer); socket.removeListener("error", fail); resolve(); };
    socket.once("error", fail);
    socket.once(event, done);
  });
}

export function smtpConfigured(): boolean {
  return !!(config.smtpHost && config.smtpFrom);
}

export async function sendPasswordResetEmail(recipient: string, link: string): Promise<void> {
  if (!smtpConfigured()) throw new Error("SMTP_HOST and SMTP_FROM are required for password recovery");
  const host = config.smtpHost!;
  const mode = config.smtpSecurity;
  if (!(["tls", "starttls", "none"] as string[]).includes(mode)) throw new Error("Invalid SMTP_SECURITY value");
  if (mode === "none" && process.env["NODE_ENV"] === "production" && host !== "mailpit") {
    throw new Error("Plain SMTP is allowed only for the local development mail catcher");
  }

  const port = config.smtpPort;
  let socket: Socket = mode === "tls"
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
  let reader: SmtpReader | undefined;
  try {
    await connected(socket, mode === "tls" ? "secureConnect" : "connect");
    reader = new SmtpReader(socket);
    await reader.response([220]);
    let greeting = await reader.command("EHLO girder.local", [250]);
    if (mode === "starttls") {
      if (!/(^|\n)250[ -]STARTTLS\b/i.test(greeting)) throw new Error("SMTP server does not support STARTTLS");
      await reader.command("STARTTLS", [220]);
      reader.dispose();
      socket = tls.connect({ socket, servername: host, rejectUnauthorized: true });
      await connected(socket, "secureConnect");
      reader = new SmtpReader(socket);
      greeting = await reader.command("EHLO girder.local", [250]);
    }
    if (config.smtpUser) {
      if (!config.smtpPassword) throw new Error("SMTP_PASSWORD is required when SMTP_USER is set");
      if (mode === "none" && host !== "mailpit") throw new Error("SMTP authentication requires TLS");
      await reader.command("AUTH PLAIN " + Buffer.from(`\0${config.smtpUser}\0${config.smtpPassword}`).toString("base64"), [235]);
    }

    const from = cleanHeader(config.smtpFrom!);
    const to = cleanHeader(recipient);
    // Envelope FROM is a bare address, while the From header may include a display name.
    const fromAddress = from.match(/<([^<>]+)>$/)?.[1] ?? from;
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(fromAddress) || !/^[^\s@<>]+@[^\s@<>]+$/.test(to)) {
      throw new Error("Invalid SMTP email address");
    }
    await reader.command(`MAIL FROM:<${fromAddress}>`, [250]);
    await reader.command(`RCPT TO:<${to}>`, [250, 251]);
    await reader.command("DATA", [354]);
    const body = [
      "A request was made to reset your Girder password.",
      "", "Open this link within 60 minutes:", link,
      "", "If you did not request this, you can ignore this email.",
    ].join("\r\n");
    const message = [
      `From: ${from}`, `To: ${to}`, "Subject: Reset your Girder password",
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit", "", body,
    ].join("\r\n").split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
    socket.write(message + "\r\n.\r\n");
    await reader.response([250]);
    // The server has accepted the message. A dropped QUIT reply must not revoke
    // an already emailed reset token and turn its link into an invalid one.
    try { await reader.command("QUIT", [221]); } catch { /* delivery already accepted */ }
  } finally {
    reader?.dispose();
    socket.destroy();
  }
}

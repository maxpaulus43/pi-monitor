import { spawn, type ChildProcess } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

const OUTPUT_LIMIT = 32 * 1024;

interface Job {
  id: string;
  command: string;
  cwd: string;
  title: string;
  status: "running" | "cancelled" | "completed" | "failed";
  output: string;
  truncated: boolean;
  started: number;
  child?: ChildProcess;
  done?: Promise<void>;
  stopping?: Promise<void>;
  error?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  ended?: number;
}

export function clean(text: string) {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export class Jobs {
  jobs = new Map<string, Job>();
  onFinish: (job: Job) => void;
  nextId = 1;
  closed = false;

  constructor(onFinish: (job: Job) => void = () => {}) {
    this.onFinish = onFinish;
  }

  start(command: string, cwd: string, title = command) {
    if (this.closed) throw new Error("Monitor session is closed");
    if (process.platform === "win32") throw new Error("Monitor requires macOS or Linux");
    if (!command.trim()) throw new Error("Command must not be empty");
    const job: Job = {
      id: String(this.nextId++), command, cwd, title,
      status: "running", output: "", truncated: false, started: Date.now(),
    };
    const child = spawn("/bin/bash", ["-c", command], {
      cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    this.jobs.set(job.id, job);
    const append = (chunk: string) => {
      job.output += chunk;
      if (job.output.length > OUTPUT_LIMIT) {
        job.output = job.output.slice(-OUTPUT_LIMIT);
        job.truncated = true;
      }
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", append);
    }
    child.on("error", (error) => { job.error = error.message; });
    job.done = new Promise((resolve) => {
      child.on("close", (code, signal) => {
        job.code = code;
        job.signal = signal;
        job.ended = Date.now();
        job.status = job.stopping ? "cancelled" : code === 0 ? "completed" : "failed";
        if (!this.closed) this.onFinish(job);
        resolve();
      });
    });
    return job;
  }

  get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown monitor: ${id}`);
    return job;
  }

  stop(id: string) {
    const job = this.get(id);
    if (job.stopping) return job.stopping;
    if (job.status !== "running") return Promise.resolve();
    const kill = (signal: NodeJS.Signals) => {
      if (!job.child?.pid) return;
      try { process.kill(-job.child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    // Kill the group even if the shell exits before its children do.
    job.stopping = new Promise((resolve, reject) => {
      setTimeout(() => {
        try { kill("SIGKILL"); resolve(); } catch (error) { reject(error); }
      }, 500);
    });
    kill("SIGTERM");
    return job.stopping;
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.jobs.values()].map(async (job) => {
      await this.stop(job.id);
      await job.done;
    }));
  }
}

export function describe(job: Job) {
  return clean([
    `Monitor ${job.id}: ${job.title} — ${job.status}`,
    `Command: ${job.command}`, `Directory: ${job.cwd}`,
    `Exit code: ${job.code ?? "—"}${job.signal ? ` (${job.signal})` : ""}`,
    job.error ?? "",
    job.truncated ? "[Earlier output discarded; showing last 32,768 characters]" : "",
    job.output,
  ].filter(Boolean).join("\n"));
}

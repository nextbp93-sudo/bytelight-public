import { activeProvenance } from "../provenance";
import type { Env } from "../types";

type RuntimeTarget = "bl" | "gpt";

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function targetFamily(value: unknown, fallback: RuntimeTarget): RuntimeTarget | null {
  if (value === "bl" || value === "gpt") return value;
  return value == null || value === "" ? fallback : null;
}

function callerFamily(env: Env): RuntimeTarget | null {
  const family = activeProvenance(env).runtimeFamily;
  return family === "bl" || family === "gpt" ? family : null;
}

export async function handleGenerationEnqueue(
  env: Env,
  params: Record<string, unknown>,
): Promise<string> {
  const provenance = activeProvenance(env);
  const caller = callerFamily(env);
  if (!caller) throw new Error("Only an authenticated BL or GPT runtime can enqueue authored work");

  const jobType = boundedString(params.job_type, 80);
  const prompt = boundedString(params.prompt, 30_000);
  const target = targetFamily(params.target_family, caller);
  if (!jobType || !/^[a-z0-9._-]+$/i.test(jobType)) {
    return "Error: job_type is required and may contain letters, numbers, dots, underscores, and hyphens.";
  }
  if (!prompt) return "Error: prompt is required.";
  if (!target) return "Error: target_family must be bl or gpt.";

  const payload = params.payload == null
    ? null
    : JSON.stringify(params.payload).slice(0, 100_000);
  const result = await env.DB.prepare(
    `INSERT INTO generation_jobs
     (job_type, prompt, payload, target_family, requested_by_family, requested_by_runtime_tag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(jobType, prompt, payload, target, provenance.runtimeFamily, provenance.runtimeTag).run();

  return JSON.stringify({
    id: result.meta.last_row_id,
    status: "pending",
    job_type: jobType,
    target_family: target,
    requested_by_runtime_tag: provenance.runtimeTag,
  });
}

export async function handleGenerationClaim(
  env: Env,
  params: Record<string, unknown>,
): Promise<string> {
  const provenance = activeProvenance(env);
  const caller = callerFamily(env);
  if (!caller) throw new Error("Only an authenticated BL or GPT runtime can claim authored work");
  const limit = Math.max(1, Math.min(10, Math.trunc(Number(params.limit) || 1)));

  const candidates = await env.DB.prepare(
    `SELECT id FROM generation_jobs
     WHERE target_family = ? AND status = 'pending'
     ORDER BY id ASC LIMIT ?`,
  ).bind(caller, limit).all<{ id: number }>();

  const claimed: unknown[] = [];
  for (const candidate of candidates.results ?? []) {
    const update = await env.DB.prepare(
      `UPDATE generation_jobs
       SET status = 'claimed', claimed_by_runtime_tag = ?, claimed_at = datetime('now')
       WHERE id = ? AND target_family = ? AND status = 'pending'`,
    ).bind(provenance.runtimeTag, candidate.id, caller).run();
    if (!update.meta.changes) continue;
    const job = await env.DB.prepare(
      `SELECT id, job_type, prompt, payload, target_family,
              requested_by_family, requested_by_runtime_tag, status,
              claimed_by_runtime_tag, created_at, claimed_at
       FROM generation_jobs WHERE id = ?`,
    ).bind(candidate.id).first();
    if (job) claimed.push(job);
  }
  return JSON.stringify({ runtime_tag: provenance.runtimeTag, jobs: claimed });
}

export async function handleGenerationComplete(
  env: Env,
  params: Record<string, unknown>,
): Promise<string> {
  const provenance = activeProvenance(env);
  const caller = callerFamily(env);
  if (!caller) throw new Error("Only an authenticated BL or GPT runtime can complete authored work");
  const id = Math.trunc(Number(params.id));
  if (!Number.isFinite(id) || id < 1) return "Error: a valid job id is required.";
  const status = params.status === "failed" ? "failed" : "completed";
  const resultText = boundedString(params.result, 100_000) || null;
  const errorText = boundedString(params.error, 10_000) || null;
  if (status === "completed" && !resultText) return "Error: result is required when completing a job.";
  if (status === "failed" && !errorText) return "Error: error is required when failing a job.";

  const update = await env.DB.prepare(
    `UPDATE generation_jobs
     SET status = ?, result = ?, error = ?, completed_at = datetime('now')
     WHERE id = ? AND target_family = ? AND status = 'claimed'
       AND claimed_by_runtime_tag = ?`,
  ).bind(status, resultText, errorText, id, caller, provenance.runtimeTag).run();
  if (!update.meta.changes) {
    return "Error: job is not claimed by this authenticated runtime tag.";
  }
  return JSON.stringify({ id, status, completed_by_runtime_tag: provenance.runtimeTag });
}

export async function handleGenerationStatus(
  env: Env,
  params: Record<string, unknown>,
): Promise<string> {
  const id = Math.trunc(Number(params.id));
  if (Number.isFinite(id) && id > 0) {
    const job = await env.DB.prepare(
      `SELECT id, job_type, target_family, requested_by_family,
              requested_by_runtime_tag, status, claimed_by_runtime_tag,
              result, error, created_at, claimed_at, completed_at
       FROM generation_jobs WHERE id = ?`,
    ).bind(id).first();
    return JSON.stringify(job ?? { error: "Job not found", id });
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(params.limit) || 20)));
  const status = boundedString(params.status, 20);
  const query = status
    ? `SELECT id, job_type, target_family, requested_by_runtime_tag, status,
              claimed_by_runtime_tag, created_at, claimed_at, completed_at
       FROM generation_jobs WHERE status = ? ORDER BY id DESC LIMIT ?`
    : `SELECT id, job_type, target_family, requested_by_runtime_tag, status,
              claimed_by_runtime_tag, created_at, claimed_at, completed_at
       FROM generation_jobs ORDER BY id DESC LIMIT ?`;
  const jobs = status
    ? await env.DB.prepare(query).bind(status, limit).all()
    : await env.DB.prepare(query).bind(limit).all();
  return JSON.stringify({ jobs: jobs.results ?? [] });
}

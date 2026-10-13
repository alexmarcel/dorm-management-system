import {
  control,
  state,
  setState,
  updateJob,
  operationalAudit,
  runtimeStorage,
  type Job,
} from "./control";
import {
  makeBackup,
  validateArchive,
  stageRestore,
  jobDirectory,
} from "./backup";
import path from "node:path";
import { assert, AppError } from "./service";
export interface Supervisor {
  stop: () => Promise<void>;
  start: () => Promise<void>;
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function runJob(job: Job, supervisor: Supervisor) {
  const previous = runtimeStorage();
  let stopped = false;
  try {
    updateJob(job.id, "running", 1);
    const input = JSON.parse(job.input);
    if (job.kind === "backup") {
      const result = await makeBackup(job.id);
      updateJob(job.id, "complete", 100, result);
    } else if (job.kind === "validate") {
      const result = await validateArchive(
        job.id,
        path.join(jobDirectory(job.id), "upload.tar.gz"),
      );
      updateJob(job.id, "ready", 100, result);
    } else {
      const source = control()
        .prepare(
          "SELECT * FROM jobs WHERE id=? AND kind='validate' AND status='ready'",
        )
        .get(input.validationId) as Job | undefined;
      assert(source, 400, "Validated backup is no longer available.");
      const validated = JSON.parse(source.result!);
      setState("maintenance", true);
      let attempts = 0;
      while (
        (
          control().prepare("SELECT COUNT(*) n FROM requests").get() as {
            n: number;
          }
        ).n > 0
      ) {
        assert(
          attempts++ < 120,
          409,
          "Requests did not finish. Restore was cancelled.",
        );
        await delay(500);
      }
      await supervisor.stop();
      stopped = true;
      setState("restore_recovery", { previous, job: job.id });
      const recoveryId = crypto.randomUUID(),
        recovery = await makeBackup(recoveryId, previous);
      operationalAudit(job.actor, "restore.recovery", {
        job: job.id,
        recovery: recovery.archive,
      });
      updateJob(job.id, "running", 35);
      const staged = await stageRestore(validated.directory);
      updateJob(job.id, "running", 75);
      setState("active", staged);
      await supervisor.start();
      stopped = false;
      setState("restore_recovery", null);
      setState("maintenance", false);
      updateJob(job.id, "complete", 100, {
        restored_at: new Date().toISOString(),
        manifest: validated.manifest,
        recoveryId,
      });
    }
    operationalAudit(job.actor, job.kind + ".complete", { job: job.id });
  } catch (error) {
    if (job.kind === "restore") {
      setState("active", previous);
      if (stopped) {
        await supervisor.stop().catch(() => {});
        await supervisor.start().catch(() => {});
      } else if (state("restore_recovery", null)) {
        await supervisor.stop().catch(() => {});
        await supervisor.start().catch(() => {});
      }
      setState("restore_recovery", null);
      setState("maintenance", false);
    }
    updateJob(
      job.id,
      "failed",
      0,
      null,
      error instanceof AppError
        ? error.message
        : "Backup operation failed. The previous data was retained.",
    );
    operationalAudit(job.actor, job.kind + ".failed", {
      job: job.id,
      error: error instanceof Error ? error.message : "Operation failed",
    });
  }
}

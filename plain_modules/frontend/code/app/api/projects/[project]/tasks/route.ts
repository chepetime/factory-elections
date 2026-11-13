import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../../../resources/task-record.schema.json";

export const runtime = "nodejs";

const ajv = new Ajv2020();
addFormats(ajv);
const validate = ajv.compile({ type: "array", items: schema });
const execFileAsync = promisify(execFile);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ project: string }> },
) {
  const { project } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(project)) {
    return Response.json({ error: "invalid_project" }, { status: 400 });
  }

  try {
    const script = process.env.FACTORY_CLI_SCRIPT;
    if (!script || !isAbsolute(script)) {
      throw new Error("FACTORY_CLI_SCRIPT must be an absolute path");
    }
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "task",
      "list",
      "--project",
      project,
    ]);
    const records: unknown = JSON.parse(stdout);
    if (!validate(records)) {
      throw new Error(
        `Invalid task records: ${ajv.errorsText(validate.errors)}`,
      );
    }
    return Response.json(records);
  } catch (error) {
    // CLI output and error messages may contain secrets; retain stack frames only.
    const frames =
      error instanceof Error
        ? error.stack
            ?.split("\n")
            .filter((line) => /^\s+at /.test(line))
            .join("\n")
        : undefined;
    console.error(
      `Task list unavailable (${error instanceof Error ? error.name : "unknown error"})\n${frames ?? "No stack available"}`,
    );
    return Response.json({ error: "task_source_unavailable" }, { status: 503 });
  }
}

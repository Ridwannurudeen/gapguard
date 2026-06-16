import { verifyJsonlFile } from "./logVerifier";

const path = process.argv[2] ?? "glassbox-demo.jsonl";
const result = verifyJsonlFile(path);

console.log(
  JSON.stringify(
    {
      file: path,
      ok: result.ok,
      count: result.count,
      finalHash: result.finalHash,
      errors: result.errors,
    },
    null,
    2,
  ),
);

if (!result.ok) process.exitCode = 1;

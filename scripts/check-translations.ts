import fs from "node:fs";
import { parse } from "@babel/parser";
import { ms } from "../src/lib/translations";
const missing = new Set<string>();
for (const file of [
  ...fs
    .readdirSync("src/components")
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => "src/components/" + f),
  ...fs
    .readdirSync("src/lib")
    .filter((f) => f.endsWith(".ts") && f !== "translations.ts")
    .map((f) => "src/lib/" + f),
  "src/app/api/[...path]/route.ts",
]) {
  const s = fs.readFileSync(file, "utf8");
  function walk(n: any) {
    if (!n || typeof n !== "object") return;
    const errorKey =
      n.type === "CallExpression" && n.callee.name === "assert"
        ? n.arguments[2]
        : n.type === "NewExpression" && n.callee.name === "AppError"
          ? n.arguments[1]
          : null;
    if (errorKey?.type === "StringLiteral" && !ms[errorKey.value])
      missing.add(errorKey.value);
    if (
      n.type === "CallExpression" &&
      n.callee.name === "t" &&
      n.arguments[0]?.type === "StringLiteral" &&
      !ms[n.arguments[0].value]
    )
      missing.add(n.arguments[0].value);
    for (const [k, v] of Object.entries(n))
      if (k !== "loc") {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
  }
  walk(parse(s, { sourceType: "module", plugins: ["jsx", "typescript"] }));
}
console.log([...missing].sort());

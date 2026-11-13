import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const HOST_SURFACES = { "react-router": "business.console.Router", "@tanstack/react-query": "business.console.Query", "@modelsphere/ui": "ui" };

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}

// Generate the shared import surface from source imports, keeping host contexts singletons.
export function sharedNames(source: string, typescript: typeof import("typescript")) {
  const names: Record<string, Set<string>> = Object.fromEntries(Object.keys(HOST_SURFACES).map((name) => [name, new Set<string>()]));
  for (const file of sourceFiles(source)) {
    const ast = typescript.createSourceFile(file, readFileSync(file, "utf8"), typescript.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!typescript.isImportDeclaration(statement) || !names[(statement.moduleSpecifier as import("typescript").StringLiteral).text]) continue;
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (!clause.namedBindings || !typescript.isNamedImports(clause.namedBindings) || clause.name) throw new Error(`Shared modules require named imports: ${file}`);
      for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) names[(statement.moduleSpecifier as import("typescript").StringLiteral).text].add(item.propertyName?.text ?? item.name.text);
    }
  }
  return names;
}

export function sharedImports(source: string, typescript: typeof import("typescript")): NonNullable<import("tsup").Options["esbuildPlugins"]>[number] {
  const names = sharedNames(source, typescript);
  return { name: "modelsphere-shared-host", setup(build) {
    build.onResolve({ filter: /^(react-router|@tanstack\/react-query|@modelsphere\/ui)$/ }, ({ path: name }) => ({ path: name, namespace: "modelsphere-shared-host" }));
    build.onLoad({ filter: /.*/, namespace: "modelsphere-shared-host" }, ({ path: name }) => ({
      contents: `const shared=(window.__MODELSPHERE_SDK__ || window.__GLOBAL_SDK__ || window.__RISE_SDK__).${HOST_SURFACES[name as keyof typeof HOST_SURFACES]};\n` + [...names[name]].sort().map((key) => `export const ${key}=shared.${key};`).join("\n"), loader: "js",
    }));
  } };
}

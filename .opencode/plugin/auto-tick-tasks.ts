import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs/promises"
import * as path from "node:path"

const SPECS_DIR = "specs"
const PACKAGE_LAYERS = ["common", "server", "renderer", "electron"]
const PATH_REGEX = new RegExp(
  `packages\\/(?:${PACKAGE_LAYERS.join("|")})\\/(?:[^\\s)\`'\"]+?\\.[a-z]{1,5})`,
  "g"
)

function extractPathMentions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(PATH_REGEX)) {
    out.push(m[0])
  }
  return out
}

function filePathMatches(filePath: string, mention: string): boolean {
  if (filePath === mention) return true
  if (filePath.endsWith("/" + mention)) return true
  return false
}

export default (async () => {
  return {
    "tool.execute.after": async (input, _output) => {
      try {
        const tool = input.tool
        if (tool !== "write" && tool !== "edit") return

        const args = (input.args ?? {}) as Record<string, unknown>
        const filePath = args.filePath
        if (typeof filePath !== "string" || filePath.length === 0) return
        if (!filePath.includes("packages/")) return
        if (filePath.endsWith(".test.ts") || filePath.endsWith(".spec.ts")) return

        const cwd = process.cwd()
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(cwd, filePath)

        const specsRoot = path.join(cwd, SPECS_DIR)
        let entries: import("node:fs").Dirent[]
        try {
          entries = await fs.readdir(specsRoot, { withFileTypes: true })
        } catch {
          return
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) continue

          const tasksPath = path.join(specsRoot, entry.name, "tasks.md")
          let content: string
          try {
            content = await fs.readFile(tasksPath, "utf-8")
          } catch {
            continue
          }

          const lines = content.split("\n")
          let changed = false
          const next = lines.map((line) => {
            const uncheckedPrefix = "- [ ] "
            if (!line.startsWith(uncheckedPrefix)) return line
            const taskText = line.slice(uncheckedPrefix.length)
            const mentions = extractPathMentions(taskText)
            if (mentions.length === 0) return line
            const hit = mentions.some((m) => filePathMatches(filePath, m))
            if (!hit) return line
            changed = true
            return "- [x] " + taskText
          })

          if (changed) {
            await fs.writeFile(tasksPath, next.join("\n"), "utf-8")
            const rel = path.relative(cwd, absPath)
            process.stdout.write(
              `[auto-tick] ${entry.name}/tasks.md <- ${rel}\n`
            )
          }
        }
      } catch {
        // swallow: never break the agent loop from a passive plugin
      }
    },
  }
}) satisfies Plugin
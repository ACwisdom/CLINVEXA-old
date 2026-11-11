/**
 * Writes apps/desktop/build/install-stamp.json with the git ref the desktop
 * .exe should pin to at first-launch bootstrap time.  This file ships inside
 * the packaged app via electron-builder's extraResources entry and is read
 * by electron/main.ts to drive the install.ps1 stage bootstrap flow.
 *
 * Schema (subject to bump via STAMP_SCHEMA_VERSION):
 *   {
 *     "schemaVersion": 1,
 *     "commit":        "<40-char SHA>",
 *     "branch":        "<branch name>",
 *     "builtAt":       "<ISO 8601 UTC timestamp>",
 *     "dirty":         true|false,
 *     "source":        "ci" | "local" | "fallback"
 *   }
 *
 * Source preference order:
 *   1. CI env vars ($GITHUB_SHA / $GITHUB_REF_NAME) -- avoid edge cases with
 *      shallow clones, detached HEADs, etc. in CI.
 *   2. Local `git rev-parse` against the parent repo (../..).
 *   3. Fallback stamp for local/personal builds from non-git source trees
 *      (ZIP extract, interrupted clone with no HEAD, etc.).
 *
 * Dev / out-of-repo builds without git produce an explicit fallback stamp
 * rather than aborting the whole build.  Bootstrap treats the all-zero
 * commit as unpinned and follows the branch instead of fetching a fake SHA.
 */

import { createHash } from "crypto"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs"
import { resolve, join, relative } from "path"
import { execSync } from "child_process"

import { isMain } from "./utils.mjs"

const STAMP_SCHEMA_VERSION = 1

/** Legacy placeholder retained only so older stamps can still be identified. */
export const FALLBACK_COMMIT = "0000000000000000000000000000000000000000"
export const FALLBACK_BRANCH = "main"

const CONTENT_HASH_ROOT_FILES = [
  "pyproject.toml",
  "uv.lock",
  "run_agent.py",
  "model_tools.py",
  "toolsets.py"
]
const CONTENT_HASH_ROOT_DIRS = [
  "agent",
  "clinvexa",
  "hermes_cli",
  "skills/clinvexa",
  "tools",
  "apps/desktop/electron",
  "apps/desktop/src",
  "apps/desktop/scripts",
  "apps/desktop/assets",
  "scripts"
]
const CONTENT_HASH_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "release",
  "dist",
  "build",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "offline"
])

const DESKTOP_ROOT = resolve(import.meta.dirname, "..")
const REPO_ROOT = resolve(DESKTOP_ROOT, "..", "..")
const OUT_DIR = join(DESKTOP_ROOT, "build")
const OUT_FILE = join(OUT_DIR, "install-stamp.json")

function tryExec(cmd, opts) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim()
  } catch {
    return null
  }
}

export function fromCI(env = process.env) {
  const sha = env.GITHUB_SHA
  if (!sha) return null
  const branch = env.GITHUB_REF_NAME || env.GITHUB_HEAD_REF || null
  return {
    commit: sha,
    branch: branch,
    dirty: false, // CI builds from a checkout-of-ref by definition
    source: "ci"
  }
}

export function fromLocalGit(repoRoot = REPO_ROOT, execFn = tryExec) {
  const sha = execFn("git rev-parse HEAD", { cwd: repoRoot })
  if (!sha) return null
  const branch = execFn("git rev-parse --abbrev-ref HEAD", { cwd: repoRoot })
  // `git status --porcelain -uno` is empty iff tracked files match HEAD.
  // We exclude untracked files (-uno) intentionally: a developer who's
  // checked out an installer scratch dir alongside the repo shouldn't
  // poison every local build with a [DIRTY] stamp.  We DO care about
  // tracked-but-modified files because those mean the .exe content
  // differs from the commit being pinned.
  const status = execFn("git status --porcelain -uno", { cwd: repoRoot })
  const dirty = status !== null && status.length > 0
  return {
    commit: sha,
    branch: branch === "HEAD" ? null : branch, // detached HEAD -> null
    dirty: dirty,
    source: "local"
  }
}

export function contentIdentity(repoRoot = REPO_ROOT) {
  const hash = createHash("sha256")
  const files = []
  const visit = candidate => {
    const stat = statSync(candidate)
    if (stat.isDirectory()) {
      const entries = readdirSync(candidate, { withFileTypes: true })
        .filter(entry => !CONTENT_HASH_EXCLUDES.has(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) visit(join(candidate, entry.name))
      return
    }
    files.push(candidate)
  }

  for (const relativePath of [...CONTENT_HASH_ROOT_FILES, ...CONTENT_HASH_ROOT_DIRS]) {
    const candidate = join(repoRoot, relativePath)
    try {
      visit(candidate)
    } catch {
      // Optional source surfaces differ across release branches. Missing
      // candidates do not make the remaining content identity invalid.
    }
  }

  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    hash.update(relative(repoRoot, file).replaceAll("\\", "/"))
    hash.update("\0")
    hash.update(readFileSync(file))
    hash.update("\0")
  }

  if (files.length === 0) {
    throw new Error(`cannot derive CLINVEXA source identity from ${repoRoot}`)
  }

  // Bootstrap's historical field is named `commit` and accepts 7-40 hex
  // characters. Use the first 40 SHA-256 hex characters as a deterministic
  // product-source identity without pretending this non-git tree has a Git
  // commit.
  return hash.digest("hex").slice(0, 40)
}

export function fromFallback(branch = FALLBACK_BRANCH, repoRoot = REPO_ROOT) {
  // Production CLINVEXA source deliveries intentionally omit .git. An
  // all-zero placeholder made the first-launch completion marker invalid and
  // could send later launches back through bootstrap. Derive a stable identity
  // from the actual bundled product source instead.
  return {
    commit: contentIdentity(repoRoot),
    branch: branch || FALLBACK_BRANCH,
    dirty: false,
    source: "content-hash"
  }
}

/**
 * Resolve the install stamp without writing it.  Pure enough for unit tests:
 * inject env / execFn / repoRoot to simulate CI, local git, or no-git trees.
 */
export function resolveStamp({
  env = process.env,
  repoRoot = REPO_ROOT,
  execFn = tryExec,
  fallbackBranch = FALLBACK_BRANCH
} = {}) {
  return fromCI(env) || fromLocalGit(repoRoot, execFn) || fromFallback(fallbackBranch, repoRoot)
}

export function isFallbackCommit(commit) {
  return typeof commit === "string" && /^0{7,40}$/.test(commit)
}

function main() {
  const stamp = resolveStamp()
  if (!stamp || !stamp.commit) {
    // Should not happen — fromFallback() always provides a commit.
    console.error(
      "[write-build-stamp] ERROR: could not determine git commit.\n" +
        "  - $GITHUB_SHA not set\n" +
        "  - `git rev-parse HEAD` failed at " +
        REPO_ROOT +
        "\n" +
        "Packaged builds require a git ref to pin first-launch install.ps1\n" +
        "against. Run from a git checkout or set $GITHUB_SHA explicitly."
    )
    process.exit(1)
  }

  if (stamp.source === "content-hash") {
    console.warn(
      "[write-build-stamp] WARNING: no git commit found (non-git checkout?).\n" +
        "  Using a deterministic CLINVEXA source-content identity for the\n" +
        "  packaged first-launch marker."
    )
  }

  if (stamp.dirty) {
    console.warn(
      "[write-build-stamp] WARNING: working tree is dirty.\n" +
        "  Pinning to " +
        stamp.commit.slice(0, 12) +
        " but the packaged code may differ from that commit.\n" +
        "  Commit your changes before publishing this build."
    )
  }

  const payload = {
    schemaVersion: STAMP_SCHEMA_VERSION,
    commit: stamp.commit,
    branch: stamp.branch,
    builtAt: new Date().toISOString(),
    dirty: stamp.dirty,
    source: stamp.source
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8")
  console.log(
    "[write-build-stamp] wrote " +
      relative(REPO_ROOT, OUT_FILE) +
      " -> " +
      stamp.commit.slice(0, 12) +
      (stamp.branch ? " (" + stamp.branch + ")" : "") +
      (stamp.dirty ? " [DIRTY]" : "") +
      (stamp.source === "content-hash" ? " [CONTENT-HASH]" : "")
  )
}

if (isMain(import.meta.url)) {
  main()
}

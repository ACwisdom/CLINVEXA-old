# Follow-up E Delivery Report: Single Floating Ball, Skill Creator, Skill Plaza, and Voice Recovery

## Decision

Go.

## Delivered Features

- Removed the duplicate workbench floating-ball render. The refreshed desktop keeps the independent movable CLINVEXA floating ball.
- Updated explicit Skill invocation prompts to include CLINVEXA identity, selected Skill title, usage scenario, and function description.
- Added a complete source-managed `skills/clinvexa/skill-creator` Skill and catalog entry.
- Hardened the Skill plaza catalog loader so malformed generated Skill directories are skipped instead of taking down the full API.
- Added Windows Simplified-Chinese speech recognition for CLINVEXA through `tools/clinvexa_windows_stt.ps1`, wired into the packaged backend environment as `HERMES_LOCAL_STT_COMMAND`.
- Rebuilt the authoritative Windows `win-unpacked`, NSIS EXE, and MSI artifacts from the latest source and removed the stale `win-unpacked.bak` directory.

## Changed Source Areas

- `apps/desktop/src/clinvexa/clinvexa-desktop.tsx`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/backend-env.ts`
- `clinvexa/src/clinvexa/skills.py`
- `skills/clinvexa/catalog.json`
- `skills/clinvexa/skill-creator/SKILL.md`
- `skills/clinvexa/skill-creator/agents/openai.yaml`
- `tools/clinvexa_windows_stt.ps1`
- `tools/transcription_tools.py`
- `tests/tools/test_transcription_tools.py`
- `clinvexa/tests/test_skill_install.py`
- `apps/desktop/electron/backend-env.test.ts`
- `apps/desktop/src/clinvexa/clinvexa-shell.test.tsx`

## Acceptance Evidence

- `python -m pytest clinvexa/tests/test_skill_install.py tests/tools/test_transcription_tools.py -k "not stderr_progress_extends_beyond_timeout" -q`: 64 passed, 2 skipped, 1 deselected.
- `npm --prefix apps/desktop run test -- --run src/clinvexa/clinvexa-shell.test.tsx src/clinvexa/agent-prompt.test.ts electron/backend-env.test.ts electron/clinvexa-desktop-installation.test.ts`: 26 passed.
- `python -m ruff check clinvexa tools tests/tools/test_transcription_tools.py`: all checks passed.
- `npm --prefix apps/desktop run typecheck`: passed.
- `npm --prefix apps/desktop run build`: passed.
- `npm --prefix apps/desktop run builder -- --win nsis msi --config ../../deploy/clinvexa/electron-builder.cjs`: passed.
- Direct Windows STT script test returned: `患者今天头痛发热请安排血常规检查和明天复诊`.
- Direct `transcribe_audio` test returned `success=True`, `provider=local_command`, transcript `患者今天头痛发热请安排血常规检查和明天复诊`.
- Live `http://127.0.0.1:8001/clinvexa/skills`: status 200, 28 Skills.
- Live Skill entries confirmed: `skill-creator`, `record-structuring`, and `batch-record-structuring`.
- Live Skill invocation confirmed:
  - `$skill-creator`
  - `CLINVEXA Skill：Skill 创建器`
  - `使用场景与功能：创建、校验并发布 CLINVEXA Skill，使其可在 Skill 广场检索和调用。`
- `apps/desktop/release/win-unpacked.bak`: removed; current release directory has no stale unpacked backup.

## Windows Artifacts

- `apps/desktop/release/CLINVEXA-0.17.0-win-x64.exe`
  - Size: 142,564,238 bytes
  - SHA-256: `1BC65A57AAC434CB2BAFCE881BE742CDD6EB2A54BB3973192340E3D890EA5CC5`
- `apps/desktop/release/CLINVEXA-0.17.0-win-x64.msi`
  - Size: 153,895,256 bytes
  - SHA-256: `52714FA5C2C227D8D527B54C8C3A9E92A6D6A4FB975C30AFE7B17B4F860DC2ED`

## Notes

- One existing Windows timing test, `TestRunCommandSttIdleTimeout.test_stderr_progress_extends_beyond_timeout`, still fails intermittently at a 0.1-second idle timeout on this host. It is unrelated to the CLINVEXA Simplified-Chinese STT path and remains documented as an existing Windows process-start timing limitation.
- The first manual packaged-runtime staging command accidentally reused PowerShell's read-only `$HOME` variable. The corrected staging used `$runtimeHome` and deployed the runtime to `apps/desktop/release/win-unpacked/.clinvexa-runtime`.

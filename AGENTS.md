# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-05
**Repo:** `pi-vibe-wise` — Pi-пакет `vibe-wise` (learning mode), порт Claude Code плагина v0.1.43.

## OVERVIEW
- **Что это:** расширение + два skill для [Pi](https://github.com/badlogic/pi-mono): агент сначала спрашивает подход ученика, разбирает трейдоффы, затем пишет код выбранного дизайна и объясняет его. Прогресс хранится в локальных `.vibe-wise/*.md` и восстанавливается между сессиями.
- **Стек:** TypeScript 5.7 (ESM, `strict`, `noEmit`), Node ≥ 20, `@earendil-works/pi-coding-agent` **0.84.1** (pinned), `typebox`, Vitest 3.
- **Сборки нет:** pi загружает `extensions/index.ts` через jiti. Публикация/установка — локальным путём (`pi install ./vibe-wise`).
- **Главный инвариант:** пакет local-only — только `node:fs`/`node:path`/`node:crypto`, никакой сети, телеметрии и LLM-вызовов из кода пакета. Заметки — данные, не инструкции.

## STRUCTURE
```text
.
├── AGENTS.md                 ← этот файл
├── PLAN.md                   ← полный план порта + review trail (P1–P11), спека
├── package.json              ← ТОЛЬКО обёртка для git-install (pi.extensions/skills → ./vibe-wise)
├── _source/vibe-wise-main/   ← эталонный Claude Code плагин v0.1.43. READ-ONLY, не менять
├── .pi-subagents/            ← артефакты прошлых прогонов агентов (не код)
└── vibe-wise/                ← настоящий пакет; все команды запускать отсюда
    ├── extensions/index.ts   ← тонкое связывание с ExtensionAPI
    ├── extensions/handlers.ts← тестируемое ядро хуков (без импорта pi)
    ├── extensions/tools/     ← vibe_wise_ask, questionnaire, reset (+ shared.ts)
    ├── lib/                  ← чистые порты: paths, profile, pointer, reset, state-directory
    ├── skills/               ← vibe-wise-learn (SKILL/behavior/onboarding/state-templates), vibe-wise-reset
    ├── tests/                ← vitest: unit + seam + opt-in integration
    ├── docs/development.md   ← журнал разработки, ревью, mutation coverage, известные отклонения
    └── CHANGELOG.md / README.md / LICENSE
```

## COMMANDS
Все команды — из `vibe-wise/` (там лежит `node_modules`).

| Action | Command |
| --- | --- |
| Install | `cd vibe-wise && npm install` |
| Typecheck | `cd vibe-wise && npx tsc --noEmit` |
| Test (hermetic) | `cd vibe-wise && npx vitest run` |
| Test (opt-in, real pi) | `cd vibe-wise && VIBE_WISE_INTEGRATION=1 npx vitest run tests/integration.test.ts` |
| Install package | `pi install ./vibe-wise` (глобально) / `pi install ./vibe-wise -l -a` (в проект) |
| Debug injection | `VIBE_WISE_DEBUG_ENTRY=1 pi -p -a --mode json -e <abs>/vibe-wise/extensions/index.ts "…"` |

Ожидаемый baseline: `tsc` чистый, `vitest run` ≈ **98 passed / 6 skipped** (104). Скипы платформенные (Windows symlink) или opt-in — они должны быть **громкими** (`ctx.skip(reason)`), никогда не тихим pass.

## CODING STANDARDS
- **Формат:** табы для отступов (доминирует везде; исключение — `tests/smoke.test.ts` на 2 пробелах), двойные кавычки, точки с запятой, trailing commas.
- **Комментарии:** содержательные JSDoc-блоки в начале модулей и у неочевидных решений; в них фиксируются инварианты, номера параграфов PLAN (`§6.1`, `[P3]`) и runtime-факты pi. Стиль комментариев — английский (как в существующем коде).
- **Слои:** `lib/` — чистые функции без pi; `extensions/handlers.ts` — без импорта `@earendil-works/pi-coding-agent`, чтобы тесты гоняли фейковые `ctx`; `extensions/index.ts` — только wiring; `extensions/tools/*` — тонкие обёртки.
- **Ошибки:** restore-путь глотает все ошибки (`{}` / `null`), чтобы обучение не ломало сессию. Наружу — только через `okResult`/`errorResult` с `details.vibeWiseIsError` (рантайм сам не выставляет `isError`).
- **Зависимости:** новых не добавлять. `peerDependencies` в dev-депах **запинены на 0.84.1** — npm иначе подтянет свежий pi и `tsc` начнёт валидировать несуществующие API.
- **Переносимость:** только Node 20 API. Не использовать `realpath()` для решений о state-каталоге.

## WHERE TO LOOK
- **Спека и решения:** `PLAN.md` (русский, §1–§13 + review trail).
- **Журнал разработки/ревью/известные отклонения:** `vibe-wise/docs/development.md` — читать перед изменением поведения.
- **Исходный контракт:** `_source/vibe-wise-main/hooks/session_start.py`, `skills/reset/reset.py` (эталон для байт-совместимости).
- **Тесты:** `vibe-wise/tests/` — `state-pointer.test.ts` (lib), `reset.test.ts` (reset/fingerprint/symlink), `extension.test.ts` (хуки и инструменты), `integration.test.ts` (opt-in).
- **Skill-проза:** `vibe-wise/skills/vibe-wise-learn/*.md`, `vibe-wise/skills/vibe-wise-reset/*.md`.

## NOTES / GOTCHAS
- **Инъекция:** `session_start` не может ничего добавить в модель. Указатель восстанавливается на каждом ходе через `before_agent_start` → `systemPrompt` (не `message`, иначе попадёт в сессию). Размер указателя **константный, ≤ 1100 байт** (`Buffer.byteLength`), не зависит от заметок. Языковая строка добавляет фиксированные 44 байта.
- **`/compact`:** не шлёт `session_start`; кэш и указатель выживают. Не добавлять обработчики `session_before_compact`/`session_compact`.
- **Байт-совместимость состояния:** `FRESH`-шаблоны в `lib/reset.ts` должны оставаться байт-идентичными `reset.py` (только `\n`, без `\r`; репозиторий использует `.gitattributes * -text` и `core.autocrlf=false`).
- **Reset — строго два вызова:** без `confirmation` → read-only preview (ноль записей на диск); с `confirmation` → проверка fingerprint **до** диалога, затем собственный `ctx.ui.confirm`, commit только по явному подтверждению. Вызов скилла/инструмента — не согласие.
- **Резолвинг state:** nearest-wins, `.vibe-wise` > `.sensible-vibes`, существующий но невалидный кандидат (symlink, файл, битая ссылка) завершает поиск `null` — не подниматься к родителю; `.git` (файл или папка) — граница.
- **Язык:** `Language: <code>` в `profile.md`, whitelist `{en, ru}`, override `VIBE_WISE_LANGUAGE`. Любое другое значение игнорируется — проза заметок не должна попадать в системный промпт.
- **Windows:** symlink-фикстуры падают на junction; файловые symlink-тесты скипаются. Скрипты и тесты должны работать на win32.
- **Не трогать:** `_source/` (эталон), `node_modules/`, `.pi-subagents/` (артефакты). Не менять `.pi/mcp.json` и `ssh-hosts.json` без запроса.
- **Два манифеста:** `vibe-wise/package.json` — для npm/git-пакета, корневой `package.json` — обёртка для git-install. При изменении `pi.extensions`/`pi.skills` синхронизировать оба.
- **Integration-тесты** требуют живого провайдера и могут висеть (`opencode-go`); по умолчанию они opt-in. При `rc=124` — повторить, не считать провалом механизма.

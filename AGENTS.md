# AGENTS.md

The instructions for any coding agent working in this repo live in
[`CLAUDE.md`](CLAUDE.md): how to work here, the commands, and the conventions
every change has to follow. Read it first, then the `.agents/notes/` file for
the area you're touching (CLAUDE.md's "Reference notes" table says which).

- The backlog is [`TODO.md`](TODO.md), and it's the only one.
- A change is done when `bun run check` and `bun run lint` both exit 0 and the
  relevant `bun run test:unit:*` suite passes.
- Workflows are encoded as skills under `.agents/skills/<name>/SKILL.md`.

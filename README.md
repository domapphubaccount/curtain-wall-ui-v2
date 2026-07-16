# SprintForge

A company-internal Scrum/Agile product management app built with React, Express, Prisma, and PostgreSQL. Projects, tasks, project teams, and authenticated users are stored in the database; NovaCart demo data is seeded automatically for a useful first run.

## Access model

- Every authenticated employee can view every project, task, report, file, and team.
- Administrators create and manage users, project teams, projects, tasks, sprints, epics, files, and whiteboards.
- A normal user can edit every field, status, attachment, and timer on tasks assigned to their own account.
- Normal users cannot create/delete/reassign tasks or change tasks assigned to another person.
- Permissions are enforced by the API in addition to role-aware frontend controls.

## Features

- **Multi-project** — manage any number of projects, each with its own backlog, sprints, epics, team, and issue-key sequence. Switch projects from the sidebar; create new ones with a name, key, and team roster; edit or delete a project from its settings (⚙). Removing a team member unassigns their items.
- **Dashboard** — active sprint progress, days remaining, backlog depth, average velocity, sprint health breakdown by status, per-member workload, and a scope-creep warning when points are added after sprint start.
- **Backlog** — the product backlog plus a section per open sprint. Drag items between the backlog and sprints to plan, quick-add items inline, filter by epic, create sprints with goals and dates, start a sprint (snapshots committed points), and complete a sprint (incomplete work rolls to the backlog or a chosen next sprint).
- **Sprint Board** — To Do / In Progress / In Review / Done kanban for the active sprint with drag-and-drop, assignee filter, and sprint goal in the header.
- **Reports** — sprint burndown (ideal vs actual, driven by story completion timestamps) and a velocity chart comparing committed vs completed points per sprint.
- **Work items** — stories, bugs, tasks, and spikes with descriptions, acceptance criteria, Fibonacci story points (1–21), priorities, epics, and assignees. Issue keys auto-increment (NOVA-1, NOVA-2, …).

## Scrum concepts modeled

| Concept | Where |
| --- | --- |
| Product backlog | Backlog view, priority-ordered |
| Sprint planning | Drag items into a planned sprint, then Start sprint |
| Sprint goal | Set on sprint creation, shown on board and dashboard |
| Commitment | Points snapshot taken when the sprint starts |
| Burndown | Reports view, from story `completedAt` timestamps |
| Velocity | Snapshot taken when the sprint completes |
| Rollover | Complete-sprint dialog moves unfinished items |

## Run everything with Docker (recommended)

Docker Compose starts the React frontend, Express API, and PostgreSQL database together. You only
need Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux).

```bash
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). The API is available at
[http://localhost:4000](http://localhost:4000), and its health endpoint is
[http://localhost:4000/health](http://localhost:4000/health).

Source files are mounted into the containers, so frontend and API changes reload automatically.
PostgreSQL data is kept in a named Docker volume between restarts.

Default development accounts:

- Administrator: `admin@sprintforge.local` / `Admin123!`
- Seed users: `aisha@company.local`, `diego@company.local`, `mei@company.local`, and
  `tom@company.local`, all using `SprintForge123!`

Copy `.env.example` to `.env` and change the bootstrap passwords and `JWT_SECRET` before sharing
the app. Existing account passwords are not reset when containers restart.

Useful commands:

```bash
docker compose up -d --build   # start in the background
docker compose logs -f         # follow all logs
docker compose ps              # check service health
docker compose down            # stop the stack and keep database data
docker compose down -v         # stop and permanently delete database data
```

## Run directly with npm

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Project structure

```
src/
  types.ts               # domain model (Project, Story, Sprint, Epic, Member) + constants
  data.ts                # seed data for the sample project
  store.tsx              # reducer, localStorage persistence + v1 migration, selectors
  App.tsx                # sidebar shell, project switcher, view routing
  components/
    common.tsx           # Avatar, chips, badges, Modal, date helpers
    Dashboard.tsx
    Backlog.tsx          # sprint planning + backlog + sprint lifecycle modals
    Board.tsx            # kanban with HTML5 drag-and-drop
    Reports.tsx          # SVG burndown + velocity charts
    StoryModal.tsx       # create/edit work items
    ProjectModal.tsx     # create project / project settings (team, rename, delete)
```

All views always show the currently selected database-backed project. Browser storage is only a
temporary UI cache; PostgreSQL and API authorization are authoritative.

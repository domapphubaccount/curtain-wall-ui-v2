import ExcelJS from "exceljs/dist/exceljs.min.js";
import { backlogStories, sprintStories } from "./store";
import { addDays, daysBetween, effectiveDates, parseYMD, todayYMD } from "./dates";
import { totalTrackedHours } from "./time";
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from "./types";
import type { Priority, Project, Sprint, Story, StoryStatus, StoryType } from "./types";

// ---- Brand palette, mirrored from the CSS custom properties in src/styles.css ----
const PALETTE = {
  bg: "FF15111F",
  surface: "FF1E1830",
  surface2: "FF281F42",
  border: "FF392C58",
  text: "FFECE8F9",
  textDim: "FFAB9FCD",
  accent: "FF8B5CF6",
  accentStrong: "FFA78BFA",
  white: "FFFFFFFF",
  darkInk: "FF1A1420",
};

interface Swatch {
  bg: string;
  fg: string;
}

// Same hues as the .type-*, .prio-*, .sd-*, and .gp-* classes in styles.css.
const STATUS_FILL: Record<StoryStatus, Swatch> = {
  backlog: { bg: "FF3A3A45", fg: PALETTE.text },
  todo: { bg: "FF4A4A56", fg: PALETTE.text },
  inprogress: { bg: "FF4F9CF9", fg: PALETTE.darkInk },
  review: { bg: "FFF5A623", fg: PALETTE.darkInk },
  done: { bg: "FF3ECF8E", fg: PALETTE.darkInk },
};

const PRIORITY_FILL: Record<Priority, Swatch> = {
  critical: { bg: "FFF26D6D", fg: PALETTE.white },
  high: { bg: "FFF5A623", fg: PALETTE.darkInk },
  medium: { bg: "FF4F9CF9", fg: PALETTE.darkInk },
  low: { bg: "FF433C63", fg: PALETTE.textDim },
};

const TYPE_FILL: Record<StoryType, Swatch> = {
  story: { bg: "FF2EA55F", fg: PALETTE.white },
  bug: { bg: "FFE05252", fg: PALETTE.white },
  task: { bg: "FF3F7FD9", fg: PALETTE.white },
  spike: { bg: "FF9B59D0", fg: PALETTE.white },
};

const SPRINT_STATE_FILL: Record<Sprint["state"], Swatch> = {
  active: { bg: "FF3ECF8E", fg: PALETTE.darkInk },
  planned: { bg: "FF4F9CF9", fg: PALETTE.darkInk },
  completed: { bg: "FF433C63", fg: PALETTE.textDim },
};
// Same tint/border used for the weekend columns and the "today" line on the in-app Gantt chart.
const WEEKEND_TINT = "FF1A1428";
const TODAY_BORDER = "FFA78BFA";

const DATE_COLUMNS = new Set([
  "Start date",
  "Due date",
  "Sprint start",
  "Sprint end",
  "Created at",
  "Completed at",
  "Effective start",
  "Effective due",
]);

const DATETIME_COLUMNS = new Set(["Started at", "Ended at"]);

const NUMERIC_COLUMNS = new Set(["Points", "Total Hours", "Sessions", "Duration (h)"]);

function memberName(project: Project, id: string | null): string {
  if (!id) return "Unassigned";
  return project.members.find((m) => m.id === id)?.name ?? "Unknown";
}

function epicName(project: Project, id: string | null): string {
  if (!id) return "";
  return project.epics.find((e) => e.id === id)?.name ?? "";
}

function depKeys(project: Project, deps: string[]): string {
  return deps
    .map((id) => project.stories.find((s) => s.id === id)?.key)
    .filter(Boolean)
    .join(", ");
}

/** A data row plus the raw domain objects needed to color-code its cells. */
interface Row {
  cells: Record<string, unknown>;
  story?: Story;
  sprintState?: Sprint["state"];
}

function storyCells(project: Project, s: Story): Record<string, unknown> {
  return {
    Key: s.key,
    Title: s.title,
    Type: TYPE_LABELS[s.type],
    Status: STATUS_LABELS[s.status],
    Priority: PRIORITY_LABELS[s.priority],
    Points: s.points ?? "",
    Epic: epicName(project, s.epicId),
    Assignee: memberName(project, s.assigneeId),
    "Start date": s.startDate ?? "",
    "Due date": s.dueDate ?? "",
    "Depends on": depKeys(project, s.dependsOn),
    "Created at": s.createdAt.slice(0, 10),
    "Completed at": s.completedAt ? s.completedAt.slice(0, 10) : "",
    Description: s.description,
  };
}

interface ColumnDef {
  header: string;
  width: number;
}

function colorForColumn(header: string, row: Row): Swatch | null {
  if (header === "Type" && row.story) return TYPE_FILL[row.story.type];
  if (header === "Status" && row.story) return STATUS_FILL[row.story.status];
  if (header === "Priority" && row.story) return PRIORITY_FILL[row.story.priority];
  if (header === "Sprint state" && row.sprintState) return SPRINT_STATE_FILL[row.sprintState];
  return null;
}

function buildSheet(
  wb: ExcelJS.Workbook,
  opts: {
    name: string;
    tabColor: string;
    title: string;
    subtitle: string;
    columns: ColumnDef[];
    rows: Row[];
  }
) {
  const ws = wb.addWorksheet(opts.name, { properties: { tabColor: { argb: opts.tabColor } } });
  const colCount = opts.columns.length;

  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = opts.title;
  titleCell.font = { bold: true, size: 16, color: { argb: PALETTE.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accent } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, colCount);
  const subCell = ws.getCell(2, 1);
  subCell.value = opts.subtitle;
  subCell.font = { italic: true, size: 10, color: { argb: PALETTE.textDim } };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface } };
  subCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;

  const headerRowIdx = 3;
  const headerRow = ws.getRow(headerRowIdx);
  opts.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: PALETTE.text } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
    cell.border = { bottom: { style: "medium", color: { argb: PALETTE.accentStrong } } };
    cell.alignment = { vertical: "middle" };
    ws.getColumn(i + 1).width = c.width;
  });
  headerRow.height = 20;

  opts.rows.forEach((row, r) => {
    const excelRow = ws.getRow(headerRowIdx + 1 + r);
    excelRow.height = 18;
    const zebra = r % 2 === 0 ? PALETTE.bg : PALETTE.surface;
    opts.columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = row.cells[c.header];
      const isEmpty = raw === undefined || raw === null || raw === "";
      const asDateTime = !isEmpty && DATETIME_COLUMNS.has(c.header) ? new Date(raw as string) : null;
      if (!isEmpty && DATE_COLUMNS.has(c.header)) {
        cell.value = new Date(parseYMD(raw as string));
        cell.numFmt = "yyyy-mm-dd";
      } else if (asDateTime && !isNaN(asDateTime.getTime())) {
        cell.value = asDateTime;
        cell.numFmt = "yyyy-mm-dd hh:mm";
      } else if (!isEmpty && NUMERIC_COLUMNS.has(c.header)) {
        cell.value = raw as number;
        cell.numFmt = c.header === "Total Hours" || c.header === "Duration (h)" ? "0.0" : "0";
      } else {
        cell.value = isEmpty ? "" : (raw as ExcelJS.CellValue);
      }
      const swatch = colorForColumn(c.header, row);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: swatch?.bg ?? zebra } };
      cell.font = { size: 10.5, bold: !!swatch, color: { argb: swatch?.fg ?? PALETTE.text } };
      cell.border = {
        top: { style: "thin", color: { argb: PALETTE.border } },
        bottom: { style: "thin", color: { argb: PALETTE.border } },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: NUMERIC_COLUMNS.has(c.header) || DATE_COLUMNS.has(c.header) || DATETIME_COLUMNS.has(c.header) ? "center" : undefined,
        wrapText: c.header === "Description",
      };
    });
  });

  if (opts.rows.length) {
    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: colCount } };
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowIdx }];
}

/** Renders as a day-by-day colored timeline, mirroring the in-app Gantt chart's bars/weekend columns/today line. */
function buildGanttSheet(
  wb: ExcelJS.Workbook,
  project: Project,
  groups: { label: string; sprint: Sprint | undefined; stories: Story[] }[]
) {
  const rows = groups.flatMap((g) => g.stories.map((story) => ({ label: g.label, story, sprint: g.sprint })));

  const today = todayYMD();
  let rangeStart: string;
  let maxDue: string;
  if (rows.length === 0) {
    rangeStart = addDays(today, -3);
    maxDue = addDays(today, 25);
  } else {
    let minStart = today;
    maxDue = addDays(today, 21);
    for (const r of rows) {
      const eff = effectiveDates(r.story, r.sprint);
      if (eff.start < minStart) minStart = eff.start;
      if (eff.due > maxDue) maxDue = eff.due;
    }
    rangeStart = addDays(minStart, -3);
    maxDue = addDays(maxDue, 7);
  }
  const totalDays = Math.min(365, daysBetween(rangeStart, maxDue) + 1);
  const dayDates = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i));
  const todayIdx = dayDates.indexOf(today);

  const FIXED: ColumnDef[] = [
    { header: "Group", width: 16 },
    { header: "Key", width: 10 },
    { header: "Title", width: 34 },
    { header: "Assignee", width: 14 },
    { header: "Status", width: 12 },
  ];
  const fixedCount = FIXED.length;
  const totalCols = fixedCount + totalDays;

  const ws = wb.addWorksheet("Gantt", { properties: { tabColor: { argb: "FFF5A623" } } });

  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${project.name} — Gantt Timeline`;
  titleCell.font = { bold: true, size: 16, color: { argb: PALETTE.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accent } };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, totalCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = `${rows.length} scheduled item${rows.length === 1 ? "" : "s"} · ${rangeStart} to ${dayDates[dayDates.length - 1]} · exported ${todayYMD()}`;
  subCell.font = { italic: true, size: 10, color: { argb: PALETTE.textDim } };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface } };
  subCell.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 20;

  const monthRowIdx = 3;
  const headerRowIdx = 4;

  ws.mergeCells(monthRowIdx, 1, headerRowIdx, fixedCount);
  const fixedHeadCell = ws.getCell(monthRowIdx, 1);
  fixedHeadCell.value = "Tasks";
  fixedHeadCell.font = { bold: true, size: 11, color: { argb: PALETTE.text } };
  fixedHeadCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
  fixedHeadCell.alignment = { vertical: "middle", horizontal: "center" };
  FIXED.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  // Month super-header, merging consecutive same-month day columns (like the app's month row).
  let dayCol = fixedCount + 1;
  let i = 0;
  while (i < dayDates.length) {
    const monthLabel = new Date(parseYMD(dayDates[i])).toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    let count = 1;
    while (i + count < dayDates.length) {
      const nextLabel = new Date(parseYMD(dayDates[i + count])).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      if (nextLabel !== monthLabel) break;
      count++;
    }
    if (count > 1) ws.mergeCells(monthRowIdx, dayCol, monthRowIdx, dayCol + count - 1);
    const cell = ws.getCell(monthRowIdx, dayCol);
    cell.value = monthLabel;
    cell.font = { bold: true, size: 9, color: { argb: PALETTE.textDim } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    dayCol += count;
    i += count;
  }
  ws.getRow(monthRowIdx).height = 16;

  FIXED.forEach((c, ci) => {
    const cell = ws.getCell(headerRowIdx, ci + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 11, color: { argb: PALETTE.text } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
    cell.border = { bottom: { style: "medium", color: { argb: PALETTE.accentStrong } } };
    cell.alignment = { vertical: "middle" };
  });
  dayDates.forEach((d, di) => {
    const col = fixedCount + 1 + di;
    const dt = new Date(parseYMD(d));
    const isWeekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
    const cell = ws.getCell(headerRowIdx, col);
    cell.value = dt.getUTCDate();
    cell.font = { size: 8.5, color: { argb: PALETTE.textDim } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isWeekend ? WEEKEND_TINT : PALETTE.surface2 } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "medium", color: { argb: PALETTE.accentStrong } },
      ...(di === todayIdx
        ? {
            left: { style: "thick" as const, color: { argb: TODAY_BORDER } },
            right: { style: "thick" as const, color: { argb: TODAY_BORDER } },
          }
        : {}),
    };
    ws.getColumn(col).width = 3;
  });
  ws.getRow(headerRowIdx).height = 16;

  rows.forEach((r, ri) => {
    const excelRow = headerRowIdx + 1 + ri;
    ws.getRow(excelRow).height = 16;
    const zebra = ri % 2 === 0 ? PALETTE.bg : PALETTE.surface;
    const eff = effectiveDates(r.story, r.sprint);
    const statusSwatch = STATUS_FILL[r.story.status];
    const fixedVals = [r.label, r.story.key, r.story.title, memberName(project, r.story.assigneeId), STATUS_LABELS[r.story.status]];

    fixedVals.forEach((val, ci) => {
      const isStatusCol = ci === 4;
      const cell = ws.getCell(excelRow, ci + 1);
      cell.value = val;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isStatusCol ? statusSwatch.bg : zebra } };
      cell.font = { size: 10, bold: isStatusCol, color: { argb: isStatusCol ? statusSwatch.fg : PALETTE.text } };
      cell.border = {
        top: { style: "thin", color: { argb: PALETTE.border } },
        bottom: { style: "thin", color: { argb: PALETTE.border } },
      };
      cell.alignment = { vertical: "middle", wrapText: ci === 2 };
    });

    dayDates.forEach((d, di) => {
      const col = fixedCount + 1 + di;
      const inBar = d >= eff.start && d <= eff.due;
      const dt = new Date(parseYMD(d));
      const isWeekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
      const cell = ws.getCell(excelRow, col);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: inBar ? statusSwatch.bg : isWeekend ? WEEKEND_TINT : zebra },
      };
      if (di === todayIdx) {
        cell.border = {
          left: { style: "thick", color: { argb: TODAY_BORDER } },
          right: { style: "thick", color: { argb: TODAY_BORDER } },
        };
      }
    });
  });

  if (rows.length) {
    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: fixedCount } };
  }
  ws.views = [{ state: "frozen", xSplit: fixedCount, ySplit: headerRowIdx }];
}

/** One sheet per team member with logged time, listing every session they've run across all tasks. */
/** Per-person time log: a live total, and a From/To date-range filter backed by a SUMIFS formula. */
function buildMemberTimeSheets(wb: ExcelJS.Workbook, project: Project) {
  const usedNames = new Set<string>();
  const MEMBER_COLS: ColumnDef[] = [
    { header: "Task", width: 42 },
    { header: "Started at", width: 18 },
    { header: "Ended at", width: 18 },
    { header: "Duration (h)", width: 12 },
  ];

  for (const member of project.members) {
    const sessions = project.stories.flatMap((s) =>
      s.timeEntries.filter((e) => e.memberId === member.id).map((entry) => ({ story: s, entry }))
    );
    if (sessions.length === 0) continue;
    sessions.sort((a, b) => b.entry.startedAt.localeCompare(a.entry.startedAt));

    let base = member.name.replace(/[[\]*?/\\:]/g, "").trim().slice(0, 28) || "Member";
    let name = base;
    let n = 2;
    while (usedNames.has(name.toLowerCase())) name = `${base} (${n++})`;
    usedNames.add(name.toLowerCase());

    const tabColor = /^#[0-9a-f]{6}$/i.test(member.color) ? `FF${member.color.slice(1).toUpperCase()}` : PALETTE.accentStrong;
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tabColor } } });
    const colCount = MEMBER_COLS.length;

    ws.mergeCells(1, 1, 1, colCount);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `${member.name} — Time Log`;
    titleCell.font = { bold: true, size: 16, color: { argb: PALETTE.white } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.accent } };
    titleCell.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;

    ws.mergeCells(2, 1, 2, colCount);
    const subCell = ws.getCell(2, 1);
    subCell.value = `${sessions.length} session${sessions.length === 1 ? "" : "s"} logged · exported ${todayYMD()}`;
    subCell.font = { italic: true, size: 10, color: { argb: PALETTE.textDim } };
    subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface } };
    subCell.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(2).height = 20;

    // ---- Total + From/To date-range filter (rows 3-4), above the data table ----
    const headerRowIdx = 5;
    const firstDataRow = headerRowIdx + 1;
    const lastDataRow = headerRowIdx + sessions.length;
    const startedDates = sessions.map(({ entry }) => entry.startedAt.slice(0, 10));
    const minDate = startedDates.reduce((a, b) => (a < b ? a : b));
    const maxDate = startedDates.reduce((a, b) => (a > b ? a : b));

    function labelCell(row: number, col: number, text: string) {
      const cell = ws.getCell(row, col);
      cell.value = text;
      cell.font = { bold: true, size: 10.5, color: { argb: PALETTE.textDim } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface } };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      return cell;
    }
    function inputCell(row: number, col: number) {
      const cell = ws.getCell(row, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
      cell.font = { bold: true, size: 11, color: { argb: PALETTE.accentStrong } };
      cell.border = {
        top: { style: "thin", color: { argb: PALETTE.accentStrong } },
        bottom: { style: "thin", color: { argb: PALETTE.accentStrong } },
        left: { style: "thin", color: { argb: PALETTE.accentStrong } },
        right: { style: "thin", color: { argb: PALETTE.accentStrong } },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      return cell;
    }

    labelCell(3, 1, "Total hours logged");
    const totalCell = inputCell(3, 2);
    totalCell.value = { formula: `SUM(D${firstDataRow}:D${lastDataRow})` } as ExcelJS.CellValue;
    totalCell.numFmt = '0.0"h"';

    labelCell(3, 3, "From");
    const fromCell = ws.getCell(3, 4);
    fromCell.value = new Date(parseYMD(minDate));
    fromCell.numFmt = "yyyy-mm-dd";
    fromCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
    fromCell.font = { bold: true, size: 10.5, color: { argb: PALETTE.text } };
    fromCell.border = {
      top: { style: "thin", color: { argb: PALETTE.accentStrong } },
      bottom: { style: "thin", color: { argb: PALETTE.accentStrong } },
      left: { style: "thin", color: { argb: PALETTE.accentStrong } },
      right: { style: "thin", color: { argb: PALETTE.accentStrong } },
    };
    fromCell.alignment = { vertical: "middle", horizontal: "center" };

    labelCell(4, 1, "Hours in range");
    const rangeCell = inputCell(4, 2);
    rangeCell.value = {
      formula: `SUMIFS(D${firstDataRow}:D${lastDataRow},B${firstDataRow}:B${lastDataRow},">="&D3,B${firstDataRow}:B${lastDataRow},"<"&(D4+1))`,
    } as ExcelJS.CellValue;
    rangeCell.numFmt = '0.0"h"';

    labelCell(4, 3, "To");
    const toCell = ws.getCell(4, 4);
    toCell.value = new Date(parseYMD(maxDate));
    toCell.numFmt = "yyyy-mm-dd";
    toCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
    toCell.font = { bold: true, size: 10.5, color: { argb: PALETTE.text } };
    toCell.border = {
      top: { style: "thin", color: { argb: PALETTE.accentStrong } },
      bottom: { style: "thin", color: { argb: PALETTE.accentStrong } },
      left: { style: "thin", color: { argb: PALETTE.accentStrong } },
      right: { style: "thin", color: { argb: PALETTE.accentStrong } },
    };
    toCell.alignment = { vertical: "middle", horizontal: "center" };

    ws.getRow(3).height = 20;
    ws.getRow(4).height = 20;

    // ---- Column header row ----
    MEMBER_COLS.forEach((c, i) => {
      const cell = ws.getCell(headerRowIdx, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, size: 11, color: { argb: PALETTE.text } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.surface2 } };
      cell.border = { bottom: { style: "medium", color: { argb: PALETTE.accentStrong } } };
      cell.alignment = { vertical: "middle" };
      ws.getColumn(i + 1).width = c.width;
    });
    ws.getRow(headerRowIdx).height = 20;

    // ---- Data rows ----
    sessions.forEach(({ story, entry }, r) => {
      const excelRow = firstDataRow + r;
      ws.getRow(excelRow).height = 18;
      const zebra = r % 2 === 0 ? PALETTE.bg : PALETTE.surface;
      const endMs = entry.endedAt ? new Date(entry.endedAt).getTime() : Date.now();
      const hours = Math.round(((endMs - new Date(entry.startedAt).getTime()) / 3_600_000) * 10) / 10;

      const taskCell = ws.getCell(excelRow, 1);
      taskCell.value = `${story.key} — ${story.title}`;
      const startCell = ws.getCell(excelRow, 2);
      startCell.value = new Date(entry.startedAt);
      startCell.numFmt = "yyyy-mm-dd hh:mm";
      const endCell = ws.getCell(excelRow, 3);
      if (entry.endedAt) {
        endCell.value = new Date(entry.endedAt);
        endCell.numFmt = "yyyy-mm-dd hh:mm";
      } else {
        endCell.value = "still running";
      }
      const durCell = ws.getCell(excelRow, 4);
      durCell.value = hours;
      durCell.numFmt = "0.0";

      [taskCell, startCell, endCell, durCell].forEach((cell, ci) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        cell.font = { size: 10.5, color: { argb: PALETTE.text } };
        cell.border = {
          top: { style: "thin", color: { argb: PALETTE.border } },
          bottom: { style: "thin", color: { argb: PALETTE.border } },
        };
        cell.alignment = { vertical: "middle", horizontal: ci >= 1 ? "center" : undefined };
      });
    });

    ws.autoFilter = { from: { row: headerRowIdx, column: 1 }, to: { row: headerRowIdx, column: colCount } };
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowIdx }];
  }
}

const STORY_COLUMNS: ColumnDef[] = [
  { header: "Key", width: 12 },
  { header: "Title", width: 40 },
  { header: "Type", width: 12 },
  { header: "Status", width: 14 },
  { header: "Priority", width: 12 },
  { header: "Points", width: 9 },
  { header: "Epic", width: 16 },
  { header: "Assignee", width: 16 },
  { header: "Start date", width: 12 },
  { header: "Due date", width: 12 },
  { header: "Depends on", width: 16 },
  { header: "Created at", width: 12 },
  { header: "Completed at", width: 13 },
  { header: "Description", width: 45 },
];

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProjectToExcel(project: Project): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SprintForge";
  wb.created = new Date();

  const backlog = backlogStories(project);
  buildSheet(wb, {
    name: "Backlog",
    tabColor: PALETTE.accentStrong,
    title: `${project.name} — Product Backlog`,
    subtitle: `${backlog.length} unplanned item${backlog.length === 1 ? "" : "s"} · exported ${todayYMD()}`,
    columns: STORY_COLUMNS,
    rows: backlog.map((s) => ({ cells: storyCells(project, s), story: s })),
  });

  const sortedSprints = [...project.sprints].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const sprintColumns: ColumnDef[] = [
    { header: "Sprint", width: 18 },
    { header: "Sprint state", width: 13 },
    { header: "Sprint start", width: 12 },
    { header: "Sprint end", width: 12 },
    ...STORY_COLUMNS,
  ];
  const sprintRows: Row[] = sortedSprints.flatMap((sp) =>
    sprintStories(project, sp.id).map((s) => ({
      cells: {
        Sprint: sp.name,
        "Sprint state": sp.state,
        "Sprint start": sp.startDate,
        "Sprint end": sp.endDate,
        ...storyCells(project, s),
      },
      story: s,
      sprintState: sp.state,
    }))
  );
  buildSheet(wb, {
    name: "Sprints",
    tabColor: "FF4F9CF9",
    title: `${project.name} — All Sprints`,
    subtitle: `${sortedSprints.length} sprint${sortedSprints.length === 1 ? "" : "s"} (previous, active & upcoming) · exported ${todayYMD()}`,
    columns: sprintColumns,
    rows: sprintRows,
  });

  const ganttGroups: { label: string; sprint: Sprint | undefined; stories: Story[] }[] = [
    ...sortedSprints.map((sp) => ({ label: sp.name, sprint: sp, stories: sprintStories(project, sp.id) })),
    { label: "Product Backlog", sprint: undefined, stories: backlog },
  ];
  buildGanttSheet(wb, project, ganttGroups);

  const trackedStories = project.stories.filter((s) => s.timeEntries.length > 0);
  const timeColumns: ColumnDef[] = [
    { header: "Key", width: 12 },
    { header: "Title", width: 40 },
    { header: "Type", width: 12 },
    { header: "Status", width: 14 },
    { header: "Assignee", width: 16 },
    { header: "Total Hours", width: 12 },
    { header: "Sessions", width: 10 },
  ];
  const timeRows: Row[] = trackedStories
    .map((s) => ({
      cells: {
        Key: s.key,
        Title: s.title,
        Type: TYPE_LABELS[s.type],
        Status: STATUS_LABELS[s.status],
        Assignee: memberName(project, s.assigneeId),
        "Total Hours": Math.round(totalTrackedHours(s) * 10) / 10,
        Sessions: s.timeEntries.length,
      },
      story: s,
    }))
    .sort((a, b) => (b.cells["Total Hours"] as number) - (a.cells["Total Hours"] as number));
  buildSheet(wb, {
    name: "Time Tracking",
    tabColor: "FF3ECF8E",
    title: `${project.name} — Time Tracking`,
    subtitle: `${timeRows.length} task${timeRows.length === 1 ? "" : "s"} with logged time · exported ${todayYMD()}`,
    columns: timeColumns,
    rows: timeRows,
  });

  buildMemberTimeSheets(wb, project);

  const safeName = project.name.replace(/[^\w-]+/g, "_") || "project";
  await downloadWorkbook(wb, `${safeName}_export_${todayYMD()}.xlsx`);
}

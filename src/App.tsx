import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
  ReferenceLine,
} from "recharts";

const STORAGE_KEY = "solar-progress-tracker-web-v53";
const HISTORY_WORKDAYS = 5;
const FORECAST_WORKDAYS = 15;

type UserRole = "Admin" | "Editor" | "Viewer";
type WeatherType = "clear" | "cloudy" | "wind" | "rain" | "storm" | "snow";
type TabKey = "dashboard" | "tasks" | "entries" | "weather" | "users" | "settings";
type Tone = "slate" | "green" | "amber" | "red" | "blue";

type User = {
  id: string;
  name: string;
  role: UserRole;
};

type Task = {
  id: string;
  name: string;
  category: string;
  assignedUserIds: string[];
  startDate: string;
  targetFinish: string;
  plannedQty: number;
  completeQty: number;
  unit: string;
  active: boolean;
  notes: string;
  targetProductivityPerPerson: number;
};

type DailyEntry = {
  id: string;
  date: string;
  taskId: string | null;
  qty: number;
  headcount: number;
  note: string;
  applied: boolean;
};

type WeatherDay = {
  id: string;
  date: string;
  type: WeatherType;
  note: string;
  source: "manual" | "api";
};

type ProjectSettings = {
  useWeatherInProjection: boolean;
  trailingDays: number;
};

type Project = {
  id: string;
  name: string;
  location: string;
  status: string;
  startDate: string;
  targetFinish: string;
  weather: WeatherDay[];
  tasks: Task[];
  dailyEntries: DailyEntry[];
  settings: ProjectSettings;
};

type AppState = {
  users: User[];
  projects: Project[];
};

type WeatherTypeMeta = {
  value: WeatherType;
  label: string;
  factor: number;
};

type TaskChartPoint = {
  date: string;
  label: string;
  actualQty: number | null;
  requiredQty: number | null;
  trendQty: number | null;
  actualHeadcount: number | null;
  requiredHeadcount: number | null;
  trendHeadcount: number | null;
};

type IconProps = {
  className?: string;
};

const WEATHER_TYPES: WeatherTypeMeta[] = [
  { value: "clear", label: "Clear", factor: 1 },
  { value: "cloudy", label: "Cloudy", factor: 0.95 },
  { value: "wind", label: "Wind", factor: 0.8 },
  { value: "rain", label: "Rain", factor: 0.55 },
  { value: "storm", label: "Storm", factor: 0.2 },
  { value: "snow", label: "Snow/Ice", factor: 0.15 },
];

function IconBase({ className = "h-5 w-5", children }: React.PropsWithChildren<IconProps>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

function AlertTriangleIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </IconBase>
  );
}

function BarChart3Icon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 15v-4" />
      <path d="M12 15V7" />
      <path d="M17 15v-7" />
    </IconBase>
  );
}

function CalendarDaysIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
    </IconBase>
  );
}

function CheckCircle2Icon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </IconBase>
  );
}

function ClipboardListIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9z" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
      <path d="M7 11h.01" />
      <path d="M7 15h.01" />
    </IconBase>
  );
}

function CloudRainIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M7 18a4 4 0 1 1 .9-7.9A5 5 0 0 1 17 8a4 4 0 1 1 0 8H7Z" />
      <path d="M8 19v2" />
      <path d="M12 19v2" />
      <path d="M16 19v2" />
    </IconBase>
  );
}

function DatabaseIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </IconBase>
  );
}

function Edit3Icon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5 12.5-12.5Z" />
    </IconBase>
  );
}

function PlusIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function RefreshCwIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M21 12a9 9 0 0 0-15.5-6.4" />
      <path d="M3 4v5h5" />
      <path d="M3 12a9 9 0 0 0 15.5 6.4" />
      <path d="M21 20v-5h-5" />
    </IconBase>
  );
}

function Trash2Icon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </IconBase>
  );
}

function UsersIcon({ className }: IconProps) {
  return (
    <IconBase className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a4 4 0 0 1 0 7.75" />
    </IconBase>
  );
}

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`);
}

function formatISODate(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayISO(): string {
  return formatISODate(new Date());
}

function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

function isWorkday(dateStr: string): boolean {
  const day = parseDate(dateStr).getDay();
  return day >= 1 && day <= 5;
}

function workdaysBetween(start: string, end: string): number {
  if (!start || !end || end < start) return 0;
  let cursor = start;
  let count = 0;
  while (cursor <= end) {
    if (isWorkday(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

function addWorkdays(dateStr: string, workdays: number): string {
  let remaining = Math.max(0, Math.floor(workdays));
  let cursor = dateStr;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isWorkday(cursor)) remaining -= 1;
  }
  return cursor;
}

function getPreviousWorkdays(endDate: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = endDate;
  while (dates.length < count) {
    if (isWorkday(cursor)) dates.unshift(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates;
}

function getNextWorkdays(startDate: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (dates.length < count) {
    if (isWorkday(cursor)) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function fmt(value: number, digits = 0): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "0";
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeNonNegativeNumber(value: unknown, fallback = 0): number {
  return Math.max(0, safeNumber(value, fallback));
}

function safePositiveInteger(value: unknown, fallback = 1): number {
  return Math.max(1, Math.floor(safeNumber(value, fallback)));
}

function weatherMeta(type: string): WeatherTypeMeta {
  return WEATHER_TYPES.find((item) => item.value === type) || WEATHER_TYPES[0];
}

function weatherCodeToType(code: number): WeatherType {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([45, 48, 1, 2, 3].includes(code)) return "cloudy";
  return "clear";
}

function buildDefaultWeather(): WeatherDay[] {
  return getNextWorkdays(todayISO(), 10).map((date, index) => ({
    id: uid(),
    date,
    type: (index < 4 ? "clear" : index < 7 ? "cloudy" : "rain") as WeatherType,
    note: "",
    source: "manual",
  }));
}

function buildDefaultState(): AppState {
  return {
    users: [
      { id: uid(), name: "Superintendent", role: "Admin" },
      { id: uid(), name: "Project Engineer", role: "Editor" },
    ],
    projects: [
      {
        id: uid(),
        name: "Example Solar Project",
        location: "Mount Vernon, TX",
        status: "Active",
        startDate: addDays(todayISO(), -21),
        targetFinish: addWorkdays(todayISO(), 45),
        weather: buildDefaultWeather(),
        tasks: [
          {
            id: uid(),
            name: "Pile Installation",
            category: "Civil",
            assignedUserIds: [],
            startDate: addDays(todayISO(), -14),
            targetFinish: addWorkdays(todayISO(), 10),
            plannedQty: 5000,
            completeQty: 2350,
            unit: "piles",
            active: true,
            notes: "Mainline tracker task",
            targetProductivityPerPerson: 12,
          },
          {
            id: uid(),
            name: "Table Build",
            category: "Mechanical",
            assignedUserIds: [],
            startDate: addDays(todayISO(), -10),
            targetFinish: addWorkdays(todayISO(), 20),
            plannedQty: 2000,
            completeQty: 620,
            unit: "tables",
            active: true,
            notes: "Depends on pile handoff",
            targetProductivityPerPerson: 4,
          },
        ],
        dailyEntries: [],
        settings: { useWeatherInProjection: true, trailingDays: 5 },
      },
    ],
  };
}

function sanitizeState(state: unknown): AppState {
  const fallback = buildDefaultState();
  if (!state || typeof state !== "object") return fallback;
  const raw = state as Partial<AppState>;
  if (!Array.isArray(raw.projects) || !Array.isArray(raw.users)) return fallback;
  return {
    users: raw.users.map((user: any) => ({
      id: typeof user?.id === "string" ? user.id : uid(),
      name: user?.name || "User",
      role: (user?.role === "Admin" || user?.role === "Editor" || user?.role === "Viewer" ? user.role : "Editor") as UserRole,
    })),
    projects: raw.projects.map((project: any) => ({
      id: typeof project?.id === "string" ? project.id : uid(),
      name: project?.name || "Untitled Project",
      location: project?.location || "",
      status: project?.status || "Active",
      startDate: project?.startDate || todayISO(),
      targetFinish: project?.targetFinish || addWorkdays(todayISO(), 20),
      weather:
        Array.isArray(project?.weather) && project.weather.length > 0
          ? project.weather.map((day: any, idx: number) => ({
              id: typeof day?.id === "string" ? day.id : uid(),
              date: day?.date || getNextWorkdays(todayISO(), 10)[idx] || todayISO(),
              type: weatherMeta(day?.type).value,
              note: day?.note || "",
              source: day?.source === "api" ? "api" : "manual",
            }))
          : buildDefaultWeather(),
      tasks: Array.isArray(project?.tasks)
        ? project.tasks.map((task: any) => ({
            id: typeof task?.id === "string" ? task.id : uid(),
            name: task?.name || "Task",
            category: task?.category || "General",
            assignedUserIds: Array.isArray(task?.assignedUserIds) ? task.assignedUserIds.filter((id: unknown) => typeof id === "string") : [],
            startDate: task?.startDate || todayISO(),
            targetFinish: task?.targetFinish || addWorkdays(todayISO(), 10),
            plannedQty: safeNonNegativeNumber(task?.plannedQty, 0),
            completeQty: safeNonNegativeNumber(task?.completeQty, 0),
            unit: task?.unit || "units",
            active: task?.active !== false,
            notes: task?.notes || "",
            targetProductivityPerPerson: Math.max(0.01, safeNonNegativeNumber(task?.targetProductivityPerPerson, 1)),
          }))
        : [],
      dailyEntries: Array.isArray(project?.dailyEntries)
        ? project.dailyEntries.map((entry: any) => ({
            id: typeof entry?.id === "string" ? entry.id : uid(),
            date: entry?.date || todayISO(),
            taskId: typeof entry?.taskId === "string" ? entry.taskId : null,
            qty: safeNonNegativeNumber(entry?.qty, 0),
            headcount: safeNonNegativeNumber(entry?.headcount, 0),
            note: entry?.note || "",
            applied: Boolean(entry?.applied),
          }))
        : [],
      settings: {
        useWeatherInProjection: project?.settings?.useWeatherInProjection !== false,
        trailingDays: safePositiveInteger(project?.settings?.trailingDays, 5),
      },
    })),
  };
}

function loadState(): AppState {
  try {
    if (typeof localStorage === "undefined") return buildDefaultState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultState();
    return sanitizeState(JSON.parse(raw));
  } catch {
    return buildDefaultState();
  }
}

function saveLocalState(state: AppState) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
  }
}

function getTaskActualComplete(project: Project, task: Task): number {
  const appliedQty = project.dailyEntries.reduce((acc, entry) => {
    if (!entry.applied || entry.taskId !== task.id) return acc;
    return acc + safeNonNegativeNumber(entry.qty, 0);
  }, 0);
  return safeNonNegativeNumber(task.completeQty, 0) + appliedQty;
}

function getWeatherFactor(project: Project): number {
  if (!project.settings.useWeatherInProjection || project.weather.length === 0) return 1;
  return avg(project.weather.map((day) => weatherMeta(day.type).factor)) || 1;
}

function getWeatherFactorByDate(project: Project, date: string): number {
  const match = project.weather.find((day) => day.date === date);
  return match ? weatherMeta(match.type).factor : 1;
}

function getProjectTrailingEntries(project: Project): DailyEntry[] {
  return [...project.dailyEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((entry) => isWorkday(entry.date))
    .slice(-project.settings.trailingDays);
}

function getTaskTrailingEntries(project: Project, taskId: string): DailyEntry[] {
  return [...project.dailyEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((entry) => entry.taskId === taskId && isWorkday(entry.date))
    .slice(-project.settings.trailingDays);
}

function getRecentRateFromEntries(entries: DailyEntry[]): number {
  return avg(entries.map((entry) => safeNonNegativeNumber(entry.qty, 0)));
}

function getRecentHeadcountFromEntries(entries: DailyEntry[]): number {
  return avg(entries.map((entry) => safeNonNegativeNumber(entry.headcount, 0)).filter((value) => value > 0));
}

function getRecentProductivityPerPerson(entries: DailyEntry[]): number {
  const productive = entries.filter((entry) => entry.headcount > 0);
  if (productive.length < 3) return 0;
  const qty = sum(productive.map((entry) => entry.qty));
  const headcount = sum(productive.map((entry) => entry.headcount));
  return headcount > 0 ? qty / headcount : 0;
}

function getEffectiveProductivityPerPerson(project: Project, task: Task) {
  const recentActual = getRecentProductivityPerPerson(getTaskTrailingEntries(project, task.id));
  return {
    value: recentActual > 0 ? recentActual : Math.max(task.targetProductivityPerPerson, 0.01),
    usingReality: recentActual > 0,
  };
}

function getProjectMetrics(project: Project) {
  const plannedQty = project.tasks.reduce((acc, task) => acc + safeNonNegativeNumber(task.plannedQty, 0), 0);
  const completeQty = project.tasks.reduce((acc, task) => acc + getTaskActualComplete(project, task), 0);
  const remainingQty = Math.max(0, plannedQty - completeQty);
  const recentRate = getRecentRateFromEntries(getProjectTrailingEntries(project));
  const adjustedRate = recentRate * getWeatherFactor(project);
  const workdaysRemaining = workdaysBetween(todayISO(), project.targetFinish);
  const requiredDailyRate = workdaysRemaining > 0 ? remainingQty / workdaysRemaining : remainingQty;
  const workdaysToFinish = adjustedRate > 0 ? Math.ceil(remainingQty / adjustedRate) : 0;
  const projectedFinish = adjustedRate > 0 ? addWorkdays(todayISO(), Math.max(0, workdaysToFinish - 1)) : null;
  const finishSlipDays = projectedFinish ? Math.max(0, workdaysBetween(project.targetFinish, projectedFinish) - 1) : 0;
  const percentComplete = plannedQty > 0 ? (completeQty / plannedQty) * 100 : 0;
  return {
    plannedQty,
    completeQty,
    remainingQty,
    recentRate,
    adjustedRate,
    requiredDailyRate,
    projectedFinish,
    finishSlipDays,
    percentComplete,
  };
}

function getTaskMetrics(project: Project, task: Task) {
  const trailingEntries = getTaskTrailingEntries(project, task.id);
  const completeQty = getTaskActualComplete(project, task);
  const remainingQty = Math.max(0, safeNonNegativeNumber(task.plannedQty, 0) - completeQty);
  const recentRate = getRecentRateFromEntries(trailingEntries);
  const recentHeadcount = getRecentHeadcountFromEntries(trailingEntries);
  const productivity = getEffectiveProductivityPerPerson(project, task);
  const workdaysRemaining = workdaysBetween(todayISO(), task.targetFinish);
  const requiredDailyRate = workdaysRemaining > 0 ? remainingQty / workdaysRemaining : remainingQty;
  const requiredHeadcount = productivity.value > 0 ? requiredDailyRate / productivity.value : 0;
  const adjustedRate = recentRate * getWeatherFactor(project);
  const workdaysToFinish = adjustedRate > 0 ? Math.ceil(remainingQty / adjustedRate) : 0;
  const projectedFinish = adjustedRate > 0 ? addWorkdays(todayISO(), Math.max(0, workdaysToFinish - 1)) : null;
  const slipDays = projectedFinish ? Math.max(0, workdaysBetween(task.targetFinish, projectedFinish) - 1) : 0;
  return {
    completeQty,
    remainingQty,
    recentRate,
    recentHeadcount,
    adjustedRate,
    requiredDailyRate,
    requiredHeadcount,
    projectedFinish,
    slipDays,
    productivityPerPerson: productivity.value,
    usingReality: productivity.usingReality,
  };
}

function buildTaskChartData(project: Project, task: Task): TaskChartPoint[] {
  const trailingEntries = getTaskTrailingEntries(project, task.id);
  const historyDates = getPreviousWorkdays(todayISO(), HISTORY_WORKDAYS);
  const forecastDates = getNextWorkdays(todayISO(), FORECAST_WORKDAYS);
  const metrics = getTaskMetrics(project, task);
  const recentTrendHeadcount = metrics.recentHeadcount > 0 ? metrics.recentHeadcount : metrics.requiredHeadcount;
  let projectedRemaining = metrics.remainingQty;

  const history: TaskChartPoint[] = historyDates.map((date) => {
    const entry = trailingEntries.find((item) => item.date === date);
    return {
      date,
      label: date.slice(5),
      actualQty: entry ? entry.qty : 0,
      requiredQty: null,
      trendQty: null,
      actualHeadcount: entry ? entry.headcount : 0,
      requiredHeadcount: null,
      trendHeadcount: null,
    };
  });

  const forecast: TaskChartPoint[] = forecastDates.map((date) => {
    const weatherFactor = getWeatherFactorByDate(project, date);
    const remainingWorkdaysFromDate = Math.max(1, workdaysBetween(date, task.targetFinish));
    const requiredQty = projectedRemaining > 0 ? projectedRemaining / remainingWorkdaysFromDate : 0;
    const trendQty = projectedRemaining > 0 ? Math.min(projectedRemaining, metrics.recentRate * weatherFactor) : 0;
    const requiredHeadcount = metrics.productivityPerPerson > 0 ? requiredQty / metrics.productivityPerPerson : 0;
    const point: TaskChartPoint = {
      date,
      label: date.slice(5),
      actualQty: null,
      requiredQty,
      trendQty,
      actualHeadcount: null,
      requiredHeadcount,
      trendHeadcount: recentTrendHeadcount,
    };
    projectedRemaining = Math.max(0, projectedRemaining - trendQty);
    return point;
  });

  return [...history, ...forecast];
}

async function fetchWeatherForLocation(location: string): Promise<WeatherDay[]> {
  if (!location.trim()) return buildDefaultWeather();
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error("Unable to geocode location");
  const geoJson = await geoRes.json();
  const result = geoJson?.results?.[0];
  if (!result) throw new Error("Location not found");
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${result.latitude}&longitude=${result.longitude}&daily=weathercode&timezone=auto&forecast_days=16`;
  const forecastRes = await fetch(forecastUrl);
  if (!forecastRes.ok) throw new Error("Unable to load weather forecast");
  const forecastJson = await forecastRes.json();
  const dates: string[] = forecastJson?.daily?.time || [];
  const codes: number[] = forecastJson?.daily?.weathercode || [];
  const workdayDates = dates.filter((date) => isWorkday(date)).slice(0, 10);
  if (workdayDates.length === 0) return buildDefaultWeather();
  return workdayDates.map((date) => {
    const index = dates.indexOf(date);
    return {
      id: uid(),
      date,
      type: weatherCodeToType(index >= 0 ? codes[index] : 0),
      note: "",
      source: "api" as const,
    };
  });
}

function runSelfChecks() {
  const state = buildDefaultState();
  const project = state.projects[0];
  const task = project.tasks[0];
  const sanitized = sanitizeState({
    users: [{ id: "u1", name: "A", role: "Admin" }],
    projects: [{ id: "p1", tasks: [{ id: "t1", plannedQty: "abc", completeQty: -10, targetProductivityPerPerson: "bad" }], dailyEntries: [{ id: "d1", qty: Infinity, headcount: -4 }], settings: { trailingDays: -2 } }],
  });
  const appliedProject: Project = {
    ...project,
    dailyEntries: [{ id: "e1", date: todayISO(), taskId: task.id, qty: 100, headcount: 10, note: "", applied: true }],
  };
  const fallbackState = sanitizeState(null);
  const entryOnlyProject: Project = {
    ...project,
    dailyEntries: [{ id: "e2", date: todayISO(), taskId: null, qty: 100, headcount: 10, note: "", applied: true }],
  };

  if (workdaysBetween("2026-04-21", "2026-04-25") !== 5) throw new Error("Self-check failed: workdaysBetween");
  if (addWorkdays("2026-04-25", 1) !== "2026-04-27") throw new Error("Self-check failed: addWorkdays");
  if (sanitized.projects[0].tasks[0].plannedQty !== 0) throw new Error("Self-check failed: sanitize planned qty");
  if (sanitized.projects[0].dailyEntries[0].headcount !== 0) throw new Error("Self-check failed: sanitize headcount");
  if (getTaskActualComplete(appliedProject, task) !== 2450) throw new Error("Self-check failed: task actual complete");
  if (getTaskActualComplete(entryOnlyProject, task) !== 2350) throw new Error("Self-check failed: task complete ignores project-level entries");
  if (buildTaskChartData(project, task).length !== HISTORY_WORKDAYS + FORECAST_WORKDAYS) throw new Error("Self-check failed: chart data length");
  if (buildDefaultWeather().length !== 10) throw new Error("Self-check failed: default weather count");
  if (fallbackState.projects.length === 0 || fallbackState.users.length === 0) throw new Error("Self-check failed: fallback state");
  if (weatherMeta("unknown").value !== "clear") throw new Error("Self-check failed: weather fallback");
}

if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
  runSelfChecks();
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-slate-700">{label}</div>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 ${className}`} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select {...rest} className={`w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 ${className}`}>
      {children}
    </select>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={`min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 ${className}`} />;
}

function Stat({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: Tone }) {
  const toneMap: Record<Tone, string> = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
    blue: "text-blue-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneMap[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-slate-800" style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  );
}

function Card({ title, subtitle, icon: Icon, action, children }: { title: string; subtitle?: string; icon?: React.ComponentType<{ className?: string }>; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon ? <Icon className="mt-0.5 h-5 w-5 text-slate-500" /> : null}
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function WeatherCard({ day, projectId, updateProject }: { day: WeatherDay; projectId: string; updateProject: (projectId: string, updater: (project: Project) => Project) => void }) {
  return (
    <div className="grid gap-3 rounded-3xl border border-slate-200 p-4 md:grid-cols-[1fr,1fr,1.2fr,1fr] md:items-end">
      <Field label="Date">
        <Input type="date" value={day.date} onChange={(e) => updateProject(projectId, (project) => ({ ...project, weather: project.weather.map((item) => (item.id === day.id ? { ...item, date: e.target.value } : item)) }))} />
      </Field>
      <Field label="Condition">
        <Select value={day.type} onChange={(e) => updateProject(projectId, (project) => ({ ...project, weather: project.weather.map((item) => (item.id === day.id ? { ...item, type: e.target.value as WeatherType, source: "manual" } : item)) }))}>
          {WEATHER_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label} ({type.factor}x)
            </option>
          ))}
        </Select>
      </Field>
      <div className="rounded-2xl border border-slate-200 px-3 py-2.5">
        <div className="text-sm text-slate-500">Impact factor</div>
        <div className="mt-1 text-lg font-semibold">{weatherMeta(day.type).factor}x</div>
        <div className="text-xs text-slate-500">{day.source === "api" ? "From location forecast" : "Manual override"}</div>
      </div>
      <Field label="Note">
        <Input value={day.note} onChange={(e) => updateProject(projectId, (project) => ({ ...project, weather: project.weather.map((item) => (item.id === day.id ? { ...item, note: e.target.value } : item)) }))} />
      </Field>
    </div>
  );
}

function TaskTrendChart({ task, chartData, metrics }: { task: Task; chartData: TaskChartPoint[]; metrics: ReturnType<typeof getTaskMetrics> }) {
  return (
    <div className="rounded-3xl border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">{task.name}</div>
          <div className="text-sm text-slate-500">3-week workday tracker • {task.category}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={metrics.slipDays > 0 ? "red" : "green"}>{metrics.slipDays > 0 ? `${metrics.slipDays} workdays late` : "On track"}</Badge>
          <Badge tone={metrics.usingReality ? "blue" : "amber"}>{metrics.usingReality ? "Using actual productivity" : "Using target productivity"}</Badge>
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <Stat label="Complete" value={fmt(metrics.completeQty)} sub={task.unit} />
        <Stat label="Remaining" value={fmt(metrics.remainingQty)} sub={task.unit} />
        <Stat label="Required/day" value={fmt(metrics.requiredDailyRate, 1)} sub={task.unit} tone="amber" />
        <Stat label="People needed/day" value={fmt(metrics.requiredHeadcount, 1)} sub="to hit schedule" tone="blue" />
        <Stat label="Projected finish" value={metrics.projectedFinish || "—"} sub={`Target ${task.targetFinish}`} tone={metrics.slipDays > 0 ? "red" : "green"} />
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis yAxisId="qty" />
            <YAxis yAxisId="people" orientation="right" />
            <Tooltip />
            <Legend />
            <ReferenceLine yAxisId="qty" y={metrics.requiredDailyRate} strokeDasharray="4 4" />
            <Bar yAxisId="qty" dataKey="actualQty" name="Actual qty" />
            <Bar yAxisId="qty" dataKey="requiredQty" name="Required qty" />
            <Line yAxisId="qty" type="monotone" dataKey="trendQty" name="Current pace forecast" dot={false} />
            <Line yAxisId="people" type="monotone" dataKey="requiredHeadcount" name="Required people" dot={false} />
            <Line yAxisId="people" type="monotone" dataKey="trendHeadcount" name="Current people pace" dot={false} />
            <Line yAxisId="people" type="monotone" dataKey="actualHeadcount" name="Actual people" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AppShell() {
  const [data, setData] = useState<AppState>(() => loadState());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [syncMessage, setSyncMessage] = useState("Using local browser storage");
  const [syncing, setSyncing] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (activeProjectId === null && data.projects.length > 0) {
      setActiveProjectId(data.projects[0].id);
    }
  }, [activeProjectId, data.projects]);

  useEffect(() => {
    if (!data.projects.find((project) => project.id === activeProjectId)) {
      setActiveProjectId(data.projects[0]?.id || null);
    }
  }, [data.projects, activeProjectId]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setSyncing(true);
    saveLocalState(data);
    setSyncMessage("Saved locally in this browser");
    const timer = window.setTimeout(() => setSyncing(false), 250);
    return () => window.clearTimeout(timer);
  }, [data]);

  const activeProject = useMemo(() => data.projects.find((project) => project.id === activeProjectId) || data.projects[0] || null, [data.projects, activeProjectId]);
  const projectMetrics = useMemo(() => (activeProject ? getProjectMetrics(activeProject) : null), [activeProject]);

  const updateProject = (projectId: string, updater: (project: Project) => Project) => {
    setData((prev) => ({
      ...prev,
      projects: prev.projects.map((project) => (project.id === projectId ? updater(project) : project)),
    }));
  };

  const refreshWeather = async () => {
    if (!activeProject) return;
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const weather = await fetchWeatherForLocation(activeProject.location);
      updateProject(activeProject.id, (project) => ({ ...project, weather }));
    } catch (error: any) {
      setWeatherError(error?.message || "Unable to update weather");
    } finally {
      setWeatherLoading(false);
    }
  };

  const addProject = () => {
    const newProject: Project = {
      id: uid(),
      name: `New Solar Project ${data.projects.length + 1}`,
      location: "",
      status: "Active",
      startDate: todayISO(),
      targetFinish: addWorkdays(todayISO(), 20),
      weather: buildDefaultWeather(),
      tasks: [],
      dailyEntries: [],
      settings: { useWeatherInProjection: true, trailingDays: 5 },
    };
    setData((prev) => ({ ...prev, projects: [...prev.projects, newProject] }));
    setActiveProjectId(newProject.id);
    setTab("dashboard");
  };

  const removeProject = (projectId: string) => {
    setData((prev) => {
      const remainingProjects = prev.projects.filter((project) => project.id !== projectId);
      return {
        ...prev,
        projects: remainingProjects.length > 0 ? remainingProjects : [buildDefaultState().projects[0]],
      };
    });
  };

  const addUser = () => {
    setData((prev) => ({
      ...prev,
      users: [...prev.users, { id: uid(), name: `User ${prev.users.length + 1}`, role: "Editor" }],
    }));
  };

  const removeUser = (userId: string) => {
    setData((prev) => ({
      ...prev,
      users: prev.users.filter((user) => user.id !== userId),
      projects: prev.projects.map((project) => ({
        ...project,
        tasks: project.tasks.map((task) => ({
          ...task,
          assignedUserIds: task.assignedUserIds.filter((id) => id !== userId),
        })),
      })),
    }));
  };

  const addTask = () => {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      tasks: [
        ...project.tasks,
        {
          id: uid(),
          name: `New Task ${project.tasks.length + 1}`,
          category: "General",
          assignedUserIds: [],
          startDate: todayISO(),
          targetFinish: addWorkdays(todayISO(), 10),
          plannedQty: 100,
          completeQty: 0,
          unit: "units",
          active: true,
          notes: "",
          targetProductivityPerPerson: 5,
        },
      ],
    }));
  };

  const removeTask = (taskId: string) => {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      tasks: project.tasks.filter((task) => task.id !== taskId),
      dailyEntries: project.dailyEntries.filter((entry) => entry.taskId !== taskId),
    }));
  };

  const addDailyEntry = () => {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: [...project.dailyEntries, { id: uid(), date: todayISO(), taskId: project.tasks[0]?.id || null, qty: 0, headcount: 0, note: "", applied: false }],
    }));
  };

  const removeDailyEntry = (entryId: string) => {
    if (!activeProject) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: project.dailyEntries.filter((entry) => entry.id !== entryId),
    }));
  };

  const toggleApplyEntry = (entry: DailyEntry) => {
    if (!activeProject || !entry.taskId) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, applied: !item.applied } : item)),
    }));
  };

  if (!activeProject || !projectMetrics) {
    return <div className="p-6">Loading tracker...</div>;
  }

  const recommendation =
    projectMetrics.remainingQty <= 0
      ? "Project scope is fully complete against entered quantities."
      : projectMetrics.adjustedRate <= 0
        ? "No production trend detected yet. Enter daily production to generate projections."
        : projectMetrics.finishSlipDays === 0
          ? `At current adjusted pace, this project is tracking on or ahead of schedule. Maintain at least ${fmt(projectMetrics.requiredDailyRate, 1)} units/day to protect the target finish.`
          : `At the current adjusted pace, the project is projected to finish ${projectMetrics.finishSlipDays} workday(s) late. Increase average output by about ${fmt(Math.max(0, projectMetrics.requiredDailyRate - projectMetrics.adjustedRate), 1)} units/day to recover the target date.`;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="mb-6 grid gap-4 lg:grid-cols-[280px,1fr]">
          <aside className="rounded-3xl bg-slate-900 p-4 text-white shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Power Progress</div>
                <div className="text-xl font-semibold">Solar Tracker</div>
              </div>
              <button onClick={addProject} className="rounded-2xl bg-white/10 p-2 hover:bg-white/20">
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <DatabaseIcon className="h-4 w-4" />
                Local mode
              </div>
              <div className="mt-1 text-xs text-slate-300">{syncMessage}</div>
              {syncing ? <div className="mt-2 text-xs text-slate-400">Saving changes...</div> : null}
            </div>
            <div className="space-y-2">
              {data.projects.map((project) => (
                <button key={project.id} onClick={() => setActiveProjectId(project.id)} className={`w-full rounded-2xl border px-3 py-3 text-left transition ${project.id === activeProjectId ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{project.name}</div>
                      <div className="mt-1 text-xs text-slate-300">{project.location || "No location set"}</div>
                    </div>
                    {data.projects.length > 1 ? (
                      <span onClick={(e) => {
                        e.stopPropagation();
                        removeProject(project.id);
                      }} className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white">
                        <Trash2Icon className="h-4 w-4" />
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="space-y-4">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <CheckCircle2Icon className="h-4 w-4" />
                    Superintendent schedule and production intelligence
                  </div>
                  <h1 className="mt-1 text-3xl font-semibold tracking-tight">{activeProject.name}</h1>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone="blue">{activeProject.status}</Badge>
                    <Badge>{activeProject.location || "Location not set"}</Badge>
                    <Badge>{activeProject.startDate} → {activeProject.targetFinish}</Badge>
                    <Badge tone="amber">5-day workweek</Badge>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:w-[520px]">
                  <Field label="Project name">
                    <Input value={activeProject.name} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, name: e.target.value }))} />
                  </Field>
                  <Field label="Location">
                    <Input value={activeProject.location} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, location: e.target.value }))} />
                  </Field>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["dashboard", "tasks", "entries", "weather", "users", "settings"] as TabKey[]).map((name) => (
                <button key={name} onClick={() => setTab(name)} className={`rounded-2xl px-4 py-2 text-sm font-medium capitalize ${tab === name ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
                  {name}
                </button>
              ))}
            </div>

            {tab === "dashboard" ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <Stat label="Planned Quantity" value={fmt(projectMetrics.plannedQty)} sub="All project tasks" />
                  <Stat label="Completed Quantity" value={fmt(projectMetrics.completeQty)} sub={`${fmt(projectMetrics.percentComplete, 1)}% complete`} tone="blue" />
                  <Stat label="Recent Daily Rate" value={fmt(projectMetrics.recentRate, 1)} sub={`Trailing ${activeProject.settings.trailingDays} workdays`} />
                  <Stat label="Weather-Adjusted Rate" value={fmt(projectMetrics.adjustedRate, 1)} sub="Forecast-adjusted" tone="amber" />
                  <Stat label="Required Rate" value={fmt(projectMetrics.requiredDailyRate, 1)} sub="Needed to hit target" tone={projectMetrics.adjustedRate >= projectMetrics.requiredDailyRate ? "green" : "red"} />
                </div>

                <Card title="Progress against schedule" subtitle="Reality vs target finish" icon={BarChart3Icon}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm text-slate-500">Overall completion</div>
                      <div className="mt-2">
                        <ProgressBar value={projectMetrics.percentComplete} />
                      </div>
                      <div className="mt-2 text-sm text-slate-600">{fmt(projectMetrics.completeQty)} of {fmt(projectMetrics.plannedQty)} complete</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-sm text-slate-500">Projected finish</div>
                      <div className="mt-2 text-2xl font-semibold">{projectMetrics.projectedFinish || "Waiting on data"}</div>
                      <div className="mt-2 text-sm text-slate-600">Target finish: {activeProject.targetFinish}</div>
                    </div>
                  </div>
                  <div className={`mt-4 rounded-2xl border p-4 ${projectMetrics.finishSlipDays > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                    <div className="flex items-start gap-3">
                      {projectMetrics.finishSlipDays > 0 ? <AlertTriangleIcon className="mt-0.5 h-5 w-5 text-red-600" /> : <CheckCircle2Icon className="mt-0.5 h-5 w-5 text-emerald-600" />}
                      <div>
                        <div className="font-semibold text-slate-900">{projectMetrics.finishSlipDays > 0 ? `Projected slip: ${projectMetrics.finishSlipDays} workday(s)` : "Tracking on schedule"}</div>
                        <p className="mt-1 text-sm text-slate-700">{recommendation}</p>
                      </div>
                    </div>
                  </div>
                </Card>

                <div className="space-y-4">
                  {activeProject.tasks.map((task) => (
                    <TaskTrendChart key={task.id} task={task} chartData={buildTaskChartData(activeProject, task)} metrics={getTaskMetrics(activeProject, task)} />
                  ))}
                </div>
              </div>
            ) : null}

            {tab === "tasks" ? (
              <Card title="Task management" subtitle="Per-project quantity, dates, ownership, and target productivity" icon={ClipboardListIcon} action={<button onClick={addTask} className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"><PlusIcon className="mr-1 inline h-4 w-4" />Add task</button>}>
                <div className="space-y-4">
                  {activeProject.tasks.map((task) => {
                    const metrics = getTaskMetrics(activeProject, task);
                    return (
                      <div key={task.id} className="rounded-3xl border border-slate-200 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-lg font-semibold">{task.name}</div>
                            <div className="text-sm text-slate-500">Track quantities, dates, and target productivity</div>
                          </div>
                          <button onClick={() => removeTask(task.id)} className="rounded-2xl border border-slate-200 p-2 hover:bg-slate-50">
                            <Trash2Icon className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <Field label="Task name"><Input value={task.name} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, name: e.target.value } : item)) }))} /></Field>
                          <Field label="Category"><Input value={task.category} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, category: e.target.value } : item)) }))} /></Field>
                          <Field label="Planned quantity"><Input type="number" value={task.plannedQty} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, plannedQty: safeNonNegativeNumber(e.target.value, 0) } : item)) }))} /></Field>
                          <Field label="Baseline complete"><Input type="number" value={task.completeQty} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, completeQty: safeNonNegativeNumber(e.target.value, 0) } : item)) }))} /></Field>
                          <Field label="Unit"><Input value={task.unit} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, unit: e.target.value } : item)) }))} /></Field>
                          <Field label="Start date"><Input type="date" value={task.startDate} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, startDate: e.target.value } : item)) }))} /></Field>
                          <Field label="Target finish"><Input type="date" value={task.targetFinish} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, targetFinish: e.target.value } : item)) }))} /></Field>
                          <Field label="Target productivity / person / day"><Input type="number" step="0.1" value={task.targetProductivityPerPerson} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, targetProductivityPerPerson: Math.max(0.01, safeNonNegativeNumber(e.target.value, 0.01)) } : item)) }))} /></Field>
                        </div>
                        <div className="mt-3"><Field label="Notes"><TextArea value={task.notes} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, tasks: project.tasks.map((item) => (item.id === task.id ? { ...item, notes: e.target.value } : item)) }))} /></Field></div>
                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                          <Stat label="Complete" value={`${fmt(metrics.completeQty)} ${task.unit}`} />
                          <Stat label="Remaining" value={`${fmt(metrics.remainingQty)} ${task.unit}`} />
                          <Stat label="People needed/day" value={fmt(metrics.requiredHeadcount, 1)} sub={metrics.usingReality ? "based on recent reality" : "based on target productivity"} tone="blue" />
                          <Stat label="Projected finish" value={metrics.projectedFinish || "—"} sub={metrics.slipDays > 0 ? `${metrics.slipDays} workdays late` : "On track"} tone={metrics.slipDays > 0 ? "red" : "green"} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {tab === "entries" ? (
              <Card title="Daily production entries" subtitle="Enter daily production and headcount, then apply it to task progress" icon={CalendarDaysIcon} action={<button onClick={addDailyEntry} className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"><PlusIcon className="mr-1 inline h-4 w-4" />Add entry</button>}>
                <div className="space-y-4">
                  {[...activeProject.dailyEntries].sort((a, b) => a.date.localeCompare(b.date)).reverse().map((entry) => (
                    <div key={entry.id} className="grid gap-3 rounded-3xl border border-slate-200 p-4 lg:grid-cols-[1fr,1fr,1fr,1fr,1.2fr,auto,auto] lg:items-end">
                      <Field label="Date"><Input type="date" value={entry.date} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, date: e.target.value } : item)) }))} /></Field>
                      <Field label="Task"><Select value={entry.taskId || "all"} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, taskId: e.target.value === "all" ? null : e.target.value, applied: false } : item)) }))}><option value="all">Project-level only</option>{activeProject.tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</Select></Field>
                      <Field label="Quantity"><Input type="number" value={entry.qty} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, qty: safeNonNegativeNumber(e.target.value, 0) } : item)) }))} /></Field>
                      <Field label="Headcount"><Input type="number" value={entry.headcount} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, headcount: safeNonNegativeNumber(e.target.value, 0) } : item)) }))} /></Field>
                      <Field label="Notes"><Input value={entry.note} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, dailyEntries: project.dailyEntries.map((item) => (item.id === entry.id ? { ...item, note: e.target.value } : item)) }))} /></Field>
                      <button onClick={() => toggleApplyEntry(entry)} disabled={!entry.taskId} className={`rounded-2xl px-3 py-2.5 text-sm font-medium ${!entry.taskId ? "cursor-not-allowed border border-slate-200 text-slate-400" : entry.applied ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
                        {entry.applied ? "Applied" : "Apply"}
                      </button>
                      <button onClick={() => removeDailyEntry(entry.id)} className="rounded-2xl border border-slate-200 px-3 py-2.5 text-sm font-medium hover:bg-slate-50">
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {tab === "weather" ? (
              <Card title="10-day weather cycle" subtitle="Pulled from project location, with manual override available" icon={CloudRainIcon} action={<button onClick={refreshWeather} disabled={weatherLoading} className={`rounded-2xl px-3 py-2 text-sm font-medium ${weatherLoading ? "border border-slate-200 text-slate-400" : "bg-slate-900 text-white"}`}><RefreshCwIcon className={`mr-1 inline h-4 w-4 ${weatherLoading ? "animate-spin" : ""}`} />Refresh</button>}>
                {weatherError ? <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{weatherError}</div> : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {activeProject.weather.map((day) => (
                    <WeatherCard key={day.id} day={day} projectId={activeProject.id} updateProject={updateProject} />
                  ))}
                </div>
              </Card>
            ) : null}

            {tab === "users" ? (
              <Card title="Users and roles" subtitle="Assign who can own tasks or update the tracker" icon={UsersIcon} action={<button onClick={addUser} className="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"><PlusIcon className="mr-1 inline h-4 w-4" />Add user</button>}>
                <div className="grid gap-3 md:grid-cols-2">
                  {data.users.map((user) => (
                    <div key={user.id} className="rounded-3xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">{user.name}</div>
                          <div className="text-sm text-slate-500">{user.role}</div>
                        </div>
                        <button onClick={() => removeUser(user.id)} className="rounded-2xl border border-slate-200 p-2 hover:bg-slate-50">
                          <Trash2Icon className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Name"><Input value={user.name} onChange={(e) => setData((prev) => ({ ...prev, users: prev.users.map((item) => (item.id === user.id ? { ...item, name: e.target.value } : item)) }))} /></Field>
                        <Field label="Role"><Select value={user.role} onChange={(e) => setData((prev) => ({ ...prev, users: prev.users.map((item) => (item.id === user.id ? { ...item, role: e.target.value as UserRole } : item)) }))}><option value="Admin">Admin</option><option value="Editor">Editor</option><option value="Viewer">Viewer</option></Select></Field>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {tab === "settings" ? (
              <Card title="Program settings" subtitle="Tune forecasting and persistence behavior" icon={Edit3Icon}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Project start date"><Input type="date" value={activeProject.startDate} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, startDate: e.target.value }))} /></Field>
                  <Field label="Target finish"><Input type="date" value={activeProject.targetFinish} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, targetFinish: e.target.value }))} /></Field>
                  <Field label="Project status"><Select value={activeProject.status} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, status: e.target.value }))}><option value="Active">Active</option><option value="Delayed">Delayed</option><option value="Complete">Complete</option></Select></Field>
                  <Field label="Trailing workdays used for recent reality"><Input type="number" min="1" value={activeProject.settings.trailingDays} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, settings: { ...project.settings, trailingDays: safePositiveInteger(e.target.value, 5) } }))} /></Field>
                </div>
                <label className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 p-3">
                  <div>
                    <div className="font-medium">Use weather in projection</div>
                    <div className="text-sm text-slate-500">Apply the 10-day forecast to forward-looking production and finish dates.</div>
                  </div>
                  <input type="checkbox" checked={activeProject.settings.useWeatherInProjection} onChange={(e) => updateProject(activeProject.id, (project) => ({ ...project, settings: { ...project.settings, useWeatherInProjection: e.target.checked } }))} />
                </label>
              </Card>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function SolarProgressTrackerApp() {
  return <AppShell />;
}

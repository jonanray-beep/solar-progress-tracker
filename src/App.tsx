import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const STORAGE_KEY = "solar-progress-tracker-web-v54";
const SHARED_STATE_ROW_ID = "global-shared-state";
const AUTH_REDIRECT_URL = typeof window !== "undefined" ? window.location.origin : undefined;

type UserRole = "Admin" | "Editor" | "Viewer";
type WeatherType = "clear" | "cloudy" | "wind" | "rain" | "storm" | "snow";
type TabKey = "dashboard" | "tasks" | "entries" | "weather" | "users" | "settings";

type AppUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type Task = {
  id: string;
  name: string;
  category: string;
  startDate: string;
  targetFinish: string;
  plannedQty: number;
  baselineCompleteQty: number;
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
  users: AppUser[];
  projects: Project[];
};

type SharedStateRow = {
  id: string;
  payload: AppState;
  updated_at?: string;
};

const WEATHER_TYPES: Array<{ value: WeatherType; label: string; factor: number }> = [
  { value: "clear", label: "Clear", factor: 1 },
  { value: "cloudy", label: "Cloudy", factor: 0.95 },
  { value: "wind", label: "Wind", factor: 0.8 },
  { value: "rain", label: "Rain", factor: 0.55 },
  { value: "storm", label: "Storm", factor: 0.2 },
  { value: "snow", label: "Snow/Ice", factor: 0.15 },
];

function readEnvValue(key: string): string | undefined {
  try {
    const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
    return meta.env?.[key];
  } catch {
    return undefined;
  }
}

const SUPABASE_URL = readEnvValue("VITE_SUPABASE_URL");
const SUPABASE_ANON_KEY = readEnvValue("VITE_SUPABASE_ANON_KEY");

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 12);
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

function getNextWorkdays(startDate: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = startDate;
  while (dates.length < count) {
    if (isWorkday(cursor)) dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
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

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function avg(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function fmt(value: number, digits = 0): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "0";
}

function weatherMeta(type: string) {
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
    type: index < 4 ? "clear" : index < 7 ? "cloudy" : "rain",
    note: "",
    source: "manual",
  }));
}

function buildDefaultState(): AppState {
  return {
    users: [
      { id: uid(), name: "Superintendent", email: "", role: "Admin" },
      { id: uid(), name: "Project Engineer", email: "", role: "Editor" },
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
            startDate: addDays(todayISO(), -14),
            targetFinish: addWorkdays(todayISO(), 10),
            plannedQty: 5000,
            baselineCompleteQty: 2350,
            unit: "piles",
            active: true,
            notes: "Mainline tracker task",
            targetProductivityPerPerson: 12,
          },
          {
            id: uid(),
            name: "Table Build",
            category: "Mechanical",
            startDate: addDays(todayISO(), -10),
            targetFinish: addWorkdays(todayISO(), 20),
            plannedQty: 2000,
            baselineCompleteQty: 620,
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
  if (!Array.isArray(raw.users) || !Array.isArray(raw.projects)) return fallback;

  return {
    users: raw.users.map((user: any) => ({
      id: typeof user?.id === "string" ? user.id : uid(),
      name: typeof user?.name === "string" ? user.name : "User",
      email: typeof user?.email === "string" ? user.email : "",
      role:
        user?.role === "Admin" || user?.role === "Editor" || user?.role === "Viewer"
          ? user.role
          : "Editor",
    })),
    projects: raw.projects.map((project: any) => ({
      id: typeof project?.id === "string" ? project.id : uid(),
      name: typeof project?.name === "string" ? project.name : "Untitled Project",
      location: typeof project?.location === "string" ? project.location : "",
      status: typeof project?.status === "string" ? project.status : "Active",
      startDate: typeof project?.startDate === "string" ? project.startDate : todayISO(),
      targetFinish:
        typeof project?.targetFinish === "string" ? project.targetFinish : addWorkdays(todayISO(), 20),
      weather:
        Array.isArray(project?.weather) && project.weather.length > 0
          ? project.weather.map((day: any, index: number) => ({
              id: typeof day?.id === "string" ? day.id : uid(),
              date:
                typeof day?.date === "string"
                  ? day.date
                  : getNextWorkdays(todayISO(), 10)[index] || todayISO(),
              type: weatherMeta(day?.type).value,
              note: typeof day?.note === "string" ? day.note : "",
              source: day?.source === "api" ? "api" : "manual",
            }))
          : buildDefaultWeather(),
      tasks: Array.isArray(project?.tasks)
        ? project.tasks.map((task: any) => ({
            id: typeof task?.id === "string" ? task.id : uid(),
            name: typeof task?.name === "string" ? task.name : "Task",
            category: typeof task?.category === "string" ? task.category : "General",
            startDate: typeof task?.startDate === "string" ? task.startDate : todayISO(),
            targetFinish:
              typeof task?.targetFinish === "string" ? task.targetFinish : addWorkdays(todayISO(), 10),
            plannedQty: safeNonNegativeNumber(task?.plannedQty, 0),
            baselineCompleteQty: safeNonNegativeNumber(task?.baselineCompleteQty ?? task?.completeQty, 0),
            unit: typeof task?.unit === "string" ? task.unit : "units",
            active: task?.active !== false,
            notes: typeof task?.notes === "string" ? task.notes : "",
            targetProductivityPerPerson: Math.max(
              0.01,
              safeNonNegativeNumber(task?.targetProductivityPerPerson, 1),
            ),
          }))
        : [],
      dailyEntries: Array.isArray(project?.dailyEntries)
        ? project.dailyEntries.map((entry: any) => ({
            id: typeof entry?.id === "string" ? entry.id : uid(),
            date: typeof entry?.date === "string" ? entry.date : todayISO(),
            taskId: typeof entry?.taskId === "string" ? entry.taskId : null,
            qty: safeNonNegativeNumber(entry?.qty, 0),
            headcount: safeNonNegativeNumber(entry?.headcount, 0),
            note: typeof entry?.note === "string" ? entry.note : "",
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

function loadLocalState(): AppState {
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
    // localStorage can fail in sandbox/private contexts.
  }
}

function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

async function loadRemoteState(client: SupabaseClient): Promise<AppState | null> {
  const { data, error } = await client
    .from("app_state")
    .select("id,payload,updated_at")
    .eq("id", SHARED_STATE_ROW_ID)
    .maybeSingle<SharedStateRow>();
  if (error) throw error;
  if (!data?.payload) return null;
  return sanitizeState(data.payload);
}

async function saveRemoteState(client: SupabaseClient, state: AppState): Promise<void> {
  const { error } = await client
    .from("app_state")
    .upsert({ id: SHARED_STATE_ROW_ID, payload: sanitizeState(state) });
  if (error) throw error;
}

function getTaskAppliedQty(project: Project, taskId: string): number {
  return sum(
    project.dailyEntries
      .filter((entry) => entry.applied && entry.taskId === taskId)
      .map((entry) => safeNonNegativeNumber(entry.qty, 0)),
  );
}

function getTaskCompleteQty(project: Project, task: Task): number {
  return safeNonNegativeNumber(task.baselineCompleteQty, 0) + getTaskAppliedQty(project, task.id);
}

function getTaskTrailingEntries(project: Project, taskId: string): DailyEntry[] {
  return [...project.dailyEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((entry) => entry.applied && entry.taskId === taskId && isWorkday(entry.date))
    .slice(-project.settings.trailingDays);
}

function getProjectTrailingEntries(project: Project): DailyEntry[] {
  return [...project.dailyEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((entry) => entry.applied && isWorkday(entry.date))
    .slice(-project.settings.trailingDays);
}

function getRecentRate(entries: DailyEntry[]): number {
  return avg(entries.map((entry) => safeNonNegativeNumber(entry.qty, 0)));
}

function getRecentHeadcount(entries: DailyEntry[]): number {
  return avg(entries.map((entry) => safeNonNegativeNumber(entry.headcount, 0)).filter((value) => value > 0));
}

function getRecentProductivityPerPerson(entries: DailyEntry[]): number {
  const productive = entries.filter((entry) => entry.headcount > 0);
  if (productive.length < 3) return 0;
  const qty = sum(productive.map((entry) => entry.qty));
  const headcount = sum(productive.map((entry) => entry.headcount));
  return headcount > 0 ? qty / headcount : 0;
}

function getWeatherFactorByDate(project: Project, date: string): number {
  if (!project.settings.useWeatherInProjection) return 1;
  const match = project.weather.find((day) => day.date === date);
  return match ? weatherMeta(match.type).factor : 1;
}

function forecastFinishDate(args: {
  startDate: string;
  targetFinish: string;
  remainingQty: number;
  dailyRate: number;
  project: Project;
}) {
  const { startDate, targetFinish, remainingQty, dailyRate, project } = args;
  if (remainingQty <= 0) return { projectedFinish: startDate, adjustedAverageRate: dailyRate, slipDays: 0 };
  if (dailyRate <= 0) return { projectedFinish: null as string | null, adjustedAverageRate: 0, slipDays: 0 };

  let cursor = startDate;
  let remaining = remainingQty;
  let daysUsed = 0;
  let adjustedOutputTotal = 0;
  const maxDays = 365;

  while (remaining > 0 && daysUsed < maxDays) {
    if (isWorkday(cursor)) {
      const adjustedOutput = dailyRate * getWeatherFactorByDate(project, cursor);
      remaining -= adjustedOutput;
      adjustedOutputTotal += adjustedOutput;
      daysUsed += 1;
    }
    if (remaining > 0) cursor = addDays(cursor, 1);
  }

  const projectedFinish = daysUsed >= maxDays ? null : cursor;
  const adjustedAverageRate = daysUsed > 0 ? adjustedOutputTotal / daysUsed : dailyRate;
  const slipDays = projectedFinish ? Math.max(0, workdaysBetween(targetFinish, projectedFinish) - 1) : 0;
  return { projectedFinish, adjustedAverageRate, slipDays };
}

function getProjectMetrics(project: Project) {
  const plannedQty = sum(project.tasks.map((task) => safeNonNegativeNumber(task.plannedQty, 0)));
  const completeQty = sum(project.tasks.map((task) => getTaskCompleteQty(project, task)));
  const remainingQty = Math.max(0, plannedQty - completeQty);
  const recentRate = getRecentRate(getProjectTrailingEntries(project));
  const forecast = forecastFinishDate({
    startDate: todayISO(),
    targetFinish: project.targetFinish,
    remainingQty,
    dailyRate: recentRate,
    project,
  });
  const workdaysRemaining = workdaysBetween(todayISO(), project.targetFinish);
  const requiredDailyRate = workdaysRemaining > 0 ? remainingQty / workdaysRemaining : remainingQty;
  const percentComplete = plannedQty > 0 ? (completeQty / plannedQty) * 100 : 0;
  return {
    plannedQty,
    completeQty,
    remainingQty,
    recentRate,
    adjustedRate: forecast.adjustedAverageRate,
    requiredDailyRate,
    projectedFinish: forecast.projectedFinish,
    finishSlipDays: forecast.slipDays,
    percentComplete,
  };
}

function getTaskMetrics(project: Project, task: Task) {
  const entries = getTaskTrailingEntries(project, task.id);
  const completeQty = getTaskCompleteQty(project, task);
  const remainingQty = Math.max(0, task.plannedQty - completeQty);
  const recentRate = getRecentRate(entries);
  const recentHeadcount = getRecentHeadcount(entries);
  const recentProductivity = getRecentProductivityPerPerson(entries);
  const productivityPerPerson = recentProductivity > 0 ? recentProductivity : Math.max(task.targetProductivityPerPerson, 0.01);
  const usingReality = recentProductivity > 0;
  const workdaysRemaining = workdaysBetween(todayISO(), task.targetFinish);
  const requiredDailyRate = workdaysRemaining > 0 ? remainingQty / workdaysRemaining : remainingQty;
  const requiredHeadcount = productivityPerPerson > 0 ? requiredDailyRate / productivityPerPerson : 0;
  const forecast = forecastFinishDate({
    startDate: todayISO(),
    targetFinish: task.targetFinish,
    remainingQty,
    dailyRate: recentRate,
    project,
  });
  return {
    completeQty,
    remainingQty,
    recentRate,
    recentHeadcount,
    adjustedRate: forecast.adjustedAverageRate,
    requiredDailyRate,
    requiredHeadcount,
    projectedFinish: forecast.projectedFinish,
    slipDays: forecast.slipDays,
    productivityPerPerson,
    usingReality,
  };
}

function buildTaskChartData(project: Project, task: Task) {
  const taskEntries = getTaskTrailingEntries(project, task.id);
  const pastDates = getNextWorkdays(addDays(todayISO(), -14), 10)
    .filter((date) => date <= todayISO())
    .slice(-5);
  const futureDates = getNextWorkdays(todayISO(), 15);
  const metrics = getTaskMetrics(project, task);
  let projectedRemaining = metrics.remainingQty;

  const history = pastDates.map((date) => {
    const entry = taskEntries.find((item) => item.date === date);
    return {
      date,
      label: date.slice(5),
      actualQty: entry ? entry.qty : 0,
      actualHeadcount: entry ? entry.headcount : 0,
      requiredQty: null as number | null,
      trendQty: null as number | null,
      requiredHeadcount: null as number | null,
    };
  });

  const forecast = futureDates.map((date) => {
    const weatherFactor = getWeatherFactorByDate(project, date);
    const workdaysLeft = Math.max(1, workdaysBetween(date, task.targetFinish));
    const requiredQty = projectedRemaining > 0 ? projectedRemaining / workdaysLeft : 0;
    const trendQty = projectedRemaining > 0 ? Math.min(projectedRemaining, metrics.recentRate * weatherFactor) : 0;
    const requiredHeadcount = metrics.productivityPerPerson > 0 ? requiredQty / metrics.productivityPerPerson : 0;
    projectedRemaining = Math.max(0, projectedRemaining - trendQty);
    return {
      date,
      label: date.slice(5),
      actualQty: null as number | null,
      actualHeadcount: null as number | null,
      requiredQty,
      trendQty,
      requiredHeadcount,
    };
  });

  return [...history, ...forecast];
}

async function fetchWeatherForLocation(location: string): Promise<WeatherDay[]> {
  if (!location.trim()) return buildDefaultWeather();
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) throw new Error("Unable to geocode location.");
  const geoJson = await geoRes.json();
  const result = geoJson?.results?.[0];
  if (!result) throw new Error("Location not found.");
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${result.latitude}&longitude=${result.longitude}&daily=weathercode&timezone=auto&forecast_days=16`;
  const forecastRes = await fetch(forecastUrl);
  if (!forecastRes.ok) throw new Error("Unable to load weather forecast.");
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
      source: "api",
    };
  });
}

function runSelfTests() {
  if (readEnvValue("THIS_ENV_KEY_SHOULD_NOT_EXIST") !== undefined) {
    throw new Error("Self-test failed: env fallback");
  }
  if (workdaysBetween("2026-04-20", "2026-04-24") !== 5) {
    throw new Error("Self-test failed: workdaysBetween");
  }
  if (addWorkdays("2026-04-25", 1) !== "2026-04-27") {
    throw new Error("Self-test failed: addWorkdays");
  }

  const state = buildDefaultState();
  const project = state.projects[0];
  const task = project.tasks[0];
  const testProject: Project = {
    ...project,
    settings: { ...project.settings, trailingDays: 10 },
    dailyEntries: [
      { id: "entry-1", date: "2026-04-20", taskId: task.id, qty: 100, headcount: 10, note: "", applied: true },
      { id: "entry-2", date: "2026-04-21", taskId: task.id, qty: 999, headcount: 20, note: "", applied: false },
      { id: "entry-3", date: "2026-04-22", taskId: null, qty: 50, headcount: 5, note: "", applied: true },
      { id: "entry-4", date: "2026-04-23", taskId: null, qty: 500, headcount: 5, note: "", applied: false },
    ],
  };
  if (getTaskCompleteQty(testProject, task) !== task.baselineCompleteQty + 100) {
    throw new Error("Self-test failed: applied entries only");
  }
  if (getTaskTrailingEntries(testProject, task.id).length !== 1) {
    throw new Error("Self-test failed: task trailing entries");
  }
  if (getProjectTrailingEntries(testProject).length !== 2) {
    throw new Error("Self-test failed: project trailing entries");
  }
  if (sanitizeState({ users: [], projects: [] }).users.length !== 0) {
    throw new Error("Self-test failed: preserve empty arrays");
  }
}

try {
  runSelfTests();
} catch (error) {
  console.error(error);
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
  return (
    <input
      {...rest}
      className={`w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 disabled:bg-slate-100 disabled:text-slate-500 ${className}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", children, ...rest } = props;
  return (
    <select
      {...rest}
      className={`w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 disabled:bg-slate-100 disabled:text-slate-500 ${className}`}
    >
      {children}
    </select>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`min-h-[90px] w-full rounded-2xl border border-slate-300 px-3 py-2.5 outline-none transition focus:border-slate-500 disabled:bg-slate-100 disabled:text-slate-500 ${className}`}
    />
  );
}

function Button({
  children,
  onClick,
  disabled,
  danger,
  secondary,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  secondary?: boolean;
  type?: "button" | "submit";
}) {
  const base = "rounded-2xl px-4 py-2 text-sm font-medium transition";
  let style = "bg-slate-900 text-white hover:bg-slate-700";
  if (secondary) style = "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  if (danger) style = "bg-red-600 text-white hover:bg-red-700";
  if (disabled) style = "cursor-not-allowed border border-slate-200 bg-white text-slate-400";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${style}`}>
      {children}
    </button>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const colors = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
    blue: "text-blue-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${colors[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Badge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber" | "red" | "blue";
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-100 text-emerald-700 border-emerald-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${colors[tone]}`}>
      {children}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-slate-900" style={{ width: `${width}%` }} />
    </div>
  );
}

function AuthScreen(props: {
  loading: boolean;
  mode: "signin" | "signup";
  setMode: React.Dispatch<React.SetStateAction<"signin" | "signup">>;
  email: string;
  setEmail: React.Dispatch<React.SetStateAction<string>>;
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => Promise<void>;
  message: string;
}) {
  const { loading, mode, setMode, email, setEmail, password, setPassword, onSubmit, message } = props;
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Power Progress</div>
          <h1 className="mt-2 text-3xl font-semibold">Solar Tracker Login</h1>
          <p className="mt-2 text-sm text-slate-500">Sign in with your approved email and password.</p>
        </div>
        <div className="mb-4 flex gap-2">
          <Button secondary={mode !== "signin"} onClick={() => setMode("signin")}>
            Sign in
          </Button>
          <Button secondary={mode !== "signup"} onClick={() => setMode("signup")}>
            Create account
          </Button>
        </div>
        <div className="space-y-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button disabled={loading || !email || !password} onClick={() => void onSubmit()}>
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          {message ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const [data, setData] = useState<AppState>(() => loadLocalState());
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [remoteReady, setRemoteReady] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [syncMessage, setSyncMessage] = useState("Using local browser storage");
  const [syncing, setSyncing] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const supabaseRef = useRef<SupabaseClient | null>(getSupabaseClient());
  const mountedRef = useRef(false);
  const lastSavedJsonRef = useRef("");

  useEffect(() => {
    const client = supabaseRef.current;
    if (!client) {
      setAuthChecked(true);
      setRemoteReady(true);
      return;
    }
    client.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session ?? null);
      setAuthChecked(true);
    });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setAuthChecked(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const currentEmail = session?.user?.email?.toLowerCase() || "";
  const hasConfiguredEmails = data.users.some((user) => user.email.trim().length > 0);
  const currentUser = data.users.find((user) => user.email.toLowerCase() === currentEmail);
  const currentRole: UserRole = supabaseRef.current
    ? !hasConfiguredEmails
      ? "Admin"
      : currentUser?.role || "Viewer"
    : "Admin";
  const isAdmin = currentRole === "Admin";
  const canEdit = currentRole === "Admin" || currentRole === "Editor";

  useEffect(() => {
    let cancelled = false;
    const client = supabaseRef.current;
    if (!client) {
      setSyncMessage("Using local browser storage");
      setRemoteReady(true);
      return;
    }
    if (!session) {
      setRemoteReady(false);
      return;
    }
    setSyncMessage("Connecting to shared database...");
    loadRemoteState(client)
      .then((remoteState) => {
        if (cancelled) return;
        if (remoteState) {
          setData(remoteState);
          saveLocalState(remoteState);
          lastSavedJsonRef.current = JSON.stringify(remoteState);
          setSyncMessage("Connected to shared database");
        } else {
          const initial = loadLocalState();
          return saveRemoteState(client, initial).then(() => {
            if (cancelled) return;
            lastSavedJsonRef.current = JSON.stringify(initial);
            setSyncMessage("Shared database initialized");
          });
        }
      })
      .catch(() => {
        if (!cancelled) setSyncMessage("Shared database unavailable, using local storage");
      })
      .finally(() => {
        if (!cancelled) setRemoteReady(true);
      });

    const channel = client
      .channel("shared-app-state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_state", filter: `id=eq.${SHARED_STATE_ROW_ID}` },
        (payload) => {
          const incoming = payload.new as SharedStateRow | undefined;
          if (!incoming?.payload) return;
          const sanitized = sanitizeState(incoming.payload);
          const incomingJson = JSON.stringify(sanitized);
          if (incomingJson === lastSavedJsonRef.current) return;
          lastSavedJsonRef.current = incomingJson;
          setData(sanitized);
          saveLocalState(sanitized);
          setSyncMessage("Synced from shared database");
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => {
    if (activeProjectId === null && data.projects.length > 0) setActiveProjectId(data.projects[0].id);
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
    saveLocalState(data);
    const json = JSON.stringify(data);
    if (json === lastSavedJsonRef.current) {
      setSyncing(false);
      return;
    }
    const client = supabaseRef.current;
    if (!client || !remoteReady || !session) {
      lastSavedJsonRef.current = json;
      setSyncMessage("Saved locally in this browser");
      setSyncing(false);
      return;
    }
    let cancelled = false;
    setSyncing(true);
    saveRemoteState(client, data)
      .then(() => {
        if (cancelled) return;
        lastSavedJsonRef.current = json;
        setSyncMessage("Saved to shared database");
      })
      .catch(() => {
        if (!cancelled) setSyncMessage("Shared save failed, kept local copy");
      })
      .finally(() => {
        if (!cancelled) window.setTimeout(() => setSyncing(false), 250);
      });
    return () => {
      cancelled = true;
    };
  }, [data, remoteReady, session]);

  const activeProject = useMemo(
    () => data.projects.find((project) => project.id === activeProjectId) || data.projects[0] || null,
    [data.projects, activeProjectId],
  );

  const projectMetrics = useMemo(
    () => (activeProject ? getProjectMetrics(activeProject) : null),
    [activeProject],
  );

  function updateProject(projectId: string, updater: (project: Project) => Project) {
    if (!canEdit) return;
    setData((prev) => ({
      ...prev,
      projects: prev.projects.map((project) => (project.id === projectId ? updater(project) : project)),
    }));
  }

  async function handleAuthSubmit() {
    const client = supabaseRef.current;
    if (!client) {
      setAuthMessage(
        "Supabase auth is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login, or use local mode without them.",
      );
      return;
    }
    setAuthLoading(true);
    setAuthMessage("");
    try {
      if (authMode === "signup") {
        const { error } = await client.auth.signUp({
          email: authEmail,
          password: authPassword,
          options: AUTH_REDIRECT_URL ? { emailRedirectTo: AUTH_REDIRECT_URL } : undefined,
        });
        if (error) throw error;
        setAuthMessage("Account created. Check your email if confirmation is required, then sign in.");
        setAuthMode("signin");
      } else {
        const { error } = await client.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
        setAuthMessage("");
      }
    } catch (error: any) {
      setAuthMessage(error?.message || "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    const client = supabaseRef.current;
    if (!client) return;
    await client.auth.signOut();
  }

  function addProject() {
    if (!canEdit) return;
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
  }

  function removeProject(projectId: string) {
    if (!isAdmin) return;
    setData((prev) => {
      const remainingProjects = prev.projects.filter((project) => project.id !== projectId);
      return {
        ...prev,
        projects: remainingProjects.length > 0 ? remainingProjects : [buildDefaultState().projects[0]],
      };
    });
  }

  function addTask() {
    if (!activeProject || !canEdit) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      tasks: [
        ...project.tasks,
        {
          id: uid(),
          name: `New Task ${project.tasks.length + 1}`,
          category: "General",
          startDate: todayISO(),
          targetFinish: addWorkdays(todayISO(), 10),
          plannedQty: 100,
          baselineCompleteQty: 0,
          unit: "units",
          active: true,
          notes: "",
          targetProductivityPerPerson: 5,
        },
      ],
    }));
  }

  function removeTask(taskId: string) {
    if (!activeProject || !isAdmin) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      tasks: project.tasks.filter((task) => task.id !== taskId),
      dailyEntries: project.dailyEntries.filter((entry) => entry.taskId !== taskId),
    }));
  }

  function addDailyEntry() {
    if (!activeProject || !canEdit) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: [
        ...project.dailyEntries,
        {
          id: uid(),
          date: todayISO(),
          taskId: project.tasks[0]?.id || null,
          qty: 0,
          headcount: 0,
          note: "",
          applied: false,
        },
      ],
    }));
  }

  function removeDailyEntry(entryId: string) {
    if (!activeProject || !canEdit) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: project.dailyEntries.filter((entry) => entry.id !== entryId),
    }));
  }

  function toggleApplyEntry(entry: DailyEntry) {
    if (!activeProject || !canEdit) return;
    updateProject(activeProject.id, (project) => ({
      ...project,
      dailyEntries: project.dailyEntries.map((item) =>
        item.id === entry.id ? { ...item, applied: !item.applied } : item,
      ),
    }));
  }

  function addUser() {
    if (!isAdmin) return;
    setData((prev) => ({
      ...prev,
      users: [...prev.users, { id: uid(), name: `User ${prev.users.length + 1}`, email: "", role: "Editor" }],
    }));
  }

  function removeUser(userId: string) {
    if (!isAdmin) return;
    setData((prev) => {
      const userToRemove = prev.users.find((user) => user.id === userId);
      const adminCount = prev.users.filter((user) => user.role === "Admin").length;
      if (userToRemove?.role === "Admin" && adminCount <= 1) {
        alert("You cannot delete the last Admin user.");
        return prev;
      }
      return { ...prev, users: prev.users.filter((user) => user.id !== userId) };
    });
  }

  async function refreshWeather() {
    if (!activeProject || !canEdit) return;
    setWeatherLoading(true);
    setWeatherError("");
    try {
      const weather = await fetchWeatherForLocation(activeProject.location);
      updateProject(activeProject.id, (project) => ({ ...project, weather }));
    } catch (error: any) {
      setWeatherError(error?.message || "Unable to update weather.");
    } finally {
      setWeatherLoading(false);
    }
  }

  if (!authChecked) return <div className="p-6">Checking login...</div>;

  if (supabaseRef.current && !session) {
    return (
      <AuthScreen
        loading={authLoading}
        mode={authMode}
        setMode={setAuthMode}
        email={authEmail}
        setEmail={setAuthEmail}
        password={authPassword}
        setPassword={setAuthPassword}
        onSubmit={handleAuthSubmit}
        message={authMessage}
      />
    );
  }

  if (!remoteReady) return <div className="p-6">Connecting tracker...</div>;
  if (!activeProject || !projectMetrics) return <div className="p-6">Loading tracker...</div>;

  const recommendation =
    projectMetrics.remainingQty <= 0
      ? "Project scope is fully complete against entered quantities."
      : projectMetrics.adjustedRate <= 0
        ? "No production trend detected yet. Enter daily production to generate projections."
        : projectMetrics.finishSlipDays === 0
          ? `At the current adjusted pace, this project is tracking on or ahead of schedule. Maintain at least ${fmt(
              projectMetrics.requiredDailyRate,
              1,
            )} units/day to protect the target finish.`
          : `At the current adjusted pace, the project is projected to finish ${projectMetrics.finishSlipDays} workday(s) late. Increase average output by about ${fmt(
              Math.max(0, projectMetrics.requiredDailyRate - projectMetrics.adjustedRate),
              1,
            )} units/day to recover the target date.`;

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
              <button
                onClick={addProject}
                disabled={!canEdit}
                className={`rounded-2xl bg-white/10 px-3 py-2 text-sm hover:bg-white/20 ${
                  !canEdit ? "cursor-not-allowed opacity-40" : ""
                }`}
              >
                + Project
              </button>
            </div>

            <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-sm font-medium">{supabaseRef.current ? "Shared database mode" : "Local mode"}</div>
              <div className="mt-1 text-xs text-slate-300">{syncMessage}</div>
              {syncing ? <div className="mt-2 text-xs text-slate-400">Saving changes...</div> : null}
              {session?.user?.email ? (
                <div className="mt-2 text-xs text-slate-300">Signed in as {session.user.email}</div>
              ) : null}
              <div className="mt-1 text-xs text-slate-300">Access: {currentRole}</div>
              {supabaseRef.current && session ? (
                <button
                  onClick={() => void handleSignOut()}
                  className="mt-3 rounded-2xl border border-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/10"
                >
                  Sign out
                </button>
              ) : null}
            </div>

            <div className="space-y-2">
              {data.projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setActiveProjectId(project.id)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                    project.id === activeProjectId
                      ? "border-white/30 bg-white/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{project.name}</div>
                      <div className="mt-1 text-xs text-slate-300">{project.location || "No location set"}</div>
                    </div>
                    {data.projects.length > 1 && isAdmin ? (
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          removeProject(project.id);
                        }}
                        className="rounded-lg px-2 py-1 text-xs text-red-200 hover:bg-white/10"
                      >
                        Delete
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="space-y-4">
            <Card title={activeProject.name} subtitle="Superintendent schedule and production intelligence">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Project name">
                  <Input
                    disabled={!canEdit}
                    value={activeProject.name}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({ ...project, name: event.target.value }))
                    }
                  />
                </Field>
                <Field label="Location">
                  <Input
                    disabled={!canEdit}
                    value={activeProject.location}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({ ...project, location: event.target.value }))
                    }
                  />
                </Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="blue">{activeProject.status}</Badge>
                <Badge>{activeProject.location || "Location not set"}</Badge>
                <Badge>
                  {activeProject.startDate} → {activeProject.targetFinish}
                </Badge>
                <Badge tone="amber">5-day workweek</Badge>
              </div>
            </Card>

            <div className="flex flex-wrap gap-2">
              {(["dashboard", "tasks", "entries", "weather", "users", "settings"] as TabKey[]).map((name) => (
                <button
                  key={name}
                  onClick={() => setTab(name)}
                  className={`rounded-2xl px-4 py-2 text-sm font-medium capitalize ${
                    tab === name
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {tab === "dashboard" ? (
              <DashboardTab activeProject={activeProject} projectMetrics={projectMetrics} recommendation={recommendation} />
            ) : null}

            {tab === "tasks" ? (
              <TasksTab
                activeProject={activeProject}
                canEdit={canEdit}
                isAdmin={isAdmin}
                addTask={addTask}
                removeTask={removeTask}
                updateProject={updateProject}
              />
            ) : null}

            {tab === "entries" ? (
              <EntriesTab
                activeProject={activeProject}
                canEdit={canEdit}
                addDailyEntry={addDailyEntry}
                removeDailyEntry={removeDailyEntry}
                toggleApplyEntry={toggleApplyEntry}
                updateProject={updateProject}
              />
            ) : null}

            {tab === "weather" ? (
              <WeatherTab
                activeProject={activeProject}
                canEdit={canEdit}
                weatherLoading={weatherLoading}
                weatherError={weatherError}
                refreshWeather={refreshWeather}
                updateProject={updateProject}
              />
            ) : null}

            {tab === "users" ? (
              <UsersTab
                users={data.users}
                isAdmin={isAdmin}
                hasConfiguredEmails={hasConfiguredEmails}
                usesSupabase={Boolean(supabaseRef.current)}
                addUser={addUser}
                removeUser={removeUser}
                setData={setData}
              />
            ) : null}

            {tab === "settings" ? (
              <SettingsTab activeProject={activeProject} canEdit={canEdit} updateProject={updateProject} />
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function DashboardTab({
  activeProject,
  projectMetrics,
  recommendation,
}: {
  activeProject: Project;
  projectMetrics: ReturnType<typeof getProjectMetrics>;
  recommendation: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Stat label="Planned Quantity" value={fmt(projectMetrics.plannedQty)} />
        <Stat
          label="Completed Quantity"
          value={fmt(projectMetrics.completeQty)}
          sub={`${fmt(projectMetrics.percentComplete, 1)}% complete`}
          tone="blue"
        />
        <Stat
          label="Recent Daily Rate"
          value={fmt(projectMetrics.recentRate, 1)}
          sub={`Trailing ${activeProject.settings.trailingDays} workdays`}
        />
        <Stat label="Weather-Adjusted Rate" value={fmt(projectMetrics.adjustedRate, 1)} sub="Forecast" tone="amber" />
        <Stat
          label="Required Rate"
          value={fmt(projectMetrics.requiredDailyRate, 1)}
          sub="Needed to hit target"
          tone={projectMetrics.adjustedRate >= projectMetrics.requiredDailyRate ? "green" : "red"}
        />
      </div>

      <Card title="Progress against schedule" subtitle="Reality vs target finish">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-sm text-slate-500">Overall completion</div>
            <div className="mt-2">
              <ProgressBar value={projectMetrics.percentComplete} />
            </div>
            <div className="mt-2 text-sm text-slate-600">
              {fmt(projectMetrics.completeQty)} of {fmt(projectMetrics.plannedQty)} complete
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="text-sm text-slate-500">Projected finish</div>
            <div className="mt-2 text-2xl font-semibold">{projectMetrics.projectedFinish || "Waiting on data"}</div>
            <div className="mt-2 text-sm text-slate-600">Target finish: {activeProject.targetFinish}</div>
          </div>
        </div>
        <div
          className={`mt-4 rounded-2xl border p-4 ${
            projectMetrics.finishSlipDays > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="font-semibold text-slate-900">
            {projectMetrics.finishSlipDays > 0
              ? `Projected slip: ${projectMetrics.finishSlipDays} workday(s)`
              : "Tracking on schedule"}
          </div>
          <p className="mt-1 text-sm text-slate-700">{recommendation}</p>
        </div>
      </Card>

      {activeProject.tasks.map((task) => {
        const metrics = getTaskMetrics(activeProject, task);
        const chartData = buildTaskChartData(activeProject, task);
        return (
          <Card key={task.id} title={task.name} subtitle={`Task chart • ${task.category} • ${task.unit}`}>
            <div className="mb-4 grid gap-3 md:grid-cols-5">
              <Stat label="Complete" value={fmt(metrics.completeQty)} sub={task.unit} />
              <Stat label="Remaining" value={fmt(metrics.remainingQty)} sub={task.unit} />
              <Stat label="Required/day" value={fmt(metrics.requiredDailyRate, 1)} sub={task.unit} tone="amber" />
              <Stat
                label="People needed/day"
                value={fmt(metrics.requiredHeadcount, 1)}
                sub={metrics.usingReality ? "actual productivity" : "target productivity"}
                tone="blue"
              />
              <Stat
                label="Projected finish"
                value={metrics.projectedFinish || "—"}
                sub={`Target ${task.targetFinish}`}
                tone={metrics.slipDays > 0 ? "red" : "green"}
              />
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
                  <Bar yAxisId="qty" dataKey="actualQty" name="Actual qty" />
                  <Bar yAxisId="qty" dataKey="requiredQty" name="Required qty" />
                  <Line yAxisId="qty" type="monotone" dataKey="trendQty" name="Current pace forecast" dot={false} />
                  <Line yAxisId="people" type="monotone" dataKey="requiredHeadcount" name="Required people" dot={false} />
                  <Line yAxisId="people" type="monotone" dataKey="actualHeadcount" name="Actual people" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function TasksTab({
  activeProject,
  canEdit,
  isAdmin,
  addTask,
  removeTask,
  updateProject,
}: {
  activeProject: Project;
  canEdit: boolean;
  isAdmin: boolean;
  addTask: () => void;
  removeTask: (taskId: string) => void;
  updateProject: (projectId: string, updater: (project: Project) => Project) => void;
}) {
  return (
    <Card
      title="Task management"
      subtitle="Per-project quantity, dates, and target productivity"
      action={<Button disabled={!canEdit} onClick={addTask}>Add task</Button>}
    >
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
                {isAdmin ? <Button danger onClick={() => removeTask(task.id)}>Delete</Button> : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Task name">
                  <Input
                    disabled={!canEdit}
                    value={task.name}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, name: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Category">
                  <Input
                    disabled={!canEdit}
                    value={task.category}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, category: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Planned quantity">
                  <Input
                    disabled={!canEdit}
                    type="number"
                    value={task.plannedQty}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id
                            ? { ...item, plannedQty: safeNonNegativeNumber(event.target.value, 0) }
                            : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Baseline complete">
                  <Input
                    disabled={!canEdit}
                    type="number"
                    value={task.baselineCompleteQty}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id
                            ? { ...item, baselineCompleteQty: safeNonNegativeNumber(event.target.value, 0) }
                            : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Unit">
                  <Input
                    disabled={!canEdit}
                    value={task.unit}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, unit: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Start date">
                  <Input
                    disabled={!canEdit}
                    type="date"
                    value={task.startDate}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, startDate: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Target finish">
                  <Input
                    disabled={!canEdit}
                    type="date"
                    value={task.targetFinish}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, targetFinish: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="Target productivity / person / day">
                  <Input
                    disabled={!canEdit}
                    type="number"
                    step="0.1"
                    value={task.targetProductivityPerPerson}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id
                            ? {
                                ...item,
                                targetProductivityPerPerson: Math.max(
                                  0.01,
                                  safeNonNegativeNumber(event.target.value, 0.01),
                                ),
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="mt-3">
                <Field label="Notes">
                  <TextArea
                    disabled={!canEdit}
                    value={task.notes}
                    onChange={(event) =>
                      updateProject(activeProject.id, (project) => ({
                        ...project,
                        tasks: project.tasks.map((item) =>
                          item.id === task.id ? { ...item, notes: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Stat label="Complete" value={`${fmt(metrics.completeQty)} ${task.unit}`} />
                <Stat label="Remaining" value={`${fmt(metrics.remainingQty)} ${task.unit}`} />
                <Stat
                  label="People needed/day"
                  value={fmt(metrics.requiredHeadcount, 1)}
                  sub={metrics.usingReality ? "based on recent reality" : "based on target productivity"}
                  tone="blue"
                />
                <Stat
                  label="Projected finish"
                  value={metrics.projectedFinish || "—"}
                  sub={metrics.slipDays > 0 ? `${metrics.slipDays} workdays late` : "On track"}
                  tone={metrics.slipDays > 0 ? "red" : "green"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function EntriesTab({
  activeProject,
  canEdit,
  addDailyEntry,
  removeDailyEntry,
  toggleApplyEntry,
  updateProject,
}: {
  activeProject: Project;
  canEdit: boolean;
  addDailyEntry: () => void;
  removeDailyEntry: (entryId: string) => void;
  toggleApplyEntry: (entry: DailyEntry) => void;
  updateProject: (projectId: string, updater: (project: Project) => Project) => void;
}) {
  return (
    <Card
      title="Daily production entries"
      subtitle="Unapplied entries do not affect task progress or projections."
      action={<Button disabled={!canEdit} onClick={addDailyEntry}>Add entry</Button>}
    >
      <div className="space-y-4">
        {[...activeProject.dailyEntries]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((entry) => (
            <div
              key={entry.id}
              className="grid gap-3 rounded-3xl border border-slate-200 p-4 lg:grid-cols-[1fr,1fr,1fr,1fr,1.2fr,auto,auto]"
            >
              <Field label="Date">
                <Input
                  disabled={!canEdit}
                  type="date"
                  value={entry.date}
                  onChange={(event) =>
                    updateProject(activeProject.id, (project) => ({
                      ...project,
                      dailyEntries: project.dailyEntries.map((item) =>
                        item.id === entry.id ? { ...item, date: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Task">
                <Select
                  disabled={!canEdit}
                  value={entry.taskId || "all"}
                  onChange={(event) =>
                    updateProject(activeProject.id, (project) => ({
                      ...project,
                      dailyEntries: project.dailyEntries.map((item) =>
                        item.id === entry.id
                          ? {
                              ...item,
                              taskId: event.target.value === "all" ? null : event.target.value,
                              applied: false,
                            }
                          : item,
                      ),
                    }))
                  }
                >
                  <option value="all">Project-level only</option>
                  {activeProject.tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity">
                <Input
                  disabled={!canEdit}
                  type="number"
                  value={entry.qty}
                  onChange={(event) =>
                    updateProject(activeProject.id, (project) => ({
                      ...project,
                      dailyEntries: project.dailyEntries.map((item) =>
                        item.id === entry.id ? { ...item, qty: safeNonNegativeNumber(event.target.value, 0) } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Headcount">
                <Input
                  disabled={!canEdit}
                  type="number"
                  value={entry.headcount}
                  onChange={(event) =>
                    updateProject(activeProject.id, (project) => ({
                      ...project,
                      dailyEntries: project.dailyEntries.map((item) =>
                        item.id === entry.id
                          ? { ...item, headcount: safeNonNegativeNumber(event.target.value, 0) }
                          : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Notes">
                <Input
                  disabled={!canEdit}
                  value={entry.note}
                  onChange={(event) =>
                    updateProject(activeProject.id, (project) => ({
                      ...project,
                      dailyEntries: project.dailyEntries.map((item) =>
                        item.id === entry.id ? { ...item, note: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <div className="flex items-end">
                <Button disabled={!canEdit} onClick={() => toggleApplyEntry(entry)}>
                  {entry.applied ? "Applied" : "Apply"}
                </Button>
              </div>
              <div className="flex items-end">
                <Button secondary disabled={!canEdit} onClick={() => removeDailyEntry(entry.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
      </div>
    </Card>
  );
}

function WeatherTab({
  activeProject,
  canEdit,
  weatherLoading,
  weatherError,
  refreshWeather,
  updateProject,
}: {
  activeProject: Project;
  canEdit: boolean;
  weatherLoading: boolean;
  weatherError: string;
  refreshWeather: () => Promise<void>;
  updateProject: (projectId: string, updater: (project: Project) => Project) => void;
}) {
  return (
    <Card
      title="10-day weather cycle"
      subtitle="Weather affects forward-looking projections."
      action={
        <Button disabled={!canEdit || weatherLoading} onClick={() => void refreshWeather()}>
          {weatherLoading ? "Refreshing..." : "Refresh weather"}
        </Button>
      }
    >
      {weatherError ? (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {weatherError}
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {activeProject.weather.map((day) => (
          <div key={day.id} className="grid gap-3 rounded-3xl border border-slate-200 p-4 md:grid-cols-3">
            <Field label="Date">
              <Input
                disabled={!canEdit}
                type="date"
                value={day.date}
                onChange={(event) =>
                  updateProject(activeProject.id, (project) => ({
                    ...project,
                    weather: project.weather.map((item) =>
                      item.id === day.id ? { ...item, date: event.target.value } : item,
                    ),
                  }))
                }
              />
            </Field>
            <Field label="Condition">
              <Select
                disabled={!canEdit}
                value={day.type}
                onChange={(event) =>
                  updateProject(activeProject.id, (project) => ({
                    ...project,
                    weather: project.weather.map((item) =>
                      item.id === day.id
                        ? { ...item, type: event.target.value as WeatherType, source: "manual" }
                        : item,
                    ),
                  }))
                }
              >
                {WEATHER_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} ({type.factor}x)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note">
              <Input
                disabled={!canEdit}
                value={day.note}
                onChange={(event) =>
                  updateProject(activeProject.id, (project) => ({
                    ...project,
                    weather: project.weather.map((item) =>
                      item.id === day.id ? { ...item, note: event.target.value } : item,
                    ),
                  }))
                }
              />
            </Field>
            <div className="text-sm text-slate-500 md:col-span-3">
              Impact factor: <strong>{weatherMeta(day.type).factor}x</strong> •{" "}
              {day.source === "api" ? "From forecast" : "Manual override"}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UsersTab({
  users,
  isAdmin,
  hasConfiguredEmails,
  usesSupabase,
  addUser,
  removeUser,
  setData,
}: {
  users: AppUser[];
  isAdmin: boolean;
  hasConfiguredEmails: boolean;
  usesSupabase: boolean;
  addUser: () => void;
  removeUser: (userId: string) => void;
  setData: React.Dispatch<React.SetStateAction<AppState>>;
}) {
  return (
    <Card
      title="Users and roles"
      subtitle="Email must match the Supabase login email."
      action={<Button disabled={!isAdmin} onClick={addUser}>Add user</Button>}
    >
      {!hasConfiguredEmails && usesSupabase ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          No user emails are configured yet. The first signed-in user is treated as Admin until emails are added.
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {users.map((user) => (
          <div key={user.id} className="rounded-3xl border border-slate-200 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{user.name}</div>
                <div className="text-sm text-slate-500">{user.role}</div>
              </div>
              {isAdmin ? (
                <Button secondary onClick={() => removeUser(user.id)}>
                  Delete
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Name">
                <Input
                  disabled={!isAdmin}
                  value={user.name}
                  onChange={(event) =>
                    setData((prev) => ({
                      ...prev,
                      users: prev.users.map((item) =>
                        item.id === user.id ? { ...item, name: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Email">
                <Input
                  disabled={!isAdmin}
                  type="email"
                  value={user.email}
                  onChange={(event) =>
                    setData((prev) => ({
                      ...prev,
                      users: prev.users.map((item) =>
                        item.id === user.id ? { ...item, email: event.target.value } : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="Role">
                <Select
                  disabled={!isAdmin}
                  value={user.role}
                  onChange={(event) =>
                    setData((prev) => {
                      const nextRole = event.target.value as UserRole;
                      const adminCount = prev.users.filter((item) => item.role === "Admin").length;
                      if (user.role === "Admin" && nextRole !== "Admin" && adminCount <= 1) {
                        alert("You must keep at least one Admin user.");
                        return prev;
                      }
                      return {
                        ...prev,
                        users: prev.users.map((item) =>
                          item.id === user.id ? { ...item, role: nextRole } : item,
                        ),
                      };
                    })
                  }
                >
                  <option value="Admin">Admin</option>
                  <option value="Editor">Editor</option>
                  <option value="Viewer">Viewer</option>
                </Select>
              </Field>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsTab({
  activeProject,
  canEdit,
  updateProject,
}: {
  activeProject: Project;
  canEdit: boolean;
  updateProject: (projectId: string, updater: (project: Project) => Project) => void;
}) {
  return (
    <Card title="Program settings" subtitle="Tune forecasting and persistence behavior">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Project start date">
          <Input
            disabled={!canEdit}
            type="date"
            value={activeProject.startDate}
            onChange={(event) =>
              updateProject(activeProject.id, (project) => ({ ...project, startDate: event.target.value }))
            }
          />
        </Field>
        <Field label="Target finish">
          <Input
            disabled={!canEdit}
            type="date"
            value={activeProject.targetFinish}
            onChange={(event) =>
              updateProject(activeProject.id, (project) => ({ ...project, targetFinish: event.target.value }))
            }
          />
        </Field>
        <Field label="Project status">
          <Select
            disabled={!canEdit}
            value={activeProject.status}
            onChange={(event) =>
              updateProject(activeProject.id, (project) => ({ ...project, status: event.target.value }))
            }
          >
            <option value="Active">Active</option>
            <option value="Delayed">Delayed</option>
            <option value="Complete">Complete</option>
          </Select>
        </Field>
        <Field label="Trailing workdays used for recent reality">
          <Input
            disabled={!canEdit}
            type="number"
            min="1"
            value={activeProject.settings.trailingDays}
            onChange={(event) =>
              updateProject(activeProject.id, (project) => ({
                ...project,
                settings: {
                  ...project.settings,
                  trailingDays: safePositiveInteger(event.target.value, 5),
                },
              }))
            }
          />
        </Field>
      </div>
      <label className="mt-4 flex items-center justify-between rounded-2xl border border-slate-200 p-3">
        <div>
          <div className="font-medium">Use weather in projection</div>
          <div className="text-sm text-slate-500">
            Apply the 10-day forecast to forward-looking production and finish dates.
          </div>
        </div>
        <input
          disabled={!canEdit}
          type="checkbox"
          checked={activeProject.settings.useWeatherInProjection}
          onChange={(event) =>
            updateProject(activeProject.id, (project) => ({
              ...project,
              settings: { ...project.settings, useWeatherInProjection: event.target.checked },
            }))
          }
        />
      </label>
    </Card>
  );
}

export default function SolarProgressTrackerApp() {
  return <AppShell />;
}

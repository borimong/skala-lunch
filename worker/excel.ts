import * as XLSX from "xlsx";
import {
  type Day,
  type Dish,
  type Meal,
  type WeeklyMenu,
  addDaysISO,
  weekdayKo,
  weeklyMenuSchema,
} from "../shared/menu";

/**
 * 후니드 구내식당 "주간 메뉴표" 엑셀(.xlsx)을 WeeklyMenu로 변환한다.
 *
 * 고정 양식(automation/samples/sample-2026-07-27.xlsx 기준):
 *  - 날짜: R3, 각 요일 dish 열(B·D·F·H·J). 병합 B3:C4 … 값은 왼쪽 셀에.
 *  - 중식(점심): R5~R11, 후식: R12, 석식(저녁): R13~R18.
 *  - 각 요일은 2열: {B,D,F,H,J}=메뉴명, 오른쪽 {C,E,G,I,K}=원산지.
 *  - 메인 요리는 각 끼니 블록 "상단 2개 행"(중식 R5·R6 / 석식 R13·R14).
 *    원본에선 빨강(FFFF0000)·파랑(FF0070C0)으로 강조돼 있으며, 고정 양식이라 행 위치가 곧 강조와 일치.
 *  - 안내문: R20~R22, 열 A.
 *
 * 셀 텍스트는 "있는 그대로" 복사한다(모델이 다시 쓰지 않음) → 글자 오독 원천 차단.
 */

interface DayColumn {
  dish: string;
  origin: string;
}
const DAY_COLUMNS: DayColumn[] = [
  { dish: "B", origin: "C" }, // 월
  { dish: "D", origin: "E" }, // 화
  { dish: "F", origin: "G" }, // 수
  { dish: "H", origin: "I" }, // 목
  { dish: "J", origin: "K" }, // 금
];
const DATE_ROW = 3;
const LUNCH_ROWS = [5, 6, 7, 8, 9, 10, 11];
const LUNCH_MAIN_ROWS = new Set([5, 6]);
const DESSERT_ROW = 12;
const DINNER_ROWS = [13, 14, 15, 16, 17, 18];
const DINNER_MAIN_ROWS = new Set([13, 14]);
const NOTE_ROWS = [20, 21, 22];
const NOTE_COLUMN = "A";

function cellString(ws: XLSX.WorkSheet, addr: string): string {
  const c = ws[addr] as XLSX.CellObject | undefined;
  if (!c || c.v == null) return "";
  return String(c.v).replace(/\r\n/g, "\n").trim();
}

function dateToISOUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 엑셀 날짜 일련번호(1900 체계) → ISO. 25569 = 1899-12-30 ~ 1970-01-01 일수.
function excelSerialToISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return dateToISOUTC(new Date(ms));
}

function readDateISO(ws: XLSX.WorkSheet, addr: string): string | undefined {
  const c = ws[addr] as XLSX.CellObject | undefined;
  if (!c || c.v == null) return undefined;
  if (typeof c.v === "number") return excelSerialToISO(c.v);
  if (c.v instanceof Date) return dateToISOUTC(c.v);
  const m = String(c.v).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

function buildMeal(
  ws: XLSX.WorkSheet,
  col: DayColumn,
  rows: number[],
  mainRows: Set<number>,
): Meal | undefined {
  const dishes: Dish[] = [];
  const origins: string[] = [];
  for (const r of rows) {
    const name = cellString(ws, `${col.dish}${r}`);
    if (name) dishes.push({ name, isMain: mainRows.has(r) });
    const origin = cellString(ws, `${col.origin}${r}`);
    if (origin) origins.push(origin);
  }
  if (dishes.length === 0) return undefined;
  const meal: Meal = { dishes };
  if (origins.length > 0) meal.origin = origins.join("\n");
  return meal;
}

function readFirstSheet(input: ArrayBuffer | Uint8Array): XLSX.WorkSheet {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) throw new Error("엑셀에서 시트를 찾지 못했습니다.");
  return ws;
}

export function parseWeeklyExcel(
  input: ArrayBuffer | Uint8Array,
  fallbackWeekStart?: string,
): WeeklyMenu {
  const ws = readFirstSheet(input);

  // 주 시작(월요일)은 첫 요일 날짜 셀(B3)에서 읽는다. 실패 시 fallback.
  const weekStart =
    readDateISO(ws, `${DAY_COLUMNS[0].dish}${DATE_ROW}`) ?? fallbackWeekStart;
  if (!weekStart) {
    throw new Error("주 시작 날짜(B3)를 읽지 못했습니다.");
  }
  const weekEnd = addDaysISO(weekStart, 4);

  const days: Day[] = DAY_COLUMNS.map((col, i) => {
    const date = addDaysISO(weekStart, i);
    const lunch = buildMeal(ws, col, LUNCH_ROWS, LUNCH_MAIN_ROWS);
    const dinner = buildMeal(ws, col, DINNER_ROWS, DINNER_MAIN_ROWS);
    const dessert = cellString(ws, `${col.dish}${DESSERT_ROW}`) || undefined;

    const day: Day = { date, weekday: weekdayKo(date) };
    if (lunch) day.lunch = lunch;
    if (dinner) day.dinner = dinner;
    if (dessert) day.dessert = dessert;
    // 중식·석식이 모두 비면 휴일로 간주(메뉴 없는 공휴일 열).
    if (!lunch && !dinner) day.isHoliday = true;
    return day;
  });

  // 안전장치: 메뉴를 하나도 못 읽었으면 양식 불일치/손상 파일이다.
  // (SheetJS는 비-xlsx 바이트에도 예외를 안 던지고 빈 시트를 줄 수 있어, 빈 결과가 조용히 발행되는 것을 여기서 차단.)
  const totalDishes = days.reduce(
    (n, d) => n + (d.lunch?.dishes.length ?? 0) + (d.dinner?.dishes.length ?? 0),
    0,
  );
  if (totalDishes === 0) {
    throw new Error(
      "엑셀에서 메뉴를 하나도 찾지 못했어요. 양식이 예상과 다르거나 파일이 손상됐을 수 있어요.",
    );
  }

  const notes = NOTE_ROWS.map((r) => cellString(ws, `${NOTE_COLUMN}${r}`)).filter(
    (s) => s.length > 0,
  );

  const menu: WeeklyMenu = { weekStart, weekEnd, days };
  if (notes.length > 0) menu.notes = notes;

  // 형식(스키마) 보증 — 어긋나면 여기서 throw.
  return weeklyMenuSchema.parse(menu);
}

/**
 * 시트의 모든 비어있지 않은 셀을 "주소=값" 형태로 덤프한다(AI 교차검증용).
 * 파서의 셀 매핑을 거치지 않은 "원본 그대로"라, 파서 매핑 오류까지 대조로 잡아낼 수 있다.
 */
export function excelGridText(input: ArrayBuffer | Uint8Array): string {
  const ws = readFirstSheet(input);
  const ref = ws["!ref"];
  if (!ref) return "";
  const range = XLSX.utils.decode_range(ref);
  const lines: string[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell || cell.v == null) continue;
      // 날짜 등은 표시형식(w)이 더 읽기 쉽다.
      const raw = (cell.w ?? String(cell.v)).replace(/\s+/g, " ").trim();
      if (raw) cells.push(`${addr}=${raw}`);
    }
    if (cells.length > 0) lines.push(cells.join(" | "));
  }
  return lines.join("\n");
}

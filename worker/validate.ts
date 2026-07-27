import { type Day, type WeeklyMenu, addDaysISO, weekdayKo } from "../shared/menu";

export interface ValidationResult {
  ok: boolean; // true면 발행 가능(hardErrors 없음). softWarnings는 발행하되 알림에 포함.
  hardErrors: string[];
  softWarnings: string[];
}

const MAX_NAME_LEN = 60;
const MAX_DISHES_PER_MEAL = 20;

/**
 * 자동 발행 전 통과해야 하는 "검증 게이트".
 * hardErrors가 하나라도 있으면 발행하지 않고 보류(draft)한다. → 오파싱이 조용히 발행되는 것을 차단.
 * softWarnings는 발행은 하되 관리자 알림에 함께 담는다.
 *
 * 스키마 자체(형식) 검증은 parseWeeklyExcel에서 weeklyMenuSchema로 이미 끝났다고 보고,
 * 여기서는 "업무 규칙" 불변식을 본다.
 */
export function validateMenu(
  menu: WeeklyMenu,
  expectedWeekStart: string,
): ValidationResult {
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  // 1) 주 범위: 차주 월요일과 정확히 일치해야 함(엉뚱한 주를 반영하는 것 방지)
  if (menu.weekStart !== expectedWeekStart) {
    hardErrors.push(
      `주 시작일이 예상(${expectedWeekStart})과 다릅니다: ${menu.weekStart}`,
    );
  }
  const expectedEnd = addDaysISO(menu.weekStart, 4);
  if (menu.weekEnd !== expectedEnd) {
    hardErrors.push(
      `주 종료일이 월~금 범위와 다릅니다: ${menu.weekEnd} (예상 ${expectedEnd})`,
    );
  }

  // 2) 월~금 5일이 정확히 존재하는지 + 3) 날짜↔요일 표기 일치(열/날짜 뒤바뀜 감지)
  const byDate = new Map<string, Day>();
  for (const d of menu.days) {
    if (byDate.has(d.date)) hardErrors.push(`중복된 날짜: ${d.date}`);
    byDate.set(d.date, d);
  }
  for (let i = 0; i < 5; i++) {
    const date = addDaysISO(menu.weekStart, i);
    const day = byDate.get(date);
    if (!day) {
      hardErrors.push(`요일 누락: ${date}`);
      continue;
    }
    const expectedWd = weekdayKo(date);
    if (day.weekday && day.weekday !== expectedWd) {
      hardErrors.push(
        `요일 표기 불일치: ${date}는 '${expectedWd}'인데 '${day.weekday}'로 되어 있습니다`,
      );
    }
    // 4) 공휴일이 아니면 최소 중식(점심)에 메뉴가 있어야 함
    if (!day.isHoliday) {
      if ((day.lunch?.dishes?.length ?? 0) === 0) {
        hardErrors.push(`중식(점심)이 비어 있습니다: ${date}`);
      }
      if ((day.dinner?.dishes?.length ?? 0) === 0) {
        softWarnings.push(`석식(저녁)이 비어 있습니다: ${date}`);
      }
    }
  }

  // 5) 메뉴명 위생 + 개수 이상치 + 메인 표기 누락
  for (const day of menu.days) {
    for (const mealKey of ["lunch", "dinner"] as const) {
      const meal = day[mealKey];
      if (!meal) continue;
      const dishes = meal.dishes ?? [];
      if (dishes.length > MAX_DISHES_PER_MEAL) {
        softWarnings.push(
          `${day.date} ${mealKey} 메뉴 개수가 비정상적으로 많습니다(${dishes.length}개)`,
        );
      }
      let anyMain = false;
      for (const dish of dishes) {
        const name = (dish.name ?? "").trim();
        if (name.length === 0) {
          hardErrors.push(`${day.date} ${mealKey}에 빈 메뉴명이 있습니다`);
        } else if (name.length > MAX_NAME_LEN) {
          softWarnings.push(
            `${day.date} ${mealKey} 메뉴명이 비정상적으로 깁니다: "${name.slice(0, 20)}…"`,
          );
        }
        if (dish.isMain) anyMain = true;
      }
      if (dishes.length > 0 && !anyMain) {
        softWarnings.push(
          `${day.date} ${mealKey}에 메인 표기(isMain)가 없습니다`,
        );
      }
    }
  }

  // 방어 심층화: 5일 전부 휴무로 읽히면 파싱 오류일 가능성이 크다 → 보류.
  if (menu.days.length > 0 && menu.days.every((d) => d.isHoliday)) {
    hardErrors.push(
      "주 전체가 휴무로 읽혔습니다 — 파싱 오류일 수 있어 확인이 필요합니다.",
    );
  }

  return { ok: hardErrors.length === 0, hardErrors, softWarnings };
}

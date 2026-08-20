import type { Meal, WeeklyMenu } from "../shared/menu";
import { weekdayKo } from "../shared/menu";

// 외부 소비자(맥 위젯 등)가 "오늘 하루"만 간단히 쓰도록 평면화한 형태.
// 주간 전체(/api/menus/current)와 달리 날짜 하나로 고정되고,
// hasMenu 하나로 "보여줄 메뉴가 있는지"를 바로 판별할 수 있다.
export type TodayResponse = {
  date: string; // YYYY-MM-DD
  weekday: string; // 월~일
  hasMenu: boolean; // 표시할 중/석식이 하나라도 있으면 true
  isHoliday: boolean;
  cafeteria?: string;
  lunch: Meal | null;
  dinner: Meal | null;
  dessert: string | null;
  note: string | null; // 메뉴 없는 사유("주말"·"휴무"·"미발행" 등), 있으면 null
};

// 오늘 날짜(KST). 슬랙 발송과 동일 기준(Asia/Seoul)으로 맞춘다.
export function todayKST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    now,
  );
}

function nonEmptyMeal(meal?: Meal): Meal | null {
  return meal && meal.dishes.length > 0 ? meal : null;
}

// 특정 날짜(dateISO)의 오늘치 응답을 만든다. menu는 그 날이 속한 주의 발행본(없으면 null).
export function buildTodayResponse(
  dateISO: string,
  menu: WeeklyMenu | null,
): TodayResponse {
  if (!menu) {
    return {
      date: dateISO,
      weekday: weekdayKo(dateISO),
      hasMenu: false,
      isHoliday: false,
      lunch: null,
      dinner: null,
      dessert: null,
      note: "미발행",
    };
  }

  const day = menu.days.find((d) => d.date === dateISO);
  if (!day) {
    // 주에 없는 날(주말 등)
    return {
      date: dateISO,
      weekday: weekdayKo(dateISO),
      hasMenu: false,
      isHoliday: false,
      cafeteria: menu.cafeteria,
      lunch: null,
      dinner: null,
      dessert: null,
      note: "주말",
    };
  }

  const lunch = nonEmptyMeal(day.lunch);
  const dinner = nonEmptyMeal(day.dinner);
  const hasMenu = !day.isHoliday && (lunch !== null || dinner !== null);

  return {
    date: day.date,
    weekday: day.weekday,
    hasMenu,
    isHoliday: !!day.isHoliday,
    cafeteria: menu.cafeteria,
    lunch,
    dinner,
    dessert: day.dessert ?? null,
    note: day.isHoliday
      ? (day.label ?? "휴무")
      : hasMenu
        ? null
        : "등록된 메뉴가 없어요",
  };
}

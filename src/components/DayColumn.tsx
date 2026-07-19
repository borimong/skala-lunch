import type { Day } from "../../shared/menu";
import MealBlock from "./MealBlock";
import SpecialBadge from "./SpecialBadge";

type Props = {
  day: Day;
  isToday: boolean;
  showOrigin: boolean;
};

export default function DayColumn({ day, isToday, showOrigin }: Props) {
  const base = "flex flex-col rounded-xl border p-4";
  const cls = isToday
    ? `${base} border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/40`
    : `${base} border-gray-200 bg-white`;

  return (
    <section className={cls}>
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold text-gray-900">{day.weekday}</span>
          <span className="text-xs text-gray-400">
            {day.date.slice(5).replace("-", "/")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {day.label && <SpecialBadge label={day.label} />}
          {isToday && (
            <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
              오늘
            </span>
          )}
        </div>
      </header>

      {day.isHoliday ? (
        <div className="flex flex-1 items-center justify-center rounded-lg bg-gray-50 px-2 py-8 text-center text-sm text-gray-400">
          {day.label ?? "휴무"} · 식사 미제공
        </div>
      ) : (
        <div className="space-y-4">
          <MealBlock
            title="중식"
            accent="text-emerald-700"
            meal={day.lunch}
            showOrigin={showOrigin}
          />
          <MealBlock
            title="석식"
            accent="text-indigo-700"
            meal={day.dinner}
            showOrigin={showOrigin}
          />
          {day.dessert && (
            <div className="border-t border-gray-100 pt-2 text-xs text-gray-500">
              후식 · {day.dessert}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import type { WeeklyMenu } from "../../shared/menu";
import DayColumn from "./DayColumn";

type Props = {
  menu: WeeklyMenu;
  today: string;
  showOrigin: boolean;
};

export default function WeekView({ menu, today, showOrigin }: Props) {
  const todayDay = menu.days.find((day) => day.date === today);
  const restDays = todayDay
    ? menu.days.filter((day) => day.date !== today)
    : menu.days;

  return (
    <>
      <div className="lg:hidden">
        {todayDay && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-bold text-emerald-700">
              오늘의 메뉴
            </h2>
            <DayColumn day={todayDay} isToday showOrigin={showOrigin} />
          </section>
        )}
        <section>
          {todayDay && (
            <h2 className="mb-2 text-sm font-bold text-gray-500">
              금주의 메뉴
            </h2>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {restDays.map((day) => (
              <DayColumn
                key={day.date}
                day={day}
                isToday={false}
                showOrigin={showOrigin}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="hidden gap-3 lg:grid lg:grid-cols-5">
        {menu.days.map((day) => (
          <DayColumn
            key={day.date}
            day={day}
            isToday={day.date === today}
            showOrigin={showOrigin}
          />
        ))}
      </div>
    </>
  );
}

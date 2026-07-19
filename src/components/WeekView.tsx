import type { WeeklyMenu } from "../../shared/menu";
import DayColumn from "./DayColumn";

type Props = {
  menu: WeeklyMenu;
  today: string;
  showOrigin: boolean;
};

export default function WeekView({ menu, today, showOrigin }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {menu.days.map((day) => (
        <DayColumn
          key={day.date}
          day={day}
          isToday={day.date === today}
          showOrigin={showOrigin}
        />
      ))}
    </div>
  );
}

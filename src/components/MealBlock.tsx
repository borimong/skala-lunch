import type { Meal } from "../../shared/menu";
import DishList from "./DishList";

type Props = {
  title: string;
  accent: string;
  meal?: Meal;
  showOrigin: boolean;
};

export default function MealBlock({ title, accent, meal, showOrigin }: Props) {
  if (!meal || meal.dishes.length === 0) return null;
  return (
    <div>
      <div className={`mb-1 text-xs font-bold tracking-wide ${accent}`}>
        {title}
      </div>
      <DishList dishes={meal.dishes} />
      {showOrigin && meal.origin && (
        <p className="mt-1 text-[11px] leading-tight text-gray-400">
          원산지: {meal.origin}
        </p>
      )}
    </div>
  );
}

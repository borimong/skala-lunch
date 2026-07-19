import type { Dish } from "../../shared/menu";

export default function DishList({ dishes }: { dishes: Dish[] }) {
  return (
    <ul className="space-y-0.5">
      {dishes.map((dish, i) => (
        <li
          key={i}
          className={
            dish.isMain
              ? "font-semibold text-gray-900"
              : "text-sm text-gray-600"
          }
        >
          {dish.name}
        </li>
      ))}
    </ul>
  );
}

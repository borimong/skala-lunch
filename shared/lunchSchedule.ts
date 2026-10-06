// 반별 점심 식사 순서 (운영 공지 기준). 주 단위로 순서가 돌지만 공휴일 때문에
// "한 주"가 달력 주와 어긋나므로(예: 9/21~22 + 9/28~30) 규칙으로 계산하지 않고
// 공지에 나온 날짜 구간을 그대로 옮겨 둔다. 공지가 바뀌면 이 표만 고치면 된다.
// 표에 없는 날(휴일, 10/24 이후 이노밸리 일정 등)은 안내를 생략한다.

export const LUNCH_SLOTS = ["11:50", "12:00", "12:10"] as const;

type Rotation = {
  ranges: [start: string, end: string][]; // ISO 날짜, 양끝 포함
  slots: [number[], number[], number[]]; // LUNCH_SLOTS 순서대로 반 번호
};

const ROTATIONS: Rotation[] = [
  { ranges: [["2026-09-07", "2026-09-11"]], slots: [[4], [5, 1], [2, 3]] },
  { ranges: [["2026-09-14", "2026-09-18"]], slots: [[5], [1, 2], [3, 4]] },
  {
    ranges: [
      ["2026-09-21", "2026-09-22"],
      ["2026-09-28", "2026-09-30"],
    ],
    slots: [[1], [2, 3], [4, 5]],
  },
  {
    ranges: [
      ["2026-10-01", "2026-10-02"],
      ["2026-10-06", "2026-10-08"],
    ],
    slots: [[2], [3, 4], [5, 1]],
  },
  { ranges: [["2026-10-12", "2026-10-16"]], slots: [[3], [4, 5], [1, 2]] },
  { ranges: [["2026-10-19", "2026-10-23"]], slots: [[4], [5, 1], [2, 3]] },
];

export type LunchSlot = { time: string; classes: number[] };

export function lunchScheduleFor(dateISO: string): LunchSlot[] | null {
  const rotation = ROTATIONS.find((r) =>
    r.ranges.some(([start, end]) => start <= dateISO && dateISO <= end),
  );
  if (!rotation) return null;
  return rotation.slots.map((classes, i) => ({
    time: LUNCH_SLOTS[i],
    classes,
  }));
}

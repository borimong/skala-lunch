// 사진(2026-07-13 ~ 07-17) 주간 메뉴를 seed.sql 로 생성.
// 적용: node scripts/seed.mjs && wrangler d1 execute skala-lunch --local --file seed.sql
import { writeFileSync } from "node:fs";

const menu = {
  weekStart: "2026-07-13",
  weekEnd: "2026-07-17",
  cafeteria: "후니드 구내식당",
  days: [
    {
      date: "2026-07-13",
      weekday: "월",
      lunch: {
        dishes: [
          { name: "청양풍돈육볶음", isMain: true },
          { name: "매콤두부조림", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "바지락미역국", isMain: false },
          { name: "청경채겉절이", isMain: false },
          { name: "깍두기", isMain: false },
          { name: "샐러드*드레싱*토핑", isMain: false },
        ],
        origin: "돈육:국내산",
      },
      dinner: {
        dishes: [
          { name: "광주식애호박찌개", isMain: true },
          { name: "새우까스*스리라차마요소스", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "연근조림", isMain: false },
          { name: "팽이버섯부추무침", isMain: false },
          { name: "포기김치", isMain: false },
        ],
        origin: "돈육:국내산",
      },
      dessert: "결명자차",
    },
    {
      date: "2026-07-14",
      weekday: "화",
      lunch: {
        dishes: [
          { name: "산채나물볶음밥*계란후라이", isMain: true },
          { name: "씨리얼고구마맛탕", isMain: true },
          { name: "다시마무채국", isMain: false },
          { name: "깐풍만두강정", isMain: false },
          { name: "오이지무침", isMain: false },
          { name: "포기김치", isMain: false },
          { name: "샐러드*드레싱*토핑", isMain: false },
        ],
        origin: "돈육:국내산",
      },
      dinner: {
        dishes: [
          { name: "베테랑떡국(들깨계란떡국)", isMain: true },
          { name: "꼬마돈까스*소스", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "메추리알곤약조림", isMain: false },
          { name: "매콤콩나물무침", isMain: false },
          { name: "포기김치", isMain: false },
        ],
        origin: "사골농축액(우육:호주산), 꼬마돈까스(돈육,계육:국내산,국내산)",
      },
      dessert: "옥수수차",
    },
    {
      date: "2026-07-15",
      weekday: "수",
      label: "초복",
      lunch: {
        dishes: [
          { name: "닭장각백숙*소금", isMain: true },
          { name: "모듬전*초간장", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "볼어묵볶음", isMain: false },
          { name: "수제양파장아찌", isMain: false },
          { name: "석박지 / 요구르트", isMain: false },
          { name: "샐러드*드레싱*토핑", isMain: false },
        ],
        origin: "계육:국내산, 김치전:베트남산, 해물전:베트남산",
      },
      dinner: {
        dishes: [
          { name: "고추잡채*꽃빵", isMain: true },
          { name: "후랑크케찹볶음", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "시래기된장국", isMain: false },
          { name: "오복지", isMain: false },
          { name: "알타리", isMain: false },
        ],
        origin: "돈육:국내산",
      },
      dessert: "17차",
    },
    {
      date: "2026-07-16",
      weekday: "목",
      lunch: {
        dishes: [
          { name: "부대찌개", isMain: true },
          { name: "스크램블에그*케찹", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "미니새송이볶음", isMain: false },
          { name: "건파래볶음", isMain: false },
          { name: "열무김치", isMain: false },
          { name: "샐러드*드레싱*토핑", isMain: false },
        ],
        origin:
          "부대찌개행(계육,돈육:국내산,국내산), 런천미트(돈육,계육:외국산+국내산,국내산), 사골농축액(우사골:호주산)",
      },
      dinner: {
        dishes: [
          { name: "오징어무국", isMain: true },
          { name: "너비아니*데리소스", isMain: true },
          { name: "쌀밥", isMain: false },
          { name: "감자채볶음", isMain: false },
          { name: "아몬드멸치볶음", isMain: false },
          { name: "깍두기", isMain: false },
        ],
        origin:
          "후랑크소세지(계육,돈육:국내산,국내산), 너비아니(돈육,계육:국내산,국내산)",
      },
      dessert: "쟈스민차",
    },
    {
      date: "2026-07-17",
      weekday: "금",
      label: "제헌절",
      isHoliday: true,
    },
  ],
  notes: [
    "밥/죽/누룽지용 쌀(백미,찹쌀,현미,흑미,보리쌀)은 국내산, 배추김치는 배추:국내산·고춧가루:중국산, 두부는 대두:외국산 사용",
    "상기 메뉴는 식재수불 사정에 의해 변경될 수 있습니다.",
  ],
};

const esc = (s) => s.replace(/'/g, "''");
const sql = [
  `DELETE FROM weekly_menus WHERE week_start = '${menu.weekStart}';`,
  `INSERT INTO weekly_menus (week_start, data, status) VALUES ('${menu.weekStart}', '${esc(
    JSON.stringify(menu),
  )}', 'published');`,
  "",
].join("\n");

writeFileSync(new URL("../seed.sql", import.meta.url), sql);
console.log(
  `seed.sql 생성 완료 (week ${menu.weekStart}, ${menu.days.length}일)`,
);

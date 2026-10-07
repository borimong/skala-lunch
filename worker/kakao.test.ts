import { describe, expect, it } from "vitest";
import { parsePosts, weekStartFromTitle } from "./kakao";

// 2026-10-06 08:00 KST
const PUBLISHED = Date.UTC(2026, 9, 5, 23, 0);

describe("parsePosts", () => {
  it("이미지가 있는 게시글만 골라 필요한 필드로 정리한다", () => {
    const posts = parsePosts({
      items: [
        {
          id: 114799834,
          title: "이노밸리 구내식당 주간메뉴[10/05-10/09]",
          permalink: "http://pf.kakao.com/_LCxlxlxb/114799834",
          published_at: PUBLISHED,
          media: [
            {
              type: "image",
              url: "https://k.kakaocdn.net/a/img_xl.jpg",
              xlarge_url: "https://k.kakaocdn.net/a/img_xl.jpg",
            },
          ],
        },
        { id: 1, title: "공지", published_at: PUBLISHED, media: [] },
      ],
    });
    expect(posts).toEqual([
      {
        id: "114799834",
        title: "이노밸리 구내식당 주간메뉴[10/05-10/09]",
        imageUrl: "https://k.kakaocdn.net/a/img_xl.jpg",
        permalink: "https://pf.kakao.com/_LCxlxlxb/114799834",
        publishedAt: PUBLISHED,
      },
    ]);
  });

  it("형식이 바뀌어 items가 없으면 예외를 던진다", () => {
    expect(() => parsePosts({ data: [] })).toThrow(/items/);
  });
});

describe("weekStartFromTitle", () => {
  it("게시글 제목의 시작일을 월요일 ISO 날짜로 바꾼다", () => {
    expect(
      weekStartFromTitle("이노밸리 구내식당 주간메뉴[10/05-10/09]", PUBLISHED),
    ).toBe("2026-10-05");
  });

  it("금요일에 미리 올라온 다음 주 메뉴도 처리한다", () => {
    const fri = Date.UTC(2026, 7, 7, 9, 0); // 2026-08-07 18:00 KST
    expect(weekStartFromTitle("주간메뉴[08/10-08/14]", fri)).toBe("2026-08-10");
  });

  it("연말에 올라온 새해 첫 주는 다음 해로 본다", () => {
    const dec = Date.UTC(2026, 11, 31, 0, 0); // 2026-12-31 KST
    expect(weekStartFromTitle("주간메뉴[01/04-01/08]", dec)).toBe("2027-01-04");
  });

  it("시작일이 월요일이 아니면 그 주 월요일로 맞춘다", () => {
    expect(weekStartFromTitle("주간메뉴[10/06-10/09]", PUBLISHED)).toBe(
      "2026-10-05",
    );
  });

  it("날짜 범위가 없는 제목은 null", () => {
    expect(weekStartFromTitle("추석 연휴 휴무 안내", PUBLISHED)).toBeNull();
  });
});

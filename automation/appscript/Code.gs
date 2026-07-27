/**
 * 차주 식단 자동 반영 — Gmail → Worker 브리지 (전송 전용)
 *
 * 매주 금요일 밤, 이수민(SENDER)님이 보낸 "차주 식단표" 엑셀(.xlsx)을 Gmail에서 찾아
 * Cloudflare Worker의 /api/ingest/weekly 로 전송한다.
 * 파싱·검증·저장은 전부 Worker가 담당한다(이 스크립트는 파일을 실어 나르기만 함).
 *
 * ── 스크립트 속성(프로젝트 설정 > 스크립트 속성)에 넣을 값 ──
 *   WORKER_URL    예) https://skala-lunch.ewkimhyunsu11.workers.dev
 *   INGEST_TOKEN  Worker의 INGEST_TOKEN 시크릿과 "동일한" 값
 *   SENDER        sumany76@whoneed.co.kr
 *   NOTIFY_EMAIL  (선택) 알림 받을 주소. 미설정 시 이 스크립트 실행 계정.
 *
 * ── 트리거 ──
 *   setupTrigger() 를 에디터에서 한 번 실행하면 "매주 금요일 22~23시" 트리거가 생성된다.
 *   (트리거 시각은 프로젝트 시간대 기준 — appsscript.json 의 timeZone: Asia/Seoul 확인)
 *
 * 성공 시에는 "조용히" 처리 완료 라벨만 붙이고 아무 알림도 보내지 않는다.
 * (사용자 슬랙 알림은 기존 매일 오전 8시 스케줄에서만 나간다.)
 * 보류(held)·오류·메일 없음일 때만 NOTIFY_EMAIL 로 알림 메일을 보낸다.
 */

const PROCESSED_LABEL = "식단자동반영-완료";
const INGEST_PATH = "/api/ingest/weekly";

function ingestWeeklyMenu() {
  const props = PropertiesService.getScriptProperties();
  const workerUrl = props.getProperty("WORKER_URL");
  const token = props.getProperty("INGEST_TOKEN");
  const sender = props.getProperty("SENDER");
  const notify =
    props.getProperty("NOTIFY_EMAIL") || Session.getActiveUser().getEmail();

  if (!workerUrl || !token || !sender) {
    notifyAdmin_(
      notify,
      "설정 누락",
      "WORKER_URL / INGEST_TOKEN / SENDER 스크립트 속성을 확인하세요.",
    );
    return;
  }

  const label = getOrCreateLabel_(PROCESSED_LABEL);

  // 발신자 + 첨부 있음 + 최근 4일(주말 수동 재실행 여유) + 아직 처리 안 한 스레드
  const query =
    "from:" +
    sender +
    ' has:attachment newer_than:4d -label:"' +
    PROCESSED_LABEL +
    '"';
  const threads = GmailApp.search(query, 0, 10);

  if (threads.length === 0) {
    notifyAdmin_(
      notify,
      "차주 식단 메일 없음",
      "자동 확인 결과 " +
        sender +
        " 님의 새 첨부 메일을 찾지 못했습니다. 수동 확인이 필요할 수 있어요.",
    );
    return;
  }

  // 가장 최근 메시지에서 .xlsx 첨부 찾기
  let attachment = null;
  let sourceThread = null;
  let receivedAt = null;
  for (const thread of threads) {
    const messages = thread.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const xlsx = messages[i]
        .getAttachments()
        .find((a) => /\.xlsx$/i.test(a.getName()));
      if (xlsx) {
        attachment = xlsx;
        sourceThread = thread;
        receivedAt = messages[i].getDate();
        break;
      }
    }
    if (attachment) break;
  }

  if (!attachment) {
    notifyAdmin_(
      notify,
      "엑셀 첨부 없음",
      sender + " 님의 메일은 있으나 .xlsx 첨부를 찾지 못했습니다.",
    );
    return;
  }

  const payload = {
    filename: attachment.getName(),
    contentBase64: Utilities.base64Encode(attachment.getBytes()),
    sender: sender,
    receivedAt: receivedAt ? receivedAt.toISOString() : null,
  };

  let res;
  try {
    res = UrlFetchApp.fetch(workerUrl.replace(/\/+$/, "") + INGEST_PATH, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    notifyAdmin_(notify, "전송 실패", "Worker 전송 중 오류: " + e);
    return;
  }

  const code = res.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(res.getContentText());
  } catch (e) {
    // 파싱 실패 시 아래 오류 분기에서 원문을 알림
  }

  // 성공: 조용히. 재처리 방지 라벨만 부착.
  if (code === 200 && body.status === "published") {
    sourceThread.addLabel(label);
    return;
  }

  // 보류: 관리자 검토로 넘어감. 재처리 방지 라벨 부착 + 알림.
  if (code === 200 && body.status === "held") {
    sourceThread.addLabel(label);
    const reasons = (body.reasons || []).map((r) => "· " + r).join("\n");
    notifyAdmin_(
      notify,
      "차주 식단 검토 필요(보류)",
      "자동 검증에서 이상이 감지되어 발행을 보류했습니다.\n" +
        "관리자 화면(/admin/pending)에서 검토·발행해 주세요.\n\n" +
        "[사유]\n" +
        (reasons || "(사유 정보 없음)") +
        "\n\n[요약]\n" +
        (body.summary || "(요약 없음)"),
    );
    return;
  }

  // 그 외 오류: 라벨을 붙이지 않아 다음 수동 실행 때 재시도할 수 있게 둔다.
  notifyAdmin_(
    notify,
    "차주 식단 반영 오류",
    "Worker 응답 HTTP " +
      code +
      "\n\n" +
      res.getContentText().slice(0, 1200),
  );
}

function notifyAdmin_(to, subject, body) {
  MailApp.sendEmail(to, "[식단 자동반영] " + subject, body);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** 에디터에서 한 번만 실행: 매주 금요일 22~23시 트리거 생성(기존 동일 트리거는 정리). */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === "ingestWeeklyMenu") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("ingestWeeklyMenu")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(22)
    .create();
}

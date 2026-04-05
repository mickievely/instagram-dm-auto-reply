const config = require("./config");
const { IgApiClient } = require("instagram-private-api");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const downloadedFile = path.join(__dirname, "downloaded_dm.json");
let downloadedMessages = new Set();

function loadDownloadedMessages() {
  try {
    const data = fs.readFileSync(downloadedFile, "utf8");
    downloadedMessages = new Set(JSON.parse(data));
  } catch {
    downloadedMessages = new Set();
  }
}

function saveDownloadedMessages() {
  fs.writeFileSync(downloadedFile, JSON.stringify(Array.from(downloadedMessages)), "utf8");
}

async function downloadMedia(url, filename) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(filename, Buffer.from(buffer));
  console.log(`[✅] 저장 완료: ${filename}`);
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans);
  }));
}

(async () => {
  const ig = new IgApiClient();

  const username = config.username;
  const password = config.password;
  if (!username || !password) {
    console.error(".env에 IG_USERNAME, IG_PASSWORD를 설정하세요. (.env.example 참고)");
    process.exit(1);
  }

  ig.state.generateDevice(username);
  await ig.account.login(username, password);
  console.log(`[+] 로그인 성공: ${username}`);

  const targetUsername = await ask("📩 저장할 상대방 인스타 아이디 입력: ");
  const user = await ig.user.searchExact(targetUsername);
  const userId = user.pk;
  console.log(`[+] ${targetUsername} (ID: ${userId}) DM 검색 중...`);

  const inboxFeed = ig.feed.directInbox();
  const threads = await inboxFeed.items();

  let targetThread = threads.find(t => t.users.some(u => u.pk === userId));
  if (!targetThread) {
    console.log("[!] 해당 사용자와의 DM 스레드를 찾을 수 없습니다.");
    return;
  }
  console.log(`[+] 대화내용을 찾음: ${targetThread.thread_id}`);

  const threadFeed = ig.feed.directThread({ thread_id: targetThread.thread_id });
  const threadItems = await threadFeed.items();

  let saveDir = path.join(__dirname, "downloads", targetUsername);
  try {
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
      console.log(`[+] 저장 폴더 생성: ${saveDir}`);
    }
  } catch (error) {
    console.error(`[!] 폴더 생성 실패: ${error.message}`);
    console.log(`[!] 대신 현재 디렉토리에 저장합니다.`);
    saveDir = __dirname;
  }

  loadDownloadedMessages();
  let downloadedCount = 0;

  for (const msg of threadItems) {
    if (downloadedMessages.has(msg.item_id)) continue;

    let url, ext;

    if (msg.item_type === "raven_media") {
      const media = msg.visual_media?.media;
      if (!media) continue;

      if (media?.video_versions?.length) {
        url = media.video_versions[0].url;
        ext = "mp4";
      } else if (media?.image_versions2?.candidates?.length) {
        url = media.image_versions2.candidates[0].url;
        ext = "jpg";
      } else continue;

      const filename = path.join(saveDir, `dm_raven_${msg.item_id}_${Date.now()}.${ext}`);
      await downloadMedia(url, filename);
      downloadedMessages.add(msg.item_id);
      downloadedCount++;
    }

    else if (msg.item_type === "media") {
      const media = msg.image_versions2?.candidates?.[0] || msg.video_versions?.[0];
      if (!media?.url) continue;

      ext = media.url.endsWith(".mp4") ? "mp4" : "jpg";
      url = media.url;

      const filename = path.join(saveDir, `dm_media_${msg.item_id}_${Date.now()}.${ext}`);
      await downloadMedia(url, filename);
      downloadedMessages.add(msg.item_id);
      downloadedCount++;
    }
  }

  saveDownloadedMessages();

  if (downloadedCount === 0) {
    console.log("[ℹ] 저장할 새로운 사진/영상 메시지가 없습니다.");
  } else {
    console.log(`[✅] 총 ${downloadedCount}개의 파일이 저장되었습니다!`);
    console.log(`[ℹ] 저장 위치: ${saveDir}`);
  }
})();

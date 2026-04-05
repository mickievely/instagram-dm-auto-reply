const config = require("./config");
const { IgApiClient } = require("instagram-private-api");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const downloadedFile = path.join(__dirname, "downloaded_dm.json");

function loadDownloadedSet() {
  try {
    return new Set(JSON.parse(fs.readFileSync(downloadedFile, "utf8")));
  } catch {
    return new Set();
  }
}

function saveDownloadedSet(set) {
  fs.writeFileSync(downloadedFile, JSON.stringify([...set]), "utf8");
}

function pickDmMedia(msg) {
  if (msg.item_type === "raven_media") {
    const media = msg.visual_media?.media;
    if (!media) return null;
    if (media.video_versions?.length) {
      return { url: media.video_versions[0].url, ext: "mp4", tag: "dm_raven" };
    }
    const c = media.image_versions2?.candidates;
    if (c?.length) {
      return { url: c[0].url, ext: "jpg", tag: "dm_raven" };
    }
    return null;
  }
  if (msg.item_type === "media") {
    const m = msg.image_versions2?.candidates?.[0] || msg.video_versions?.[0];
    if (!m?.url) return null;
    return {
      url: m.url,
      ext: m.url.endsWith(".mp4") ? "mp4" : "jpg",
      tag: "dm_media"
    };
  }
  return null;
}

async function downloadMedia(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  fs.writeFileSync(filename, Buffer.from(await res.arrayBuffer()));
  console.log(`[✅] 저장 완료: ${filename}`);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

(async () => {
  const { username, password } = config;
  if (!username || !password) {
    console.error(".env에 IG_USERNAME, IG_PASSWORD를 설정하세요. (.env.example 참고)");
    process.exit(1);
  }

  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  await ig.account.login(username, password);
  console.log(`[+] 로그인 성공: ${username}`);

  const targetRaw = (await ask("📩 저장할 상대방 인스타 아이디 입력: ")).trim();
  if (!targetRaw) {
    console.log("[!] 아이디가 비었습니다.");
    return;
  }

  const searchUser = await ig.user.searchExact(targetRaw);
  const userId = searchUser.pk;
  console.log(`[+] ${targetRaw} (ID: ${userId}) DM 검색 중...`);

  const threads = await ig.feed.directInbox().items();
  const targetThread = threads.find((t) => t.users?.some((u) => u.pk === userId));
  if (!targetThread) {
    console.log("[!] 해당 사용자와의 DM 스레드를 찾을 수 없습니다.");
    return;
  }

  const threadId = targetThread.thread_id;
  console.log(`[+] 대화내용을 찾음: ${threadId}`);

  const threadItems = await ig.feed.directThread({ thread_id: threadId }).items();

  const folderName = path.basename(targetRaw) || "dm";
  let saveDir = path.join(__dirname, "downloads", folderName);
  try {
    fs.mkdirSync(saveDir, { recursive: true });
  } catch (err) {
    console.error(`[!] 폴더 생성 실패: ${err.message}`);
    console.log("[!] 대신 현재 디렉토리에 저장합니다.");
    saveDir = __dirname;
  }

  const downloaded = loadDownloadedSet();
  let downloadedCount = 0;

  for (const msg of threadItems) {
    const id = msg.item_id;
    if (id == null || downloaded.has(id)) continue;
    const picked = pickDmMedia(msg);
    if (!picked) continue;
    await downloadMedia(picked.url, path.join(saveDir, `${picked.tag}_${id}_${Date.now()}.${picked.ext}`));
    downloaded.add(id);
    downloadedCount++;
  }

  saveDownloadedSet(downloaded);

  if (downloadedCount === 0) {
    console.log("[ℹ] 저장할 새로운 사진/영상 메시지가 없습니다.");
  } else {
    console.log(`[✅] 총 ${downloadedCount}개의 파일이 저장되었습니다!`);
    console.log(`[ℹ] 저장 위치: ${saveDir}`);
  }
})();

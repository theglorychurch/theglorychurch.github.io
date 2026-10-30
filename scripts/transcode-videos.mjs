// 드라이브 앨범·메인사진 폴더의 영상을 모든 브라우저가 재생하는 H.264 MP4(720p)로 변환해
// public/media/<파일ID>.mp4 에 둔다. 휴대폰 영상(HEVC)은 일부 브라우저에서 재생되지 않기 때문이다.
// 변환 결과는 .media-cache/ 에 남겨 두고 다음 빌드에서 다시 쓴다 (GitHub Actions 캐시).
// 사용: node --env-file-if-exists=.env scripts/transcode-videos.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const KEY = process.env.GOOGLE_API_KEY;
const ROOTS = [process.env.DRIVE_ALBUM_FOLDER, process.env.DRIVE_MAIN_FOLDER].filter(Boolean);
const MAX_SECONDS = 6 * 60; // 이보다 긴 영상은 변환하지 않고 드라이브 플레이어로 보여 준다
const BUDGET = 700 * 1024 * 1024; // 사이트에 싣는 영상 총량 (GitHub Pages 1GB 한도 안쪽)
const CACHE = '.media-cache';
const OUT = 'public/media';
const MANIFEST = 'src/data/media.json';

if (!KEY || !ROOTS.length) {
  console.log('[media] 구글 키나 폴더가 없어 영상 변환을 건너뜁니다.');
  writeFileSync(MANIFEST, '{}\n');
  process.exit(0);
}

async function list(folder, q = '') {
  const query = encodeURIComponent(`'${folder}' in parents and trashed=false${q}`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,createdTime,videoMediaMetadata(durationMillis))');
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&pageSize=200&key=${KEY}`);
  if (!res.ok) throw new Error(`${res.status} 드라이브 목록`);
  return (await res.json()).files;
}

// 메인사진 폴더와 각 앨범 폴더의 영상 (최신 앨범 먼저)
const videos = [];
for (const root of ROOTS) {
  const items = await list(root);
  const folders = items.filter((f) => f.mimeType === 'application/vnd.google-apps.folder').sort((a, b) => b.name.localeCompare(a.name));
  for (const f of [{ files: items }, ...await Promise.all(folders.map(async (d) => ({ files: await list(d.id) })))]) {
    videos.push(...f.files.filter((v) => v.mimeType.startsWith('video/')));
  }
}

mkdirSync(CACHE, { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/**
 * 100MB 이하는 한 번에 받는다. 드라이브는 그보다 큰 공개 파일을 한 번에 내려받지 못하게 막지만
 * 작은 구간 요청은 허용하므로, 큰 파일은 8MB씩 나눠 받는다. 너무 자주 요청하면 구글이 잠시
 * 막기 때문에 실패하면 쉬었다가 다시 시도한다.
 */
async function download(id, size, dest) {
  const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${KEY}`;
  const get = async (headers) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (attempt >= 3) throw new Error(`다운로드 ${res.status}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  };
  const out = createWriteStream(dest);
  const CHUNK = 8 * 1024 * 1024;
  if (size <= 95 * 1024 * 1024) out.write(await get({}));
  else {
    for (let start = 0; start < size; start += CHUNK) {
      const end = Math.min(start + CHUNK, size) - 1;
      if (!out.write(await get({ Range: `bytes=${start}-${end}` }))) await new Promise((r) => out.once('drain', r));
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

const manifest = {};
let used = 0;
for (const v of videos) {
  const seconds = Number(v.videoMediaMetadata?.durationMillis ?? 0) / 1000;
  if (seconds > MAX_SECONDS) continue;
  const cached = `${CACHE}/${v.id}.mp4`;
  if (!existsSync(cached)) {
    console.log(`[media] 변환: ${v.name} (${Math.round(seconds)}초)`);
    const src = `${CACHE}/${v.id}.src`;
    const tmp = `${cached}.tmp.mp4`;
    try {
      // 휴대폰 영상은 색인(moov)이 파일 끝에 있어 스트리밍으로 읽으면 잘린다. 통째로 받은 뒤 변환한다.
      await download(v.id, Number(v.size), src);
      execFileSync('ffmpeg', [
        '-y', '-loglevel', 'error', '-i', src,
        // 짧은 쪽을 720px로 맞추고, 휴대폰 회전 정보는 ffmpeg가 자동으로 반영한다
        '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '2M', '-bufsize', '4M', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart', tmp,
      ], { stdio: 'inherit', timeout: 20 * 60 * 1000 });
      const out = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).toString());
      if (seconds && Math.abs(out - seconds) > 2) throw new Error(`길이가 맞지 않음 (${out.toFixed(1)}초)`);
      copyFileSync(tmp, cached);
    } catch (e) {
      console.warn(`[media] 변환 실패, 드라이브 플레이어로 대신합니다: ${v.name} - ${e.message}`);
      continue;
    } finally {
      rmSync(src, { force: true });
      rmSync(tmp, { force: true });
    }
  }
  const size = statSync(cached).size;
  if (used + size > BUDGET) continue;
  used += size;
  copyFileSync(cached, `${OUT}/${v.id}.mp4`);
  manifest[v.id] = `/media/${v.id}.mp4`;
}

// 더 이상 드라이브에 없는 영상의 캐시는 지운다
const alive = new Set(videos.map((v) => `${v.id}.mp4`));
for (const f of readdirSync(CACHE)) if (!alive.has(f)) rmSync(`${CACHE}/${f}`, { force: true });

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[media] 영상 ${Object.keys(manifest).length}개, ${(used / 1048576).toFixed(1)}MB`);

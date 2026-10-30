// 빌드할 때 유튜브, 구글 드라이브, 인스타그램에서 콘텐츠를 가져온다.
// 연동 키가 없으면 예시 데이터로 화면을 그린다.

import { church } from '../data/church';

const env = import.meta.env;
const GOOGLE_KEY = env.GOOGLE_API_KEY as string | undefined;
const FOLDERS = {
  notes: env.DRIVE_NOTES_FOLDER as string | undefined,
  bulletin: env.DRIVE_BULLETIN_FOLDER as string | undefined,
  album: env.DRIVE_ALBUM_FOLDER as string | undefined,
  main: env.DRIVE_MAIN_FOLDER as string | undefined,
};
const IG_TOKEN = env.INSTAGRAM_TOKEN as string | undefined;
const IG_USER = (env.INSTAGRAM_USER_ID as string | undefined) ?? '17841473999051029'; // @theglory.church
const NOTICE_DOC = env.DRIVE_NOTICE_DOC as string | undefined;

export const NEW_DAYS = 7;

export type Video = { id: string; title: string; date: string; thumb: string; url: string; sermon?: boolean };

/** UTC 시각을 한국 날짜(YYYY-MM-DD)로 바꾼다. */
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 36e5).toISOString().slice(0, 10);

/** "주일더글로리교회 주일설교 2026.10.25 | 기쁨의 헌신, 넘치는 축복 |" → 설교 제목과 주일 날짜 */
export function parseSermonTitle(title: string) {
  const m = title.match(/설교\s*(20\d{2})\.(\d{1,2})\.(\d{1,2})\s*\|\s*([^|]+?)\s*\|?\s*$/);
  if (!m) return;
  return { title: m[4], date: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
}

/** 설교요약과 같은 주일의 설교 영상 */
export function videoFor(note: { date: string } | undefined, videos: Video[]) {
  if (!note) return;
  return videos.find((v) => v.sermon && v.date === note.date)
    ?? videos.find((v) => v.sermon && v.date >= note.date && v.date <= addDays(note.date, 7));
}
export type NoteBlock = { kind: 'h' | 'p' | 'gap'; text: string };
export type Note = { id: string; title: string; date: string; ref: string; verse: string; body: NoteBlock[]; questions: string[] };
export type Bulletin = { id: string; title: string; date: string; url: string; thumb: string };
/** 앨범 속 사진 또는 영상. 영상이면 src는 드라이브 플레이어 주소다. */
export type Photo = { id: string; src: string; thumb: string; video?: boolean };
export type Dept = 'kids' | 'youth' | 'young-adults';
export type Album = { id: string; title: string; date: string; cover: string; photos: Photo[]; text: string[]; dept?: Dept };

/** 앨범 폴더 이름에 부서 이름이 들어 있으면 그 부서 페이지에도 보인다. */
const DEPT_WORDS: [Dept, RegExp][] = [
  ['kids', /주일학교|유치부|유초등부|유년부|초등부|여름성경학교|어린이/],
  ['youth', /청소년부|중고등부|중등부|고등부/],
  ['young-adults', /청년부|청년/],
];
export const deptOf = (title: string) => DEPT_WORDS.find(([, re]) => re.test(title))?.[0];
export type Post = { id: string; img: string; url: string; caption: string; date: string };

// ---------- helpers ----------

async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.replace(/key=[^&]+/, 'key=***')}`);
  return res.json();
}

/** 파일명 속 날짜(2026-10-26, 20261026, 2026.10.26, 맨 앞의 261026)를 우선하고, 없으면 대체값을 쓴다. */
function dateFrom(name: string, fallback: string) {
  const m = name.match(/(20\d{2})[-.\s]?(\d{1,2})[-.\s]?(\d{1,2})/) ?? name.match(/^()(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!m) return fallback.slice(0, 10);
  if (m.length === 5) return `20${m[2]}-${m[3]}-${m[4]}`;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function stripExt(name: string) {
  return name.replace(/\.[a-z0-9]{2,4}$/i, '');
}

/** "261004_261011_교회대청소", "2026-10-26 주일예배"에서 앞쪽 날짜를 떼고 제목만 남긴다. */
function titleFrom(name: string) {
  const title = stripExt(name).replace(/^(?:(?:20\d{2}[-.\s]?\d{1,2}[-.\s]?\d{1,2}|\d{6})[\s_~\-]*)+/, '').trim();
  return title || name;
}

export const driveImg = (id: string, w = 1600) => `https://lh3.googleusercontent.com/d/${id}=w${w}`;

async function driveList(folder: string, extraQ = '') {
  const q = encodeURIComponent(`'${folder}' in parents and trashed=false${extraQ}`);
  const fields = encodeURIComponent('files(id,name,mimeType,createdTime)');
  const data = await getJson(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=name desc&pageSize=200&key=${GOOGLE_KEY}`,
  );
  return data.files as { id: string; name: string; mimeType: string; createdTime: string }[];
}

const byDateDesc = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date);

/** 실패해도 사이트 빌드는 멈추지 않고 예시 데이터로 대신한다. */
async function safe<T>(label: string, enabled: unknown, load: () => Promise<T>, sample: T): Promise<T> {
  if (!enabled) return sample;
  try {
    return await load();
  } catch (e) {
    console.warn(`[content] ${label} 불러오기 실패, 예시 데이터 사용:`, (e as Error).message);
    return sample;
  }
}

// ---------- YouTube ----------

async function loadYoutube() {
  const handle = church.youtubeHandle.replace('@', '');
  const ch = await getJson(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handle}&key=${GOOGLE_KEY}`);
  const channelId: string = ch.items[0].id;
  const list = async (prefix: 'UULF' | 'UUSH', max: number): Promise<Video[]> => {
    const data = await getJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=${max}&playlistId=${prefix}${channelId.slice(2)}&key=${GOOGLE_KEY}`,
    );
    return data.items.map((it: any) => {
      const t = it.snippet.thumbnails;
      const id = it.contentDetails.videoId;
      return {
        id,
        ...(() => {
          const sermon = parseSermonTitle(it.snippet.title);
          return sermon
            ? { title: sermon.title, date: sermon.date, sermon: true }
            : { title: it.snippet.title, date: kstDate(it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt) };
        })(),
        thumb: (t.maxres ?? t.high ?? t.medium ?? t.default).url,
        url: prefix === 'UUSH' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      };
    });
  };
  const [videos, shorts] = await Promise.all([list('UULF', 24), list('UUSH', 12)]);
  return { videos, shorts };
}

// ---------- Drive: 설교요약 ----------

const BOOKS = '창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘상|사무엘하|열왕기상|열왕기하|역대상|역대하|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야애가|예레미야|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도전서|고린도후서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가전서|데살로니가후서|디모데전서|디모데후서|디도서|빌레몬서|히브리서|야고보서|베드로전서|베드로후서|요한일서|요한이서|요한삼서|유다서|요한계시록';
/** "시편 110편 3절", "로마서 12장 17-18절", "로마서 12:17-18" */
const REF = new RegExp(`(?:${BOOKS})\\s*\\d+\\s*(?:편|장|:)\\s*(?:\\d+\\s*(?:[-~]\\s*\\d+)?\\s*절?)?`);

/** "기쁨의 헌신, 시편 110편 3절" → 제목과 본문으로 나눈다. */
export function splitTitle(line: string) {
  const m = line.match(REF);
  if (!m) return { title: line.trim(), ref: '' };
  const title = line.replace(m[0], '').replace(/[\s,·|/(\[]+$/, '').replace(/^[\s,·|/)\]]+/, '').trim();
  return { title, ref: m[0].trim() };
}

/**
 * 목사님이 쓰시는 형식을 그대로 읽는다.
 *   첫 줄: "기쁨의 헌신, 시편 110편 3절" (제목과 본문)
 *   "1. ..." 으로 시작하는 줄: 소제목
 *   "Q1) ..." 으로 시작하는 줄: 나눔 질문 (들여쓴 다음 줄은 이어 붙인다)
 * 예전 형식("본문: 로마서 12:17-18" + 구절 한 줄)도 읽는다.
 */
export function parseNote(text: string) {
  const raw = text.replace(/\r/g, '').replace(/^﻿/, '').split('\n');
  let i = raw.findIndex((l) => l.trim());
  let title = '';
  let ref = '';
  let verse = '';
  const legacy = raw[i]?.trim().match(/^본문\s*[:：]\s*(.+)$/);
  if (legacy) {
    ref = legacy[1];
    i++;
    while (i < raw.length && !raw[i].trim()) i++;
    verse = raw[i]?.trim() ?? '';
    i++;
  } else if (i >= 0) {
    ({ title, ref } = splitTitle(raw[i]));
    i++;
  }

  const body: NoteBlock[] = [];
  const questions: string[] = [];
  let inQuestion = false;
  for (const line of raw.slice(Math.max(i, 0))) {
    const t = line.trim();
    if (!t) { body.push({ kind: 'gap', text: '' }); inQuestion = false; continue; }
    if (/^Q\d*[).:]/i.test(t)) { questions.push(t.replace(/^Q\d*[).:]\s*/i, '')); inQuestion = true; continue; }
    if (inQuestion && /^\s/.test(line)) { questions[questions.length - 1] += ' ' + t; continue; }
    inQuestion = false;
    if (/^\d+\.\s/.test(t)) { body.push({ kind: 'h', text: t }); continue; }
    const last = body.at(-1);
    if (last?.kind === 'p') last.text += '\n' + t;
    else body.push({ kind: 'p', text: t });
  }
  return { title, ref, verse, body: body.filter((b) => b.kind !== 'gap'), questions };
}

async function loadNotes(): Promise<Note[]> {
  const files = await driveList(FOLDERS.notes!, " and mimeType='application/vnd.google-apps.document'");
  const notes = await Promise.all(
    files.slice(0, 60).map(async (f) => {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain&key=${GOOGLE_KEY}`);
      const parsed = parseNote(res.ok ? await res.text() : '');
      const fromName = splitTitle(titleFrom(f.name));
      return {
        ...parsed,
        id: f.id,
        title: parsed.title || fromName.title,
        ref: parsed.ref || fromName.ref,
        date: dateFrom(f.name, f.createdTime),
      };
    }),
  );
  return notes.sort(byDateDesc);
}

// ---------- Drive: 주보 ----------

async function loadBulletins(): Promise<Bulletin[]> {
  const files = await driveList(FOLDERS.bulletin!, " and mimeType!='application/vnd.google-apps.folder'");
  return files
    .map((f) => {
      const date = dateFrom(f.name, f.createdTime);
      const [y, mo, d] = date.split('-').map(Number);
      return {
        id: f.id,
        title: `${y}년 ${mo}월 ${d}일 주보`,
        date,
        url: `https://drive.google.com/file/d/${f.id}/view`,
        thumb: driveImg(f.id, 800),
      };
    })
    .sort(byDateDesc);
}

// ---------- Drive: 앨범, 메인 사진 ----------

const isImage = " and mimeType contains 'image/'";

async function loadAlbums(): Promise<Album[]> {
  const folders = await driveList(FOLDERS.album!, " and mimeType='application/vnd.google-apps.folder'");
  const albums = await Promise.all(
    folders.map(async (f) => {
      const files = (await driveList(f.id)).sort((a, b) => a.name.localeCompare(b.name));
      const photos: Photo[] = files.flatMap((p) => {
        if (p.mimeType.startsWith('image/')) return [{ id: p.id, src: driveImg(p.id, 2000), thumb: driveImg(p.id, 800) }];
        if (p.mimeType.startsWith('video/')) return [{ id: p.id, src: `https://drive.google.com/file/d/${p.id}/preview`, thumb: driveImg(p.id, 800), video: true }];
        return [];
      });
      // 폴더에 구글 문서가 있으면 그 내용을 앨범 소개글로 쓴다.
      const doc = files.find((p) => p.mimeType === 'application/vnd.google-apps.document');
      const text = doc ? await exportParagraphs(doc.id) : [];
      return {
        id: f.id,
        title: titleFrom(f.name),
        date: dateFrom(f.name, f.createdTime),
        cover: (photos.find((p) => !p.video) ?? photos[0])?.thumb ?? '',
        photos,
        text,
        dept: deptOf(f.name),
      };
    }),
  );
  return albums.filter((a) => a.photos.length).sort(byDateDesc);
}

async function exportParagraphs(id: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain&key=${GOOGLE_KEY}`);
  if (!res.ok) return [];
  return (await res.text()).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

async function loadMainPhotos(): Promise<string[]> {
  const files = await driveList(FOLDERS.main!, isImage);
  return files.map((f) => driveImg(f.id, 2000));
}

// ---------- Instagram ----------

// ---------- Drive: 공지 한 줄 ----------

export type Notice = { text: string; link?: string; until?: string };

/**
 * 첫 줄이 공지 문구다. 아래 줄은 선택 사항이다.
 *   링크: https://...   → 공지를 누르면 이동
 *   까지: 2026-12-25    → 이 날짜가 지나면 자동으로 숨김
 * 문서를 비우면 공지가 사라진다.
 */
export function parseNotice(text: string, today = new Date().toISOString().slice(0, 10)): Notice | undefined {
  const lines = text.replace(/\r/g, '').replace(/^\uFEFF/, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const notice: Notice = { text: lines[0] };
  for (const l of lines.slice(1)) {
    const link = l.match(/^링크\s*[:：]\s*(\S+)/);
    const until = l.match(/^까지\s*[:：]\s*(.+)/);
    if (link) notice.link = link[1];
    if (until) notice.until = dateFrom(until[1], until[1]);
  }
  if (notice.until && notice.until < today) return;
  return notice;
}

async function loadNotice() {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${NOTICE_DOC}/export?mimeType=text/plain&key=${GOOGLE_KEY}`);
  if (!res.ok) throw new Error(`${res.status} 공지 문서`);
  return parseNotice(await res.text());
}

async function loadInstagram(): Promise<Post[]> {
  const data = await getJson(
    `https://graph.facebook.com/v21.0/${IG_USER}/media?fields=id,media_type,media_url,permalink,caption,timestamp&limit=100&access_token=${IG_TOKEN}`,
  );
  // 릴스(VIDEO)는 유튜브 숏츠와 겹치므로 사진 게시물만 쓴다.
  return data.data
    .filter((p: any) => p.media_type !== 'VIDEO')
    .slice(0, 12)
    .map((p: any) => ({ id: p.id, img: p.media_url, url: p.permalink, caption: p.caption ?? '', date: p.timestamp.slice(0, 10) }));
}

// ---------- 예시 데이터 ----------

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 864e5).toISOString().slice(0, 10);
const lastSunday = (weeks = 0) => daysAgo(today.getDay() + weeks * 7);

const sample = {
  videos: Array.from({ length: 9 }, (_, i) => ({
    id: `v${i}`, title: i === 0 ? '최신 주일설교 제목이 여기에 들어갑니다' : `주일설교 제목 ${i + 1}`,
    date: daysAgo(today.getDay() - 1 + i * 7), thumb: '', url: church.youtube,
  })),
  shorts: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `숏츠 ${i + 1}`, date: daysAgo(i * 3), thumb: '', url: church.youtube })),
  notes: Array.from({ length: 6 }, (_, i) => ({
    id: `n${i}`, title: i === 0 ? '모든 사람과 더불어 화목하라' : `설교요약 예시 ${i + 1}`, date: lastSunday(i),
    ref: '로마서 12:17-18', verse: '할 수 있거든 너희로서는 모든 사람과 더불어 화목하라',
    body: [{ kind: 'p' as const, text: '설교요약 문서의 둘째 줄부터 이곳에 표시됩니다.' }, { kind: 'h' as const, text: '1. 소제목은 이렇게 보입니다.' }, { kind: 'p' as const, text: '목사님이 구글 드라이브 “설교요약” 폴더에 문서를 넣으면 자동으로 올라옵니다.' }],
    questions: ['나눔 질문은 이렇게 보입니다.'],
  })),
  bulletins: Array.from({ length: 8 }, (_, i) => {
    const date = lastSunday(i);
    const [y, mo, d] = date.split('-').map(Number);
    return { id: `b${i}`, title: `${y}년 ${mo}월 ${d}일 주보`, date, url: '#', thumb: '' };
  }),
  albums: ['주일예배', '주일학교 오후활동', '청년부 가을 소풍', '추수감사주일', '청소년부 수련회', '여름성경학교', '청년부 수련회', '전교인 야유회'].map((t, i) => ({
    id: `a${i}`, title: t, date: lastSunday(i), cover: '', dept: deptOf(t),
    photos: Array.from({ length: 9 }, (_, j) => ({ id: `a${i}p${j}`, src: '', thumb: '' })),
    text: [] as string[],
  })),
  posts: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, img: '', url: '#', caption: '', date: daysAgo(i * 4) })),
  mainPhotos: ['', '', '', ''],
  notice: { text: '12월 24일 성탄 전야 예배는 오후 7시에 드립니다', link: '/about/worship/' } as Notice | undefined,
};

// ---------- 내보내기 ----------

let cache: Promise<Awaited<ReturnType<typeof loadAll>>> | undefined;

async function loadAll() {
  const [yt, notes, bulletins, albums, posts, mainPhotos, notice] = await Promise.all([
    safe('youtube', GOOGLE_KEY, loadYoutube, { videos: sample.videos, shorts: sample.shorts }),
    safe('설교요약', GOOGLE_KEY && FOLDERS.notes, loadNotes, sample.notes),
    safe('주보', GOOGLE_KEY && FOLDERS.bulletin, loadBulletins, sample.bulletins),
    safe('앨범', GOOGLE_KEY && FOLDERS.album, loadAlbums, sample.albums),
    safe('인스타', IG_TOKEN, loadInstagram, sample.posts),
    safe('메인사진', GOOGLE_KEY && FOLDERS.main, loadMainPhotos, [] as string[]),
    safe('공지', GOOGLE_KEY && NOTICE_DOC, loadNotice, sample.notice),
  ]);

  // 메인 사진: "메인" 폴더가 우선, 비어 있으면 최근 앨범 사진
  const hero = mainPhotos.length
    ? mainPhotos.slice(0, 6)
    : albums.flatMap((a) => a.photos.filter((p) => !p.video).slice(0, 2).map((p) => p.src)).slice(0, 4);

  // 이번 주 말씀: 최신 설교요약 + 그 주일 이후 7일 안에 올라온 영상
  const note = notes[0];
  const video = videoFor(note, yt.videos);

  const isNew = (d: string) => d >= daysAgo(NEW_DAYS);
  const badges = {
    sermons: yt.videos.filter((v) => isNew(v.date)).length + notes.filter((n) => isNew(n.date)).length,
    news: bulletins.filter((b) => isNew(b.date)).length + albums.filter((a) => isNew(a.date)).length,
  };

  return { ...yt, notes, bulletins, albums, posts, notice, hero: hero.length ? hero : sample.mainPhotos, word: { note, video }, badges, isNew };
}

function addDays(date: string, n: number) {
  return new Date(new Date(date).getTime() + n * 864e5).toISOString().slice(0, 10);
}

export function getContent() {
  return (cache ??= loadAll());
}

export function fmtDot(date: string) {
  const [, m, d] = date.split('-');
  return `${m}.${d}`;
}

export function fmtFull(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}. ${m}. ${d}`;
}

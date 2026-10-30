# 전주더글로리교회 홈페이지

Astro로 만든 정적 사이트입니다. GitHub Actions가 매시 정각에 다시 빌드해서 유튜브, 구글 드라이브, 인스타그램의 새 콘텐츠를 반영하고 GitHub Pages에 배포합니다.

- 교회 정보(예배 시간, 소개 글, 새가족 안내): `src/data/church.ts`
- 외부 콘텐츠 연동: `src/lib/content.ts`
- 연동 준비와 드라이브 사용법: `SETUP.md`
- 비밀값 목록: `.env.example` (실제 값은 `.env`와 GitHub Secrets에만 둡니다)

```sh
npm install
npm run dev      # 로컬 개발
npm run build    # dist/ 생성
```

필기체 SVG는 `node scripts/script-words.mjs`로 다시 만듭니다. 이 스크립트를 쓰려면 Quentin 폰트가 설치되어 있어야 하며, 폰트 파일은 저장소에 올리지 않습니다.
